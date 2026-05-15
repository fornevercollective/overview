import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
//
// `base` is read from VITE_BASE_PATH at build time so that the same artifact
// can be served at the site root (default `/`) or under a subpath like
// `/<repo>/` for GitHub Pages. The deploy-pages workflow injects the right
// value via `actions/configure-pages`.

/** Same-origin proxy so Expand/Seed/Refine can reach local Ollama without :11434 CORS (dev + `vite preview` e.g. port 8890). */
const ollamaProxy: Record<string, import('vite').ProxyOptions> = {
  '/ollama-proxy': {
    target: 'http://127.0.0.1:11434',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/ollama-proxy/, ''),
  },
  /** Dev-only: browser cannot read youtube.com HTML/oEmbed with CORS; proxy oEmbed for title hints + hero seed. */
  '/youtube-oembed-proxy': {
    target: 'https://www.youtube.com',
    changeOrigin: true,
    rewrite: (path) => {
      const q = path.indexOf('?')
      if (q === -1) return '/oembed?format=json'
      return `/oembed?format=json&${path.slice(q + 1)}`
    },
  },
}

export default defineConfig(() => {
  const base = process.env.VITE_BASE_PATH ?? '/'
  return {
    base,
    plugins: [react()],
    server: { proxy: ollamaProxy },
    preview: { proxy: ollamaProxy },
  }
})
