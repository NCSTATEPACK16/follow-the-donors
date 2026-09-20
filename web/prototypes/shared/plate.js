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
 * sheet. The keyline stays the heaviest mark and the districts stay still.
 */

/* Per-vertex payload: x, y, cov0..cov3, cell. Four coverage slots always,
   even for a three-plate page — an unused slot is a zero and costs one
   multiply, where a per-prototype vertex format would cost a second shader. */
export const MAX_PLATES = 4;
export const STRIDE_FLOATS = 2 + MAX_PLATES + 1;   // 7
export const STRIDE_BYTES = STRIDE_FLOATS * 4;     // 28

const VERT = `#version 300 es
in vec2 aPos; in vec4 aCov; in float aCell;
uniform vec2 uRes;
out vec4 vCov; out float vCell;
void main() {
  vCov = aCov; vCell = aCell;
  vec2 c = (aPos / uRes) * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec4 vCov; in float vCell;
uniform vec3 uPaper;
uniform vec3 uInk[${MAX_PLATES}];
uniform float uAng[${MAX_PLATES}];
uniform vec2 uDrift[${MAX_PLATES}];
uniform float uLay[${MAX_PLATES}];
uniform float uDpr, uDark, uCellScale, uGain, uNPlates;
out vec4 outColor;

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
float plate(vec2 frag, float angle, float cellPx, float cov, vec2 drift, float gain) {
  if (cov <= 0.0) return 0.0;
  float s = sin(angle), c = cos(angle);
  vec2 r = mat2(c, -s, s, c) * (frag + drift * uDpr);
  vec2 cell = fract(r / (cellPx * uCellScale * uDpr)) - 0.5;
  float d = length(cell);
  // Dot AREA scales with coverage, so perceived tone tracks the number.
  // 0.707 is the cell half-diagonal: at coverage 1.0 the dot closes the cell.
  // 'gain' is the reduced-motion dot-gain pulse — a swell in radius with no
  // spatial movement anywhere on the page.
  float radius = sqrt(cov) * 0.707 * gain;
  float aa = length(vec2(dFdx(d), dFdy(d)));
  return 1.0 - smoothstep(radius - aa, radius + aa, d);
}

/* Kubelka-Munk, single constant, per channel.
   K/S = (1-R)^2 / 2R  and its inverse  R = 1 + k - sqrt(k*k + 2k).
   Absorption adds LINEARLY with ink concentration, which is why two
   translucent inks give a deep, slightly warm third colour instead of the
   dead grey that a naive RGB multiply produces. */
vec3 ks(vec3 r) { r = clamp(r, 0.004, 0.996); return (1.0 - r) * (1.0 - r) / (2.0 * r); }
vec3 unks(vec3 k) { return 1.0 + k - sqrt(k * k + 2.0 * k); }

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
      float a = plate(frag, uAng[i], vCell, cov[i] * uLay[i], uDrift[i], uGain);
      col += a * uInk[i] * 0.95;
    }
  } else {
    vec3 k = ks(uPaper);
    for (int i = 0; i < ${MAX_PLATES}; i++) {
      if (float(i) >= uNPlates) break;
      float a = plate(frag, uAng[i], vCell, cov[i] * uLay[i], uDrift[i], uGain);
      k += a * ks(uInk[i]) * 1.35;
    }
    col = unks(k);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export const hex2rgb = (h) =>
  [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255);

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
 * Deliberately SUB-PIXEL (0.42px peak) and slow. The periods below are
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
const BREATH_AMP = 0.42;                       // CSS px, peak
const BREATH = [                               // seconds, per plate
  { x: 11.3, y: 8.7 }, { x: 9.1, y: 12.7 },
  { x: 13.9, y: 10.3 }, { x: 7.9, y: 14.9 },
];

function breathe(out, tSec, amount) {
  for (let i = 0; i < MAX_PLATES; i++) {
    const b = BREATH[i];
    out[i * 2] = Math.sin((tSec / b.x) * Math.PI * 2) * BREATH_AMP * amount;
    out[i * 2 + 1] = Math.cos((tSec / b.y) * Math.PI * 2) * BREATH_AMP * amount;
  }
  return out;
}

const PRESS_STAGGER = 0.22;   // seconds between plates laying down
const PRESS_DUR = 0.62;       // seconds for one plate to reach full ink
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** Full press cycle length for n plates, seconds. */
export const pressDuration = (n) => (n - 1) * PRESS_STAGGER + PRESS_DUR;

/**
 * REDUCED MOTION: dot gain, and nothing spatial.
 *
 * The research paper's own suggestion, and the right one. Breathing goes off
 * entirely — no plate moves by any amount. The press one-shot becomes a
 * single dot-gain pulse: every halftone radius swells ~5% and settles, which
 * is what over-inking actually looks like. Something clearly HAPPENED and
 * nothing travelled across the retina.
 */
const GAIN_PEAK = 1.05, GAIN_DUR = 0.9;

export function prefersReducedMotion() {
  return typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ------------------------------------------------------------------ */
/*  Renderer                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 *   nPlates  how many of the four slots this page uses
 *   angles   one screen angle (degrees) per plate — GLOBAL, never per-district
 *   onFrame  optional callback after each draw, for the keyline pass
 */
export function createPress(canvas, opts = {}) {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
  if (!gl) return null;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog));
  }
  const buf = gl.createBuffer();
  const U = (n) => gl.getUniformLocation(prog, n);
  const loc = {
    res: U("uRes"), dpr: U("uDpr"), paper: U("uPaper"), dark: U("uDark"),
    cellScale: U("uCellScale"), gain: U("uGain"), n: U("uNPlates"),
    ink: U("uInk"), ang: U("uAng"), drift: U("uDrift"), lay: U("uLay"),
  };

  const st = {
    w: 0, h: 0, dpr: 1,
    nPlates: opts.nPlates || 2,
    angles: new Float32Array(MAX_PLATES),
    inks: new Float32Array(MAX_PLATES * 3),
    drift: new Float32Array(MAX_PLATES * 2),
    lay: new Float32Array(MAX_PLATES).fill(1),
    paper: [1, 1, 1], dark: false,
    cellScale: 1, gain: 1,
    mesh: null, count: 0,
    breathing: false, reduced: prefersReducedMotion(),
    pressT: -1, gainT: -1, raf: 0, t0: performance.now(),
  };
  setAngles(opts.angles || [45, 15, 75, 0]);

  function setAngles(deg) {
    for (let i = 0; i < MAX_PLATES; i++) {
      st.angles[i] = (deg[i] ?? 0) * Math.PI / 180;
    }
  }

  function setInks(hexes) {
    for (let i = 0; i < MAX_PLATES; i++) {
      const rgb = hexes[i] ? hex2rgb(hexes[i]) : [0, 0, 0];
      st.inks[i * 3] = rgb[0];
      st.inks[i * 3 + 1] = rgb[1];
      st.inks[i * 3 + 2] = rgb[2];
    }
  }

  function resize(w, h, dpr) {
    st.w = w; st.h = h; st.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  function setMesh(data, count) { st.mesh = data; st.count = count; }
  function setPaper(hex) { st.paper = hex2rgb(hex); }
  function setDark(v) { st.dark = !!v; }
  function setCellScale(v) { st.cellScale = v; }

  function draw() {
    if (!st.mesh || !st.count) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(st.paper[0], st.paper[1], st.paper[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, st.mesh, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, "aPos");
    const aCov = gl.getAttribLocation(prog, "aCov");
    const aCell = gl.getAttribLocation(prog, "aCell");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, STRIDE_BYTES, 0);
    gl.enableVertexAttribArray(aCov);
    gl.vertexAttribPointer(aCov, 4, gl.FLOAT, false, STRIDE_BYTES, 8);
    gl.enableVertexAttribArray(aCell);
    gl.vertexAttribPointer(aCell, 1, gl.FLOAT, false, STRIDE_BYTES, 24);

    gl.uniform2f(loc.res, st.w, st.h);
    gl.uniform1f(loc.dpr, st.dpr);
    gl.uniform3fv(loc.paper, st.paper);
    gl.uniform1f(loc.dark, st.dark ? 1 : 0);
    gl.uniform1f(loc.cellScale, st.cellScale);
    gl.uniform1f(loc.gain, st.gain);
    gl.uniform1f(loc.n, st.nPlates);
    gl.uniform3fv(loc.ink, st.inks);
    gl.uniform1fv(loc.ang, st.angles);
    gl.uniform2fv(loc.drift, st.drift);
    gl.uniform1fv(loc.lay, st.lay);
    gl.drawArrays(gl.TRIANGLES, 0, st.count);
    if (opts.onFrame) opts.onFrame();
  }

  /** One frame of whatever motion is currently live. Returns true if more
   *  frames are needed. */
  function tick(nowMs) {
    const t = (nowMs - st.t0) / 1000;
    let more = false;

    if (st.pressT >= 0) {
      // Plates lay down in sequence, as a press lays them.
      const e = t - st.pressT;
      const total = pressDuration(st.nPlates);
      for (let i = 0; i < MAX_PLATES; i++) {
        const local = (e - i * PRESS_STAGGER) / PRESS_DUR;
        st.lay[i] = local <= 0 ? 0 : local >= 1 ? 1 : easeOut(local);
      }
      if (e >= total) { st.pressT = -1; st.lay.fill(1); } else more = true;
    }

    if (st.gainT >= 0) {
      // Reduced motion: one non-spatial swell, then settle.
      const e = (t - st.gainT) / GAIN_DUR;
      if (e >= 1) { st.gainT = -1; st.gain = 1; }
      else { st.gain = 1 + (GAIN_PEAK - 1) * Math.sin(e * Math.PI); more = true; }
    }

    if (st.breathing && !st.reduced) { breathe(st.drift, t, 1); more = true; }
    else st.drift.fill(0);

    draw();
    return more;
  }

  function loop() {
    st.raf = 0;
    if (tick(performance.now())) st.raf = requestAnimationFrame(loop);
  }
  function kick() { if (!st.raf) st.raf = requestAnimationFrame(loop); }

  return {
    gl, resize, setMesh, setInks, setAngles, setPaper, setDark, setCellScale,
    draw,
    get nPlates() { return st.nPlates; },
    set nPlates(v) { st.nPlates = v; },
    get reducedMotion() { return st.reduced; },

    /**
     * The per-view screen scale, read-only. Exposed because the state
     * blow-up's whole claim is that the plate is RE-SCREENED, and the
     * statebar says so in prose — a label reading "8px" over a plate still
     * screened at 3.6px is a lie the harness has to be able to catch.
     */
    get cellScale() { return st.cellScale; },
    set reducedMotion(v) { st.reduced = !!v; if (!v) kick(); else draw(); },

    /** Ambient breathing on/off. Ignored under reduced motion. */
    setBreathing(on) {
      st.breathing = !!on;
      if (on && !st.reduced) kick(); else { st.drift.fill(0); draw(); }
    },

    /**
     * The one-shot on entering a state blow-up. Under reduced motion this is
     * a dot-gain pulse instead of a sequence — the plates are already down
     * and nothing moves.
     */
    press() {
      const t = (performance.now() - st.t0) / 1000;
      if (st.reduced) { st.gainT = t; st.lay.fill(1); }
      else { st.pressT = t; st.lay.fill(0); }
      kick();
    },

    stop() { if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; },
  };
}

/* ------------------------------------------------------------------ */
/*  Mesh                                                               */
/* ------------------------------------------------------------------ */

/**
 * Triangulate into the 7-float interleaved format the press expects.
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
export function triangulatePlates(features, projection, encode) {
  const verts = [];
  const tris = [];
  features.forEach((f, di) => {
    const { cov, cell } = encode(f.properties);
    const c0 = cov[0] || 0, c1 = cov[1] || 0, c2 = cov[2] || 0, c3 = cov[3] || 0;
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
        verts.push(flat[i * 2], flat[i * 2 + 1], c0, c1, c2, c3, cell);
      }
      for (let k = 0; k < idx.length; k += 3) tris.push(di);
    }
  });
  return { data: new Float32Array(verts), count: verts.length / STRIDE_FLOATS, tris };
}
