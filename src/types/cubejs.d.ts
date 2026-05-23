declare module 'cubejs' {
  class Cube {
    constructor(state?: Cube | { center: unknown[]; corners: unknown[]; edges: unknown[] })
    static fromString(str: string): Cube
    static random(): Cube
    solve(maxDepth?: number): string
    asString(): string
    move(alg: string): void
    randomize(): void
  }
  namespace Cube {
    function initSolver(): void
  }
  export = Cube
}
