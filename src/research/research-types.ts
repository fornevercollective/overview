export type ResearchSection = {
  id: string
  title: string
  body: string
  children: ResearchSection[]
}

export type AiIterateKind = 'expand' | 'refine' | 'seed'

export type AiIterateRequestExpandRefine = {
  kind: 'expand' | 'refine'
  section: ResearchSection
  /** Title trail from root to this section (for model context). */
  pathTitles: string[]
  /** Global scratchpad from the shell (ResearchOverview); optional for backends. */
  workspaceContext?: string
}

/** Generate or reshape the outline under the root article from a free-text prompt. */
export type AiIterateRequestSeed = {
  kind: 'seed'
  prompt: string
  /** Top-level document node (article) whose children are merged from the result. */
  rootSection: ResearchSection
  pathTitles: string[]
  /** Global scratchpad from the shell (ResearchOverview); optional for backends. */
  workspaceContext?: string
}

export type AiIterateRequest = AiIterateRequestExpandRefine | AiIterateRequestSeed

/** Partial merge applied after a successful AI iteration. */
export type AiIterateResult = {
  title?: string
  body?: string
  /** Appended after existing children when kind is `expand`. Replaces root children when kind is `seed`. */
  children?: ResearchSection[]
}

export type ResearchTodoStatus = 'pending' | 'in_progress' | 'done' | 'error'

export type ResearchTodo = {
  id: string
  label: string
  status: ResearchTodoStatus
  /** Which AI action created this row — seed | expand | refine */
  source?: string
}

/** Scope for URL ingest from the hero field (default `transcript`). */
export type IngestKind = 'transcript' | 'images' | 'notes'

/** Passed to `onTranscriptIngest` when the hero field looks like an HTTP(S) URL. */
export type TranscriptIngestRequest = {
  url: string
  tabId: string
  /** Omit or `transcript` for backward-compatible callers. */
  kind?: IngestKind
}

/** Optional wiring from `App` for transcript ingest and corpus search from the hero field. */
export type ResearchOverviewCorpusHandlers = {
  onTranscriptIngest?: (req: TranscriptIngestRequest) => void
  onCorpusSearch?: (query: string) => void
}

export type {
  OverviewWorkspaceSnapshot,
  OverviewWorkspaceTabSnapshot,
  SnapshotAiConfig,
  SnapshotFileAttachment,
} from './workspace-snapshot'
export {
  MAX_ATTACHMENT_DATAURL_IMPORT_CHARS,
  MAX_IMPORT_BYTES,
  WORKSPACE_SNAPSHOT_VERSION,
  WorkspaceSnapshotParseError,
  parseWorkspaceSnapshot,
  parseWorkspaceSnapshotFromJsonText,
  serializeWorkspace,
} from './workspace-snapshot'
