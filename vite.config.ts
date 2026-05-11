import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// `base` is read from VITE_BASE_PATH at build time so that the same artifact
// can be served at the site root (default `/`) or under a subpath like
// `/<repo>/` for GitHub Pages. The deploy-pages workflow injects the right
// value via `actions/configure-pages`.
export default defineConfig(() => {
  const base = process.env.VITE_BASE_PATH ?? '/'
  return {
    base,
    plugins: [react()],
  }
})
