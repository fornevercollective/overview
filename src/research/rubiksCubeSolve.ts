/** Lazy Kociemba two-phase solver (bundled). */

import { validateFacelets } from './rubiksCube'

let solverReady: Promise<void> | null = null

export function initRubiksSolver(): Promise<void> {
  if (!solverReady) {
    solverReady = import('cubejs').then((mod) => {
      const Cube = mod.default ?? mod
      Cube.initSolver()
    })
  }
  return solverReady
}

export async function solveFacelets(facelets: string): Promise<string> {
  const err = validateFacelets(facelets)
  if (err) throw new Error(err)
  await initRubiksSolver()
  const mod = await import('cubejs')
  const Cube = mod.default ?? mod
  const cube = Cube.fromString(facelets)
  const alg = cube.solve()
  if (!alg || typeof alg !== 'string') throw new Error('Solver returned no solution.')
  return alg.trim()
}
