export type SnakeDir = 'up' | 'down' | 'left' | 'right'

export type SnakePoint = { x: number; y: number }

export type SnakeState = {
  cols: number
  rows: number
  dir: SnakeDir
  body: SnakePoint[]
  food: SnakePoint
  score: number
  alive: boolean
  tick: number
}

const DELTAS: Record<SnakeDir, SnakePoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<SnakeDir, SnakeDir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

function sameCell(a: SnakePoint, b: SnakePoint): boolean {
  return a.x === b.x && a.y === b.y
}

function inBody(body: SnakePoint[], p: SnakePoint, skipHead = false): boolean {
  const start = skipHead ? 1 : 0
  for (let i = start; i < body.length; i++) {
    if (sameCell(body[i]!, p)) return true
  }
  return false
}

export function spawnFood(cols: number, rows: number, body: SnakePoint[]): SnakePoint {
  const maxTries = cols * rows
  for (let t = 0; t < maxTries; t++) {
    const p = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) }
    if (!inBody(body, p)) return p
  }
  return { x: 0, y: 0 }
}

export function createSnakeState(cols: number, rows: number): SnakeState {
  const cx = Math.floor(cols / 2)
  const cy = Math.floor(rows / 2)
  const body: SnakePoint[] = [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ]
  return {
    cols,
    rows,
    dir: 'right',
    body,
    food: spawnFood(cols, rows, body),
    score: 0,
    alive: true,
    tick: 0,
  }
}

export function queueSnakeDir(state: SnakeState, next: SnakeDir): SnakeState {
  if (!state.alive) return state
  if (next === OPPOSITE[state.dir]) return state
  return { ...state, dir: next }
}

export function stepSnake(state: SnakeState): SnakeState {
  if (!state.alive) return state
  const head = state.body[0]!
  const d = DELTAS[state.dir]
  const next: SnakePoint = {
    x: head.x + d.x,
    y: head.y + d.y,
  }
  if (next.x < 0 || next.y < 0 || next.x >= state.cols || next.y >= state.rows) {
    return { ...state, alive: false }
  }
  const ate = sameCell(next, state.food)
  const bodyForHit = ate ? state.body : state.body.slice(0, -1)
  if (inBody(bodyForHit, next)) {
    return { ...state, alive: false }
  }

  const body = [next, ...state.body]
  if (!ate) body.pop()

  const score = ate ? state.score + 1 : state.score
  const food = ate ? spawnFood(state.cols, state.rows, body) : state.food

  return {
    ...state,
    body,
    food,
    score,
    tick: state.tick + 1,
  }
}
