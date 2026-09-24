/**
 * The step-table solver, and the colour measurements the ramp tests use.
 *
 * inks.ts has always said D's middle coverages are "solved, not chosen" —
 * floor and ceiling are the only picked numbers, and the four between them
 * are whatever makes the six PRINTED tones equally spaced in perceived
 * lightness. Until now the solve lived outside the repo and the table was a
 * typed copy of its output, which is exactly the shape of the bug
 * COMPARISON.md §8 records: a derived value kept by hand drifts.
 *
 * So the solve is here, and inks.test.ts asserts the shipped table IS its
 * output. Change a plate ink without re-solving and the test fails.
 *
 * OKLab is Björn Ottosson's, from linear sRGB. The dataviz validator reports
 * the same L and ΔE (ΔE here is Euclidean OKLab × 100, its convention).
 */
import { plateTone, seqWeights, splitInk, type HexColor } from "./inks"

const lin = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)

export function okLab(hex: HexColor): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.substr(i, 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}

/** Perceived lightness, OKLab L in 0..1. */
export const okL = (hex: HexColor): number => okLab(hex)[0]

/** OKLab hue angle in degrees, 0..360. */
export function okHue(hex: HexColor): number {
  const [, a, b] = okLab(hex)
  const h = Math.atan2(b, a) * 180 / Math.PI
  return h < 0 ? h + 360 : h
}

/** ΔE in the dataviz validator's units: Euclidean OKLab distance × 100. */
export function deltaE(x: HexColor, y: HexColor): number {
  const p = okLab(x), q = okLab(y)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100
}

/**
 * The hue a ramp SWEEPS, degrees — the arc from its first tone to its last,
 * through the tones between, taking the short way at each step. This is the
 * number the "broadening of colour" is measured by.
 */
export function hueSweep(ramp: HexColor[]): number {
  let total = 0
  for (let i = 1; i < ramp.length; i++) {
    let d = okHue(ramp[i]) - okHue(ramp[i - 1])
    if (d > 180) d -= 360
    if (d < -180) d += 360
    total += d
  }
  return Math.abs(total)
}

/** The tone a sequential three-plate step prints at composite coverage C. */
export function seqTone(paper: HexColor, inks: HexColor[], C: number, t: number, dark: boolean): HexColor {
  return plateTone(paper, inks, splitInk(C, seqWeights(t, inks.length)), dark)
}

/**
 * Solve the composite coverage per step so the printed tones are equally
 * spaced in OKLab L between the floor tone and the ceiling tone.
 *
 * Each step t = i/(steps-1) uses its own plate weights (the sequential
 * build), so the solve runs on the tone that step ACTUALLY prints rather than
 * on one ink. Bisection, because lightness is monotone in coverage on both
 * stocks — darker with more ink on paper, brighter with more light on a dark
 * ground — and the direction is read off the two ends rather than assumed.
 */
export function solveTable(
  paper: HexColor, inks: HexColor[], floor: number, ceil: number,
  dark: boolean, steps = 6,
): number[] {
  const L0 = okL(seqTone(paper, inks, floor, 0, dark))
  const L1 = okL(seqTone(paper, inks, ceil, 1, dark))
  const out = [floor]
  for (let i = 1; i < steps - 1; i++) {
    const t = i / (steps - 1)
    const target = L0 + (L1 - L0) * t
    let lo = floor, hi = ceil
    const rising = okL(seqTone(paper, inks, hi, t, dark)) > okL(seqTone(paper, inks, lo, t, dark))
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2
      const L = okL(seqTone(paper, inks, mid, t, dark))
      if ((L < target) === rising) lo = mid; else hi = mid
    }
    out.push(Math.round(((lo + hi) / 2) * 1e4) / 1e4)
  }
  out.push(ceil)
  return out
}
