/**
 * The press. One WebGL2 halftone engine, shared by D, E and F.
 *
 * Round 1's prototype B hard-coded two plates into one page. Round 2 needs
 * three pages with two, three and four plates, two view scales and three
 * motion states, so the shader moved here. The three prototypes now differ in
 * exactly one thing — HOW A DISTRICT'S MONEY IS SPLIT ACROSS THE PLATES —
 * which is the comparison round 2 is actually running:
 *
 *   D  three plates, split sequentially:  a deeper tone is a later plate.
 *   E  three plates, split by tilt:       REP / neutral / DEM, ink total = money.
 *   F  four plates, split by sector:      the colour IS the donor mix.
 *
 * Everything else — the screen, the overprint, the motion, the two colour
 * models — is identical, so a reader comparing the three is comparing the
 * encoding and not the renderer.
 *
 * ---------------------------------------------------------------------------
 * THE SCREEN IS A PROPERTY OF THE PLATE, NOT OF THE DATA.
 *
 * A blow-up is a NEW PLATE, re-screened. That is what a print shop does and
 * it is why round 2 has no free zoom: national and state are two separate
 * renders at two different rulings, with a transition between them. The
 * national plate runs ~3.6px cells (fine — districts are small); the state
 * plate runs ~8px (coarse — the dots become visibly dots). `setCellScale()`
 * is that change, and because it scales EVERY cell by the same factor the
 * certainty ratios survive it: a superseded district is still 2.33x coarser
 * than a current one at either scale.
 *
 * ---------------------------------------------------------------------------
 * SCREEN ANGLES ARE GLOBAL AND NEVER PER-DISTRICT.
 *
 * Per-district angles are exactly what makes two adjacent polygons vibrate
 * against each other. One angle per PLATE, the same angle everywhere on the
 * sheet. The keyline stays the heaviest mark.
 *
 * REGISTRATION, ON THE OTHER HAND, IS PER-DISTRICT (2026-09-24). Until then
 * one drift vector per plate moved the whole sheet as one piece. Now each
 * district carries a phase, and its plates wander a fraction of a pixel off
 * the global drift on that phase — each district settles like its own
 * impression rather than the sheet sliding together. Only OFFSET varies per
 * district, never angle or ruling, so it cannot make moiré (the interference
 * between two screens depends on relative angle and ruling, not offset).
 *
 * Ported from web/prototypes/shared/plate.js — verbatim shader and motion
 * logic, typed for the app build.
 */

import earcut from "earcut"

/* Per-vertex payload: x, y, cov0..cov3, cell, phase. Four coverage slots
   always, even for a three-plate page — an unused slot is a zero and costs
   one multiply, where a per-prototype vertex format would cost a second
   shader. `phase` is the district's own registration phase, 0..1. */
export const MAX_PLATES = 4
export const STRIDE_FLOATS = 2 + MAX_PLATES + 1 + 1   // 8
export const STRIDE_BYTES = STRIDE_FLOATS * 4         // 32

const VERT = `#version 300 es
in vec2 aPos; in vec4 aCov; in float aCell; in float aPhase;
uniform vec2 uRes;
uniform vec3 uView;
out vec4 vCov; out float vCell; out float vPhase;
void main() {
  vCov = aCov; vCell = aCell; vPhase = aPhase;
  vec2 c = ((aPos * uView.x + uView.yz) / uRes) * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`

/**
 * THE RISO TEXTURE (2026-09-27), three effects, all FIXED TO THE SHEET —
 * none of them moves, so reduced motion is untouched by any of them.
 *
 * MISREGISTRATION. Each drum lays its whole plate a hair off the others, so
 * a district's inks do not quite sit inside its keyline: a thin fringe of
 * one ink shows along one edge. The breathing drift and per-district wander
 * cannot show this — they slide the SCREEN inside a fixed polygon, which
 * the eye cannot see — so each plate is now drawn in its own pass with its
 * GEOMETRY offset (see the multi-pass renderer below). Plate 0 is the key
 * and holds register; the others sit ~1px off in different directions.
 * CSS px, and constant across zoom: a press's error is on the paper, not in
 * the screen ruling.
 *
 * GRAIN SCREEN and PAPER TOOTH: see plate() and tooth() in the shader.
 */
export const MISREGISTRATION: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.85, -0.55], [-0.6, 0.8], [0.45, 0.45],
]
/** How far toward a stochastic screen a light tint goes (0 = clean dots). */
export const GRAIN_MIX = 0.6
/** How much of a plate's ink the paper's deepest tooth refuses. */
export const SKIP = 0.28
/** The cell (CSS px, after the view's screen scale) at which BREATH_AMP and
 *  PHASE_AMP are the literal amplitudes: the national current-map ruling,
 *  3.6px × GRAIN 0.7. Every other ruling scales its motion by cell / this. */
