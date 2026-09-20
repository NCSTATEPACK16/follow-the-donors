/**
 * Round-2 chrome: the two plates, the two layers, and the band that never
 * goes away.
 *
 * Shared for the same reason atlas.js is shared — D, E and F are a comparison
 * of three ENCODINGS, and if the view machinery differed between them the
 * comparison would be of something else. A prototype supplies its ink and its
 * coverage split; everything here is identical across all three.
 */
import { usd, usdCompact, STATUS_LABEL } from "./inks.js";

/* ------------------------------------------------------------------ */
/*  The screen scale — a blow-up is a NEW PLATE                        */
/* ------------------------------------------------------------------ */

/**
 * Cell size in CSS pixels per map vintage, at NATIONAL scale.
 *
 * Carried over from round 1's prototype B, where 4.2/7.0/11.5 was tuned down
 * to this after looking at the first render: at 11.5 the coarse screen read
 * as polka dots and pulled the eye off the money entirely. The three are
 * still far enough apart to read as three different screens, which is the
 * requirement — a difference a reader cannot see is not an encoding.
 */
export const CELL = {
  cd119_current: 3.6,
  cd119_contested: 5.6,
  cd119_superseded: 8.4,
  override_applied: 3.6,
};
export const FLAT_CELL = 3.6;

/**
 * The state plate is re-screened COARSER, and that is the whole answer to
 * "ensure we can see it better when we zoom in".
 *
 * The naive reading of that request is a finer screen with more detail. The
 * riso-true reading — and the better one — is the opposite: a blow-up is a
 * new plate, and a print shop re-screens for the new size rather than
 * enlarging the old screen's dots. At 8px the cells become visibly DOTS
 * instead of an implied texture, so the reader can see the encoding working
 * rather than inferring it.
 *
 * It is a single multiplier over CELL rather than a second table, so every
 * certainty ratio survives the change intact: a superseded district is
 * 2.33x coarser than a current one at either scale. A second table would let
 * those ratios drift apart and quietly break the encoding at one zoom.
 */
export const NATIONAL_SCALE = 1;
export const STATE_SCALE = 8 / CELL.cd119_current;   // ≈ 2.222

/* ------------------------------------------------------------------ */
/*  Projections                                                        */
/* ------------------------------------------------------------------ */

/**
 * A projection for ONE state, fitted.
 *
 * Deliberately not geoAlbersUsa. That projection is a composite of three
 * sub-projections joined by clip rectangles, and fitting it to a single
 * state either lands the state in the wrong pane or returns the clip
 * rectangle — the same failure mode that makes the territories paint over
 * the national map (see partitionProjectable in atlas.js).
 *
 * A conic equal-area rotated onto the state's own centroid and given
 * parallels from its own latitude span is correct for ANY state at this
 * scale, Alaska and Hawaii included. It also means the state view can draw
 * the five territory delegations that the national view structurally cannot,
 * which is a real gain and not a side effect: PR's money has never been on
 * the map before.
 */
export function makeStateProjection(features, width, height, pad = 18) {
  const fc = { type: "FeatureCollection", features };
  const [[w, s], [e, n]] = d3.geoBounds(fc);
  const lon = (w + e) / 2;
  // Standard parallels at 1/6 and 5/6 of the latitude span is the usual
  // minimum-distortion choice for a conic over a small area.
  const p1 = s + (n - s) / 6, p2 = n - (n - s) / 6;
  return d3.geoConicEqualArea()
    .parallels([p1, p2])
    .rotate([-lon, 0])
    .fitExtent([[pad, pad], [width - pad, height - pad]], fc);
}

/** Every district feature belonging to one state, in geoid order. */
export function districtsOf(atlas, st) {
  return atlas.districts.features.filter((f) => f.properties.state === st);
}

/** The states present in the data, with their House totals, for the picker. */
export function stateIndex(atlas) {
  const by = new Map();
  for (const f of atlas.districts.features) {
    const p = f.properties;
    const s = by.get(p.state) || {
      state: p.state, pac_cents: 0, districts: 0, superseded: 0,
    };
    s.pac_cents += p.pac_cents;
    s.districts += 1;
    if (p.map_status === "cd119_superseded") s.superseded += 1;
    by.set(p.state, s);
  }
  return [...by.values()].sort((a, b) => b.pac_cents - a.pac_cents);
}

