/**
 * Browser-side YouTube ingest helpers (metadata, captions, thumbnails).
 *
 * **Captions / timed text:** `youtube.com` timedtext endpoints are typically blocked by CORS
 * when called from another origin. This module tries an in-browser fetch anyway; when it fails,
 * transcript sections explain the limitation. For deployments that need reliable captions, set
 * **`import.meta.env.VITE_YOUTUBE_PROXY`** at build time to a URL you control that returns JSON:
 * `{ "segments": [ { "text": string, "startMs": number, "endMs": number } ] }`.
 * The fetch URL is built as:
 * - if the env value contains `{id}`, it is replaced with the encoded video id;
 * - otherwise, `?videoId=<id>` is appended (after `?` or `&` as appropriate).
 *
 * Prefer official APIs or a compliant proxy; do not ship scrapers that violate YouTube ToS.
 */

import { newSection } from '../research/research-tree'
import type { IngestKind, ResearchSection } from '../research/research-types'

export type YoutubeIngestSegment = {
  text: string
  startMs: number
  endMs: number
}

export type YoutubeIngestThumbnail = {
  url: string
  /** Best-effort time in ms (static poster frames report 0). */
  tMs: number
  label: string
}

export type YoutubeTranscriptSource = 'timedtext' | 'proxy' | 'none'

export type YoutubeIngestResult = {
  videoId: string
  title?: string
  authorName?: string
  description?: string
  segments: YoutubeIngestSegment[]
  thumbnails: YoutubeIngestThumbnail[]
  transcriptSource: YoutubeTranscriptSource
  warnings: string[]
}

/** Hidden marker so repeated GO can replace the same block under the article root. */
export function youtubeIngestMarker(videoId: string): string {
  return `<!-- ro-yt:${videoId} -->`
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function normalizeSegmentText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

function parseTimedTextJson3(text: string): YoutubeIngestSegment[] | null {
  try {
    const j = JSON.parse(text) as {
      events?: {
        tStartMs?: number
        dDurationMs?: number
        segs?: { utf8?: string }[]
      }[]
    }
    const events = j.events
    if (!Array.isArray(events)) return null
    const out: YoutubeIngestSegment[] = []
    for (const ev of events) {
      const startMs = typeof ev.tStartMs === 'number' ? ev.tStartMs : 0
      const dur = typeof ev.dDurationMs === 'number' ? ev.dDurationMs : 0
      const segs = ev.segs
      if (!Array.isArray(segs)) continue
      const piece = normalizeSegmentText(segs.map((x) => x.utf8 ?? '').join(''))
      if (!piece) continue
      out.push({
        text: piece,
        startMs,
        endMs: startMs + Math.max(dur, 0),
      })
    }
    return out.length ? out : null
  } catch {
    return null
  }
}

function parseTimedTextXml(xml: string): YoutubeIngestSegment[] | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml')
    const texts = doc.querySelectorAll('text')
    if (!texts.length) return null
    const out: YoutubeIngestSegment[] = []
    texts.forEach((el) => {
      const start = Number.parseFloat(el.getAttribute('start') ?? '0')
      const dur = Number.parseFloat(el.getAttribute('dur') ?? '0')
      const piece = normalizeSegmentText(el.textContent ?? '')
      if (!piece) return
      const startMs = Math.round(start * 1000)
      const endMs = startMs + Math.round((Number.isFinite(dur) ? dur : 0) * 1000)
      out.push({ text: piece, startMs, endMs: endMs > startMs ? endMs : startMs + 1 })
    })
    return out.length ? out : null
  } catch {
    return null
  }
}

async function fetchTimedTextRaw(videoId: string, params: Record<string, string>): Promise<string | null> {
  const u = new URL('https://www.youtube.com/api/timedtext')
  u.searchParams.set('v', videoId)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  try {
    const res = await fetch(u.toString(), { credentials: 'omit' })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** Best-effort in-browser timedtext (often blocked by CORS outside youtube.com). */
async function fetchTimedTextInBrowser(videoId: string): Promise<YoutubeIngestSegment[] | null> {
  const tryJson = async (extra: Record<string, string>) => {
    const raw = await fetchTimedTextRaw(videoId, { fmt: 'json3', ...extra })
    if (!raw) return null
    return parseTimedTextJson3(raw)
  }
  const tryXml = async (extra: Record<string, string>) => {
    const raw = await fetchTimedTextRaw(videoId, extra)
    if (!raw || !raw.includes('<text')) return null
    return parseTimedTextXml(raw)
  }

  const chain = [
    () => tryJson({ lang: 'en' }),
    () => tryJson({ lang: 'en', kind: 'asr' }),
    () => tryXml({ lang: 'en' }),
    () => tryXml({}),
  ]
  for (const fn of chain) {
    const got = await fn()
    if (got?.length) return got
  }
  return null
}

type ProxySegmentsPayload = {
  segments?: unknown
}

function parseProxySegments(raw: unknown): YoutubeIngestSegment[] | null {
  if (!raw || typeof raw !== 'object') return null
  const segments = (raw as ProxySegmentsPayload).segments
  if (!Array.isArray(segments)) return null
  const out: YoutubeIngestSegment[] = []
  for (const row of segments) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const text = typeof r.text === 'string' ? normalizeSegmentText(r.text) : ''
    const startMs = typeof r.startMs === 'number' ? r.startMs : Number(r.startMs)
    const endMs = typeof r.endMs === 'number' ? r.endMs : Number(r.endMs)
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs)) continue
    out.push({ text, startMs, endMs })
  }
  return out.length ? out : null
}

