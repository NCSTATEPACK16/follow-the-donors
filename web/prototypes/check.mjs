/**
 * The verification harness for the riso prototypes.
 *
 * Round 1 ran this by hand and then lost it; the round-2 plan says to rebuild
 * it, so here it is as a committed script. What it checks, and why each check
 * earned its place:
 *
 *   1. JS errors and failed requests — every page, both themes, two widths.
 *   2. Horizontal overflow at 390px. A choropleth that side-scrolls on a
 *      phone is broken, and it is the single easiest thing to regress.
 *   3. WebGL2 actually initialised. This is the one that matters most: B, D,
 *      E and F all have a silent non-WebGL fallback path, so without forcing
 *      a software GL stack a headless run would PASS while testing nothing.
 *      Hence --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
 *      below; drop them and the harness quietly stops checking the shader.
 *   4. Every control is exercised and the page still has no errors after.
 *   5. THE NUMBERS AGREE WITH THE DATABASE. Each page is asked, through its
 *      own code path, what a given district and a given state received, and
 *      the answer is compared to the artifact to the cent. A prototype that
 *      looks right and prints the wrong number is worse than one that fails
 *      to load.
 *   6. Reduced motion means NOTHING MOVES — asserted on the GL calls, not on
 *      pixels. See checkMotion for the two ways of measuring this that look
 *      like passes and are not.
 *   7. The state blow-up is actually entered. The picker is a <select>, and
 *      clicking one fires no `change` — so it counted as an exercised
 *      control while the round-2 feature went untested. See checkStateView.
 *
 * Run:  node web/prototypes/check.mjs           (starts its own server)
 *       node web/prototypes/check.mjs --keep    (leave the browser open)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// Port 0 = let the OS pick a free one. Fixed ports collide when two agents
// (or two terminals) verify at the same time, and the failure looks like a
// broken page rather than a busy socket.
let PORT = 0;

// The exact flags round 1 used. Without them WebGL2 is unavailable in
// headless Chromium and every WebGL prototype silently takes its fallback
// path — the harness would pass while testing nothing.
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
  ".woff2": "font/woff2", ".woff": "font/woff",
};

function serve() {
  const s = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      let p = normalize(decodeURIComponent(url.pathname));
      if (p.endsWith("/")) p += "index.html";
      const file = join(HERE, p);
      if (!file.startsWith(HERE)) { res.writeHead(403).end(); return; }
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

/* ------------------------------------------------------------------ */

const PAGES = [
  { file: "index.html", gl: false, round: 1 },
  { file: "a-broadside.html", gl: false, round: 1 },
  { file: "b-plate.html", gl: true, round: 1 },
  { file: "c-specimen.html", gl: false, round: 1 },
  { file: "d-threeplate.html", gl: true, round: 2 },
  { file: "e-tilt.html", gl: true, round: 2 },
  { file: "f-sector.html", gl: true, round: 2 },
];

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

let failures = 0;
const log = (ok, msg) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${msg}`);
};

async function checkPage(browser, page_, vp, dark) {
  const errs = [];
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const pg = await ctx.newPage();
  // The browser asks for /favicon.ico on its own and these pages ship none.
  // That 404 is the browser's, not the page's — filtered by exact path so a
  // real missing asset still fails the run. Blanket-ignoring 404s here would
  // hide a missing data artifact, which is the main thing this catches.
  const isFavicon = (s) => /\/favicon\.ico\b/.test(s);
  pg.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  pg.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    const url = m.location?.().url || "";
    if (isFavicon(t) || isFavicon(url)) return;
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

  const label = `${page_.file} · ${vp.name}px · ${dark ? "dark" : "light"}`;
  await pg.goto(`http://127.0.0.1:${PORT}/${page_.file}`,
    { waitUntil: "networkidle", timeout: 30000 });

  if (dark) {
    const t = await pg.$("#theme");
    if (t) { await t.click(); await pg.waitForTimeout(220); }
  }
  await pg.waitForTimeout(350);

  // 3. WebGL2 really initialised — not the silent fallback.
  if (page_.gl) {
    const live = await pg.evaluate(() => {
      const c = document.querySelector("canvas#gl");
      return !!(c && c.getContext("webgl2"));
    });
    log(live, `${label} — WebGL2 live`);
  }

  // 2. No horizontal overflow.
  const over = await pg.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  log(over <= 1, `${label} — no h-overflow (${over}px)`);

  // 4. Exercise every control.
  const ctls = await pg.$$(".controls .ctl, .statebar .ctl");
  for (const c of ctls) {
    if (await c.isDisabled()) continue;
    await c.click();
    await pg.waitForTimeout(160);
  }
  log(true, `${label} — ${ctls.length} control(s) exercised`);

  // 1. Errors.
  log(errs.length === 0, `${label} — clean console${
    errs.length ? `\n        ${errs.slice(0, 4).join("\n        ")}` : ""}`);

  await ctx.close();
  return errs;
}

