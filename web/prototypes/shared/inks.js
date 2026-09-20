/**
 * The riso ink systems — three of them, one per prototype.
 *
 * EVERY value here was produced by the dataviz skill's validator, not picked
 * off a riso ink chart. Raw riso inks fail: Federal Blue reads gray (chroma
 * 0.089) and orange/green collide at ΔE 7.3 under protanopia.
 *
 * Two corrections to what the v1 plan recorded, both found by re-running the
 * validator on 2026-09-19:
 *
 *   1. The plan's set was validated on ADJACENT pairs. That is right for a bar
 *      chart and wrong for a map — on a choropleth or a sector legend any two
 *      inks can land side by side, so the pairlist is `all`. Under `--pairs
 *      all` the plan's set FAILS: #7E5BB0 ↔ #2F4B9B is ΔE 13.4 to normal
 *      vision, under the 15 floor. Re-snapped below.
 *   2. The plan's ramp was validated against #fcfcfb. On actual riso paper
 *      (#F6F2E9 and warmer) its palest step #E8EDF7 reads 1.05:1 — invisible.
 *      Every ramp below is validated against ITS OWN paper.
 *
 * Re-run before changing anything:
 *   node scripts/validate_palette.js "<hexes>" --mode light \
 *        --surface "<paper>" --pairs all
 *   node scripts/validate_palette.js "<ramp>"  --ordinal --surface "<paper>"
 */

/** Sector order is MEASURED, not assumed: the top five by 2024 district
 *  dollars. Anything past the fifth folds into Other — a 6th sector is never
 *  a generated hue. (The v1 plan listed Party 5th; Party is $1.6M and
 *  Leadership PAC is $48.4M, so the plan's order was wrong.) */
export const SECTOR_ORDER = [
  "Corporate",          // $142.9M
  "Trade Association",  //  $75.6M
  "Leadership PAC",     //  $48.4M
  "Labor",              //  $45.7M
  "Membership",         //  $39.9M
];
export const OTHER_LABEL = "Other";

/** Screen angles, degrees. Distinct per plate so overlapping halftones form a
 *  rosette instead of a moiré. Classic separation is 15/45/75. */
export const SCREEN_ANGLES = { key: 45, color: 15, second: 75 };

/**
 * Two kinds of approximation live in this data and they are NOT the same
 * thing, so they do not get the same mark:
 *
 *   map_status — the BOUNDARY is wrong. A redraw is in effect and we cannot
 *                draw it. The money is fine; the line is stale.
 *   resolution — the MONEY's district is a guess. A committee ZIP resolved
 *                only to a three-digit prefix, so the dollars are spread
 *                across every district that neighbourhood touches.
 *
 * The research paper's critique of misregistration lands on exactly one case:
 * offsetting a district's FILL pushes ink into the neighbour and states
 * something false about where money is. It does not land on offsetting the
 * KEYLINE, which is where the uncertainty actually lives. So: stale boundary
 * → the line doubles and shifts; uncertain money → the fill opens up.
 */
export const BOUNDARY_UNCERTAIN = new Set(["cd119_superseded"]);
export const BOUNDARY_CONTESTED = new Set(["cd119_contested"]);

export function certaintyClass(mapStatus) {
  if (BOUNDARY_UNCERTAIN.has(mapStatus)) return "riso-offregister";
  if (BOUNDARY_CONTESTED.has(mapStatus)) return "riso-contested";
  return "riso-registered";
}

export const STATUS_LABEL = {
  cd119_current: "Current — this is the map that governs",
  cd119_superseded: "Superseded — a redraw is in effect and we cannot draw it",
  cd119_contested: "Contested — enacted then blocked; this map still governs",
  override_applied: "Override — geometry replaced from a named source",
};