/**
 * Quantile breaks over an arbitrary set of values.
 *
 * The Senate layer needs its own: 50 state totals running $34,000 to
 * $6.6M are a different distribution from 441 district totals, and reusing
 * the district breaks would print 48 states in the bottom step. Computed
 * from the loaded artifact rather than shipped as a constant, so it cannot
 * drift away from the data it describes.
 */
export function quantileBreaks(values, steps = 6) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return [];
  const at = (q) => {
    const i = (v.length - 1) * q;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };
  const out = [];
  for (let k = 1; k < steps; k++) out.push(at(k / steps));
  return out;
}

/* ------------------------------------------------------------------ */
/*  Tilt                                                               */
/* ------------------------------------------------------------------ */

/**
 * Party tilt in [-1, +1]: -1 all Democratic, +1 all Republican, 0 even.
 *
 * The clamp is NOT defensive dressing. FEC contribution rows can be
 * negative — a refund in a later filing period exceeds receipts in that
 * period — and a district where one party's net is below zero produces a
 * ratio outside [-1, 1]. Measured on 2026: seven districts land beyond the
 * Democratic end and Maryland's Senate row shows a net REP figure of
 * −$5,000. Unclamped, those districts index past the end of the ramp and
 * paint as whatever the last array slot happens to be.
 *
 * Returns null when there is no major-party money at all, which is a
 * different fact from "even" and must not print as the neutral midpoint.
 */
export function tiltOf(p) {
  const r = p.rep_cents || 0, d = p.dem_cents || 0;
  const denom = Math.abs(r) + Math.abs(d);
  if (denom === 0) return null;
  return Math.max(-1, Math.min(1, (r - d) / denom));
}

/* ------------------------------------------------------------------ */
/*  The band that never goes away                                      */
/* ------------------------------------------------------------------ */

/**
 * The mid-cycle caveat, rendered persistently on every view.
 *
 * CLAUDE.md is categorical: every published figure names the filing period
 * it covers. 2026 is the UNGATED cycle — partial filing periods, continuous
 * amendment, and it lands well outside the tolerance that 2024 is held to.
 * So this is a band across the page and not a tooltip, not a colophon line,
 * and not something a control can dismiss. A reader who never opens a panel
 * still has to have been told.
 */
