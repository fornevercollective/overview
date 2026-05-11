import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import type {
  AiIterateRequest,
  AiIterateResult,
  IngestKind,
  ResearchOverviewCorpusHandlers,
  ResearchSection,
  ResearchTodo,
  TranscriptIngestRequest,
  WorkspaceAssistantHandler,
  WorkspaceAssistantRequest,
} from './research-types'
import type {
  OverviewWorkspaceDevApi,
  OverviewWorkspaceSnapshot,
  SnapshotAiConfig,
  SnapshotFileAttachment,
} from './workspace-snapshot'
import {
  parseWorkspaceSnapshot,
  parseWorkspaceSnapshotFromJsonText,
  serializeWorkspace,
} from './workspace-snapshot'
import {
  WORKSPACE_SHARE_HASH_PREFIX,
  copyShareUrlToClipboard,
  decodeWorkspaceSharePayload,
  encodeWorkspaceShare,
} from './workspace-share-link'
import {
  addChild,
  collectPathTitles,
  findSection,
  flattenOutline,
  mapSection,
  newSection,
  paperTemplateToSections,
  removeSection,
} from './research-tree'
import {
  PAPER_TEMPLATES,
  detectPaperGenre,
  type PaperGenre,
  type PaperGenreMode,
} from './paper-templates'
import ResearchMarkdownPreview from './ResearchMarkdownPreview'
import ThemeSplitPreview from './ThemeSplitPreview'
import { ExcalidrawLazyPanel } from '../presentation/ExcalidrawLazy'
import './research.css'

type ResearchPageTab = {
  id: string
  sections: ResearchSection[]
  researchPrompt: string
  /** Hero field: playlist/video URL or corpus search text (per tab). */
  ingestQuery: string
  /** URL ingest scope when the field is an HTTP(S) URL. */
  ingestKind?: IngestKind
  /** Last prompt that successfully ran seed (idle/blur dedupe). */
  lastSeedPrompt: string
  todos: ResearchTodo[]
  /** Paper scaffold selector; `auto` uses keyword heuristics on prompt + workspace notes. */
  paperGenreMode: PaperGenreMode
}

function createTab(sections: ResearchSection[]): ResearchPageTab {
  return {
    id: crypto.randomUUID(),
    sections,
    researchPrompt: '',
    ingestQuery: '',
    ingestKind: 'transcript',
    lastSeedPrompt: '',
    todos: [],
    paperGenreMode: 'auto',
  }
}

function mergeReplacingSeed(prev: ResearchTodo[], seedBatch: ResearchTodo[]): ResearchTodo[] {
  return [...prev.filter((t) => t.source !== 'seed'), ...seedBatch]
}

/** Derives seed-phase checklist from the outline shape the seed pass will apply. */
function buildSeedTodos(seedPreviewRoots: ResearchSection[]): ResearchTodo[] {
  const flatCount = flattenOutline(seedPreviewRoots).length

  return [
    {
      id: crypto.randomUUID(),
      label: 'Outline structure',
      status: 'in_progress',
      source: 'seed',
    },
    {
      id: crypto.randomUUID(),
      label: `Fill sections (${flatCount} blocks)`,
      status: 'pending',
      source: 'seed',
    },
    ...seedPreviewRoots.map((s) => ({
      id: crypto.randomUUID(),
      label: `Frame: ${s.title}`,
      status: 'pending' as const,
      source: 'seed',
    })),
  ]
}

function markSeedTodosDone(todos: ResearchTodo[]): ResearchTodo[] {
  return todos.map((t) => (t.source === 'seed' ? { ...t, status: 'done' as const } : t))
}

function markSeedTodosError(todos: ResearchTodo[]): ResearchTodo[] {
  let hit = false
  return todos.map((t) => {
    if (t.source !== 'seed') return t
    if (!hit && t.status === 'in_progress') {
      hit = true
      return { ...t, status: 'error' as const }
    }
    return t
  })
}

function resetSeedTodosPending(todos: ResearchTodo[]): ResearchTodo[] {
  return todos.map((t) => (t.source === 'seed' ? { ...t, status: 'pending' as const } : t))
}

function emptyOutlineRoot(): ResearchSection[] {
  return [newSection({ title: 'Untitled research', body: '', children: [] })]
}

function tabLabel(tab: ResearchPageTab): string {
  const t = tab.sections[0]?.title?.trim()
  return t || 'Untitled research'
}

const initialDocument: ResearchSection[] = [
  newSection({
    title: 'Untitled research',
    body: 'Start from the outline or add sections here. Use AI actions to stub-expand or refine (wire `onAiIterate` to your backend).',
    children: [
      newSection({
        title: 'Context',
        body: 'What problem, scope, and constraints matter for this pass?',
        children: [],
      }),
      newSection({
        title: 'Findings',
        body: '',
        children: [
          newSection({
            title: 'Primary sources',
            body: '',
            children: [],
          }),
        ],
      }),
    ],
  }),
]

function stubSeedOutline(topic: string): ResearchSection[] {
  const words = topic.split(/\s+/).filter((w) => w.length > 1).slice(0, 5)
  const chip = words[0] ?? topic
  return [
    newSection({
      title: 'Framing',
      body: `What “${topic}” should cover in this pass (offline stub).`,
      children: [
        newSection({
          title: 'Goals & audience',
          body: 'Decision-grade outputs, readers, and stop conditions.',
          children: [],
        }),
      ],
    }),
    newSection({
      title: `Signals around ${chip}`,
      body: 'Cues that raise or lower confidence in the narrative.',
      children: [
        newSection({ title: 'Primary metrics', body: '', children: [] }),
        newSection({ title: 'Confounders', body: '', children: [] }),
      ],
    }),
    newSection({
      title: 'Synthesis',
      body: 'Contradictions, gaps, and a concise take before human edits.',
      children: [
        newSection({
          title: 'Open questions',
          body: 'What still needs validation or sourcing?',
          children: [],
        }),
      ],
    }),
  ]
}

/** First-line context for stub output; mirrors what backends may prepend to prompts. */
function stubWorkspaceSnippet(workspaceContext: string | undefined): string {
  const t = (workspaceContext ?? '').trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatWallClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** Session elapsed; uses `HH:MM:SS` when ≥1h, else `mm:ss`. */
function formatSessionElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`
  return `${pad2(m)}:${pad2(sec)}`
}

function roughTokenEstimate(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4))
}

function collectOutlineTexts(nodes: ResearchSection[]): string[] {
  const out: string[] = []
  const walk = (secs: ResearchSection[]) => {
    for (const sec of secs) {
      out.push(sec.title, sec.body)
      if (sec.children.length) walk(sec.children)
    }
  }
  walk(nodes)
  return out
}

function countWordsAndSpaces(blob: string): { words: number; spaces: number } {
  const spaces = blob.split('').filter((c) => c === ' ').length
  const trimmed = blob.trim()
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0
  return { words, spaces }
}

async function stubAiIterate(req: AiIterateRequest): Promise<AiIterateResult> {
  await new Promise((r) => setTimeout(r, 380))
  const ws = stubWorkspaceSnippet(req.workspaceContext)
  if (req.kind === 'seed') {
    const label = req.prompt.trim() || 'Research focus'
    const title = label.length > 88 ? `${label.slice(0, 85)}…` : label
    const defaultBody = ws
      ? `Local stub outline for “${label}”. Workspace notes: ${ws} — pass onAiIterate to synthesize from your stack.`
      : `Local stub outline for “${label}”. Pass onAiIterate to synthesize from your stack.`
    const genre: PaperGenre = req.paperGenre ?? 'general'
    const usePaperTemplate = req.rootSection.children.length === 0
    const children = usePaperTemplate
      ? paperTemplateToSections(PAPER_TEMPLATES[genre])
      : stubSeedOutline(label)
    const bodyOut = req.rootSection.body.trim() || defaultBody
    const completionBlob = `${title}\n${bodyOut}\n${JSON.stringify(children)}`
    return {
      title,
      body: bodyOut,
      children,
      usage: {
        promptTokens: roughTokenEstimate(`${req.prompt}\n${ws}`),
        completionTokens: roughTokenEstimate(completionBlob),
      },
    }
  }
  if (req.kind === 'expand') {
    const body = ws
      ? `Stub expansion (context: ${ws}) — replace \`stubAiIterate\` or pass \`onAiIterate\` to call your model.`
      : 'Stub expansion — replace `stubAiIterate` or pass `onAiIterate` to call your model.'
    const completionBlob = `${req.section.title}\n${body}`
    return {
      children: [
        newSection({
          title: `Sub-point under “${req.section.title.trim() || 'Untitled'}”`,
          body,
          children: [],
        }),
      ],
      usage: {
        promptTokens: roughTokenEstimate(`${req.section.title}\n${req.section.body}\n${ws}`),
        completionTokens: roughTokenEstimate(completionBlob),
      },
    }
  }
  const base = req.section.body.trim()
  const suffix = ws
    ? `\n\n— Refined (local stub); workspace: ${ws}. Connect \`onAiIterate\` to stream real edits.`
    : '\n\n— Refined (local stub). Connect `onAiIterate` to stream real edits.'
  const nextBody = base ? `${base}${suffix}` : suffix.trim()
  return {
    body: nextBody,
    usage: {
      promptTokens: roughTokenEstimate(`${req.section.title}\n${req.section.body}\n${ws}`),
      completionTokens: roughTokenEstimate(nextBody),
    },
  }
}

function looksLikeHttpUrl(raw: string): boolean {
  const s = raw.trim()
  if (!s) return false
  return /^https?:\/\//i.test(s)
}

const WORKSPACE_ASSISTANT_ACCEPT_DELIM = '\n\n---\n'

function isSameOriginHttpUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.href)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return u.origin === window.location.origin
  } catch {
    return false
  }
}

function extractHtmlMetadata(html: string): { title?: string; description?: string; siteName?: string } {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()
    const twTitle = doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')?.trim()
    const title = ogTitle || twTitle || doc.querySelector('title')?.textContent?.trim()

    const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim()
    const twDesc = doc.querySelector('meta[name="twitter:description"]')?.getAttribute('content')?.trim()
    const metaDesc = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim()
    const description = ogDesc || twDesc || metaDesc

    const siteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim()

    return { title, description, siteName }
  } catch {
    return {}
  }
}

function tryParseMetadataJson(text: string): { title?: string; description?: string; siteName?: string } | null {
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const pick = (k: string) => (typeof j[k] === 'string' ? (j[k] as string).trim() : undefined)
    const title = pick('title') || pick('og_title') || pick('ogTitle')
    const description = pick('description') || pick('og_description') || pick('ogDescription')
    const siteName = pick('site_name') || pick('siteName') || pick('og_site_name')
    if (title || description || siteName) return { title, description, siteName }
  } catch {
    /* ignore */
  }
  return null
}

function formatMetadataSentence(
  host: string,
  meta: { title?: string; description?: string; siteName?: string },
): string {
  const site = meta.siteName || host
  const title = meta.title?.trim() || 'Untitled page'
  const raw = meta.description?.replace(/\s+/g, ' ').trim() ?? ''
  const desc =
    raw.length > 140 ? `${raw.slice(0, 137).trimEnd()}…` : raw || 'No description in metadata.'
  return `${title} — ${site} — ${desc}`
}

async function fetchTextResponse(url: string): Promise<{ text: string; contentType: string } | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res.ok) return null
    const text = await res.text()
    const contentType = res.headers.get('content-type') ?? ''
    return { text, contentType }
  } catch {
    return null
  }
}

function metadataFromFetchedPayload(text: string, contentType: string): { title?: string; description?: string; siteName?: string } | null {
  const tryJson = contentType.includes('application/json') || /^\s*\{/.test(text)
  if (tryJson) {
    const j = tryParseMetadataJson(text)
    if (j) return j
  }
  const htmlMeta = extractHtmlMetadata(text)
  if (htmlMeta.title || htmlMeta.description || htmlMeta.siteName) return htmlMeta
  return null
}

/**
 * Best-effort one-line metadata for a link pasted into workspace notes.
 * - Same-origin `http(s)` only: `fetch(url)` and parse HTML / JSON.
 * - Otherwise: optional `import.meta.env.VITE_METADATA_PROXY` same-origin `?url=` fetch.
 * - Else stub (no arbitrary cross-origin HTML in the browser).
 */
async function summarizeUrlMetadata(url: string): Promise<string> {
  let host = url
  try {
    const u = new URL(url, window.location.href)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return `External link (cannot fetch metadata client-side): ${host} — paste OpenGraph manually.`
    }
    host = u.hostname || host
  } catch {
    return `External link (cannot fetch metadata client-side): ${url} — paste OpenGraph manually.`
  }

  const stub = () =>
    `External link (cannot fetch metadata client-side): ${host} — paste OpenGraph manually.`

  if (isSameOriginHttpUrl(url)) {
    const got = await fetchTextResponse(url)
    if (!got) return stub()
    const meta = metadataFromFetchedPayload(got.text, got.contentType)
    if (meta) return formatMetadataSentence(host, meta)
    return `Same-origin page at ${host} — fetched but no title or OpenGraph description was found.`
  }

  const proxyEnv = import.meta.env.VITE_METADATA_PROXY?.trim()
  if (proxyEnv) {
    const path = proxyEnv.startsWith('/') ? proxyEnv : `/${proxyEnv}`
    const joiner = path.includes('?') ? '&' : '?'
    const proxyUrl = `${path}${joiner}url=${encodeURIComponent(url)}`
    const got = await fetchTextResponse(proxyUrl)
    if (!got) return stub()
    const meta = metadataFromFetchedPayload(got.text, got.contentType)
    if (meta) return formatMetadataSentence(host, meta)
  }

  return stub()
}

