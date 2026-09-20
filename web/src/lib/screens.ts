/**
 * Canvas2D halftone screen, used to draw real per-plate swatches in D's
 * legend so a reader compares like with like — a flat chip beside a dotted
 * map would be a lie about what they are looking at.
 *
 * It exists because the same bug was written twice. Generating the dot grid
 * by looping x and y over the TARGET rectangle and then rotating each point
 * moves the grid off the target: at a 75° screen angle the rotated coverage
 * of a w×h box misses the right-hand edge entirely, so the second plate
 * silently vanished from the darkest legend steps — exactly the steps where
 * the overprint is the whole point.
 *
 * The fix is to rotate about the centre and iterate over a square big enough
 * to contain the box at ANY angle, i.e. its diagonal. One helper, one place
 * to get it right.
 *
 * Ported from web/prototypes/shared/screens.js (halftoneRect only — ruleRect
 * belongs to prototype C, which v1 does not ship).
 */

/** One halftone plate inside the rect (x,y,w,h). `cov` is 0..1 ink coverage. */
export function halftoneRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  hex: string, angleDeg: number, cov: number, cell = 7, alpha = 0.85,
): void {
  if (cov <= 0) return
  const a = angleDeg * Math.PI / 180
  const cos = Math.cos(a), sin = Math.sin(a)
  const cx = x + w / 2, cy = y + h / 2
  // 0.707 is the cell half-diagonal: at coverage 1 the dot closes the cell.
  const R = Math.sqrt(cov) * 0.707 * cell
  const D = Math.hypot(w, h) / 2 + cell * 2
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
  ctx.globalAlpha = alpha; ctx.fillStyle = hex
  for (let v = -D; v <= D; v += cell)
    for (let u = -D; u <= D; u += cell) {
      const px = cx + u * cos - v * sin
      const py = cy + u * sin + v * cos
      ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2); ctx.fill()
    }
  ctx.restore()
}