/**
 * When `VITE_YOUTUBE_PROXY` is set, GET captions JSON from your proxy.
 * See module doc comment for response shape.
 */
async function fetchSegmentsViaProxy(videoId: string): Promise<YoutubeIngestSegment[] | null> {
  const tmpl = import.meta.env.VITE_YOUTUBE_PROXY?.trim()
  if (!tmpl) return null
  let url: string
  if (tmpl.includes('{id}')) {
    url = tmpl.replace('{id}', encodeURIComponent(videoId))
  } else if (/^https?:\/\//i.test(tmpl)) {
    url = `${tmpl}${tmpl.includes('?') ? '&' : '?'}videoId=${encodeURIComponent(videoId)}`
  } else {
    const path = tmpl.startsWith('/') ? tmpl : `/${tmpl}`
    url = `${path}?videoId=${encodeURIComponent(videoId)}`
  }
  try {
    const res = await fetch(url, { credentials: 'omit' })
    if (!res.ok) return null
    const j: unknown = await res.json()
    return parseProxySegments(j)
  } catch {
    return null
  }
}

export type YoutubeOEmbed = {
  title?: string
  author_name?: string
  /** HTML snippet — strip tags best-effort */
  description?: string
}

export async function fetchYoutubeOEmbed(videoId: string): Promise<YoutubeOEmbed | null> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  const u = new URL('https://www.youtube.com/oembed')
  u.searchParams.set('url', watchUrl)
  u.searchParams.set('format', 'json')
  try {
    const res = await fetch(u.toString(), { credentials: 'omit' })
    if (!res.ok) return null
    return (await res.json()) as YoutubeOEmbed
  } catch {
    return null
  }
}

function stripHtmlLoose(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    return normalizeSegmentText(doc.body.textContent ?? '')
  } catch {
    return normalizeSegmentText(html.replace(/<[^>]+>/g, ' '))
  }
}

/** Poster + standard thumbnail endpoints (times are nominal — storyboard grids need a proxy). */
export function youtubePosterThumbnails(videoId: string): YoutubeIngestThumbnail[] {
  const base = `https://img.youtube.com/vi/${encodeURIComponent(videoId)}`
  return [
    { url: `${base}/maxresdefault.jpg`, tMs: 0, label: 'maxresdefault (1280×720 if available)' },
    { url: `${base}/sddefault.jpg`, tMs: 0, label: 'sddefault' },
    { url: `${base}/hqdefault.jpg`, tMs: 0, label: 'hqdefault' },
    { url: `${base}/mqdefault.jpg`, tMs: 0, label: 'mqdefault' },
    { url: `${base}/default.jpg`, tMs: 0, label: 'default' },
  ]
}

export async function runYoutubeIngest(videoId: string): Promise<YoutubeIngestResult> {
  const warnings: string[] = []

  const [oembed, proxySegments, browserSegments] = await Promise.all([
    fetchYoutubeOEmbed(videoId),
    fetchSegmentsViaProxy(videoId),
    fetchTimedTextInBrowser(videoId),
  ])

  let transcriptSource: YoutubeTranscriptSource = 'none'
  let segments: YoutubeIngestSegment[] = []

  if (proxySegments?.length) {
    segments = proxySegments
    transcriptSource = 'proxy'
  } else if (browserSegments?.length) {
    segments = browserSegments
    transcriptSource = 'timedtext'
  } else {
    warnings.push(
      'Timed captions were not available in this browser session (YouTube timedtext is usually CORS-blocked off-site). Use `VITE_YOUTUBE_PROXY` or paste captions manually.',
    )
  }

  const title = oembed?.title?.trim()
  const authorName = oembed?.author_name?.trim()
  const description = oembed?.description ? stripHtmlLoose(oembed.description) : undefined

  if (!title && !authorName) {
    warnings.push('Could not load video title via oEmbed (offline or blocked).')
  }

  return {
    videoId,
    title,
    authorName,
    description,
    segments,
    thumbnails: youtubePosterThumbnails(videoId),
    transcriptSource,
    warnings,
  }
}

