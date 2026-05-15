import { parseYouTubeVideoId } from './youtube'

export type YoutubeOEmbed = {
  title: string
  author_name?: string
  provider_name?: string
}

/**
 * YouTube oEmbed JSON (title, author) without an API key.
 * Tries same-origin dev proxy first (avoids CORS), then the public oEmbed endpoint.
 */
export async function fetchYoutubeOEmbed(watchUrl: string): Promise<YoutubeOEmbed | null> {
  if (!parseYouTubeVideoId(watchUrl)) return null

  const candidates: string[] = []
  if (import.meta.env.DEV) {
    candidates.push(`/youtube-oembed-proxy?url=${encodeURIComponent(watchUrl)}`)
  }
  candidates.push(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`)

  for (const u of candidates) {
    try {
      const res = await fetch(u, { credentials: u.startsWith('http') ? 'omit' : 'same-origin' })
      if (!res.ok) continue
      const j = (await res.json()) as Record<string, unknown>
      const title = typeof j.title === 'string' ? j.title.trim() : ''
      if (!title) continue
      return {
        title,
        author_name: typeof j.author_name === 'string' ? j.author_name.trim() : undefined,
        provider_name: typeof j.provider_name === 'string' ? j.provider_name.trim() : undefined,
      }
    } catch {
      /* try next */
    }
  }
  return null
}
