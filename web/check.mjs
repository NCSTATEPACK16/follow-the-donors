/**
 * The verification harness for the v1 app.
 *
 * Moved here from web/prototypes/check.mjs (plan Task 5 Step 6) and re-pointed
 * at the BUILT bundle in web/dist — not the dev server and not the prototype
 * HTML. What ships is what is checked; a harness aimed at `vite dev` would
 * pass over a production build that never loaded.
 *
 * EVERY CHECK FROM THE PROTOTYPE HARNESS IS KEPT. Each one earned its place
 * by catching something, and the reasons have not expired:
 *
 *   1. JS errors and failed requests — both themes, two widths.
 *   2. Horizontal overflow at 390px. A choropleth that side-scrolls on a
 *      phone is broken, and it is the single easiest thing to regress.
 *   3. WebGL2 actually initialised. The app has a silent non-WebGL fallback
 *      path, so without forcing a software GL stack a headless run would
 *      PASS while testing nothing. Hence --use-gl=angle
 *      --use-angle=swiftshader --enable-unsafe-swiftshader below; drop them
 *      and the harness quietly stops checking the shader.
 *   4. Every control is exercised and the page still has no errors after.
 *   5. THE NUMBERS AGREE WITH THE ARTIFACT, through the app's own module
 *      graph. A page that looks right and prints the wrong number is worse
 *      than one that fails to load.
 *   6. Reduced motion means NOTHING MOVES — asserted on the GL calls, not on
 *      pixels. See checkMotion for the two ways of measuring this that look
 *      like passes and are not.
 *   7. The state blow-up is actually entered. The picker is a <select>, and
 *      clicking one fires no `change` — so it counted as an exercised
 *      control while the round-2 feature went untested. `selectOption` fires
 *      the event; `click` does not.
 *
 * Three things changed in the port, all forced by the move to a bundle:
 *
 *   - The prototypes were seven pages; v1 is one. PAGES collapses to the
 *     single app, and the per-page skip logic goes with it.
 *   - The prototype harness reached into the page with
 *     `import("./shared/view.js")` to read STATE_SCALE and usdCompact. A
 *     built bundle has no such URL, so App.tsx publishes `window.__riso`
 *     with exactly what this file asserts against. The point is unchanged:
 *     the re-screen is checked against the GPU uniform and the money against
 *     the page's OWN formatter, because comparing two spellings of a number
 *     proves nothing.
 *   - Section 8 is new — the four v1 features no prototype had: picking by
 *     real pointer input, search, ZIP resolution, and the deep link.
 *
 * Run:  node web/check.mjs          (builds nothing; run `npm run build` first)
 *       node web/check.mjs --keep   (leave the browser open)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "dist");
const DATA = join(ROOT, "data");
const CYCLE = "2026";
const V = "v1";

// Port 0 = let the OS pick a free one. Fixed ports collide when two agents
// (or two terminals) verify at the same time, and the failure looks like a
// broken page rather than a busy socket.
let PORT = 0;

// The exact flags round 1 used. Without them WebGL2 is unavailable in
// headless Chromium and the app silently takes its "No WebGL2" path — the
// harness would pass while testing nothing.
const GL_FLAGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];

const EXE = process.env.CHROME_FOR_TESTING ||
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/` +
  `chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/` +
  `Google Chrome for Testing`;

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json",
  ".geojson": "application/json", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
};

function serve() {
  const s = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      let p = normalize(decodeURIComponent(url.pathname));
      if (p.endsWith("/")) p += "index.html";
      const file = join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      await stat(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file)] || "application/octet-stream",
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => s.listen(PORT, "127.0.0.1", () => {
    PORT = s.address().port;
    ok(s);
  }));
}

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

let failures = 0;
const log = (ok, msg) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${msg}`);
};

const url = (hash = "") => `http://127.0.0.1:${PORT}/${hash}`;

/** A page that has finished booting: the atlas is loaded and the press exists. */
async function boot(ctx, hash = "") {
  const pg = await ctx.newPage();
  const errs = [];
  // The browser asks for /favicon.ico on its own. That 404 is the browser's,
  // not the page's — filtered by exact path so a real missing artifact still
  // fails the run. Blanket-ignoring 404s here would hide a missing data file,
  // which is the main thing this catches.
  const isFavicon = (s) => /\/favicon\.ico\b/.test(s);
  pg.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  pg.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    const u = m.location?.().url || "";
    if (isFavicon(t) || isFavicon(u)) return;
    errs.push(`console: ${t}`);
  });
  pg.on("requestfailed", (r) => {
    if (isFavicon(r.url())) return;
    errs.push(`request failed: ${r.url()} ${r.failure()?.errorText}`);
  });
  pg.on("response", (r) => {
    if (r.status() >= 400 && !isFavicon(r.url())) {
      errs.push(`http ${r.status()}: ${r.url()}`);
    }
  });
  await pg.goto(url(hash), { waitUntil: "networkidle", timeout: 30000 });
  await pg.waitForFunction(() => window.__atlas && window.__riso, null,
    { timeout: 30000 });
  await pg.waitForTimeout(350);
  return { pg, errs };
}

/* ------------------------------------------------------------------ */
/*  1-4. The page itself, both themes, two widths                      */
/* ------------------------------------------------------------------ */

async function checkPage(browser, vp, dark) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const { pg, errs } = await boot(ctx);
  const label = `app · ${vp.name}px · ${dark ? "dark" : "light"}`;

  if (dark) {
    await pg.click('button:has-text("Dark stock")');
    await pg.waitForTimeout(400);
    const attr = await pg.evaluate(() => document.documentElement.dataset.theme);
    log(attr === "dark", `${label} — dark stock is on (data-theme=${attr})`);
  }

  // 3. WebGL2 really initialised — not the silent fallback.
  const live = await pg.evaluate(() => {
    const c = document.querySelector("canvas#gl");
    return !!(c && c.getContext("webgl2"));
  });
  log(live, `${label} — WebGL2 live`);

  // 2. No horizontal overflow.
  const over = await pg.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  log(over <= 1, `${label} — no h-overflow (${over}px)`);

  // 4. Exercise every control. The <select> is included for parity with the
  // prototype harness — and is exactly why checkStateView exists separately.
  const ctls = await pg.$$(".controls .ctl");
  for (const c of ctls) {
    if (await c.isDisabled()) continue;
    await c.click();
    await pg.waitForTimeout(200);
  }
  log(ctls.length >= 4, `${label} — ${ctls.length} control(s) exercised`);

  // 1. Errors.
  log(errs.length === 0, `${label} — clean console${
    errs.length ? `\n        ${errs.slice(0, 4).join("\n        ")}` : ""}`);

  await ctx.close();
}

