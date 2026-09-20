/**
 * Shared plumbing for the riso map: data loading, the projection,
 * hit-testing, and the string-rendered page fragments (sheet, table,
 * legend, offmap chips, masthead). The rendering functions build
 * `innerHTML` exactly as the prototype did — App.tsx targets them at
 * React-managed container refs instead of `document.getElementById`, but
 * the markup and the numbers are unchanged. "Port it, do not redesign it."
 *
 * Ported from web/prototypes/shared/atlas.js.
 */
import { geoAlbersUsa, geoCentroid } from "d3-geo"
import {
  SECTOR_ORDER, OTHER_LABEL, STATUS_LABEL, BREAKS_CENTS, usd, usdCompact,
  type System,
} from "./inks"
import { ASSETS, type Cycle } from "./config"

export interface DistrictProperties {
  geoid: string
  state: string
  cd: string
  name: string
  map_status: string
  map_vintage: string
  legal_status: string
  pac_cents: number
  contributions: number
  candidates: number
  donor_committees: number
  rep_cents: number
  dem_cents: number
  oth_cents: number
  [key: string]: unknown
}

export interface StateProperties {
  state: string
  pac_cents: number
  contributions: number
  has_senate: boolean
  total_cents: number
  up_cents: number
  banked_cents: number
  rep_cents: number
  dem_cents: number
  oth_cents: number
  seat_up: boolean
  donor_committees: number
  sectors?: [string, number][]
  [key: string]: unknown
}

export interface GeoFeatureOf<P> {
  type: "Feature"
  properties: P
  geometry: { type: string; coordinates: unknown }
  index?: number
}

export interface FeatureCollectionOf<P> {
  type: "FeatureCollection"
  features: GeoFeatureOf<P>[]
}

export interface SenateArtifact {
  cycle: string
  states: Record<string, Omit<StateProperties, "state" | "has_senate">>
  corrections: Array<{ cand_id: string; from: string; to: string; cents: number; why: string }>
  total_cents: number
  cycle_cents: number
  later_cycle_cents: number
  up_state_cents: number
  banked_state_cents: number
  seats_up: number
  banked_states: number
  boundary_note: string
}

export interface MetaArtifact {
  cycle: string
  gated: boolean
  filing_period: string
  breaks_cents: number[]
  break_labels: string[]
  district_dollars: number
  superseded_dollars: number
  superseded_share: number
  reconciliation: { computed: number; reported: number; relative: number }
  status_counts: Record<string, number>
  party: { rep_cents: number; dem_cents: number; oth_cents: number }
  mid_cycle?: string
}

export interface Atlas {
  cycle: Cycle
  districts: FeatureCollectionOf<DistrictProperties>
  sectors: Record<string, [string, number][]>
  meta: MetaArtifact
  states: FeatureCollectionOf<StateProperties> | null
  senate: SenateArtifact | null
}

/**
 * `states` and `senate` are fetched only when asked for: a page that never
 * shows the Senate layer should not pay for one.
 */
