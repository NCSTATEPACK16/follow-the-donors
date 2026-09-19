/**
 * Shared plumbing for the three riso prototypes.
 *
 * Everything that is NOT the visual thesis lives here — data loading, the
 * projection, hit-testing, the page shell, the sheet, the table view. The
 * three prototypes differ only in how they put ink on the page, which is the
 * whole point: if the chrome differed too, the comparison would not be a
 * comparison.
 *
 * Deliberately not MapLibre. These are static national views at one zoom;
 * MapLibre + PMTiles is task 5 of the v1 plan and carries its own risks
 * (CustomLayerInterface, the stencil buffer, projectTile). Resolving the
 * AESTHETIC first, cheaply, is what a prototype is for. What each renderer
 * costs to port is recorded in COMPARISON.md.
 */
import { SECTOR_ORDER, OTHER_LABEL, STATUS_LABEL, usd, usdCompact } from "./inks.js";

const DATA = "./data";

export async function loadAtlas() {
  const [districts, sectors, meta] = await Promise.all([
    fetch(`${DATA}/districts-2024.geojson`).then((r) => r.json()),
    fetch(`${DATA}/sectors-2024.json`).then((r) => r.json()),
    fetch(`${DATA}/meta-2024.json`).then((r) => r.json()),
  ]);
  districts.features.sort((a, b) =>
    a.properties.geoid < b.properties.geoid ? -1 : 1);
  districts.features.forEach((f, i) => { f.index = i; });
  return { districts, sectors, meta };
}

/** Albers USA, fitted. AK and HI are inset by d3 — without that they drag the
 *  lower 48 down to a stamp, and a map of federal money that cannot show two
 *  states is not a map of federal money. */
export function makeProjection(districts, width, height, pad = 12) {
  return d3.geoAlbersUsa().fitExtent(
    [[pad, pad], [width - pad, height - pad]], districts);
}

/**
 * Split the 441 rows into what Albers USA can draw and what it cannot.
 *
 * geoAlbersUsa covers the 50 states and DC and NOTHING else. The five
 * non-voting territory delegations — AS, GU, MP, PR, VI — fall outside every
 * sub-projection, and d3 does not quietly drop them: each one clips against
 * the composite's clip rectangle and comes back as the FULL RECTANGLE, which
 * then paints over the entire map. (That is what the first render of
 * prototype A did, and it is why this function exists.)
 *
 * They are separated, never dropped. Those six delegations received $759,490
 * of PAC money in the 2024 cycle and a map that silently loses them is the
 * same class of error as a map that renders a superseded district as current.
 * They render as chips beside the map and appear in the table.
 */
export function partitionProjectable(districts) {
  // The test uses a PLAIN, unfitted albersUsa on purpose. fitExtent over a
  // collection that still contains the territories is itself poisoned by the
  // clip-rectangle bounds described above, so fitting first and testing
  // second rejects every feature. Membership in a sub-projection does not
  // depend on scale, so an unfitted projection answers it correctly.
  const probe = d3.geoAlbersUsa();
  const mapped = { type: "FeatureCollection", features: [] };
  const offmap = [];
  for (const f of districts.features) {
    (probe(d3.geoCentroid(f)) ? mapped.features : offmap).push(f);
  }
  return { mapped, offmap };
}

/** Delegations Albers USA cannot place, rendered as labelled chips so the
 *  money is visible even though the geography is not. */
export function renderOffmap(el, offmap, sys, dark, onPick) {
  if (!offmap.length) { el.innerHTML = ""; return; }
  const ramp = dark ? sys.rampDark : sys.ramp;
  const step = (c) => {
    const B = [29468300, 46565200, 77550300, 127558000, 195965900];
    let i = 0; while (i < B.length && c > B[i]) i++;
    return ramp[Math.min(i, ramp.length - 1)];
  };
  el.innerHTML = `
    <div class="offmap-lab">Not placeable on an Albers USA projection —
      shown here so the money is not lost:</div>
    <div class="offmap-chips">${offmap.map((f) => {
      const p = f.properties;
      return `<button class="offchip" data-geoid="${p.geoid}"
        style="--ink:${step(p.pac_cents)}">
        <span class="offchip-ink"></span>
        <span class="offchip-id">${p.state}</span>
        <span class="offchip-amt">${usdCompact(p.pac_cents)}</span>
      </button>`;
    }).join("")}</div>`;
  if (onPick) el.querySelectorAll(".offchip").forEach((b) =>
    b.addEventListener("click", () => onPick(b.dataset.geoid)));
}