/* ------------------------------------------------------------------ */
/*  5. The numbers agree with the artifact                             */
/* ------------------------------------------------------------------ */

async function checkNumbers(browser, truth, senate) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { pg } = await boot(ctx);

  const want = new Map(truth.features.map((f) =>
    [f.properties.geoid, f.properties.pac_cents]));
  const got = await pg.evaluate(() => Object.fromEntries(
    window.__atlas.districts.features.map(
      (f) => [f.properties.geoid, f.properties.pac_cents])));

  let bad = 0, n = 0;
  for (const [geoid, cents] of want) {
    n++;
    if (got[geoid] !== cents) bad++;
  }
  log(bad === 0, `app — ${n} districts agree to the cent (${bad} off)`);

  const senGot = await pg.evaluate(() => window.__atlas?.senate?.total_cents ?? null);
  log(senGot === senate.total_cents,
    `app — Senate total agrees (${senGot} vs ${senate.total_cents})`);

  // The plan's measured facts, asserted on the page's own loaded artifact.
  const facts = await pg.evaluate(() => {
    const a = window.__atlas;
    const d = a.districts.features.map((f) => f.properties);
    return {
      house: d.reduce((s, p) => s + p.pac_cents, 0),
      superseded: d.filter((p) => p.map_status === "cd119_superseded").length,
      supersededCents: d.filter((p) => p.map_status === "cd119_superseded")
        .reduce((s, p) => s + p.pac_cents, 0),
      seatsUp: a.senate.seats_up,
      banked: a.senate.banked_states,
      bankedCents: a.senate.banked_state_cents,
      upCents: a.senate.up_state_cents,
      corrections: a.senate.corrections.length,
    };
  });
  const expect = {
    house: 32878843600, superseded: 173, supersededCents: 12273824000,
    seatsUp: 35, banked: 15, bankedCents: 658520900,
    upCents: 7428590900, corrections: 1,
  };
  for (const [k, v] of Object.entries(expect)) {
    log(facts[k] === v, `app — ${k} = ${v}${facts[k] === v ? "" : ` (got ${facts[k]})`}`);
  }

  await ctx.close();
}

/* ------------------------------------------------------------------ */
/*  6. Reduced motion means NOTHING MOVES                              */
/* ------------------------------------------------------------------ */

/**
 * Checked by instrumenting the GL calls rather than by sampling pixels. Two
 * earlier attempts to measure this by reading the canvas back were both
 * wrong and both looked like passes:
 *
 *   - readPixels on a context without `preserveDrawingBuffer` reads an
 *     already-cleared back buffer and returns all zeros, so every frame
 *     compares equal and a moving page reads as still.
 *   - headless Chromium throttles requestAnimationFrame to about 4 fps, so
 *     a "did it change in 1.4s" test is sampling almost nothing.
 *
 * Counting draws and collecting the distinct `uDrift` vectors actually sent
 * to the GPU avoids both. Under prefers-reduced-motion the page must settle
 * to zero further draws and must have sent exactly ONE drift value — the
 * zero vector. Anything else means a plate is moving under a reader who
 * asked for no movement.
 */
const INSTRUMENT = () => {
  window.__draws = 0;
  window.__drifts = new Set();
  window.__phaseAmps = new Set();
  const P = WebGL2RenderingContext.prototype;
  // Tag each uniform location with its name, so a uniform1f call can be
  // attributed to uPhaseAmp specifically: uniform1f also sets uDpr, uDark,
  // uGain and the rest, and a set of all of them would prove nothing.
  const ol = P.getUniformLocation;
  P.getUniformLocation = function (prog, name) {
    const loc = ol.apply(this, arguments);
    if (loc) { try { loc.__name = name; } catch {} }
    return loc;
  };
  const o1 = P.uniform1f;
  P.uniform1f = function (loc, v) {
    if (loc && loc.__name === "uPhaseAmp") window.__phaseAmps.add(Number(v).toFixed(4));
    return o1.apply(this, arguments);
  };
  const od = P.drawArrays;
  P.drawArrays = function (...a) { window.__draws++; return od.apply(this, a); };
  const ou = P.uniform2fv;
  P.uniform2fv = function (loc, v) {
    try { window.__drifts.add(Array.from(v).map((x) => x.toFixed(4)).join(",")); } catch {}
    return ou.apply(this, arguments);
  };
};

async function checkMotion(browser) {
  for (const rm of ["no-preference", "reduce"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: 800 }, reducedMotion: rm,
    });
    const pg = await ctx.newPage();
    await pg.addInitScript(INSTRUMENT);
    await pg.goto(url(), { waitUntil: "networkidle", timeout: 30000 });
    await pg.waitForTimeout(2600);
    const a = await pg.evaluate(() => window.__draws);
    await pg.waitForTimeout(2200);
    const r = await pg.evaluate(() =>
      ({ draws: window.__draws, drifts: window.__drifts.size,
         amps: [...window.__phaseAmps] }));
    // Per-district phases: a stable value per district in the mesh. The
    // phase is the last float of each 8-float vertex.
    const phases = await pg.evaluate(() => {
      const d = window.__mesh, seen = new Set();
      if (!d) return -1;
      for (let i = 7; i < d.length; i += 8) seen.add(d[i].toFixed(4));
      return seen.size;
    });

    if (rm === "reduce") {
      log(r.draws === a,
        `app — reduced motion: loop settles (${r.draws - a} draws after settling)`);
      log(r.drifts === 1,
        `app — reduced motion: ${r.drifts} distinct drift value(s), want exactly 1 (zero)`);
      // An ADDITION to the drift check, not a replacement: a zero global
      // drift with every district still wandering is still a moving map.
      log(r.amps.length === 1 && r.amps[0] === "0.0000",
        `app — reduced motion: per-district wander uniform only ever ${JSON.stringify(r.amps)}, want ["0.0000"]`);
    } else {
      log(r.draws > a,
        `app — breathing: still drawing (${r.draws - a} draws in 2.2s)`);
      log(r.drifts > 3,
        `app — breathing: ${r.drifts} distinct drift values (plates move)`);
      log(r.amps.some((a) => Number(a) > 0),
        `app — breathing: per-district wander reaches the GPU (uPhaseAmp ${JSON.stringify(r.amps)})`);
      log(phases > 100,
        `app — breathing: ${phases} distinct district phases in the mesh (want one per district)`);
    }
    await ctx.close();
  }
}

