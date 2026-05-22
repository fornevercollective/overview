/**
 * OpenAI-compat chat for Video lab voice Q&A (same routing as workspace drawer / ollama-smoke).
 */
import bundled from '../config/overview-iterate.manifest.json'
import { readDrawerAiFromSession } from './drawerAiSession'

const OLLAMA_DEV_PROXY_PREFIX = '/ollama-proxy'

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '')
}

function sameOriginProxyV1Origin(): string | null {
  if (typeof window === 'undefined' || import.meta.env.VITE_FORCE_DIRECT_OLLAMA === '1') return null
  const h = window.location.hostname
  if (h === 'localhost' || h === '127.0.0.1')
    return `${window.location.origin}${OLLAMA_DEV_PROXY_PREFIX}/v1`
  return null
}

export async function videoLabChatCompletion(system: string, user: string): Promise<string> {
  const drawer = readDrawerAiFromSession()
  const m = bundled as { openAiCompatibleBaseUrl?: string; chatModel?: string }

  const drawerBase = drawer.baseUrl.trim()
  const envBase = import.meta.env.VITE_OVERVIEW_CHAT_BASE?.trim()

  const baseNorm = normalizeBase(
    drawerBase
      ? drawerBase
      : (sameOriginProxyV1Origin() ?? envBase ?? m.openAiCompatibleBaseUrl ?? 'http://127.0.0.1:11434/v1'),
  )

  const model =
    drawer.outlineModel.trim() ||
    drawer.modelName.trim() ||
    import.meta.env.VITE_OVERVIEW_CHAT_MODEL?.trim() ||
    m.chatModel ||
    'llama3.1:8b'

  let bearer = drawer.apiKey.trim() ? drawer.apiKey.trim() : undefined
  if (!bearer) bearer = import.meta.env.VITE_OVERVIEW_OPENAI_COMPAT_KEY?.trim()

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (bearer) headers.Authorization = bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}`

  const res = await fetch(`${baseNorm}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.45,
      stream: false,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Chat ${res.status}: ${text.slice(0, 500)}`)

  const data = JSON.parse(text) as Record<string, unknown>
  const choice0 = Array.isArray(data.choices)
    ? ((data.choices as unknown[])[0] as Record<string, unknown> | undefined)
    : undefined
  const msg =
    choice0?.message && typeof choice0.message === 'object'
      ? ((choice0.message as Record<string, unknown>).content as unknown)
      : undefined
  if (typeof msg !== 'string' || !msg.trim()) throw new Error('Empty model reply.')
  return msg.trim()
}
