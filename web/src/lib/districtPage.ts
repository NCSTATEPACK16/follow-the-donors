/**
 * The district sheet, sourced from stage 09's per-district page rather than
 * the geometry file's embedded properties + sectors.json. The page carries
 * more than the map needs to draw: top donor committees by name (permitted —
 * CLAUDE.md quotes the FEC carve-out that committee names are not the
 * individual-contributor data the statute restricts) and the map's
 * provenance URL. This is the v1 addition the plan's Task 5 Step 5 calls
 * for; it is not in any prototype HTML.
 */
import { SECTOR_ORDER, OTHER_LABEL, STATUS_LABEL, usd, usdCompact, type System } from "./inks"
import { ASSETS, type Cycle } from "./config"
import { seatLine } from "./atlas"

export interface TopCommittee {
  cmte_id: string
  cmte_name: string
  tier: string
  sector: string
  cents: number
}

export interface DistrictPage {
  geoid: string
  cycle: string
  state: string
  cd: string
  district_name: string
  map_status: string
  map_vintage: string
  legal_status: string
  provenance_url: string
  filing_period: string
  pac_cents: number
  contributions: number
  candidates: number
  donor_committees: number
  sectors: [string, number][]
  top_committees: TopCommittee[]
}

const pageCache = new Map<string, Promise<DistrictPage>>()

export function fetchDistrictPage(geoid: string, cycle: Cycle): Promise<DistrictPage> {
  const key = `${geoid}-${cycle}`
  let p = pageCache.get(key)
  if (!p) {
    p = fetch(ASSETS.districtPage(geoid, cycle)).then((r) => r.json())
    pageCache.set(key, p)
  }
  return p
}

function inkForSector(sys: System, name: string, dark: boolean): string {
  const i = SECTOR_ORDER.indexOf(name)
  return i === -1 ? sys.other : (dark ? sys.inksDark : sys.inks)[i]
}

/** The enriched sheet — same visual shape as atlas.ts's renderSheet (same
 * class names, same rail), extended with a top-PAC list and a provenance
 * line. Rendered once the page JSON has loaded; renderSheet's lighter
 * geometry-only version covers the gap while the fetch is in flight. */
/** `incumbent` comes from the district's geometry feature: stage 09's page
 *  does not carry it, and the feature is already loaded. */
export function renderDistrictPageSheet(el: HTMLElement, page: DistrictPage, sys: System, dark: boolean, incumbent?: unknown) {
  const total = page.sectors.reduce((a, [, c]) => a + c, 0) || 1
  const stale = page.map_status === "cd119_superseded"
  const contested = page.map_status === "cd119_contested"
  const rows = page.sectors.slice(0, 6)

  // Which renderer drew the sheet. The geometry sheet now shows first and
  // this page replaces it, so anything that needs the page (the harness,
  // a test) waits on this rather than on a title both renderers draw.
  el.dataset.source = "page"
  el.innerHTML = `
    <div class="sheet-head">
      <div class="sheet-eyebrow">${page.state} · District ${page.cd}</div>
      <div class="sheet-title">${page.district_name}</div>
      <div class="sheet-amount">${usd(page.pac_cents)}</div>
      <div class="sheet-sub">from ${page.donor_committees.toLocaleString()} political
        committees · ${page.contributions.toLocaleString()} contributions ·
        ${page.candidates} candidate${page.candidates === 1 ? "" : "s"}</div>
      ${seatLine(incumbent)}
    </div>
    <div class="vintage ${stale ? "is-stale" : contested ? "is-contested" : "is-current"}">
      <span class="vintage-mark" aria-hidden="true"></span>
      <div>
        <strong>${STATUS_LABEL[page.map_status] || page.map_status}</strong>
        <div class="vintage-detail">${page.map_vintage}${
          page.legal_status && page.legal_status !== "not_applicable"
            ? ` · legal status: ${page.legal_status}` : ""}</div>
        ${stale ? `<div class="vintage-detail">Not comparable across cycles.</div>` : ""}
        ${page.provenance_url && page.provenance_url !== "not_applicable"
          ? `<div class="vintage-detail"><a href="${page.provenance_url}" target="_blank" rel="noreferrer">Source for this boundary</a></div>`
          : ""}
      </div>
    </div>
    <div class="sector-block">
      <div class="sector-label">Where it came from</div>
      ${rows.map(([name, cents]) => `
        <div class="sector-row">
          <span class="sector-swatch" style="--ink:${inkForSector(sys, name, dark)}"></span>
          <span class="sector-name">${name === OTHER_LABEL ? OTHER_LABEL : name}</span>
          <span class="sector-amt">${usdCompact(cents)}</span>
          <span class="sector-pct">${(cents / total * 100).toFixed(0)}%</span>
        </div>
        <div class="sector-bar"><i style="--ink:${inkForSector(sys, name, dark)};width:${
          Math.max(0, cents / total * 100).toFixed(1)}%"></i></div>`).join("")}
    </div>
    ${page.top_committees.length ? `
    <div class="sector-block">
      <div class="sector-label">Top PAC contributors</div>
      ${page.top_committees.slice(0, 10).map((c) => `
        <div class="sector-row">
          <span class="sector-swatch" style="--ink:${inkForSector(sys, c.sector, dark)}"></span>
          <span class="sector-name">${c.cmte_name}</span>
          <span class="sector-amt">${usdCompact(c.cents)}</span>
          <span class="sector-pct"></span>
        </div>`).join("")}
    </div>` : ""}
    <p class="sheet-foot">PAC contributions only (FEC transaction types 24K and
      24Z). Independent expenditures are not contributions and are not
      counted here. Filing period: ${page.filing_period}.</p>`
}