/**
 * State borders exist at national view and are heavier than the district
 * hairline. Asserted on the 2D context's lineWidth writes, because the point
 * is a weight difference a screenshot diff would not reliably catch. And the
 * keylines are NOT redrawn per animation frame: they never move, and
 * re-stroking 436 rings at 60fps was pure cost.
 */
async function checkKeylines(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { pg } = await boot(ctx);
  const widths = await pg.evaluate(() => {
    const c = document.querySelector("#lines");
    const seen = [];
    const g = c.getContext("2d");
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(g), "lineWidth");
    Object.defineProperty(g, "lineWidth", {
      configurable: true,
      set(v) { seen.push(v); d.set.call(this, v); },
      get() { return d.get.call(this); },
    });
    window.__redraw();
    return seen;
  });
  log(widths.length > 1 && Math.max(...widths) >= Math.min(...widths) * 1.8,
    `app — state borders drawn heavier than district lines (widths ${widths.join(", ")})`);

  const strokes = await pg.evaluate(async () => {
    const g = document.querySelector("#lines").getContext("2d");
    let n = 0;
    const o = g.stroke;
    g.stroke = function () { n++; return o.apply(this, arguments); };
    await new Promise((r) => setTimeout(r, 1500));
    g.stroke = o;
    return n;
  });
  log(strokes === 0,
    `app — keylines are not re-stroked while the press breathes (${strokes} strokes in 1.5s idle)`);
  await ctx.close();
}

/**
 * Three zoom tiers, entered by double-click. Driven by REAL pointer input
 * (a hover scan to find a district, then page.mouse.dblclick), because the
 * point is that a reader's double-click on the plate descends — calling
 * goTo from the harness would test nothing a reader does.
 */
async function findDistrictUnderPointer(pg) {
  const box = await pg.locator("#lines").boundingBox();
  for (let gy = 0.3; gy <= 0.75; gy += 0.05) {
    for (let gx = 0.25; gx <= 0.8; gx += 0.05) {
      const x = box.x + box.width * gx, y = box.y + box.height * gy;
      await pg.mouse.move(x, y); await pg.waitForTimeout(30);
      const t = await pg.evaluate(() => {
        const e = document.querySelector(".tip");
        return e && !e.hidden ? e.textContent.trim() : null;
      });
      if (t) return { x, y, t };
    }
  }
  return null;
}

