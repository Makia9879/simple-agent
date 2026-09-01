// Package pi is the private, process-only adapter for PI RPC JSONL.
package pi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	logic "terminal-agent-hub/backend/api/internal/logic/hub"
)

var (
	ErrInvalidSessionRef = errors.New("invalid PI session reference")
	ErrPIProtocol        = errors.New("invalid PI JSONL protocol")
)

var sessionRefPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

// Config deliberately contains no provider credential fields. PI discovers credentials
// from its protected configuration/environment, never from the Hub database or argv.
type Config struct {
	Command string
	DataDir string
}

type Adapter struct {
	config Config
	mu     sync.Mutex
	active map[string]*process
}

type process struct {
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	stdout   io.ReadCloser
	mu       sync.Mutex
	done     chan struct{}
	waitOnce sync.Once
}

func New(config Config) (*Adapter, error) {
	if config.Command == "" {
		config.Command = "pi"
	}
	if config.DataDir == "" {
		return nil, errors.New("PI data directory is required")
	}
	if err := os.MkdirAll(config.DataDir, 0700); err != nil {
		return nil, fmt.Errorf("create PI data directory: %w", err)
	}
	return &Adapter{config: config, active: make(map[string]*process)}, nil
}

// SessionPath converts only an opaque relative reference to a PI session path.
// Neither an absolute path nor a traversal segment can cross DataDir.
func (a *Adapter) SessionPath(ref string) (string, error) {
	if !sessionRefPattern.MatchString(ref) {
		return "", ErrInvalidSessionRef
	}
	base, err := filepath.Abs(a.config.DataDir)
	if err != nil {
		return "", err
	}
	path := filepath.Join(base, ref+".jsonl")
	rel, err := filepath.Rel(base, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", ErrInvalidSessionRef
	}
	return path, nil
}

func (a *Adapter) command(ctx context.Context, ref, model string, noSession bool) (*process, error) {
	args := []string{"--mode", "rpc", "--no-tools"}
	if noSession {
		args = append(args, "--no-session")
	} else {
		path, err := a.SessionPath(ref)
		if err != nil {
			return nil, err
		}
		args = append(args, "--session-dir", a.config.DataDir, "--session", path)
	}
	if model != "" {
		args = append(args, "--model", model)
	}
	cmd := exec.CommandContext(ctx, a.config.Command, args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		return nil, err
	}
	return &process{cmd: cmd, stdin: stdin, stdout: stdout, done: make(chan struct{})}, nil
}

func writeCommand(p *process, command any) error {
	b, err := json.Marshal(command)
	if err != nil {
		return err
	}
	// JSON is encoded once and exactly one LF frame is written. No generic line
	// writer is used, so U+2028/U+2029 remain ordinary JSON string characters.
	p.mu.Lock()
	defer p.mu.Unlock()
	_, err = p.stdin.Write(append(b, '\n'))
	return err
}

func (a *Adapter) Prompt(ctx context.Context, ref, model, requestID, message string) (<-chan logic.PIEvent, error) {
	if _, err := a.SessionPath(ref); err != nil {
		return nil, err
	}
	p, err := a.command(ctx, ref, model, false)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	if _, exists := a.active[ref]; exists {
		a.mu.Unlock()
		_ = p.cmd.Process.Kill()
		return nil, errors.New("PI session already active")
	}
	a.active[ref] = p
	a.mu.Unlock()
	if err := writeCommand(p, map[string]any{"id": requestID, "type": "prompt", "message": message}); err != nil {
		a.finish(ref, p)
		return nil, err
	}
	out := make(chan logic.PIEvent, 16)
	go a.stream(ref, p, out)
	return out, nil
}

func (a *Adapter) Abort(ctx context.Context, ref string) error {
	if _, err := a.SessionPath(ref); err != nil {
		return err
	}
	a.mu.Lock()
	p := a.active[ref]
	a.mu.Unlock()
	if p == nil {
		return errors.New("no active PI session")
	}
	if err := writeCommand(p, map[string]any{"type": "abort"}); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func (a *Adapter) finish(ref string, p *process) {
	a.mu.Lock()
	if a.active[ref] == p {
		delete(a.active, ref)
	}
	a.mu.Unlock()
	_ = p.stdin.Close()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	p.waitOnce.Do(func() { _ = p.cmd.Wait() })
	select {
	case <-p.done:
	default:
		close(p.done)
	}
}

func (a *Adapter) stream(ref string, p *process, out chan<- logic.PIEvent) {
	defer close(out)
	defer a.finish(ref, p)
	settled := false
	finishReason := "stop"
	reader := bufio.NewReaderSize(p.stdout, 64*1024)
	for {
		line, err := readLFRecord(reader)
		if err != nil {
			break
		}
		if len(line) == 0 {
			continue
		}
		var raw map[string]any
		if json.Unmarshal(line, &raw) != nil {
			out <- logic.PIEvent{Type: "error", Code: "PI_PROTOCOL", Message: "PI returned invalid protocol data"}
			return
		}
		if raw["type"] == "response" {
			if ok, exists := raw["success"].(bool); exists && !ok {
				out <- logic.PIEvent{Type: "error", Code: "PI_REJECTED", Message: "PI rejected request"}
				return
			}
			continue
		}
		if raw["type"] == "message_end" {
			if message, _ := raw["message"].(map[string]any); message != nil {
				if reason, _ := message["stopReason"].(string); reason != "" {
					finishReason = reason
				}
			}
			continue
		}
		if raw["type"] == "message_update" {
			if usage := usageEvent(raw["usage"]); usage.Type != "" {
				out <- usage
			}
			event, _ := raw["assistantMessageEvent"].(map[string]any)
			if event != nil && event["type"] == "text_delta" {
				if delta, _ := event["delta"].(string); delta != "" {
					out <- logic.PIEvent{Type: "text_delta", Delta: delta}
				}
			}
			continue
		}
		switch raw["type"] {
		case "agent_settled":
			if reason, _ := raw["stopReason"].(string); reason != "" {
				finishReason = reason
			}
			out <- logic.PIEvent{Type: "agent_settled", FinishReason: finishReason}
			settled = true
			return
		case "error", "extension_error":
			out <- logic.PIEvent{Type: "error", Code: "PROVIDER_ERROR", Message: "模型服务暂时不可用"}
			return
		}
	}
	if !settled {
		out <- logic.PIEvent{Type: "error", Code: "PI_UNAVAILABLE", Message: "PI process exited before settled"}
	}
}
