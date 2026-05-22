/// <reference types="vite/client" />

/** Web Speech API — not in all TS lib targets; used for one-shot mic.listen in Video feeds lab. */
interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  onresult: ((ev: SpeechRecognitionEvent) => void) | null
  onerror: ((ev: Event) => void) | null
}

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList
}

interface ImportMetaEnv {
  /** Optional dev-server proxy base for agent-style POSTs (must match endpoint origin when set). */
  readonly VITE_AGENT_BASE?: string
  /**
   * Optional same-origin path for link metadata (e.g. `/api/metadata`).
   * Server should accept `?url=` and return HTML or JSON with title/description fields.
   */
  readonly VITE_METADATA_PROXY?: string
  /**
   * Optional URL template for an ffmpeg/CDN HLS (or similar) stream for the dock’s current YouTube id.
   * Use `{id}` or `{videoId}` as placeholders (replaced with the 11-char id).
   */
  readonly VITE_FFMPEG_STREAM_URL_TEMPLATE?: string
  /**
   * When `"1"`, `App` omits `onAiIterate` / `onWorkspaceAssistant` so `ResearchOverview` uses built-in
   * deterministic stubs (no network). Default: call local OpenAI-compatible chat (see `08-local-ollama.md`).
   */
  readonly VITE_USE_AI_STUB?: string
  /** OpenAI-compatible API root (e.g. `http://127.0.0.1:11434/v1` for Ollama). On localhost, Vite proxies `/ollama-proxy/v1` instead unless `VITE_FORCE_DIRECT_OLLAMA=1`. */
  readonly VITE_OVERVIEW_CHAT_BASE?: string
  /** Default chat model id for outline + workspace assistant (drawer fields override). */
  readonly VITE_OVERVIEW_CHAT_MODEL?: string
  /** Optional `Authorization` bearer for endpoints that require it (Ollama usually does not). */
  readonly VITE_OVERVIEW_OPENAI_COMPAT_KEY?: string
  /** When `"1"`, skip same-origin `/ollama-proxy` and use `VITE_OVERVIEW_CHAT_BASE` / bundled URL directly (CORS must allow the browser). */
  readonly VITE_FORCE_DIRECT_OLLAMA?: string
  /**
   * When `"1"`, always mount `window.__OVERVIEW_WORKSPACE__` and dispatch `overview-workspace-snapshot`
   * on saves (even in production). Prefer the drawer opt-in for ad-hoc use; this is for agent-first deploys.
   */
  readonly VITE_EXPOSE_WORKSPACE_API?: string
  /**
   * When `"1"`, also subscribe to `BroadcastChannel('hexcast-stream')` for mueee hexcast reference builds.
   * Default ingest strip uses **`overview-live-hex`** only (document ↔ document / same-tab API).
   */
  readonly VITE_RELAY_HEXCAST_STREAM?: string
}