export async function loadAtlas(cycle: Cycle, opts: { senate?: boolean } = {}): Promise<Atlas> {
  const want = { senate: false, ...opts }
  const [districts, sectors, meta, states, senate] = await Promise.all([
    fetch(ASSETS.districts(cycle)).then((r) => r.json()),
    fetch(ASSETS.sectors(cycle)).then((r) => r.json()),
    fetch(ASSETS.meta(cycle)).then((r) => r.json()),
    want.senate ? fetch(ASSETS.states(cycle)).then((r) => r.json()) : null,
    want.senate ? fetch(ASSETS.senate(cycle)).then((r) => r.json()) : null,
  ])
  districts.features.sort((a: GeoFeatureOf<DistrictProperties>, b: GeoFeatureOf<DistrictProperties>) =>
    a.properties.geoid < b.properties.geoid ? -1 : 1)
  districts.features.forEach((f: GeoFeatureOf<DistrictProperties>, i: number) => { f.index = i })
  if (states) {
    states.features.sort((a: GeoFeatureOf<StateProperties>, b: GeoFeatureOf<StateProperties>) =>
      a.properties.state < b.properties.state ? -1 : 1)
    states.features.forEach((f: GeoFeatureOf<StateProperties>, i: number) => { f.index = i })
    // The Senate money hangs off the state feature so the renderers can treat
    // a state exactly like a district: one feature, one set of numbers.
    for (const f of states.features) {
      const s = senate.states[f.properties.state]
      Object.assign(f.properties, s
        ? { ...s, has_senate: true }
        : {
            // DC and the five territory delegations elect no senators. That
            // is not missing data and must not print as $0 alongside states
            // that genuinely received nothing — it is a different fact.
            has_senate: false, total_cents: 0, up_cents: 0, banked_cents: 0,
            rep_cents: 0, dem_cents: 0, oth_cents: 0, seat_up: false,
          })
    }
  }
  return { cycle, districts, sectors, meta, states, senate }
}

/** Albers USA, fitted. AK and HI are inset by d3 — without that they drag the
 *  lower 48 down to a stamp, and a map of federal money that cannot show two
 *  states is not a map of federal money. */
export function makeProjection(districts: FeatureCollectionOf<unknown>, width: number, height: number, pad = 12) {
  return geoAlbersUsa().fitExtent(
    [[pad, pad], [width - pad, height - pad]], districts as never)
}

/**
 * Split the 441 rows into what Albers USA can draw and what it cannot.
 *
 * geoAlbersUsa covers the 50 states and DC and NOTHING else. The five
 * non-voting territory delegations — AS, GU, MP, PR, VI — fall outside every
 * sub-projection, and d3 does not quietly drop them: each one clips against
 * the composite's clip rectangle and comes back as the FULL RECTANGLE, which
 * then paints over the entire map.
 *
 * They are separated, never dropped. They render as chips beside the map and
 * appear in the table.
 */
export function partitionProjectable<P>(districts: FeatureCollectionOf<P>) {
  // The test uses a PLAIN, unfitted albersUsa on purpose. fitExtent over a
  // collection that still contains the territories is itself poisoned by the
  // clip-rectangle bounds described above, so fitting first and testing
  // second rejects every feature.
  const probe = geoAlbersUsa()
  const mapped: FeatureCollectionOf<P> = { type: "FeatureCollection", features: [] }
  const offmap: GeoFeatureOf<P>[] = []
  for (const f of districts.features) {
    ;(probe(geoCentroid(f as never) as never) ? mapped.features : offmap).push(f)
  }
  return { mapped, offmap }
}

/** Delegations Albers USA cannot place, rendered as labelled chips so the
 *  money is visible even though the geography is not. */
export function renderOffmap(
  el: HTMLElement, offmap: GeoFeatureOf<DistrictProperties>[], sys: System, dark: boolean,
  onPick?: (geoid: string) => void, breaks: number[] = BREAKS_CENTS,
) {
  if (!offmap.length) { el.innerHTML = ""; return }
  const ramp = dark ? sys.rampDark : sys.ramp
  const step = (c: number) => {
    let i = 0; while (i < breaks.length && c > breaks[i]) i++
    return ramp[Math.min(i, ramp.length - 1)]
  }
  el.innerHTML = `
    <div class="offmap-lab">Not placeable on an Albers USA projection —
      shown here so the money is not lost:</div>
    <div class="offmap-chips">${offmap.map((f) => {
      const p = f.properties
      return `<button class="offchip" data-geoid="${p.geoid}"
        style="--ink:${step(p.pac_cents)}">
        <span class="offchip-ink"></span>
        <span class="offchip-id">${p.state}</span>
        <span class="offchip-amt">${usdCompact(p.pac_cents)}</span>
      </button>`
    }).join("")}</div>`
  if (onPick) el.querySelectorAll(".offchip").forEach((b) =>
    b.addEventListener("click", () => onPick((b as HTMLElement).dataset.geoid!)))
}

