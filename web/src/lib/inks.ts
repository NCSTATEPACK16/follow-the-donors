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
 * Re-run before changing anything. The validator is the dataviz skill's
 * `scripts/validate_palette.js` — it ships with the skill, not in this repo:
 *   node <dataviz>/scripts/validate_palette.js "<hexes>" --mode light \
 *        --surface "<paper>" --pairs all
 *   node <dataviz>/scripts/validate_palette.js "<ramp>"  --ordinal --surface "<paper>"
 * D's step tables are re-solved with solveTable() in ./solve.ts.
 *
 * Ported from web/prototypes/shared/inks.js — verbatim logic and comments,
 * typed for the app build.
 */

export type HexColor = string

export interface ScreenAngles {
  key: number
  color: number
  second: number
}

/** A riso ink system: the shared shape of A/B/C (round 1) and D/E/F (round 2).
 *  Not every system uses every field — C carries `key`/`keyDark` instead of
 *  `plates`; E and F carry `gray`/`legible`/`rampWeights`. Loosely typed on
 *  purpose: this mirrors a JS object literal, not a discriminated union, and
 *  the plan is to port the prototype rather than redesign its data model. */
export interface System {
  id: string
  name: string
  paper: HexColor
  paperDark: HexColor
  inks: HexColor[]
  other: HexColor
  ramp: HexColor[]
  inksDark: HexColor[]
  rampDark: HexColor[]
  plates?: Record<string, HexColor>
  platesDark?: Record<string, HexColor>
  table?: number[]
  tableDark?: number[]
  plateOrder?: string[]
  split?: (t: number, n?: number) => number[]
  gray?: string[]
  legible?: number[]
  rampWeights?: (i: number) => number[]
  key?: HexColor
  keyDark?: HexColor
}

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
]
export const OTHER_LABEL = "Other"

/** Screen angles, degrees. Distinct per plate so overlapping halftones form a
 *  rosette instead of a moiré. Classic separation is 15/45/75. */
export const SCREEN_ANGLES: ScreenAngles = { key: 45, color: 15, second: 75 }

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
export const BOUNDARY_UNCERTAIN = new Set(["cd119_superseded"])
export const BOUNDARY_CONTESTED = new Set(["cd119_contested"])

export function certaintyClass(mapStatus: string): string {
  if (BOUNDARY_UNCERTAIN.has(mapStatus)) return "riso-offregister"
  if (BOUNDARY_CONTESTED.has(mapStatus)) return "riso-contested"
  return "riso-registered"
}

export const STATUS_LABEL: Record<string, string> = {
  cd119_current: "Current — this is the map that governs",
  cd119_superseded: "Superseded — a redraw is in effect and we cannot draw it",
  cd119_contested: "Contested — enacted then blocked; this map still governs",
  override_applied: "Override — geometry replaced from a named source",
}

/* ------------------------------------------------------------------ */
/*  A — BROADSIDE.  Political-poster riso on warm stock.              */
/* ------------------------------------------------------------------ */
export const A: System = {
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
}

/* ------------------------------------------------------------------ */
/*  B — PLATE.  Two drums, real halftone, green-forward.              */
/* ------------------------------------------------------------------ */
export const B: System = {
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
}

