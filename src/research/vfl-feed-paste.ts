import { parseYouTubeVideoId, stripYouTubePasteDecorators } from '../util/youtube'

export type ParsedFeedPaste =
  | { kind: 'youtube'; videoId: string; raw: string }
  | { kind: 'feedKey'; feedKey: string; raw: string }
  | { kind: 'http'; url: string; raw: string }
  | { kind: 'invalid'; raw: string }

/** Parses `{https://…}`, YouTube URLs, bare ids, or custom `feedKey` tokens. */
export function parseFeedLinkPaste(raw: string): ParsedFeedPaste {
  const trimmed = stripYouTubePasteDecorators(raw)
  if (!trimmed) return { kind: 'invalid', raw }

  const yt = parseYouTubeVideoId(trimmed)
  if (yt) return { kind: 'youtube', videoId: yt, raw: trimmed }

  if (/^peer:[\w-]{3,32}$/i.test(trimmed) || /^demo-[\w-]+$/.test(trimmed)) {
    return { kind: 'feedKey', feedKey: trimmed, raw: trimmed }
  }

  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const u = new URL(withScheme)
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return { kind: 'http', url: u.href, raw: trimmed }
    }
  } catch {
    /* fall through */
  }

  if (/^[\w-]{3,48}$/.test(trimmed)) {
    return { kind: 'feedKey', feedKey: trimmed, raw: trimmed }
  }

  return { kind: 'invalid', raw: trimmed }
}

export function ytHexFeedKey(videoId: string): string {
  return `yt:${videoId}`
}
