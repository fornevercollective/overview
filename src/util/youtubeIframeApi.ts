/**
 * Minimal loader for {@link https://developers.google.com/youtube/iframe_api_reference youtube.com/iframe_api}.
 */

declare global {
  interface Window {
    YT?: { Player: new (el: string | HTMLElement, opts: YoutubePlayerCtorOptions) => YoutubePlayerHandle }
    onYouTubeIframeAPIReady?: () => void
  }
}

export type YoutubePlayerHandle = {
  destroy: () => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  loadVideoById: (videoId: string | { videoId: string; startSeconds?: number; endSeconds?: number }) => void
  /** Loads an internal player module (e.g. `captions`) when exposed by the iframe player. */
  loadModule?: (moduleName: string) => void
  /** Lists option names for a module after `onApiChange` (e.g. `getOptions('captions')`). */
  getOptions?: (moduleName?: string) => string[]
  getOption?: (moduleName: string, optionName: string) => unknown
  setOption?: (moduleName: string, optionName: string, value: unknown) => void
}

const YT_PLAYING = 1

/** After playback or API changes, nudge captions on (live ASR often needs a reload / track). */
export function kickYouTubeIframeCaptions(player: YoutubePlayerHandle | null | undefined): void {
  if (!player) return
  try {
    player.loadModule?.('captions')
  } catch {
    /* already loaded or unavailable */
  }
  try {
    const names = player.getOptions?.('captions')
    if (Array.isArray(names) && names.includes('reload')) {
      player.setOption?.('captions', 'reload', true)
    }
  } catch {
    /**/
  }
  try {
    // Not in official docs but commonly works for auto/ASR + many live streams.
    player.setOption?.('captions', 'track', { languageCode: 'en' })
  } catch {
    /**/
  }
}

export function isYoutubePlayerPlaying(state: number): boolean {
  return state === YT_PLAYING
}

interface YoutubePlayerCtorOptions {
  videoId?: string
  playerVars?: Record<string, string | number>
  events?: {
    onReady?: (e: { target: YoutubePlayerHandle }) => void
    onApiChange?: (e: { target: YoutubePlayerHandle }) => void
    onStateChange?: (e: { target: YoutubePlayerHandle; data: number }) => void
  }
}

let iframeApiPromise: Promise<void> | null = null

export function ensureYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const w = window
  if (w.YT?.Player) return Promise.resolve()

  if (!iframeApiPromise) {
    iframeApiPromise = new Promise<void>((resolve) => {
      const prev = w.onYouTubeIframeAPIReady
      w.onYouTubeIframeAPIReady = () => {
        prev?.()
        resolve()
      }
      const s = document.createElement('script')
      s.async = true
      s.src = 'https://www.youtube.com/iframe_api'
      const first = document.getElementsByTagName('script')[0]
      first?.parentNode?.insertBefore(s, first)
      if (w.YT?.Player) resolve()
    })
  }

  return iframeApiPromise
}
