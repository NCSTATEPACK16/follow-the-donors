/**
 * Round-2 chrome: the two plates, the two layers, and the band that never
 * goes away.
 *
 * Shared for the same reason atlas.ts is shared — D, E and F are a comparison
 * of three ENCODINGS, and if the view machinery differed between them the
 * comparison would be of something else. v1 ships only D; the machinery
 * still lives here rather than being inlined into App.tsx, in case E/F ship
 * later (v1.1+).
 *
 * Ported from web/prototypes/shared/view.js.
 */
import { geoBounds, geoConicEqualArea } from "d3-geo"
import { PARTY, partyPlate, usd, usdCompact, type PartyInk } from "./inks"
import type { Atlas, DistrictProperties, FeatureCollectionOf, GeoFeatureOf, SenateArtifact, StateProperties } from "./atlas"

/* ------------------------------------------------------------------ */
/*  The screen scale — a blow-up is a NEW PLATE                        */
/* ------------------------------------------------------------------ */

/**
 * Cell size in CSS pixels per map vintage, at NATIONAL scale.
 *
 * BASE_CELL carries over from round 1's prototype B, where 4.2/7.0/11.5 was
 * tuned down to 3.6/5.6/8.4 after looking at the first render: at 11.5 the
 * coarse screen read as polka dots and pulled the eye off the money entirely.
 *
 * The RATIO between the three is the certainty encoding — superseded is
 * 2.33x current, and that is what says "173 of 441 districts sit on a map
 * that is no longer the law". So the grain is changed only through GRAIN,
 * which scales the whole table; editing one entry would silently change what
 * the map claims. web/check.mjs asserts the ratio.
 *
 * GRAIN 0.7 (2026-09-24): the user asked for a smaller, finer screen. The
 * current-map cell goes 3.6px -> 2.52px — an engraved grain that reads as a
 * colour at arm's length rather than as dots — while a superseded district
 * is still 5.9px and still visibly coarse. Costs nothing: the cell is a
 * fragment-shader constant and coverage is untouched, so every validated
 * tone is exactly as measured.
 */
export const GRAIN = 0.7

const BASE_CELL = { cd119_current: 3.6, cd119_contested: 5.6, cd119_superseded: 8.4 }
export const CELL: Record<string, number> = {
  cd119_current: BASE_CELL.cd119_current * GRAIN,
  cd119_contested: BASE_CELL.cd119_contested * GRAIN,
  cd119_superseded: BASE_CELL.cd119_superseded * GRAIN,
  override_applied: BASE_CELL.cd119_current * GRAIN,
}
export const FLAT_CELL = BASE_CELL.cd119_current * GRAIN

/**
 * The state plate is re-screened COARSER, and that is the whole answer to
 * "ensure we can see it better when we zoom in".
 *
 * A print shop re-screens for a new size rather than enlarging the old
 * screen's dots. It is a single multiplier over CELL rather than a second
 * table, so every certainty ratio survives the change intact.
 */
export const NATIONAL_SCALE = 1
export const STATE_SCALE = 8 / BASE_CELL.cd119_current   // ≈ 2.222 — the state
// plate keeps the same RELATIVE blow-up; with GRAIN it lands at 5.6px, not 8.

/**
 * A district blow-up is a THIRD plate, re-screened again.
 *
 * Same rule as the state tier: a print shop re-screens for a new size rather
 * than enlarging the old screen's dots. One multiplier over CELL, so every
 * certainty ratio survives — a superseded district is still 2.33x coarser
 * than a current one at all three sizes.
 *
 * 14px at base, not the v1.1 plan's 18: the plan predates GRAIN, and 18 on
 * the finer grain put a superseded district's dots at 29px — polka dots,
 * which is the exact failure round 1 tuned CELL down to avoid. At 14 the
 * current cell is 9.8px and superseded 22.9px: visibly dots, still a screen.
 */
export const DISTRICT_SCALE = 14 / BASE_CELL.cd119_current   // ≈ 3.889

/* ------------------------------------------------------------------ */
/*  Projections                                                        */
/* ------------------------------------------------------------------ */

/**
 * A projection for ONE state, fitted.
 *
 * Deliberately not geoAlbersUsa — that projection is a composite of three
 * sub-projections joined by clip rectangles, and fitting it to a single
 * state either lands the state in the wrong pane or returns the clip
 * rectangle. A conic equal-area rotated onto the state's own centroid and
 * given parallels from its own latitude span is correct for ANY state at
 * this scale, Alaska and Hawaii included — and it can draw the five
 * territory delegations the national view structurally cannot.
 */
