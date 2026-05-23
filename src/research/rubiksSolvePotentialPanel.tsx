import { useMemo } from 'react'
import { computeSolvePotential, formatTermPercent } from './rubiksSolvePotential'
import type { CubeFaces, CubeOrder, FaceId } from './rubiksCube'

export type RubiksSolvePotentialProps = {
  faces: CubeFaces
  cubeOrder: CubeOrder
  capturedFaces: ReadonlySet<FaceId>
  walkStep: number
  walkMoveCount: number
  walkthroughOn: boolean
  liveConfidence: number | null
}

export default function RubiksSolvePotentialPanel({
  faces,
  cubeOrder,
  capturedFaces,
  walkStep,
  walkMoveCount,
  walkthroughOn,
  liveConfidence,
}: RubiksSolvePotentialProps) {
  const p = useMemo(
    () =>
      computeSolvePotential({
        faces,
        order: cubeOrder,
        capturedFaces,
        walkStep,
        walkMoveCount,
        walkthroughOn,
        liveConfidence,
      }),
    [faces, cubeOrder, capturedFaces, walkStep, walkMoveCount, walkthroughOn, liveConfidence],
  )

  const termLine = p.terms.map((t) => formatTermPercent(t.ratio)).join(' + ')

  return (
    <section className="rubiks-solve-potential" aria-label="Solve potential">
      <h2 className="rubiks-solve-potential-title">Solve potential</h2>
      <p className="rubiks-solve-potential-eq">
        <span className="rubiks-solve-var">P</span>
        <sub>solve</sub>
        <span className="rubiks-solve-op"> = (</span>
        {p.terms.map((t, i) => (
          <span key={t.symbol}>
            {i > 0 ? <span className="rubiks-solve-op"> + </span> : null}
            <span className="rubiks-solve-var">{t.symbol}</span>
          </span>
        ))}
        <span className="rubiks-solve-op">) / {p.divisor}</span>
      </p>
      <p className="rubiks-solve-potential-eq rubiks-solve-potential-eq--weighted muted">
        <span className="rubiks-solve-var">P</span>
        <sub>solve</sub>
        <span className="rubiks-solve-op"> = Σ(wᵢ·Sᵢ) / Σwᵢ</span>
      </p>
      <p className="rubiks-solve-potential-eq rubiks-solve-potential-eq--numeric">
        <span className="rubiks-solve-op">= (</span>
        {termLine}
        <span className="rubiks-solve-op">) / {p.divisor}</span>
        <span className="rubiks-solve-op"> → </span>
        <strong className="rubiks-solve-pct">{p.percent}%</strong>
      </p>
      <div
        className="rubiks-solve-potential-bar"
        role="progressbar"
        aria-valuenow={p.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Solve potential ${p.percent} percent`}
      >
        <div className="rubiks-solve-potential-fill" style={{ width: `${p.percent}%` }} />
      </div>
      <ul className="rubiks-solve-potential-legend">
        {p.terms.map((t) => (
          <li key={t.symbol}>
            <span className="rubiks-solve-var">{t.symbol}</span>
            <span className="muted"> — {t.label}: {formatTermPercent(t.ratio)}</span>
          </li>
        ))}
        <li className="muted">
          Stickers matched: {p.matchStickers}/{p.totalStickers}
          {p.isValid ? ' · valid counts' : ' · counts not yet valid'}
        </li>
      </ul>
    </section>
  )
}
