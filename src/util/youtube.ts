/** YouTube video IDs are 11 characters from this set (see public video ID format). */
const YOUTUBE_ID_RE = /^[\w-]{11}$/

function normalizeVideoIdSegment(segment: string | undefined | null): string | null {
  if (!segment) return null
  const clean = segment.split(/[#?&]/)[0]?.trim() ?? ''
  return YOUTUBE_ID_RE.test(clean) ? clean : null
}

/**
 * Extracts a canonical 11-character video id from common YouTube URL shapes
 * (`watch?v=`, `youtu.be/`, `/shorts/`, optional `/embed/`) or a bare id string.
 */
export function parseYouTubeVideoId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed

  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const u = new URL(withScheme)
    const host = u.hostname.replace(/^www\./i, '').toLowerCase()

    if (host === 'youtu.be') {
      return normalizeVideoIdSegment(u.pathname.split('/').filter(Boolean)[0])
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const path = u.pathname
      if (path.startsWith('/shorts/')) {
        return normalizeVideoIdSegment(path.slice('/shorts/'.length))
      }
      if (path.startsWith('/embed/')) {
        return normalizeVideoIdSegment(path.slice('/embed/'.length))
      }
      if (path === '/watch' || path.startsWith('/watch')) {
        return normalizeVideoIdSegment(u.searchParams.get('v'))
      }
    }
  } catch {
    /* invalid URL */
  }

  return null
}

/** Strips `{…}` wrappers from pasted share tokens (e.g. `{https://youtube.com/watch?v=…}`). */
export function stripYouTubePasteDecorators(raw: string): string {
  return raw
    .trim()
    .replace(/^\{/u, '')
    .replace(/\}$/u, '')
    .trim()
}

export function youtubeNoCookieEmbedUrl(videoId: string): string {
  const enc = encodeURIComponent(videoId)
  return `https://www.youtube-nocookie.com/embed/${enc}`
}
