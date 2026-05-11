import { Suspense, lazy, useCallback, useRef, useState } from 'react'
import Presentation from './Presentation'
import ResearchOverview, { type ResearchOverviewProps } from './research/ResearchOverview'
import type { AiIterateRequest, AiIterateResult, ResearchSection } from './research/research-types'
import type { OverviewWorkspaceSnapshot } from './research/workspace-snapshot'
import Summary from './Summary'

const Sketch = lazy(() => import('./Sketch'))

const DRAWER_AI_SESSION_KEY = 'overview-drawer-ai-config'
const DEFAULT_FREE_MODEL_BASE_URL = 'https://models.github.ai/inference'
const DEFAULT_FREE_MODEL_NAME = (import.meta.env.VITE_DEFAULT_MODEL as string | undefined)?.trim() || 'openai/gpt-4o-mini'
const DEFAULT_AI_TEMPERATURE = 0.4
const DEFAULT_AI_MAX_TOKENS = 1024
const SEED_CHILD_GUIDANCE = '4-8'
let sectionIdCounter = 0

function generateSectionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  sectionIdCounter += 1
  return `sec-${Date.now()}-${sectionIdCounter.toString(36)}`
}

function parseResearchSection(value: unknown): ResearchSection | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  const title = typeof obj.title === 'string' ? obj.title : ''
  const body = typeof obj.body === 'string' ? obj.body : ''
  const rawChildren = Array.isArray(obj.children) ? obj.children : []
  return {
    id: typeof obj.id === 'string' && obj.id.trim() ? obj.id : generateSectionId(),
    title: title.trim() || 'Untitled section',
    body,
    children: rawChildren.map(parseResearchSection).filter((x): x is ResearchSection => Boolean(x)),
  }
}

function readDrawerAiConfig(): { baseUrl: string; modelName: string; apiKey: string } {
  try {
    const raw = sessionStorage.getItem(DRAWER_AI_SESSION_KEY)
    if (!raw) return { baseUrl: '', modelName: '', apiKey: '' }
    const obj = JSON.parse(raw) as Record<string, unknown>
    return {
      baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl.trim() : '',
      modelName: typeof obj.modelName === 'string' ? obj.modelName.trim() : '',
      apiKey: typeof obj.apiKey === 'string' ? obj.apiKey.trim() : '',
    }
  } catch {
    return { baseUrl: '', modelName: '', apiKey: '' }
  }
}

function tryParseModelResult(raw: string): AiIterateResult {
  const text = raw.trim()
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const children = Array.isArray(parsed.children)
      ? parsed.children.map(parseResearchSection).filter((x): x is ResearchSection => Boolean(x))
      : undefined
    return {
      ...(typeof parsed.title === 'string' ? { title: parsed.title } : {}),
      ...(typeof parsed.body === 'string' ? { body: parsed.body } : {}),
      ...(children ? { children } : {}),
    }
  } catch {
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace < 0 || lastBrace <= firstBrace) return { body: text }
    try {
      const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>
      const children = Array.isArray(parsed.children)
        ? parsed.children.map(parseResearchSection).filter((x): x is ResearchSection => Boolean(x))
        : undefined
      return {
        ...(typeof parsed.title === 'string' ? { title: parsed.title } : {}),
        ...(typeof parsed.body === 'string' ? { body: parsed.body } : {}),
        ...(children ? { children } : {}),
      }
    } catch {
      const sample = text.slice(0, 120).replace(/\s+/g, ' ')
      console.warn(`Could not parse model JSON (full and extracted object parse failed). Fallback body used. Sample: ${sample}`)
      return { body: text }
    }
  }
}

function parseUsageTokens(payload: Record<string, unknown>): AiIterateResult['usage'] | undefined {
  if (typeof payload.usage !== 'object' || !payload.usage) return undefined
  const usage = payload.usage as { prompt_tokens?: unknown; completion_tokens?: unknown }
  if (typeof usage.prompt_tokens !== 'number' && typeof usage.completion_tokens !== 'number') return undefined
  return {
    promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function errorMessageFromResponse(
  req: AiIterateRequest,
  endpointBase: string,
  response: Response,
  payload: Record<string, unknown> | null,
  responseText: string,
): string {
  const fromJson =
    payload && typeof payload.error === 'object' && payload.error
      ? (payload.error as { message?: unknown }).message
      : undefined
  if (typeof fromJson === 'string' && fromJson.trim()) return fromJson
  const bodyText = responseText.trim()
  const bodySuffix = bodyText ? ` Body: ${bodyText.slice(0, 240)}` : ''
  return `AI request failed for ${req.kind} via ${endpointBase}/chat/completions (${response.status} ${response.statusText}).${bodySuffix}`
}

function aiResultWithUsage(payload: Record<string, unknown>, rawContent: string): AiIterateResult {
  const usage = parseUsageTokens(payload)
  return {
    ...tryParseModelResult(rawContent),
    ...(usage ? { usage } : {}),
  }
}

function seedPromptText(req: Extract<AiIterateRequest, { kind: 'seed' }>): string {
  return (
    `Seed an outline for: ${req.prompt}\nWorkspace context:\n${req.workspaceContext ?? ''}\n` +
    `Return ${SEED_CHILD_GUIDANCE} useful top-level children.`
  )
}

function nonSeedPromptText(req: Exclude<AiIterateRequest, { kind: 'seed' }>): string {
  return (
    `${req.kind === 'expand' ? 'Expand' : 'Refine'} this section.\n` +
    `Path: ${req.pathTitles.join(' / ')}\n` +
    `Title: ${req.section.title}\n` +
    `Body:\n${req.section.body}\n` +
    `Workspace context:\n${req.workspaceContext ?? ''}`
  )
}

function buildMessages(req: AiIterateRequest): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You are a research-outline assistant. Return compact JSON only: {"title"?:string,"body"?:string,"children"?:Section[]}. Each child section must have title, body, and optional nested children with the same structure.'
  if (req.kind === 'seed') {
    return [
      { role: 'system', content: system },
      { role: 'user', content: seedPromptText(req) },
    ]
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: nonSeedPromptText(req) },
  ]
}