export function renderCycleBand(el, meta) {
  if (!meta.mid_cycle) { el.innerHTML = ""; el.hidden = true; return; }
  el.hidden = false;
  const rel = meta.reconciliation.relative;
  el.innerHTML = `
    <div class="band-mark" aria-hidden="true"></div>
    <div class="band-body">
      <strong>${meta.cycle} is still being filed.</strong>
      These are contributions <em>as filed</em>, not final. Filing periods are
      partial and amendments are continuous; the totals here run
      <span class="band-num">${(rel * 100).toFixed(2)}%</span> against the FEC's
      own published candidate summaries, where the closed ${
        meta.cycle === "2026" ? "2024" : "2024"} cycle reconciles to −0.72%.
      <span class="band-period">${meta.filing_period}</span>
    </div>`;
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
 * Those are different facts but they are the same WARNING, and one grammar
 * to learn beats two. Each layer states its own case in plain words rather
 * than relying on the reader to transfer it.
 */
export function renderSenateLegend(el, senate, opts = {}) {
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
        <b>${c.to}</b> (${usd(c.cents)}). ${c.why}`).join("")}</p>` : ""}`;
}

/** The Senate sheet — the same shape as a district sheet so the reader is
 *  not learning a second panel. */
export function renderSenateSheet(el, props, senate) {
  if (!props) {
    el.innerHTML = `<p class="sheet-empty">Hover or tap a state.</p>`;
    return;
  }
  if (!props.has_senate) {
    el.innerHTML = `
      <div class="sheet-head">
        <div class="sheet-eyebrow">${props.state}</div>
        <div class="sheet-title">No Senate representation</div>
      </div>
      <p class="sheet-foot">The District of Columbia and the five territory
        delegations elect no senators. This is not a zero — it is a different
        fact, and it prints as blank paper rather than as an empty plate.</p>`;
    return;
  }
  const t = tiltOf(props);
  const banked = !props.seat_up;
  el.innerHTML = `
    <div class="sheet-head">
      <div class="sheet-eyebrow">${props.state} · Senate</div>
      <div class="sheet-title">${banked
        ? `No seat up in ${senate.cycle}` : `Seat up in ${senate.cycle}`}</div>
      <div class="sheet-amount">${usd(props.total_cents)}</div>
      <div class="sheet-sub">from ${props.donor_committees.toLocaleString()}
        political committees · ${props.contributions.toLocaleString()}
        contributions</div>
    </div>
    <div class="vintage ${banked ? "is-stale" : "is-current"}">
      <span class="vintage-mark" aria-hidden="true"></span>
      <div>
        <strong>${banked
          ? "Banked — printed coarse"
          : `On the ${senate.cycle} ballot`}</strong>
        <div class="vintage-detail">${banked
          ? `Every dollar here is for an election after ${senate.cycle}.`
          : `${usd(props.up_cents)} is for ${senate.cycle}` +
            (props.banked_cents
              ? `; ${usd(props.banked_cents)} is banked for a later cycle.`
              : ".")}</div>
      </div>
    </div>
    <div class="sector-block">
      <div class="sector-label">Party of the recipient</div>
      ${[["Republican", props.rep_cents], ["Democratic", props.dem_cents],
         ["Other / none", props.oth_cents]]
        .filter(([, c]) => c !== 0)
        .map(([name, c]) => `
          <div class="sector-row">
            <span class="sector-name">${name}</span>
            <span class="sector-amt">${usdCompact(c)}</span>
          </div>`).join("")}
      ${t === null ? "" : `<div class="sector-label" style="margin-top:10px">
        Tilt ${t > 0 ? "R" : t < 0 ? "D" : "even"}
        ${(Math.abs(t) * 100).toFixed(0)}%</div>`}
    </div>
    <p class="sheet-foot">PAC contributions only (FEC transaction types 24K and
      24Z). State borders are not redistricted, so no Senate figure sits on a
      superseded map.</p>`;
}

/** Senate table view — colour is never the only channel. */
export function renderSenateTable(el, states, senate) {
  const rows = [...states]
    .filter((f) => f.properties.has_senate)
    .sort((a, b) => b.properties.total_cents - a.properties.total_cents);
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
        const p = f.properties;
        return `<tr><th scope="row">${p.state}</th>
          <td class="num">${usd(p.total_cents)}</td>
          <td class="num">${usd(p.up_cents)}</td>
          <td class="num">${usd(p.banked_cents)}</td>
          <td><span class="tag ${p.seat_up
            ? "tag-cd119_current" : "tag-cd119_superseded"}">${
            p.seat_up ? senate.cycle : "banked"}</span></td></tr>`;
      }).join("")}</tbody>
    </table>`;
}

/* ------------------------------------------------------------------ */
/*  The state bar                                                      */
/* ------------------------------------------------------------------ */

/** The "you are looking at Texas" strip, with the way back. */
export function renderStateBar(el, { state, districts, senate, cycle }) {
  if (!state) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  const tot = districts.reduce((a, f) => a + f.properties.pac_cents, 0);
  const stale = districts.filter(
    (f) => f.properties.map_status === "cd119_superseded").length;
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
      (CELL.cd119_current * STATE_SCALE).toFixed(0)}px —
      a blow-up is a new plate</div>`;
}

/** The state picker. A map you can only enter by clicking a 2px polygon is
 *  not reachable by keyboard, so the list is the primary control and the
 *  map click is the shortcut. */
export function renderStatePicker(el, index, onPick) {
  el.innerHTML = `
    <label class="picker-lab" for="statepick">Blow up one state</label>
    <select class="ctl" id="statepick">
      <option value="">— choose a state —</option>
      ${index.map((s) => `<option value="${s.state}">${s.state} · ${
        usdCompact(s.pac_cents)} · ${s.districts} district${
        s.districts === 1 ? "" : "s"}${
        s.superseded ? ` · ${s.superseded} superseded` : ""}</option>`).join("")}
    </select>`;
  el.querySelector("#statepick").addEventListener("change", (e) => {
    if (e.target.value) onPick(e.target.value);
  });
}