async function checkZoomTiers(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { pg, errs } = await boot(ctx);
  const hit = await findDistrictUnderPointer(pg);
  log(!!hit, `app — found a district to double-click${hit ? ` (${hit.t.split(" ")[0]})` : ""}`);
  if (!hit) { await ctx.close(); return; }

  await pg.mouse.dblclick(hit.x, hit.y);
  await pg.waitForFunction(() => window.__view?.mode === "state", null, { timeout: 15000 }).catch(() => {});
  const atState = await pg.evaluate(() => ({ ...(window.__view ?? { mode: "no __view" }), scale: window.__press.cellScale }));
  log(atState.mode === "state", `app — double-click enters the state (mode ${atState.mode}, ${atState.st})`);

  const hit2 = await findDistrictUnderPointer(pg);
  if (hit2) {
    await pg.mouse.dblclick(hit2.x, hit2.y);
    await pg.waitForFunction(() => window.__view?.mode === "district", null, { timeout: 15000 }).catch(() => {});
  }
  const atDistrict = await pg.evaluate(() => ({
    ...(window.__view ?? { mode: "no __view" }), scale: window.__press.cellScale, want: window.__riso.DISTRICT_SCALE ?? NaN,
    drawn: Number((document.getElementById("countline").textContent.match(/(\d+) district/) ?? [])[1] ?? -1),
    label: document.querySelector(".statebar-screen")?.textContent.replace(/\s+/g, " ") ?? "",
    cellPx: window.__riso.CELL.cd119_current * window.__press.cellScale,
    hash: location.hash,
  }));
  log(atDistrict.mode === "district",
    `app — double-click again enters the district (mode ${atDistrict.mode}, ${atDistrict.geoid})`);
  log(atDistrict.scale > atState.scale && Math.abs(atDistrict.scale - atDistrict.want) < 1e-9,
    `app — the district plate is re-screened coarser again (${atState.scale.toFixed(2)} -> ${atDistrict.scale.toFixed(2)})`);
  log(atDistrict.drawn === 1, `app — the district tier draws one district (${atDistrict.drawn})`);
  const claimed = Number((atDistrict.label.match(/at ([\d.]+)px/) ?? [])[1] ?? -1);
  log(claimed.toFixed(1) === atDistrict.cellPx.toFixed(1),
    `app — district label says ${claimed}px, plate is at ${atDistrict.cellPx.toFixed(1)}px`);
  log(atDistrict.hash === `#${atDistrict.geoid}`,
    `app — the URL names the district entered (${atDistrict.hash})`);

  if (atDistrict.mode !== "district") { await ctx.close(); return; }
  // Back steps ONE tier, and keeps the district selected on the state plate.
  await pg.click("#backtonational");
  await pg.waitForFunction(() => window.__view?.mode === "state", null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(300);
  const back = await pg.evaluate(() => ({
    mode: window.__view.mode,
    eyebrow: document.querySelector(".sheet-eyebrow")?.textContent.replace(/\s+/g, " ").trim() ?? "",
  }));
  log(back.mode === "state", `app — back goes district -> state, not straight to national (${back.mode})`);
  log(back.eyebrow.includes(atDistrict.st),
    `app — ...with the district still selected (${back.eyebrow || "empty sheet"})`);
  await pg.click("#backtonational");
  await pg.waitForFunction(() => window.__view?.mode === "national", null, { timeout: 15000 }).catch(() => {});
  log(await pg.evaluate(() => window.__view.mode === "national"), "app — and back again reaches national");
  log(errs.length === 0, `app — zoom tiers: clean console${errs.length ? `\n        ${errs.slice(0, 3).join("\n        ")}` : ""}`);
  await ctx.close();
}

/**
 * The party layer. Money is the map; party is a LAYER. What must hold:
 * the legend changes with it, both parties get four steps, and no district
 * without a single party incumbent is painted as a party — counted against
 * the artifact, and asserted on the mesh the GPU actually draws: such a
 * district's coverage must sit in the neutral slot and nowhere else.
 */
async function checkPartyLayer(browser, truth) {
  const hasField = truth.features.some((f) => "incumbent_party" in f.properties);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { pg, errs } = await boot(ctx);
  const hasButton = await pg.locator('button:has-text("Party layer")').count();
  log(hasButton === 1, `app — there is a Party layer control (${hasButton})`);
  if (!hasButton) { await ctx.close(); return; }
  await pg.click('button:has-text("Party layer")');
  await pg.waitForFunction(() => window.__view?.layer === "party", null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(400);

  const legend = await pg.evaluate(() => document.querySelector(".legend-title")?.textContent.trim());
  log(/seat|party/i.test(legend || ""), `app — the legend changes with the layer (${legend})`);
  if (!hasField) {
    log(true, "app — artifact predates incumbent_party: layer says so instead of drawing (skip the rest)");
    await ctx.close();
    return;
  }
  const chips = await pg.evaluate(() => ({
    rep: document.querySelectorAll('.legend-chip[data-party="REP"]').length,
    dem: document.querySelectorAll('.legend-chip[data-party="DEM"]').length,
  }));
  log(chips.rep === 4 && chips.dem === 4,
    `app — four money steps per party, both parties shown (REP ${chips.rep}, DEM ${chips.dem})`);

  const amb = truth.features.filter(
    (f) => !["REP", "DEM"].includes(f.properties.incumbent_party)).length;
  const shown = await pg.evaluate(() => window.__ambiguous ?? -1);
  log(shown === amb, `app — ${amb} districts with no single party incumbent, app counts ${shown}`);

  // On the GPU: per vertex [x, y, c0, c1, c2, c3, cell, phase]. A neutral
  // district inks slot 2 only; a party district never inks slot 2.
  const slots = await pg.evaluate(() => {
    const d = window.__mesh; let neutralOnly = 0, partyInSlot2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 8) {
      n++;
      const [c0, c1, c2] = [d[i + 2], d[i + 3], d[i + 4]];
      if (c2 > 0 && c0 === 0 && c1 === 0) neutralOnly++;
      if (c2 > 0 && (c0 > 0 || c1 > 0)) partyInSlot2++;
    }
    return { neutralOnly, partyInSlot2, n };
  });
  log(slots.partyInSlot2 === 0 && slots.neutralOnly > 0,
    `app — no vertex mixes a party ink with the neutral (${slots.partyInSlot2} mixed, ${slots.neutralOnly} neutral-only of ${slots.n})`);

  const hit = await findDistrictUnderPointer(pg);
  if (hit) {
    await pg.mouse.click(hit.x, hit.y);
    await pg.waitForSelector(".sheet-seat", { timeout: 8000 }).catch(() => {});
    const seat = await pg.evaluate(() => document.querySelector(".sheet-seat")?.textContent.trim() ?? "");
    log(seat.length > 0, `app — the district sheet says who holds the seat (${seat})`);
  }

  await pg.click('button:has-text("Party layer")');
  await pg.waitForFunction(() => window.__view?.layer === "house", null, { timeout: 15000 }).catch(() => {});
  log(await pg.evaluate(() => window.__view.layer === "house"), "app — the party layer toggles back off to the money map");
  log(errs.length === 0, `app — party layer: clean console${errs.length ? `\n        ${errs.slice(0, 3).join("\n        ")}` : ""}`);
  await ctx.close();
}

/** The layout: the map takes the first screen, the prose folds away, and
 *  on a phone the district sheet is a bottom sheet over the map. */
async function checkLayout(browser) {
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const { pg } = await boot(ctx);
    const fill = await pg.evaluate(() => {
      const r = document.querySelector("#stage canvas#gl").getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: r.height, vh: window.innerHeight };
    });
    log(fill.top < fill.vh * 0.45 && fill.h > fill.vh * 0.5 && fill.bottom <= fill.vh + 1,
      `app · ${vp.width}x${vp.height} — the map is in the first screen (top ${Math.round(fill.top)}, ` +
      `height ${Math.round(fill.h)} of ${fill.vh}, bottom ${Math.round(fill.bottom)})`);
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { pg } = await boot(ctx);
  const col = await pg.evaluate(() => {
    const d = document.querySelector(".colophon");
    return { tag: d?.tagName, open: d?.hasAttribute("open"), words: d?.textContent.length ?? 0 };
  });
  log(col.tag === "DETAILS" && !col.open && col.words > 800,
    `app — the colophon is a closed disclosure with its text intact (${col.tag}, open=${col.open}, ${col.words} chars)`);
  await ctx.close();

  const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = (await boot(m)).pg;
  // Every lookup tolerates the element being absent, so a regression reads
  // as a FAIL line here rather than a crash that hides every later check.
  const before = await mp.evaluate(() => {
    const w = document.querySelector(".sheetwrap");
    return w ? getComputedStyle(w).display : "absent";
  });
  const hit = await findDistrictUnderPointer(mp);
  if (hit) await mp.mouse.click(hit.x, hit.y);
  await mp.waitForTimeout(500);
  const open = await mp.evaluate(() => {
    const w = document.querySelector(".sheetwrap");
    if (!w) return { pos: "absent", state: "absent", bottom: -1, vh: window.innerHeight, h: -1 };
    const r = w.getBoundingClientRect();
    return { pos: getComputedStyle(w).position, state: w.dataset.state,
             bottom: Math.round(r.bottom), vh: window.innerHeight, h: Math.round(r.height) };
  });
  log(before === "none" && open.pos === "fixed" && open.state === "open" &&
      Math.abs(open.bottom - open.vh) <= 1 && open.h < open.vh * 0.6,
    `app · 390px — the sheet is a bottom sheet: hidden until a pick (${before}), then ` +
    `${open.pos} at the bottom, ${open.h}px of ${open.vh}`);
  await mp.click(".sheet-handle", { timeout: 3000 }).catch(() => {});
  const folded = await mp.evaluate(() => document.querySelector(".sheetwrap")?.dataset.state ?? "absent");
  log(folded === "collapsed", `app · 390px — a tap on the handle folds it (${folded})`);
  await m.close();
}

