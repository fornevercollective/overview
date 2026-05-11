import { lazy, Suspense, type ReactNode } from 'react'

const Excalidraw = lazy(async () => {
  await import('@excalidraw/excalidraw/index.css')
  const mod = await import('@excalidraw/excalidraw')
  return { default: mod.Excalidraw }
})

export function ExcalidrawLazyPanel({ fallback }: { fallback: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <div className="pr-excal-wrap">
        <Excalidraw UIOptions={{ canvasActions: { loadScene: false } }} />
      </div>
    </Suspense>
  )
}
