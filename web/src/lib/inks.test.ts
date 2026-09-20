import { describe, expect, it } from "vitest"
import { D, coverageAt, derivedRamp, splitInk } from "./inks"

describe("derivedRamp", () => {
  it("returns the six tones the plates print, every adjacent pair distinct", () => {
    // A regression here means the legend has drifted from the map again —
    // COMPARISON.md §8, the whole reason the ramp is derived and not typed.
    const ramp = derivedRamp(D, false)
    expect(ramp).toHaveLength(6)
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i]).not.toBe(ramp[i - 1])
    }
  })

  it("dark and light ramps are independently derived and differ", () => {
    const light = derivedRamp(D, false)
    const dark = derivedRamp(D, true)
    expect(dark).not.toEqual(light)
    expect(dark).toHaveLength(6)
  })
})

describe("splitInk", () => {
  it('conserves paper: Π(1 - c_i) === 1 - C, "total ink is the money"', () => {
    const cases: Array<[number, number[]]> = [
      [0.5, [1, 1, 1]],
      [0.3, [1, 0, 0]],
      [0.88, [0.2, 0.3, 0.5]],
      [0.4625, [1e-6, 0, 0]],
      [0.7048, [1, 1, 0]],
    ]
    for (const [C, weights] of cases) {
      const covs = splitInk(C, weights)
      const paperLeft = covs.reduce((acc, c) => acc * (1 - c), 1)
      expect(paperLeft).toBeCloseTo(1 - C, 9)
    }
  })

  it("an all-zero weight vector leaves the paper untouched", () => {
    expect(splitInk(0.5, [0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe("coverageAt", () => {
  it("maps each of the six t values to its table entry", () => {
    const table = D.table!
    for (let i = 0; i < table.length; i++) {
      const t = i / (table.length - 1)
      expect(coverageAt(t, table)).toBe(table[i])
    }
  })
})