/* ------------------------------------------------------------------ */
/*  A — BROADSIDE.  Political-poster riso on warm stock.              */
/* ------------------------------------------------------------------ */
export const A = {
  id: "a", name: "Broadside",
  paper: "#F6F2E9", paperDark: "#17171A",
  // ALL CHECKS PASS · pairs=all · surface #F6F2E9
  //   CVD worst #B34A0C↔#2E7A50 ΔE 8.6 (deutan) · normal worst ΔE 16.9
  inks: ["#3F6FD8", "#F03D96", "#2E7A50", "#B34A0C", "#6E2BA8"],
  other: "#6B6B66",
  // ordinal PASS · surface #F6F2E9 · pale end #89adf8 at 2.00:1
  // Chroma is the LOWEST that still passes every ordinal check. A ramp
  // snapped for maximum separation lands near the gamut edge and reads as a
  // dashboard, not as ink; riso pigment is saturated but the PAPER mutes it.
  ramp: ["#89adf8", "#6790e7", "#4d74c8", "#3b5ba0", "#2e4372", "#232e43"],
  // dark is SELECTED, not flipped. ALL CHECKS PASS · pairs=all · #17171A
  inksDark: ["#6090fa", "#ec5599", "#2f7f51", "#b84e0d", "#8248b8"],
  // ordinal PASS mode=dark · dim end #3a4a6b at 2.02:1 — used REVERSED
  // (low money = dim, high money = bright), because on a dark ground the
  // dark end of a light→dark ramp is the one that disappears.
  rampDark: ["#3a4a6b", "#4465ad", "#5282ec", "#80a7f8", "#b4cbfb", "#e7effe"],
};

/* ------------------------------------------------------------------ */
/*  B — PLATE.  Two drums, real halftone, green-forward.              */
/* ------------------------------------------------------------------ */
export const B = {
  id: "b", name: "Plate",
  paper: "#F5F3EE", paperDark: "#17171A",
  // ALL CHECKS PASS · pairs=all · surface #F5F3EE
  //   CVD worst #B84607↔#2A7A50 ΔE 9.0 (deutan) · normal worst ΔE 19.9
  inks: ["#2A7A50", "#4B7FE8", "#EE3A9E", "#B84607", "#6A2FAA"],
  other: "#6B6B66",
  // ordinal PASS · surface #F5F3EE · pale end #95b59f at 2.02:1 · min chroma
  ramp: ["#95b59f", "#779b82", "#5d8069", "#486552", "#374a3d", "#27302a"],
  inksDark: ["#257d4d", "#6090fa", "#e05ea3", "#c14407", "#7b4bbd"],
  rampDark: ["#32503c", "#31764d", "#2f9d61", "#3fc47b", "#67e89c", "#c8fed9"],
  // The two drums. The ramp above is what they produce overprinted; the
  // shader mixes these subtractively rather than sampling the ramp, so the
  // secondary colour is EARNED the way a second pass on the drum earns it.
  plates: { color: "#1E8A5A", second: "#2B4FA8" },
  /* Dark mode composites ADDITIVELY (see the shader), so these are light
     emitters rather than inks and are deliberately dimmer — added to the
     ground they reach roughly the validated dark ramp rather than blowing
     out. Kubelka-Munk cannot run on a dark substrate at all. */
  platesDark: { color: "#1C6E44", second: "#2A4E96" },
};

