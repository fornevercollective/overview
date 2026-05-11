# AGENTS.md — Overview

Single source of truth for **AI agents, MCP clients, RAG indexers, and human contributors** working on this repo. Read this first.

> If you also have a `README.md`, treat **AGENTS.md as authoritative** for agent / build / deploy context. The README is for casual visitors.

---

## 1. Project purpose

`overview` is a **single-page React + TypeScript + Vite app** for AI-assisted research notes. It renders an outlinable workspace (`ResearchOverview`), a printable `Summary` view, and a `Presentation` mode. State is held entirely in the browser; users export / share workspaces as JSON snapshots or compressed `#workspace-share=` URL fragments.

There is **no backend by default**. To call a model the host wires a single function (`onAiIterate`); see `src/App.tsx`. An offline stub is used until that prop is set.

Key entry points:

- `src/main.tsx` — Vite entry, mounts `<App />`.
- `src/App.tsx` — page router (`app | summary | presentation`); declares `onAiIterate` hook.
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

```tsx
// src/App.tsx
const onAiIterate: ResearchOverviewProps['onAiIterate'] = async (req) => {
  // req.kind ∈ 'expand' | 'refine' | 'seed'
  // Call your provider here; return { title?, body?, children? }
}
```

When `onAiIterate` is `undefined` the app uses a deterministic local stub so the UI is fully usable offline. See `docs/agent/05-github-models.md` for a server-side GitHub Models pattern.

---

## 6. Share-hash hook

The app reads `window.location.hash` on mount; if it starts with `#workspace-share=` the payload is decoded with `decodeWorkspaceSharePayload`. To preload a workspace from an external tool (agent, browser extension), build the URL with `buildWorkspaceShareUrl(payload)`.

Constants you may want to import:

- `WORKSPACE_SHARE_HASH_KEY` (`workspace-share=`)
- `WORKSPACE_SHARE_HASH_PREFIX` (`#workspace-share=`)
- `MAX_WORKSPACE_SHARE_URL_CHARS` (`8000`)
- `MAX_IMPORT_BYTES` (`5 * 1024 * 1024`)

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
│   └── 05-github-models.md
├── schemas/
│   └── overview-workspace-snapshot.schema.json
├── scripts/
│   └── gh-models-example.sh
├── src/                            # app source (see §1)
└── .github/workflows/              # ci, deploy-pages, optional models-smoke
```

---

## 8. Mirror / fork notes

- Canonical dev copy on this machine: `/Volumes/qbitOS/00.dev/ai/overview` (no embedded `.git` at time of writing).
- Intended remote: `https://github.com/fornevercollective/overview.git`.
- To mirror to `~/projects/overview`, run `rsync -a --exclude node_modules --exclude dist /Volumes/qbitOS/00.dev/ai/overview/ ~/projects/overview/` (the empty `.git` already there points at the right remote), then `git add -A && git commit -m "Initial commit"`.
- Forks: see `docs/agent/04-theming.md` for the CSS-variable theming surface.
