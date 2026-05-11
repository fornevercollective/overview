# 02 — Schemas

## Source of truth

All wire/persistence types are declared in TypeScript:

- `src/research/workspace-snapshot.ts` — `OverviewWorkspaceSnapshot`, `OverviewWorkspaceTabSnapshot`, `SnapshotAiConfig`, `SnapshotFileAttachment`, plus the validating parser (`parseWorkspaceSnapshot`).
- `src/research/research-types.ts` — outline (`ResearchSection`), todos, AI request/response shapes.
- `src/research/youtube-ingest-types.ts` — optional ingest contract.

## JSON Schema

A hand-derived **Draft-07** schema is shipped for tools that cannot consume TS:

- [`schemas/overview-workspace-snapshot.schema.json`](../../schemas/overview-workspace-snapshot.schema.json)

It mirrors `OverviewWorkspaceSnapshot` at `WORKSPACE_SNAPSHOT_VERSION = '2'`. **When the TS shape changes, bump the version constant and regenerate the JSON Schema in the same PR.**

## Versioning rules

- `version` is a string; **bump on any breaking shape change**. Parsers must accept higher patch-style additions without failing.
- Backwards-compatible additions (new optional fields) do not need a version bump but should be documented in the schema's `description`.
- `parseWorkspaceSnapshot` throws `WorkspaceSnapshotParseError` with a `${path}: …` message — keep that contract; agents key off it.

## Limits

| Constant | Value | Meaning |
|---|---|---|
| `MAX_IMPORT_BYTES` | 5 MiB | hard cap for `parseWorkspaceSnapshotFromJsonText` |
| `MAX_ATTACHMENT_DATAURL_IMPORT_CHARS` | 512 KiB | per-attachment dataUrl ceiling |
| `MAX_WORKSPACE_SHARE_URL_CHARS` | 8000 | conservative URL length budget |

## Privacy contract

`serializeWorkspace` writes attachment **metadata only** (`id, name, size, type`) — never blob bytes. `aiConfig` writes `baseUrl` and `modelName` only — **never** API keys.
