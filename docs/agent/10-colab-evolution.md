# 10 — Colab evolution (1–8) and suggested repo changes

This doc extends [`09-agent-collaboration.md`](./09-agent-collaboration.md): **where the product is today**, **what “FigJam / Docs / storm research” implies**, and **concrete evolution steps** without pretending the static SPA is already a multi-user CRDT engine.

---

## Current baseline (shipped)

- **Single-tab** truth; **JSON / share-hash** interchange; optional **`window.__OVERVIEW_WORKSPACE__`** + events when the host surface is on.
- **Outline AI** via `onAiIterate`; **no** `onTranscriptIngest` in default `App.tsx` (hero URL ingest is a **stub** unless you wire a pipeline).
- **YouTube**: dev server proxies **`/youtube-oembed-proxy`** for title/metadata (CORS); hero submit with a watch URL **auto-fills the topic line** when it was empty so **idle seed** can run; workspace-notes link hints use the same oEmbed path.

---

## 1 — Real-time sync model

| Today | Colab-style |
|-------|-------------|
| Full snapshot replace (`loadSnapshot`) | Incremental ops or **CRDT** (Yjs, Automerge, Loro) |

**Suggested changes:** Add a **sync library + wire protocol**; refactor outline mutations from “replace whole tree in React state” to **mergeable updates** or a CRDT-backed document.

---

## 2 — Transport + backend

| Today | Colab-style |
|-------|-------------|
| No server | **WebSocket** / WebRTC relay + **rooms** |

**Suggested changes:** Small **sync service** (auth, room id, message fan-out); `VITE_SYNC_URL` (or host-provided). Static Pages remains the **shell**; sync is a **separate deployable**.

---

## 3 — Presence + identity

| Today | Colab-style |
|-------|-------------|
| No cursors / avatars | **Who is editing what** |

**Suggested changes:** Ephemeral **presence channel** (not in workspace JSON); section-scoped focus; optional `lastEditedBy` on export if you want audit in snapshots.

---

## 4 — Conflict semantics

| Today | Colab-style |
|-------|-------------|
| Last writer wins | **Composable** concurrent edits |

**Suggested changes:** Tied to (1): OT or CRDT + rare **explicit conflict UI** for policy violations, not for every keystroke.

---

## 5 — Durable history + “evolving documents”

| Today | Colab-style |
|-------|-------------|
| Export / share slices | **Autosave**, **versions**, restore points |

**Suggested changes:** Server **event log or version blobs** per `workspaceId`; optional **canonical vs draft** layers for transcript-derived corpora (see product vision in chat / future schema fields).

---

## 6 — Permissions + sharing

| Today | Colab-style |
|-------|-------------|
| Share hash = whoever has URL | **Roles** (view / comment / edit), org policies |

**Suggested changes:** **JWT + room ACL**; keep share-hash for **offline handoff**, separate **live room** ids for collab.

---

## 7 — Performance + scale

| Today | Colab-style |
|-------|-------------|
| Debounced full serialize | **Incremental** sync + virtualization |

**Suggested changes:** subtree-level debounce; split hot path from heavy attachments metadata.

---

## 8 — Product surface (storm / research feel)

| Today | Colab-style |
|-------|-------------|
| Outline + notes + transcript **dock** | **Threads**, @mentions, timers, canvases |

**Suggested changes:** **Comment threads** keyed by `sectionId` (often easier than full body CRDT first); “storm” mode = **low-friction capture** lanes that flush into outline sections on a cadence.

---

## Near-term repo checklist (pragmatic)

1. **Wire `onTranscriptIngest` in `App.tsx`** when you have a backend that fetches captions / Whisper — until then, **oEmbed + topic seed** (implemented) unblocks “something happens” for YouTube URLs.
2. **`VITE_METADATA_PROXY`** for non-YouTube external link summaries in production.
3. **Schema**: optional `sourceLineage`, `revision`, `contentId` on snapshots when you add export for RAG/training pipelines.
4. **Collab MVP**: WebSocket **presence only** + **infrequent snapshot broadcast** (not full Docs co-typing) if you need multi-human awareness before CRDT.

---

## Related

- [`09-agent-collaboration.md`](./09-agent-collaboration.md) — programmatic bridge.
- [`07-ai-notes.md`](./07-ai-notes.md) — hooks table.
- [`02-schemas.md`](./02-schemas.md) — snapshot privacy and limits.