/* ------------------------------------------------------------------ */
/*  C — SPECIMEN.  Banknote engraving; categories by screen, not hue. */
/* ------------------------------------------------------------------ */
export const C = {
  id: "c", name: "Specimen",
  paper: "#EFE9D9", paperDark: "#141410",
  // ALL CHECKS PASS · pairs=all · surface #EFE9D9
  //   CVD worst #B84607↔#1E7A57 ΔE 9.6 (protan) · normal worst ΔE 19.9
  inks: ["#1E7A57", "#4B7FE8", "#EE3A9E", "#B84607", "#6A2FAA"],
  other: "#6B6B66",
  // ordinal PASS · surface #EFE9D9 · pale end #8bae9a at 2.01:1 · min chroma
  ramp: ["#8bae9a", "#6e9680", "#567c67", "#436251", "#34493d", "#27302b"],
  inksDark: ["#257d4d", "#6090fa", "#e05ea3", "#c14407", "#7b4bbd"],
  rampDark: ["#32503c", "#31764d", "#2f9d61", "#3fc47b", "#67e89c", "#c8fed9"],
  /**
   * The KEY plate. #24457F is 7.76:1 against the cream — AAA as text.
   *
   * The categorical validator FAILS it on the lightness band (L 0.398, below
   * 0.43) and that failure is CORRECT TO IGNORE: the band exists to keep five
   * competing hues mutually legible, and a key plate competes with nothing.
   * The validator scopes itself out in its own words — "for a lone
   * status/text color check WCAG text contrast". Recorded here so nobody
   * lightens it to make a check go green.
   */
  key: "#24457F",
  keyDark: "#C9D4E8",
};

/* ================================================================== */
/*  ROUND 2 — D, E, F.                                                 */
/*                                                                     */
/*  Every value below is SOLVED, not chosen, and solved against the    */
/*  tone the PLATES ACTUALLY PRINT rather than against a swatch — see  */
/*  plateTone() and COMPARISON.md §8. The `ramp` a legend draws is      */
/*  derived from the plates at load, so a legend that disagrees with    */
/*  the map is no longer expressible.                                   */
/*                                                                     */
/*  What each one passes, and where it stops, is recorded per system.   */
/*  None of these is "all checks pass": two of the three encode a      */
/*  second variable in a channel that the money axis itself dims.       */
/* ================================================================== */

/**
 * D — THREE-PLATE. Money only, extended tonal range.
 *
 * ordinal PASS · surface #F5F3EE · pale end #88b8a0 at 2.01:1 · every
 * adjacent gap >= 0.06 · dark PASS (used reversed) · dim end at 2.03:1.
 *
 * SINGLE HUE IS DELIBERATELY FAILED — hue spread 73°, against a 40° gate.
 * That is D's whole thesis and it is a departure taken on the record: the
 * three plates ARE three hues, lightness alone carries the order, and hue
 * rides along as a secondary channel the way viridis does. The gate exists
 * to stop a rainbow where hue does the encoding; here it does not. Monotone
 * L and the step gaps — the checks that actually carry the ordering — pass
 * unaided.
 */
export const D = {
  id: "d", name: "Three-Plate",
  paper: "#F5F3EE", paperDark: "#17171A",
  inks: B.inks, other: "#6B6B66", inksDark: B.inksDark,
  plates: { first: "#0C8152", second: "#1F769F", third: "#1D3681" },
  platesDark: { first: "#3B895D", second: "#3F7D9A", third: "#3A518A" },
  // The composite coverage per money step. NOT linear: the steps are spaced
  // to be equal in PERCEIVED LIGHTNESS, which is the only spacing under
  // which six quantile classes read as six.
  table: [0.4625, 0.5943, 0.7048, 0.7983, 0.8386, 0.88],
  tableDark: [0.4375, 0.5878, 0.6625, 0.7196, 0.8043, 0.88],
  plateOrder: ["first", "second", "third"],
  split: (t, n = 3) => seqWeights(t, n),
};

/**
 * E — TILT. Bivariate: lightness is money, hue is REP/DEM tilt.
 *
 * ordinal PASS at EVERY tilt, light and dark — pure REP, pure DEM, the
 * neutral midpoint, 80/20 either way, 50/50. That is the point of solving
 * the inks for their PRINTED lightness rather than their own: inks equal in
 * OKLab L do not print equal, because Kubelka-Munk mixes per channel, and
 * until they did the money axis moved when the tilt did.
 *
 * THE TILT IS ONLY LEGIBLE AT THE TOP OF THE MONEY RANGE. Measured, the
 * REP↔DEM pair clears the 15 normal-vision floor and the 8 CVD target at
 * steps 4 and 5 only:
 *
 *     step   0     1     2     3     4     5
 *     normal 6.5   9.1  11.9  14.6  17.7  20.9
 *     CVD    5.4   7.5   9.8  11.9  14.4  17.1
 *
 * That is 147 of 441 districts (33.3%), holding $197.4M of $328.8M (60.0%).
 * On the other 294 the hue is there and is not readable, and this is not a
 * tuning failure: lightness encodes money by putting LESS INK on a poorer
 * district, and less ink is less hue. A bivariate map dims its second
 * variable exactly where its first is smallest. The chroma above is the
 * HIGHEST that still passes the money axis, which is the opposite of
 * round-1 correction #3 and deliberately so — there chroma was decoration,
 * here it is the data.
 */