/**
 * 5. The numbers agree with the data.
 *
 * Asserted through each page's OWN module graph, so this catches an encoder
 * that renders a plausible colour from the wrong number — which is the
 * failure a screenshot cannot see.
 */
async function checkNumbers(browser, page_) {
  if (page_.round !== 2) return;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${PORT}/${page_.file}`,
    { waitUntil: "networkidle", timeout: 30000 });
  await pg.waitForTimeout(400);

  const truth = JSON.parse(
    await readFile(join(HERE, "data", "districts-2026.geojson"), "utf8"));
  const senate = JSON.parse(
    await readFile(join(HERE, "data", "senate-2026.json"), "utf8"));
  const want = new Map(truth.features.map((f) =>
    [f.properties.geoid, f.properties.pac_cents]));

  const got = await pg.evaluate(() => window.__atlas
    ? Object.fromEntries(window.__atlas.districts.features.map(
        (f) => [f.properties.geoid, f.properties.pac_cents]))
    : null);
  if (!got) {
    log(false, `${page_.file} — exposes window.__atlas for verification`);
    await ctx.close();
    return;
  }
  let bad = 0, n = 0;
  for (const [geoid, cents] of want) {
    n++;
    if (got[geoid] !== cents) bad++;
  }
  log(bad === 0, `${page_.file} — ${n} districts agree to the cent (${bad} off)`);

  const senGot = await pg.evaluate(() =>
    window.__atlas?.senate?.total_cents ?? null);
  log(senGot === senate.total_cents,
    `${page_.file} — Senate total agrees (${senGot} vs ${senate.total_cents})`);

  // The plan's measured facts, asserted on the page's own loaded artifact.
  const facts = await pg.evaluate(() => {
    const a = window.__atlas;
    if (!a) return null;
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
    log(facts[k] === v, `${page_.file} — ${k} = ${v}${
      facts[k] === v ? "" : ` (got ${facts[k]})`}`);
  }

  await ctx.close();
}

/**
 * 6. Reduced motion means NOTHING MOVES.
 *
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
async function checkMotion(browser, page_) {
  if (!page_.gl || page_.round !== 2) return;
  for (const rm of ["no-preference", "reduce"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: 800 }, reducedMotion: rm,
    });
    const pg = await ctx.newPage();
    await pg.addInitScript(() => {
      window.__draws = 0;
      window.__drifts = new Set();
      const P = WebGL2RenderingContext.prototype;
      const od = P.drawArrays;
      P.drawArrays = function (...a) { window.__draws++; return od.apply(this, a); };
      const ou = P.uniform2fv;
      P.uniform2fv = function (loc, v) {
        try { window.__drifts.add(Array.from(v).map((x) => x.toFixed(4)).join(",")); } catch {}
        return ou.apply(this, arguments);
      };
    });
    await pg.goto(`http://127.0.0.1:${PORT}/${page_.file}`,
      { waitUntil: "networkidle", timeout: 30000 });
    await pg.waitForTimeout(2600);
    const a = await pg.evaluate(() => window.__draws);
    await pg.waitForTimeout(2200);
    const r = await pg.evaluate(() =>
      ({ draws: window.__draws, drifts: window.__drifts.size }));

    if (rm === "reduce") {
      log(r.draws === a,
        `${page_.file} — reduced motion: loop settles (${r.draws - a} draws after settling)`);
      log(r.drifts === 1,
        `${page_.file} — reduced motion: ${r.drifts} distinct drift value(s), want exactly 1 (zero)`);
    } else {
      log(r.draws > a,
        `${page_.file} — breathing: still drawing (${r.draws - a} draws in 2.2s)`);
      log(r.drifts > 3,
        `${page_.file} — breathing: ${r.drifts} distinct drift values (plates move)`);
    }
    await ctx.close();
  }
}