export function makeStateProjection(features: GeoFeatureOf<DistrictProperties>[], width: number, height: number, pad = 18) {
  const fc = { type: "FeatureCollection" as const, features }
  const [[w, s], [e, n]] = geoBounds(fc as never)
  const lon = (w + e) / 2
  // Standard parallels at 1/6 and 5/6 of the latitude span is the usual
  // minimum-distortion choice for a conic over a small area.
  const p1 = s + (n - s) / 6, p2 = n - (n - s) / 6
  return geoConicEqualArea()
    .parallels([p1, p2])
    .rotate([-lon, 0])
    .fitExtent([[pad, pad], [width - pad, height - pad]], fc as never)
}

/** One district, fitted — the same conic as makeStateProjection, which is
 *  correct at any scale and can draw the territory delegations Albers USA
 *  structurally cannot. More padding than a state: a lone district needs
 *  room for its keyline to read as an edge rather than a frame. */
export function makeDistrictProjection(
  feature: GeoFeatureOf<DistrictProperties>, width: number, height: number, pad = 28,
) {
  return makeStateProjection([feature], width, height, pad)
}

/** Every district feature belonging to one state, in geoid order. */
export function districtsOf(atlas: Atlas, st: string): GeoFeatureOf<DistrictProperties>[] {
  return atlas.districts.features.filter((f) => f.properties.state === st)
}

export interface StateIndexRow {
  state: string
  pac_cents: number
  districts: number
  superseded: number
}

/** The states present in the data, with their House totals, for the picker. */
export function stateIndex(atlas: Atlas): StateIndexRow[] {
  const by = new Map<string, StateIndexRow>()
  for (const f of atlas.districts.features) {
    const p = f.properties
    const s = by.get(p.state) || {
      state: p.state, pac_cents: 0, districts: 0, superseded: 0,
    }
    s.pac_cents += p.pac_cents
    s.districts += 1
    if (p.map_status === "cd119_superseded") s.superseded += 1
    by.set(p.state, s)
  }
  return [...by.values()].sort((a, b) => b.pac_cents - a.pac_cents)
}

/**
 * Quantile breaks over an arbitrary set of values.
 *
 * The Senate layer needs its own: 50 state totals are a different
 * distribution from 441 district totals, and reusing the district breaks
 * would print most states in the bottom step. Computed from the loaded
 * artifact rather than shipped as a constant, so it cannot drift away from
 * the data it describes.
 */
export function quantileBreaks(values: number[], steps = 6): number[] {
  const v = [...values].sort((a, b) => a - b)
  if (!v.length) return []
  const at = (q: number) => {
    const i = (v.length - 1) * q
    const lo = Math.floor(i), hi = Math.ceil(i)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)
  }
  const out: number[] = []
  for (let k = 1; k < steps; k++) out.push(at(k / steps))
  return out
}

/* ------------------------------------------------------------------ */
/*  Tilt                                                               */
/* ------------------------------------------------------------------ */

/**
 * Party tilt in [-1, +1]: -1 all Democratic, +1 all Republican, 0 even.
 *
 * The clamp is NOT defensive dressing — FEC contribution rows can be
 * negative (a refund exceeding receipts in a filing period), so an
 * unclamped ratio can land outside [-1, 1] and index past the end of a
 * ramp array. Returns null when there is no major-party money at all, which
 * is a different fact from "even" and must not print as the neutral
 * midpoint.
 */
export function tiltOf(p: { rep_cents?: number; dem_cents?: number }): number | null {
  const r = p.rep_cents || 0, d = p.dem_cents || 0
  const denom = Math.abs(r) + Math.abs(d)
  if (denom === 0) return null
  return Math.max(-1, Math.min(1, (r - d) / denom))
}

/* ------------------------------------------------------------------ */
/*  The band that never goes away                                      */
/* ------------------------------------------------------------------ */

/**
 * The mid-cycle caveat, rendered persistently on every view.
 *
 * CLAUDE.md is categorical: every published figure names the filing period
 * it covers. So this is a band across the page and not a tooltip, not a
 * colophon line, and not something a control can dismiss.
 */
export function renderCycleBand(el: HTMLElement, meta: { mid_cycle?: string; cycle: string; reconciliation: { relative: number }; filing_period: string }) {
  if (!meta.mid_cycle) { el.innerHTML = ""; el.hidden = true; return }
  el.hidden = false
  const rel = meta.reconciliation.relative
  el.innerHTML = `
    <div class="band-mark" aria-hidden="true"></div>
    <div class="band-body">
      <strong>${meta.cycle} is still being filed.</strong>
      These are contributions <em>as filed</em>, not final. Filing periods are
      partial and amendments are continuous; the totals here run
      <span class="band-num">${(rel * 100).toFixed(2)}%</span> against the FEC's
      own published candidate summaries, where the closed 2024 cycle
      reconciles to −0.72%.
      <span class="band-period">${meta.filing_period}</span>
    </div>`
}

/* ------------------------------------------------------------------ */
/*  Senate                                                             */
/* ------------------------------------------------------------------ */