export const E = {
  id: "e", name: "Tilt",
  paper: "#F5F3EE", paperDark: "#17171A",
  inks: B.inks, other: "#6B6B66", inksDark: B.inksDark,
  plates: { rep: "#6C0000", neutral: "#32312A", dem: "#00297E" },
  platesDark: { rep: "#F58D7E", neutral: "#AFACA4", dem: "#83AFFF" },
  table: [0.34, 0.4549, 0.568, 0.6762, 0.7794, 0.88],
  tableDark: [0.3175, 0.4253, 0.5355, 0.6457, 0.7619, 0.88],
  plateOrder: ["rep", "neutral", "dem"],
  // The diverging midpoint is GRAY ON PURPOSE and is exempt from the chroma
  // floor; a diverging scale whose middle has a hue is a rainbow.
  gray: ["neutral"],
  legible: [4, 5],
  // The legend's money swatches are the NEUTRAL mix: what the money axis
  // looks like with no tilt in it. Drawing them at an even three-plate mix
  // would show a colour no district can have.
  rampWeights: () => [0, 1, 0],
};

/**
 * F — SECTOR PLATES. The colour IS the donor mix.
 *
 * ordinal PASS at every mix, light and dark — the money axis is sound.
 *
 * THE MIX IS NOT READABLE FROM COLOUR AT ANY MONEY LEVEL, and that is F's
 * result rather than a defect to be tuned out. Corporate ↔ Trade ↔ Labor,
 * measured on the printed composite:
 *
 *     step   0     1     2     3     4     5
 *     normal 4.7   6.6   8.2  10.0  11.5  13.0     (floor 15, hard)
 *     CVD    1.7   2.4   3.0   3.7   4.2   4.6     (target 8, floor 6)
 *
 * The normal-vision floor is never cleared and the CVD floor is never
 * approached. Searching hue triples does not rescue it: the best available,
 * abandoning the semantic hues for blue/olive/magenta, reaches CVD 8.4 and
 * normal 13.7 — and only at the very top step. So the hues below are the
 * SEMANTIC ones rather than the marginally-better ones, because neither
 * passes and the semantic pair is at least honest about what it means.
 *
 * The cause is structural: an overprint is muted by the paper it sits on,
 * so three screens at a shared coverage produce three tones far closer
 * together than the three inks are. F's premise — read the mix off the
 * colour — is refuted by its own plates.
 */
export const F = {
  id: "f", name: "Sector Plates",
  paper: "#F5F3EE", paperDark: "#17171A",
  inks: B.inks, other: "#6B6B66", inksDark: B.inksDark,
  plates: { corporate: "#0B2D8B", trade: "#642100", labor: "#004528", other: "#383730" },
  platesDark: { corporate: "#9DBDFF", trade: "#FFA784", labor: "#61D89A", other: "#BEBCB3" },
  table: [0.35, 0.4729, 0.5854, 0.6939, 0.7903, 0.88],
  tableDark: [0.2875, 0.4126, 0.5378, 0.6603, 0.7749, 0.88],
  plateOrder: ["corporate", "trade", "labor", "other"],
  gray: ["other"],
  legible: [],
};

export const SYSTEMS = { a: A, b: B, c: C, d: D, e: E, f: F };
/*  Shared encoders                                                    */
/* ------------------------------------------------------------------ */

