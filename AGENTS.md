# AGENTS.md — Overview

Single source of truth for **AI agents, MCP clients, RAG indexers, and human contributors** working on this repo. Read this first.

> If you also have a `README.md`, treat **AGENTS.md as authoritative** for agent / build / deploy context. The README is for casual visitors.

---

## 1. Project purpose

`overview` is a **single-page React + TypeScript + Vite app** for AI-assisted research notes. It renders an outlinable workspace (`ResearchOverview`), a printable `Summary` view, and a `Presentation` mode. State is held entirely in the browser; users export / share workspaces as JSON snapshots or compressed `#workspace-share=` URL fragments.

There is **no backend by default** for workspace sync or file storage. **Outline / workspace AI** is wired in `src/App.tsx` to a **local OpenAI-compatible** client (`src/ai/ollamaOpenAiIterate.ts`, default Ollama on `127.0.0.1:11434`). Set **`VITE_USE_AI_STUB=1`** at build time to use the in-app **deterministic stubs** instead (no network). See `docs/agent/08-local-ollama.md`. For **tooling and IDE agents** acting as a collaborator on the same document surface, use the **workspace host bridge** (subscribe / `loadSnapshot`, optional window events) — **Menu → Actions** on production builds, always on in dev; see `docs/agent/09-agent-collaboration.md` and §6 below.

Key entry points:

- `src/main.tsx` — Vite entry, mounts `<App />`.
- `src/App.tsx` — page router; passes `onAiIterate` / `onWorkspaceAssistant` (or omits them when stub build).
- `src/research/ResearchOverview.tsx` — workspace shell, AI actions, drawer, share link.
- `src/research/workspace-snapshot.ts` — interchange schema + parser.
- `src/research/workspace-share-link.ts` — `#workspace-share=` encoder/decoder (gzip + lz-string fallback).

---

## 2. Build / lint / dev

Node **LTS (>= 20)**, npm 10+. Lockfile is committed.

```bash
npm ci              # reproducible install
npm run dev         # Vite dev server
npm run lint        # eslint .
npm run build       # tsc -b && vite build  -> dist/
npm run preview     # serve dist/
```

CI runs `npm ci`, `npm run lint`, `npm run build` on every PR/push to `main` (`.github/workflows/ci.yml`).

The static `dist/` artifact is published to GitHub Pages by `.github/workflows/deploy-pages.yml` on `main`.

---

## 3. Environment variables

Only **build-time `VITE_*`** vars are read by the client. Anything else is server-only (Action runners, local scripts).

| Var | Where | Required | Purpose |
|---|---|---|---|
| `VITE_BASE_PATH` | build | no | Vite `base`. Defaults to `/` for local; CI sets `/<repo>/` for Pages. |
| `VITE_DEFAULT_MODEL` | build | no | Display-only default in the AI drawer (e.g. `gpt-4o-mini`). |
| `VITE_USE_AI_STUB` | build | no | When `1`, `App` omits AI handlers → in-app deterministic stubs (no chat HTTP). |
| `VITE_OVERVIEW_CHAT_BASE` | build | no | OpenAI-compatible API root (e.g. `http://127.0.0.1:11434/v1`). On localhost, dev server uses `/ollama-proxy/v1` unless `VITE_FORCE_DIRECT_OLLAMA=1`. |
| `VITE_OVERVIEW_CHAT_MODEL` | build | no | Default chat model id (drawer outline/workspace fields override). |
| `VITE_OVERVIEW_OPENAI_COMPAT_KEY` | build | no | Optional bearer for endpoints that require `Authorization`. |
| `VITE_FORCE_DIRECT_OLLAMA` | build | no | When `1`, skip Vite’s `/ollama-proxy` and hit `VITE_OVERVIEW_CHAT_BASE` / bundled URL from the browser (CORS must allow). |
| `VITE_EXPOSE_WORKSPACE_API` | build | no | When `1`, always mount `window.__OVERVIEW_WORKSPACE__` and emit `overview-workspace-snapshot` on saves (production). Prefer the drawer opt-in for casual use. |
| `VITE_RELAY_HEXCAST_STREAM` | build | no | When `1`, ingest hex thumbnails also listen on `hexcast-stream` (mueee reference). Default: **`overview-live-hex`** + `window.__OVERVIEW_LIVE_HEX__` only. |
| `GITHUB_TOKEN` | Actions | when using `models-smoke.yml` | Server-side call to GitHub Models. **Never** in client bundle. |
| `GITHUB_MODELS_ENDPOINT` | Actions/scripts | no | Override default `https://models.github.ai/inference`. |
| `GH_MODELS_MODEL` | scripts | no | Model id for `scripts/gh-models-example.sh` (e.g. `openai/gpt-4o-mini`). |

API keys for any user-supplied OpenAI-compatible endpoint live in **`sessionStorage` only** (see `SnapshotAiConfig` — note that secrets are explicitly **not** persisted to the snapshot JSON).

`.env*` files are git-ignored. Do not commit secrets.

---