export const MOTION_REF_CELL = 2.52

/* Shared by the single-pass fallback and the per-plate pass: the dot,
   the grain, the wander, and the two colour models' per-ink terms. */
const SHARED = `
/* Fixed-to-the-sheet noise: the paper's tooth, and the grain screen's
   thresholds. Hash, not a texture, so there is nothing to load. */
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
/* PAPER TOOTH, 0..1, in CSS px so it keeps its size on any screen: a coarse
   fibre field and a fine one. Uncoated riso stock has tooth, and where it
   dips the drum's ink does not reach — see SKIP in the pass shader. */
float tooth(vec2 frag) {
  vec2 p = frag / uDpr;
  return 0.6 * vnoise(p / 1.7) + 0.4 * vnoise(p / 0.6 + 17.0);
}
const float GRAIN_MIX = ${GRAIN_MIX.toFixed(2)};
const float MOTION_REF_CELL = ${MOTION_REF_CELL.toFixed(3)};

/* This district's own wander for plate i, in CSS px.
 *
 * The phase has to modulate TIME. A phase that only picks a fixed offset
 * (the v1.1 plan's first draft) gives every district a different resting
 * place and then moves them all in unison with the global drift — the sheet
 * still slides as one piece. Here each district runs its own clock.
 *
 * Periods differ per plate, so a district's three plates also breathe
 * against EACH OTHER — which is the actual riso look: registration error
 * between the drums, visible as colour fringing inside the keyline. The
 * y phase is scaled by the golden ratio so x and y never lock together
 * and the path is a slow Lissajous rather than a circle. At uPhaseAmp 0
 * this is exactly zero, which is what reduced motion asks for. */
vec2 wander(int i) {
  float fi = float(i);
  float ph = 6.2831853 * vPhase;
  vec2 per = vec2(4.7 + fi * 1.3, 6.1 + fi * 0.9);
  return uPhaseAmp * vec2(
    sin(6.2831853 * uTime / per.x + ph),
    cos(6.2831853 * uTime / per.y + ph * 1.618));
}

/* One halftone plate.
 *
 * The screen lives in SCREEN space, not map space — that is what makes this
 * a print rather than a texture painted onto the data. Two details are
 * load-bearing and were both bugs first:
 *
 *  - antialiasing is the true gradient magnitude, not fwidth(). fwidth is
 *    |dFdx| + |dFdy| and is noticeably anisotropic on the diagonals, which
 *    is precisely where these rosettes sit.
 *  - 'drift' is added to the fragment coordinate BEFORE the rotation, so the
 *    plate slides relative to the paper the way a real plate does, rather
 *    than the screen shearing inside a stationary plate.
 */
float plate(vec2 frag, float angle, float cellPx, float cov, vec2 drift, float gain, float seed) {
  if (cov <= 0.0) return 0.0;
  float s = sin(angle), c = cos(angle);
  /* Motion is measured in DOTS, not pixels (2026-09-27). The drift and
     wander amplitudes are tuned at the finest ruling, MOTION_REF_CELL; a
     plate screened coarser moves proportionally further, so a 13px dot
     wanders as visibly as a 2.5px one. A fixed 0.4px on a 13px dot is 3% of
     a cell — the state blow-up read as a still picture. */
  vec2 r = mat2(c, -s, s, c) * (frag + drift * uDpr * (cellPx * uCellScale / MOTION_REF_CELL));
  vec2 cell = fract(r / (cellPx * uCellScale * uDpr)) - 0.5;
  float d = length(cell);
  /* Dot AREA scales with coverage, so perceived tone tracks the number —
     and getting that right means inverting the AREA, not the diagonal.

     The cell here is one unit square, so a dot of radius r inks pi*r^2 of
     it and the radius that inks cov is sqrt(cov/pi). The old line used
     sqrt(cov)*0.707, the half-DIAGONAL, which is the radius at which a dot
     covers the whole cell rather than the radius at which it covers cov.
     Measured, that laid down pi/2 = 1.57x the ink asked for at the low end
     and closed 99.2% of the cell at the 0.88 cap — so correction #5, the
     cap that keeps the certainty screen alive on the richest districts,
     was defeated inside the shader in both rounds. Every map read bulky
     and nearly solid because it was.

     Above cov = pi/4 the dot runs past the cell edges and the corners
     start clipping, so the very top of the range under-inks slightly:
     0.853 at the 0.88 cap rather than 0.88. That is the safe direction —
     it leaves MORE paper, not less — and it is the only part of the range
     where area and coverage are not equal.

     'gain' is the reduced-motion dot-gain pulse — a swell in radius with no
     spatial movement anywhere on the page. */
  float radius = sqrt(cov / 3.14159265) * gain;
  float aa = length(vec2(dFdx(d), dFdy(d)));
  float am = 1.0 - smoothstep(radius - aa, radius + aa, d);
  /* THE GRAIN SCREEN (2026-09-27). A riso master is burned by a thermal
     head, and at a light tint its dots break up into grain rather than
     printing as clean circles. Below ~45% coverage the round dot is blended
     toward a stochastic screen: each ~0.8px grain inks where a fixed hash
     falls under the coverage, so the MEAN ink is still exactly cov (the
     hash is uniform on 0..1) and the tone the solver set is kept. Fixed to
     the sheet — the grain never moves, whatever the motion setting. */
  float w = GRAIN_MIX * (1.0 - smoothstep(0.10, 0.45, cov));
  if (w > 0.0) {
    float n = hash21(floor(frag / (uDpr * 0.8)) + seed * 37.0);
    am = mix(am, step(n, cov * gain), w);
  }
  return am;
}

/* Kubelka-Munk, single constant, per channel.
   K/S = (1-R)^2 / 2R  and its inverse  R = 1 + k - sqrt(k*k + 2k).
   Absorption adds LINEARLY with ink concentration, which is why two
   translucent inks give a deep, slightly warm third colour instead of the
   dead grey that a naive RGB multiply produces. */
vec3 ks(vec3 r) { r = clamp(r, 0.004, 0.996); return (1.0 - r) * (1.0 - r) / (2.0 * r); }
vec3 unks(vec3 k) { return 1.0 + k - sqrt(k * k + 2.0 * k); }

`