/** The ink for a sector, keyed to the fixed global order — never to what
 *  happens to be on screen. A filter that hides Labor must not repaint
 *  Corporate with Labor's ink. */
export function inkForSector(sys, sector, dark = false) {
  const i = SECTOR_ORDER.indexOf(sector);
  return i === -1 ? sys.other : (dark ? sys.inksDark : sys.inks)[i];
}

/** Break points for the density ramp, in CENTS.
 *
 *  Quantile breaks, not equal-interval: 2024 district dollars run
 *  -$9,350 to $3,497,975 with a median of $775,503, and equal intervals put
 *  four fifths of the country in one step. The negative floor is real —
 *  refunds can exceed receipts in a district — and it takes the bottom step
 *  rather than being clamped away. */
export const BREAKS_CENTS = [
  29_468_300, 46_565_200, 77_550_300, 127_558_000, 195_965_900,
];

export function densityStep(cents, ramp, breaks = BREAKS_CENTS) {
  let i = 0;
  while (i < breaks.length && cents > breaks[i]) i++;
  return ramp[Math.min(i, ramp.length - 1)];
}

/**
 * Which of the six steps a district falls in, as 0..1.
 *
 * `breaks` is a PARAMETER because round 2 runs on 2026 and the two cycles do
 * not share a distribution: 2024's median district took $775,503 and 2026's
 * has taken $608,524 so far. Measured, running 2026 through 2024's breaks
 * bins the 441 districts [74, 81, 128, 102, 41, 15] — the top two steps hold
 * 56 districts between them and the ramp stops encoding at exactly the end
 * that matters. `meta.breaks_cents` carries each cycle's own quantiles.
 *
 * The consequence, stated rather than hidden: the two cycles' colours are
 * NOT comparable to each other. Each map is a ranking within its own cycle.
 */
export function densityT(cents, breaks = BREAKS_CENTS) {
  let i = 0;
  while (i < breaks.length && cents > breaks[i]) i++;
  return i / breaks.length;
}

/**
 * 0..1 coverage for a halftone dot — what fraction of the cell the ink
 * covers. Same quantile scale the flat ramp steps through, so A and B show
 * the same numbers.
 *
 * Capped at 0.88 rather than 1.0, and that cap is load-bearing. At full
 * coverage the dots close up, the cell disappears, and the screen becomes a
 * flat solid — which means prototype B's certainty encoding silently stops
 * working on exactly the districts with the most money. Measured on the
 * first render: the entire top bucket printed solid and 173 coarse-screen
 * districts showed no screen at all where they mattered most.
 * 0.88 keeps structure visible at the top of the range. It is also truer to
 * the medium: a riso solid is rarely a true 100% lay-down.
 */
export const COVERAGE_FLOOR = 0.20, COVERAGE_CEIL = 0.88;

export function coverage(cents, breaks = BREAKS_CENTS) {
  const t = densityT(cents, breaks);               // 0 .. 1 across the six steps
  return COVERAGE_FLOOR + t * (COVERAGE_CEIL - COVERAGE_FLOOR);
}

