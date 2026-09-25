import { describe, expect, it } from "vitest"
import { D, coverageAt, derivedRamp, splitInk } from "./inks"
import { deltaE, hueSweep, okL, solveTable } from "./solve"

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

describe("D's step tables are SOLVED, not typed", () => {
  // The table is a consequence of the plates: the four middle coverages are
  // whatever spaces the six printed tones equally in lightness. A plate ink
  // changed without re-running the solve would leave a table that no longer
  // does that, and nothing else would notice.
  it("light table is solveTable's output for the light plates", () => {
    const P = D.plates!
    expect(solveTable(D.paper, [P.first, P.second, P.third], 0.34, 0.88, false))
      .toEqual(D.table)
  })
  it("dark table is solveTable's output for the dark plates", () => {
    const P = D.platesDark!
    expect(solveTable(D.paperDark, [P.first, P.second, P.third], 0.34, 0.88, true))
      .toEqual(D.tableDark)
  })
})

describe("D's printed ramp", () => {
  for (const dark of [false, true]) {
    const stock = dark ? "dark" : "light"
    const ramp = derivedRamp(D, dark)
    const L = ramp.map(okL)

    it(`${stock}: lightness is monotone — the order is carried by L alone`, () => {
      for (let i = 1; i < L.length; i++) {
        if (dark) expect(L[i]).toBeGreaterThan(L[i - 1])
        else expect(L[i]).toBeLessThan(L[i - 1])
      }
    })

    it(`${stock}: every adjacent step clears the 0.06 lightness gate`, () => {
      for (let i = 1; i < L.length; i++) {
        expect(Math.abs(L[i] - L[i - 1])).toBeGreaterThanOrEqual(0.06)
      }
    })

    it(`${stock}: neighbouring money steps are further apart than the old plates'`, () => {
      // Round 2's green/teal/navy set measured min adjacent ΔE 7.6 light and
      // 7.0 dark. Readability between neighbouring districts is the point of
      // the 2026-09-24 change, so it may not regress below that.
      const floor = dark ? 7.0 : 7.6
      for (let i = 1; i < ramp.length; i++) {
        expect(deltaE(ramp[i], ramp[i - 1])).toBeGreaterThan(floor)
      }
    })

    it(`${stock}: the hue sweep is broad — the broadening is asserted, not claimed`, () => {
      // Was 66° light / 47° dark. The floor is 110°, under the measured 127°
      // and 138°, so a re-solve can move a little without a false alarm but a
      // quiet return to a one-family green ramp cannot.
      expect(hueSweep(ramp)).toBeGreaterThanOrEqual(110)
    })
  }
})
