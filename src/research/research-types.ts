
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
  /**
   * Resolved paper scaffold genre for the tab (Auto = heuristic on prompt + workspace notes).
   * Hosts may use for stylistic hints on expand/refine; omit if unsupported.
   */
  paperGenre?: import('./paper-templates').PaperGenre
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
  /**
   * Resolved paper scaffold genre from the workspace UI (Auto uses heuristics).
   * Same literals as `PaperGenre` in `./paper-templates`. Hosts may ignore; the offline stub uses it when the root outline is empty.
   */
  paperGenre?: import('./paper-templates').PaperGenre
}

export type AiIterateRequest = AiIterateRequestExpandRefine | AiIterateRequestSeed

/** Partial merge applied after a successful AI iteration. */
export type AiIterateResult = {
  title?: string
  body?: string
  /** Appended after existing children when kind is `expand`. Replaces root children when kind is `seed`. */
  children?: ResearchSection[]
  /** Optional token accounting from the host model — footer shows stubs until provided. */
  usage?: { promptTokens?: number; completionTokens?: number }
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

/** Session-only workspace-notes assistant (`ResearchOverview` strip under shell context). */
export type WorkspaceAssistantRequest = {
  prompt: string
  /** Current workspace notes (`shellContext`) when the user sends a message. */
  notes: string
  /** Caret range in `notes` when the user invoked the assistant from a selection (e.g. Ctrl+Enter). */
  selection?: { start: number; end: number }
}

export type WorkspaceAssistantHandler = (req: WorkspaceAssistantRequest) => Promise<string>

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
export type {
  PaperGenre,
  PaperGenreMode,
  PaperGenreUiGroup,
  PaperSectionTemplate,
} from './paper-templates'
export {
  GENRE_LENS_LYRICS_LINGUISTICS_PILLARS,
  GENRE_STORY_FORMAT_CLI_SYNC_NOTE,
  PAPER_GENRE_SELECT_OPTIONS,
  PAPER_GENRE_UI_GROUPS,
  PAPER_GENRES,
  PAPER_GENRE_MODES,
  PAPER_TEMPLATES,
  detectPaperGenre,
  isPaperGenre,
  isPaperGenreMode,
  paperGenreIterateGuidance,
  paperGenreSeedGuidance,
  paperTemplateToSections,
} from './paper-templates'
export {
  MAX_ATTACHMENT_DATAURL_IMPORT_CHARS,
  MAX_IMPORT_BYTES,
  WORKSPACE_SNAPSHOT_VERSION,
  WorkspaceSnapshotParseError,
  parseWorkspaceSnapshot,
  parseWorkspaceSnapshotFromJsonText,
  serializeWorkspace,
} from './workspace-snapshot'
