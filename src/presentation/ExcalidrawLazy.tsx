import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'

const Excalidraw = lazy(async () => {
  await import('@excalidraw/excalidraw/index.css')
  const mod = await import('@excalidraw/excalidraw')
  return { default: mod.Excalidraw }
})

function usePrefersColorSchemeTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.matches('(prefers-color-scheme: dark)') ? 'dark' : 'light',
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () => setTheme(mq.matches ? 'dark' : 'light')
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return theme
}

export function ExcalidrawLazyPanel({ fallback }: { fallback: ReactNode }) {
  const theme = usePrefersColorSchemeTheme()

  return (
    <Suspense fallback={fallback}>
      <div className="pr-excal-wrap">
        <Excalidraw theme={theme} UIOptions={{ canvasActions: { loadScene: false } }} />
      </div>
    </Suspense>
  )
}
