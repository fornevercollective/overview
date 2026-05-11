/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional dev-server proxy base for agent-style POSTs (must match endpoint origin when set). */
  readonly VITE_AGENT_BASE?: string
  /**
   * Optional same-origin path for link metadata (e.g. `/api/metadata`).
   * Server should accept `?url=` and return HTML or JSON with title/description fields.
   */
  readonly VITE_METADATA_PROXY?: string
}