async function liveAiIterate(req: AiIterateRequest): Promise<AiIterateResult | null> {
  const cfg = readDrawerAiConfig()
  if (!cfg.apiKey) return null
  const endpointBase = (cfg.baseUrl || DEFAULT_FREE_MODEL_BASE_URL).replace(/\/+$/, '')
  const modelName = cfg.modelName || DEFAULT_FREE_MODEL_NAME
  let response: Response
  try {
    response = await fetch(`${endpointBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        temperature: DEFAULT_AI_TEMPERATURE,
        max_tokens: DEFAULT_AI_MAX_TOKENS,
        messages: buildMessages(req),
      }),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown network error'
    throw new Error(`AI request network failure for ${req.kind} via ${endpointBase}/chat/completions: ${msg}`, {
      cause: error,
    })
  }
  const responseText = await response.text()
  const payload = parseJsonObject(responseText)
  if (!response.ok) {
    throw new Error(errorMessageFromResponse(req, endpointBase, response, payload, responseText))
  }
  if (!payload) throw new Error(`AI response was not valid JSON for model "${modelName}" (${req.kind}).`)
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const first = choices[0] as { message?: { content?: string } } | undefined
  const content = first?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`AI response was empty for model "${modelName}" (${req.kind}).`)
  }
  return aiResultWithUsage(payload, content)
}

function fallbackAiIterate(req: AiIterateRequest): AiIterateResult {
  if (req.kind === 'seed') {
    const title = req.prompt.trim() || 'Research focus'
    return {
      title,
      body: 'Add an API key in AI settings to use live model output.',
      children: [
        { id: generateSectionId(), title: 'Background', body: '', children: [] },
        { id: generateSectionId(), title: 'Key questions', body: '', children: [] },
        { id: generateSectionId(), title: 'Evidence', body: '', children: [] },
        { id: generateSectionId(), title: 'Draft findings', body: '', children: [] },
      ],
    }
  }
  if (req.kind === 'expand') {
    return {
      children: [{ id: generateSectionId(), title: `Sub-point: ${req.section.title}`, body: '', children: [] }],
    }
  }
  return { body: req.section.body.trim() ? `${req.section.body}\n\nRefined draft.` : 'Refined draft.' }
}

const onAiIterate: ResearchOverviewProps['onAiIterate'] = async (req) =>
  (await liveAiIterate(req)) ?? fallbackAiIterate(req)

export default function App() {
  const [page, setPage] = useState<'app' | 'summary' | 'presentation' | 'sketch'>('app')
  const lastWorkspaceSnapshotRef = useRef<OverviewWorkspaceSnapshot | null>(null)

  const onWorkspaceChange = useCallback((snap: OverviewWorkspaceSnapshot) => {
    lastWorkspaceSnapshotRef.current = snap
  }, [])

  const openSummary = useCallback(() => setPage('summary'), [])
  const openPresentation = useCallback(() => setPage('presentation'), [])
  const openSketch = useCallback(() => setPage('sketch'), [])
  const backToWorkspace = useCallback(() => setPage('app'), [])
  const exportFromSummary = useCallback(() => {
    window.location.hash = '#workspace-export'
    setPage('app')
  }, [])

  if (page === 'summary') {
    return (
      <Summary
        onBackToWorkspace={backToWorkspace}
        onOpenPresentation={openPresentation}
        onExportWorkspaceJson={exportFromSummary}
        getWorkspaceSnapshot={() => lastWorkspaceSnapshotRef.current}
      />
    )
  }

  if (page === 'presentation') {
    return <Presentation onBack={backToWorkspace} />
  }

  if (page === 'sketch') {
    return (
      <Suspense fallback={<div style={{ padding: 24 }}>Loading sketch workspace…</div>}>
        <Sketch onBack={backToWorkspace} />
      </Suspense>
    )
  }

  return (
    <ResearchOverview
      onAiIterate={onAiIterate}
      onOpenSummary={openSummary}
      onOpenPresentation={openPresentation}
      onOpenSketch={openSketch}
      onWorkspaceChange={onWorkspaceChange}
    />
  )
}