/**
 * The per-plate ceiling for an N-plate page.
 *
 * COMPARISON.md records the 0.88 cap as "load-bearing, not taste": at full
 * coverage the dots close up, the cell disappears, and the certainty
 * encoding (screen frequency) silently stops working on exactly the
 * districts with the most money.
 *
 * Round 2 found that the cap was being applied to the WRONG QUANTITY, and
 * round 1 shipped with it defeated. `coverage()` caps the aggregate at 0.88,
 * but each prototype then splits that aggregate with a multiplier — B uses
 * `clamp(cov * 2)` — which pushes the FIRST PLATE to a coverage of exactly
 * 1.000 for the top three steps of six. Measured on B's own numbers:
 *
 *     step 0  cov 0.400 0.000   paper left 60.00%
 *     step 3  cov 1.000 0.216   paper left  0.00%
 *     step 5  cov 1.000 0.760   paper left  0.00%
 *
 * Half of B's range prints with no paper showing at all. It reads acceptably
 * only because the SECOND plate's dots sit on top of the solid first one, so
 * a screen is still visible — by luck, not by the cap.
 *
 * At three plates that luck runs out: three 0.88 screens at three angles
 * leave 0.17% of the cell as paper and the darkest districts print as flat
 * solids, which is correction #5 recurring exactly as written.
 *
 * So the cap moves to where it can actually hold — the COMPOSITE. Each plate
 * tops out at the coverage for which N overprinted screens leave the same
 * 12% of the cell as paper that a single 0.88 plate leaves:
 *
 *     (1 - c)^N = 1 - 0.88   →   c = 1 - 0.12^(1/N)
 *
 *     N = 2 → 0.654    N = 3 → 0.507    N = 4 → 0.412
 *
 * The darkest tone stays dark because the depth comes from the INK
 * overprinting subtractively, not from the dots closing up. Round 1's B is
 * deliberately left alone: it is the artifact the user already judged, and
 * re-inking it now would change the thing that was compared.
 */
export const PAPER_AT_MAX = 1 - COVERAGE_CEIL;          // 0.12
export const plateCeil = (n) => 1 - Math.pow(PAPER_AT_MAX, 1 / n);

/**
 * THE SPLIT, for every round-2 prototype.
 *
 * One function, because the sequential build and the proportional mix turned
 * out to be the same operation with different weights, and unifying them is
 * what finally made "TOTAL INK IS THE MONEY" true rather than nearly true.
 *
 * Ink does not add, it MULTIPLIES what the paper returns: N screens at
 * coverages c_i leave Π(1-c_i) of the cell showing. So give each plate
 *
 *     c_i = 1 - (1 - C)^(s_i)      s_i = w_i / Σw,  Σ s_i = 1
 *
 * and the composite leaves exactly (1-C) whatever the weights are. C is the
 * money and nothing else; the weights are the mix and change no total.
 *
 * `C` comes from the system's own step TABLE rather than from a linear
 * interpolation, because the steps are spaced to be equal in perceived
 * lightness — see the table comments.
 */
export function splitInk(C, weights) {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (sum <= 0) return weights.map(() => 0);
  const paper = 1 - C;
  return weights.map((w) => 1 - Math.pow(paper, Math.max(0, w) / sum));
}

/** Composite coverage for a money position, off the system's step table. */
export const coverageAt = (t, table) =>
  table[Math.max(0, Math.min(table.length - 1, Math.round(t * (table.length - 1))))];

/**
 * The weights for a SEQUENTIAL build — D.
 *
 * Plate 1 inks up across the bottom of the range, plate 2 lays on top across
 * the middle, plate 3 across the top, so the deep tones are an OVERPRINT of
 * all three and not a picked swatch. Cumulative, never a sliding window: a
 * window would take plate 1 back off at the top and the depth would go with
 * it.
 *
 * At the bottom only plate 1 has weight, so its coverage is exactly C — the
 * floor is a COMPOSITE floor like the ceiling, which is the whole of
 * correction #9. The old code applied the floor to a plate and the cap to
 * the composite, and a district at the bottom of the range printed 11.5% of
 * a cell where it was supposed to print 20%.
 */
export function seqWeights(t, n = 3) {
  const w = [];
  for (let i = 0; i < n; i++) w.push(Math.max(0, Math.min(1, t * n - i)));
  if (w.reduce((a, b) => a + b, 0) <= 0) w[0] = 1e-6;
  return w;
}

export function sequentialPlates(t, n = 3, table) {
  return splitInk(table ? coverageAt(t, table)
                        : COVERAGE_FLOOR + t * (COVERAGE_CEIL - COVERAGE_FLOOR),
                  seqWeights(t, n));
}

