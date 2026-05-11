import type { IngestKind, ResearchSection, ResearchTodo, ResearchTodoStatus } from './research-types'

/** Current interchange revision; bump when the snapshot shape changes incompatibly. */
export const WORKSPACE_SNAPSHOT_VERSION = '2'

/**
 * Max length for an optional `dataUrl` on an imported attachment (guards JSON size).
 * Exports omit file bytes by default — see `serializeWorkspace` / attachment comments.
 */
export const MAX_ATTACHMENT_DATAURL_IMPORT_CHARS = 512 * 1024

/** Serialized drawer attachment: metadata always; file bytes are not embedded on export. */
export type SnapshotFileAttachment = {
  id: string
  name: string
  size: number
  type: string
  /** Present only when re-importing a snapshot that included it (exports skip blob embedding). */
  dataUrl?: string
}

/** Persisted AI shell settings (never includes secrets — API keys stay in sessionStorage only). */
export type SnapshotAiConfig = {
  baseUrl?: string
  modelName?: string
}

/** Reject imported JSON text larger than this (characters ≈ bytes for ASCII). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

const INGEST_KINDS: ReadonlySet<IngestKind> = new Set(['transcript', 'images', 'notes'])
const TODO_STATUSES: ReadonlySet<ResearchTodoStatus> = new Set([
  'pending',
  'in_progress',
  'done',
  'error',
])

export type OverviewWorkspaceTabSnapshot = {
  id: string
  sections: ResearchSection[]
  researchPrompt: string
  ingestQuery: string
  ingestKind?: IngestKind
  lastSeedPrompt: string
  todos: ResearchTodo[]
}

export type OverviewWorkspaceSnapshot = {
  version: string
  exportedAt: string
  shellContext: string
  activeTabId: string
  tabs: OverviewWorkspaceTabSnapshot[]
  /** Drawer-only scratchpad (distinct from shellContext). */
  drawerQuickNotes?: string
  aiConfig?: SnapshotAiConfig
  /** Metadata only on export — no embedded file bytes (see module comment). */
  attachments?: SnapshotFileAttachment[]
}

export class WorkspaceSnapshotParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceSnapshotParseError'
  }
}

export type OverviewWorkspaceDevApi = {
  getSnapshot: () => OverviewWorkspaceSnapshot
  /** Validates with `parseWorkspaceSnapshot` then replaces in-memory workspace state. */
  loadSnapshot: (snap: unknown) => OverviewWorkspaceSnapshot
  subscribe: (listener: (snap: OverviewWorkspaceSnapshot) => void) => () => void
}

function fail(message: string): never {
  throw new WorkspaceSnapshotParseError(message)
}

declare global {
  interface Window {
    __OVERVIEW_WORKSPACE__?: OverviewWorkspaceDevApi
  }
}

function isNonNullObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function expectString(path: string, value: unknown): string {
  if (typeof value !== 'string') fail(`${path}: expected string`)
  return value
}