/* ------------------------------------------------------------------ */
/*  7. The state blow-up                                               */
/* ------------------------------------------------------------------ */

/**
 * `checkPage` reports "5 control(s) exercised" and the state picker is one
 * of them. But the picker is a `<select>`, and clicking a `<select>` in
 * headless Chromium opens no menu and fires no `change` — so the control
 * counts as exercised while the blow-up is never once entered. That is a
 * pass that tests nothing, the same shape of failure as running the shader
 * without the GL flags at the top of this file.
 *
 * Each assertion below catches something a screenshot or the national-view
 * checks cannot:
 *
 *   - The plate is really RE-SCREENED. The statebar tells the reader
 *     "Re-screened at 8px — a blow-up is a new plate". That is a claim about
 *     a uniform on the GPU, so it is checked against `press.cellScale`, not
 *     against its own label. A bar reading 8px over a plate still screened
 *     at 3.6px looks entirely plausible.
 *   - Only that state's districts are drawn, counted against the artifact.
 *   - The money in the bar is THAT STATE'S money.
 *   - The territory delegations draw. AS/GU/MP/PR/VI cannot be projected on
 *     Albers USA and are chips nationally; a state view is the only place
 *     they exist as a map, so it is the only place that can be proven.
 *   - The press one-shot runs on entry and then settles — and under reduced
 *     motion moves NOTHING.
 *   - Going back restores the national screen, count and chrome.
 */
const STATE_CASES = [
  { st: "TX", why: "largest delegation, every district superseded" },
  { st: "MD", why: "carries the DC→MD Senate correction; money banked" },
  { st: "PR", why: "territory — cannot be drawn on Albers USA at all" },
];

