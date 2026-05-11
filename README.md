<img width="1284" height="977" alt="Screenshot 2026-05-10 at 11 05 03 PM" src="https://github.com/user-attachments/assets/bdb6a8c6-c098-46c4-a24d-4f996ba73564" />

# Overview

Single-page **React + TypeScript + Vite** workspace for AI-assisted research notes: an outlinable editor, printable **Summary**, and a **Presentation** “reading room” with slide splits and optional whiteboard. State stays in the browser; interchange is **JSON snapshots** and compressed **`#workspace-share=`** URL fragments.

**Agent and build details:** see [`AGENTS.md`](./AGENTS.md) (authoritative for automation, env vars, and schema paths).

## Quick start

```bash
npm ci
npm run dev
npm run lint
npm run build   # tsc -b && vite build -> dist/
npm run preview
```

Requires **Node LTS (≥ 20)** and npm 10+.

---

## Context window

This section captures **product intent and shipped reality** for contributors and downstream tooling (forks, GitHub Actions, MCP/RAG packagers). It is not a marketing page.

### Aspirations vs. notebooks

The UI borrows familiar ideas from **Jupyter / Colab-style** workflows—tabs, ingest fields, markdown with math, and a place to hang automation—but there is **no hosted kernel or cell execution**. The research surface is an **outline of sections** with optional `onAiIterate` wiring (`expand` / `refine` / `seed`); until a host provides that callback, a **local stub** keeps the app fully usable offline. A **real Jupyter bridge** would be a separate integration (not shipped); treating that as explicit scope avoids confusion with the current static SPA.

### Presentation mode and Pretext-adjacent goals

**Presentation** (`src/Presentation.tsx`) is a long-form “projector” view: markdown-ish **deck text** split on `---` or `^^^`, optional embeds with host allowlists, audio, typing-practice excerpts, and an **`ExcalidrawLazyPanel`** (`src/presentation/ExcalidrawLazy.tsx`) that **lazy-loads** `@excalidraw/excalidraw` so the main bundle stays smaller. Copy in the default deck clarifies that **typography/layout are in-repo** and not copied from external Pretext demos—useful when aligning with **Pretext / publication** ecosystems without claiming compatibility.

### GitHub stack: Actions, Models, agents, MCP/RAG

The app is designed so **forks** can deploy to static hosting and optionally add:

- **GitHub Actions** for CI and (on the canonical remote) Pages deploy—see `AGENTS.md` for the intended workflow names; this checkout may omit `.github/` if it is a partial mirror.
- **GitHub Models** for inference **server-side** or behind a proxy so secrets never enter the client bundle. Product documentation: [GitHub Models](https://docs.github.com/en/github-models).
- **AI agents / MCP / RAG**: workspace JSON (`OverviewWorkspaceSnapshot`, version `2`) and the share URL codec are meant to be **stable interchange** for tools that index, transform, or publish notes—see `schemas/overview-workspace-snapshot.schema.json` and `docs/agent/02-schemas.md`.

### Offline, fork, and theming

The default experience is **client-only**: `localStorage` rehydration, **session-only API keys** in `sessionStorage` (never in exported JSON), and **CSS variables** plus `prefers-color-scheme` for **dark mode** (`src/index.css`, `src/research/research.css`). Forks can retheme via the CSS variable surface (see `AGENTS.md` / `docs/agent/` where present).

### Workspace interchange and drawer tooling

- **JSON**: export/import of `OverviewWorkspaceSnapshot` with size guards (`MAX_IMPORT_BYTES`, attachment limits in `src/research/workspace-snapshot.ts`).
- **Share URL**: `src/research/workspace-share-link.ts` encodes with **gzip** when available, **`lz-string` fallback**, and picks the smallest representation; decodes on load from `#workspace-share=`.
- **Drawer** (`ResearchOverview.tsx`): file attachments (metadata on export), AI endpoint fields (non-secret config only in snapshots), quick notes, and Images / Stream / Chat **stub** panels.
- **Hooks**: debounced `onWorkspaceChange`, optional dev global `window.__OVERVIEW_WORKSPACE__` (see `AGENTS.md`).

### Markdown, math, and layout

Section bodies use **react-markdown** with **remark-math**, **rehype-katex**, **rehype-highlight**, and **highlight.js** (`src/research/ResearchMarkdownPreview.tsx`). Layout includes **responsive** rules and **full-bleed** app chrome under `#root` for smaller viewports (see comments in `src/research/research.css`).

### Summary page

**Summary** (`src/Summary.tsx`) is a lightweight, print-friendly overview that lists shipped features and can copy a share link from the latest debounced snapshot.

### Effort and maintainer time

**Total engineer time is not instrumented.** Reported effort would be, at best, **≈ cumulative agent-assisted sessions (not tracked)**. Maintainers may document a manual estimate by defining a placeholder such as `MAINTAINER_TIME_HOURS` elsewhere; **do not treat any hour figure in this repo as measured unless explicitly labeled by a maintainer.**

### Current iteration (shipped in this tree)

| Area | What exists today |
|------|-------------------|
| Routing | `App.tsx`: `app` \| `summary` \| `presentation` |
| Workspace | Multi-tab outline, todos, shell context strip, ingest query/kind, AI actions (stub or wired) |
| Persistence | `localStorage` + import/export; share hash on load |
| Snapshot | `WORKSPACE_SNAPSHOT_VERSION = '2'` |
| Presentation | Slide splits, embeds, audio, typing section, agent fetch guard (`VITE_AGENT_BASE`), lazy Excalidraw |
| Docs | `AGENTS.md`, `docs/agent/01-architecture.md`, `docs/agent/02-schemas.md`, JSON Schema under `schemas/` |
| CI (intended) | Described in `AGENTS.md` (`ci.yml`, `deploy-pages.yml`); **not present in every checkout** |

### Code stack

| Layer | Packages / notes |
|-------|------------------|
| Bundler | `vite`, `@vitejs/plugin-react` |
| UI | `react`, `react-dom` |
| Language | `typescript`, ESLint (`typescript-eslint`, React hooks plugins) |
| Markdown / math | `react-markdown`, `remark-math`, `rehype-katex`, `katex` |
| Code highlighting | `rehype-highlight`, `highlight.js` |
| Share compression | `lz-string` (+ Web **CompressionStream** gzip when available) |
| Whiteboard (optional chunk) | `@excalidraw/excalidraw` loaded via `React.lazy` in Presentation |

### Layers of potential improvement

1. **Publication pipeline** — JATS, LaTeX, or static site export from `OverviewWorkspaceSnapshot`.
2. **Citations** — bibliography / citation manager linked to section bodies or attachments.
3. **Jupyter / kernel bridge** — explicit **non-goal** for the core SPA unless added as a separate service; keep the “no execution” boundary clear.
4. **GitHub Models** — first-class example of **server-side** or proxied inference (see link under *GitHub stack* above); never ship tokens in `VITE_*`.
5. **Code splitting** — further split Presentation-only routes if bundle analysis shows wins (Excalidraw is already lazy).
6. **E2E tests** — Playwright (or similar) for share-link round-trip and critical outline flows.
7. **Bundle budget** — enforce max chunk size in CI once baselines exist.
8. **RAG over attachments** — index attachment metadata or sidecar text in external tooling; snapshots stay bytes-free by design.
9. **Voice UI** — accessibility and dictation layers on top of the outline editor.
10. **Stream panel** — replace drawer placeholder with real media primitives where product needs them.

### Metrics

- **Build output**: run `npm run build` and inspect **Vite chunk size warnings** and the `dist/` layout. **Do not cite fabricated KB or Lighthouse scores** in issues or docs.
- **Lint**: `npm run lint` (ESLint across the tree).
- **CI badges (placeholder)** — after the repo URL is finalized, replace `OWNER` and `REPO`:

  `[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions)`

---

## License / remote

Intended upstream: `https://github.com/fornevercollective/overview.git` (see `AGENTS.md` for mirror notes). This README was updated in the workspace that contains this file next to `package.json`.
