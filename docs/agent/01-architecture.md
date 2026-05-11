# 01 — Architecture

## TL;DR

`overview` is a **client-only React 19 + Vite** SPA. No server, no database. State lives in React + `localStorage`; users export `OverviewWorkspaceSnapshot` JSON or share via compressed URL hash.

## Component tree

```
<App>
 ├── <ResearchOverview>     # main workspace shell (outline, drawer, AI actions)
 │     ├── <ResearchMarkdownPreview>   # rehype-katex / rehype-highlight render
 │     └── <ExcalidrawLazy>            # lazy-loaded sketch surface
 ├── <Summary>              # printable / share-friendly view
 └── <Presentation>         # slide / overview projector mode
```

`App.tsx` keeps a `useRef<OverviewWorkspaceSnapshot | null>` of the last snapshot emitted by `onWorkspaceChange`, and forwards it to `Summary` via `getWorkspaceSnapshot()` so the Summary view never goes stale.

## Data flow

```
ResearchOverview
   ├── local state (sections, todos, prompts, drawer notes)
   ├── persists to localStorage
   ├── emits OverviewWorkspaceSnapshot via onWorkspaceChange
   └── on AI action -> onAiIterate(req) -> AiIterateResult (merge)
```

`AiIterateRequest` has three shapes (`expand | refine | seed`); the merge semantics are documented in `src/research/research-types.ts`.

## Storage layers

| Layer | Lives in | Survives reload | Notes |
|---|---|---|---|
| Workspace state | React | no | source of truth in memory |
| Cached workspace | `localStorage` | yes | rehydrated on mount |
| AI base URL / model | `localStorage` (via snapshot) | yes | secrets explicitly excluded |
| API keys | `sessionStorage` only | tab session | never written to snapshot JSON |
| Share link | URL hash | shared by user | gzip → lz-string → raw, whichever is shortest |

## Build pipeline

`npm run build` runs `tsc -b` (project references in `tsconfig.json` — `tsconfig.app.json` for `src/`, `tsconfig.node.json` for vite config), then `vite build`. Output: `dist/` (static assets only).

## Why no backend

The whole product is intentionally **portable**: a user can fork, deploy to GitHub Pages / Cloudflare Pages / anywhere, and wire any OpenAI-compatible endpoint they want — including GitHub Models from the host page **only if their key never reaches the bundle** (i.e. via a separate proxy). For most users the right pattern is a **server-side GitHub Action** that runs Models inference and posts results back to a snapshot — see `docs/agent/05-github-models.md`.