/**
 * Project every ring once into flat Float32 arrays.
 *
 * Done eagerly and cached because all three renderers need the same screen
 * coordinates and two of them need them every frame. d3.geoPath re-projecting
 * 441 gerrymandered polygons per frame is the difference between 60fps and a
 * slideshow on a phone.
 */
export function projectAll(districts, projection) {
  const out = [];
  for (const f of districts.features) {
    const polys = f.geometry.type === "Polygon"
      ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = [];
    for (const poly of polys) {
      for (const ring of poly) {
        const pts = [];
        for (const c of ring) {
          const p = projection(c);
          if (p) pts.push(p[0], p[1]);
        }
        // A ring that projects to fewer than 3 points is off the inset frame
        // (a Pacific territory, a clipped island) and cannot be filled.
        if (pts.length >= 6) rings.push({ xy: new Float32Array(pts), outer: ring === poly[0] });
      }
    }
    out.push({ feature: f, rings, props: f.properties });
  }
  return out;
}

/**
 * Triangulate every district into one interleaved vertex buffer.
 *
 * Done ONCE on layout, never per frame. The research paper is right that
 * earcut-ing 441 gerrymandered polygons on the main thread every frame would
 * blow the mobile budget — but that is an argument against doing it per
 * frame, not against doing it at all. At a fixed national view the mesh is
 * static, so the cost is paid once and the shader does the rest.
 *
 * Per-vertex payload is [x, y, coverage, cell] — position in CSS pixels, the
 * halftone's ink coverage from the money, and the halftone's cell size in
 * pixels from the map vintage. Cell size IS the screen frequency: a small
 * cell is a fine screen (an exact answer), a large cell is a coarse one.
 */
export function triangulate(mapped, projection, encode) {
  const verts = [];
  const tris = [];          // district index per triangle, for picking parity
  mapped.features.forEach((f, di) => {
    const { coverage, cell } = encode(f.properties);
    const polys = f.geometry.type === "Polygon"
      ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const flat = [], holes = [];
      for (let ri = 0; ri < poly.length; ri++) {
        if (ri > 0) holes.push(flat.length / 2);
        for (const c of poly[ri]) {
          const p = projection(c);
          if (p) flat.push(p[0], p[1]);
        }
      }
      if (flat.length < 6) continue;
      const idx = earcut(flat, holes.length ? holes : null, 2);
      for (const i of idx) {
        verts.push(flat[i * 2], flat[i * 2 + 1], coverage, cell);
      }
      for (let k = 0; k < idx.length; k += 3) tris.push(di);
    }
  });
  return { data: new Float32Array(verts), count: verts.length / 4, tris };
}

/** Bounding box + centroid per district, for labels and the zoom-to-fit. */
export function measure(shapes) {
  for (const s of shapes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let cx = 0, cy = 0, n = 0, bestArea = 0;
    for (const r of s.rings) {
      let a = 0, mx = 0, my = 0;
      for (let i = 0; i < r.xy.length; i += 2) {
        const x = r.xy[i], y = r.xy[i + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        const j = (i + 2) % r.xy.length;
        const cross = x * r.xy[j + 1] - r.xy[j] * y;
        a += cross; mx += (x + r.xy[j]) * cross; my += (y + r.xy[j + 1]) * cross;
      }
      a *= 0.5;
      // The visual centre of a multi-part district is the centroid of its
      // LARGEST part, not of all parts — otherwise a district with an island
      // labels itself in the sea.
      if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); cx = mx / (6 * a); cy = my / (6 * a); n = 1; }
    }
    s.bbox = [x0, y0, x1, y1];
    s.centroid = n ? [cx, cy] : [(x0 + x1) / 2, (y0 + y1) / 2];
    s.area = bestArea;
  }
  return shapes;
}

/**
 * Hit-testing by colour picking.
 *
 * Each district is filled into an offscreen canvas with its index encoded as
 * an RGB triple, so a hover is one getImageData of one pixel regardless of
 * how many polygons there are. Point-in-polygon across 441 gerrymandered
 * shapes on every mousemove is the thing that makes a map feel broken on a
 * phone; this is O(1) and shared by all three renderers.
 */
