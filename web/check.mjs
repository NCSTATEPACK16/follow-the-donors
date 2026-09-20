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
  const P = WebGL2RenderingContext.prototype;
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
      ({ draws: window.__draws, drifts: window.__drifts.size }));

    if (rm === "reduce") {
      log(r.draws === a,
        `app — reduced motion: loop settles (${r.draws - a} draws after settling)`);
      log(r.drifts === 1,
        `app — reduced motion: ${r.drifts} distinct drift value(s), want exactly 1 (zero)`);
    } else {
      log(r.draws > a,
        `app — breathing: still drawing (${r.draws - a} draws in 2.2s)`);
      log(r.drifts > 3,
        `app — breathing: ${r.drifts} distinct drift values (plates move)`);
    }
    await ctx.close();
  }
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
    const claimed = Number((got.screenLine.match(/at (\d+)px/) ?? [])[1] ?? -1);
    log(claimed === Math.round(got.cellPx),
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
    await pg.waitForSelector(".sheet .sheet-title", { timeout: 10000 }).catch(() => {});
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
      // The tooltip said STATE-CD; the sheet must say the same district.
      log(sheet.eyebrow.startsWith(`${props.state} · District`),
        `app — sheet names the district the tooltip named (${sheet.eyebrow})`);
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
console.log("\n— the state blow-up —");
await checkStateView(browser, truth, senate);
console.log("\n— v1 features —");
await checkV1Features(browser, truth, zips);

if (!process.argv.includes("--keep")) await browser.close();
server.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
