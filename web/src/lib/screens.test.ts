import { describe, expect, it } from "vitest"
import { dotRadius } from "./screens"

describe("dotRadius", () => {
  it("inks exactly the coverage asked for — area, not half-diagonal", () => {
    // The half-diagonal formula this replaced laid down 1.57x the ink.
    for (const cov of [0.1, 0.34, 0.5, 0.7]) {
      const cell = 5
      const r = dotRadius(cov, cell)
      expect((Math.PI * r * r) / (cell * cell)).toBeCloseTo(cov, 9)
    }
  })
  it("zero or negative coverage is no dot", () => {
    expect(dotRadius(0, 4)).toBe(0)
    expect(dotRadius(-0.2, 4)).toBe(0)
  })
})