export function makePicker(shapes, width, height, dpr = 1) {
  const cv = document.createElement("canvas");
  cv.width = Math.round(width * dpr);
  cv.height = Math.round(height * dpr);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;
  shapes.forEach((s, i) => {
    // +1 so index 0 is distinguishable from the transparent background.
    const v = i + 1;
    ctx.fillStyle = `rgb(${v & 255},${(v >> 8) & 255},${(v >> 16) & 255})`;
    ctx.beginPath();
    for (const r of s.rings) {
      ctx.moveTo(r.xy[0], r.xy[1]);
      for (let k = 2; k < r.xy.length; k += 2) ctx.lineTo(r.xy[k], r.xy[k + 1]);
      ctx.closePath();
    }
    ctx.fill("evenodd");
  });
  return (x, y) => {
    const px = Math.round(x * dpr), py = Math.round(y * dpr);
    if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return -1;
    const d = ctx.getImageData(px, py, 1, 1).data;
    const v = d[0] | (d[1] << 8) | (d[2] << 16);
    return v === 0 ? -1 : v - 1;
  };
}

/* ------------------------------------------------------------------ */
/*  Page shell                                                         */
/* ------------------------------------------------------------------ */

export function topSectors(sectors, geoid, limit = 6) {
  const rows = sectors[geoid] || [];
  const named = [], rest = [];
  for (const [name, cents] of rows) {
    (SECTOR_ORDER.includes(name) ? named : rest).push([name, cents]);
  }
  const otherTotal = rest.reduce((a, [, c]) => a + c, 0);
  const out = SECTOR_ORDER
    .map((s) => [s, (named.find(([n]) => n === s) || [, 0])[1]])
    .filter(([, c]) => c > 0);
  if (otherTotal > 0) out.push([OTHER_LABEL, otherTotal]);
  return out.slice(0, limit);
}

/** The district sheet. Same content in all three; only the ink differs. */
export function renderSheet(el, shape, sectors, sys, dark) {
  if (!shape) {
    el.innerHTML = `<p class="sheet-empty">Hover or tap a district.</p>`;
    return;
  }
  const p = shape.props;
  const rows = topSectors(sectors, p.geoid);
  const total = rows.reduce((a, [, c]) => a + c, 0) || 1;
  const inkFor = (name) => {
    const i = SECTOR_ORDER.indexOf(name);
    return i === -1 ? sys.other : (dark ? sys.inksDark : sys.inks)[i];
  };
  const stale = p.map_status === "cd119_superseded";
  const contested = p.map_status === "cd119_contested";

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
          p.legal_status ? ` · legal status: ${p.legal_status}` : ""}</div>
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
      here.</p>`;
}

/** The table view. Non-negotiable: identity must never be colour-alone, and
 *  a choropleth read by a screen reader is a list of numbers or it is nothing. */
export function renderTable(el, shapes) {
  const rows = [...shapes].sort((a, b) => b.props.pac_cents - a.props.pac_cents);
  el.innerHTML = `
    <table>
      <caption>All 441 districts, 2024 cycle, by PAC contributions received.</caption>
      <thead><tr>
        <th scope="col">District</th>
        <th scope="col" class="num">PAC money</th>
        <th scope="col" class="num">Committees</th>
        <th scope="col">Map vintage</th>
      </tr></thead>
      <tbody>${rows.map((s) => {
        const p = s.props;
        return `<tr><th scope="row">${p.state}-${p.cd}</th>
          <td class="num">${usd(p.pac_cents)}</td>
          <td class="num">${p.donor_committees.toLocaleString()}</td>
          <td><span class="tag tag-${p.map_status}">${
            p.map_status.replace("cd119_", "")}</span></td></tr>`;
      }).join("")}</tbody>
    </table>`;
}

/** Legend. Always present — the rule is a legend for >=2 series, no exceptions. */
export function renderLegend(el, sys, dark, opts = {}) {
  const ramp = dark ? sys.rampDark : sys.ramp;
  const labels = ["< $295K", "$295–466K", "$466–776K", "$776K–1.28M",
                  "$1.28–1.96M", "> $1.96M"];
  el.innerHTML = `
    <div class="legend-title">PAC money received, 2024 cycle</div>
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
    </div>`;
}

export function shellHTML({ title, kicker, thesis, meta }) {
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
        <div class="stat-lab">of PAC money placed in a district, 2024 cycle</div>
      </div>
      <div class="stat stat-warn">
        <div class="stat-num">${(meta.superseded_share * 100).toFixed(2)}%</div>
        <div class="stat-lab">of it sits on a map that is no longer the law</div>
      </div>
    </div>
  </header>`;
}

export const debounce = (fn, ms = 120) => {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
