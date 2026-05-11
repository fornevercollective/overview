# 06 — Cursor docs (reference)

Canonical reference for agents and contributors using Cursor against this repo:

- <https://cursor.com/docs>

Quick map of what lives there and how it interacts with this codebase.

## Why this page exists

This file is a stub so humans / RAG indexers can find the official Cursor docs from
inside the repo. There is **no scraping** here — fetch the URL above when you need a
specific section. Keep this file short.

## What you usually want from Cursor docs

- **Rules** (`AGENTS.md`, `.cursor/rules/*.md`) — how Cursor weaves project context into
  the agent prompt. Our root `AGENTS.md` is the authoritative entry point; the README is
  for casual visitors only.
- **Skills** (`~/.cursor/skills-cursor/<skill>/SKILL.md`) — reusable, opt-in playbooks the
  agent reads on demand. Workspace-installed skills appear in the system prompt.
- **MCP servers** — Cursor speaks the Model Context Protocol; tool descriptors live
  under `~/.cursor/projects/<project-id>/mcps/`. Read the tool's JSON descriptor
  **before** calling it via `CallMcpTool`.
- **SDK** (`@cursor/sdk`) — programmatic access for CI pipelines, GitHub Actions, and
  backend services. Useful if you ever wrap this app's `onAiIterate` hook in an automation.
- **Cloud agents / Bugbot** — for spawning headless background agents from PRs.

## Cross-references in this repo

- `AGENTS.md` — project-level entry; mirrors most of the build / lint / dev info.
- `docs/agent/01-architecture.md` — component map for the SPA.
- `docs/agent/05-github-models.md` — server-side AI call pattern compatible with the
  `onAiIterate` hook in `src/App.tsx`.

If a Cursor feature changes behavior we depend on (rules priority, skill activation,
MCP tool plumbing), capture the diff here so future agents do not have to re-discover it.
