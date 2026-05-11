import './presentation.css'
import './sketch.css'
import { ExcalidrawLazyPanel } from './presentation/ExcalidrawLazy'

export type SketchProps = {
  onBack: () => void
}

export default function Sketch({ onBack }: SketchProps) {
  return (
    <div className="sk-shell">
      <header className="sk-shell-header">
        <button type="button" className="pr-btn" onClick={onBack}>
          ← Workspace
        </button>
      </header>
      <main className="sk-shell-main" aria-label="Sketch canvas">
        <ExcalidrawLazyPanel
          fallback={<div className="pr-excal-fallback sk-shell-fallback">Loading sketch workspace…</div>}
        />
      </main>
    </div>
  )
}
