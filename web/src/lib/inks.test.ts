import { describe, expect, it } from "vitest"
import {
  D, PARTY, S, coverageAt, derivedRamp, partyInkOf, partyRamp, partyStep, pathWeights, platesOf, splitInk,
} from "./inks"
import { deltaE, hueSweep, okL, solvePathTable } from "./solve"

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

describe("the step tables are SOLVED, not typed", () => {
  // Each table is a consequence of its plates and ink path: the four middle
  // coverages are whatever spaces the six printed tones equally in
  // lightness. A plate or path changed without re-running the solve would
  // leave a table that no longer does that, and nothing else would notice.
  for (const sys of [D, S]) for (const dark of [false, true]) {
    it(`${sys.name} ${dark ? "dark" : "light"} table is solvePathTable's output`, () => {
      const table = (dark ? sys.tableDark : sys.table)!
      const path = (dark ? sys.pathDark : sys.path)!
      expect(solvePathTable(dark ? sys.paperDark : sys.paper, platesOf(sys, dark), path,
        table[0], 0.88, dark)).toEqual(table)
    })
  }
  it("no step prints past the composite cap", () => {
    for (const sys of [D, S]) for (const t of [sys.table!, sys.tableDark!])
      for (const c of t) expect(c).toBeLessThanOrEqual(0.88)
  })
  it("an ink-path step overprints at most two neighbouring plates", () => {
    for (const sys of [D, S]) for (const p of [...sys.path!, ...sys.pathDark!]) {
      const w = pathWeights(p)
      expect(w[0] > 0 && w[2] > 0).toBe(false)
    }
  })
})

describe("the Senate plate is its own map", () => {
  for (const dark of [false, true]) {
    const stock = dark ? "dark" : "light"
    const ramp = derivedRamp(S, dark)
    const L = ramp.map(okL)
    it(`${stock}: monotone, and every step clears the 0.06 lightness gate`, () => {
      for (let i = 1; i < L.length; i++) {
        expect(dark ? L[i] > L[i - 1] : L[i] < L[i - 1]).toBe(true)
        expect(Math.abs(L[i] - L[i - 1])).toBeGreaterThanOrEqual(0.06)
      }
    })
    it(`${stock}: shares no ink with the House plate`, () => {
      const house = new Set(platesOf(D, dark))
      for (const ink of platesOf(S, dark)) expect(house.has(ink)).toBe(false)
    })
  }
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
      // Was 66° light / 47° dark. The floor is 110°, under the measured 160°
      // and 138° (2026-09-27 Riso plates), so a re-solve can move a little without a false alarm but a
      // quiet return to a one-family green ramp cannot.
      expect(hueSweep(ramp)).toBeGreaterThanOrEqual(110)
    })
  }
})

describe("PARTY", () => {
  it("carries four money steps, not six — the measured limit", () => {
    expect(PARTY.STEPS).toBe(4)
    for (const t of [PARTY.tableRep, PARTY.tableDem, PARTY.tableRepDark, PARTY.tableDemDark]) {
      expect(t).toHaveLength(4)
    }
  })

  it("gives the two parties their OWN coverage tables", () => {
    // They differ so the two ramps PRINT at the same lightness. A red step 2
    // and a blue step 2 have to read as the same money.
    expect(PARTY.tableRep).not.toEqual(PARTY.tableDem)
    expect(PARTY.tableRepDark).not.toEqual(PARTY.tableDemDark)
  })

  for (const dark of [false, true]) {
    const stock = dark ? "dark" : "light"
    it(`${stock}: red and blue clear the 15 normal-vision floor at EVERY money step`, () => {
      // Round 2's E failed exactly this at the bottom four of six steps.
      const R = partyRamp("REP", dark), B = partyRamp("DEM", dark)
      for (let i = 0; i < 4; i++) expect(deltaE(R[i], B[i])).toBeGreaterThanOrEqual(15)
    })

    it(`${stock}: every ramp steps by >= 0.06 lightness, and all three agree on the money`, () => {
      const ramps = (["REP", "DEM", "NEUTRAL"] as const).map((p) => partyRamp(p, dark).map(okL))
      for (const L of ramps) {
        for (let i = 1; i < 4; i++) expect(Math.abs(L[i] - L[i - 1])).toBeGreaterThanOrEqual(0.06)
      }
      for (let i = 0; i < 4; i++) {
        expect(Math.abs(ramps[0][i] - ramps[1][i])).toBeLessThan(0.03)
        expect(Math.abs(ramps[0][i] - ramps[2][i])).toBeLessThan(0.03)
      }
    })
  }

  it("never paints an ambiguous seat as a party", () => {
    expect(partyInkOf("REP")).toBe("REP")
    expect(partyInkOf("DEM")).toBe("DEM")
    for (const v of ["OTH", "none", "several", undefined, null]) expect(partyInkOf(v)).toBe("NEUTRAL")
  })

  it("folds the six money quantiles into four steps, bottom to top", () => {
    const breaks = [10, 20, 30, 40, 50]
    expect([5, 15, 25, 35, 45, 55].map((c) => partyStep(c, breaks))).toEqual([0, 0, 1, 2, 3, 3])
  })
})