async function stubWorkspaceAssistant(req: WorkspaceAssistantRequest): Promise<string> {
  await new Promise((r) => setTimeout(r, 300))
  const q = req.prompt.trim() || '(empty prompt)'
  const n = req.notes.trim().replace(/\s+/g, ' ')
  const nclip = n ? (n.length > 120 ? `${n.slice(0, 117)}…` : n) : '∅'
  const sel =
    req.selection && req.selection.start !== req.selection.end
      ? ` — selection chars ${req.selection.start}–${req.selection.end}`
      : ''
  return `Offline stub: “${q}” — notes context: ${nclip}${sel}. Pass onWorkspaceAssistant (or bridge your model from App) for real answers.`
}

function buildWorkspaceAssistantRequestFromNotes(
  notes: string,
  caret: { start: number; end: number },
): WorkspaceAssistantRequest | null {
  const lo = Math.min(caret.start, caret.end)
  const hi = Math.max(caret.start, caret.end)
  const slice = notes.slice(lo, hi)
  const tNotes = notes.trim()
  if (!tNotes) return null
  if (hi > lo) {
    const tSlice = slice.trim()
    if (tSlice.length > 0) {
      return { prompt: tSlice, notes, selection: { start: lo, end: hi } }
    }
  }
  return { prompt: tNotes, notes }
}

function formatUserBubbleForAssistant(req: WorkspaceAssistantRequest): string {
  const sel = req.selection
  const p = req.prompt
  if (sel && sel.start !== sel.end) {
    return p.length > 600 ? `${p.slice(0, 597)}…` : p
  }
  return p.length > 280 ? `Workspace notes (${p.length} chars)` : p
}

type WorkspaceAssistantMsg = {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** Set on assistant rows — id of the user bubble this reply answers. */
  userPairId?: string
  editing?: boolean
  /** Echo of the request sent to `onWorkspaceAssistant` (for regenerate). */
  assistantReq?: Pick<WorkspaceAssistantRequest, 'prompt' | 'selection'>
}

const INGEST_KIND_TABS: { kind: IngestKind; label: string }[] = [
  { kind: 'transcript', label: 'Transcript' },
  { kind: 'images', label: 'Images' },
  { kind: 'notes', label: 'Notes' },
]

const PAPER_GENRE_SELECT_OPTIONS: { value: PaperGenreMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'empirical_imrad', label: 'IMRaD (empirical)' },
  { value: 'review', label: 'Review' },
  { value: 'theoretical', label: 'Theoretical' },
  { value: 'case_study', label: 'Case study' },
  { value: 'general', label: 'General' },
]

export type ResearchOverviewProps = {
  /** When set, called for Expand / Refine; otherwise a local stub runs. */
  onAiIterate?: (req: AiIterateRequest) => Promise<AiIterateResult | void>
  /**
   * Optional handler for workspace-notes assistant (Ctrl+Enter / ⌘ Enter in workspace notes).
   * Outline AI still uses `onAiIterate`; hosts may call the same backend from both hooks.
   */
  onWorkspaceAssistant?: WorkspaceAssistantHandler
  /** Debounced (~400ms) notification when outline, tabs, ingest fields, or workspace notes change. */
  onWorkspaceChange?: (snap: OverviewWorkspaceSnapshot) => void
  /** Footer link to the plain Summary page (optional). */
  onOpenSummary?: () => void
  /** Footer link to the Presentation reading room (optional). */
  onOpenPresentation?: () => void
} & ResearchOverviewCorpusHandlers

const SEED_DEBOUNCE_MS = 900
const GENRE_HINT_DEBOUNCE_MS = 400
const WORKSPACE_CHANGE_DEBOUNCE_MS = 400
const OUTLINE_BADGE_DEBOUNCE_MS = 480
const HERO_BADGE_CAP = 6
const AI_FINISHED_BADGE_MS = 5200

export type HeroBadgeTone = 'info' | 'success' | 'warn'

export type HeroBadge = {
  id: string
  mergePrefix: string
  label: string
  tone: HeroBadgeTone
  createdAt: string
}

/** Pixels for tab-strip arrow scrolling (fallback when width not yet measured). */
const TAB_SCROLL_STEP_FALLBACK_PX = 160

/** Treat as flush with edge when within this many CSS pixels (subpixel / rounding). */
const TAB_SCROLL_EDGE_EPSILON = 2

const DRAWER_AI_SESSION_KEY = 'overview-drawer-ai-config'
const CAPTURE_GALLERY_SESSION_KEY = 'overview-capture-gallery'

/** Session-only PNG captures (not part of workspace JSON export). */
export type CaptureGalleryItem = {
  id: string
  label: string
  dataUrl: string
  createdAt: string
}

function readCaptureGalleryFromSession(): CaptureGalleryItem[] {
  try {
    const raw = sessionStorage.getItem(CAPTURE_GALLERY_SESSION_KEY)
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    const out: CaptureGalleryItem[] = []
    for (const x of v) {
      if (!x || typeof x !== 'object') continue
      const o = x as Record<string, unknown>
      if (typeof o.id !== 'string' || typeof o.label !== 'string') continue
      if (typeof o.dataUrl !== 'string' || typeof o.createdAt !== 'string') continue
      if (!o.dataUrl.startsWith('data:image/')) continue
      out.push({ id: o.id, label: o.label, dataUrl: o.dataUrl, createdAt: o.createdAt })
    }
    return out
  } catch {
    return []
  }
}

type DrawerAiSessionState = {
  baseUrl: string
  modelName: string
  apiKey: string
  linked: boolean
}

function readDrawerAiFromSession(): DrawerAiSessionState {
  try {
    const raw = sessionStorage.getItem(DRAWER_AI_SESSION_KEY)
    if (!raw) return { baseUrl: '', modelName: '', apiKey: '', linked: false }
    const o = JSON.parse(raw) as Record<string, unknown>
    return {
      baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl : '',
      modelName: typeof o.modelName === 'string' ? o.modelName : '',
      apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
      linked: true,
    }
  } catch {
    return { baseUrl: '', modelName: '', apiKey: '', linked: false }
  }
}

type DrawerAttachmentRow = SnapshotFileAttachment & { file?: File }

type AttachmentSortMode = 'name' | 'size'