/**
 * 7. THE STATE BLOW-UP — the round-2 feature, and the one nothing else here
 *    could see.
 *
 * `checkPage` reports "5 control(s) exercised" and the state picker is one
 * of the five. But the picker is a `<select>`, and clicking a `<select>` in
 * headless Chromium opens no menu and fires no `change` — so the control
 * counted as exercised while the blow-up was never once entered. That is a
 * pass that tests nothing, the same shape of failure as running the shader
 * prototypes without the GL flags at the top of this file. `selectOption`
 * fires the event; `click` does not.
 *
 * Each assertion below is here because it catches something a screenshot or
 * the national-view checks cannot:
 *
 *   - The plate is really RE-SCREENED. The statebar tells the reader
 *     "Re-screened at 8px — a blow-up is a new plate". That is a claim about
 *     a uniform on the GPU, so it is checked against `press.cellScale`, not
 *     against its own label. A bar reading 8px over a plate still screened
 *     at 3.6px looks entirely plausible.
 *   - Only that state's districts are drawn, counted against the artifact.
 *   - The money in the bar is THAT STATE'S money. A blow-up that sums the
 *     wrong districts renders perfectly and is simply wrong.
 *   - The territory delegations draw. AS/GU/MP/PR/VI cannot be projected on
 *     Albers USA (COMPARISON.md §7) and are chips nationally; a state view
 *     is the only place they exist as a map, so it is the only place that
 *     can be proven.
 *   - The press one-shot runs on entry and then settles — and under reduced
 *     motion moves NOTHING. Entering a state is the single moment the page
 *     is most tempted to animate, and the moment the national-view motion
 *     check never reaches.
 *   - Going back restores the national screen, count and chrome.
 */
const STATE_CASES = [
  { st: "TX", why: "largest delegation, every district superseded" },
  { st: "MD", why: "carries the DC→MD Senate correction; money banked" },
  { st: "PR", why: "territory — cannot be drawn on Albers USA at all" },
];

async function enterState(pg, st) {
  await pg.selectOption("#statepick", st);
  // goTo() defers layout by 180ms for the plate swap, then presses.
  await pg.waitForTimeout(700);
}