## 4. Workspace snapshot schema

Authoritative TypeScript: `src/research/workspace-snapshot.ts` (`OverviewWorkspaceSnapshot`, current `version = '2'`).

Hand-derived JSON Schema (Draft-07) for tools / RAG: [`schemas/overview-workspace-snapshot.schema.json`](./schemas/overview-workspace-snapshot.schema.json).

Round-trip surface:

- `serializeWorkspace(input)` → `OverviewWorkspaceSnapshot`
- `parseWorkspaceSnapshot(json)` / `parseWorkspaceSnapshotFromJsonText(raw)`
- Share link: `encodeWorkspaceShare(snap)` → `#workspace-share=<base64url>`; `decodeWorkspaceSharePayload(payload)` reverses it.

Snapshots are **bytes-free** by design: `attachments` carries metadata only, `aiConfig` excludes secrets.

---

## 5. AI integration hook

Default **`src/App.tsx`** passes **`createOllamaOnAiIterate()`** and **`createOllamaWorkspaceAssistant()`** from `src/ai/ollamaOpenAiIterate.ts` (local OpenAI-compatible **`/v1/chat/completions`**, usually Ollama). Defaults: `src/config/overview-iterate.manifest.json`. Session overrides: **Menu → AI linking** (`sessionStorage`, not in exported JSON).

When **`onAiIterate`** / **`onWorkspaceAssistant`** are **`undefined`** (e.g. build with **`VITE_USE_AI_STUB=1`**), `ResearchOverview` uses deterministic **stubs** so the UI works with no model. See `docs/agent/08-local-ollama.md` for Ollama install, **`npm run ollama:smoke`**, and CORS/proxy notes.

For a **custom** host, replace the `createOllama*` calls in `App.tsx` or wrap them.

```tsx
// Custom host sketch (optional)
const onAiIterate: ResearchOverviewProps['onAiIterate'] = async (req) => {
  // req.kind ∈ 'expand' | 'refine' | 'seed'
  // return { title?, body?, children? }
}
```

See `docs/agent/05-github-models.md` for a server-side GitHub Models pattern (tokens never in the bundle).

---

## 6. Share-hash hook

The app reads `window.location.hash` on mount; if it starts with `#workspace-share=` the payload is decoded with `decodeWorkspaceSharePayload`. To preload a workspace from an external tool (agent, browser extension), build the URL with `buildWorkspaceShareUrl(payload)`.

Constants you may want to import:

- `WORKSPACE_SHARE_HASH_KEY` (`workspace-share=`)
- `WORKSPACE_SHARE_HASH_PREFIX` (`#workspace-share=`)
- `MAX_WORKSPACE_SHARE_URL_CHARS` (`8000`)
- `MAX_IMPORT_BYTES` (`5 * 1024 * 1024`)

### Agent collaboration (programmatic)

External agents can **listen** and **merge** snapshots when the host surface is on: `window.__OVERVIEW_WORKSPACE__` (`getSnapshot` / `loadSnapshot` / `subscribe`) and the `overview-workspace-snapshot` window event. **Dev:** always on. **Production:** Menu → Actions → expose agent workspace API (session opt-in), or build with **`VITE_EXPOSE_WORKSPACE_API=1`**. See `docs/agent/09-agent-collaboration.md`.

---

## 7. Repo map for agents

```
.
├── AGENTS.md                       # you are here
├── config/agent-context.json       # machine-readable manifest of paths & scripts
├── docs/agent/                     # numbered, short docs (start at 01)
│   ├── 01-architecture.md
│   ├── 02-schemas.md
│   ├── 03-github-actions.md
│   ├── 04-theming.md
│   ├── 05-github-models.md
│   ├── 06-cursor-docs.md
│   ├── 07-ai-notes.md             # AI/agent quick reference (URLs + hooks)
│   ├── 08-local-ollama.md         # local Ollama / OpenAI-compatible + CLI smoke
│   ├── 09-agent-collaboration.md  # programmatic bridge + collaborative agent seat
│   └── 10-colab-evolution.md      # 1–8 colab roadmap + pragmatic checklist
├── schemas/
│   └── overview-workspace-snapshot.schema.json
├── scripts/
│   ├── gh-models-example.sh
│   └── ollama-smoke.mjs           # npm run ollama:smoke
├── src/                            # app source (see §1)
└── .github/workflows/              # ci, deploy-pages, optional models-smoke
```

---

## 8. Mirror / fork notes

- Canonical dev copy on this machine: `/Volumes/qbitOS/00.dev/ai/overview` (no embedded `.git` at time of writing).
- Intended remote: `https://github.com/fornevercollective/overview.git`.
- To mirror to `~/projects/overview`, run `rsync -a --exclude node_modules --exclude dist /Volumes/qbitOS/00.dev/ai/overview/ ~/projects/overview/` (the empty `.git` already there points at the right remote), then `git add -A && git commit -m "Initial commit"`.
- Forks: see `docs/agent/04-theming.md` for the CSS-variable theming surface.