/**
 * The Senate layer's own legend.
 *
 * The COARSE SCREEN carries one meaning across both layers: *this figure is
 * not what it appears to be*. On the district layer it is a superseded
 * boundary; here it is money banked for an election that is not this one.
 */
export function renderSenateLegend(el: HTMLElement, senate: SenateArtifact) {
  el.innerHTML = `
    <div class="legend-title">Senate PAC money, ${senate.cycle} cycle</div>
    <div class="sen-stats">
      <div class="sen-stat">
        <span class="sen-num">${usdCompact(senate.total_cents)}</span>
        <span class="sen-lab">to Senate candidates, all 50 states</span>
      </div>
      <div class="sen-stat">
        <span class="sen-num">${usdCompact(senate.up_state_cents)}</span>
        <span class="sen-lab">in the ${senate.seats_up} states with a seat up</span>
      </div>
      <div class="sen-stat sen-stat-warn">
        <span class="sen-num">${usdCompact(senate.banked_state_cents)}</span>
        <span class="sen-lab">in the ${senate.banked_states} states with no seat up —
          printed coarse, banked for a later cycle</span>
      </div>
    </div>
    <div class="legend-vintage">
      <div class="lv"><span class="lv-mark lv-current"></span>
        A seat is up in ${senate.cycle}</div>
      <div class="lv"><span class="lv-mark lv-stale"></span>
        No seat up — every dollar is banked for a later cycle. Same coarse
        screen as a superseded district, and for the same reason: the figure
        is not what it appears to be.</div>
    </div>
    <p class="legend-foot">${senate.boundary_note}</p>
    ${senate.corrections.length ? `
      <p class="legend-foot legend-foot-fix">${senate.corrections.map((c) => `
        One row was filed under <b>${c.from}</b> and is counted here under
        <b>${c.to}</b> (${usd(c.cents)}). ${c.why}`).join("")}</p>` : ""}`
}

/** Senate table view — colour is never the only channel. */
export function renderSenateTable(el: HTMLElement, states: GeoFeatureOf<StateProperties>[], senate: SenateArtifact) {
  const rows = [...states]
    .filter((f) => f.properties.has_senate)
    .sort((a, b) => b.properties.total_cents - a.properties.total_cents)
  el.innerHTML = `
    <table>
      <caption>All ${rows.length} states, ${senate.cycle} cycle, by PAC
        contributions to Senate candidates.</caption>
      <thead><tr>
        <th scope="col">State</th>
        <th scope="col" class="num">Senate PAC money</th>
        <th scope="col" class="num">For ${senate.cycle}</th>
        <th scope="col" class="num">Banked for later</th>
        <th scope="col">Seat up</th>
      </tr></thead>
      <tbody>${rows.map((f) => {
        const p = f.properties
        return `<tr><th scope="row">${p.state}</th>
          <td class="num">${usd(p.total_cents)}</td>
          <td class="num">${usd(p.up_cents)}</td>
          <td class="num">${usd(p.banked_cents)}</td>
          <td><span class="tag ${p.seat_up
            ? "tag-cd119_current" : "tag-cd119_superseded"}">${
            p.seat_up ? senate.cycle : "banked"}</span></td></tr>`
      }).join("")}</tbody>
    </table>`
}

/* ------------------------------------------------------------------ */
/*  The state bar                                                      */
/* ------------------------------------------------------------------ */

/** The "you are looking at Texas" strip, with the way back — one tier at a
 *  time: a district goes back to its state, a state to the nation. */
export function renderStateBar(el: HTMLElement, { state, districts, senate, district }: {
  state: string | null
  districts: GeoFeatureOf<DistrictProperties>[]
  senate: StateProperties | null | undefined
  cycle: string
  district?: DistrictProperties | null
}) {
  if (!state) { el.hidden = true; el.innerHTML = ""; return }
  el.hidden = false
  if (district) {
    el.innerHTML = `
    <button class="ctl statebar-back" id="backtonational">← All of ${state}</button>
    <div class="statebar-id">${state}-${district.cd}</div>
    <div class="statebar-facts">
      <span><b>${usdCompact(district.pac_cents)}</b> in PAC money</span>
      ${district.map_status === "cd119_superseded" ? `<span class="statebar-warn">drawn
        from a superseded map</span>` : ""}
    </div>
    <div class="statebar-screen">Re-screened at ${
      (CELL.cd119_current * DISTRICT_SCALE).toFixed(1)}px —
      a blow-up is a new plate</div>`
    return
  }
  const tot = districts.reduce((a, f) => a + f.properties.pac_cents, 0)
  const stale = districts.filter(
    (f) => f.properties.map_status === "cd119_superseded").length
  el.innerHTML = `
    <button class="ctl statebar-back" id="backtonational">← All districts</button>
    <div class="statebar-id">${state}</div>
    <div class="statebar-facts">
      <span><b>${usdCompact(tot)}</b> to ${districts.length}
        House district${districts.length === 1 ? "" : "s"}</span>
      ${senate && senate.has_senate ? `<span><b>${usdCompact(senate.total_cents)}</b>
        to Senate candidates${senate.seat_up ? "" : " — banked, no seat up"}</span>` : ""}
      ${stale ? `<span class="statebar-warn">${stale} of ${districts.length}
        drawn from a superseded map</span>` : ""}
    </div>
    <div class="statebar-screen">Re-screened at ${
      (CELL.cd119_current * STATE_SCALE).toFixed(1)}px —
      a blow-up is a new plate</div>`
}