function normalizeAttachmentName(name: string): string {
  return name.trim().toLowerCase()
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const LS_MENU_OPEN = 'overview-menu-open'
const LS_DRAWER_DETAILS = 'overview-drawer-details'
const LS_WORKSPACE_NOTES_EXPANDED = 'overview-workspace-notes-expanded'

const OVERVIEW_DRAWER_DETAIL_KEYS = [
  'paperGenre',
  'actions',
  'files',
  'aiLinking',
  'quickNotes',
  'media',
  'themePreview',
  'capture',
  'sketch',
  'actionsShortcuts',
  'actionsAbout',
] as const

type OverviewDrawerDetailKey = (typeof OVERVIEW_DRAWER_DETAIL_KEYS)[number]

const DEFAULT_DRAWER_DETAILS: Record<OverviewDrawerDetailKey, boolean> = {
  paperGenre: false,
  actions: false,
  files: false,
  aiLinking: false,
  quickNotes: false,
  media: false,
  themePreview: false,
  capture: false,
  sketch: false,
  actionsShortcuts: false,
  actionsAbout: false,
}

function readLsBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeLsBool(key: string, open: boolean) {
  try {
    localStorage.setItem(key, open ? '1' : '0')
  } catch {
    /* ignore quota / private mode */
  }
}

function readOverviewMenuOpen(): boolean {
  return readLsBool(LS_MENU_OPEN)
}

function readOverviewDrawerDetails(): Record<OverviewDrawerDetailKey, boolean> {
  try {
    const raw = localStorage.getItem(LS_DRAWER_DETAILS)
    if (!raw) return { ...DEFAULT_DRAWER_DETAILS }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out = { ...DEFAULT_DRAWER_DETAILS }
    for (const k of OVERVIEW_DRAWER_DETAIL_KEYS) {
      if (k in parsed && typeof parsed[k] === 'boolean') out[k] = parsed[k]
    }
    return out
  } catch {
    return { ...DEFAULT_DRAWER_DETAILS }
  }
}

function writeOverviewDrawerDetails(state: Record<OverviewDrawerDetailKey, boolean>) {
  try {
    localStorage.setItem(LS_DRAWER_DETAILS, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

/** One-shot bootstrap so tab list and active id stay in sync without refs-in-render. */
const RESEARCH_OVERVIEW_BOOTSTRAP = (() => {
  const t = createTab(initialDocument)
  return { tabs: [t] as ResearchPageTab[], activeTabId: t.id }
})()

export default function ResearchOverview({
  onAiIterate,
  onWorkspaceAssistant,
  onWorkspaceChange,
  onOpenSummary,
  onOpenPresentation,
  onTranscriptIngest,
  onCorpusSearch,
}: ResearchOverviewProps) {
  const [tabs, setTabs] = useState<ResearchPageTab[]>(() => [...RESEARCH_OVERVIEW_BOOTSTRAP.tabs])
  const [activeTabId, setActiveTabIdState] = useState(RESEARCH_OVERVIEW_BOOTSTRAP.activeTabId)

  const [tocActiveId, setTocActiveId] = useState<string | null>(null)
  const [aiBusyId, setAiBusyId] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [ingestStubFeedback, setIngestStubFeedback] = useState<string | null>(null)
  const [shareLinkNotice, setShareLinkNotice] = useState<string | null>(null)
  const [paperAutoHintGenre, setPaperAutoHintGenre] = useState<PaperGenre>(() => detectPaperGenre(''))
  /**
   * Global scratchpad above the tab bar (session-only). Prefer this over per-tab notes so
   * “broader context” carries across research pages unless UX needs tab-scoped scratchpads.
   */
  const [shellContext, setShellContext] = useState('')
  const [shellContextFocused, setShellContextFocused] = useState(false)
  const [linkMetaHint, setLinkMetaHint] = useState<{ url: string; text: string } | null>(null)
  const [workspaceAssistantMessages, setWorkspaceAssistantMessages] = useState<WorkspaceAssistantMsg[]>([])
  const [workspaceAssistantBusy, setWorkspaceAssistantBusy] = useState(false)
  /** When set to an assistant message id, quick-reply bar is hidden for that reply until a newer assistant message appears. */
  const [waQuickReplyDismissedForId, setWaQuickReplyDismissedForId] = useState<string | null>(null)
  const linkMetaPasteGen = useRef(0)
  const shellNotesCaretRef = useRef({ start: 0, end: 0 })
  const workspaceAssistantMessagesRef = useRef<WorkspaceAssistantMsg[]>([])
  const acceptAssistantCursorRef = useRef(0)
  const [menuOpen, setMenuOpen] = useState(() => readOverviewMenuOpen())
  const [drawerEntered, setDrawerEntered] = useState(false)
  const [drawerDetailsOpen, setDrawerDetailsOpen] = useState(readOverviewDrawerDetails)
  const [workspaceNotesPinnedOpen, setWorkspaceNotesPinnedOpen] = useState(() =>
    readLsBool(LS_WORKSPACE_NOTES_EXPANDED),
  )

  const [drawerQuickNotes, setDrawerQuickNotes] = useState('')
  const [attachments, setAttachments] = useState<DrawerAttachmentRow[]>([])
  const [attachmentSearchQuery, setAttachmentSearchQuery] = useState('')
  const [attachmentSortMode, setAttachmentSortMode] = useState<AttachmentSortMode>('name')
  const [drawerAi, setDrawerAi] = useState<DrawerAiSessionState>(() => readDrawerAiFromSession())
  const [drawerMediaTab, setDrawerMediaTab] = useState<'images' | 'stream' | 'chat'>('images')
  const [drawerImgUrlField, setDrawerImgUrlField] = useState('')
  const [drawerImgPreviewSrc, setDrawerImgPreviewSrc] = useState<string | null>(null)
  const [drawerChatMessages, setDrawerChatMessages] = useState<{ id: string; text: string; at: string }[]>([])
  const [drawerChatInput, setDrawerChatInput] = useState('')

  const [sessionStartedAt] = useState(() => Date.now())
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [lastAiUsage, setLastAiUsage] = useState<{ promptTokens?: number; completionTokens?: number } | null>(null)

  /** Snapshot (PNG) capture state — lazy-imports `html-to-image` only when user clicks. */
  const [captureBusy, setCaptureBusy] = useState(false)
  const [captureStatus, setCaptureStatus] = useState<{ text: string; isError: boolean } | null>(null)
  const [captureGallery, setCaptureGallery] = useState<CaptureGalleryItem[]>(() => readCaptureGalleryFromSession())
  const [snapshotDownloadPng, setSnapshotDownloadPng] = useState(true)
  const [capturePreview, setCapturePreview] = useState<CaptureGalleryItem | null>(null)
  const [heroBadges, setHeroBadges] = useState<HeroBadge[]>([])
  /** Sketch (Excalidraw) is gated behind a manual toggle so the chunk only loads on demand. */
  const [sketchEnabled, setSketchEnabled] = useState(false)
  const themeSplitRef = useRef<HTMLDivElement | null>(null)
  const capturePreviewDialogRef = useRef<HTMLDialogElement | null>(null)
  const captureGalleryStripRef = useRef<HTMLDivElement | null>(null)

  const menuDrawerId = useId()
  const drawerTitleId = useId()
  const drawerAttachInputId = useId()
  const drawerImagePickId = useId()
  const aiBaseUrlId = useId()
  const aiModelId = useId()
  const aiKeyId = useId()
  const drawerNotesId = useId()
  const drawerImgUrlInputId = useId()
  const drawerChatFieldId = useId()
  const drawerAttachFilterId = useId()
  const menuFabRef = useRef<HTMLButtonElement>(null)
  const drawerCloseRef = useRef<HTMLButtonElement>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const shareLinkNoticeTimerRef = useRef<number | undefined>(undefined)
  const heroBadgeDismissTimersRef = useRef(new Map<string, number>())
  const outlineBadgeDebounceRef = useRef<number | undefined>(undefined)
  const outlineBadgeBatchRef = useRef(0)
  const outlineTabInitRef = useRef<string | null>(null)
  const outlineSectionsSigRef = useRef<string | null>(null)
  const drawerAttachInputRef = useRef<HTMLInputElement>(null)
  const drawerImgObjUrlRef = useRef<string | null>(null)
  const workspaceSubscribersRef = useRef(new Set<(snap: OverviewWorkspaceSnapshot) => void>())
  const workspaceNotifyTimerRef = useRef<number | undefined>(undefined)

  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const promptRef = useRef('')
  const ingestQueryRef = useRef('')
  const shellContextRef = useRef('')
  const drawerQuickNotesRef = useRef('')
  const attachmentsRef = useRef<DrawerAttachmentRow[]>([])
  const aiPublicConfigRef = useRef<SnapshotAiConfig>({})
  const shellContextTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const tabScrollRef = useRef<HTMLDivElement | null>(null)
  const [tabScrollEnds, setTabScrollEnds] = useState({ atStart: true, atEnd: true })

  const syncTabScrollEnds = useCallback(() => {
    const el = tabScrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    const maxScroll = Math.max(0, scrollWidth - clientWidth)
    const sl = scrollLeft
    setTabScrollEnds({
      atStart: sl <= TAB_SCROLL_EDGE_EPSILON,
      atEnd: sl >= maxScroll - TAB_SCROLL_EDGE_EPSILON,
    })
  }, [])

  const scrollTabsBy = useCallback((direction: -1 | 1) => {
    const el = tabScrollRef.current
    if (!el) return
    const step = Math.max(TAB_SCROLL_STEP_FALLBACK_PX, Math.floor(el.clientWidth * 0.65))
    el.scrollBy({ left: direction * step, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? tabs[0], [tabs, activeTabId])
  const sections = useMemo(() => activeTab?.sections ?? [], [activeTab])
  const researchPrompt = activeTab?.researchPrompt ?? ''
  const ingestQuery = activeTab?.ingestQuery ?? ''
  const ingestKind: IngestKind = activeTab?.ingestKind ?? 'transcript'
  const tabTodos = activeTab?.todos ?? []
  const paperGenreMode: PaperGenreMode = activeTab?.paperGenreMode ?? 'auto'
  const paperGenreHintLabel = useMemo(
    () => PAPER_GENRE_SELECT_OPTIONS.find((o) => o.value === paperAutoHintGenre)?.label ?? paperAutoHintGenre,
    [paperAutoHintGenre],
  )
  const showIngestKindTabs = looksLikeHttpUrl(ingestQuery)

  const footerDocStats = useMemo(() => {
    const parts = [...collectOutlineTexts(sections), shellContext, drawerQuickNotes]
    for (const m of workspaceAssistantMessages) parts.push(m.text)
    return countWordsAndSpaces(parts.join('\n'))
  }, [sections, shellContext, drawerQuickNotes, workspaceAssistantMessages])

  const footerStatusText = useMemo(() => {
    const elapsedMs = nowTick - sessionStartedAt
    const clock = formatWallClock(new Date(nowTick))
    const elapsed = formatSessionElapsed(elapsedMs)
    const { words, spaces } = footerDocStats
    const aiNever = lastAiUsage === null
    const promptT = lastAiUsage?.promptTokens
    const compT = lastAiUsage?.completionTokens
    const usageCol = aiNever ? '—' : String(compT ?? 0)
    const contextCol = aiNever ? '—' : String(promptT ?? 0)
    const tokensCol = aiNever ? '—' : String((promptT ?? 0) + (compT ?? 0))
    return `${clock} : ${elapsed} _ ${words} : ${spaces} _ ${usageCol} | ${contextCol} | ${tokensCol}`
  }, [nowTick, footerDocStats, lastAiUsage, sessionStartedAt])

  const sectionsRef = useRef(sections)
  useEffect(() => {
    sectionsRef.current = sections
  }, [sections])
  useEffect(() => {
    promptRef.current = researchPrompt
  }, [researchPrompt])
  useEffect(() => {
    ingestQueryRef.current = ingestQuery
  }, [ingestQuery])
  useEffect(() => {
    shellContextRef.current = shellContext
  }, [shellContext])

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const text = `${researchPrompt} ${shellContext}`.trim()
    const handle = window.setTimeout(() => {
      setPaperAutoHintGenre(detectPaperGenre(text))
    }, GENRE_HINT_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [researchPrompt, shellContext, activeTabId])

  useEffect(() => {
    workspaceAssistantMessagesRef.current = workspaceAssistantMessages
  }, [workspaceAssistantMessages])

  useEffect(() => {
    drawerQuickNotesRef.current = drawerQuickNotes
  }, [drawerQuickNotes])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    try {
      sessionStorage.setItem(CAPTURE_GALLERY_SESSION_KEY, JSON.stringify(captureGallery))
    } catch {
      window.setTimeout(() => {
        setCaptureStatus({
          text: 'Could not persist capture gallery to session storage (quota or blocked).',
          isError: true,
        })
      }, 0)
    }
  }, [captureGallery])

  useEffect(() => {
    const cfg: SnapshotAiConfig = {}
    const bu = drawerAi.baseUrl.trim()
    const mn = drawerAi.modelName.trim()
    if (bu) cfg.baseUrl = bu
    if (mn) cfg.modelName = mn
    aiPublicConfigRef.current = cfg
  }, [drawerAi.baseUrl, drawerAi.modelName])

  useEffect(() => {
    return () => {
      if (drawerImgObjUrlRef.current) {
        URL.revokeObjectURL(drawerImgObjUrlRef.current)
        drawerImgObjUrlRef.current = null
      }
    }
  }, [])

  const shellContextExpanded =
    shellContextFocused || shellContext.trim().length > 0 || workspaceNotesPinnedOpen

  const latestWorkspaceAssistantMsg = useMemo(() => {
    for (let i = workspaceAssistantMessages.length - 1; i >= 0; i--) {
      const m = workspaceAssistantMessages[i]
      if (m?.role === 'assistant') return m
    }
    return null
  }, [workspaceAssistantMessages])

  const waQuickReplyActive = Boolean(
    latestWorkspaceAssistantMsg &&
      !workspaceAssistantBusy &&
      latestWorkspaceAssistantMsg.id !== waQuickReplyDismissedForId,
  )

  const appendWorkspaceQuickAck = useCallback((label: 'Yes' | 'No') => {
    setShellContext((prev) => `${prev}\n\n[quick]: ${label}\n`)
  }, [])

  const workspaceAssistantRun = useMemo(
    () => onWorkspaceAssistant ?? stubWorkspaceAssistant,
    [onWorkspaceAssistant],
  )

  const workspaceAssistantSectionLabelId = useId()
  const shellNotesHintId = useId()

  const onShellContextPaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain') ?? ''
    const m = text.match(/\bhttps?:\/\/[^\s\]>)\]}'"]+/i)
    if (!m?.[0]) return
    const url = m[0]
    const gen = ++linkMetaPasteGen.current
    void (async () => {
      const sentence = await summarizeUrlMetadata(url)
      if (gen !== linkMetaPasteGen.current) return
      setLinkMetaHint({ url, text: sentence })
    })()
  }, [])

  const updateShellNotesCaret = useCallback(() => {
    const el = shellContextTextareaRef.current
    if (!el) return
    shellNotesCaretRef.current = { start: el.selectionStart, end: el.selectionEnd }
  }, [])

  const sendWorkspaceAssistantFromNotes = useCallback(async () => {
    if (workspaceAssistantBusy || aiBusyId) return
    const notes = shellContextRef.current
    const caret = shellNotesCaretRef.current
    const req = buildWorkspaceAssistantRequestFromNotes(notes, caret)
    if (!req) return
    const userId = crypto.randomUUID()
    const userBubbleText = formatUserBubbleForAssistant(req)
    setWorkspaceAssistantMessages((prev) => [
      ...prev,
      {
        id: userId,
        role: 'user',
        text: userBubbleText,
        assistantReq: { prompt: req.prompt, selection: req.selection },
      },
    ])
    setWorkspaceAssistantBusy(true)
    try {
      const reply = await workspaceAssistantRun(req)
      setLastAiUsage({
        promptTokens: roughTokenEstimate(`${req.prompt}\n${req.notes}`),
        completionTokens: roughTokenEstimate(reply),
      })
      setWorkspaceAssistantMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', text: reply, userPairId: userId },
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setWorkspaceAssistantMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: `Could not complete assistant request: ${msg}`,
          userPairId: userId,
        },
      ])
    } finally {
      setWorkspaceAssistantBusy(false)
    }
  }, [workspaceAssistantBusy, aiBusyId, workspaceAssistantRun])

  const regenerateWorkspaceAssistant = useCallback(
    async (assistantId: string) => {
      if (workspaceAssistantBusy) return
      const prev = workspaceAssistantMessagesRef.current
      const self = prev.find((m) => m.id === assistantId && m.role === 'assistant')
      if (!self?.userPairId) return
      const user = prev.find((m) => m.id === self.userPairId && m.role === 'user')
      if (!user) return
      setWorkspaceAssistantBusy(true)
      try {
        const reply = await workspaceAssistantRun({
          prompt: user.assistantReq?.prompt ?? user.text,
          notes: shellContextRef.current,
          selection: user.assistantReq?.selection,
        })
        setLastAiUsage({
          promptTokens: roughTokenEstimate(
            `${user.assistantReq?.prompt ?? user.text}\n${shellContextRef.current}`,
          ),
          completionTokens: roughTokenEstimate(reply),
        })
        setWorkspaceAssistantMessages((p) =>
          p.map((m) => (m.id === assistantId ? { ...m, text: reply, editing: false } : m)),
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setWorkspaceAssistantMessages((p) =>
          p.map((m) =>
            m.id === assistantId ? { ...m, text: `Regenerate failed: ${msg}`, editing: false } : m,
          ),
        )
      } finally {
        setWorkspaceAssistantBusy(false)
      }
    },
    [workspaceAssistantBusy, workspaceAssistantRun],
  )

  const toggleAssistantEdit = useCallback((assistantId: string) => {
    setWorkspaceAssistantMessages((p) =>
      p.map((m) => (m.id === assistantId && m.role === 'assistant' ? { ...m, editing: !m.editing } : m)),
    )
  }, [])

  const setAssistantDraftText = useCallback((assistantId: string, text: string) => {
    setWorkspaceAssistantMessages((p) =>
      p.map((m) => (m.id === assistantId && m.role === 'assistant' ? { ...m, text } : m)),
    )
  }, [])

  const acceptAssistantIntoNotes = useCallback((assistantId: string) => {
    const msg = workspaceAssistantMessagesRef.current.find((m) => m.id === assistantId && m.role === 'assistant')
    if (!msg) return
    const insert = msg.text.trimEnd()
    if (!insert) return
    const pos = shellNotesCaretRef.current.end
    setShellContext((prev) => {
      const p = Math.min(Math.max(0, pos), prev.length)
      acceptAssistantCursorRef.current = p + WORKSPACE_ASSISTANT_ACCEPT_DELIM.length + insert.length
      return prev.slice(0, p) + WORKSPACE_ASSISTANT_ACCEPT_DELIM + insert + prev.slice(p)
    })
    queueMicrotask(() => {
      shellContextTextareaRef.current?.focus()
      const el = shellContextTextareaRef.current
      if (!el) return
      const c = acceptAssistantCursorRef.current
      el.setSelectionRange(c, c)
      shellNotesCaretRef.current = { start: c, end: c }
    })
  }, [])

  useEffect(() => {
    if (!linkMetaHint) return
    const t = window.setTimeout(() => setLinkMetaHint(null), 14000)
    return () => window.clearTimeout(t)
  }, [linkMetaHint])

  useEffect(() => {
    if (shellContextFocused) shellContextTextareaRef.current?.focus()
  }, [shellContextFocused])

  useEffect(() => {
    if (!menuOpen) {
      queueMicrotask(() => setDrawerEntered(false))
      return
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDrawerEntered(true))
    })
    return () => cancelAnimationFrame(id)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen || !drawerEntered) return
    drawerCloseRef.current?.focus()
  }, [menuOpen, drawerEntered])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    queueMicrotask(() => menuFabRef.current?.focus())
  }, [])

  const persistDrawerDetail = useCallback((key: OverviewDrawerDetailKey, open: boolean) => {
    setDrawerDetailsOpen((prev) => {
      const next = { ...prev, [key]: open }
      writeOverviewDrawerDetails(next)
      return next
    })
  }, [])

  useEffect(() => {
    writeLsBool(LS_MENU_OPEN, menuOpen)
  }, [menuOpen])

  useEffect(() => {
    writeLsBool(LS_WORKSPACE_NOTES_EXPANDED, workspaceNotesPinnedOpen)
  }, [workspaceNotesPinnedOpen])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      closeMenu()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [menuOpen, closeMenu])

  const setActiveTabId = useCallback((id: string) => {
    setActiveTabIdState(id)
    setAiError(null)
    setIngestStubFeedback(null)
  }, [])

  const dismissHeroBadge = useCallback((mergePrefix: string) => {
    const tid = heroBadgeDismissTimersRef.current.get(mergePrefix)
    if (tid !== undefined) {
      window.clearTimeout(tid)
      heroBadgeDismissTimersRef.current.delete(mergePrefix)
    }
    setHeroBadges((prev) => prev.filter((b) => b.mergePrefix !== mergePrefix))
  }, [])

  const pushHeroBadge = useCallback(
    (input: {
      mergePrefix: string
      dedupePrefix?: string
      label: string
      tone?: HeroBadgeTone
      autoDismissMs?: number
    }) => {
      const tid0 = heroBadgeDismissTimersRef.current.get(input.mergePrefix)
      if (tid0 !== undefined) {
        window.clearTimeout(tid0)
        heroBadgeDismissTimersRef.current.delete(input.mergePrefix)
      }
      const ded = input.dedupePrefix
      const tone = input.tone ?? 'info'
      setHeroBadges((prev) => {
        if (ded) {
          for (const b of prev) {
            if (b.mergePrefix.startsWith(ded)) {
              const t = heroBadgeDismissTimersRef.current.get(b.mergePrefix)
              if (t !== undefined) {
                window.clearTimeout(t)
                heroBadgeDismissTimersRef.current.delete(b.mergePrefix)
              }
            }
          }
        }
        const rest = ded
          ? prev.filter((b) => !b.mergePrefix.startsWith(ded))
          : prev.filter((b) => b.mergePrefix !== input.mergePrefix)
        const badge: HeroBadge = {
          id: crypto.randomUUID(),
          mergePrefix: input.mergePrefix,
          label: input.label,
          tone,
          createdAt: new Date().toISOString(),
        }
        return [badge, ...rest].slice(0, HERO_BADGE_CAP)
      })
      if (input.autoDismissMs !== undefined && input.autoDismissMs > 0) {
        const handle = window.setTimeout(() => {
          heroBadgeDismissTimersRef.current.delete(input.mergePrefix)
          setHeroBadges((prev) => prev.filter((b) => b.mergePrefix !== input.mergePrefix))
        }, input.autoDismissMs)
        heroBadgeDismissTimersRef.current.set(input.mergePrefix, handle)
      }
    },
    [],
  )

  const applyImportedSnapshot = useCallback(
    (snap: OverviewWorkspaceSnapshot, heroSource?: 'file' | 'share') => {
      setTabs(
        snap.tabs.map((t) => ({
          id: t.id,
          sections: t.sections,
          researchPrompt: t.researchPrompt,
          ingestQuery: t.ingestQuery,
          ingestKind: t.ingestKind ?? 'transcript',
          lastSeedPrompt: t.lastSeedPrompt,
          todos: t.todos,
          paperGenreMode: t.paperGenreMode ?? 'auto',
        })),
      )
      setShellContext(snap.shellContext)
      setDrawerQuickNotes(snap.drawerQuickNotes ?? '')
      setAttachments((snap.attachments ?? []).map((a) => ({ ...a })))
      const ac = snap.aiConfig
      if (ac) {
        setDrawerAi((prev) => ({
          ...prev,
          baseUrl: ac.baseUrl ?? '',
          modelName: ac.modelName ?? '',
        }))
      }
      setActiveTabId(snap.activeTabId)
      setAiBusyId(null)
      setTocActiveId(null)
      if (heroSource === 'file') {
        pushHeroBadge({ mergePrefix: 'import-file', label: 'Workspace imported', tone: 'success' })
      } else if (heroSource === 'share') {
        pushHeroBadge({ mergePrefix: 'import-share', label: 'Share link loaded', tone: 'success' })
      }
    },
    [pushHeroBadge, setActiveTabId],
  )

  const flushWorkspaceNotify = useCallback(() => {
    const snap = serializeWorkspace({
      tabs: tabsRef.current,
      activeTabId: activeTabIdRef.current,
      shellContext: shellContextRef.current,
      drawerQuickNotes: drawerQuickNotesRef.current,
      attachments: attachmentsRef.current,
      aiConfig: aiPublicConfigRef.current,
    })
    onWorkspaceChange?.(snap)
    workspaceSubscribersRef.current.forEach((fn) => {
      try {
        fn(snap)
      } catch {
        /* ignore subscriber failures */
      }
    })
  }, [onWorkspaceChange])

  useEffect(() => {
    if (workspaceNotifyTimerRef.current !== undefined) {
      window.clearTimeout(workspaceNotifyTimerRef.current)
    }
    workspaceNotifyTimerRef.current = window.setTimeout(() => {
      workspaceNotifyTimerRef.current = undefined
      flushWorkspaceNotify()
    }, WORKSPACE_CHANGE_DEBOUNCE_MS)
    return () => {
      if (workspaceNotifyTimerRef.current !== undefined) {
        window.clearTimeout(workspaceNotifyTimerRef.current)
        workspaceNotifyTimerRef.current = undefined
      }
    }
  }, [tabs, activeTabId, shellContext, drawerQuickNotes, attachments, drawerAi.baseUrl, drawerAi.modelName, flushWorkspaceNotify])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const api: OverviewWorkspaceDevApi = {
      getSnapshot: () =>
        serializeWorkspace({
          tabs: tabsRef.current,
          activeTabId: activeTabIdRef.current,
          shellContext: shellContextRef.current,
          drawerQuickNotes: drawerQuickNotesRef.current,
          attachments: attachmentsRef.current,
          aiConfig: aiPublicConfigRef.current,
        }),
      loadSnapshot: (snap: unknown) => {
        const parsed = parseWorkspaceSnapshot(snap)
        applyImportedSnapshot(parsed, 'file')
        return parsed
      },
      subscribe: (listener) => {
        workspaceSubscribersRef.current.add(listener)
        return () => workspaceSubscribersRef.current.delete(listener)
      },
    }
    window.__OVERVIEW_WORKSPACE__ = api
    return () => {
      if (window.__OVERVIEW_WORKSPACE__ === api) {
        delete window.__OVERVIEW_WORKSPACE__
      }
    }
  }, [applyImportedSnapshot])

  const runWorkspaceJsonExport = useCallback(() => {
    const snap = serializeWorkspace({
      tabs: tabsRef.current,
      activeTabId: activeTabIdRef.current,
      shellContext: shellContextRef.current,
      drawerQuickNotes: drawerQuickNotesRef.current,
      attachments: attachmentsRef.current,
      aiConfig: aiPublicConfigRef.current,
    })
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'overview-workspace.json'
    a.rel = 'noopener'
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const exportWorkspaceFile = useCallback(() => {
    runWorkspaceJsonExport()
    closeMenu()
  }, [closeMenu, runWorkspaceJsonExport])

  const showShareLinkNotice = useCallback((message: string) => {
    if (shareLinkNoticeTimerRef.current !== undefined) {
      window.clearTimeout(shareLinkNoticeTimerRef.current)
    }
    setShareLinkNotice(message)
    shareLinkNoticeTimerRef.current = window.setTimeout(() => {
      setShareLinkNotice(null)
      shareLinkNoticeTimerRef.current = undefined
    }, 4000)
  }, [])

  const copyWorkspaceShareLink = useCallback(async () => {
    const snap = serializeWorkspace({
      tabs: tabsRef.current,
      activeTabId: activeTabIdRef.current,
      shellContext: shellContextRef.current,
      drawerQuickNotes: drawerQuickNotesRef.current,
      attachments: attachmentsRef.current,
      aiConfig: aiPublicConfigRef.current,
    })
    const enc = await encodeWorkspaceShare(snap)
    if (!enc.ok) {
      showShareLinkNotice('Too large to share via link — use Export JSON instead.')
      return
    }
    const mode = await copyShareUrlToClipboard(enc.shareUrl)
    showShareLinkNotice(
      mode === 'clipboard' ? 'Share link copied.' : 'Copy the link from the dialog if your browser blocked clipboard access.',
    )
    closeMenu()
  }, [closeMenu, showShareLinkNotice])

  useEffect(() => {
    if (window.location.hash !== '#workspace-export') return
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    runWorkspaceJsonExport()
  }, [runWorkspaceJsonExport])

  useEffect(() => {
    const hash = window.location.hash
    if (!hash.startsWith(WORKSPACE_SHARE_HASH_PREFIX)) return
    const payload = hash.slice(WORKSPACE_SHARE_HASH_PREFIX.length)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    void (async () => {
      try {
        const snap = await decodeWorkspaceSharePayload(payload)
        applyImportedSnapshot(snap, 'share')
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Could not load shared workspace.')
      }
    })()
  }, [applyImportedSnapshot])

  const onImportFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      void (async () => {
        let text: string
        try {
          text = await file.text()
        } catch {
          window.alert('Could not read file.')
          return
        }
        let snap: OverviewWorkspaceSnapshot
        try {
          snap = parseWorkspaceSnapshotFromJsonText(text)
        } catch (err) {
          window.alert(err instanceof Error ? err.message : 'Invalid workspace snapshot.')
          return
        }
        if (!window.confirm('Replace the current workspace with the imported snapshot?')) return
        applyImportedSnapshot(snap, 'file')
        closeMenu()
      })()
    },
    [applyImportedSnapshot, closeMenu],
  )

  const onDrawerAttachChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    e.target.value = ''
    if (!files?.length) return
    setAttachments((prev) => [
      ...prev,
      ...Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        file,
      })),
    ])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const clearAllAttachments = useCallback(() => {
    if (!window.confirm('Remove all attached files from this session?')) return
    setAttachments([])
    setAttachmentSearchQuery('')
  }, [])

  const attachmentDuplicateKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of attachments) {
      const k = normalizeAttachmentName(a.name)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const dups = new Set<string>()
    for (const [k, n] of counts) {
      if (n > 1) dups.add(k)
    }
    return dups
  }, [attachments])

  const filteredSortedAttachments = useMemo(() => {
    const q = attachmentSearchQuery.trim().toLowerCase()
    const base = q ? attachments.filter((a) => a.name.toLowerCase().includes(q)) : attachments
    const next = [...base]
    if (attachmentSortMode === 'name') {
      next.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    } else {
      next.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    }
    return next
  }, [attachments, attachmentSearchQuery, attachmentSortMode])

  const saveDrawerAiConfig = useCallback(() => {
    try {
      sessionStorage.setItem(
        DRAWER_AI_SESSION_KEY,
        JSON.stringify({
          baseUrl: drawerAi.baseUrl.trim(),
          modelName: drawerAi.modelName.trim(),
          apiKey: drawerAi.apiKey,
        }),
      )
      setDrawerAi((p) => ({ ...p, linked: true }))
    } catch {
      window.alert('Could not save AI settings to session storage.')
    }
  }, [drawerAi.apiKey, drawerAi.baseUrl, drawerAi.modelName])

  const clearDrawerAiConfig = useCallback(() => {
    try {
      sessionStorage.removeItem(DRAWER_AI_SESSION_KEY)
    } catch {
      /* ignore */
    }
    setDrawerAi({ baseUrl: '', modelName: '', apiKey: '', linked: false })
  }, [])

  const revokeDrawerImgObjectUrl = useCallback(() => {
    if (drawerImgObjUrlRef.current) {
      URL.revokeObjectURL(drawerImgObjUrlRef.current)
      drawerImgObjUrlRef.current = null
    }
  }, [])

  const applyDrawerImageFromUrl = useCallback(() => {
    revokeDrawerImgObjectUrl()
    const u = drawerImgUrlField.trim()
    setDrawerImgPreviewSrc(u || null)
  }, [drawerImgUrlField, revokeDrawerImgObjectUrl])

  const onDrawerImageFilePick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (!f) return
      revokeDrawerImgObjectUrl()
      const u = URL.createObjectURL(f)
      drawerImgObjUrlRef.current = u
      setDrawerImgPreviewSrc(u)
    },
    [revokeDrawerImgObjectUrl],
  )

  const sendDrawerChat = useCallback(() => {
    const t = drawerChatInput.trim()
    if (!t) return
    setDrawerChatMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), text: t, at: new Date().toISOString() },
    ])
    setDrawerChatInput('')
  }, [drawerChatInput])

  /**
   * Renders a target element to PNG via `html-to-image` (dynamic import). Uses full
   * `scrollWidth` × `scrollHeight`, relaxes root overflow during capture, and always
   * appends to the session-only capture gallery; optional file download.
   */
  const runSnapshot = useCallback(
    async (
      target: HTMLElement | null,
      meta: { fileName: string; galleryLabel: string; download: boolean },
    ) => {
      if (!target) {
        setCaptureStatus({ text: 'No capture target found.', isError: true })
        return
      }
      setCaptureBusy(true)
      setCaptureStatus({ text: 'Rendering snapshot…', isError: false })

      const htmlEl = document.documentElement
      const bodyEl = document.body
      const prev = {
        htmlOverflow: htmlEl.style.overflow,
        htmlOverflowX: htmlEl.style.overflowX,
        bodyOverflow: bodyEl.style.overflow,
        bodyOverflowX: bodyEl.style.overflowX,
      }
      htmlEl.style.overflow = 'visible'
      htmlEl.style.overflowX = 'visible'
      bodyEl.style.overflow = 'visible'
      bodyEl.style.overflowX = 'visible'

      try {
        const { toPng } = await import('html-to-image')
        const bg =
          getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() ||
          getComputedStyle(target).backgroundColor ||
          '#ffffff'
        const w = Math.max(1, Math.ceil(Math.max(target.scrollWidth, target.clientWidth)))
        const h = Math.max(1, Math.ceil(Math.max(target.scrollHeight, target.clientHeight)))
        const pixelRatio = Math.min(3, Math.max(2, window.devicePixelRatio || 1))
        const dataUrl = await toPng(target, {
          width: w,
          height: h,
          pixelRatio,
          cacheBust: true,
          backgroundColor: bg,
          style: {
            transform: 'none',
            maxWidth: 'none',
          },
          filter: (domNode) => {
            if (!(domNode instanceof HTMLElement)) return true
            return !domNode.closest('.ro-capture-gallery')
          },
        })

        const entry: CaptureGalleryItem = {
          id: crypto.randomUUID(),
          label: meta.galleryLabel,
          dataUrl,
          createdAt: new Date().toISOString(),
        }
        setCaptureGallery((prev) => [entry, ...prev])
        pushHeroBadge({ mergePrefix: 'capture', label: 'Capture saved', tone: 'success' })

        if (meta.download) {
          const a = document.createElement('a')
          a.href = dataUrl
          a.download = meta.fileName
          a.rel = 'noopener'
          a.click()
        }

        setCaptureStatus({
          text: meta.download
            ? `Added to gallery · Saved ${meta.fileName}`
            : `Added to gallery (${meta.fileName} — download skipped)`,
          isError: false,
        })
      } catch (e) {
        setCaptureStatus({
          text: e instanceof Error ? `Snapshot failed: ${e.message}` : 'Snapshot failed.',
          isError: true,
        })
      } finally {
        htmlEl.style.overflow = prev.htmlOverflow
        htmlEl.style.overflowX = prev.htmlOverflowX
        bodyEl.style.overflow = prev.bodyOverflow
        bodyEl.style.overflowX = prev.bodyOverflowX
        setCaptureBusy(false)
      }
    },
    [pushHeroBadge],
  )

  const runShellSnapshot = useCallback(async () => {
    // Drawer overlays the shell — close it first so the capture matches the visible workspace.
    setMenuOpen(false)
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 300)
    })
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve())
      })
    })
    const target =
      document.querySelector<HTMLElement>('.ro-shell') ?? document.getElementById('root')
    await runSnapshot(target, {
      fileName: 'overview-shell.png',
      galleryLabel: 'Workspace shell',
      download: snapshotDownloadPng,
    })
  }, [runSnapshot, snapshotDownloadPng])

  const runSplitSnapshot = useCallback(async () => {
    await runSnapshot(themeSplitRef.current, {
      fileName: 'overview-theme-split.png',
      galleryLabel: 'Day / Night split preview',
      download: snapshotDownloadPng,
    })
  }, [runSnapshot, snapshotDownloadPng])

  const removeCaptureGalleryItem = useCallback((id: string) => {
    setCaptureGallery((prev) => prev.filter((x) => x.id !== id))
    setCapturePreview((p) => {
      if (p?.id === id) {
        queueMicrotask(() => capturePreviewDialogRef.current?.close())
        return null
      }
      return p
    })
  }, [])

  const clearCaptureGallery = useCallback(() => {
    if (!window.confirm('Remove all captures from this session’s gallery?')) return
    setCaptureGallery([])
    setCapturePreview(null)
    capturePreviewDialogRef.current?.close()
  }, [])

  const openCapturePreview = useCallback((item: CaptureGalleryItem) => {
    setCapturePreview(item)
    queueMicrotask(() => capturePreviewDialogRef.current?.showModal())
  }, [])

  useEffect(() => {
    const el = captureGalleryStripRef.current
    if (!el || captureGallery.length === 0) return
    const onWheel = (ev: WheelEvent) => {
      if (!ev.shiftKey) return
      ev.preventDefault()
      el.scrollLeft += ev.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [captureGallery.length])

  const outline = useMemo(() => flattenOutline(sections), [sections])

  useEffect(() => {
    const sig = JSON.stringify(sections)
    if (outlineTabInitRef.current === null) {
      outlineTabInitRef.current = activeTabId
      outlineSectionsSigRef.current = sig
      return
    }
    const tabChanged = outlineTabInitRef.current !== activeTabId
    if (tabChanged) {
      outlineTabInitRef.current = activeTabId
      outlineSectionsSigRef.current = sig
      if (outlineBadgeDebounceRef.current !== undefined) {
        window.clearTimeout(outlineBadgeDebounceRef.current)
        outlineBadgeDebounceRef.current = undefined
      }
      outlineBadgeBatchRef.current = 0
      return
    }
    if (outlineSectionsSigRef.current === sig) return
    outlineSectionsSigRef.current = sig

    outlineBadgeBatchRef.current += 1
    if (outlineBadgeDebounceRef.current !== undefined) {
      window.clearTimeout(outlineBadgeDebounceRef.current)
    }
    outlineBadgeDebounceRef.current = window.setTimeout(() => {
      outlineBadgeDebounceRef.current = undefined
      const n = outlineBadgeBatchRef.current
      outlineBadgeBatchRef.current = 0
      const label = n > 1 ? `Outline updated · ${n} changes` : 'Outline updated'
      pushHeroBadge({ mergePrefix: 'outline', dedupePrefix: 'outline', label, tone: 'info' })
    }, OUTLINE_BADGE_DEBOUNCE_MS)
  }, [sections, activeTabId, pushHeroBadge])

  useEffect(() => {
    return () => {
      if (outlineBadgeDebounceRef.current !== undefined) {
        window.clearTimeout(outlineBadgeDebounceRef.current)
      }
    }
  }, [])

  const runExpandOrRefine = useCallback(
    async (kind: 'expand' | 'refine', id: string) => {
      const tabId = activeTabIdRef.current
      const snap = tabsRef.current.find((t) => t.id === tabId)?.sections
      if (!snap) return
      const section = findSection(snap, id)
      if (!section) return
      const pathTitles = collectPathTitles(snap, id) ?? [section.title]
      const todoId = `${kind}-${id}`
      const todoLabel = `${kind === 'expand' ? 'Expand' : 'Refine'}: ${section.title.trim() || 'Untitled'}`
      setAiError(null)
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t
          const rest = t.todos.filter((x) => x.id !== todoId)
          return {
            ...t,
            todos: [...rest, { id: todoId, label: todoLabel, status: 'in_progress', source: kind }],
          }
        }),
      )
      setAiBusyId(id)
      try {
        const handler = onAiIterate ?? stubAiIterate
        const workspaceContext = shellContextRef.current.trim() || undefined
        const result = await handler({ kind, section, pathTitles, workspaceContext })
        if (!result) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === tabId
                ? {
                    ...t,
                    todos: t.todos.map((x) =>
                      x.id === todoId ? { ...x, status: 'pending' as const } : x,
                    ),
                  }
                : t,
            ),
          )
          return
        }
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== tabId) return t
            return {
              ...t,
              todos: t.todos.map((x) => (x.id === todoId ? { ...x, status: 'done' as const } : x)),
              sections: mapSection(t.sections, id, (s) => {
                let next: ResearchSection = { ...s }
                if (result.title !== undefined) next = { ...next, title: result.title }
                if (result.body !== undefined) next = { ...next, body: result.body }
                if (kind === 'expand' && result.children?.length) {
                  next = {
                    ...next,
                    children: [...next.children, ...result.children],
                  }
                }
                return next
              }),
            }
          }),
        )
        if (result.usage) setLastAiUsage(result.usage)
        else setLastAiUsage({ promptTokens: 0, completionTokens: 0 })
        pushHeroBadge({
          mergePrefix: 'ai',
          dedupePrefix: 'ai',
          label: 'AI finished',
          tone: 'success',
          autoDismissMs: AI_FINISHED_BADGE_MS,
        })
      } catch (e) {
        setAiError(e instanceof Error ? e.message : 'AI iteration failed')
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  todos: t.todos.map((x) =>
                    x.id === todoId ? { ...x, status: 'error' as const } : x,
                  ),
                }
              : t,
          ),
        )
      } finally {
        setAiBusyId(null)
      }
    },
    [onAiIterate, pushHeroBadge],
  )

  const runSeedFromPrompt = useCallback(
    async (trigger: 'enter' | 'idle' | 'blur') => {
      const tabId = activeTabIdRef.current
      const tabSnap = tabsRef.current.find((t) => t.id === tabId)
      const prompt = promptRef.current.trim()
      if (!prompt) return
      if (trigger !== 'enter' && prompt === tabSnap?.lastSeedPrompt) return

      const root = tabSnap?.sections[0]
      if (!root) return

      const mode = tabSnap.paperGenreMode ?? 'auto'
      const ws = shellContextRef.current.trim()
      const resolvedGenre: PaperGenre = mode === 'auto' ? detectPaperGenre(`${prompt} ${ws}`) : mode
      const rootHasChildren = root.children.length > 0
      const previewRoots = rootHasChildren
        ? stubSeedOutline(prompt)
        : paperTemplateToSections(PAPER_TEMPLATES[resolvedGenre])

      setAiError(null)
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, todos: mergeReplacingSeed(t.todos, buildSeedTodos(previewRoots)) } : t,
        ),
      )
      setAiBusyId(root.id)
      try {
        const handler = onAiIterate ?? stubAiIterate
        const workspaceContext = shellContextRef.current.trim() || undefined
        const result = await handler({
          kind: 'seed',
          prompt,
          rootSection: root,
          pathTitles: [root.title],
          workspaceContext,
          paperGenre: resolvedGenre,
        })
        if (!result) {
          setTabs((prev) =>
            prev.map((t) => (t.id === tabId ? { ...t, todos: resetSeedTodosPending(t.todos) } : t)),
          )
          return
        }
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== tabId) return t
            const rootId = t.sections[0]?.id
            if (!rootId) return t
            return {
              ...t,
              lastSeedPrompt: prompt,
              todos: markSeedTodosDone(t.todos),
              sections: mapSection(t.sections, rootId, (s) => ({
                ...s,
                ...(result.title !== undefined ? { title: result.title } : {}),
                ...(result.body !== undefined ? { body: result.body } : {}),
                ...(result.children !== undefined ? { children: result.children } : {}),
              })),
            }
          }),
        )
        if (result.usage) setLastAiUsage(result.usage)
        else setLastAiUsage({ promptTokens: 0, completionTokens: 0 })
        pushHeroBadge({
          mergePrefix: 'ai',
          dedupePrefix: 'ai',
          label: 'AI finished',
          tone: 'success',
          autoDismissMs: AI_FINISHED_BADGE_MS,
        })
      } catch (e) {
        setAiError(e instanceof Error ? e.message : 'AI iteration failed')
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, todos: markSeedTodosError(t.todos) } : t)),
        )
      } finally {
        setAiBusyId(null)
      }
    },
    [onAiIterate, pushHeroBadge],
  )

  useEffect(() => {
    const raw = researchPrompt.trim()
    if (!raw) return undefined
    const handle = window.setTimeout(() => {
      const stable = promptRef.current.trim()
      if (!stable || stable !== raw) return
      void runSeedFromPrompt('idle')
    }, SEED_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [researchPrompt, activeTabId, runSeedFromPrompt])

  const setResearchPrompt = useCallback(
    (value: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? { ...t, researchPrompt: value, ...(value.trim() === '' ? { lastSeedPrompt: '' } : {}) }
            : t,
        ),
      )
    },
    [activeTabId],
  )

  const setIngestQuery = useCallback(
    (value: string) => {
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, ingestQuery: value } : t)))
    },
    [activeTabId],
  )

  const setIngestKind = useCallback(
    (kind: IngestKind) => {
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, ingestKind: kind } : t)))
    },
    [activeTabId],
  )

  const setPaperGenreMode = useCallback(
    (mode: PaperGenreMode) => {
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, paperGenreMode: mode } : t)))
    },
    [activeTabId],
  )

  const applyPaperScaffold = useCallback(() => {
    const tabId = activeTabIdRef.current
    const snap = tabsRef.current.find((t) => t.id === tabId)
    const root = snap?.sections[0]
    if (!root) return
    const mode = snap.paperGenreMode ?? 'auto'
    const ws = shellContextRef.current.trim()
    const prompt = promptRef.current.trim()
    const resolved: PaperGenre = mode === 'auto' ? detectPaperGenre(`${prompt} ${ws}`) : mode
    const nextChildren = paperTemplateToSections(PAPER_TEMPLATES[resolved])
    if (root.children.length > 0) {
      if (
        !window.confirm(
          'Replace existing top-level sections under the article with this paper scaffold?',
        )
      ) {
        return
      }
    }
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t
        const rid = t.sections[0]?.id
        if (!rid) return t
        return { ...t, sections: mapSection(t.sections, rid, (s) => ({ ...s, children: nextChildren })) }
      }),
    )
  }, [])

  const submitIngestOrSearch = useCallback(() => {
    const raw = ingestQueryRef.current.trim()
    if (!raw) return
    const tabId = activeTabIdRef.current
    const kind = tabsRef.current.find((t) => t.id === tabId)?.ingestKind ?? 'transcript'

    if (looksLikeHttpUrl(raw)) {
      const req: TranscriptIngestRequest = { url: raw, tabId, kind }
      if (onTranscriptIngest) {
        onTranscriptIngest(req)
        setIngestStubFeedback(null)
      } else {
        const scope = INGEST_KIND_TABS.find((x) => x.kind === kind)?.label ?? kind
        setIngestStubFeedback(`Queued ${scope.toLowerCase()} ingest for ${raw}`)
      }
      return
    }

    if (onCorpusSearch) {
      onCorpusSearch(raw)
      setIngestStubFeedback(null)
    } else {
      setIngestStubFeedback(`Search: ${raw}`)
    }
  }, [onTranscriptIngest, onCorpusSearch])

  const updateField = useCallback(
    (id: string, field: 'title' | 'body', value: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                sections: mapSection(t.sections, id, (s) => ({
                  ...s,
                  [field]: value,
                })),
              }
            : t,
        ),
      )
    },
    [activeTabId],
  )

  const appendRoot = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId ? { ...t, sections: [...t.sections, newSection({ title: 'New section', body: '' })] } : t,
      ),
    )
  }, [activeTabId])

  const appendChild = useCallback(
    (parentId: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? { ...t, sections: addChild(t.sections, parentId, newSection({ title: 'New subsection', body: '' })) }
            : t,
        ),
      )
    },
    [activeTabId],
  )

  const deleteSection = useCallback(
    (id: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, sections: removeSection(t.sections, id) } : t)),
      )
    },
    [activeTabId],
  )

  const addPageTab = useCallback(() => {
    const next = createTab(emptyOutlineRoot())
    setTabs((prev) => [...prev, next])
    setActiveTabId(next.id)
  }, [setActiveTabId])

  const closePageTab = useCallback(
    (tabId: string) => {
      const prev = tabsRef.current
      if (prev.length <= 1) return
      const idx = prev.findIndex((t) => t.id === tabId)
      if (idx === -1) return
      const nextTabs = prev.filter((t) => t.id !== tabId)
      const wasActive = activeTabIdRef.current === tabId
      const nextActive =
        wasActive ? (prev[idx + 1]?.id ?? prev[idx - 1]?.id ?? nextTabs[0]!.id) : activeTabIdRef.current
      setTabs(nextTabs)
      if (wasActive) setActiveTabId(nextActive)
    },
    [setActiveTabId],
  )

  useEffect(() => {
    const ids = outline.map((o) => o.id)
    if (ids.length === 0) return

    const line = () => 96

    function sync() {
      const doc = document.documentElement
      const nearBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 48
      if (nearBottom) {
        setTocActiveId(ids[ids.length - 1] ?? null)
        return
      }
      let active = ids[0] ?? null
      for (const id of ids) {
        const el = document.getElementById(`section-${id}`)
        if (!el) continue
        const top = el.getBoundingClientRect().top
        if (top <= line()) active = id
      }
      setTocActiveId(active)
    }

    sync()
    window.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync, { passive: true })
    return () => {
      window.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  }, [outline])

  useEffect(() => {
    const el = tabScrollRef.current
    if (!el) return
    syncTabScrollEnds()
    el.addEventListener('scroll', syncTabScrollEnds, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncTabScrollEnds()) : null
    ro?.observe(el)
    window.addEventListener('resize', syncTabScrollEnds, { passive: true })
    return () => {
      el.removeEventListener('scroll', syncTabScrollEnds)
      ro?.disconnect()
      window.removeEventListener('resize', syncTabScrollEnds)
    }
  }, [syncTabScrollEnds, tabs])

  return (
    <div className="ro-shell" data-menu-open={menuOpen ? '' : undefined}>
      <input
        ref={importFileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onImportFileChange}
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Import workspace snapshot JSON file"
      />
      {shareLinkNotice ? (
        <p className="ro-share-notice" role="status" aria-live="polite">
          {shareLinkNotice}
        </p>
      ) : null}
      <div className="ro-shell-notes-stack" tabIndex={-1}>
        <div className="ro-shell-context-frame" tabIndex={-1} aria-expanded={shellContextExpanded}>
          {shellContextExpanded ? (
            <>
              <textarea
                id="ro-shell-context"
                ref={shellContextTextareaRef}
                className="ro-context-strip ro-shell-context"
                rows={2}
                aria-label="Workspace notes and broader context"
                aria-describedby={shellNotesHintId}
                placeholder="Workspace notes (optional) — shared across tabs; included in AI seed / expand / refine requests."
                value={shellContext}
                spellCheck
                disabled={Boolean(aiBusyId)}
                onFocus={() => setShellContextFocused(true)}
                onBlur={() => {
                  setShellContextFocused(false)
                  const hasText = shellContextRef.current.trim().length > 0
                  setWorkspaceNotesPinnedOpen(hasText)
                }}
                onChange={(e) => {
                  setShellContext(e.target.value)
                  updateShellNotesCaret()
                }}
                onSelect={updateShellNotesCaret}
                onKeyUp={updateShellNotesCaret}
                onClick={updateShellNotesCaret}
                onPaste={onShellContextPaste}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault()
                    void sendWorkspaceAssistantFromNotes()
                    return
                  }
                  if (
                    waQuickReplyActive &&
                    latestWorkspaceAssistantMsg &&
                    e.altKey &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.shiftKey
                  ) {
                    const k = e.key.toLowerCase()
                    if (k === 'y') {
                      e.preventDefault()
                      appendWorkspaceQuickAck('Yes')
                      setWaQuickReplyDismissedForId(latestWorkspaceAssistantMsg.id)
                      return
                    }
                    if (k === 'n') {
                      e.preventDefault()
                      appendWorkspaceQuickAck('No')
                      setWaQuickReplyDismissedForId(latestWorkspaceAssistantMsg.id)
                    }
                  }
                }}
              />
              <p className="ro-shell-notes-hint" id={shellNotesHintId}>
                Ctrl+Enter (⌘ Enter on Mac): ask assistant.
                {waQuickReplyActive ? ' Alt+Y / Alt+N: quick Yes / No when notes are focused.' : ''}
              </p>
            </>
          ) : (
            <button
              type="button"
              className="ro-shell-context-collapsed"
              aria-controls="ro-shell-context"
              aria-expanded={shellContextExpanded}
              onClick={() => {
                setShellContextFocused(true)
                setWorkspaceNotesPinnedOpen(true)
              }}
            >
              <span>Workspace notes...</span>
              <span className="ro-shell-context-chevron" aria-hidden="true">
                +
              </span>
            </button>
          )}
        </div>
        {linkMetaHint ? (
          <p className="ro-url-metadata-offer" role="status" aria-live="polite" tabIndex={-1}>
            <span className="ro-url-metadata-offer-url">{linkMetaHint.url}</span>
            <span className="ro-url-metadata-offer-sep"> — </span>
            {linkMetaHint.text}
          </p>
        ) : null}
        <section
          className="ro-workspace-assistant"
          tabIndex={-1}
          aria-labelledby={workspaceAssistantSectionLabelId}
        >
          <div id={workspaceAssistantSectionLabelId} className="ro-wa-strip-title">
            Workspace assistant
          </div>
          <div className="ro-wa-thread" tabIndex={-1} role="log" aria-live="polite" aria-relevant="additions">
            {workspaceAssistantMessages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} tabIndex={-1} className="ro-wa-bubble ro-wa-bubble-user">
                  <div className="ro-wa-bubble-label">You</div>
                  <p className="ro-wa-bubble-text">{m.text}</p>
                </div>
              ) : (
                <div key={m.id} tabIndex={-1} className="ro-wa-bubble ro-wa-bubble-assistant">
                  <div className="ro-wa-bubble-label">Assistant</div>
                  {m.editing ? (
                    <textarea
                      className="ro-wa-edit-field ro-context-strip"
                      rows={3}
                      value={m.text}
                      disabled={workspaceAssistantBusy}
                      onChange={(e) => setAssistantDraftText(m.id, e.target.value)}
                      aria-label="Edit assistant reply"
                    />
                  ) : (
                    <p className="ro-wa-bubble-text">{m.text}</p>
                  )}
                  <div className="ro-wa-assistant-actions" role="group" aria-label="Assistant reply actions">
                    <button type="button" className="ro-btn ro-btn-ghost" onClick={() => toggleAssistantEdit(m.id)}>
                      {m.editing ? 'Done' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      className="ro-btn ro-btn-ghost"
                      disabled={workspaceAssistantBusy}
                      onClick={() => void regenerateWorkspaceAssistant(m.id)}
                    >
                      Regenerate
                    </button>
                    <button
                      type="button"
                      className="ro-btn ro-btn-ghost"
                      disabled={Boolean(aiBusyId)}
                      onClick={() => acceptAssistantIntoNotes(m.id)}
                    >
                      Accept
                    </button>
                  </div>
                </div>
              ),
            )}
            {waQuickReplyActive && latestWorkspaceAssistantMsg ? (
              <div className="ro-wa-quick-replies" role="group" aria-label="Quick reply to latest assistant message">
                <button
                  type="button"
                  className="ro-btn ro-btn-ghost ro-wa-quick-reply"
                  onClick={() => {
                    appendWorkspaceQuickAck('Yes')
                    setWaQuickReplyDismissedForId(latestWorkspaceAssistantMsg.id)
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="ro-btn ro-btn-ghost ro-wa-quick-reply"
                  onClick={() => {
                    appendWorkspaceQuickAck('No')
                    setWaQuickReplyDismissedForId(latestWorkspaceAssistantMsg.id)
                  }}
                >
                  No
                </button>
                <button
                  type="button"
                  className="ro-btn ro-btn-ghost ro-wa-quick-reply"
                  onClick={() => setWaQuickReplyDismissedForId(latestWorkspaceAssistantMsg.id)}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <div className="ro-tab-bar" role="tablist" aria-label="Research pages">
        <div ref={tabScrollRef} className="ro-tab-scroll">
          {tabs.map((t) => (
            <div
              key={t.id}
              role="tab"
              tabIndex={t.id === activeTabId ? 0 : -1}
              aria-selected={t.id === activeTabId}
              className={`ro-tab${t.id === activeTabId ? ' is-active' : ''}`}
              onClick={() => setActiveTabId(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setActiveTabId(t.id)
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  closePageTab(t.id)
                }
              }}
            >
              <span className="ro-tab-label">{tabLabel(t)}</span>
              {tabs.length > 1 ? (
                <button
                  type="button"
                  className="ro-tab-close"
                  aria-label={`Close ${tabLabel(t)}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    closePageTab(t.id)
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="ro-tab-actions">
          <button
            type="button"
            className="ro-btn ro-btn-ghost ro-tab-scroll-btn"
            aria-label="Scroll tabs left"
            title="Scroll tabs left"
            disabled={tabScrollEnds.atStart}
            onClick={() => scrollTabsBy(-1)}
          >
            <span className="ro-tab-scroll-btn-glyph" aria-hidden="true">
              ‹
            </span>
          </button>
          <button
            type="button"
            className="ro-btn ro-btn-ghost ro-tab-scroll-btn"
            aria-label="Scroll tabs right"
            title="Scroll tabs right"
            disabled={tabScrollEnds.atEnd}
            onClick={() => scrollTabsBy(1)}
          >
            <span className="ro-tab-scroll-btn-glyph" aria-hidden="true">
              ›
            </span>
          </button>
          <button type="button" className="ro-tab-add" onClick={addPageTab} aria-label="New research page" title="New page">
            +
          </button>
        </div>
      </div>

      <header className="ro-hero">
        <input
          type="text"
          className="ro-kicker ro-kicker-input"
          aria-label="Research topic or prompt"
          placeholder="Research overview"
          value={researchPrompt}
          autoComplete="off"
          spellCheck={false}
          disabled={Boolean(aiBusyId)}
          onChange={(e) => setResearchPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            void runSeedFromPrompt('enter')
          }}
          onBlur={() => {
            void runSeedFromPrompt('blur')
          }}
        />
        <div className="ro-hero-title-row">
          <div className="ro-hero-title-slot">
            <h1 className="ro-title">Recursive outline</h1>
            <div className="ro-hero-badges" aria-live="polite" aria-label="Workspace notifications">
              {heroBadges.map((b) => (
                <div key={b.id} className={`ro-hero-badge ro-hero-badge--${b.tone}`}>
                  <span className="ro-hero-badge-text">{b.label}</span>
                  <button
                    type="button"
                    className="ro-hero-badge-dismiss"
                    aria-label={`Dismiss ${b.label}`}
                    onClick={() => dismissHeroBadge(b.mergePrefix)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="ro-ingest-stack">
            <div className="ro-ingest-field">
              <input
                type="text"
                className="ro-ingest-input"
                aria-label="Paste playlist or video URL, or search the corpus"
                placeholder="Paste playlist/video URL or search…"
                value={ingestQuery}
                autoComplete="off"
                spellCheck={false}
                disabled={Boolean(aiBusyId)}
                onChange={(e) => setIngestQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  submitIngestOrSearch()
                }}
              />
              <button
                type="button"
                className="ro-btn ro-btn-ghost ro-ingest-submit"
                aria-label="Submit URL or search"
                disabled={Boolean(aiBusyId) || !ingestQuery.trim()}
                onClick={() => submitIngestOrSearch()}
              >
                Go
              </button>
            </div>
            {showIngestKindTabs ? (
              <div className="ro-ingest-kind-tabs" role="tablist" aria-label="Ingest scope">
                {INGEST_KIND_TABS.map(({ kind, label }) => {
                  const selected = ingestKind === kind
                  return (
                    <button
                      key={kind}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      className={`ro-ingest-kind-tab${selected ? ' is-active' : ''}`}
                      onClick={() => setIngestKind(kind)}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
        {ingestStubFeedback ? (
          <p className="ro-ingest-status muted" role="status" aria-live="polite">
            {ingestStubFeedback}
          </p>
        ) : null}
        <p className="ro-lead muted">
          Wikipedia-style hierarchy: article → sections → subsections. Type a topic in the line above — after a short
          pause it seeds the outline; press Enter for an immediate run; leaving the field also commits when the text
          changed. Uses an offline stub until you wire onAiIterate. Expand / Refine on each card still call the same
          hook.
        </p>
      </header>

      {aiError ? (
        <div className="ro-banner" role="status">
          {aiError}
        </div>
      ) : null}

      <div className="ro-layout">
        <nav className="ro-toc" aria-labelledby="ro-toc-heading">
          <p id="ro-toc-heading" className="ro-toc-title">
            Outline
          </p>
          <ul className="ro-toc-list">
            {outline.map((row) => (
              <li key={row.id} className="ro-toc-item" style={{ paddingLeft: `${8 + row.depth * 12}px` }}>
                <a
                  className={`ro-toc-link${tocActiveId === row.id ? ' is-active' : ''}`}
                  href={`#section-${row.id}`}
                >
                  {row.title}
                </a>
              </li>
            ))}
          </ul>

          <div className="ro-progress" aria-labelledby="ro-progress-heading" aria-live="polite">
            <p id="ro-progress-heading" className="ro-progress-title">
              Progress
            </p>
            {tabTodos.length === 0 ? (
              <p className="ro-todo-empty muted">Idle — no AI steps yet</p>
            ) : (
              <ul className="ro-todo-list">
                {tabTodos.map((todo) => (
                  <li key={todo.id} className={`ro-todo ro-todo-${todo.status}`}>
                    <span className="ro-todo-glyph" aria-hidden title={todo.status}>
                      {todo.status === 'done'
                        ? '✓'
                        : todo.status === 'error'
                          ? '!'
                          : todo.status === 'in_progress'
                            ? '›'
                            : '·'}
                    </span>
                    <span className="ro-todo-label">{todo.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button type="button" className="ro-btn ro-btn-ghost ro-toc-add" onClick={appendRoot}>
            + Top-level section
          </button>
        </nav>

        <main className="ro-main">
          {sections.map((s) => (
            <SectionBlock
              key={s.id}
              section={s}
              depth={0}
              aiBusyId={aiBusyId}
              onChangeTitle={(id, v) => updateField(id, 'title', v)}
              onChangeBody={(id, v) => updateField(id, 'body', v)}
              onAddChild={appendChild}
              onDelete={deleteSection}
              onAi={runExpandOrRefine}
            />
          ))}
        </main>
      </div>

      {captureGallery.length > 0 ? (
        <section className="ro-capture-gallery" aria-label="Session capture gallery">
          <div className="ro-capture-gallery-head">
            <h2 className="ro-capture-gallery-title">Capture gallery</h2>
            <button type="button" className="ro-btn ro-btn-ghost ro-capture-gallery-clear" onClick={clearCaptureGallery}>
              Clear all
            </button>
          </div>
          <p className="ro-capture-gallery-hint muted">
            Session only — scroll horizontally. Hold Shift and use the mouse wheel to scroll sideways.
          </p>
          <div
            ref={captureGalleryStripRef}
            className="ro-capture-gallery-strip"
          >
            {captureGallery.map((item) => (
              <div key={item.id} className="ro-capture-gallery-thumb-wrap">
                <button
                  type="button"
                  className="ro-capture-gallery-thumb"
                  onClick={() => openCapturePreview(item)}
                  aria-label={`Open preview: ${item.label}`}
                >
                  <img src={item.dataUrl} width={120} alt="" decoding="async" />
                </button>
                <button
                  type="button"
                  className="ro-capture-gallery-remove"
                  aria-label={`Remove capture: ${item.label}`}
                  onClick={() => removeCaptureGalleryItem(item.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <button
        ref={menuFabRef}
        type="button"
        className="ro-menu-fab"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        aria-controls={menuDrawerId}
        onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
      >
        <span className="ro-menu-fab-glyph" aria-hidden="true">
          ☰
        </span>
        <span className="ro-menu-fab-label">Menu</span>
      </button>

      {menuOpen ? (
        <div className={`ro-drawer${drawerEntered ? ' is-open' : ''}`}>
          <button
            type="button"
            className="ro-drawer-scrim"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={closeMenu}
          />
          <div
            id={menuDrawerId}
            className="ro-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
          >
            <header className="ro-drawer-header">
              <h2 id={drawerTitleId} className="ro-drawer-title">
                Menu
              </h2>
              <button
                ref={drawerCloseRef}
                type="button"
                className="ro-drawer-close"
                aria-label="Close menu"
                onClick={closeMenu}
              >
                ×
              </button>
            </header>
            <nav className="ro-drawer-nav" aria-label="Overview menu">
              <details
                className="ro-drawer-section"
                open={drawerDetailsOpen.paperGenre}
                onToggle={(e) => persistDrawerDetail('paperGenre', e.currentTarget.open)}
              >
                <summary className="ro-drawer-section-title">Paper genre</summary>
                <div className="ro-drawer-section-body">
                  <div className="ro-drawer-genre-row ro-genre-bar">
                    <label className="ro-genre-label">
                      <span className="ro-genre-label-text">Genre</span>
                      <select
                        className="ro-genre-select"
                        aria-label="Paper scaffold genre"
                        value={paperGenreMode}
                        disabled={Boolean(aiBusyId)}
                        onChange={(e) => setPaperGenreMode(e.target.value as PaperGenreMode)}
                      >
                        {PAPER_GENRE_SELECT_OPTIONS.map(({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {paperGenreMode === 'auto' ? (
                      <span className="ro-genre-hint muted" aria-live="polite">
                        Heuristic: {paperGenreHintLabel}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="ro-btn ro-btn-ghost ro-genre-apply"
                      aria-label="Apply paper scaffold"
                      disabled={Boolean(aiBusyId)}
                      onClick={() => applyPaperScaffold()}
                    >
                      Apply paper scaffold
                    </button>
                  </div>
                </div>
              </details>

              <details
                className="ro-drawer-section"
                open={drawerDetailsOpen.actions}
                onToggle={(e) => persistDrawerDetail('actions', e.currentTarget.open)}
              >
                <summary className="ro-drawer-section-title">Actions</summary>
                <div className="ro-drawer-section-body">
                  <ul className="ro-drawer-list">
                    <li>
                      <button type="button" className="ro-drawer-item" onClick={exportWorkspaceFile}>
                        Export workspace JSON
                        <span className="ro-drawer-item-hint muted">overview-workspace.json</span>
                      </button>
                    </li>
                    <li>
                      <button type="button" className="ro-drawer-item" onClick={() => void copyWorkspaceShareLink()}>
                        Copy workspace share link
                        <span className="ro-drawer-item-hint muted">#workspace-share</span>
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="ro-drawer-item"
                        onClick={() => importFileInputRef.current?.click()}
                      >
                        Import workspace…
                        <span className="ro-drawer-item-hint muted">JSON</span>
                      </button>
                    </li>
                    <li>
                      <details
                        className="ro-drawer-nested"
                        open={drawerDetailsOpen.actionsShortcuts}
                        onToggle={(e) => persistDrawerDetail('actionsShortcuts', e.currentTarget.open)}
                      >
                        <summary className="ro-drawer-item-summary">
                          <span className="ro-drawer-item-hint muted">Help</span>
                        </summary>
                        <ul className="ro-drawer-shortcuts muted">
                          <li>
                            <kbd className="ro-kbd">Esc</kbd> Close menu drawer
                          </li>
                          <li>
                            Hero field <kbd className="ro-kbd">Enter</kbd> Submit URL or corpus search
                          </li>
                        </ul>
                      </details>
                    </li>
                    <li>
                      <details
                        className="ro-drawer-nested"
                        open={drawerDetailsOpen.actionsAbout}
                        onToggle={(e) => persistDrawerDetail('actionsAbout', e.currentTarget.open)}
                      >
                        <summary className="ro-drawer-item-summary">
                          <span className="ro-drawer-item-hint muted">App</span>
                        </summary>
                        <p className="ro-drawer-about muted">
                          Local research outline shell: markdown sections, offline AI stubs, and workspace snapshots. Wire{' '}
                          <code className="ro-drawer-code">onAiIterate</code> for your provider.
                        </p>
                      </details>
                    </li>
                  </ul>
                </div>
              </details>

              <details
                className="ro-drawer-section"
                open={drawerDetailsOpen.files}
                onToggle={(e) => persistDrawerDetail('files', e.currentTarget.open)}
              >
                <summary className="ro-drawer-section-title">File management</summary>
                <div className="ro-drawer-section-body">
                  <div className="ro-drawer-field">
                    <label className="ro-drawer-label" htmlFor={drawerAttachInputId}>
                      Attach files (session only)
                    </label>
                    <input
                      id={drawerAttachInputId}
                      ref={drawerAttachInputRef}
                      type="file"
                      multiple
                      className="ro-drawer-file-input"
                      aria-label="Attach files for this session only; not uploaded to any server"
                      onChange={onDrawerAttachChange}
                    />
                  </div>
                  {attachments.length > 0 ? (
                    <div className="ro-drawer-file-toolbar">
                      <label className="ro-drawer-label visually-hidden" htmlFor={drawerAttachFilterId}>
                        Filter attachments by name
                      </label>
                      <input
                        id={drawerAttachFilterId}
                        type="search"
                        enterKeyHint="search"
                        className="ro-drawer-input ro-drawer-file-filter"
                        placeholder="Filter attachments…"
                        value={attachmentSearchQuery}
                        onChange={(e) => setAttachmentSearchQuery(e.target.value)}
                        autoComplete="off"
                      />
                      <div className="ro-drawer-file-toolbar-actions">
                        <button
                          type="button"
                          className="ro-btn ro-btn-ghost ro-drawer-file-sort"
                          aria-label={
                            attachmentSortMode === 'name'
                              ? 'Sorted by file name ascending. Activate to sort by size descending.'
                              : 'Sorted by file size descending. Activate to sort by name ascending.'
                          }
                          onClick={() =>
                            setAttachmentSortMode((m) => (m === 'name' ? 'size' : 'name'))
                          }
                        >
                          {attachmentSortMode === 'name' ? 'Name ↑' : 'Size ↓'}
                        </button>
                        <button
                          type="button"
                          className="ro-btn ro-btn-ghost ro-drawer-file-clear"
                          onClick={clearAllAttachments}
                        >
                          Clear all
                        </button>
                      </div>
                      {attachmentDuplicateKeys.size > 0 ? (
                        <p className="ro-drawer-file-dup-hint muted" role="note">
                          Some files share the same normalized name (trim, case-insensitive).
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {attachments.length === 0 ? (
                    <p className="ro-drawer-empty muted">No attached files.</p>
                  ) : filteredSortedAttachments.length === 0 ? (
                    <p className="ro-drawer-empty muted">No attachments match the filter.</p>
                  ) : (
                    <ul className="ro-drawer-attach-list" aria-label="Attached files">
                      {filteredSortedAttachments.map((a) => {
                        const isDup = attachmentDuplicateKeys.has(normalizeAttachmentName(a.name))
                        return (
                          <li
                            key={a.id}
                            className={`ro-drawer-attach-row${isDup ? ' ro-drawer-attach-row--dup' : ''}`}
                          >
                            <div className="ro-drawer-attach-meta">
                              <span className="ro-drawer-attach-name" title={a.name}>
                                {a.name}
                              </span>
                              <span className="ro-drawer-attach-sub muted">
                                {formatBytes(a.size)} · {a.type || 'unknown'}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="ro-btn ro-btn-ghost ro-drawer-attach-remove"
                              aria-label={`Remove ${a.name}`}
                              onClick={() => removeAttachment(a.id)}
                            >
                              Remove
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </details>

              <details
                className="ro-drawer-section"
                open={drawerDetailsOpen.aiLinking}
                onToggle={(e) => persistDrawerDetail('aiLinking', e.currentTarget.open)}
              >
                <summary className="ro-drawer-section-title ro-drawer-section-title-row">
                  <span>AI linking</span>
                  {drawerAi.linked ? (
                    <span className="ro-drawer-pill" aria-label="AI settings saved for this browser tab session">
                      Connected
                    </span>
                  ) : null}
                </summary>
                <div className="ro-drawer-section-body">
                  <p className="ro-drawer-warn muted" role="note">
                    API keys are stored only in <code className="ro-drawer-code">sessionStorage</code> for this tab.
                    They are not included in workspace JSON exports.
                  </p>
                  <div className="ro-drawer-field">
                    <label className="ro-drawer-label" htmlFor={aiBaseUrlId}>
                      Base URL (optional)
                    </label>
                    <input
                      id={aiBaseUrlId}
                      type="url"
                      className="ro-drawer-input"
                      placeholder="https://api.example.com/v1"
                      autoComplete="off"
                      value={drawerAi.baseUrl}
                      onChange={(e) => setDrawerAi((p) => ({ ...p, baseUrl: e.target.value }))}
                    />
                  </div>
                  <div className="ro-drawer-field">
                    <label className="ro-drawer-label" htmlFor={aiModelId}>
                      Model name (optional)
                    </label>
                    <input
                      id={aiModelId}
                      type="text"
                      className="ro-drawer-input"
                      placeholder="e.g. gpt-4o-mini"
                      autoComplete="off"
                      value={drawerAi.modelName}
                      onChange={(e) => setDrawerAi((p) => ({ ...p, modelName: e.target.value }))}
                    />
                  </div>
                  <div className="ro-drawer-field">
                    <label className="ro-drawer-label" htmlFor={aiKeyId}>
                      API key (optional)
                    </label>
                    <input
                      id={aiKeyId}
                      type="password"
                      className="ro-drawer-input"
                      autoComplete="off"
                      value={drawerAi.apiKey}
                      onChange={(e) => setDrawerAi((p) => ({ ...p, apiKey: e.target.value }))}
                    />
                  </div>
                  <div className="ro-drawer-actions">
                    <button type="button" className="ro-btn ro-btn-accent" onClick={saveDrawerAiConfig}>
                      Connect / Save
                    </button>
                    <button type="button" className="ro-btn ro-btn-ghost" onClick={clearDrawerAiConfig}>
                      Disconnect
                    </button>
                  </div>
                </div>
              </details>

              <details
                className="ro-drawer-section"
                open={drawerDetailsOpen.quickNotes}
                onToggle={(e) => persistDrawerDetail('quickNotes', e.currentTarget.open)}
              >
                <summary className="ro-drawer-section-title">Quick notes</summary>
                <div className="ro-drawer-section-body">
                  <label className="ro-drawer-label visually-hidden" htmlFor={drawerNotesId}>
                    Drawer quick notes
                  </label>
                  <textarea
                    id={drawerNotesId}
                    className="ro-drawer-textarea"
                    rows={4}
                    aria-label="Drawer quick notes, separate from workspace notes above"
                    placeholder="Scratchpad for this drawer only — included in workspace export."
                    value={drawerQuickNotes}
                    spellCheck
                    onChange={(e) => setDrawerQuickNotes(e.target.value)}
                  />
                </div>
              </details>

              <details
                className="ro-drawer-section"
                open={drawerDetailsOpen.media}
                onToggle={(e) => persistDrawerDetail('media', e.currentTarget.open)}
              >
                <summary className="ro-drawer-section-title">Images · Stream · Chat</summary>
                <div className="ro-drawer-section-body">
                  <div className="ro-drawer-subtabs" role="tablist" aria-label="Drawer media panel">
                    {(['images', 'stream', 'chat'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={drawerMediaTab === tab}
                        tabIndex={drawerMediaTab === tab ? 0 : -1}
                        className={`ro-drawer-subtab${drawerMediaTab === tab ? ' is-active' : ''}`}
                        onClick={() => setDrawerMediaTab(tab)}
                      >
                        {tab === 'images' ? 'Images' : tab === 'stream' ? 'Stream' : 'Chat'}
                      </button>
                    ))}
                  </div>
                  {drawerMediaTab === 'images' ? (
                    <div className="ro-drawer-subpanel" role="tabpanel">
                      <div className="ro-drawer-field">
                        <label className="ro-drawer-label" htmlFor={drawerImgUrlInputId}>
                          Image URL
                        </label>
                        <div className="ro-drawer-inline">
                          <input
                            id={drawerImgUrlInputId}
                            type="url"
                            className="ro-drawer-input"
                            placeholder="https://…"
                            value={drawerImgUrlField}
                            onChange={(e) => setDrawerImgUrlField(e.target.value)}
                          />
                          <button type="button" className="ro-btn ro-btn-ghost" onClick={applyDrawerImageFromUrl}>
                            Load
                          </button>
                        </div>
                      </div>
                      <div className="ro-drawer-field">
                        <label className="ro-drawer-label" htmlFor={drawerImagePickId}>
                          Or choose image file
                        </label>
                        <input
                          id={drawerImagePickId}
                          type="file"
                          accept="image/*"
                          className="ro-drawer-file-input"
                          aria-label="Choose a local image file to preview"
                          onChange={onDrawerImageFilePick}
                        />
                      </div>
                      <div className="ro-drawer-img-frame">
                        {drawerImgPreviewSrc ? (
                          <img className="ro-drawer-img-preview" src={drawerImgPreviewSrc} alt="Drawer image preview" />
                        ) : (
                          <p className="ro-drawer-empty muted">No image loaded.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                  {drawerMediaTab === 'stream' ? (
                    <div className="ro-drawer-subpanel" role="tabpanel">
                      <p className="muted">Stream URL (stub)</p>
                      <div className="ro-drawer-video-placeholder" aria-hidden="true" />
                    </div>
                  ) : null}
                  {drawerMediaTab === 'chat' ? (
                    <div className="ro-drawer-subpanel ro-drawer-chat" role="tabpanel">
                      <ul className="ro-drawer-chat-list" aria-label="Local chat messages">
                        {drawerChatMessages.map((m) => (
                          <li key={m.id} className="ro-drawer-chat-msg">
                            <span className="ro-drawer-chat-text">{m.text}</span>
                            <span className="ro-drawer-chat-time muted">{new Date(m.at).toLocaleTimeString()}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="ro-drawer-chat-input-row">
                        <label className="visually-hidden" htmlFor={drawerChatFieldId}>
                          Chat message
                        </label>
                        <input
                          id={drawerChatFieldId}
                          type="text"
                          className="ro-drawer-input"
                          placeholder="Message (local only)"
                          value={drawerChatInput}
                          onChange={(e) => setDrawerChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return
                            e.preventDefault()
                            sendDrawerChat()
                          }}
                        />
                        <button type="button" className="ro-btn ro-btn-accent" onClick={sendDrawerChat}>
                          Send
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>

              <details
                className="ro-drawer-section"
                open={drawerDetailsOpen.themePreview}
                onToggle={(e) => persistDrawerDetail('themePreview', e.currentTarget.open)}
              >
                <summary className="ro-drawer-section-title">Day / Night preview</summary>
                <div className="ro-drawer-section-body">
                  <ThemeSplitPreview ref={themeSplitRef} />
                </div>
              </details>

              <details
                className="ro-drawer-section"
                open={drawerDetailsOpen.capture}
                onToggle={(e) => persistDrawerDetail('capture', e.currentTarget.open)}
              >
                <summary className="ro-drawer-section-title">Capture</summary>
                <div className="ro-drawer-section-body">
                  <p className="ro-drawer-warn muted" role="note">
                    Renders a PNG client-side via{' '}
                    <code className="ro-drawer-code">html-to-image</code> (dynamic chunk). Cross-origin
                    images may be skipped by the browser.
                  </p>
                  <label className="ro-drawer-checkbox-row">
                    <input
                      type="checkbox"
                      checked={snapshotDownloadPng}
                      onChange={(e) => setSnapshotDownloadPng(e.target.checked)}
                    />
                    <span>Also download PNG file</span>
                  </label>
                  <div className="ro-drawer-capture-actions">
                    <button
                      type="button"
                      className="ro-btn ro-btn-accent"
                      disabled={captureBusy}
                      onClick={() => void runShellSnapshot()}
                    >
                      {captureBusy ? 'Working…' : 'Snapshot workspace shell'}
                    </button>
                    <button
                      type="button"
                      className="ro-btn"
                      disabled={captureBusy}
                      onClick={() => void runSplitSnapshot()}
                    >
                      Snapshot split preview
                    </button>
                  </div>
                  {captureStatus ? (
                    <p
                      className={`ro-drawer-capture-status${captureStatus.isError ? ' ro-drawer-capture-status--error' : ''}`}
                      role="status"
                      aria-live="polite"
                    >
                      {captureStatus.text}
                    </p>
                  ) : null}
                </div>
              </details>

              <details
                className="ro-drawer-section"
                open={drawerDetailsOpen.sketch}
                onToggle={(e) => persistDrawerDetail('sketch', e.currentTarget.open)}
              >
                <summary className="ro-drawer-section-title">Sketch</summary>
                <div className="ro-drawer-section-body">
                  <p className="ro-drawer-sketch-hint muted">
                    Mounts <code className="ro-drawer-code">@excalidraw/excalidraw</code> on demand
                    (separate chunk). Same lazy panel used in the Presentation page.
                  </p>
                  {sketchEnabled ? (
                    <div className="ro-drawer-sketch-frame" aria-label="Sketch pad">
                      <ExcalidrawLazyPanel
                        fallback={<div className="ro-drawer-sketch-fallback">Loading sketch pad…</div>}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="ro-btn ro-btn-accent"
                      onClick={() => setSketchEnabled(true)}
                    >
                      Open sketch pad
                    </button>
                  )}
                </div>
              </details>
            </nav>
          </div>
        </div>
      ) : null}

      <dialog
        ref={capturePreviewDialogRef}
        className="ro-capture-preview-dialog"
        onClose={() => setCapturePreview(null)}
        onClick={(e) => {
          if (e.target === capturePreviewDialogRef.current) {
            capturePreviewDialogRef.current?.close()
          }
        }}
      >
        <div className="ro-capture-preview-dialog-box" onClick={(e) => e.stopPropagation()}>
          <header className="ro-capture-preview-dialog-header">
            <h2 className="ro-capture-preview-dialog-title">{capturePreview?.label ?? 'Capture'}</h2>
            <form method="dialog">
              <button type="submit" className="ro-btn ro-btn-ghost">
                Close
              </button>
            </form>
          </header>
          {capturePreview ? (
            <img
              className="ro-capture-preview-dialog-img"
              src={capturePreview.dataUrl}
              alt={capturePreview.label}
            />
          ) : null}
        </div>
      </dialog>

      {onOpenSummary || onOpenPresentation ? (
        <footer className="ro-app-footer">
          <div className="ro-app-footer-status" aria-live="polite" title={footerStatusText}>
            {footerStatusText}
          </div>
          <div className="ro-app-footer-links">
            {onOpenSummary ? (
              <button type="button" className="ro-app-footer-link" onClick={onOpenSummary}>
                Summary
              </button>
            ) : null}
            {onOpenSummary && onOpenPresentation ? (
              <span className="ro-app-footer-sep" aria-hidden>
                ·
              </span>
            ) : null}
            {onOpenPresentation ? (
              <button type="button" className="ro-app-footer-link" onClick={onOpenPresentation}>
                Presentation
              </button>
            ) : null}
          </div>
        </footer>
      ) : null}
    </div>
  )
}

type BlockProps = {
  section: ResearchSection
  depth: number
  aiBusyId: string | null
  onChangeTitle: (id: string, value: string) => void
  onChangeBody: (id: string, value: string) => void
  onAddChild: (parentId: string) => void
  onDelete: (id: string) => void
  onAi: (kind: 'expand' | 'refine', id: string) => void
}

function SectionBlock({
  section,
  depth,
  aiBusyId,
  onChangeTitle,
  onChangeBody,
  onAddChild,
  onDelete,
  onAi,
}: BlockProps) {
  const busy = aiBusyId === section.id
  const HeadingTag = depth === 0 ? 'h2' : depth === 1 ? 'h3' : 'h4'
  const [bodyMode, setBodyMode] = useState<'edit' | 'preview'>('edit')

  return (
    <article
      id={`section-${section.id}`}
      className={`ro-section ro-depth-${Math.min(depth, 3)}`}
      data-section-id={section.id}
    >
      <HeadingTag className="ro-heading-slot">
        <input
          className="ro-title-input"
          aria-label="Section title"
          value={section.title}
          placeholder="Section title"
          onChange={(e) => onChangeTitle(section.id, e.target.value)}
        />
      </HeadingTag>

      <div className="ro-body-stack">
        <div className="ro-body-mode" role="tablist" aria-label="Section body mode">
          <button
            type="button"
            role="tab"
            aria-selected={bodyMode === 'edit'}
            className={`ro-body-mode-btn${bodyMode === 'edit' ? ' is-active' : ''}`}
            onClick={() => setBodyMode('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={bodyMode === 'preview'}
            className={`ro-body-mode-btn${bodyMode === 'preview' ? ' is-active' : ''}`}
            onClick={() => setBodyMode('preview')}
          >
            Preview
          </button>
        </div>
        {bodyMode === 'edit' ? (
          <textarea
            className="ro-body"
            aria-label="Section body"
            value={section.body}
            placeholder="Markdown, fenced code blocks, $inline$ and $$ display $$ math."
            rows={6}
            onChange={(e) => onChangeBody(section.id, e.target.value)}
          />
        ) : (
          <div className="ro-md-preview" aria-label="Section body preview">
            <ResearchMarkdownPreview markdown={section.body} />
          </div>
        )}
      </div>

      <div className="ro-toolbar">
        <button type="button" className="ro-btn" onClick={() => onAddChild(section.id)} disabled={busy}>
          + Subsection
        </button>
        <button type="button" className="ro-btn ro-btn-accent" disabled={busy} onClick={() => onAi('expand', section.id)}>
          {busy ? 'Working…' : 'Expand (AI)'}
        </button>
        <button type="button" className="ro-btn ro-btn-accent" disabled={busy} onClick={() => onAi('refine', section.id)}>
          Refine (AI)
        </button>
        <button type="button" className="ro-btn ro-btn-danger" disabled={busy} onClick={() => onDelete(section.id)}>
          Remove
        </button>
      </div>

      {section.children.length > 0 ? (
        <div className="ro-children">
          {section.children.map((ch) => (
            <SectionBlock
              key={ch.id}
              section={ch}
              depth={depth + 1}
              aiBusyId={aiBusyId}
              onChangeTitle={onChangeTitle}
              onChangeBody={onChangeBody}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onAi={onAi}
            />
          ))}
        </div>
      ) : null}
    </article>
  )
}
