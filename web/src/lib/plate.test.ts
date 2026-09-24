import { describe, expect, it } from "vitest"
import { STRIDE_FLOATS, districtPhase, triangulatePlates } from "./plate"

describe("districtPhase", () => {
  it("is stable for a district across calls and indices", () => {
    // A phase tied to draw order would reshuffle the map's motion on every
    // re-layout, theme change and blow-up.
    expect(districtPhase({ geoid: "4835" }, 0)).toBe(districtPhase({ geoid: "4835" }, 99))
  })
  it("scatters neighbouring geoids — no travelling wave across a state", () => {
    const ph = ["4801", "4802", "4803", "4804", "4805"].map((g) => districtPhase({ geoid: g }, 0))
    expect(new Set(ph.map((p) => p.toFixed(3))).size).toBe(5)
    for (const p of ph) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(1) }
    const sorted = [...ph].sort((a, b) => a - b)
    expect(sorted[4] - sorted[0]).toBeGreaterThan(0.3)
  })
})

describe("triangulatePlates", () => {
  it("writes the district's phase into every one of its vertices", () => {
    const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    const f = (geoid: string) => ({ properties: { geoid }, geometry: { type: "Polygon", coordinates: [sq] } })
    const { data, count } = triangulatePlates(
      [f("0101"), f("0102")], (c) => [c[0] * 10, c[1] * 10], () => ({ cov: [0.5, 0, 0], cell: 2 }))
    expect(count).toBe(12)
    const phases = new Set<number>()
    for (let v = 0; v < count; v++) phases.add(data[v * STRIDE_FLOATS + STRIDE_FLOATS - 1])
    expect([...phases].sort()).toEqual(
      [districtPhase({ geoid: "0101" }, 0), districtPhase({ geoid: "0102" }, 1)]
        .map((x) => Math.fround(x)).sort())
  })
})
