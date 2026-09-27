import { useEffect, useRef } from "react"
import {
  D, S, SCREEN_ANGLES, densityT, moneyPlates, partyInkOf, partyPlate, partyStep,
  platesOf, usd, usdCompact, type System,
} from "./lib/inks"
import {
  loadAtlas, makeProjection, projectAll, measure, makePicker,
  partitionProjectable, renderOffmap, renderSheet, renderTable, renderLegend,
  shellHTML, debounce,
  type Atlas, type DistrictProperties, type ProjectedShape,
} from "./lib/atlas"
import { createPress, triangulatePlates, type Press } from "./lib/plate"
import { halftoneRect } from "./lib/screens"
import {
  CELL, DISTRICT_SCALE, FLAT_CELL, MIN_CELLS_ACROSS, NATIONAL_SCALE, STATE_SCALE,
  dominantCell, stateScale,
  makeDistrictProjection, makeStateProjection, partyChipCoverage,
  districtsOf, stateIndex, quantileBreaks, renderCycleBand, renderPartyLegend,
  renderSenateLegend, renderSenateTable, renderStateBar, renderStatePicker,
} from "./lib/view"
import { fetchDistrictPage, renderDistrictPageSheet } from "./lib/districtPage"
import { DEFAULT_CYCLE, type Cycle } from "./lib/config"
import { Finder } from "./components/Finder"

const SYS = D
/** The Senate layer prints its own Riso inks (inks.ts S), never D's. */
const SEN = S
const CYCLE: Cycle = DEFAULT_CYCLE
/* Three plates, three angles. GLOBAL — one angle per plate for the whole
   sheet, never per district. See plate.ts's header comment. */
const ANGLES = [SCREEN_ANGLES.color, SCREEN_ANGLES.key, SCREEN_ANGLES.second]
/** Legend chip size, CSS px. Wide enough to hold a few of the coarsest
 *  state-plate dots (13px) — at 30x13 a chip printed at the map's own
 *  ruling held one dot, which keys nothing. three-plate.css matches. */
const CHIP_W = 44, CHIP_H = 20

/** Three zoom tiers — nation, state, district — each a new plate re-screened
 *  coarser. Three layers — House money, Senate money, and who holds the
 *  seat. Party is a LAYER, never merged into the money map. */
type ViewMode = "national" | "state" | "district"
type Layer = "house" | "senate" | "party"
interface ViewState { mode: ViewMode; st: string | null; geoid: string | null; layer: Layer }

/** The map's height. On a wide screen the plate takes what is left of the
 *  first screen below the header — it used to be a fixed 0.6 of its width,
 *  so on a laptop it ran off the bottom while the prose sat under it — but
 *  never more than the country's own shape (Albers USA is ~0.63 as tall as
 *  it is wide), or the extra height is just empty paper above and below.
 *  On a narrow screen it keeps that shape; a phone is taller than any
 *  honest map of the country. */
function stageHeight(w: number, top: number, national: boolean): number {
  // A state or a district can be any shape — Idaho is taller than wide —
  // so the zoomed tiers allow more height and let the fit centre it.
  const shape = Math.round(w * (national ? 0.63 : 0.85))
  if (window.innerWidth < 900) return shape
  return Math.round(Math.max(360, Math.min(shape, window.innerHeight - top - 16)))
}

/**
 * Ported from web/prototypes/d-threeplate.html's inline module script.
 * "Port it, do not redesign it": this stays a thin React shell around the
 * same imperative WebGL/canvas controller the prototype used — React owns
 * the DOM structure and the Finder panel, everything else is the same
 * load/layout/paint/pick loop, targeting refs instead of
 * `document.getElementById`.
 */