/* ------------------------------------------------------------------ */
/*  C — SPECIMEN.  Banknote engraving; categories by screen, not hue. */
/* ------------------------------------------------------------------ */
export const C: System = {
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
}

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
 * D — THREE-PLATE. Money only, extended tonal range — and, since 2026-09-24,
 * a WIDER HUE SWEEP.
 *
 * ordinal: monotone PASS · every adjacent gap >= 0.06 PASS · LIGHT-END
 * CONTRAST DELIBERATELY FAILED — surface #F5F3EE, pale end #c1ccae at
 * 1.51:1 against a 2:1 gate (dark stock: #4b341f at 1.54:1). See the
 * coverage floor below; this is a departure taken on the record.
 *
 * SINGLE HUE IS DELIBERATELY FAILED — and now by more. The three plates ARE
 * three hues, lightness alone carries the order, and hue rides along as a
 * secondary channel the way viridis does. The gate exists to stop a rainbow
 * where hue does the encoding; here it does not. Monotone L and the step gaps
 * — the checks that actually carry the ordering — pass unaided, with more
 * margin than before.
 *
 * WHY THE PLATES CHANGED. The user's note of 2026-09-24: the districts need
 * more colour and more readability. Measured, the old set's bottom three
 * steps sat within 8° of hue of each other (161/162/169) — three greens a
 * reader told apart by lightness alone — and neighbouring steps were only
 * ΔE 7.6 apart. The plates were re-searched (≈10k ink triples through the
 * solver in solve.ts) for the widest hue sweep that still clears every
 * ordering check, keeps each printed tone at chroma >= 0.04 (a three-ink
 * overprint of near-complements prints MUD, and most wide-sweep triples do),
 * and holds the pale end above 1.5:1. Measured on the printed composite, the
 * dataviz validator's units:
 *
 *                      old (green/teal/navy)    new
 *   LIGHT  plates      #0C8152 #1F769F #1D3681  #688e3b #096a74 #19007f
 *          hue sweep          66°                127°   khaki → indigo
 *          min adj ΔE          7.6                 9.1
 *          min adj CVD ΔE      6.7                 8.5   (clears the 8 target)
 *          min adj ΔL          0.073               0.089
 *          pale end            1.64:1              1.51:1
 *   DARK   plates      #3B895D #3F7D9A #3A518A  #a05b11 #2b7e75 #2773ee
 *          hue sweep          47°                138°   umber → ice blue
 *          min adj ΔE          7.0                 7.8
 *          min adj CVD ΔE      7.0                 7.1
 *          min adj ΔL          0.069               0.073
 *          dim end             1.67:1              1.54:1
 *
 * The one cost is the pale end, 0.13:1 darker on light stock. Requiring the
 * old 1.6:1 caps the sweep near 94°; 1.5:1 is the knee. It stays clear of
 * the 1.32:1 below which (see the floor note) the pale fill stops reading as
 * ink. Dark stock is SELECTED from its own search, not flipped: additive
 * light from an ochre, a teal and a blue reads as umber → sage → ice.
 *
 * The tables are SOLVED by solveTable() and inks.test.ts asserts they equal
 * its output, so a plate changed without a re-solve fails the build.
 */
export const D: System = {
  id: "d", name: "Three-Plate",
  paper: "#F5F3EE", paperDark: "#17171A",
  inks: B.inks, other: "#6B6B66", inksDark: B.inksDark,
  ramp: [], rampDark: [], // derived below, never typed — see derivedRamp()
  plates: { first: "#688e3b", second: "#096a74", third: "#19007f" },
  platesDark: { first: "#a05b11", second: "#2b7e75", third: "#2773ee" },
  // The composite coverage per money step. NOT linear: the steps are spaced
  // to be equal in PERCEIVED LIGHTNESS, which is the only spacing under
  // which six quantile classes read as six. Derived — floor and ceiling are
  // the only chosen numbers, and the four between them are solved for equal
  // printed lightness on the plate mix each step actually uses.
  //
  // THE FLOOR IS 0.34, LOWERED FROM 0.4625 (light) / 0.4375 (dark).
  //
  // Round 2 raised it to clear the validator's 2:1 light-end contrast gate,
  // which is written for a chart mark on a chart surface. A district is not
  // a bare mark: it carries a keyline, which is the heaviest thing on the
  // plate and is what answers "is this a district" — so the fill only has to
  // carry ORDER among six classes, and that is the adjacent-ΔL gate, not the
  // contrast one. Measured over the floor, on the shipped ink model:
  //
  //     floor   light-end vs paper   min adjacent ΔL (gate 0.06)
  //     0.20         1.32:1                 0.086
  //     0.34         1.64:1                 0.073
  //     0.40         1.81:1                 0.068
  //     0.4625       2.01:1                 0.061   <- what round 2 shipped
  //
  // (Those rows were measured on the round-2 plates. On the 2026-09-24
  // plates the 0.34 floor measures 1.51:1 and 0.089 — see the header.)
  //
  // The two ends are in direct conflict (COMPARISON.md §10: 2:1 is
  // unreachable below c ≈ 0.53 against this paper whatever the ink), so this
  // is a choice about which gate the map is judged by, not a bug to fix.
  // 0.34 buys 20% more separation between the six money classes and is the
  // floor E and F already use, which stops D being the outlier. It is not
  // taken all the way to round 1's 0.20: at 1.32:1 the palest fill is a tint
  // no one would call ink, and the certainty screen — the coarse dots that
  // carry map vintage — stops being legible in it.
  //
  // Re-derive rather than retype if the floor moves again: the four middle
  // coverages are a solved consequence of it, and a hand-edited table drifts
  // away from the lightness spacing that is the whole point.
  table: [0.34, 0.5672, 0.7114, 0.802, 0.8343, 0.88],
  tableDark: [0.34, 0.5296, 0.6566, 0.7402, 0.8144, 0.88],
  plateOrder: ["first", "second", "third"],
  split: (t: number, n = 3) => seqWeights(t, n),
}

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
export const E: System = {
  id: "e", name: "Tilt",
  paper: "#F5F3EE", paperDark: "#17171A",
  inks: B.inks, other: "#6B6B66", inksDark: B.inksDark,
  ramp: [], rampDark: [],
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
}

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
export const F: System = {
  id: "f", name: "Sector Plates",
  paper: "#F5F3EE", paperDark: "#17171A",
  inks: B.inks, other: "#6B6B66", inksDark: B.inksDark,
  ramp: [], rampDark: [],
  plates: { corporate: "#0B2D8B", trade: "#642100", labor: "#004528", other: "#383730" },
  platesDark: { corporate: "#9DBDFF", trade: "#FFA784", labor: "#61D89A", other: "#BEBCB3" },
  table: [0.35, 0.4729, 0.5854, 0.6939, 0.7903, 0.88],
  tableDark: [0.2875, 0.4126, 0.5378, 0.6603, 0.7749, 0.88],
  plateOrder: ["corporate", "trade", "labor", "other"],
  gray: ["other"],
  legible: [],
}

/**
 * THE PARTY LAYER — which party holds the seat, and how much PAC money it
 * took. A LAYER, never merged into the money map.
 *
 * Four money steps, not six, and that is the whole finding. Round 2's E put
 * party in the hue and money in the lightness and measured it failing:
 * REP↔DEM separate by ΔE 6.5 at the bottom step against a hard floor of 15,
 * clearing it only at the top two (147 of 441 districts). The cause is
 * structural — lightness encodes money by putting LESS INK down, and less
 * ink is less hue (COMPARISON.md §12).
 *
 * What changed is not the palette but the constraint. E mixed REP, neutral
 * and DEM continuously, so its inks had to be iso-lightness AND its chroma
 * was capped at the most the money axis would take. An incumbent party is
 * CATEGORICAL: a district is pure red or pure blue and never a mixture. The
 * only constraint that survives is that the two ramps print at equal
 * lightness, so a red step 2 and a blue step 2 read as the same money.
 * Chroma is then free, and at four steps both gates clear:
 *
 *              worst normal ΔE   worst CVD ΔE   cross-step   min ΔL
 *     light         16.7             13.6          20.0       0.062
 *     dark          16.7             13.1          21.7       0.068
 *     gate          15               8             15         0.06
 *
 * Measured over 152 passing light pairs and 76 dark; NONE passed at five or
 * six steps (docs/superpowers/plans/2026-09-20-v1.1-legibility.md). The pair
 * below is not the top scorer — it is the top scorer that still reads as red
 * and blue rather than brick and violet.
 *
 * TWO TABLES ON PURPOSE. tableRep and tableDem differ (0.6089 vs 0.6228)
 * because that is what makes the printed lightness match. Collapsing them
 * into one puts party back into the money axis. inks.test.ts asserts it.
 *
 * DARK STOCK FAILS THE 2:1 LIGHT-END CONTRAST GATE at 1.35:1. Deliberate,
 * and the same departure D records: a district fill carries a keyline, so
 * the fill only has to carry ORDER among four classes. Raising the floor to
 * fix it spends the ΔL gate, which is the one that carries the money.
 *
 * NEUTRAL — a seat with no single major-party incumbent (none filed, several
 * because the lines moved, or a third-party member) prints the same four
 * money steps in gray, so it still shows its money and never claims a party
 * it does not have. It has its OWN tables, solved so each gray step prints
 * at exactly the red step's lightness — borrowing red's table left the dark
 * gray's steps at ΔL 0.059, under the gate — so its money reads on the same
 * scale as the two parties'.
 *
 * COLOUR ALONE CANNOT CARRY THIS THIRD CASE, measured 2026-09-25. Searching
 * every hue at the red/blue ramps' lightness, the best third ink reaches CVD
 * ΔE 6.3 against both (floor 8); a gray reaches 3.2 against red under
 * protanopia, because a desaturated red and a gray are the same colour to
 * that reader. Two iso-lightness inks already use up the one hue axis CVD
 * leaves. So the neutral districts carry SECONDARY ENCODING: a diagonal
 * hatch in the keyline ink over the fill (App.tsx drawLines), and the legend
 * shows it. That is the validator's own rule for a pair below the floor —
 * legal only with a second channel — applied rather than waived.
 */
export const PARTY = {
  inkRep: "#a80009", inkDem: "#0045c7", inkNeutral: "#4d4d4d",
  inkRepDark: "#d1000e", inkDemDark: "#0156ef", inkNeutralDark: "#6b6b6b",
  tableRep: [0.50, 0.6089, 0.7327, 0.88],
  tableDem: [0.50, 0.6228, 0.7468, 0.88],
  tableRepDark: [0.34, 0.5213, 0.6976, 0.88],
  tableDemDark: [0.34, 0.5202, 0.6937, 0.88],
  tableNeutral: [0.5364, 0.6431, 0.7498, 0.8471],
  tableNeutralDark: [0.2705, 0.4476, 0.6345, 0.8214],
  STEPS: 4,
} as const

export type PartyInk = "REP" | "DEM" | "NEUTRAL"

/** The ink and step table one party prints with, on one stock. */
export function partyPlate(party: PartyInk, dark: boolean): { ink: HexColor; table: readonly number[] } {
  if (party === "DEM") return dark
    ? { ink: PARTY.inkDemDark, table: PARTY.tableDemDark }
    : { ink: PARTY.inkDem, table: PARTY.tableDem }
  if (party === "REP") return dark
    ? { ink: PARTY.inkRepDark, table: PARTY.tableRepDark }
    : { ink: PARTY.inkRep, table: PARTY.tableRep }
  return dark
    ? { ink: PARTY.inkNeutralDark, table: PARTY.tableNeutralDark }
    : { ink: PARTY.inkNeutral, table: PARTY.tableNeutral }
}

/** The four printed tones for one party. Derived from the ink and the table
 *  the way D's ramp is derived — never typed, so the legend cannot drift
 *  away from the plate. */
export function partyRamp(party: PartyInk, dark: boolean): HexColor[] {
  const { ink, table } = partyPlate(party, dark)
  const paper = dark ? D.paperDark : D.paper
  return table.map((c) => plateTone(paper, [ink], [c], dark))
}

/** Which of the four party money steps a district's cents fall in. The six
 *  money quantile breaks fold pairwise-ish into four: step = floor(t*4). */
export function partyStep(cents: number, breaks: number[]): number {
  return Math.min(PARTY.STEPS - 1, Math.max(0, Math.floor(densityT(cents, breaks) * PARTY.STEPS)))
}

/** Which ink a district's incumbent_party prints in. Anything that is not a
 *  single named party is NEUTRAL — "none" and "several" are facts, not gaps. */
export function partyInkOf(incumbent: unknown): PartyInk {
  return incumbent === "REP" ? "REP" : incumbent === "DEM" ? "DEM" : "NEUTRAL"
}

export const SYSTEMS: Record<string, System> = { a: A, b: B, c: C, d: D, e: E, f: F }
/* ------------------------------------------------------------------ */
/*  Shared encoders                                                    */
/* ------------------------------------------------------------------ */

/** The ink for a sector, keyed to the fixed global order — never to what
 *  happens to be on screen. A filter that hides Labor must not repaint
 *  Corporate with Labor's ink. */
export function inkForSector(sys: System, sector: string, dark = false): HexColor {
  const i = SECTOR_ORDER.indexOf(sector)
  return i === -1 ? sys.other : (dark ? sys.inksDark : sys.inks)[i]
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
]

export function densityStep(cents: number, ramp: HexColor[], breaks = BREAKS_CENTS): HexColor {
  let i = 0
  while (i < breaks.length && cents > breaks[i]) i++
  return ramp[Math.min(i, ramp.length - 1)]
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
export function densityT(cents: number, breaks = BREAKS_CENTS): number {
  let i = 0
  while (i < breaks.length && cents > breaks[i]) i++
  return i / breaks.length
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
export const COVERAGE_FLOOR = 0.20, COVERAGE_CEIL = 0.88

export function coverage(cents: number, breaks = BREAKS_CENTS): number {
  const t = densityT(cents, breaks)               // 0 .. 1 across the six steps
  return COVERAGE_FLOOR + t * (COVERAGE_CEIL - COVERAGE_FLOOR)
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
export const PAPER_AT_MAX = 1 - COVERAGE_CEIL          // 0.12
export const plateCeil = (n: number) => 1 - Math.pow(PAPER_AT_MAX, 1 / n)

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
export function splitInk(C: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0)
  if (sum <= 0) return weights.map(() => 0)
  const paper = 1 - C
  return weights.map((w) => 1 - Math.pow(paper, Math.max(0, w) / sum))
}

/** Composite coverage for a money position, off the system's step table. */
export const coverageAt = (t: number, table: number[]): number =>
  table[Math.max(0, Math.min(table.length - 1, Math.round(t * (table.length - 1))))]

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
export function seqWeights(t: number, n = 3): number[] {
  const w: number[] = []
  for (let i = 0; i < n; i++) w.push(Math.max(0, Math.min(1, t * n - i)))
  if (w.reduce((a, b) => a + b, 0) <= 0) w[0] = 1e-6
  return w
}

export function sequentialPlates(t: number, n = 3, table?: number[]): number[] {
  return splitInk(table ? coverageAt(t, table)
                        : COVERAGE_FLOOR + t * (COVERAGE_CEIL - COVERAGE_FLOOR),
                  seqWeights(t, n))
}

export function proportionalPlates(t: number, parts: number[], table?: number[]): number[] {
  return splitInk(table ? coverageAt(t, table)
                        : COVERAGE_FLOOR + t * (COVERAGE_CEIL - COVERAGE_FLOOR),
                  parts)
}

/* ------------------------------------------------------------------ */
/*  The tone the plates actually print                                 */
/* ------------------------------------------------------------------ */

const hex2rgb01 = (h: HexColor): number[] => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255)
const rgb2hex01 = (c: number[]): HexColor => "#" + c.map((v) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")
const ks1 = (r: number): number => { r = Math.min(0.996, Math.max(0.004, r)); return (1 - r) * (1 - r) / (2 * r) }
const unks1 = (k: number): number => 1 + k - Math.sqrt(k * k + 2 * k)

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
export function plateTone(paperHex: HexColor, inkHexes: HexColor[], covs: number[], dark = false): HexColor {
  const paper = hex2rgb01(paperHex)
  const inks = inkHexes.map(hex2rgb01)
  const n = inks.length
  const out = [0, 0, 0]
  for (let m = 0; m < (1 << n); m++) {
    let w = 1
    for (let i = 0; i < n; i++) w *= ((m >> i) & 1) ? covs[i] : 1 - covs[i]
    if (w <= 1e-9) continue
    let col: number[]
    if (dark) {
      col = paper.slice()
      for (let i = 0; i < n; i++) if ((m >> i) & 1)
        for (let ch = 0; ch < 3; ch++) col[ch] += inks[i][ch] * 0.95
    } else {
      const k = paper.map(ks1)
      for (let i = 0; i < n; i++) if ((m >> i) & 1) {
        const ki = inks[i].map(ks1)
        for (let ch = 0; ch < 3; ch++) k[ch] += ki[ch] * 1.35
      }
      col = k.map(unks1)
    }
    for (let ch = 0; ch < 3; ch++) out[ch] += w * Math.min(1, Math.max(0, col[ch]))
  }
  return rgb2hex01(out)
}

/** The six swatches a legend draws — DERIVED from the plates, never typed. */
export function derivedRamp(sys: System, dark = false, weightsAt?: (i: number) => number[]): HexColor[] {
  const table = (dark ? sys.tableDark : sys.table)!
  const plates = (dark ? sys.platesDark : sys.plates)!
  const inks = sys.plateOrder!.map((k) => plates[k])
  const paper = dark ? sys.paperDark : sys.paper
  const n = inks.length
  const w = weightsAt ?? sys.rampWeights
    ?? (sys.split ? (t: number) => sys.split!(t, n) : () => inks.map(() => 1))
  return table.map((C, i) => plateTone(paper, inks, splitInk(C, w(i / (table.length - 1))), dark))
}

for (const sys of [D, E, F]) {
  sys.ramp = derivedRamp(sys, false)
  sys.rampDark = derivedRamp(sys, true)
}

export const usd = (cents: number, opts: Intl.NumberFormatOptions = {}): string =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency", currency: "USD",
    maximumFractionDigits: 0, ...opts,
  })

export const usdCompact = (cents: number): string => {
  const d = cents / 100
  const a = Math.abs(d)
  if (a >= 1e9) return `${d < 0 ? "−" : ""}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${d < 0 ? "−" : ""}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${d < 0 ? "−" : ""}$${(a / 1e3).toFixed(0)}K`
  return `${d < 0 ? "−" : ""}$${a.toFixed(0)}`
}
