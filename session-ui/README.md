# Terminal Agent Hub — Session UI

Independent SvelteKit mock SPA for A-line tasks F0/F1/F5/F6/F7/F9. It deliberately has no backend, PI process, Provider request, credential, or external network dependency.

```sh
npm install
npm run dev
npm run lint
npm test
npm run build
```

Open the URL printed by Vite. Use `alice` / `demo` (or `admin` / `demo`) to sign in. The mock also exposes deterministic login states: `disabled` / `demo`, `limited` / `demo`, and an incorrect password. In chat, `/error` and `/limit` exercise sanitized error/429 UI; stop during a response exercises abort.

## Contract and configuration

The mock implements the user-side `/api/v1` contract in `src/lib/mock-api.ts`, including model selection, conversations, cursor-shaped message reads, usage, and four-event SSE-shaped streaming (`text_delta`, `usage`, `done`, `error`). It is the default independent closure. Set `VITE_USE_MOCK=false` to select the REST/SSE gateway in `src/lib/api.ts`; it sends `credentials: 'include'`, performs one cookie refresh retry after a 401, parses the four public SSE events, and uses no Provider credentials. The single deployment base setting is `PUBLIC_API_BASE_URL`, defaulting to `/api/v1`, in `src/lib/config.ts`. Browser mock state is persisted in localStorage to demonstrate refresh/history and soft deletion.

### Real API development

When `VITE_USE_MOCK=false`, Vite proxies same-origin `/api` requests in both `npm run dev` and `npm run preview`. The proxy target is `VITE_PROXY_TARGET`, defaulting to `http://localhost:8080`; the `/api/v1` path is retained for the backend. For example:

```sh
VITE_USE_MOCK=false VITE_PROXY_TARGET=http://localhost:8080 npm run dev
```

The proxy is omitted in mock mode, so the independent mock workflow is unchanged.

Messages use a small escaping allow-list renderer; raw HTML is encoded before limited Markdown formatting, so scripts, event handlers and URLs cannot execute. User-visible errors are fixed product messages and never include stack traces, paths, or credentials.
