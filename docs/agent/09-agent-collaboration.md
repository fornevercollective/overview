# 09 — Agent collaboration (scaffold + hop on / off)

The workspace is a **browser-local document**. There is no multi-user sync server: collaboration with an AI or another tool means **the same tab** (or an extension with page access) **subscribes** to edits and **applies** validated snapshots when the model or script is ready.

## Scaffold (hand-off between tools)

- **JSON file** — Export / import via Menu → Actions (or `serializeWorkspace` / `parseWorkspaceSnapshot` in code).
- **Share URL** — `#workspace-share=` (see `workspace-share-link.ts` and `AGENTS.md` §6).
- **Outline AI** — `onAiIterate` / `onWorkspaceAssistant` in `App.tsx` for in-app expand / refine / seed and workspace-notes assistant.

Use these when an agent should **bootstrap** structure from nothing or move a workspace between machines without a live bridge.

## Live bridge (collaborative “seat”)

When the **workspace host surface** is active, the app mounts:

- **`window.__OVERVIEW_WORKSPACE__`** — type `OverviewWorkspaceDevApi` in `workspace-snapshot.ts`
  - **`getSnapshot()`** — current `OverviewWorkspaceSnapshot`
  - **`loadSnapshot(json, opts?)`** — parse and **replace** in-memory state (same validation as file import). Use **`{ source: 'agent' }`** so the hero shows *Collaborator merged workspace* instead of a generic import badge.
  - **`subscribe(listener)`** — called after each debounced save (~400 ms) with the latest snapshot; returns **unsubscribe** (hop off).

- **`window` `CustomEvent`** — name `overview-workspace-snapshot` (`OVERVIEW_WORKSPACE_SNAPSHOT_EVENT`).  
  **`event.detail`** — `{ snapshot: OverviewWorkspaceSnapshot }` (same type as `getSnapshot()`).

### When the surface is on

| Build | Behavior |
|-------|----------|
| **Dev** (`npm run dev`) | Always on: API + events after saves. |
| **Production** | **Menu → Actions →** “Expose agent workspace API (this tab)” stores `sessionStorage` key `overview-workspace-bridge` = `1` for this origin/tab session. |
| **Production (forced)** | Build with **`VITE_EXPOSE_WORKSPACE_API=1`** — always on (agent-first deploys). |

Turning the checkbox **off** removes the session key and **unmounts** the global — external scripts should treat that as the collaborator **leaving**.

## Minimal external loop (browser console)

```js
const api = window.__OVERVIEW_WORKSPACE__
if (!api) throw new Error('Host surface off — enable in Menu → Actions or use a dev build')

const off = api.subscribe((snap) => {
  console.log('workspace tick', snap.exportedAt, snap.tabs.length, 'tabs')
})

// Later: agent computes a new snapshot and applies it
// api.loadSnapshot(patched, { source: 'agent' })

// Hop off
off()
```

## Contracts and limits

- **Last writer wins** — `loadSnapshot` replaces the whole in-memory workspace (tabs, shell notes, drawer quick notes, attachment metadata). Merge at the file/JSON level before calling if you need surgical edits.
- **Size** — Respect `MAX_IMPORT_BYTES` and share-link caps (`AGENTS.md`).
- **Secrets** — Snapshots do not include API keys; the bridge does not bypass that.

## Related

- [`07-ai-notes.md`](./07-ai-notes.md) — hook table and URLs.
- [`02-schemas.md`](./02-schemas.md) — snapshot schema and privacy.
- [`10-colab-evolution.md`](./10-colab-evolution.md) — 1–8 colab roadmap + suggested repo changes.
