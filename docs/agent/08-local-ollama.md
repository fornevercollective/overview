# 08 — Local offline models (Ollama / OpenAI-compatible)

The default `src/App.tsx` wires **`onAiIterate`** (outline seed / expand / refine) and **`onWorkspaceAssistant`** (workspace notes strip) to **`createOllamaOnAiIterate`** / **`createOllamaWorkspaceAssistant`** in `src/ai/ollamaOpenAiIterate.ts`.

That layer posts to **`/v1/chat/completions`** (OpenAI-compatible JSON). Defaults come from `src/config/overview-iterate.manifest.json` (`http://127.0.0.1:11434/v1`, model `llama3.1:8b`). Session overrides live in **Menu → AI linking** (`sessionStorage` key `overview-drawer-ai-config`: `baseUrl`, `modelName`, `outlineModel`, `workspaceModel`, optional `apiKey`).

## Ollama (recommended)

1. Install [Ollama](https://ollama.com/) and ensure **`ollama serve`** is running (usually automatic).
2. Pull a model that follows instructions reasonably well, e.g.  
   `ollama pull llama3.1:8b`  
   (or any tag you set in the drawer / `VITE_OVERVIEW_CHAT_MODEL`).
3. From the repo root, verify the HTTP API:  
   `npm run ollama:smoke`  
   Optional: `npm run ollama:smoke -- llama3.2:3b`
4. Run the app: **`npm run dev`** and open the printed `http://localhost:…` URL.
5. On **`localhost` / `127.0.0.1`**, the dev server proxies **`/ollama-proxy` → `http://127.0.0.1:11434`**, so the browser calls **same-origin** `/ollama-proxy/v1/chat/completions` and avoids CORS issues. See `vite.config.ts`.
6. Use **Expand (AI) / Refine (AI)** on sections, or **seed** from the hero topic line; use **Ctrl+Enter** (⌘ Enter) in workspace notes for the assistant.

If the model returns non-JSON for outline actions, the UI shows an error — the outline path expects a single JSON object (see system prompt in `ollamaOpenAiIterate.ts`).

## LM Studio / other local servers

Point **drawer → base URL** at your server’s OpenAI-compatible root (must include **`/v1`**), e.g. `http://127.0.0.1:1234/v1`. If the server does not send CORS headers for your dev origin, use a small proxy or run from an origin the server allows.

## Pure stub (no network)

Build or run with **`VITE_USE_AI_STUB=1`** so `App` passes **`undefined`** handlers and `ResearchOverview` uses its built-in deterministic stubs (expand/refine/seed + workspace assistant echo).

## CLI vs in-app

| Surface | Role |
|--------|------|
| **`npm run ollama:smoke`** | Confirms your machine reaches `/v1/chat/completions` outside the browser. |
| **This Cursor chat** | Design / code iteration; not wired into the SPA. |
| **In-app drawer AI + outline buttons** | Real iterative model when Ollama (or compatible) is up and `VITE_USE_AI_STUB` is not set. |

## Related

- `AGENTS.md` — env table for `VITE_OVERVIEW_*` and `VITE_USE_AI_STUB`.
- `docs/agent/05-github-models.md` — server-side / CI patterns (tokens not in the bundle).