async function enterState(pg, st) {
  await pg.selectOption("#statepick", st);
  // goTo() defers layout by 180ms for the plate swap, then presses — and how
  // long the press itself takes depends on the delegation. A fixed timeout
  // passed for MD (8 districts) and failed for TX (38) on the same run, which
  // is a flaky harness reporting an app bug that is not there. Wait for the
  // bar to say the state is entered instead.
  await pg.waitForFunction((want) => {
    const bar = document.querySelector(".statebar");
    return bar && !bar.hidden &&
      bar.querySelector(".statebar-id")?.textContent.trim() === want;
  }, st, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(250);
}

async function checkStateView(browser, truth, senate) {
  const per = new Map();
  for (const f of truth.features) {
    const p = f.properties;
    const s = per.get(p.state) ?? { n: 0, cents: 0, stale: 0 };
    s.n++; s.cents += p.pac_cents;
    if (p.map_status === "cd119_superseded") s.stale++;
    per.set(p.state, s);
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { pg, errs } = await boot(ctx);

  const national = await pg.evaluate(() => window.__press?.cellScale ?? null);
  log(national === 1, `app — national plate at screen scale 1 (got ${national})`);

  // The certainty RATIO is the encoding, not the cell size. A finer grain is
  // a scale on the whole table (view.ts GRAIN); if a future change edits one
  // entry instead, the map starts claiming something else, and this fails.
  const ratio = await pg.evaluate(() => {
    const C = window.__riso.CELL;
    return { coarse: C.cd119_superseded / C.cd119_current,
             mid: C.cd119_contested / C.cd119_current };
  });
  log(Math.abs(ratio.coarse - 7 / 3) < 0.02 && Math.abs(ratio.mid - 14 / 9) < 0.02,
    `app — certainty ratio preserved (superseded ${ratio.coarse.toFixed(3)}x current, want 2.333)`);

  for (const { st, why } of STATE_CASES) {
    const want = per.get(st);
    await enterState(pg, st);

    const got = await pg.evaluate(() => {
      const bar = document.querySelector(".statebar");
      const count = document.getElementById("countline").textContent;
      return {
        hidden: bar.hidden,
        id: bar.querySelector(".statebar-id")?.textContent.trim() ?? null,
        facts: bar.querySelector(".statebar-facts")?.textContent
          .replace(/\s+/g, " ").trim() ?? "",
        screenLine: bar.querySelector(".statebar-screen")?.textContent
          .replace(/\s+/g, " ").trim() ?? "",
        drawn: Number((count.match(/(\d+) districts/) ?? [])[1] ?? -1),
        scale: window.__press.cellScale,
        wantScale: window.__riso.STATE_SCALE,
        cellPx: window.__riso.CELL.cd119_current * window.__press.cellScale,
      };
    });

    const lab = `app · ${st}`;
    log(!got.hidden && got.id === st, `${lab} — entered (${why})`);
    log(got.drawn === want.n,
      `${lab} — ${got.drawn} district(s) drawn, artifact says ${want.n}`);

    // The re-screen, asserted on the uniform and then against its own label.
    log(Math.abs(got.scale - got.wantScale) < 1e-9,
      `${lab} — re-screened on the GPU (cellScale ${got.scale.toFixed(3)})`);
    // One decimal, because GRAIN puts the state cell at 5.6px: rounding both
    // sides to an integer would let a 5.6px label pass over a 6.4px plate.
    const claimed = Number((got.screenLine.match(/at ([\d.]+)px/) ?? [])[1] ?? -1);
    log(claimed.toFixed(1) === got.cellPx.toFixed(1),
      `${lab} — label says ${claimed}px, plate is at ${got.cellPx.toFixed(1)}px`);

    // The money, through the page's own formatter so the comparison is of
    // the NUMBER, not of two spellings of it.
    const money = await pg.evaluate((cents) => window.__riso.usdCompact(cents), want.cents);
    log(got.facts.includes(money),
      `${lab} — bar shows ${money} to ${want.n} districts${
        got.facts.includes(money) ? "" : `\n        got: ${got.facts}`}`);

    const sen = senate.states[st];
    if (sen) {
      const senMoney = await pg.evaluate((cents) =>
        window.__riso.usdCompact(cents), sen.total_cents);
      log(got.facts.includes(senMoney),
        `${lab} — Senate ${senMoney} on the same page as the House plate`);
      log(sen.seat_up || got.facts.includes("banked"),
        `${lab} — banked money is marked banked (seat_up=${sen.seat_up})`);
    } else {
      log(!/Senate/.test(got.facts),
        `${lab} — no Senate representation, so no Senate figure`);
    }

    log(want.stale === 0
      ? !/superseded/.test(got.facts)
      : got.facts.includes(`${want.stale} of ${want.n}`),
      `${lab} — ${want.stale} of ${want.n} superseded, stated as such`);

    await pg.click("#backtonational");
    await pg.waitForTimeout(700);
  }

  // Back at national the count is NOT 441. The five territory delegations are
  // partitioned out and drawn as chips, because Albers USA cannot project
  // them — so the plate carries 436 and the chip rail carries the other five.
  // Asserting both together is what proves they were set aside rather than
  // lost.
  const OFFMAP = ["AS", "GU", "MP", "PR", "VI"];
  const back = await pg.evaluate(() => ({
    scale: window.__press.cellScale,
    hidden: document.querySelector(".statebar").hidden,
    drawn: Number((document.getElementById("countline").textContent
      .match(/(\d+) districts/) ?? [])[1] ?? -1),
    chips: [...document.querySelectorAll("#offmap .offchip-id")]
      .map((e) => e.textContent.trim()).sort(),
  }));
  const wantDrawn = truth.features.length - OFFMAP.length;
  log(back.scale === 1 && back.hidden && back.drawn === wantDrawn,
    `app — back to national: scale ${back.scale}, ${back.drawn} districts (want ${
      wantDrawn}), bar hidden`);
  log(back.chips.join() === OFFMAP.join(),
    `app — the ${OFFMAP.length} unprojectable delegations are chips, not losses (${
      back.chips.join(" ") || "none"})`);

  log(errs.length === 0, `app — state view: clean console${
    errs.length ? `\n        ${errs.slice(0, 4).join("\n        ")}` : ""}`);
  await ctx.close();

  // The blow-up at phone width, and the press one-shot in both motion modes.
  for (const rm of ["no-preference", "reduce"]) {
    const c2 = await browser.newContext({
      viewport: { width: 390, height: 780 }, reducedMotion: rm,
    });
    const p2 = await c2.newPage();
    await p2.addInitScript(INSTRUMENT);
    await p2.goto(url(), { waitUntil: "networkidle", timeout: 30000 });
    await p2.waitForFunction(() => window.__atlas && window.__riso);
    await p2.waitForTimeout(2600);
    const before = await p2.evaluate(() =>
      ({ draws: window.__draws, drifts: window.__drifts.size }));
    await enterState(p2, "TX");
    const after = await p2.evaluate(() =>
      ({ draws: window.__draws, drifts: window.__drifts.size }));

    const over = await p2.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    log(over <= 1, `app · 390px · ${rm} — state view, no h-overflow (${over}px)`);
    log(after.draws > before.draws,
      `app · ${rm} — press one-shot drew on entry (${after.draws - before.draws} frames)`);

    if (rm === "reduce") {
      // The one-shot becomes a dot-gain pulse: the halftone radius swells,
      // and NOTHING moves. uDrift must still be the single zero vector.
      log(after.drifts === 1,
        `app · reduce — entering a state moved nothing (${after.drifts} drift value(s), want 1)`);
      await p2.waitForTimeout(1600);
      const settled = await p2.evaluate(() => window.__draws);
      await p2.waitForTimeout(1200);
      const still = await p2.evaluate(() => window.__draws);
      log(still === settled,
        `app · reduce — state view settles (${still - settled} draws after)`);
    }
    await c2.close();
  }
}

/* ------------------------------------------------------------------ */
/*  8. The four v1 features no prototype had                           */
/* ------------------------------------------------------------------ */

/**
 * Picking, search, ZIP and the deep link. Task 5 Step 5 added all four after
 * the prototype was judged, so nothing above covers them.
 *
 * Picking is exercised through REAL pointer input over the lines canvas
 * rather than by calling the app's internals: the failure this catches is a
 * picker whose hit test is offset from what is drawn, and an internal call
 * would agree with the offset and pass. The scan walks the canvas until the
 * tooltip appears, then clicks there and requires the sheet to name the same
 * district the tooltip did.
 *
 * The ZIP check is invariant 7 in the UI: an exact ZCTA answer and a
 * three-digit prefix answer must not be rendered the same way. The two cases
 * are drawn from the crosswalk itself rather than hardcoded, so a rebuild
 * that changes which ZIPs resolve exactly does not turn this into a false
 * failure.
 */
async function checkV1Features(browser, truth, zips) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { pg, errs } = await boot(ctx);
  const byGeoid = new Map(truth.features.map((f) => [f.properties.geoid, f.properties]));

  /* ---- picking, by real pointer input ----------------------------- */
  const canvas = pg.locator('#stage canvas[aria-hidden="true"]');
  const box = await canvas.boundingBox();
  let hit = null;
  outer:
  for (let gy = 0.18; gy <= 0.86 && !hit; gy += 0.06) {
    for (let gx = 0.12; gx <= 0.92; gx += 0.05) {
      await pg.mouse.move(box.x + box.width * gx, box.y + box.height * gy);
      await pg.waitForTimeout(40);
      const tip = await pg.evaluate(() => {
        const t = document.querySelector(".tip");
        return t && !t.hidden ? t.textContent.replace(/\s+/g, " ").trim() : null;
      });
      if (tip) { hit = { x: box.x + box.width * gx, y: box.y + box.height * gy, tip }; break outer; }
    }
  }
  log(!!hit, `app — hover picks a district off the plate${hit ? ` (${hit.tip})` : ""}`);

  if (hit) {
    await pg.mouse.click(hit.x, hit.y);
    // Wait for stage 09's page specifically. Since 2026-09-25 the sheet
    // shows the geometry-sourced version at once and the page replaces it,
    // so a wait on .sheet-title (both draw one) returned before the page.
    await pg.waitForSelector('.sheet[data-source="page"] .sheet-title', { timeout: 10000 }).catch(() => {});
    await pg.waitForTimeout(600);
    const sheet = await pg.evaluate(() => ({
      eyebrow: document.querySelector(".sheet-eyebrow")?.textContent.replace(/\s+/g, " ").trim() ?? "",
      amount: document.querySelector(".sheet-amount")?.textContent.trim() ?? "",
      tops: document.querySelectorAll(".sheet .sector-block").length,
      hash: location.hash,
    }));
    const geoid = sheet.hash.replace(/^#/, "");
    const props = byGeoid.get(geoid);
    log(!!props, `app — click selects a real district and deep-links it (#${geoid})`);
    if (props) {
      // The tooltip said STATE-CD; the sheet must say the SAME district.
      // This compared the sheet with the hash until 2026-09-20 — both sides
      // of which come from the click — so it read as a pass while pointing
      // at Oregon and selecting California. Compare against what the tooltip
      // actually said, which is the only thing the reader saw.
      const said = (hit.tip.match(/([A-Z]{2})-(\d+)/) ?? []).slice(1, 3);
      log(said.length === 2 &&
          sheet.eyebrow === `${said[0]} · District ${said[1]}`,
        `app — sheet names the district the tooltip named (tooltip ${
          said.join("-") || "?"}, sheet ${sheet.eyebrow})`);
      // And its money must be the artifact's, through the page's formatter.
      const want = await pg.evaluate((c) => window.__riso.usd(c), props.pac_cents);
      log(sheet.amount === want,
        `app — sheet amount ${sheet.amount} is the artifact's ${want}`);
      // Stage 09's page carries top committees; the geometry sheet does not.
      log(sheet.tops >= 2,
        `app — sheet is stage 09's page, not the geometry stub (${sheet.tops} blocks)`);
    }
  }

  /* ---- search ------------------------------------------------------ */
  await pg.fill("#finder-search", "TX-35");
  await pg.waitForTimeout(300);
  const results = await pg.locator(".finder-results li").allTextContents();
  log(results.length > 0 && /TX-35/.test(results.join(" ")),
    `app — search finds TX-35 (${results.length} result(s))`);
  if (results.length) {
    await pg.locator(".finder-results button").first().click();
    // The blow-up lands first and the stage-09 page arrives after it; reading
    // on a stopwatch reports "did not select" for a sheet that is simply
    // still in flight.
    await pg.waitForFunction(() => {
      const bar = document.querySelector(".statebar");
      return bar && !bar.hidden && !!document.querySelector(".sheet-eyebrow");
    }, null, { timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(200);
    const after = await pg.evaluate(() => ({
      st: document.querySelector(".statebar-id")?.textContent.trim() ?? null,
      eyebrow: document.querySelector(".sheet-eyebrow")?.textContent.replace(/\s+/g, " ").trim() ?? "",
      hidden: document.querySelector(".statebar").hidden,
    }));
    log(!after.hidden && after.st === "TX",
      `app — picking a search result blows up its state (${after.st})`);
    log(/District 35/.test(after.eyebrow),
      `app — and selects the district itself (${after.eyebrow})`);
  }

  /* ---- ZIP: an exact answer and a prefix answer are never equated --- */
  const exactZip = Object.keys(zips.by_zip5).find((z) => zips.by_zip5[z].length);
  const prefixZip = (() => {
    for (const p3 of Object.keys(zips.by_zip3)) {
      for (let d = 0; d < 100; d++) {
        const z = p3 + String(d).padStart(2, "0");
        if (!zips.by_zip5[z]) return z;
      }
    }
    return null;
  })();

  for (const [zip, kind, cls] of [
    [exactZip, "zcta_intersection", "is-exact"],
    [prefixZip, "zip3_prefix", "is-prefix"],
  ]) {
    if (!zip) { log(false, `app — no ${kind} ZIP available in the crosswalk to test`); continue; }
    await pg.fill("#finder-zip", zip);
    await pg.waitForTimeout(350);
    const tags = await pg.evaluate(() => [...document.querySelectorAll(".finder-zip-tag")]
      .map((e) => ({ cls: e.className, text: e.textContent.replace(/\s+/g, " ").trim() })));
    log(tags.length > 0 && tags.every((t) => t.cls.includes(cls)),
      `app — ZIP ${zip} renders as ${kind} (${tags.length} row(s), ${
        tags[0]?.text ?? "none"})`);
  }
  await pg.fill("#finder-zip", "");

  /* ---- the deep link, cold ----------------------------------------- */
  await ctx.close();
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const deepGeoid = "4835";                        // TX-35, a superseded map
  const { pg: pg2, errs: errs2 } = await boot(ctx2, `#${deepGeoid}`);
  await pg2.waitForFunction(() => !!document.querySelector(".sheet-eyebrow"),
    null, { timeout: 15000 }).catch(() => {});
  await pg2.waitForTimeout(200);
  const deep = await pg2.evaluate(() => ({
    st: document.querySelector(".statebar-id")?.textContent.trim() ?? null,
    eyebrow: document.querySelector(".sheet-eyebrow")?.textContent.replace(/\s+/g, " ").trim() ?? "",
    stale: !!document.querySelector(".sheet .vintage.is-stale"),
  }));
  const dp = byGeoid.get(deepGeoid);
  log(deep.st === dp.state && /District 35/.test(deep.eyebrow),
    `app — a cold deep link lands on ${dp.state}-${dp.cd} (${deep.st}, ${deep.eyebrow})`);
  log(deep.stale === (dp.map_status === "cd119_superseded"),
    `app — and its map vintage is stated (superseded=${deep.stale})`);

  log(errs.length === 0 && errs2.length === 0, `app — v1 features: clean console${
    [...errs, ...errs2].length ? `\n        ${[...errs, ...errs2].slice(0, 4).join("\n        ")}` : ""}`);
  await ctx2.close();
}

/* ------------------------------------------------------------------ */
/*  9. What you point at is what you get                               */
/* ------------------------------------------------------------------ */

/**
 * Hover and click must name the same district — everywhere, and especially
 * ON A BORDER.
 *
 * The picker encodes each district's index as a colour in an offscreen
 * canvas. Canvas path fills are antialiased and cannot be told not to be, so
 * a border pixel carries a BLEND of its two neighbours' index colours, and
 * that blend decodes to a third, unrelated district. Worse, `click`
 * truncates clientX to an integer while `pointermove` does not, so the
 * tooltip and the click could disagree at what the reader sees as one place.
 * Measured on the shipped build before the fix: tooltip OR-05, sheet CA-46.
 *
 * The grid sweep would have caught it only by luck; the border walk is the
 * part that catches it on purpose. It steps one pixel at a time until the
 * tooltip changes district, then tests the pixel on each side of that
 * transition — which is exactly the pixel the colour buffer gets wrong.
 */
async function checkPicking(browser, truth) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const { pg } = await boot(ctx);
  const byGeoid = new Map(truth.features.map((f) => [f.properties.geoid, f.properties]));
  const box = await pg.locator("#lines").boundingBox();

  const tipAt = async (x, y) => {
    await pg.mouse.move(x, y);
    await pg.waitForTimeout(35);
    return pg.evaluate(() => {
      const t = document.querySelector(".tip");
      if (!t || t.hidden) return null;
      const m = t.textContent.replace(/\s+/g, " ").trim().match(/([A-Z]{2})-(\d+)/);
      return m ? `${m[1]}-${m[2]}` : null;
    });
  };
  // Two clicks a pixel apart within the OS double-click interval ARE a
  // double-click, and since 2026-09-25 a double-click descends a zoom tier.
  // The border walk clicks both sides of a border back to back, so without
  // this gap its second click landed on a state plate it had just entered
  // (measured: "UT-01 hovered -> UT-3 selected"). A reader who clicks twice
  // that fast has double-clicked; the walk is testing single clicks.
  let lastClick = 0;
  const clickAt = async (x, y) => {
    const wait = 650 - (Date.now() - lastClick);
    if (wait > 0) await pg.waitForTimeout(wait);
    await pg.mouse.click(x, y);
    lastClick = Date.now();
    await pg.waitForFunction(() => !!document.querySelector(".sheet-eyebrow"),
      null, { timeout: 15000 }).catch(() => {});
    const geoid = await pg.evaluate(() => location.hash.replace(/^#/, ""));
    const p = byGeoid.get(geoid);
    return p ? `${p.state}-${String(Number(p.cd))}` : null;
  };
  const norm = (s) => s && s.replace(/-0*(\d)/, "-$1");

  let tested = 0, bad = [];
  for (let gy = 0.18; gy <= 0.82; gy += 0.16) {
    for (let gx = 0.12; gx <= 0.88; gx += 0.11) {
      const x = box.x + box.width * gx, y = box.y + box.height * gy;
      const tip = await tipAt(x, y);
      if (!tip) continue;
      const got = await clickAt(x, y);
      tested++;
      if (norm(tip) !== norm(got)) bad.push(`${tip} hovered -> ${got} selected`);
    }
  }
  log(tested > 10 && bad.length === 0,
    `app — hover and click agree on ${tested} point(s) across the plate${
      bad.length ? `\n        ${bad.slice(0, 4).join("\n        ")}` : ""}`);

  // The border walk. Coarse steps to find a district change, then bisect to
  // the pixel the change happens on — stepping 1px at a time was most of
  // this harness's runtime and found the same borders.
  let walked = 0, edgeBad = [];
  const y = box.y + box.height * 0.42;
  const x0 = box.x + box.width * 0.15, x1 = box.x + box.width * 0.85;
  let prev = null, prevX = null;
  for (let x = x0; x < x1 && walked < 6; x += 6) {
    const tip = await tipAt(x, y);
    if (prev && tip && tip !== prev) {
      let lo = prevX, hi = x;
      while (hi - lo > 1) {
        const mid = (lo + hi) / 2;
        ((await tipAt(mid, y)) === prev) ? lo = mid : hi = mid;
      }
      for (const [px, want] of [[lo, prev], [hi, await tipAt(hi, y)]]) {
        if (!want) continue;
        const got = await clickAt(px, y);
        if (norm(want) !== norm(got)) edgeBad.push(`border: ${want} hovered -> ${got} selected`);
      }
      walked++;
    }
    if (tip) { prev = tip; prevX = x; }
  }
  log(walked > 0 && edgeBad.length === 0,
    `app — hover and click agree on both sides of ${walked} border(s)${
      edgeBad.length ? `\n        ${edgeBad.slice(0, 4).join("\n        ")}` : ""}`);

  await ctx.close();
}

/* ------------------------------------------------------------------ */

try {
  await stat(join(ROOT, "index.html"));
} catch {
  console.error(`no build at ${ROOT} — run \`npm run build\` in web/ first`);
  process.exit(1);
}

const truth = JSON.parse(await readFile(join(DATA, `districts-${CYCLE}-${V}.geojson`), "utf8"));
const senate = JSON.parse(await readFile(join(DATA, `senate-${CYCLE}-${V}.json`), "utf8"));
const zips = JSON.parse(await readFile(join(DATA, `zip-districts-${V}.json`), "utf8"));

const server = await serve();
console.log(`serving ${ROOT} on :${PORT}\n`);

const browser = await chromium.launch({ executablePath: EXE, args: GL_FLAGS });

console.log("— the page —");
for (const vp of VIEWPORTS) {
  for (const dark of [false, true]) await checkPage(browser, vp, dark);
}
console.log("\n— the numbers —");
await checkNumbers(browser, truth, senate);
console.log("\n— motion —");
await checkMotion(browser);
console.log("\n— layout —");
await checkLayout(browser);
console.log("\n— zoom tiers —");
await checkZoomTiers(browser);
console.log("\n— the party layer —");
await checkPartyLayer(browser, truth);
console.log("\n— the keylines —");
await checkKeylines(browser);
console.log("\n— the state blow-up —");
await checkStateView(browser, truth, senate);
console.log("\n— v1 features —");
await checkV1Features(browser, truth, zips);
console.log("\n— what you point at is what you get —");
await checkPicking(browser, truth);

if (!process.argv.includes("--keep")) await browser.close();
server.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
