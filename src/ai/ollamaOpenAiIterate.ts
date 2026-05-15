import type {
  AiIterateRequest,
  AiIterateResult,
  ResearchSection,
  WorkspaceAssistantRequest,
} from '../research/research-types'
import { paperGenreIterateGuidance, paperGenreSeedGuidance } from '../research/paper-templates'
import { readDrawerAiFromSession } from '../research/drawerAiSession'
import { newSection } from '../research/research-tree'
import overviewIterateBundled from '../config/overview-iterate.manifest.json'

export type OverviewIterateManifest = {
  openAiCompatibleBaseUrl?: string
  chatModel?: string
}

/** Dev/preview proxy path — mirrors `vite.config.ts` `/ollama-proxy` → `:11434`. */
export const OLLAMA_DEV_PROXY_PREFIX = '/ollama-proxy'

const bundled = overviewIterateBundled as OverviewIterateManifest

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

function roughTok(s: string): number {
  return Math.max(0, Math.ceil(s.length / 4))
}

function wsSnippet(ws: string | undefined): string {
  const t = (ws ?? '').trim()
  if (!t) return ''
  const clip = t.length > 4200 ? `${t.slice(0, 4180)}\n…` : t
  return `\n\nWorkspace notes:\n"""${clip}"""\n`
}

function systemPrompt(kind: AiIterateRequest['kind']): string {
  const common =
    'You emit one JSON object only (no prose, no markdown fences). Fields optional by mode; omit unknown keys. '
  const shape =
    'Shape: {"title":string|null,"body":string|null,"children":OutlineNode[]|null}. ' +
    'OutlineNode = {"title":string,"body":string,"children":OutlineNode[]}. Omit "id" fields.'
  if (kind === 'seed') {
    return `${common}${shape} Seed: title+body = root article framing; children = full hierarchical outline under it. Prefer actionable section titles + substantive paragraph bodies where useful. `
  }
  if (kind === 'expand') {
    return `${common}${shape} Expand: children only — one or MORE new child subsections to append under current section (each with nested children optional). Omit title unless renaming. Omit body unless you must patch inline. `
  }
  return `${common}${shape} Refine: revise title/body prose for clarity; omit children unless reorganizing headings (rare). `
}

function userPayload(req: AiIterateRequest): string {
  const ws = wsSnippet(req.workspaceContext)
  if (req.kind === 'seed') {
    const genre = req.paperGenre ?? 'general'
    const extra = paperGenreSeedGuidance(genre)
    return [
      `Mode: seed`,
      `Genre hint (UI): ${genre}`,
      ...(extra ? [`Genre scaffold note: ${extra}`] : []),
      `User prompt:\n"""${req.prompt.trim()}"""`,
      `Current root title:\n"${req.rootSection.title}"`,
      `Current root body:\n"""${req.rootSection.body.trim() || '(empty)'}"""`,
      ws,
      'Return JSON outline as specified.',
    ].join('\n\n')
  }
  const iterHint = req.paperGenre ? paperGenreIterateGuidance(req.paperGenre) : undefined
  if (req.kind === 'expand') {
    return [
      `Mode: expand`,
      ...(iterHint ? [`${iterHint}`] : []),
      `Path: ${req.pathTitles.join(' › ')}`,
      `Section title: """${req.section.title}"""`,
      `Section body:\n"""${req.section.body}"""`,
      ws,
      'Propose substantive child outline nodes.',
    ].join('\n\n')
  }
  return [
    `Mode: refine`,
    ...(iterHint ? [`${iterHint}`] : []),
    `Path: ${req.pathTitles.join(' › ')}`,
    `Section title: """${req.section.title}"""`,
    `Section body:\n"""${req.section.body}"""`,
    ws,
    'Improve coherence and readability.',
  ].join('\n\n')
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const t = raw.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  const scan = fence ? fence[1]!.trim() : t
  const lo = scan.indexOf('{')
  const hi = scan.lastIndexOf('}')
  if (lo < 0 || hi <= lo) throw new Error('Model response had no JSON object.')
  try {
    return JSON.parse(scan.slice(lo, hi + 1)) as Record<string, unknown>
  } catch {
    throw new Error('Malformed JSON inside model reply.')
  }
}

function rawNodesToSections(raw: unknown): ResearchSection[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.map((one) => {
    if (!one || typeof one !== 'object') return newSection({ title: '', body: '', children: [] })
    const o = one as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title : ''
    const body = typeof o.body === 'string' ? o.body : ''
    const kidsRaw = rawNodesToSections(o.children) ?? []
    return newSection({ title, body, children: kidsRaw })
  })
}

/** Localhost dev/preview: same-origin shim so the browser avoids cross-origin `:11434` CORS quirks. */
function sameOriginProxyV1Origin(): string | null {
  if (typeof window === 'undefined' || import.meta.env.VITE_FORCE_DIRECT_OLLAMA === '1') return null
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1')
    return `${window.location.origin}${OLLAMA_DEV_PROXY_PREFIX}/v1`
  return null
}

