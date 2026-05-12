import { useEffect, useState } from 'react'
import '@excalidraw/excalidraw/index.css'
import { Excalidraw } from '@excalidraw/excalidraw'

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

export function ExcalidrawLazyPanel() {
  const theme = usePrefersColorSchemeTheme()

  return (
    <div className="pr-excal-wrap">
      <Excalidraw theme={theme} UIOptions={{ canvasActions: { loadScene: false } }} />
    </div>
  )
}