function expectFiniteNumber(path: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${path}: expected finite number`)
  return value
}

function parseSection(path: string, value: unknown, depth: number): ResearchSection {
  if (depth > 64) fail(`${path}: outline nesting exceeds maximum depth (64)`)
  if (!isNonNullObject(value)) fail(`${path}: expected section object`)
  const id = expectString(`${path}.id`, value.id)
  const title = expectString(`${path}.title`, value.title)
  const body = expectString(`${path}.body`, value.body)
  if (!Array.isArray(value.children)) fail(`${path}.children: expected array`)
  const children = value.children.map((ch, i) => parseSection(`${path}.children[${i}]`, ch, depth + 1))
  return { id, title, body, children }
}

function parseIngestKind(path: string, value: unknown): IngestKind | undefined {
  if (value === undefined) return undefined
  const s = expectString(path, value)
  if (!INGEST_KINDS.has(s as IngestKind)) {
    fail(`${path}: invalid ingest kind (expected transcript | images | notes)`)
  }
  return s as IngestKind
}

function parseTodo(path: string, value: unknown): ResearchTodo {
  if (!isNonNullObject(value)) fail(`${path}: expected todo object`)
  const id = expectString(`${path}.id`, value.id)
  const label = expectString(`${path}.label`, value.label)
  const statusRaw = expectString(`${path}.status`, value.status)
  if (!TODO_STATUSES.has(statusRaw as ResearchTodoStatus)) {
    fail(`${path}.status: invalid status`)
  }
  const status = statusRaw as ResearchTodoStatus
  let source: string | undefined
  if (value.source !== undefined) {
    source = expectString(`${path}.source`, value.source)
  }
  return source !== undefined ? { id, label, status, source } : { id, label, status }
}

function parseAiConfig(path: string, value: unknown): SnapshotAiConfig | undefined {
  if (value === undefined) return undefined
  if (!isNonNullObject(value)) fail(`${path}: expected aiConfig object or omit`)
  let baseUrl: string | undefined
  let modelName: string | undefined
  if (value.baseUrl !== undefined) baseUrl = expectString(`${path}.baseUrl`, value.baseUrl).trim() || undefined
  if (value.modelName !== undefined) {
    modelName = expectString(`${path}.modelName`, value.modelName).trim() || undefined
  }
  if (baseUrl === undefined && modelName === undefined) return undefined
  const out: SnapshotAiConfig = {}
  if (baseUrl !== undefined) out.baseUrl = baseUrl
  if (modelName !== undefined) out.modelName = modelName
  return out
}

function parseSnapshotAttachment(path: string, value: unknown): SnapshotFileAttachment {
  if (!isNonNullObject(value)) fail(`${path}: expected attachment object`)
  const id = expectString(`${path}.id`, value.id).trim()
  if (!id) fail(`${path}.id: must be non-empty`)
  const name = expectString(`${path}.name`, value.name)
  const size = expectFiniteNumber(`${path}.size`, value.size)
  const type = expectString(`${path}.type`, value.type)
  let dataUrl: string | undefined
  if (value.dataUrl !== undefined) {
    dataUrl = expectString(`${path}.dataUrl`, value.dataUrl)
    if (dataUrl.length > MAX_ATTACHMENT_DATAURL_IMPORT_CHARS) {
      fail(`${path}.dataUrl: exceeds maximum length (${MAX_ATTACHMENT_DATAURL_IMPORT_CHARS})`)
    }
  }
  const row: SnapshotFileAttachment = { id, name, size, type }
  if (dataUrl !== undefined) row.dataUrl = dataUrl
  return row
}

function parseTab(path: string, value: unknown): OverviewWorkspaceTabSnapshot {
  if (!isNonNullObject(value)) fail(`${path}: expected tab object`)
  const id = expectString(`${path}.id`, value.id)
  const researchPrompt = expectString(`${path}.researchPrompt`, value.researchPrompt)
  const ingestQuery = expectString(`${path}.ingestQuery`, value.ingestQuery)
  const lastSeedPrompt = expectString(`${path}.lastSeedPrompt`, value.lastSeedPrompt)
  const ingestKind = parseIngestKind(`${path}.ingestKind`, value.ingestKind)
  if (!Array.isArray(value.sections)) fail(`${path}.sections: expected array`)
  const sections = value.sections.map((s, i) => parseSection(`${path}.sections[${i}]`, s, 0))
  if (!Array.isArray(value.todos)) fail(`${path}.todos: expected array`)
  const todos = value.todos.map((t, i) => parseTodo(`${path}.todos[${i}]`, t))
  const tab: OverviewWorkspaceTabSnapshot = {
    id,
    sections,
    researchPrompt,
    ingestQuery,
    lastSeedPrompt,
    todos,
  }
  if (ingestKind !== undefined) tab.ingestKind = ingestKind
  return tab
}

/**
 * Validates and returns a typed workspace snapshot. Throws `WorkspaceSnapshotParseError` with a clear message on failure.
 */
export function parseWorkspaceSnapshot(json: unknown): OverviewWorkspaceSnapshot {
  if (!isNonNullObject(json)) fail('Root value must be a JSON object')
  const version = expectString('version', json.version).trim()
  if (!version) fail('version must be a non-empty string')
  const exportedAt = expectString('exportedAt', json.exportedAt).trim()
  if (!exportedAt) fail('exportedAt must be a non-empty ISO-like string')
  const shellContext = expectString('shellContext', json.shellContext)
  const activeTabId = expectString('activeTabId', json.activeTabId).trim()
  if (!activeTabId) fail('activeTabId must be non-empty')
  if (!Array.isArray(json.tabs)) fail('tabs must be an array')
  if (json.tabs.length === 0) fail('tabs must contain at least one tab')
  const tabs = json.tabs.map((t, i) => parseTab(`tabs[${i}]`, t))
  const ids = new Set(tabs.map((t) => t.id))
  if (ids.size !== tabs.length) fail('tabs must have unique ids')
  if (!tabs.some((t) => t.id === activeTabId)) {
    fail('activeTabId must match one of tabs[].id')
  }
  let drawerQuickNotes = ''
  if (json.drawerQuickNotes !== undefined) {
    drawerQuickNotes = expectString('drawerQuickNotes', json.drawerQuickNotes)
  }
  const aiConfig = parseAiConfig('aiConfig', json.aiConfig)
  let attachments: SnapshotFileAttachment[] = []
  if (json.attachments !== undefined) {
    if (!Array.isArray(json.attachments)) fail('attachments must be an array')
    attachments = json.attachments.map((a, i) => parseSnapshotAttachment(`attachments[${i}]`, a))
  }
  const snap: OverviewWorkspaceSnapshot = {
    version,
    exportedAt,
    shellContext,
    activeTabId,
    tabs,
    drawerQuickNotes,
    attachments,
  }
  if (aiConfig !== undefined) snap.aiConfig = aiConfig
  return snap
}

export type SerializeWorkspaceInput = {
  tabs: readonly OverviewWorkspaceTabSnapshot[]
  activeTabId: string
  shellContext: string
  drawerQuickNotes?: string
  aiConfig?: SnapshotAiConfig
  /**
   * Live drawer attachments: only id/name/size/type are written — never embed File/blob bytes
   * (would bloat JSON); round-trip file content is not preserved unless a future path adds capped dataUrl.
   */
  attachments?: readonly SnapshotFileAttachment[]
}

/** Builds a snapshot object with `exportedAt` set to now (UTC ISO). */
export function serializeWorkspace(input: SerializeWorkspaceInput): OverviewWorkspaceSnapshot {
  const drawerQuickNotes = input.drawerQuickNotes ?? ''
  const attachmentsMeta: SnapshotFileAttachment[] = (input.attachments ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    size: a.size,
    type: a.type,
  }))
  const snap: OverviewWorkspaceSnapshot = {
    version: WORKSPACE_SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    shellContext: input.shellContext,
    activeTabId: input.activeTabId,
    tabs: input.tabs.map((t) => ({
      id: t.id,
      sections: t.sections,
      researchPrompt: t.researchPrompt,
      ingestQuery: t.ingestQuery,
      ingestKind: t.ingestKind,
      lastSeedPrompt: t.lastSeedPrompt,
      todos: t.todos,
    })),
    drawerQuickNotes,
    attachments: attachmentsMeta,
  }
  const ai = input.aiConfig
  if (ai !== undefined && (ai.baseUrl !== undefined || ai.modelName !== undefined)) {
    const cfg: SnapshotAiConfig = {}
    if (ai.baseUrl !== undefined && ai.baseUrl.trim()) cfg.baseUrl = ai.baseUrl.trim()
    if (ai.modelName !== undefined && ai.modelName.trim()) cfg.modelName = ai.modelName.trim()
    if (cfg.baseUrl !== undefined || cfg.modelName !== undefined) snap.aiConfig = cfg
  }
  return snap
}

/**
 * Parse JSON text from a file or wire: enforces size limit before `JSON.parse`.
 */
export function parseWorkspaceSnapshotFromJsonText(raw: string): OverviewWorkspaceSnapshot {
  if (raw.length > MAX_IMPORT_BYTES) {
    fail(`Import exceeds maximum size (${MAX_IMPORT_BYTES} bytes)`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    fail('Invalid JSON')
  }
  return parseWorkspaceSnapshot(parsed)
}