export function proportionalPlates(t, parts, table) {
  return splitInk(table ? coverageAt(t, table)
                        : COVERAGE_FLOOR + t * (COVERAGE_CEIL - COVERAGE_FLOOR),
                  parts);
}

/* ------------------------------------------------------------------ */
/*  The tone the plates actually print                                 */
/* ------------------------------------------------------------------ */

const hex2rgb01 = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255);
const rgb2hex01 = (c) => "#" + c.map((v) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
const ks1 = (r) => { r = Math.min(0.996, Math.max(0.004, r)); return (1 - r) * (1 - r) / (2 * r); };
const unks1 = (k) => 1 + k - Math.sqrt(k * k + 2 * k);

/**
 * The ONE colour a cell of halftone averages to — the same Kubelka-Munk (or,
 * on a dark ground, additive) model the shader runs, in JS.
 *
 * This exists because round 1 validated a ramp that was TYPED, not printed.
 * Prototype B's declared step 2 is #5d8069; its plates actually print
 * #248456 there, and in dark mode the declared top step #c8fed9 prints
 * #50b8c7. The legend was a picture of a different map. Every round-2 ramp
 * is derived through this function instead, so the swatch cannot drift from
 * the plate — and when it is checked, the map is what got checked.
 *
 * The average is over the 2^N combinations of which plates' dots are
 * present, weighted by coverage: the screens sit at different angles so
 * overlap is effectively independent, and the eye sums LIGHT, so the honest
 * average is of REFLECTANCE and not of the inks.
 */
export function plateTone(paperHex, inkHexes, covs, dark = false) {
  const paper = hex2rgb01(paperHex);
  const inks = inkHexes.map(hex2rgb01);
  const n = inks.length;
  const out = [0, 0, 0];
  for (let m = 0; m < (1 << n); m++) {
    let w = 1;
    for (let i = 0; i < n; i++) w *= ((m >> i) & 1) ? covs[i] : 1 - covs[i];
    if (w <= 1e-9) continue;
    let col;
    if (dark) {
      col = paper.slice();
      for (let i = 0; i < n; i++) if ((m >> i) & 1)
        for (let ch = 0; ch < 3; ch++) col[ch] += inks[i][ch] * 0.95;
    } else {
      const k = paper.map(ks1);
      for (let i = 0; i < n; i++) if ((m >> i) & 1) {
        const ki = inks[i].map(ks1);
        for (let ch = 0; ch < 3; ch++) k[ch] += ki[ch] * 1.35;
      }
      col = k.map(unks1);
    }
    for (let ch = 0; ch < 3; ch++) out[ch] += w * Math.min(1, Math.max(0, col[ch]));
  }
  return rgb2hex01(out);
}

/** The six swatches a legend draws — DERIVED from the plates, never typed. */
export function derivedRamp(sys, dark = false, weightsAt = null) {
  const table = dark ? sys.tableDark : sys.table;
  const plates = dark ? sys.platesDark : sys.plates;
  const inks = sys.plateOrder.map((k) => plates[k]);
  const paper = dark ? sys.paperDark : sys.paper;
  const n = inks.length;
  const w = weightsAt ?? sys.rampWeights
    ?? (sys.split ? (t) => sys.split(t, n) : () => inks.map(() => 1));
  return table.map((C, i) => plateTone(paper, inks, splitInk(C, w(i / (table.length - 1))), dark));
}

for (const sys of [D, E, F]) {
  sys.ramp = derivedRamp(sys, false);
  sys.rampDark = derivedRamp(sys, true);
}

export const usd = (cents, opts = {}) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency", currency: "USD",
    maximumFractionDigits: 0, ...opts,
  });

export const usdCompact = (cents) => {
  const d = cents / 100;
  const a = Math.abs(d);
  if (a >= 1e9) return `${d < 0 ? "−" : ""}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${d < 0 ? "−" : ""}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${d < 0 ? "−" : ""}$${(a / 1e3).toFixed(0)}K`;
  return `${d < 0 ? "−" : ""}$${a.toFixed(0)}`;
};
