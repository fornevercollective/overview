# 07 — AI notes (quick reference)

**Overview** is a client-only React + Vite workspace for AI-assisted research notes: an outline editor, a printable Summary, and a Presentation mode. This page orients **AI agents, MCP clients, and RAG indexers** in one pass; normative detail lives in [`AGENTS.md`](../../AGENTS.md) and the numbered docs below.

## Canonical URLs

- **Live site (GitHub Pages):** [https://fornevercollective.github.io/overview/](https://fornevercollective.github.io/overview/)
- **Source repository:** [https://github.com/fornevercollective/overview](https://github.com/fornevercollective/overview)

## Read order

1. [`AGENTS.md`](../../AGENTS.md) — build commands, env vars, hooks, limits, repo map.
2. [`01-architecture.md`](./01-architecture.md) — component tree and data flow.
3. [`02-schemas.md`](./02-schemas.md) — snapshot types, JSON Schema path, privacy contract.
4. [`05-github-models.md`](./05-github-models.md) — server-side inference pattern (tokens never in the bundle).
5. [`08-local-ollama.md`](./08-local-ollama.md) — default local `onAiIterate` / workspace assistant (Ollama, env, `npm run ollama:smoke`).
6. [`09-agent-collaboration.md`](./09-agent-collaboration.md) — programmatic workspace bridge (`__OVERVIEW_WORKSPACE__`, events, hop on/off).
7. [`10-colab-evolution.md`](./10-colab-evolution.md) — colab-style evolution (1–8) + pragmatic checklist (incl. YouTube hero seed).

Optional: [`03-github-actions.md`](./03-github-actions.md), [`04-theming.md`](./04-theming.md), [`06-cursor-docs.md`](./06-cursor-docs.md).

## What this app is (and is not)

| Is | Is not |
|----|--------|
| Outline + markdown + math + code highlighting in the browser | A Jupyter kernel or notebook executor |
| JSON / share-URL interchange for tooling | A hosted backend or multi-user sync service |
| **Default:** local Ollama-compatible `onAiIterate` + workspace assistant from `App.tsx` (or **stub** if `VITE_USE_AI_STUB=1` / handlers omitted) | A bundled API key or mandatory cloud provider |

## Stable interchange (for agents)

- **Type source:** `src/research/workspace-snapshot.ts` — `OverviewWorkspaceSnapshot`, current `WORKSPACE_SNAPSHOT_VERSION = '2'`.
- **JSON Schema (Draft-07):** `schemas/overview-workspace-snapshot.schema.json`.
- **Share URL:** `#workspace-share=<payload>` — encode/decode via `src/research/workspace-share-link.ts` (gzip when available, `lz-string` fallback).
- **Secrets:** API keys stay in `sessionStorage` only; they are **not** serialized into snapshots.

When generating or transforming snapshots, respect `MAX_IMPORT_BYTES`, attachment caps, and `MAX_WORKSPACE_SHARE_URL_CHARS` (documented in `AGENTS.md` and `02-schemas.md`).

## Integration hooks

| Hook | Location | Use |
|------|----------|-----|
| `onAiIterate` | `src/App.tsx` → `src/ai/ollamaOpenAiIterate.ts` | Default: local **`/v1/chat/completions`** (Ollama). Override in **Menu → AI linking** or replace in `App.tsx`. Stub when prop omitted (`VITE_USE_AI_STUB=1`). |
| Share hash | `workspace-share-link.ts` | Deep-link or hand off a workspace between tools. |
| `window.__OVERVIEW_WORKSPACE__` | `workspace-snapshot.ts` → `ResearchOverview` | **Dev:** always. **Prod:** Menu → Actions opt-in or `VITE_EXPOSE_WORKSPACE_API=1`. See [`09-agent-collaboration.md`](./09-agent-collaboration.md). |
| `overview-workspace-snapshot` | `window` `CustomEvent` | Same gate as `__OVERVIEW_WORKSPACE__`; detail `{ snapshot }` after debounced saves. |

Presentation mode may call a configured agent base when `VITE_AGENT_BASE` is set (see `src/Presentation.tsx` and the README feature table); keep agent endpoints out of user-exported JSON unless intentionally non-secret.

## Machine-readable manifest

[`config/agent-context.json`](../../config/agent-context.json) duplicates entrypoints, script names, schema paths, and hook symbols for tools that prefer JSON over Markdown.

## Suggested agent behavior

- Prefer **reading** `AGENTS.md` and `agent-context.json` before editing the tree.
- After changing `OverviewWorkspaceSnapshot` shape, bump `WORKSPACE_SNAPSHOT_VERSION` and update `schemas/overview-workspace-snapshot.schema.json` in the **same** change (see `02-schemas.md`).
- Do not suggest committing `.env*`, paste tokens into issues, or embed secrets in `VITE_*` vars.