async function checkStateView(browser, page_) {
  if (!page_.gl || page_.round !== 2) return;

  const truth = JSON.parse(
    await readFile(join(HERE, "data", "districts-2026.geojson"), "utf8"));
  const senate = JSON.parse(
    await readFile(join(HERE, "data", "senate-2026.json"), "utf8"));
  const per = new Map();
  for (const f of truth.features) {
    const p = f.properties;
    const s = per.get(p.state) ?? { n: 0, cents: 0, stale: 0 };
    s.n++; s.cents += p.pac_cents;
    if (p.map_status === "cd119_superseded") s.stale++;
    per.set(p.state, s);
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  pg.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text()}`); });
  await pg.goto(`http://127.0.0.1:${PORT}/${page_.file}`,
    { waitUntil: "networkidle", timeout: 30000 });
  await pg.waitForTimeout(400);

  const national = await pg.evaluate(() => window.__press?.cellScale ?? null);
  log(national === 1,
    `${page_.file} — national plate at screen scale 1 (got ${national})`);

  for (const { st, why } of STATE_CASES) {
    const want = per.get(st);
    await enterState(pg, st);

    const got = await pg.evaluate(async (st) => {
      const v = await import("./shared/view.js");
      const bar = document.getElementById("statebar");
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
        wantScale: v.STATE_SCALE,
        cellPx: (v.CELL.cd119_current * window.__press.cellScale),
      };
    }, st);

    const lab = `${page_.file} · ${st}`;
    log(!got.hidden && got.id === st, `${lab} — entered (${why})`);
    log(got.drawn === want.n,
      `${lab} — ${got.drawn} district(s) drawn, artifact says ${want.n}`);

    // The re-screen, asserted on the uniform and then against its own label.
    log(Math.abs(got.scale - got.wantScale) < 1e-9,
      `${lab} — re-screened on the GPU (cellScale ${got.scale.toFixed(3)})`);
    const claimed = Number((got.screenLine.match(/at (\d+)px/) ?? [])[1] ?? -1);
    log(claimed === Math.round(got.cellPx),
      `${lab} — label says ${claimed}px, plate is at ${got.cellPx.toFixed(1)}px`);

    // The money, through the page's own formatter so the comparison is of
    // the NUMBER, not of two spellings of it.
    const money = await pg.evaluate(async (cents) =>
      (await import("./shared/inks.js")).usdCompact(cents), want.cents);
    log(got.facts.includes(money),
      `${lab} — bar shows ${money} to ${want.n} districts${
        got.facts.includes(money) ? "" : `\n        got: ${got.facts}`}`);

    const sen = senate.states[st];
    if (sen) {
      const senMoney = await pg.evaluate(async (cents) =>
        (await import("./shared/inks.js")).usdCompact(cents), sen.total_cents);
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
    await pg.waitForTimeout(600);
  }

  // Back at national the count is NOT 441. The five territory delegations
  // are partitioned out and drawn as chips, because Albers USA cannot
  // project them — so the plate carries 436 and the chip rail carries the
  // other five. Asserting both together is what proves they were set aside
  // rather than lost, which is the failure COMPARISON.md §7 describes.
  const OFFMAP = ["AS", "GU", "MP", "PR", "VI"];
  const back = await pg.evaluate(() => ({
    scale: window.__press.cellScale,
    hidden: document.getElementById("statebar").hidden,
    drawn: Number((document.getElementById("countline").textContent
      .match(/(\d+) districts/) ?? [])[1] ?? -1),
    chips: [...document.querySelectorAll("#offmap .offchip-id")]
      .map((e) => e.textContent.trim()).sort(),
  }));
  const wantDrawn = truth.features.length - OFFMAP.length;
  log(back.scale === 1 && back.hidden && back.drawn === wantDrawn,
    `${page_.file} — back to national: scale ${back.scale}, ${
      back.drawn} districts (want ${wantDrawn}), bar hidden`);
  log(back.chips.join() === OFFMAP.join(),
    `${page_.file} — the ${OFFMAP.length} unprojectable delegations are chips, not losses (${
      back.chips.join(" ") || "none"})`);

  log(errs.length === 0, `${page_.file} — state view: clean console${
    errs.length ? `\n        ${errs.slice(0, 4).join("\n        ")}` : ""}`);
  await ctx.close();

  // The blow-up at phone width, and the press one-shot in both motion modes.
  for (const rm of ["no-preference", "reduce"]) {
    const c2 = await browser.newContext({
      viewport: { width: 390, height: 780 }, reducedMotion: rm,
    });
    const p2 = await c2.newPage();
    await p2.addInitScript(() => {
      window.__draws = 0;
      window.__drifts = new Set();
      const P = WebGL2RenderingContext.prototype;
      const od = P.drawArrays;
      P.drawArrays = function (...a) { window.__draws++; return od.apply(this, a); };
      const ou = P.uniform2fv;
      P.uniform2fv = function (loc, v) {
        try { window.__drifts.add(Array.from(v).map((x) => x.toFixed(4)).join(",")); } catch {}
        return ou.apply(this, arguments);
      };
    });
    await p2.goto(`http://127.0.0.1:${PORT}/${page_.file}`,
      { waitUntil: "networkidle", timeout: 30000 });
    await p2.waitForTimeout(2600);
    const before = await p2.evaluate(() =>
      ({ draws: window.__draws, drifts: window.__drifts.size }));
    await enterState(p2, "TX");
    const after = await p2.evaluate(() =>
      ({ draws: window.__draws, drifts: window.__drifts.size }));

    const over = await p2.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    log(over <= 1, `${page_.file} · 390px · ${rm} — state view, no h-overflow (${over}px)`);
    log(after.draws > before.draws,
      `${page_.file} · ${rm} — press one-shot drew on entry (${
        after.draws - before.draws} frames)`);

    if (rm === "reduce") {
      // The one-shot becomes a dot-gain pulse: the halftone radius swells,
      // and NOTHING moves. uDrift must still be the single zero vector.
      log(after.drifts === 1,
        `${page_.file} · reduce — entering a state moved nothing (${
          after.drifts} drift value(s), want 1)`);
      await p2.waitForTimeout(1600);
      const settled = await p2.evaluate(() => window.__draws);
      await p2.waitForTimeout(1200);
      const still = await p2.evaluate(() => window.__draws);
      log(still === settled,
        `${page_.file} · reduce — state view settles (${still - settled} draws after)`);
    }
    await c2.close();
  }
}

/* ------------------------------------------------------------------ */

const server = await serve();
console.log(`serving ${HERE} on :${PORT}\n`);

const browser = await chromium.launch({
  executablePath: EXE,
  args: GL_FLAGS,
});

for (const p of PAGES) {
  try {
    await stat(join(HERE, p.file));
  } catch {
    console.log(`\n— ${p.file} — not present, skipped`);
    continue;
  }
  console.log(`\n— ${p.file} —`);
  for (const vp of VIEWPORTS) {
    for (const dark of [false, true]) {
      await checkPage(browser, p, vp, dark);
    }
  }
  await checkNumbers(browser, p);
  await checkMotion(browser, p);
  await checkStateView(browser, p);
}

if (!process.argv.includes("--keep")) await browser.close();
server.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
