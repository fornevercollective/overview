/**
 * VWall feed tools — ported from https://github.com/fornevercollective/vwall (app.js).
 * Google Programmable Image Search + picsum fallback; credentials in sessionStorage / VITE_*.
 */

export type VwallImageItem = {
  url: string
  title: string
  snippet: string
}

export const VWALL_GOOGLE_API_KEY_STORAGE = 'googleApiKey'
export const VWALL_GOOGLE_CX_STORAGE = 'googleCx'

const CSE_PAGE_SIZE = 10
const CSE_MAX_TOTAL = 100

function googleSearchEndpoint(): string {
  if (import.meta.env.DEV) {
    return '/vwall-google-proxy/customsearch/v1'
  }
  return 'https://www.googleapis.com/customsearch/v1'
}

export function getVwallGoogleCredentials(): { apiKey: string; cx: string } {
  let apiKey = ''
  let cx = ''
  try {
    apiKey = localStorage.getItem(VWALL_GOOGLE_API_KEY_STORAGE)?.trim() ?? ''
    cx = localStorage.getItem(VWALL_GOOGLE_CX_STORAGE)?.trim() ?? ''
  } catch {
    /* private mode */
  }
  if (!apiKey) apiKey = (import.meta.env.VITE_VWALL_GOOGLE_API_KEY as string | undefined)?.trim() ?? ''
  if (!cx) cx = (import.meta.env.VITE_VWALL_GOOGLE_CX as string | undefined)?.trim() ?? ''
  return { apiKey, cx }
}

export function saveVwallGoogleCredentials(apiKey: string, cx: string): void {
  try {
    localStorage.setItem(VWALL_GOOGLE_API_KEY_STORAGE, apiKey.trim())
    localStorage.setItem(VWALL_GOOGLE_CX_STORAGE, cx.trim())
  } catch {
    /* private mode */
  }
}

export function vwallPicsumItems(count: number, seed: number): VwallImageItem[] {
  const n = Math.min(1000, Math.max(1, Math.floor(count)))
  return Array.from({ length: n }, (_, i) => ({
    url: `https://picsum.photos/300/300?random=${(i + seed * 100) % 10000}`,
    title: '',
    snippet: '',
  }))
}

/** Paginated image search (VWall uses up to 100 results). */
export async function vwallGoogleImageSearch(
  query: string,
  maxItems: number,
  creds = getVwallGoogleCredentials(),
): Promise<VwallImageItem[] | null> {
  const { apiKey, cx } = creds
  if (!apiKey || !cx) return null
  const want = Math.min(CSE_MAX_TOTAL, Math.max(1, Math.floor(maxItems)))
  const out: VwallImageItem[] = []
  const base = googleSearchEndpoint()

  for (let start = 1; start <= want && out.length < want; start += CSE_PAGE_SIZE) {
    const num = Math.min(CSE_PAGE_SIZE, want - out.length)
    const url =
      `${base}?key=${encodeURIComponent(apiKey)}` +
      `&cx=${encodeURIComponent(cx)}` +
      `&searchType=image` +
      `&q=${encodeURIComponent(query)}` +
      `&num=${num}` +
      `&start=${start}`
    try {
      const res = await fetch(url)
      if (!res.ok) break
      const data = (await res.json()) as {
        items?: { link?: string; title?: string; snippet?: string }[]
        error?: { message?: string }
      }
      if (data.error) break
      const items = data.items
      if (!items?.length) break
      for (const item of items) {
        if (!item.link) continue
        out.push({
          url: item.link,
          title: item.title ?? '',
          snippet: item.snippet ?? '',
        })
        if (out.length >= want) break
      }
      if (items.length < num) break
    } catch {
      return out.length > 0 ? out : null
    }
  }
  return out.length > 0 ? out : null
}

function slugQuery(query: string): string {
  const s = query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return s.slice(0, 24) || 'picsum'
}

/** Stable feed key for a VWall image tile in the hex carousel. */
export function vwallFeedKey(query: string | null, index: number, url: string): string {
  const slug = query ? slugQuery(query) : 'picsum'
  let h = 0
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0
  return `vwall:${slug}:${index}:${(h % 1e6).toString(36)}`
}

/** Load image universe — Google when configured, else picsum (same as VWall `buildUniverse`). */
export async function loadVwallUniverse(
  query: string | null,
  count: number,
  seed: number,
): Promise<VwallImageItem[]> {
  const n = Math.min(1000, Math.max(1, Math.floor(count)))
  const q = query?.trim()
  if (q) {
    const found = await vwallGoogleImageSearch(q, n)
    if (found?.length) return found.slice(0, n)
  }
  return vwallPicsumItems(n, seed)
}

export function isVwallFeedKey(feedKey: string): boolean {
  return feedKey.startsWith('vwall:')
}