function transcriptMarkdown(segments: YoutubeIngestSegment[]): string {
  return segments
    .map((s) => `**${formatClock(s.startMs)}** ${s.text}`)
    .join('\n\n')
}

function thumbnailsMarkdown(thumbs: YoutubeIngestThumbnail[], videoId: string): string {
  const lines = [
    '*Static poster URLs from `img.youtube.com` (all at **0:00** — YouTube does not expose per-frame timestamps in documented thumbnail endpoints).*',
    '',
    '*Fine-grained storyboard sprites are player-internal and change over time; a compliant proxy may supply timestamped frames.*',
    '',
    `[Watch](https://www.youtube.com/watch?v=${encodeURIComponent(videoId)})`,
    '',
    ...thumbs.map((t) => `- ![${t.label}](${t.url}) — **${formatClock(t.tMs)}**`),
  ]
  return lines.join('\n')
}

function unavailableTranscriptBody(): string {
  return [
    'Transcript unavailable in-browser for most sites because YouTube\'s timedtext API is not CORS-accessible.',
    '',
    '**Options:**',
    '- Set build-time `VITE_YOUTUBE_PROXY` to your JSON captions endpoint (see `src/util/youtube-ingest.ts`).',
    '- Paste captions manually into this section.',
    '- Use the official YouTube Data API or other compliant tooling server-side and paste results here.',
  ].join('\n')
}

export function buildYoutubeIngestSections(
  videoId: string,
  kind: IngestKind,
  data: YoutubeIngestResult,
): ResearchSection[] {
  const marker = youtubeIngestMarker(videoId)
  const titleBase = data.title?.trim() || `Video ${videoId}`
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`

  const headerParts: string[] = [marker, '', `[Open video](${watch})`]
  if (data.authorName?.trim()) {
    headerParts.push(`**Channel:** ${data.authorName.trim()}`)
  }
  if (data.description?.trim()) {
    const d = data.description.trim()
    headerParts.push(
      `**Description (oEmbed):**\n\n${d.length > 1200 ? `${d.slice(0, 1197)}…` : d}`,
    )
  }
  headerParts.push(
    '',
    `*Transcript source: ${data.transcriptSource} · Imported ${new Date().toISOString().slice(0, 19)}Z*`,
  )

  const parentBody = headerParts.join('\n')

  let transcriptBody: string
  if (data.segments.length > 0) {
    transcriptBody = transcriptMarkdown(data.segments)
    if (kind === 'images') {
      transcriptBody = `*Transcript omitted for “Images” ingest scope — expand manually if needed.*\n\n---\n\n${transcriptBody.slice(0, 800)}${transcriptBody.length > 800 ? '…' : ''}`
    }
  } else if (kind === 'notes') {
    transcriptBody =
      '*Notes-only ingest: captions were not fetched. Switch the ingest tab to **Transcript** and press Go to retry captions.*\n\n' +
      unavailableTranscriptBody()
  } else {
    transcriptBody = unavailableTranscriptBody()
  }

  let framesBody = thumbnailsMarkdown(data.thumbnails, videoId)
  if (kind === 'transcript') {
    framesBody = `*Key thumbnails (poster frames).*\n\n${framesBody}`
  } else if (kind === 'images') {
    framesBody = `*Poster thumbnails — **Images** ingest scope (timestamps are nominal for static posters).*\n\n${framesBody}`
  }

  let notesBody: string
  if (kind === 'notes') {
    notesBody = [
      '## Imported notes',
      '',
      data.description?.trim()
        ? data.description
        : '*No description returned by oEmbed — paste your own notes here.*',
    ].join('\n')
  } else {
    notesBody = [
      '*Use this subsection for your own annotations while reviewing the video.*',
      '',
      data.description?.trim()
        ? `**Snippet from oEmbed:** ${data.description.length > 600 ? `${data.description.slice(0, 597)}…` : data.description}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    newSection({
      title: `Video ingest — ${titleBase}`,
      body: parentBody,
      children: [
        newSection({ title: 'Transcript', body: transcriptBody, children: [] }),
        newSection({ title: 'Key frames', body: framesBody, children: [] }),
        newSection({ title: 'Notes', body: notesBody, children: [] }),
      ],
    }),
  ]
}
