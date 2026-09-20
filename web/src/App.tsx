import { useEffect, useRef } from "react"
import {
  D, SCREEN_ANGLES, densityT, sequentialPlates, usdCompact,
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
  CELL, FLAT_CELL, NATIONAL_SCALE, STATE_SCALE, makeStateProjection,
  districtsOf, stateIndex, quantileBreaks, renderCycleBand,
  renderSenateLegend, renderSenateTable, renderStateBar, renderStatePicker,
} from "./lib/view"
import { fetchDistrictPage, renderDistrictPageSheet } from "./lib/districtPage"
import { DEFAULT_CYCLE, type Cycle } from "./lib/config"
import { Finder } from "./components/Finder"

const SYS = D
const CYCLE: Cycle = DEFAULT_CYCLE
/* Three plates, three angles. GLOBAL — one angle per plate for the whole
   sheet, never per district. See plate.ts's header comment. */
const ANGLES = [SCREEN_ANGLES.color, SCREEN_ANGLES.key, SCREEN_ANGLES.second]

type ViewMode = "national" | "state"
interface ViewState { mode: ViewMode; st: string | null; layer: "house" | "senate" }

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

  const themeBtnRef = useRef<HTMLButtonElement>(null)
  const layerBtnRef = useRef<HTMLButtonElement>(null)
  const motionBtnRef = useRef<HTMLButtonElement>(null)
  const tableBtnRef = useRef<HTMLButtonElement>(null)

  /** Exposed to the Finder panel, which lives outside the imperative
   * controller's own DOM subtree. */
  const controllerRef = useRef<{ goToDistrict: (geoid: string) => void; goToState: (state: string) => void } | null>(null)

  useEffect(() => {
    let cancelled = false
    let press: Press | null = null
    let atlas: Atlas | null = null
    let shapes: ProjectedShape<DistrictProperties>[] = []
    let picker: ((x: number, y: number) => number) | null = null
    let sel = -1, hov = -1
    let W = 0, H = 0
    let offmap: Atlas["districts"]["features"] = []
    let mesh: ReturnType<typeof triangulatePlates> | null = null
    let dark = false
    let breathing = true
    let view: ViewState = { mode: "national", st: null, layer: "house" }
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
      const tLoad = performance.now() - t0

      BREAKS = atlas.meta.breaks_cents
      SEN_BREAKS = quantileBreaks(
        atlas.states!.features.filter((f) => f.properties.has_senate)
          .map((f) => f.properties.total_cents))

      el(shellRef).innerHTML = shellHTML({
        kicker: `follow the donors · ${CYCLE} cycle`,
        title: "Federal PAC Money by District",
        thesis: "Federal PAC money, printed on three drums. Dot size is the "
          + "money; how coarse the screen is, is how sure we are the "
          + "district is still shaped like that.",
        meta: atlas.meta,
      })
      renderCycleBand(el(bandRef), atlas.meta)
      renderStatePicker(el(pickerRef), stateIndex(atlas), (st) => goTo({ mode: "state", st }))

      const stepTable = () => (dark ? SYS.tableDark! : SYS.table!)

      const encodeHouse = () => (p: Record<string, unknown>) => ({
        cov: sequentialPlates(densityT(p.pac_cents as number, BREAKS), 3, stepTable()),
        cell: (CELL[p.map_status as string] ?? FLAT_CELL) * 1,
      })
      const encodeSenate = () => (p: Record<string, unknown>) => ({
        cov: p.has_senate
          ? sequentialPlates(densityT(p.total_cents as number, SEN_BREAKS), 3, stepTable())
          : [0, 0, 0],
        cell: p.seat_up ? CELL.cd119_current : CELL.cd119_superseded,
      })

      function layout() {
        const box = el(stageRef).getBoundingClientRect()
        W = Math.max(320, Math.round(box.width))
        H = Math.round(W * 0.60)
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        press!.resize(W, H, dpr)
        const lc = el(linesRef) as HTMLCanvasElement
        lc.width = Math.round(W * dpr); lc.height = Math.round(H * dpr)
        lc.style.width = `${W}px`; lc.style.height = `${H}px`

        const senate = view.mode === "national" && view.layer === "senate"
        let feats: Atlas["districts"]["features"], proj: ReturnType<typeof makeProjection>

        if (view.mode === "state") {
          feats = districtsOf(atlas!, view.st!)
          proj = makeStateProjection(feats, W, H)
          offmap = []
          press!.setCellScale(STATE_SCALE)
        } else {
          const src = senate
            ? { type: "FeatureCollection" as const, features: atlas!.states!.features }
            : atlas!.districts
          const part = partitionProjectable(src as never)
          feats = part.mapped.features as never
          offmap = senate ? [] : part.offmap as never
          proj = makeProjection(part.mapped as never, W, H)
          press!.setCellScale(NATIONAL_SCALE)
        }

        const encode = senate ? encodeSenate() : encodeHouse()
        shapes = measure(projectAll({ type: "FeatureCollection", features: feats } as never, proj as never)) as never
        mesh = triangulatePlates(feats as never, proj as never, encode as never)
        press!.setMesh(mesh.data, mesh.count)
        picker = makePicker(shapes, W, H, 1)
        sel = -1; hov = -1

        el(glRef).setAttribute("aria-label", senate
          ? `Halftone map of PAC contributions to Senate candidates by state, ${CYCLE} cycle`
          : view.mode === "state"
            ? `Halftone map of PAC contributions by congressional district in ${view.st}, ${CYCLE} cycle`
            : `Halftone map of PAC contributions by congressional district, ${CYCLE} cycle`)

        paint()
        renderOffmap(el(offmapRef), offmap, SYS, dark, (geoid) => {
          const f = offmap.find((x) => x.properties.geoid === geoid)
          if (f) renderSheet(el(sheetRef), { props: f.properties }, atlas!.sectors, SYS, dark)
        }, BREAKS)

        renderStateBar(el(statebarRef), {
          state: view.mode === "state" ? view.st : null,
          districts: view.mode === "state" ? districtsOf(atlas!, view.st!) : [],
          senate: view.mode === "state"
            ? atlas!.states!.features.find((f) => f.properties.state === view.st)?.properties
            : null,
          cycle: CYCLE,
        })
        const back = document.getElementById("backtonational")
        if (back) back.addEventListener("click", () => goTo({ mode: "national" }))

        el(countlineRef).textContent = senate
          ? `WebGL2 halftone · three plates · ${shapes.length} states`
          : `WebGL2 halftone · three plates · Kubelka-Munk overprint · ${shapes.length} districts`

        const lay = el(layerBtnRef)
        lay.disabled = view.mode === "state"
        lay.title = view.mode === "state"
          ? "In a state view both layers are shown — House as the fill, Senate in the rail"
          : ""
      }

      function paint() {
        press!.setPaper(dark ? SYS.paperDark : SYS.paper)
        press!.setDark(dark)
        press!.setInks(dark
          ? [SYS.platesDark!.first, SYS.platesDark!.second, SYS.platesDark!.third]
          : [SYS.plates!.first, SYS.plates!.second, SYS.plates!.third])
        press!.draw()
        paintLegend()
      }

      function drawLines() {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const ctx = el(linesRef).getContext("2d")!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, W, H)
        const trace = (s: ProjectedShape<DistrictProperties>) => {
          ctx.beginPath()
          for (const r of s.rings) {
            ctx.moveTo(r.xy[0], r.xy[1])
            for (let k = 2; k < r.xy.length; k += 2) ctx.lineTo(r.xy[k], r.xy[k + 1])
            ctx.closePath()
          }
        }
        ctx.lineWidth = view.mode === "state" ? 1.1 : 0.75
        ctx.lineJoin = "round"
        ctx.strokeStyle = dark ? "rgba(237,237,230,.50)" : "rgba(27,27,24,.62)"
        for (const s of shapes) { trace(s); ctx.stroke() }
        if (hov >= 0 && hov !== sel) {
          ctx.lineWidth = 1.8; ctx.strokeStyle = dark ? "#EDEDE6" : "#1b1b18"
          trace(shapes[hov]); ctx.stroke()
        }
        if (sel >= 0) {
          ctx.lineWidth = 2.4; ctx.strokeStyle = dark ? "#EDEDE6" : "#1b1b18"
          trace(shapes[sel]); ctx.stroke()
        }
      }

      function paintLegend() {
        const senate = view.mode === "national" && view.layer === "senate"
        const legendEl = el(legendRef)
        if (senate) { renderSenateLegend(legendEl, atlas!.senate!); return }
        renderLegend(legendEl, SYS, dark, {
          cycle: CYCLE,
          labels: atlas!.meta.break_labels,
          staleLabel: "Superseded — printed coarse; a redraw is in effect and we cannot draw it",
        })
        legendEl.querySelectorAll(".legend-chip").forEach((chip, i) => {
          const cv = document.createElement("canvas")
          const w = 60, h = 26
          cv.width = w; cv.height = h
          const c = cv.getContext("2d")!
          c.fillStyle = dark ? SYS.paperDark : SYS.paper; c.fillRect(0, 0, w, h)
          const cov = sequentialPlates(i / 5, 3)
          const pl = dark
            ? [SYS.platesDark!.first, SYS.platesDark!.second, SYS.platesDark!.third]
            : [SYS.plates!.first, SYS.plates!.second, SYS.plates!.third]
          c.globalCompositeOperation = dark ? "lighter" : "source-over"
          for (let k = 0; k < 3; k++) halftoneRect(c, 0, 0, w, h, pl[k], ANGLES[k], cov[k], 8.4)
          c.globalCompositeOperation = "source-over"
          chip.innerHTML = ""; chip.appendChild(cv)
        })
      }

      /** Fetches the richer stage-09 page for the selected district and
       * replaces the lightweight geometry-sourced sheet once it lands. */
      function loadSheet(geoid: string) {
        renderSheet(el(sheetRef), null, atlas!.sectors, SYS, dark)
        void fetchDistrictPage(geoid, CYCLE).then((page) => {
          if (!cancelled) renderDistrictPageSheet(el(sheetRef), page, SYS, dark)
        }).catch(() => { /* geometry-sourced sheet already showed something */ })
      }

      function selectShapeIndex(i: number) {
        sel = i
        drawLines()
        const geoid = (shapes[i].props as DistrictProperties).geoid
        if (geoid) loadSheet(geoid)
        else renderSheet(el(sheetRef), shapes[i] as never, atlas!.sectors, SYS, dark)
        history.replaceState(null, "", `#${geoid ?? ""}`)
      }

      function goTo(next: Partial<ViewState>, afterGeoid?: string) {
        view = { ...view, ...next }
        if (next.mode === "national") view.st = null
        el(innerRef).classList.add("is-swapping")
        const go = () => {
          el(innerRef).classList.remove("is-swapping")
          layout()
          press!.press()
          drawLines()
          renderSheet(el(sheetRef), null, atlas!.sectors, SYS, dark)
          if (afterGeoid) {
            const i = shapes.findIndex((s) => (s.props as DistrictProperties).geoid === afterGeoid)
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
        goTo({ mode: "state", st: state })
      }
      controllerRef.current = { goToDistrict, goToState }

      /* ---- interaction --------------------------------------------- */
      document.body.appendChild(tip)
      const linesEl = el(linesRef)
      const hit = (e: PointerEvent) => {
        const r = linesEl.getBoundingClientRect()
        return picker!((e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height))
      }
      linesEl.style.pointerEvents = "auto"
      const onMove = (e: PointerEvent) => {
        const i = hit(e)
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
                p.map_status === "cd119_superseded"
                  ? `<span class="tip-flag">Coarse screen — superseded map</span>` : ""}`
          tip.style.left = `${e.clientX}px`; tip.style.top = `${e.clientY}px`
          tip.hidden = false
        } else tip.hidden = true
      }
      const onLeave = () => { hov = -1; tip.hidden = true; drawLines() }
      const onClick = (e: PointerEvent) => {
        const i = hit(e)
        if (i < 0) return
        const p = shapes[i].props as DistrictProperties & { has_senate?: boolean; state: string }
        if (view.mode === "national" && view.layer === "senate") {
          if (p.has_senate) goTo({ mode: "state", st: p.state })
          return
        }
        selectShapeIndex(i)
      }
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

      const onLayer = () => {
        const senate = view.layer !== "senate"
        const btn = el(layerBtnRef)
        btn.setAttribute("aria-pressed", String(senate))
        btn.textContent = senate ? "House layer" : "Senate layer"
        goTo({ layer: senate ? "senate" : "house" })
      }
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
          const rows = (view.mode === "state" ? districtsOf(atlas!, view.st!) : atlas!.districts.features)
            .map((f) => ({ props: f.properties }))
          renderTable(t, rows, { cycle: CYCLE })
        }
      }
      el(tableBtnRef).addEventListener("click", onTableToggle)
      cleanups.push(() => el(tableBtnRef).removeEventListener("click", onTableToggle))

      /* ---- boot the press -------------------------------------------- */
      press = createPress(el(glRef), { nPlates: 3, angles: ANGLES, onFrame: drawLines })
      ;(window as unknown as { __press?: unknown }).__press = press

      if (!press) {
        el(stageRef).innerHTML = `<div class="nogl">No WebGL2 on this device. That is the honest failure
          mode for this prototype and it is part of what is being weighed.</div>`
        for (const ref of [themeBtnRef, layerBtnRef, motionBtnRef]) {
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
        renderSheet(el(sheetRef), null, atlas.sectors, SYS, dark)
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
      const t1 = performance.now()
      el(perfRef).textContent =
        `data ${tLoad.toFixed(0)}ms · mesh ${(mesh?.count ?? 0).toLocaleString()} verts · first paint ${(t1 - t0).toFixed(0)}ms`
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
      <div className="controls">
        <button className="ctl" ref={themeBtnRef} aria-pressed="false">Dark stock</button>
        <button className="ctl" ref={layerBtnRef} aria-pressed="false">Senate layer</button>
        <button className="ctl" ref={tableBtnRef} aria-pressed="false">Table view</button>
        <button className="ctl" ref={motionBtnRef} aria-pressed="true">Press breathing</button>
        <span ref={pickerRef} />
        <span className="stage-note" ref={perfRef} />
      </div>
      <Finder controller={controllerRef} cycle={CYCLE} />
      <div className="statebar" ref={statebarRef} hidden />
      <div className="wrap">
        <div className="stage" id="stage" ref={stageRef}>
          <div className="stage-inner" ref={innerRef}>
            <canvas id="gl" ref={glRef} role="img" aria-label="" />
            <canvas ref={linesRef} aria-hidden="true" />
          </div>
          <div className="stage-note"><span ref={countlineRef} /></div>
          <div className="offmap" ref={offmapRef} />
        </div>
        <aside className="rail">
          <div ref={legendRef} />
          <div className="sheet" ref={sheetRef} aria-live="polite" />
        </aside>
      </div>
      <div className="tablewrap" ref={tableRef} hidden />
      <div className="colophon">
        <h2>Federal PAC money by congressional district</h2>
        <p><strong>What this is:</strong> money only, across three drums. The
          tonal range is built the way a three-colour riso builds it — green
          inks up across the bottom of the range, teal-blue lays on across the
          middle, navy across the top — so the darkest districts are an{" "}
          <em>overprint</em> rather than a swatch someone picked.</p>
        <p><strong>What it does not encode:</strong> party or sector — a
          district's colour is its total PAC money and nothing else.</p>
        <p><strong>Zoom:</strong> a blow-up is a NEW PLATE, re-screened
          coarser (3.6px cells nationally, 8px in a state), not a camera move
          over the same one. The certainty ratios scale with it, so a
          superseded district stays 2.33&times; coarser than a current one at
          either size.</p>
        <p>PAC contributions only (FEC transaction types 24K and 24Z).
          Independent expenditures are not contributions and are never
          counted here. No individual contributor is ever named.</p>
      </div>
    </>
  )
}
