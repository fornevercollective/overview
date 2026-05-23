/** Lazy Kociemba two-phase solver (bundled). */

import { type CubeOrder, validateFacelets } from './rubiksCube'

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

export async function solveFacelets(facelets: string, order: CubeOrder): Promise<string> {
  if (order !== 3) {
    throw new Error(
      'The built-in solver is for standard 3×3 cubes only. A 4×4 needs center-building, edge pairing, and parity fixes—use the scan/net here to record your cube; 4×4 solving is not wired yet.',
    )
  }
  const err = validateFacelets(facelets, order)
  if (err) throw new Error(err)
  await initRubiksSolver()
  const mod = await import('cubejs')
  const Cube = mod.default ?? mod
  const cube = Cube.fromString(facelets)
  const alg = cube.solve()
  if (!alg || typeof alg !== 'string') throw new Error('Solver returned no solution.')
  return alg.trim()
}