export default function App() {
  const shellRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const statebarRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLCanvasElement>(null)
  const linesRef = useRef<HTMLCanvasElement>(null)
  const countlineRef = useRef<HTMLSpanElement>(null)
  const offmapRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLSpanElement>(null)
  const perfRef = useRef<HTMLSpanElement>(null)
  const zoomCtlRef = useRef<HTMLDivElement>(null)
  const zoomInRef = useRef<HTMLButtonElement>(null)
  const zoomOutRef = useRef<HTMLButtonElement>(null)
  const zoomResetRef = useRef<HTMLButtonElement>(null)
  const zoomLabRef = useRef<HTMLSpanElement>(null)

  const themeBtnRef = useRef<HTMLButtonElement>(null)
  const layerBtnRef = useRef<HTMLButtonElement>(null)
  const motionBtnRef = useRef<HTMLButtonElement>(null)
  const tableBtnRef = useRef<HTMLButtonElement>(null)
  const partyBtnRef = useRef<HTMLButtonElement>(null)
  const sheetWrapRef = useRef<HTMLDivElement>(null)
  const sheetHandleRef = useRef<HTMLButtonElement>(null)

  /** Exposed to the Finder panel, which lives outside the imperative
   * controller's own DOM subtree. */
  const controllerRef = useRef<{ goToDistrict: (geoid: string) => void; goToState: (state: string) => void } | null>(null)

  useEffect(() => {
    let cancelled = false
    let press: Press | null = null
    let atlas: Atlas | null = null
    let shapes: ProjectedShape<DistrictProperties>[] = []
    /** State outlines for the national border pass. Empty in a state view
     *  and on the Senate layer, where the fill already IS the states. */
    let stateShapes: ProjectedShape<unknown>[] = []
    let picker: ((x: number, y: number, k?: number) => number) | null = null
    /** The hand zoom inside a state or district plate: geometry scale k and
     *  offset (tx, ty) in CSS px. The press applies it in the vertex shader
     *  and leaves the screen alone, so the dots hold their size while the
     *  districts grow. Reset whenever the plate changes. */
    const zoom = { k: 1, tx: 0, ty: 0 }
    const ZOOM_MAX = 12
    let sel = -1, hov = -1
    /** Where the pointer was last seen and which shape it was over — see
     *  pick(). Cleared on every re-layout: a new plate re-indexes shapes. */
    let lastMove: { x: number; y: number; i: number } | null = null
    let W = 0, H = 0
    let offmap: Atlas["districts"]["features"] = []
    let mesh: ReturnType<typeof triangulatePlates> | null = null
    let dark = false
    let breathing = true
    let view: ViewState = { mode: "national", st: null, geoid: null, layer: "house" }
    let BREAKS: number[] = []
    let SEN_BREAKS: number[] = []
    const cleanups: Array<() => void> = []
    const tip = document.createElement("div")
    tip.className = "tip"
    tip.hidden = true

    const el = <T,>(ref: { current: T | null }): T => ref.current as T

    async function boot() {
      const t0 = performance.now()
      atlas = await loadAtlas(CYCLE, { senate: true })
      if (cancelled || !atlas) return
      ;(window as unknown as { __atlas?: unknown }).__atlas = atlas
      /* The verification surface web/check.mjs asserts against. The harness
       * checks the re-screen against the GPU uniform and the state bar's
       * money against the page's OWN formatter — comparing two spellings of
       * a number proves nothing — so both have to be reachable from the
       * built bundle, where a module URL no longer is. */
      ;(window as unknown as { __riso?: unknown }).__riso =
        { CELL, STATE_SCALE, DISTRICT_SCALE, usd, usdCompact }
      /* How many districts the party layer draws as NO single party. Counted
       * from the loaded artifact, for the legend's footnote and so the
       * harness can hold it to the artifact's own count. */
      const hasParty = atlas.districts.features.some((f) => "incumbent_party" in f.properties)
      const ambiguous = atlas.districts.features.filter(
        (f) => partyInkOf(f.properties.incumbent_party) === "NEUTRAL").length
      ;(window as unknown as { __ambiguous?: number }).__ambiguous = hasParty ? ambiguous : -1
      const tLoad = performance.now() - t0
      let firstPaintMs = -1

      BREAKS = atlas.meta.breaks_cents
      SEN_BREAKS = quantileBreaks(
        atlas.states!.features.filter((f) => f.properties.has_senate)
          .map((f) => f.properties.total_cents))

      el(shellRef).innerHTML = shellHTML({
        kicker: `follow the donors · ${CYCLE} cycle`,
        title: "Federal PAC Money by District",
        // No ink names here: the shell is rendered once, and dark stock
        // prints the same drums in a different order (see inks.ts D).
        thesis: "Federal PAC money, printed on three drums. Depth of ink is "
          + "the money; how coarse the screen is, is how sure we are the "
          + "district is still shaped like that.",
        meta: atlas.meta,
      })
      renderCycleBand(el(bandRef), atlas.meta)
      renderStatePicker(el(pickerRef), stateIndex(atlas), (st) => goTo({ mode: "state", st, geoid: null }))

      const encodeHouse = () => (p: Record<string, unknown>) => ({
        cov: moneyPlates(SYS, densityT(p.pac_cents as number, BREAKS), dark),
        cell: (CELL[p.map_status as string] ?? FLAT_CELL) * 1,
      })
      /* One ink per district, four money steps. The press takes three
       * plates, so the party picks WHICH plate carries the district's ink:
       * slot 0 red, slot 1 blue, slot 2 the neutral. Each plate keeps its own
       * global screen angle, so red, blue and gray also differ in the angle
       * of their rosette — a free second channel. `cell` is the same
       * expression encodeHouse uses: the party layer changes the ink, never
       * the claim about the map's vintage. */
      const encodeParty = () => (p: Record<string, unknown>) => {
        const party = partyInkOf(p.incumbent_party)
        const slot = party === "REP" ? 0 : party === "DEM" ? 1 : 2
        const cov = [0, 0, 0]
        cov[slot] = partyPlate(party, dark).table[partyStep(p.pac_cents as number, BREAKS)]
        return { cov, cell: (CELL[p.map_status as string] ?? FLAT_CELL) * 1 }
      }
      const encodeSenate = () => (p: Record<string, unknown>) => ({
        cov: p.has_senate
          ? moneyPlates(SEN, densityT(p.total_cents as number, SEN_BREAKS), dark)
          : [0, 0, 0],
        cell: p.seat_up ? CELL.cd119_current : CELL.cd119_superseded,
      })

      function layout() {
        const box = el(stageRef).getBoundingClientRect()
        W = Math.max(320, Math.round(box.width))
        H = stageHeight(W, box.top + window.scrollY, view.mode === "national")
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        press!.resize(W, H, dpr)
        const lc = el(linesRef) as HTMLCanvasElement
        lc.width = Math.round(W * dpr); lc.height = Math.round(H * dpr)
        lc.style.width = `${W}px`; lc.style.height = `${H}px`

        const senate = view.mode === "national" && view.layer === "senate"
        let feats: Atlas["districts"]["features"], proj: ReturnType<typeof makeProjection>

        stateShapes = []
        if (view.mode === "district") {
          const f = atlas!.districts.features.find((d) => d.properties.geoid === view.geoid)!
          feats = [f]
          proj = makeDistrictProjection(f, W, H)
          offmap = []
          press!.setCellScale(DISTRICT_SCALE)
        } else if (view.mode === "state") {
          feats = districtsOf(atlas!, view.st!)
          proj = makeStateProjection(feats, W, H)
          offmap = []
          // Scale is set below, once the shapes are measured: the state's
          // ruling is fit to its own small districts (view.ts stateScale).
        } else {
          const src = senate
            ? { type: "FeatureCollection" as const, features: atlas!.states!.features }
            : atlas!.districts
          const part = partitionProjectable(src as never)
          feats = part.mapped.features as never
          offmap = senate ? [] : part.offmap as never
          proj = makeProjection(part.mapped as never, W, H)
          press!.setCellScale(NATIONAL_SCALE)
          // State outlines, projected with the SAME fitted projection as the
          // districts. A separate fit would land them a fraction of a pixel
          // off the district edges, and in this design system a gap between
          // two shapes means misregistration, which MEANS something. The
          // territories are partitioned out for the same reason as above:
          // Albers USA returns its whole clip rectangle for them.
          if (!senate && atlas!.states) {
            stateShapes = projectAll(
              partitionProjectable(atlas!.states as never).mapped as never, proj as never)
          }
        }

        const encode = senate ? encodeSenate()
          : view.layer === "party" ? encodeParty() : encodeHouse()
        shapes = measure(projectAll({ type: "FeatureCollection", features: feats } as never, proj as never)) as never
        if (view.mode === "state") press!.setCellScale(stateScale(shapes))
        zoom.k = 1; zoom.tx = 0; zoom.ty = 0
        applyZoom()
        mesh = triangulatePlates(feats as never, proj as never, encode as never)
        press!.setMesh(mesh.data, mesh.count)
        ;(window as unknown as { __mesh?: unknown }).__mesh = mesh.data
        picker = makePicker(shapes, W, H, 1)
        sel = -1; hov = -1; lastMove = null

        const what = view.layer === "party"
          ? "which party holds each seat, and the PAC money it took,"
          : "PAC contributions"
        el(glRef).setAttribute("aria-label", senate
          ? `Halftone map of PAC contributions to Senate candidates by state, ${CYCLE} cycle`
          : view.mode === "district"
            ? `Halftone map of ${what} in ${view.st} district ${view.geoid?.slice(2)}, ${CYCLE} cycle`
            : view.mode === "state"
              ? `Halftone map of ${what} by congressional district in ${view.st}, ${CYCLE} cycle`
              : `Halftone map of ${what} by congressional district, ${CYCLE} cycle`)

        paint()
        renderOffmap(el(offmapRef), offmap, SYS, dark, (geoid) => {
          const f = offmap.find((x) => x.properties.geoid === geoid)
          if (f) renderSheet(el(sheetRef), { props: f.properties }, atlas!.sectors, SYS, dark)
        }, BREAKS)

        const zoomed = view.mode !== "national"
        renderStateBar(el(statebarRef), {
          state: zoomed ? view.st : null,
          districts: zoomed ? districtsOf(atlas!, view.st!) : [],
          senate: zoomed
            ? atlas!.states!.features.find((f) => f.properties.state === view.st)?.properties
            : null,
          cycle: CYCLE,
          district: view.mode === "district" ? feats[0]?.properties : null,
          scale: press!.cellScale,
        })
        // Back steps ONE tier: a district returns to its state with the
        // district still selected, a state returns to the nation.
        const back = document.getElementById("backtonational")
        if (back) back.addEventListener("click", () => {
          if (view.mode === "district") goTo({ mode: "state", geoid: null }, view.geoid ?? undefined)
          else goTo({ mode: "national", geoid: null })
        })

        el(countlineRef).textContent = senate
          ? `WebGL2 halftone · three plates · ${shapes.length} states`
          : `WebGL2 halftone · three plates · Kubelka-Munk overprint · ${shapes.length} districts`

        // Written HERE, after the mesh this view actually draws exists. It
        // used to be written once at boot, before a deep link's state
        // blow-up had rebuilt the mesh, and read "mesh 0 verts".
        if (firstPaintMs < 0) firstPaintMs = performance.now() - t0
        el(perfRef).textContent =
          `data ${tLoad.toFixed(0)}ms · mesh ${mesh.count.toLocaleString()} verts · first paint ${firstPaintMs.toFixed(0)}ms`

        const lay = el(layerBtnRef)
        lay.disabled = view.mode !== "national"
        lay.title = view.mode !== "national"
          ? "In a state view both are shown — House as the fill, Senate in the bar above"
          : ""
        lay.setAttribute("aria-pressed", String(view.layer === "senate"))
        el(partyBtnRef).setAttribute("aria-pressed", String(view.layer === "party"))
        ;(window as unknown as { __view?: unknown }).__view = { ...view }
      }

      function paint() {
        press!.setPaper(dark ? SYS.paperDark : SYS.paper)
        press!.setDark(dark)
        const senate = view.mode === "national" && view.layer === "senate"
        press!.setInks(view.layer === "party"
          ? (["REP", "DEM", "NEUTRAL"] as const).map((pt) => partyPlate(pt, dark).ink)
          : platesOf(senate ? SEN : SYS, dark))
        press!.draw()
        drawLines()
        paintLegend()
      }

      function drawLines() {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const ctx = el(linesRef).getContext("2d")!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, W, H)
        // The keylines follow the hand zoom; their WEIGHT does not — every
        // width below is divided by k so a line stays a line at any zoom.
        const k = zoom.k
        ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * zoom.tx, dpr * zoom.ty)
        const trace = (s: ProjectedShape<DistrictProperties>) => {
          ctx.beginPath()
          for (const r of s.rings) {
            ctx.moveTo(r.xy[0], r.xy[1])
            for (let k = 2; k < r.xy.length; k += 2) ctx.lineTo(r.xy[k], r.xy[k + 1])
            ctx.closePath()
          }
        }
        // District hairline. Thinner nationally than before (0.75 -> 0.6)
        // because the state pass below now carries the structure; at 0.75
        // with no hierarchy the Northeast was a knot of equal lines.
        ctx.lineWidth = (view.mode === "state" ? 1.1 : 0.6) / k
        ctx.lineJoin = "round"
        ctx.strokeStyle = dark ? "rgba(237,237,230,.46)" : "rgba(27,27,24,.56)"
        for (const s of shapes) { trace(s); ctx.stroke() }
        // The country's structure before its 436 cells. Heavier, and in the
        // paper's own ink rather than a sixth colour, so it reads as a fold
        // in the sheet rather than as another plate.
        // The party layer's secondary mark. A seat with no single party
        // incumbent prints gray, and gray cannot be told from a pale red by a
        // protanope (measured, inks.ts PARTY) — so it is also HATCHED, in the
        // keyline ink, clipped to the district. Drawn here, on the keyline
        // canvas, so the fill stays one validated ink.
        if (view.layer === "party") {
          ctx.save()
          ctx.lineWidth = (view.mode === "national" ? 0.7 : 1) / k
          ctx.strokeStyle = dark ? "rgba(237,237,230,.55)" : "rgba(27,27,24,.55)"
          const gap = (view.mode === "national" ? 4 : 7) / k
          for (const s of shapes) {
            if (partyInkOf((s.props as DistrictProperties).incumbent_party) !== "NEUTRAL") continue
            ctx.save(); trace(s); ctx.clip()
            ctx.beginPath()
            const [x0, y0, x1, y1] = [s.bbox?.[0] ?? 0, s.bbox?.[1] ?? 0, s.bbox?.[2] ?? W, s.bbox?.[3] ?? H]
            for (let k = x0 - (y1 - y0); k < x1; k += gap) { ctx.moveTo(k, y1); ctx.lineTo(k + (y1 - y0), y0) }
            ctx.stroke(); ctx.restore()
          }
          ctx.restore()
        }
        if (stateShapes.length) {
          ctx.lineWidth = 1.6 / k
          ctx.strokeStyle = dark ? "rgba(237,237,230,.80)" : "rgba(27,27,24,.84)"
          for (const s of stateShapes) { trace(s as never); ctx.stroke() }
        }
        if (hov >= 0 && hov !== sel) {
          ctx.lineWidth = 1.8 / k; ctx.strokeStyle = dark ? "#EDEDE6" : "#1b1b18"
          trace(shapes[hov]); ctx.stroke()
        }
        if (sel >= 0) {
          ctx.lineWidth = 2.4 / k; ctx.strokeStyle = dark ? "#EDEDE6" : "#1b1b18"
          trace(shapes[sel]); ctx.stroke()
        }
      }

      function paintLegend() {
        const senate = view.mode === "national" && view.layer === "senate"
        const legendEl = el(legendRef)
        if (senate) {
          renderSenateLegend(legendEl, atlas!.senate!, SEN_BREAKS)
          paintChips(legendEl, SEN)
          return
        }
        if (view.layer === "party") {
          renderPartyLegend(legendEl, { cycle: CYCLE, breaks: BREAKS, ambiguous, hasData: hasParty })
          legendEl.querySelectorAll<HTMLElement>("[data-party]").forEach((chip) => {
            const party = chip.dataset.party as "REP" | "DEM" | "NEUTRAL"
            const { ink, cov } = partyChipCoverage(party, Number(chip.dataset.step), dark)
            const cv = document.createElement("canvas")
            const w = CHIP_W * 2, h = CHIP_H * 2
            cv.width = w; cv.height = h
            const c = cv.getContext("2d")!
            c.fillStyle = dark ? SYS.paperDark : SYS.paper; c.fillRect(0, 0, w, h)
            c.globalCompositeOperation = dark ? "lighter" : "multiply"
            const slot = party === "REP" ? 0 : party === "DEM" ? 1 : 2
            halftoneRect(c, 0, 0, w, h, ink, ANGLES[slot], cov, chipCell() * 2, dark ? 0.95 : 1)
            c.globalCompositeOperation = "source-over"
            if (party === "NEUTRAL") {
              // The chip carries the map's hatch too — the legend has to show
              // the mark that actually distinguishes this case.
              c.strokeStyle = dark ? "rgba(237,237,230,.55)" : "rgba(27,27,24,.55)"
              c.lineWidth = 1.4; c.beginPath()
              for (let k = -h; k < w; k += 8) { c.moveTo(k, h); c.lineTo(k + h, 0) }
              c.stroke()
            }
            chip.innerHTML = ""; chip.appendChild(cv)
          })
          noteChipScreen(legendEl)
          return
        }
        renderLegend(legendEl, SYS, dark, {
          cycle: CYCLE,
          labels: atlas!.meta.break_labels,
          staleLabel: "Superseded — printed coarse; a redraw is in effect and we cannot draw it",
        })
        paintChips(legendEl, SYS)
        paintVintage(legendEl, SYS)
      }

      /** The ruling the legend is screened at: the cell most of the plate
       *  on screen prints at, at this view's screen scale. It used to be the
       *  national current-map cell everywhere, so a California plate of
       *  13px superseded dots was keyed by 2.5px chips — two different
       *  pictures. The hand zoom does not change it: it moves geometry, not
       *  the screen. */
      function chipCell(): number {
        if (view.mode === "national" && view.layer === "senate") {
          return CELL.cd119_current * press!.cellScale
        }
        return dominantCell(shapes.map((s) => s.props as DistrictProperties), press!.cellScale)
      }

      function noteChipScreen(legendEl: HTMLElement) {
        const p = document.createElement("p")
        p.className = "legend-foot legend-screen"
        p.textContent = `Chips screened at ${chipCell().toFixed(1)}px, the ruling most of this plate prints at.`
        legendEl.appendChild(p)
      }

      /** The vintage key, printed at each vintage's OWN cell at this view's
       *  scale — one mid-tone ink, so the only thing that differs between
       *  the three marks is the thing they key: how coarse the screen is. */
      function paintVintage(legendEl: HTMLElement, sys: System) {
        const ink = platesOf(sys, dark)[1]
        const status: Record<string, string> = {
          "lv-current": "cd119_current", "lv-contested": "cd119_contested", "lv-stale": "cd119_superseded",
        }
        legendEl.querySelectorAll<HTMLElement>(".lv-mark").forEach((mark) => {
          const cls = Object.keys(status).find((c) => mark.classList.contains(c))
          if (!cls) return
          const cv = document.createElement("canvas")
          const w = CHIP_W * 2, h = CHIP_H * 2
          cv.width = w; cv.height = h
          const c = cv.getContext("2d")!
          c.fillStyle = dark ? sys.paperDark : sys.paper; c.fillRect(0, 0, w, h)
          c.globalCompositeOperation = dark ? "lighter" : "multiply"
          halftoneRect(c, 0, 0, w, h, ink, ANGLES[1], 0.42, CELL[status[cls]] * press!.cellScale * 2, dark ? 0.95 : 1)
          mark.classList.add("lv-printed")
          mark.innerHTML = ""; mark.appendChild(cv)
        })
      }

      /** Each legend chip is printed, not filled: the SAME coverages the map
       *  prints for that step (moneyPlates, off the step table and the ink
       *  path) at chipCell() — the map's own ruling — doubled for the 2x
       *  chip canvas. A
       *  typed swatch is how the legend once pictured a different map. */
      function paintChips(legendEl: HTMLElement, sys: System) {
        const pl = platesOf(sys, dark)
        legendEl.querySelectorAll(".legend-chip").forEach((chip, i) => {
          const cv = document.createElement("canvas")
          const w = CHIP_W * 2, h = CHIP_H * 2
          cv.width = w; cv.height = h
          const c = cv.getContext("2d")!
          c.fillStyle = dark ? sys.paperDark : sys.paper; c.fillRect(0, 0, w, h)
          const cov = moneyPlates(sys, i / 5, dark)
          // multiply on paper is the nearest canvas mode to the shader's
          // subtractive overprint; lighter at 0.95 IS its additive dark model.
          c.globalCompositeOperation = dark ? "lighter" : "multiply"
          for (let k = 0; k < 3; k++) {
            halftoneRect(c, 0, 0, w, h, pl[k], ANGLES[k], cov[k], chipCell() * 2, dark ? 0.95 : 1)
          }
          c.globalCompositeOperation = "source-over"
          chip.innerHTML = ""; chip.appendChild(cv)
        })
        noteChipScreen(legendEl)
      }

      /** Fetches the richer stage-09 page for the selected district and
       * replaces the lightweight geometry-sourced sheet once it lands. */
      /** Under 720px the sheet is a bottom sheet over the map: hidden while
       *  nothing is selected, open when a district is picked, and folded to
       *  its handle by a tap. On a wide screen the state is inert CSS. */
      function setSheetState(state: "empty" | "open" | "collapsed") {
        el(sheetWrapRef).dataset.state = state
        el(sheetHandleRef).setAttribute("aria-expanded", String(state === "open"))
      }

      function clearSheet() {
        renderSheet(el(sheetRef), null, atlas!.sectors, SYS, dark)
        setSheetState("empty")
      }

      function loadSheet(geoid: string) {
        const feature = atlas!.districts.features.find((f) => f.properties.geoid === geoid)
        // Show the geometry-sourced sheet at once — it is already loaded —
        // and replace it when stage 09's richer page lands. It used to show
        // the empty "Hover or tap" state while it waited.
        if (feature) renderSheet(el(sheetRef), { props: feature.properties }, atlas!.sectors, SYS, dark)
        setSheetState("open")
        void fetchDistrictPage(geoid, CYCLE).then((page) => {
          if (!cancelled) renderDistrictPageSheet(el(sheetRef), page, SYS, dark, feature?.properties.incumbent_party)
        }).catch(() => { /* geometry-sourced sheet already showed something */ })
      }

      function selectShapeIndex(i: number) {
        sel = i
        drawLines()
        const geoid = (shapes[i].props as DistrictProperties).geoid
        if (geoid) loadSheet(geoid)
        else { renderSheet(el(sheetRef), shapes[i] as never, atlas!.sectors, SYS, dark); setSheetState("open") }
        history.replaceState(null, "", `#${geoid ?? ""}`)
      }

      function goTo(next: Partial<ViewState>, afterGeoid?: string) {
        view = { ...view, ...next }
        if (next.mode === "national") { view.st = null; view.geoid = null }
        if (view.mode !== "district") view.geoid = null
        // The hovered shape belongs to the plate being replaced; its tooltip
        // would otherwise float over the new one until the pointer moves.
        hov = -1
        tip.hidden = true
        el(innerRef).classList.add("is-swapping")
        const go = () => {
          el(innerRef).classList.remove("is-swapping")
          layout()
          press!.press()
          drawLines()
          clearSheet()
          // A district tier always shows its own sheet. Otherwise re-select
          // whatever the reader was looking at, if it is on this plate.
          const want = view.mode === "district" ? view.geoid : afterGeoid
          if (want) {
            const i = shapes.findIndex((s) => (s.props as DistrictProperties).geoid === want)
            if (i >= 0) selectShapeIndex(i)
          }
        }
        if (press!.reducedMotion) go()
        else setTimeout(go, 180)
      }

      /** For the Finder panel and deep links: resolve a geoid to its state,
       * blow up that state, then select the district once it renders. */
      function goToDistrict(geoid: string) {
        const f = atlas!.districts.features.find((d) => d.properties.geoid === geoid)
        if (!f) return
        goTo({ mode: "state", st: f.properties.state, layer: "house" }, geoid)
      }
      function goToState(state: string) {
        goTo({ mode: "state", st: state, geoid: null })
      }
      controllerRef.current = { goToDistrict, goToState }

      /* ---- the hand zoom ------------------------------------------- */
      /** Push the zoom to the press, the keylines and the controls. Clamped
       *  so the plate always covers the stage: at k=1 it is exactly the
       *  fitted state, and no zoom can pan it off the paper. */
      function applyZoom() {
        zoom.k = Math.max(1, Math.min(ZOOM_MAX, zoom.k))
        zoom.tx = Math.min(0, Math.max(W - W * zoom.k, zoom.tx))
        zoom.ty = Math.min(0, Math.max(H - H * zoom.k, zoom.ty))
        press?.setView(zoom.k, zoom.tx, zoom.ty)
        const zoomable = view.mode !== "national"
        const ctl = el(zoomCtlRef)
        ctl.hidden = !zoomable
        el(zoomLabRef).textContent = `${zoom.k < 10 ? zoom.k.toFixed(1) : Math.round(zoom.k)}×`
        el(zoomOutRef).disabled = zoom.k <= 1
        el(zoomInRef).disabled = zoom.k >= ZOOM_MAX
        el(zoomResetRef).disabled = zoom.k <= 1
        // One finger scrolls the page until the reader has zoomed in; then
        // it pans the plate. Two fingers always reach the pinch handler,
        // because pan-x pan-y keeps the browser from claiming the pinch.
        linesEl.style.touchAction = !zoomable ? "" : zoom.k > 1 ? "none" : "pan-x pan-y"
        linesEl.style.cursor = zoomable && zoom.k > 1 ? "grab" : ""
        ;(window as unknown as { __zoom?: unknown }).__zoom = { ...zoom }
      }
      /** Zoom by factor f about the stage point (px, py), which stays put. */
      function zoomAt(f: number, px: number, py: number) {
        if (view.mode === "national") return
        const k0 = zoom.k
        const k1 = Math.max(1, Math.min(ZOOM_MAX, k0 * f))
        if (k1 === k0) return
        zoom.tx = px - (px - zoom.tx) * (k1 / k0)
        zoom.ty = py - (py - zoom.ty) * (k1 / k0)
        zoom.k = k1
        applyZoom()
        lastMove = null
        press!.draw(); drawLines()
      }

      /* ---- interaction --------------------------------------------- */
      document.body.appendChild(tip)
      const linesEl = el(linesRef)
      /** Pointer -> stage CSS px. */
      const stageXY = (e: { clientX: number; clientY: number }): [number, number] => {
        const r = linesEl.getBoundingClientRect()
        return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]
      }
      const hit = (e: PointerEvent) => {
        const [x, y] = stageXY(e)
        return picker!((x - zoom.tx) / zoom.k, (y - zoom.ty) / zoom.k, zoom.k)
      }

      /* Ctrl/⌘ + wheel, and a trackpad pinch (which browsers deliver as a
       * ctrl-wheel), zoom the plate. A plain wheel keeps scrolling the page:
       * the plate fills the first screen, and a map that eats the scroll
       * traps the reader above the fold. */
      const onWheel = (e: WheelEvent) => {
        if (view.mode === "national" || !(e.ctrlKey || e.metaKey)) return
        e.preventDefault()
        const [x, y] = stageXY(e)
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), x, y)
      }
      linesEl.addEventListener("wheel", onWheel, { passive: false })
      cleanups.push(() => linesEl.removeEventListener("wheel", onWheel))

      /* Drag to pan once zoomed; two pointers pinch. A drag that moved more
       * than a few px swallows the click that follows, so panning never
       * selects the district it happened to end on. */
      const ptrs = new Map<number, [number, number]>()
      let dragged = false
      let downAt: [number, number] = [0, 0]
      let pinch0: { d: number; k: number } | null = null
      const onDown = (e: PointerEvent) => {
        if (view.mode === "national") return
        ptrs.set(e.pointerId, stageXY(e))
        downAt = stageXY(e)
        dragged = false
        if (ptrs.size === 2) {
          const [a, b] = [...ptrs.values()]
          pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: zoom.k }
        }
        if (zoom.k > 1 || ptrs.size === 2) linesEl.setPointerCapture?.(e.pointerId)
      }
      const onDrag = (e: PointerEvent) => {
        const prev = ptrs.get(e.pointerId)
        if (!prev) return
        const cur = stageXY(e)
        ptrs.set(e.pointerId, cur)
        if (ptrs.size === 2 && pinch0) {
          const [a, b] = [...ptrs.values()]
          const d = Math.hypot(a[0] - b[0], a[1] - b[1])
          if (pinch0.d > 0) zoomAt((pinch0.k * d / pinch0.d) / zoom.k, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
          dragged = true
          return
        }
        if (zoom.k <= 1) return
        // Under 4px from where it went down, a pointer is still a click.
        if (!dragged && Math.hypot(cur[0] - downAt[0], cur[1] - downAt[1]) < 4) return
        const from = dragged ? prev : downAt
        dragged = true
        zoom.tx += cur[0] - from[0]; zoom.ty += cur[1] - from[1]
        applyZoom()
        linesEl.style.cursor = "grabbing"
        tip.hidden = true
        press!.draw(); drawLines()
      }
      const onUp = (e: PointerEvent) => {
        ptrs.delete(e.pointerId)
        if (ptrs.size < 2) pinch0 = null
        if (zoom.k > 1 && view.mode !== "national") linesEl.style.cursor = "grab"
      }
      linesEl.addEventListener("pointerdown", onDown)
      linesEl.addEventListener("pointermove", onDrag)
      linesEl.addEventListener("pointerup", onUp)
      linesEl.addEventListener("pointercancel", onUp)
      cleanups.push(() => {
        linesEl.removeEventListener("pointerdown", onDown)
        linesEl.removeEventListener("pointermove", onDrag)
        linesEl.removeEventListener("pointerup", onUp)
        linesEl.removeEventListener("pointercancel", onUp)
      })

      /* The buttons: the keyboard's way in, and the way to know zoom exists.
       * They zoom about the centre of the stage. */
      const zc = (f: number) => () => zoomAt(f, W / 2, H / 2)
      const onZoomIn = zc(1.6), onZoomOut = zc(1 / 1.6)
      const onZoomReset = () => { zoom.k = 1; zoom.tx = 0; zoom.ty = 0; applyZoom(); press!.draw(); drawLines() }
      el(zoomInRef).addEventListener("click", onZoomIn)
      el(zoomOutRef).addEventListener("click", onZoomOut)
      el(zoomResetRef).addEventListener("click", onZoomReset)
      cleanups.push(() => {
        el(zoomInRef).removeEventListener("click", onZoomIn)
        el(zoomOutRef).removeEventListener("click", onZoomOut)
        el(zoomResetRef).removeEventListener("click", onZoomReset)
      })
      linesEl.style.pointerEvents = "auto"
      /* What you point at is what you get — at the pixel ON a border too.
       * pointermove reports FRACTIONAL coordinates; click and dblclick report
       * them ROUNDED. On the pixel where two districts meet, the half-pixel
       * difference picked the neighbour: the tooltip said CA-32 and the
       * click selected NV-03 (web/check.mjs border walk, 2026-09-25). So a
       * click resolves to the district the pointer was last seen over, when
       * it has not moved since; a tap with no preceding move still hits. */
      const pick = (e: MouseEvent) =>
        lastMove && Math.abs(lastMove.x - e.clientX) <= 1 && Math.abs(lastMove.y - e.clientY) <= 1
          ? lastMove.i : hit(e as PointerEvent)
      const onMove = (e: PointerEvent) => {
        const i = hit(e)
        lastMove = { x: e.clientX, y: e.clientY, i }
        if (i !== hov) { hov = i; drawLines() }
        if (i >= 0) {
          const p = shapes[i].props as DistrictProperties & { total_cents?: number; has_senate?: boolean; seat_up?: boolean }
          const senate = view.mode === "national" && view.layer === "senate"
          tip.innerHTML = senate
            ? `<b>${p.state}</b> <span class="tip-amt">${
                p.has_senate ? usdCompact(p.total_cents ?? 0) : "no Senate seats"}</span>${
                p.has_senate && !p.seat_up
                  ? `<span class="tip-flag">Coarse screen — banked, no seat up in ${CYCLE}</span>` : ""}`
            : `<b>${p.state}-${p.cd}</b> <span class="tip-amt">${usdCompact(p.pac_cents)}</span>${
                view.layer === "party" ? `<span class="tip-flag">${
                  ({ REP: "Republican-held", DEM: "Democrat-held", OTH: "Third-party member",
                     none: "No sitting member filed", several: "Several sitting members filed" } as Record<string, string>)[
                    String(p.incumbent_party)] ?? "Party not in this build"}</span>` : ""}${
                p.map_status === "cd119_superseded"
                  ? `<span class="tip-flag">Coarse screen — superseded map</span>` : ""}`
          tip.style.left = `${e.clientX}px`; tip.style.top = `${e.clientY}px`
          tip.hidden = false
        } else tip.hidden = true
      }
      const onLeave = () => { hov = -1; lastMove = null; tip.hidden = true; drawLines() }
      const onClick = (e: PointerEvent) => {
        if (dragged) { dragged = false; return }
        const i = pick(e)
        if (i < 0) return
        const p = shapes[i].props as DistrictProperties & { has_senate?: boolean; state: string }
        if (view.mode === "national" && view.layer === "senate") {
          if (p.has_senate) goTo({ mode: "state", st: p.state, geoid: null })
          return
        }
        selectShapeIndex(i)
      }
      // Double-click descends a tier. The single click still selects, and
      // the <select> still enters a state: the map click is the shortcut,
      // not the only way in, because a 2px polygon is not keyboard-reachable.
      // A double-click fires two clicks first, so the district is already
      // selected and its sheet open — which is the sheet you are descending
      // into. goTo re-selects it on the new plate and owns the URL hash last.
      const onDblClick = (e: MouseEvent) => {
        if (dragged) return
        const i = pick(e)
        if (i < 0) return
        const p = shapes[i].props as DistrictProperties
        if (view.mode === "national" && view.layer !== "senate") {
          goTo({ mode: "state", st: p.state, geoid: null }, p.geoid)
        } else if (view.mode === "state") {
          goTo({ mode: "district", st: p.state, geoid: p.geoid }, p.geoid)
        }
      }
      linesEl.addEventListener("dblclick", onDblClick)
      cleanups.push(() => linesEl.removeEventListener("dblclick", onDblClick))
      linesEl.addEventListener("pointermove", onMove)
      linesEl.addEventListener("pointerleave", onLeave)
      linesEl.addEventListener("click", onClick)
      cleanups.push(() => {
        linesEl.removeEventListener("pointermove", onMove)
        linesEl.removeEventListener("pointerleave", onLeave)
        linesEl.removeEventListener("click", onClick)
        tip.remove()
      })

      const onTheme = () => {
        dark = !dark
        document.documentElement.dataset.theme = dark ? "dark" : "light"
        const btn = el(themeBtnRef)
        btn.setAttribute("aria-pressed", String(dark))
        btn.textContent = dark ? "Warm stock" : "Dark stock"
        // Light/dark have different step tables, so the MESH changes, not
        // just the ink uniforms — layout() rebuilds it.
        const keep = sel
        layout()
        sel = keep
        paint(); drawLines()
        if (sel >= 0) {
          const geoid = (shapes[sel].props as DistrictProperties).geoid
          if (geoid) loadSheet(geoid)
        }
      }
      el(themeBtnRef).addEventListener("click", onTheme)
      cleanups.push(() => el(themeBtnRef).removeEventListener("click", onTheme))

      // Two toggles, one layer at a time: each button says what it turns
      // on, aria-pressed says whether it is on, and turning one on turns the
      // other off. layout() keeps both in step with the view.
      const onLayer = () => goTo({ layer: view.layer === "senate" ? "house" : "senate" })
      const onParty = () => goTo({ layer: view.layer === "party" ? "house" : "party" })
      el(partyBtnRef).addEventListener("click", onParty)
      cleanups.push(() => el(partyBtnRef).removeEventListener("click", onParty))
      const onHandle = () => setSheetState(el(sheetWrapRef).dataset.state === "open" ? "collapsed" : "open")
      el(sheetHandleRef).addEventListener("click", onHandle)
      cleanups.push(() => el(sheetHandleRef).removeEventListener("click", onHandle))
      el(layerBtnRef).addEventListener("click", onLayer)
      cleanups.push(() => el(layerBtnRef).removeEventListener("click", onLayer))

      const onMotion = () => {
        breathing = !breathing
        const btn = el(motionBtnRef)
        btn.setAttribute("aria-pressed", String(breathing))
        btn.textContent = breathing ? "Press breathing" : "Plates held still"
        press!.setBreathing(breathing)
      }
      el(motionBtnRef).addEventListener("click", onMotion)
      cleanups.push(() => el(motionBtnRef).removeEventListener("click", onMotion))

      const onTableToggle = () => {
        const t = el(tableRef)
        t.hidden = !t.hidden
        el(tableBtnRef).setAttribute("aria-pressed", String(!t.hidden))
        if (t.hidden) return
        if (view.mode === "national" && view.layer === "senate") {
          renderSenateTable(t, atlas!.states!.features, atlas!.senate!)
        } else {
          const rows = (view.mode !== "national" ? districtsOf(atlas!, view.st!) : atlas!.districts.features)
            .map((f) => ({ props: f.properties }))
          renderTable(t, rows, { cycle: CYCLE })
        }
      }
      el(tableBtnRef).addEventListener("click", onTableToggle)
      cleanups.push(() => el(tableBtnRef).removeEventListener("click", onTableToggle))

      /* ---- boot the press -------------------------------------------- */
      // No onFrame keyline pass. It used to re-stroke all 436 rings on every
      // animation frame while the press breathed, though the keylines never
      // move; they live on their own canvas and are redrawn only when what
      // they show changes (layout, hover, select, theme).
      press = createPress(el(glRef), { nPlates: 3, angles: ANGLES })
      ;(window as unknown as { __press?: unknown }).__press = press
      ;(window as unknown as { __redraw?: unknown }).__redraw = drawLines

      if (!press) {
        el(stageRef).innerHTML = `<div class="nogl">No WebGL2 on this device. That is the honest failure
          mode for this prototype and it is part of what is being weighed.</div>`
        for (const ref of [themeBtnRef, layerBtnRef, partyBtnRef, motionBtnRef]) {
          const b = ref.current
          if (b) { b.disabled = true; b.title = "Needs WebGL2" }
        }
        el(perfRef).textContent = "WebGL2 unavailable"
        renderLegend(el(legendRef), SYS, false, { cycle: CYCLE, labels: atlas.meta.break_labels })
        renderSheet(el(sheetRef), null, atlas.sectors, SYS, false)
        return
      }

      // Deep link: a bare geoid in the URL hash selects that district on load.
      const initialGeoid = decodeURIComponent(location.hash.replace(/^#/, ""))
      if (initialGeoid && atlas.districts.features.some((f) => f.properties.geoid === initialGeoid)) {
        goToDistrict(initialGeoid)
      } else {
        layout()
        drawLines()
        clearSheet()
      }
      press.setBreathing(true)
      press.press()
      const onResize = debounce(() => { layout(); drawLines() }, 160)
      window.addEventListener("resize", onResize)
      cleanups.push(() => window.removeEventListener("resize", onResize))

      if (press.reducedMotion) {
        const m = el(motionBtnRef)
        m.disabled = true
        m.textContent = "Reduced motion — dot gain only"
        m.title = "prefers-reduced-motion is on: no plate moves. The press cycle becomes a single dot-gain pulse."
      }
    }

    void boot()

    return () => {
      cancelled = true
      for (const fn of cleanups) fn()
      press?.stop()
      controllerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <a className="skip" href="#stage">Skip to the map</a>
      <div id="shell" ref={shellRef} />
      <div className="band" ref={bandRef} role="note" />
      <div className="statebar" ref={statebarRef} hidden />
      {/* The map first and at full height; everything you operate it with
          lives in the rail beside it, which scrolls on its own rather than
          lengthening the page. Under 900px the rail drops below the map. */}
      <div className="wrap">
        <div className="stage" id="stage" ref={stageRef}>
          <div className="stage-inner" ref={innerRef}>
            <canvas id="gl" ref={glRef} role="img" aria-label="" />
            <canvas id="lines" ref={linesRef} aria-hidden="true" />
            <div className="zoomctl" ref={zoomCtlRef} hidden role="group" aria-label="Zoom the plate">
              <button className="ctl" ref={zoomInRef} aria-label="Zoom in">+</button>
              <span className="zoomctl-k" ref={zoomLabRef} aria-live="polite">1.0×</span>
              <button className="ctl" ref={zoomOutRef} aria-label="Zoom out">−</button>
              <button className="ctl" ref={zoomResetRef}>Fit</button>
              <span className="zoomctl-hint">Pinch or Ctrl+scroll · drag to pan</span>
            </div>
          </div>
          <div className="stage-note"><span id="countline" ref={countlineRef} /></div>
          <div className="offmap" id="offmap" ref={offmapRef} />
        </div>
        <aside className="rail">
          <div className="controls">
            <button className="ctl" ref={themeBtnRef} aria-pressed="false">Dark stock</button>
            <button className="ctl" ref={layerBtnRef} aria-pressed="false">Senate layer</button>
            <button className="ctl" ref={partyBtnRef} aria-pressed="false">Party layer</button>
            <button className="ctl" ref={tableBtnRef} aria-pressed="false">Table view</button>
            <button className="ctl" ref={motionBtnRef} aria-pressed="true">Press breathing</button>
            <span className="picker" ref={pickerRef} />
          </div>
          <Finder controller={controllerRef} cycle={CYCLE} />
          <div ref={legendRef} />
          <div className="sheetwrap" ref={sheetWrapRef} data-state="empty">
            <button className="sheet-handle" ref={sheetHandleRef} aria-expanded="false">
              District details
            </button>
            <div className="sheet" ref={sheetRef} aria-live="polite" />
          </div>
          <span className="stage-note perf" ref={perfRef} />
        </aside>
      </div>
      <div className="tablewrap" ref={tableRef} hidden />
      {/* Every word of the colophon is kept — it is the honesty of the
          thing — but it is not the first thing a reader needs, so it folds.
          A <details> is keyboard- and screen-reader-native; no script. */}
      <details className="colophon">
        <summary>How to read this map</summary>
        <p><strong>What this is:</strong> money only, printed with three real
          Riso drum inks — Yellow, Fluorescent Pink and Medium Blue. Each money
          step overprints at most two neighbouring drums, the way a riso shop
          builds a colour: yellow and pink make the oranges and corals at the
          bottom of the range, pink and blue the violets and indigo at the top.
          On dark stock the same drums print as light, and the most money
          glows brightest: plum, magenta, rose, gold, yellow.</p>
        <p><strong>Senate layer:</strong> printed on its own drums — Aqua,
          Teal and Burgundy — so it can never be read on the House
          map&rsquo;s scale.</p>
        <p><strong>What it does not encode:</strong> on the money map, party
          or sector — a district&rsquo;s colour is its total PAC money and
          nothing else. Party is a separate layer you switch to, never mixed
          into the money.</p>
        <p><strong>Zoom:</strong> a blow-up is a NEW PLATE, re-screened
          coarser ({CELL.cd119_current.toFixed(1)}px cells nationally; in a
          state, as coarse as its small districts allow &mdash; a quarter of
          them must hold {MIN_CELLS_ACROSS} dots across &mdash; up to{" "}
          {(CELL.cd119_current * STATE_SCALE).toFixed(1)}px;{" "}
          {(CELL.cd119_current * DISTRICT_SCALE).toFixed(1)}px for one
          district), not a camera move over the same one. The certainty ratios
          scale with it, so a superseded district stays{" "}
          {(CELL.cd119_superseded / CELL.cd119_current).toFixed(2)}&times;
          coarser than a current one at every size. Inside a state you can
          also zoom by hand (pinch, Ctrl+scroll or the buttons): the
          districts grow and the screen holds its ruling, so a small district
          fills with more dots rather than bigger ones.</p>
        <p><strong>Zoom by hand:</strong> double-click a state to blow it
          up, and a district inside it to blow that up again. The state list
          and the search box reach the same places from a keyboard.</p>
        <p><strong>Party layer:</strong> the incumbent&rsquo;s party as red or
          blue, in four money steps rather than six so the two parties stay
          apart for colour-blind readers. A seat with no single party
          incumbent is gray and hatched, never painted a party.</p>
        <p><strong>Motion:</strong> each district&rsquo;s plates drift a
          fraction of a dot out of register on their own clock, the way a
          real press never quite holds registration. With reduced motion on,
          nothing moves.</p>
        <p>PAC contributions only (FEC transaction types 24K and 24Z).
          Independent expenditures are not contributions and are never
          counted here. No individual contributor is ever named.</p>
      </details>
    </>
  )
}
