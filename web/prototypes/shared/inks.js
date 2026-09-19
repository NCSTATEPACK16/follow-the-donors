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

export const SYSTEMS = { a: A, b: B, c: C };

/* ------------------------------------------------------------------ */
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

export function densityStep(cents, ramp) {
  let i = 0;
  while (i < BREAKS_CENTS.length && cents > BREAKS_CENTS[i]) i++;
  return ramp[Math.min(i, ramp.length - 1)];
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
const COVERAGE_FLOOR = 0.20, COVERAGE_CEIL = 0.88;

export function coverage(cents) {
  let i = 0;
  while (i < BREAKS_CENTS.length && cents > BREAKS_CENTS[i]) i++;
  const t = i / BREAKS_CENTS.length;              // 0 .. 1 across the six steps
  return COVERAGE_FLOOR + t * (COVERAGE_CEIL - COVERAGE_FLOOR);
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