/* ------------------------------------------------------------------ */
/*  The party layer's legend                                           */
/* ------------------------------------------------------------------ */

/**
 * The four money steps' labels. The six quantile classes fold into four the
 * same way partyStep() folds them (floor(i/5 * 4)): classes 0-1 are step 0,
 * 2 is 1, 3 is 2, 4-5 are 3. Derived from the breaks, never typed.
 */
export function partyStepLabels(breaks: number[]): string[] {
  return [
    `under ${usdCompact(breaks[1])}`,
    `${usdCompact(breaks[1])} – ${usdCompact(breaks[2])}`,
    `${usdCompact(breaks[2])} – ${usdCompact(breaks[3])}`,
    `over ${usdCompact(breaks[3])}`,
  ]
}

/**
 * Two four-step ramps side by side, plus the neutral case with its hatch.
 * Chips are empty spans the caller paints with the real halftone, exactly
 * like the money legend — `data-party` and `data-step` say what to paint.
 */
export function renderPartyLegend(el: HTMLElement, opts: {
  cycle: string; breaks: number[]; ambiguous: number; hasData: boolean
}) {
  if (!opts.hasData) {
    el.innerHTML = `
      <div class="legend-title">Who holds the seat, ${opts.cycle} cycle</div>
      <p class="legend-foot">This build's district data predates the party
        field. Rebuild stage 07 to draw this layer.</p>`
    return
  }
  const labels = partyStepLabels(opts.breaks)
  const col = (party: PartyInk, name: string) => `
    <div class="party-col">
      <div class="party-name">${name}</div>
      ${labels.map((_, i) => `<span class="legend-chip" data-party="${party}" data-step="${i}"></span>`).join("")}
    </div>`
  el.innerHTML = `
    <div class="legend-title">Who holds the seat, ${opts.cycle} cycle</div>
    <div class="party-legend">
      ${col("REP", "Republican")}
      ${col("DEM", "Democrat")}
      <div class="party-col party-labels">
        <div class="party-name">PAC money</div>
        ${labels.map((l) => `<span class="legend-lab">${l}</span>`).join("")}
      </div>
    </div>
    <div class="lv party-neutral">
      <span class="lv-mark party-neutral-chip" data-party="NEUTRAL" data-step="1"></span>
      <span><b>No single party incumbent</b> — ${opts.ambiguous} district${
        opts.ambiguous === 1 ? "" : "s"}: nobody has filed as the sitting member,
        more than one has because the lines moved, or the member is a third
        party. Gray, and hatched, because colour alone cannot tell it from red
        for a red-green colour-blind reader.</span>
    </div>
    <p class="legend-foot"><b>Four money steps, not six.</b> Red and blue have
      to stay apart from each other at every level, and that costs tonal
      range: any finer and the lightest red and blue become the same colour
      to a red-green colour-blind reader. The money map keeps all six.</p>`
}

/** Paint one party chip: the plate's own ink at the step's own coverage,
 *  at the map's cell — the same rule as the money legend. */
export function partyChipCoverage(party: PartyInk, step: number, dark: boolean) {
  const { ink, table } = partyPlate(party, dark)
  return { ink, cov: table[Math.max(0, Math.min(PARTY.STEPS - 1, step))] }
}

/** The state picker. A map you can only enter by clicking a 2px polygon is
 *  not reachable by keyboard, so the list is the primary control and the
 *  map click is the shortcut. */
export function renderStatePicker(el: HTMLElement, index: StateIndexRow[], onPick: (state: string) => void) {
  el.innerHTML = `
    <label class="picker-lab" for="statepick">Blow up one state</label>
    <select class="ctl" id="statepick">
      <option value="">— choose a state —</option>
      ${index.map((s) => `<option value="${s.state}">${s.state} · ${
        usdCompact(s.pac_cents)} · ${s.districts} district${
        s.districts === 1 ? "" : "s"}${
        s.superseded ? ` · ${s.superseded} superseded` : ""}</option>`).join("")}
    </select>`
  el.querySelector("#statepick")!.addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value
    if (v) onPick(v)
  })
}

export type { FeatureCollectionOf }
