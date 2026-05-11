/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional dev-server proxy base for agent-style POSTs (must match endpoint origin when set). */
  readonly VITE_AGENT_BASE?: string
}