export function createOllamaOnAiIterate(
  manifestOverride?: OverviewIterateManifest,
): (req: AiIterateRequest) => Promise<AiIterateResult> {
  const manifest: OverviewIterateManifest = { ...bundled, ...manifestOverride }

  return async (req) => {
    const drawer = readDrawerAiFromSession()
    const drawerBase = drawer.baseUrl.trim()
    const envBase = import.meta.env.VITE_OVERVIEW_CHAT_BASE?.trim()
    const bundledBase =
      manifest.openAiCompatibleBaseUrl?.trim() || 'http://127.0.0.1:11434/v1'

    let baseNorm: string
    if (drawerBase) baseNorm = normalizeBase(drawerBase)
    else {
      const viaProxy = sameOriginProxyV1Origin()
      if (viaProxy) baseNorm = normalizeBase(viaProxy)
      else baseNorm = normalizeBase(envBase || bundledBase)
    }

    const model =
      drawer.outlineModel.trim() ||
      drawer.modelName.trim() ||
      import.meta.env.VITE_OVERVIEW_CHAT_MODEL?.trim() ||
      manifest.chatModel?.trim() ||
      'llama3.1:8b'

    const endpoint = `${baseNorm}/chat/completions`

    let bearer = drawer.apiKey.trim() ? drawer.apiKey.trim() : undefined
    if (!bearer) bearer = import.meta.env.VITE_OVERVIEW_OPENAI_COMPAT_KEY?.trim()

    const system = systemPrompt(req.kind)
    const user = userPayload(req)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (bearer)
      headers.Authorization = bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.25,
        stream: false,
      }),
    })

    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Chat completions ${res.status}: ${text.slice(0, 400)}`)
    }

    let data: Record<string, unknown>
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error('Chat endpoint returned non-JSON.')
    }

    const choice0 = Array.isArray(data.choices)
      ? ((data.choices as unknown[])[0] as Record<string, unknown> | undefined)
      : undefined
    const msg =
      choice0?.message && typeof choice0.message === 'object'
        ? ((choice0.message as Record<string, unknown>).content as unknown)
        : undefined
    if (typeof msg !== 'string' || !msg.trim()) throw new Error('Empty model message.')

    const obj = extractJsonObject(msg)
    const title = typeof obj.title === 'string' ? obj.title : undefined
    const body = typeof obj.body === 'string' ? obj.body : undefined
    const children = rawNodesToSections(obj.children)

    const out: AiIterateResult = {}
    if (title?.trim()) out.title = title
    if (body !== undefined) out.body = body
    if (children?.length) out.children = children

    if (req.kind === 'expand' && !(out.children && out.children.length > 0)) {
      throw new Error('expand: model returned no child sections.')
    }

    if (Object.keys(out).length === 0) {
      throw new Error('Model JSON had no usable title, body, or children.')
    }

    const usage = data.usage && typeof data.usage === 'object' ? (data.usage as Record<string, unknown>) : undefined
    const promptTok =
      typeof usage?.prompt_tokens === 'number'
        ? usage.prompt_tokens
        : typeof usage?.promptTokens === 'number'
          ? (usage.promptTokens as number)
          : roughTok(system + user)
    const completionTok =
      typeof usage?.completion_tokens === 'number'
        ? usage.completion_tokens
        : typeof usage?.completionTokens === 'number'
          ? (usage.completionTokens as number)
          : roughTok(msg)

    out.usage = {
      promptTokens: promptTok,
      completionTokens: completionTok,
    }

    return out
  }
}

/** OpenAI-compatible chat for workspace notes (`onWorkspaceAssistant`). Uses `workspaceModel` when set. */
export function createOllamaWorkspaceAssistant(
  manifestOverride?: OverviewIterateManifest,
): (req: WorkspaceAssistantRequest) => Promise<string> {
  const manifest: OverviewIterateManifest = { ...bundled, ...manifestOverride }

  return async (req) => {
    const drawer = readDrawerAiFromSession()
    const drawerBase = drawer.baseUrl.trim()
    const envBase = import.meta.env.VITE_OVERVIEW_CHAT_BASE?.trim()
    const bundledBase =
      manifest.openAiCompatibleBaseUrl?.trim() || 'http://127.0.0.1:11434/v1'

    let baseNorm: string
    if (drawerBase) baseNorm = normalizeBase(drawerBase)
    else {
      const viaProxy = sameOriginProxyV1Origin()
      if (viaProxy) baseNorm = normalizeBase(viaProxy)
      else baseNorm = normalizeBase(envBase || bundledBase)
    }

    const model =
      drawer.workspaceModel.trim() ||
      drawer.modelName.trim() ||
      import.meta.env.VITE_OVERVIEW_CHAT_MODEL?.trim() ||
      manifest.chatModel?.trim() ||
      'llama3.1:8b'

    const endpoint = `${baseNorm}/chat/completions`

    let bearer = drawer.apiKey.trim() ? drawer.apiKey.trim() : undefined
    if (!bearer) bearer = import.meta.env.VITE_OVERVIEW_OPENAI_COMPAT_KEY?.trim()

    const sel =
      req.selection && req.selection.end > req.selection.start
        ? req.notes.slice(req.selection.start, req.selection.end).trim()
        : ''
    const system =
      'You are a collaborative research assistant. Reply in clear Markdown when useful. Prefer short sections and bullet lists; tie suggestions to the notes the user provided.'
    const user = [
      sel ? `Selection:\n"""${sel}"""` : '',
      `Workspace notes:\n"""${req.notes}"""`,
      `\nRequest:\n${req.prompt.trim()}`,
    ]
      .filter(Boolean)
      .join('\n\n')

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (bearer) headers.Authorization = bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        stream: false,
      }),
    })

    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Workspace assistant ${res.status}: ${text.slice(0, 400)}`)
    }

    let data: Record<string, unknown>
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error('Chat endpoint returned non-JSON.')
    }

    const choice0 = Array.isArray(data.choices)
      ? ((data.choices as unknown[])[0] as Record<string, unknown> | undefined)
      : undefined
    const msg =
      choice0?.message && typeof choice0.message === 'object'
        ? ((choice0.message as Record<string, unknown>).content as unknown)
        : undefined
    if (typeof msg !== 'string' || !msg.trim()) throw new Error('Empty model message.')

    return msg.trim()
  }
}