export interface ProjectedRing { xy: Float32Array; outer: boolean }
export interface ProjectedShape<P> {
  feature: GeoFeatureOf<P>
  rings: ProjectedRing[]
  props: P
  bbox?: [number, number, number, number]
  centroid?: [number, number]
  area?: number
}

export type Projection = (coord: number[]) => [number, number] | null

/**
 * Project every ring once into flat Float32 arrays.
 *
 * Done eagerly and cached because the keyline pass needs the same screen
 * coordinates every frame. d3.geoPath re-projecting 441 gerrymandered
 * polygons per frame is the difference between 60fps and a slideshow.
 */
export function projectAll<P>(
  districts: FeatureCollectionOf<P>, projection: Projection,
): ProjectedShape<P>[] {
  const out: ProjectedShape<P>[] = []
  for (const f of districts.features) {
    const geom = f.geometry
    const polys = geom.type === "Polygon"
      ? [geom.coordinates as number[][][]] : geom.coordinates as number[][][][]
    const rings: ProjectedRing[] = []
    for (const poly of polys) {
      for (const ring of poly) {
        const pts: number[] = []
        for (const c of ring) {
          const p = projection(c)
          if (p) pts.push(p[0], p[1])
        }
        // A ring that projects to fewer than 3 points is off the inset frame
        // (a Pacific territory, a clipped island) and cannot be filled.
        if (pts.length >= 6) rings.push({ xy: new Float32Array(pts), outer: ring === poly[0] })
      }
    }
    out.push({ feature: f, rings, props: f.properties })
  }
  return out
}

/** Bounding box + centroid per district, for labels and the zoom-to-fit. */
export function measure<P>(shapes: ProjectedShape<P>[]): ProjectedShape<P>[] {
  for (const s of shapes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    let cx = 0, cy = 0, n = 0, bestArea = 0
    for (const r of s.rings) {
      let a = 0, mx = 0, my = 0
      for (let i = 0; i < r.xy.length; i += 2) {
        const x = r.xy[i], y = r.xy[i + 1]
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
        const j = (i + 2) % r.xy.length
        const cross = x * r.xy[j + 1] - r.xy[j] * y
        a += cross; mx += (x + r.xy[j]) * cross; my += (y + r.xy[j + 1]) * cross
      }
      a *= 0.5
      // The visual centre of a multi-part district is the centroid of its
      // LARGEST part, not of all parts — otherwise a district with an island
      // labels itself in the sea.
      if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); cx = mx / (6 * a); cy = my / (6 * a); n = 1 }
    }
    s.bbox = [x0, y0, x1, y1]
    s.centroid = n ? [cx, cy] : [(x0 + x1) / 2, (y0 + y1) / 2]
    s.area = bestArea
  }
  return shapes
}

/**
 * Hit-testing by colour picking.
 *
 * Each district is filled into an offscreen canvas with its index encoded as
 * an RGB triple, so a hover is one getImageData of one pixel regardless of
 * how many polygons there are.
 */
export function makePicker<P>(shapes: ProjectedShape<P>[], width: number, height: number, dpr = 1) {
  const cv = document.createElement("canvas")
  cv.width = Math.round(width * dpr)
  cv.height = Math.round(height * dpr)
  const ctx = cv.getContext("2d", { willReadFrequently: true })!
  ctx.scale(dpr, dpr)
  ctx.imageSmoothingEnabled = false
  shapes.forEach((s, i) => {
    // +1 so index 0 is distinguishable from the transparent background.
    const v = i + 1
    ctx.fillStyle = `rgb(${v & 255},${(v >> 8) & 255},${(v >> 16) & 255})`
    ctx.beginPath()
    for (const r of s.rings) {
      ctx.moveTo(r.xy[0], r.xy[1])
      for (let k = 2; k < r.xy.length; k += 2) ctx.lineTo(r.xy[k], r.xy[k + 1])
      ctx.closePath()
    }
    ctx.fill("evenodd")
  })
  return (x: number, y: number): number => {
    const px = Math.round(x * dpr), py = Math.round(y * dpr)
    if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return -1
    const d = ctx.getImageData(px, py, 1, 1).data
    const v = d[0] | (d[1] << 8) | (d[2] << 16)
    return v === 0 ? -1 : v - 1
  }
}

