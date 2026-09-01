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

The mock implements the user-side `/api/v1` contract in `src/lib/mock-api.ts`, including model selection, conversations, cursor-shaped message reads, usage, and four-event SSE-shaped streaming (`text_delta`, `usage`, `done`, `error`). It is selected directly for the independent mock closure. The single deployment configuration point is `PUBLIC_API_BASE_URL`, defaulting to `/api/v1`, in `src/lib/config.ts`; replacing the mock adapter with a fetch adapter must use this constant only. Browser mock state is persisted in localStorage to demonstrate refresh/history and soft deletion.

Messages use a small escaping allow-list renderer; raw HTML is encoded before limited Markdown formatting, so scripts, event handlers and URLs cannot execute. User-visible errors are fixed product messages and never include stack traces, paths, or credentials.