const FRAG = `#version 300 es
precision highp float;
uniform vec3 uPaper;
uniform vec3 uInk[${MAX_PLATES}];
uniform float uAng[${MAX_PLATES}];
uniform vec2 uDrift[${MAX_PLATES}];
uniform float uLay[${MAX_PLATES}];
uniform float uDpr, uDark, uCellScale, uGain, uNPlates;
uniform float uTime, uPhaseAmp;
in vec4 vCov; in float vCell; in float vPhase;
out vec4 outColor;
${SHARED}
void main() {
  vec2 frag = gl_FragCoord.xy;
  float cov[${MAX_PLATES}];
  cov[0] = vCov.x; cov[1] = vCov.y; cov[2] = vCov.z; cov[3] = vCov.w;

  /* Kubelka-Munk HAS NO DARK MODE, and that is a fact about the medium
     rather than a bug to route around. Subtractive ink math assumes a
     REFLECTIVE substrate: ink removes light the paper would have returned.
     On a dark ground there is nothing to remove, so every overprint
     collapses to black — which is exactly what the first dark render of
     round 1's prototype B did.

     So dark mode composites ADDITIVELY and says so. It is no longer a
     simulation of ink on paper; it is a simulation of light through a
     screen, which is what a dark UI actually is. The dark inks are
     SELECTED and separately validated, never an inversion of the light set.
     This is a permanent two-model split, not a branch to be unified later. */
  vec3 col;
  if (uDark > 0.5) {
    col = uPaper;
    for (int i = 0; i < ${MAX_PLATES}; i++) {
      if (float(i) >= uNPlates) break;
      float a = plate(frag, uAng[i], vCell, cov[i] * uLay[i], uDrift[i] + wander(i), uGain, float(i));
      col += a * uInk[i] * 0.95;
    }
  } else {
    vec3 k = ks(uPaper);
    for (int i = 0; i < ${MAX_PLATES}; i++) {
      if (float(i) >= uNPlates) break;
      float a = plate(frag, uAng[i], vCell, cov[i] * uLay[i], uDrift[i] + wander(i), uGain, float(i));
      k += a * ks(uInk[i]) * 1.35;
    }
    col = unks(k);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

/* ------------------------------------------------------------------ */
/*  The multi-pass press: one pass per plate, then a composite         */
/* ------------------------------------------------------------------ */

/* Each plate is drawn on its own with its geometry offset by uOff, into a
   float buffer that SUMS what the plates contribute. Both colour models are
   linear in that sum — Kubelka-Munk absorption (K/S) adds per ink, and on
   the dark stock light adds — so summing per plate and resolving once is
   exactly the single-pass result with the plates allowed out of register. */
const PASS_VERT = `#version 300 es
in vec2 aPos; in vec4 aCov; in float aCell; in float aPhase;
uniform vec2 uRes, uOff;
uniform vec3 uView;
uniform highp int uPlate;
out float vCovP; out float vCell; out float vPhase;
void main() {
  vCovP = aCov[uPlate]; vCell = aCell; vPhase = aPhase;
  vec2 c = ((aPos * uView.x + uView.yz + uOff) / uRes) * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`

const PASS_FRAG = `#version 300 es
precision highp float;
uniform vec3 uPaper;
uniform vec3 uInk[${MAX_PLATES}];
uniform float uAng[${MAX_PLATES}];
uniform vec2 uDrift[${MAX_PLATES}];
uniform float uLay[${MAX_PLATES}];
uniform float uDpr, uDark, uCellScale, uGain, uNPlates;
uniform float uTime, uPhaseAmp;
uniform highp int uPlate;
in float vCovP; in float vCell; in float vPhase;
out vec4 outColor;
${SHARED}
const float SKIP = ${SKIP.toFixed(2)};
void main() {
  vec2 frag = gl_FragCoord.xy;
  int i = uPlate;
  float a = plate(frag, uAng[i], vCell, vCovP * uLay[i], uDrift[i] + wander(i), uGain, float(i));
  a *= 1.0 - SKIP * smoothstep(0.62, 0.9, tooth(frag));
  vec3 w = uDark > 0.5 ? uInk[i] * 0.95 : ks(uInk[i]) * 1.35;
  outColor = vec4(a * w, 1.0);
}`

const COMP_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const COMP_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uAcc;
uniform vec3 uPaper;
uniform float uDpr, uDark;
out vec4 outColor;
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 ks(vec3 r) { r = clamp(r, 0.004, 0.996); return (1.0 - r) * (1.0 - r) / (2.0 * r); }
vec3 unks(vec3 k) { return 1.0 + k - sqrt(k * k + 2.0 * k); }
void main() {
  vec2 frag = gl_FragCoord.xy, p = frag / uDpr;
  vec3 acc = texelFetch(uAcc, ivec2(frag), 0).rgb;
  /* PAPER GRAIN: the stock itself is not flat. A fine tooth plus long,
     faint fibres running with the grain of the sheet. Small — about 2.5% of
     the paper's reflectance — so it reads as stock, not as a pattern. */
  float g = 0.6 * vnoise(p / 1.7) + 0.4 * vnoise(p / 0.6 + 17.0);
  float fib = vnoise(vec2(p.x / 14.0, p.y / 0.9) + 5.0);
  float grain = (g - 0.5) * 0.05 + (fib - 0.5) * 0.02;
  vec3 col;
  if (uDark > 0.5) col = uPaper + grain * 0.35 + acc;
  else col = unks(ks(clamp(uPaper * (1.0 + grain), 0.0, 1.0)) + acc);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

export const hex2rgb = (h: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255) as [number, number, number]

/* ------------------------------------------------------------------ */
/*  Motion                                                             */
/* ------------------------------------------------------------------ */

/**
 * AMBIENT REGISTRATION BREATHING.
 *
 * A real press never registers perfectly, and the error wanders — paper
 * stretches with humidity, the drum runs a hair eccentric. So the most
 * authentic motion riso has is not a spin or a pulse, it is the plates
 * breathing a fraction of a millimetre against each other, forever.
 *
 * 0.42px peak at the finest ruling, and slow; the shader scales it by the
 * plate's own cell (MOTION_REF_CELL), so it is always ~1/6 of a dot — a fixed
 * pixel amount was invisible on the coarse state screens. The periods below are
 * mutually irrational-ish on purpose: if they shared a common multiple the
 * plates would resync every few seconds and the drift would read as a
 * throb rather than as a press.
 *
 * SCREEN ROTATION IS RULED OUT and this is the reason, not a preference:
 * creeping the halftone ANGLE over time manufactures a travelling moiré,
 * which the research paper correctly calls hostile to astigmatic and
 * motion-sensitive readers. Translating a plate cannot produce moiré,
 * because the interference pattern between two screens depends on their
 * relative angle and ruling and not on their offset.
 */
const BREATH_AMP = 0.42                       // CSS px, peak
const BREATH = [                               // seconds, per plate
  { x: 11.3, y: 8.7 }, { x: 9.1, y: 12.7 },
  { x: 13.9, y: 10.3 }, { x: 7.9, y: 14.9 },
]

function breathe(out: Float32Array, tSec: number, amount: number): Float32Array {
  for (let i = 0; i < MAX_PLATES; i++) {
    const b = BREATH[i]
    out[i * 2] = Math.sin((tSec / b.x) * Math.PI * 2) * BREATH_AMP * amount
    out[i * 2 + 1] = Math.cos((tSec / b.y) * Math.PI * 2) * BREATH_AMP * amount
  }
  return out
}

/**
 * PER-DISTRICT WANDER, peak CSS px. Smaller than the global breath on
 * purpose: the sheet still breathes as a press, and each district adds a
 * finer, faster settle on top — about a seventh of a cell at any ruling
 * (scaled in the shader like BREATH_AMP), enough to read as ink moving and
 * not as the map shaking. See wander() in FRAG.
 */
export const PHASE_AMP = 0.34

const PRESS_STAGGER = 0.22   // seconds between plates laying down
const PRESS_DUR = 0.62       // seconds for one plate to reach full ink
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)

/** Full press cycle length for n plates, seconds. */
export const pressDuration = (n: number): number => (n - 1) * PRESS_STAGGER + PRESS_DUR

/**
 * REDUCED MOTION: dot gain, and nothing spatial.
 *
 * The research paper's own suggestion, and the right one. Breathing goes off
 * entirely — no plate moves by any amount. The press one-shot becomes a
 * single dot-gain pulse: every halftone radius swells ~5% and settles, which
 * is what over-inking actually looks like. Something clearly HAPPENED and
 * nothing travelled across the retina.
 */
const GAIN_PEAK = 1.05, GAIN_DUR = 0.9

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
}

/* ------------------------------------------------------------------ */
/*  Renderer                                                           */
/* ------------------------------------------------------------------ */

export interface PressOptions {
  /** How many of the four slots this page uses. */
  nPlates?: number
  /** One screen angle (degrees) per plate — GLOBAL, never per-district. */
  angles?: number[]
  /** Optional callback after each draw. */
  onFrame?: () => void
}

export interface Press {
  gl: WebGL2RenderingContext
  resize(w: number, h: number, dpr: number): void
  setMesh(data: Float32Array, count: number): void
  setInks(hexes: string[]): void
  setAngles(deg: number[]): void
  setPaper(hex: string): void
  setDark(v: boolean): void
  setCellScale(v: number): void
  /** The hand zoom: geometry scaled by k and moved by (tx, ty) CSS px,
   *  applied in the vertex shader. The SCREEN is untouched — it lives in
   *  screen space — so zooming by hand grows the districts under a screen
   *  that holds its ruling. That is re-screening at every zoom level, not a
   *  camera enlarging the dots. */
  setView(k: number, tx: number, ty: number): void
  readonly view: number[]
  draw(): void
  nPlates: number
  readonly reducedMotion: boolean
  /** The per-view screen scale, read-only. Exposed because the state
   * blow-up's whole claim is that the plate is RE-SCREENED, and the
   * statebar says so in prose — a label reading "8px" over a plate still
   * screened at 3.6px is a lie the harness has to be able to catch. */
  readonly cellScale: number
  setBreathing(on: boolean): void
  /** How far each district's plates may wander off the global drift, CSS
   *  px. Zero whenever breathing is off or reduced motion is on — asserted
   *  by web/check.mjs on the uPhaseAmp uniform itself. */
  readonly phaseAmp: number
  readonly multipass: boolean
  readonly misregistration: number[][]
  press(): void
  stop(): void
}

export function createPress(canvas: HTMLCanvasElement, opts: PressOptions = {}): Press | null {
  const glOrNull = canvas.getContext("webgl2", { antialias: true, alpha: false })
  if (!glOrNull) return null
  // Re-bound to a non-nullable const: nested function declarations below
  // don't inherit the narrowing from the check above.
  const gl: WebGL2RenderingContext = glOrNull

  const sh = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed")
    }
    return s
  }
  const link = (vs: string, fs: string): WebGLProgram => {
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? "program link failed")
    }
    return p
  }
  const prog = link(VERT, FRAG)

  /* The multi-pass press needs a float render target to sum the plates in.
     Where the browser cannot give one, the single-pass shader draws the same
     inks, grain and tooth — everything but the out-of-register plates. */
  const multi = (() => {
    if (!gl.getExtension("EXT_color_buffer_float")) return null
    try {
      const pass = link(PASS_VERT, PASS_FRAG)
      const comp = link(COMP_VERT, COMP_FRAG)
      const tex = gl.createTexture()!
      const fbo = gl.createFramebuffer()!
      return { pass, comp, tex, fbo, w: 0, h: 0 }
    } catch (e) {
      console.warn("press: one-pass fallback —", (e as Error).message)
      return null
    }
  })()
  const multiLoc = multi && (() => {
    const P = (n: string) => gl.getUniformLocation(multi.pass, n)
    const C = (n: string) => gl.getUniformLocation(multi.comp, n)
    return {
      res: P("uRes"), view: P("uView"), off: P("uOff"), plate: P("uPlate"), dpr: P("uDpr"), paper: P("uPaper"),
      dark: P("uDark"), cellScale: P("uCellScale"), gain: P("uGain"), n: P("uNPlates"),
      ink: P("uInk"), ang: P("uAng"), drift: P("uDrift"), lay: P("uLay"),
      time: P("uTime"), phaseAmp: P("uPhaseAmp"),
      cAcc: C("uAcc"), cPaper: C("uPaper"), cDpr: C("uDpr"), cDark: C("uDark"),
    }
  })()

  /** Size the accumulation buffer to the canvas. Returns false (and the
   *  press falls back to one pass) if the driver will not render to it. */
  function sizeAcc(): boolean {
    if (!multi) return false
    if (multi.w === canvas.width && multi.h === canvas.height) return true
    gl.bindTexture(gl.TEXTURE_2D, multi.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, canvas.width, canvas.height, 0, gl.RGBA, gl.HALF_FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, multi.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, multi.tex, 0)
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    multi.w = canvas.width; multi.h = canvas.height
    return ok
  }
  const buf = gl.createBuffer()
  const U = (n: string) => gl.getUniformLocation(prog, n)
  const loc = {
    res: U("uRes"), view: U("uView"), dpr: U("uDpr"), paper: U("uPaper"), dark: U("uDark"),
    cellScale: U("uCellScale"), gain: U("uGain"), n: U("uNPlates"),
    ink: U("uInk"), ang: U("uAng"), drift: U("uDrift"), lay: U("uLay"),
    time: U("uTime"), phaseAmp: U("uPhaseAmp"),
  }

  const st = {
    w: 0, h: 0, dpr: 1,
    nPlates: opts.nPlates || 2,
    angles: new Float32Array(MAX_PLATES),
    inks: new Float32Array(MAX_PLATES * 3),
    drift: new Float32Array(MAX_PLATES * 2),
    lay: new Float32Array(MAX_PLATES).fill(1),
    paper: [1, 1, 1] as [number, number, number], dark: false,
    cellScale: 1, gain: 1, time: 0, phaseAmp: 0,
    view: new Float32Array([1, 0, 0]),
    mesh: null as Float32Array | null, count: 0,
    breathing: false, reduced: prefersReducedMotion(),
    pressT: -1, gainT: -1, raf: 0, t0: performance.now(),
  }
  setAngles(opts.angles || [45, 15, 75, 0])

  function setAngles(deg: number[]) {
    for (let i = 0; i < MAX_PLATES; i++) {
      st.angles[i] = (deg[i] ?? 0) * Math.PI / 180
    }
  }

  function setInks(hexes: string[]) {
    for (let i = 0; i < MAX_PLATES; i++) {
      const rgb = hexes[i] ? hex2rgb(hexes[i]) : [0, 0, 0]
      st.inks[i * 3] = rgb[0]
      st.inks[i * 3 + 1] = rgb[1]
      st.inks[i * 3 + 2] = rgb[2]
    }
  }

  function resize(w: number, h: number, dpr: number) {
    st.w = w; st.h = h; st.dpr = dpr
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
  }

  function setMesh(data: Float32Array, count: number) { st.mesh = data; st.count = count }
  function setPaper(hex: string) { st.paper = hex2rgb(hex) }
  function setDark(v: boolean) { st.dark = !!v }
  function setCellScale(v: number) { st.cellScale = v }
  function setView(k: number, tx: number, ty: number) { st.view[0] = k; st.view[1] = tx; st.view[2] = ty }

  function draw() {
    if (!st.mesh || !st.count) return
    if (multiLoc && sizeAcc()) { drawMulti(); return }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(st.paper[0], st.paper[1], st.paper[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, st.mesh, gl.STATIC_DRAW)

    const aPos = gl.getAttribLocation(prog, "aPos")
    const aCov = gl.getAttribLocation(prog, "aCov")
    const aCell = gl.getAttribLocation(prog, "aCell")
    const aPhase = gl.getAttribLocation(prog, "aPhase")
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE_BYTES, 0)
    gl.enableVertexAttribArray(aCov)
    gl.vertexAttribPointer(aCov, 4, gl.FLOAT, false, STRIDE_BYTES, 8)
    gl.enableVertexAttribArray(aCell)
    gl.vertexAttribPointer(aCell, 1, gl.FLOAT, false, STRIDE_BYTES, 24)
    gl.enableVertexAttribArray(aPhase)
    gl.vertexAttribPointer(aPhase, 1, gl.FLOAT, false, STRIDE_BYTES, 28)

    gl.uniform2f(loc.res, st.w, st.h)
    gl.uniform3fv(loc.view, st.view)
    gl.uniform1f(loc.dpr, st.dpr)
    gl.uniform3fv(loc.paper, st.paper)
    gl.uniform1f(loc.dark, st.dark ? 1 : 0)
    gl.uniform1f(loc.cellScale, st.cellScale)
    gl.uniform1f(loc.gain, st.gain)
    gl.uniform1f(loc.n, st.nPlates)
    gl.uniform3fv(loc.ink, st.inks)
    gl.uniform1fv(loc.ang, st.angles)
    gl.uniform2fv(loc.drift, st.drift)
    gl.uniform1fv(loc.lay, st.lay)
    gl.uniform1f(loc.time, st.time)
    gl.uniform1f(loc.phaseAmp, st.phaseAmp)
    gl.drawArrays(gl.TRIANGLES, 0, st.count)
    if (opts.onFrame) opts.onFrame()
  }

  function bindMesh(p: WebGLProgram) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, st.mesh!, gl.STATIC_DRAW)
    const at = (n: string, size: number, off: number) => {
      const a = gl.getAttribLocation(p, n)
      if (a < 0) return
      gl.enableVertexAttribArray(a)
      gl.vertexAttribPointer(a, size, gl.FLOAT, false, STRIDE_BYTES, off)
    }
    at("aPos", 2, 0); at("aCov", 4, 8); at("aCell", 1, 24); at("aPhase", 1, 28)
  }

  /** One pass per plate, each out of register by MISREGISTRATION[i], summed
   *  into the float buffer; then one composite pass resolves the sum on the
   *  paper. Uniforms go up once per frame, as in the single pass, so the
   *  harness's per-frame drift and wander counts mean the same thing. */
  function drawMulti() {
    const m = multi!, L = multiLoc!
    gl.bindFramebuffer(gl.FRAMEBUFFER, m.fbo)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(m.pass)
    bindMesh(m.pass)
    gl.uniform2f(L.res, st.w, st.h)
    gl.uniform3fv(L.view, st.view)
    gl.uniform1f(L.dpr, st.dpr)
    gl.uniform3fv(L.paper, st.paper)
    gl.uniform1f(L.dark, st.dark ? 1 : 0)
    gl.uniform1f(L.cellScale, st.cellScale)
    gl.uniform1f(L.gain, st.gain)
    gl.uniform1f(L.n, st.nPlates)
    gl.uniform3fv(L.ink, st.inks)
    gl.uniform1fv(L.ang, st.angles)
    gl.uniform2fv(L.drift, st.drift)
    gl.uniform1fv(L.lay, st.lay)
    gl.uniform1f(L.time, st.time)
    gl.uniform1f(L.phaseAmp, st.phaseAmp)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE)
    for (let i = 0; i < st.nPlates; i++) {
      gl.uniform1i(L.plate, i)
      gl.uniform2f(L.off, MISREGISTRATION[i][0], MISREGISTRATION[i][1])
      gl.drawArrays(gl.TRIANGLES, 0, st.count)
    }
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(m.comp)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, m.tex)
    gl.uniform1i(L.cAcc, 0)
    gl.uniform3fv(L.cPaper, st.paper)
    gl.uniform1f(L.cDpr, st.dpr)
    gl.uniform1f(L.cDark, st.dark ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    if (opts.onFrame) opts.onFrame()
  }

  /** One frame of whatever motion is currently live. Returns true if more
   *  frames are needed. */
  function tick(nowMs: number): boolean {
    const t = (nowMs - st.t0) / 1000
    let more = false

    if (st.pressT >= 0) {
      // Plates lay down in sequence, as a press lays them.
      const e = t - st.pressT
      const total = pressDuration(st.nPlates)
      for (let i = 0; i < MAX_PLATES; i++) {
        const local = (e - i * PRESS_STAGGER) / PRESS_DUR
        st.lay[i] = local <= 0 ? 0 : local >= 1 ? 1 : easeOut(local)
      }
      if (e >= total) { st.pressT = -1; st.lay.fill(1) } else more = true
    }

    if (st.gainT >= 0) {
      // Reduced motion: one non-spatial swell, then settle.
      const e = (t - st.gainT) / GAIN_DUR
      if (e >= 1) { st.gainT = -1; st.gain = 1 }
      else { st.gain = 1 + (GAIN_PEAK - 1) * Math.sin(e * Math.PI); more = true }
    }

    if (st.breathing && !st.reduced) {
      breathe(st.drift, t, 1)
      // Wrapped so a tab left open for days keeps full float precision in
      // the shader's sin(); 3600s is a common multiple of nothing, and the
      // one-frame jump at the wrap is under the wander amplitude.
      st.time = t % 3600
      st.phaseAmp = PHASE_AMP
      more = true
    } else { st.drift.fill(0); st.phaseAmp = 0 }

    draw()
    return more
  }

  function loop() {
    st.raf = 0
    if (tick(performance.now())) st.raf = requestAnimationFrame(loop)
  }
  function kick() { if (!st.raf) st.raf = requestAnimationFrame(loop) }

  return {
    gl, resize, setMesh, setInks, setAngles, setPaper, setDark, setCellScale, setView,
    draw,
    get view() { return [st.view[0], st.view[1], st.view[2]] },
    get nPlates() { return st.nPlates },
    set nPlates(v: number) { st.nPlates = v },
    get reducedMotion() { return st.reduced },

    get cellScale() { return st.cellScale },
    get phaseAmp() { return st.phaseAmp },
    /** True when the plates are drawn one pass each, out of register. */
    get multipass() { return !!multiLoc && multi!.w > 0 },
    /** Each plate's fixed registration error, CSS px — constant, so it is
     *  not motion and holds under reduced motion. */
    get misregistration() { return MISREGISTRATION.slice(0, st.nPlates).map((v) => [...v]) },
    set reducedMotion(v: boolean) { st.reduced = !!v; if (!v) kick(); else draw() },

    /** Ambient breathing on/off. Ignored under reduced motion. */
    setBreathing(on: boolean) {
      st.breathing = !!on
      if (on && !st.reduced) kick(); else { st.drift.fill(0); st.phaseAmp = 0; draw() }
    },

    /**
     * The one-shot on entering a state blow-up. Under reduced motion this is
     * a dot-gain pulse instead of a sequence — the plates are already down
     * and nothing moves.
     */
    press() {
      const t = (performance.now() - st.t0) / 1000
      if (st.reduced) { st.gainT = t; st.lay.fill(1) }
      else { st.pressT = t; st.lay.fill(0) }
      kick()
    },

    stop() { if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0 },
  } as Press
}

/* ------------------------------------------------------------------ */
/*  Mesh                                                               */
/* ------------------------------------------------------------------ */

export interface GeoFeature {
  properties: Record<string, unknown>
  geometry: {
    type: string
    coordinates: number[][][] | number[][][][]
  }
}

export type Projection = (coord: number[]) => [number, number] | null
export type PlateEncoder = (props: Record<string, unknown>) => { cov: number[]; cell: number }

/**
 * Triangulate into the 8-float interleaved format the press expects.
 *
 * Done ONCE per layout, never per frame. Earcut-ing 441 gerrymandered
 * polygons on the main thread every frame would blow the mobile budget —
 * but that is an argument against doing it per frame, not against doing it
 * at all. At a fixed view the mesh is static, the motion lives entirely in
 * uniforms, and the shader does the rest.
 *
 * `encode(props)` returns { cov: [c0..cn], cell } — cov is the split across
 * plates and is the ONLY thing that differs between D, E and F.
 */
/**
 * A stable registration phase in [0,1) for one district.
 *
 * Hashed from the district's own identity (geoid, or the state for the
 * Senate layer), never from its index: the index changes with every
 * re-layout, theme change and state blow-up, and the whole map would
 * reshuffle its motion each time. FNV-1a, because it is ten lines and
 * scatters neighbouring geoids ("4801", "4802") far apart — a phase that
 * tracked the geoid would make adjacent districts move as a visible wave.
 */
export function districtPhase(props: Record<string, unknown>, fallback: number): number {
  const id = String(props.geoid ?? props.state ?? fallback)
  let h = 2166136261
  for (let k = 0; k < id.length; k++) {
    h ^= id.charCodeAt(k)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10007) / 10007
}

export function triangulatePlates(
  features: GeoFeature[],
  projection: Projection,
  encode: PlateEncoder,
): { data: Float32Array; count: number; tris: number[] } {
  const verts: number[] = []
  const tris: number[] = []
  features.forEach((f, di) => {
    const { cov, cell } = encode(f.properties)
    const phase = districtPhase(f.properties, di)
    const c0 = cov[0] || 0, c1 = cov[1] || 0, c2 = cov[2] || 0, c3 = cov[3] || 0
    const polys = f.geometry.type === "Polygon"
      ? [f.geometry.coordinates as number[][][]] : f.geometry.coordinates as number[][][][]
    for (const poly of polys) {
      const flat: number[] = []
      const holes: number[] = []
      for (let ri = 0; ri < poly.length; ri++) {
        if (ri > 0) holes.push(flat.length / 2)
        for (const c of poly[ri]) {
          const p = projection(c)
          if (p) flat.push(p[0], p[1])
        }
      }
      if (flat.length < 6) continue
      const idx = earcut(flat, holes.length ? holes : undefined, 2)
      for (const i of idx) {
        verts.push(flat[i * 2], flat[i * 2 + 1], c0, c1, c2, c3, cell, phase)
      }
      for (let k = 0; k < idx.length; k += 3) tris.push(di)
    }
  })
  return { data: new Float32Array(verts), count: verts.length / STRIDE_FLOATS, tris }
}