/* ------------------------------------------------------------------ */
/*  Page shell                                                         */
/* ------------------------------------------------------------------ */

export function topSectors(sectors: Record<string, [string, number][]>, geoid: string, limit = 6): [string, number][] {
  const rows = sectors[geoid] || []
  const named: [string, number][] = [], rest: [string, number][] = []
  for (const [name, cents] of rows) {
    ;(SECTOR_ORDER.includes(name) ? named : rest).push([name, cents])
  }
  const otherTotal = rest.reduce((a, [, c]) => a + c, 0)
  const out: [string, number][] = SECTOR_ORDER
    .map((s): [string, number] => [s, (named.find(([n]) => n === s) || [s, 0])[1]])
    .filter(([, c]) => c > 0)
  if (otherTotal > 0) out.push([OTHER_LABEL, otherTotal])
  return out.slice(0, limit)
}

/** The district sheet. Same content in all three prototypes; only the ink differs. */
export function renderSheet(
  el: HTMLElement, shape: { props: DistrictProperties } | null,
  sectors: Record<string, [string, number][]>, sys: System, dark: boolean,
) {
  if (!shape) {
    el.innerHTML = `<p class="sheet-empty">Hover or tap a district.</p>`
    return
  }
  const p = shape.props
  const rows = topSectors(sectors, p.geoid)
  const total = rows.reduce((a, [, c]) => a + c, 0) || 1
  const inkFor = (name: string) => {
    const i = SECTOR_ORDER.indexOf(name)
    return i === -1 ? sys.other : (dark ? sys.inksDark : sys.inks)[i]
  }
  const stale = p.map_status === "cd119_superseded"
  const contested = p.map_status === "cd119_contested"

  el.innerHTML = `
    <div class="sheet-head">
      <div class="sheet-eyebrow">${p.state} · District ${p.cd}</div>
      <div class="sheet-title">${p.name}</div>
      <div class="sheet-amount">${usd(p.pac_cents)}</div>
      <div class="sheet-sub">from ${p.donor_committees.toLocaleString()} political
        committees · ${p.contributions.toLocaleString()} contributions ·
        ${p.candidates} candidate${p.candidates === 1 ? "" : "s"}</div>
    </div>
    <div class="vintage ${stale ? "is-stale" : contested ? "is-contested" : "is-current"}">
      <span class="vintage-mark" aria-hidden="true"></span>
      <div>
        <strong>${STATUS_LABEL[p.map_status] || p.map_status}</strong>
        <div class="vintage-detail">${p.map_vintage}${
          p.legal_status && p.legal_status !== "not_applicable" ? ` · legal status: ${p.legal_status}` : ""}</div>
        ${stale ? `<div class="vintage-detail">Not comparable across cycles.</div>` : ""}
      </div>
    </div>
    <div class="sector-block">
      <div class="sector-label">Where it came from</div>
      ${rows.map(([name, cents]) => `
        <div class="sector-row">
          <span class="sector-swatch" style="--ink:${inkFor(name)}"></span>
          <span class="sector-name">${name}</span>
          <span class="sector-amt">${usdCompact(cents)}</span>
          <span class="sector-pct">${(cents / total * 100).toFixed(0)}%</span>
        </div>
        <div class="sector-bar"><i style="--ink:${inkFor(name)};width:${
          (cents / total * 100).toFixed(1)}%"></i></div>`).join("")}
    </div>
    <p class="sheet-foot">PAC contributions only (FEC transaction types 24K and
      24Z). Independent expenditures are not contributions and are not counted
      here.</p>`
}

/** The table view. Non-negotiable: identity must never be colour-alone, and
 *  a choropleth read by a screen reader is a list of numbers or it is nothing. */
export function renderTable(el: HTMLElement, shapes: { props: DistrictProperties }[], opts: { cycle?: string } = {}) {
  const rows = [...shapes].sort((a, b) => b.props.pac_cents - a.props.pac_cents)
  const cycle = opts.cycle || "2024"
  el.innerHTML = `
    <table>
      <caption>All ${rows.length} districts, ${cycle} cycle, by PAC contributions received.</caption>
      <thead><tr>
        <th scope="col">District</th>
        <th scope="col" class="num">PAC money</th>
        <th scope="col" class="num">Committees</th>
        <th scope="col">Map vintage</th>
      </tr></thead>
      <tbody>${rows.map((s) => {
        const p = s.props
        return `<tr><th scope="row">${p.state}-${p.cd}</th>
          <td class="num">${usd(p.pac_cents)}</td>
          <td class="num">${p.donor_committees.toLocaleString()}</td>
          <td><span class="tag tag-${p.map_status}">${
            p.map_status.replace("cd119_", "")}</span></td></tr>`
      }).join("")}</tbody>
    </table>`
}

/** Legend. Always present — the rule is a legend for >=2 series, no exceptions. */
export function renderLegend(el: HTMLElement, sys: System, dark: boolean, opts: { cycle?: string; labels?: string[]; staleLabel?: string } = {}) {
  const ramp = dark ? sys.rampDark : sys.ramp
  const labels = opts.labels || ["< $295K", "$295–466K", "$466–776K",
                                 "$776K–1.28M", "$1.28–1.96M", "> $1.96M"]
  const cycle = opts.cycle || "2024"
  el.innerHTML = `
    <div class="legend-title">PAC money received, ${cycle} cycle</div>
    <div class="legend-ramp">${ramp.map((c, i) => `
      <div class="legend-step">
        <span class="legend-chip" style="--ink:${c}" data-cov="${(i + 1) / 6}"></span>
        <span class="legend-lab">${labels[i]}</span>
      </div>`).join("")}</div>
    <div class="legend-title legend-title-2">Map vintage</div>
    <div class="legend-vintage">
      <div class="lv"><span class="lv-mark lv-current"></span>
        Current — the map that governs</div>
      <div class="lv"><span class="lv-mark lv-contested"></span>
        Contested — enacted then blocked</div>
      <div class="lv"><span class="lv-mark lv-stale"></span>
        ${opts.staleLabel || "Superseded — a redraw is in effect and we cannot draw it"}</div>
    </div>`
}

export function shellHTML({ kicker, title, thesis, meta }: { kicker: string; title: string; thesis: string; meta: MetaArtifact }): string {
  return `
  <header class="masthead">
    <div class="mast-left">
      <div class="kicker">${kicker}</div>
      <h1>${title}</h1>
      <p class="thesis">${thesis}</p>
    </div>
    <div class="mast-right">
      <div class="stat">
        <div class="stat-num">${usdCompact(Math.round(meta.district_dollars * 100))}</div>
        <div class="stat-lab">of PAC money placed in a district, ${meta.cycle} cycle</div>
      </div>
      <div class="stat stat-warn">
        <div class="stat-num">${(meta.superseded_share * 100).toFixed(2)}%</div>
        <div class="stat-lab">of it sits on a map that is no longer the law</div>
      </div>
    </div>
  </header>`
}

export const debounce = <F extends (...args: never[]) => void>(fn: F, ms = 120): (...args: Parameters<F>) => void => {
  let t: ReturnType<typeof setTimeout>
  return (...a: Parameters<F>) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}
