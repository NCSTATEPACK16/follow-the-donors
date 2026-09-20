/**
 * Canvas2D halftone and ruling screens, shared by the legends and the
 * index-page swatches.
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
 */

/** One halftone plate inside the rect (x,y,w,h). `cov` is 0..1 ink coverage. */
export function halftoneRect(ctx, x, y, w, h, hex, angleDeg, cov, cell = 7, alpha = 0.85) {
  if (cov <= 0) return;
  const a = angleDeg * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const cx = x + w / 2, cy = y + h / 2;
  // 0.707 is the cell half-diagonal: at coverage 1 the dot closes the cell.
  const R = Math.sqrt(cov) * 0.707 * cell;
  const D = Math.hypot(w, h) / 2 + cell * 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.globalAlpha = alpha; ctx.fillStyle = hex;
  for (let v = -D; v <= D; v += cell)
    for (let u = -D; u <= D; u += cell) {
      const px = cx + u * cos - v * sin;
      const py = cy + u * sin + v * cos;
      ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2); ctx.fill();
    }
  ctx.restore();
}

/** One engraved ruling inside the rect. Line weight carries the tone. */
export function ruleRect(ctx, x, y, w, h, hex, angleDeg, cov, gap = 5, alpha = 1) {
  if (cov <= 0) return;
  const a = angleDeg * Math.PI / 180;
  const cx = x + w / 2, cy = y + h / 2;
  const D = Math.hypot(w, h) / 2 + gap * 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(cx, cy); ctx.rotate(a);
  ctx.globalAlpha = alpha; ctx.strokeStyle = hex;
  ctx.lineWidth = Math.max(0.35, gap * cov);
  ctx.lineCap = "butt";
  ctx.beginPath();
  for (let v = -D; v <= D; v += gap) { ctx.moveTo(-D, v); ctx.lineTo(D, v); }
  ctx.stroke();
  ctx.restore();
}
