/** Lazy Kociemba two-phase solver (bundled). */

import { faceletsToFaces, type CubeOrder, validateFacelets } from './rubiksCube'
import { REDUCTION_SOLVE_PREAMBLE, reduce444FacesTo333Facelets } from './rubiksCube444Reduce'

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

async function solve333Facelets(facelets: string): Promise<string> {
  const err = validateFacelets(facelets, 3)
  if (err) throw new Error(err)
  await initRubiksSolver()
  const mod = await import('cubejs')
  const Cube = mod.default ?? mod
  const cube = Cube.fromString(facelets)
  const alg = cube.solve()
  if (!alg || typeof alg !== 'string') throw new Error('Solver returned no solution.')
  return alg.trim()
}

export async function solveFacelets(facelets: string, order: CubeOrder): Promise<string> {
  if (order === 4) {
    const faces = faceletsToFaces(facelets, 4)
    if (!faces) throw new Error('Invalid 4×4 face data.')
    const err4 = validateFacelets(facelets, 4)
    if (err4) throw new Error(err4)
    const reduced = reduce444FacesTo333Facelets(faces)
    const inner = await solve333Facelets(reduced)
    return `${REDUCTION_SOLVE_PREAMBLE}\n\n${inner}`
  }
  return solve333Facelets(facelets)
}
