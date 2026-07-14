// The decade-columns miniature, shared by the portrait export and the
// colophon ("The Record"). One renderer so the built story is drawn the
// same way everywhere: era-tinted bars, hairline baselines, empty decades
// visibly empty.

export function drawColumnsFigure(ctx, { x, y, w, h, decades, tokens }) {
  if (!decades?.length) return;
  const gap = Math.max(8, w * 0.015);
  const colW = (w - gap * (decades.length - 1)) / decades.length;
  const labelH = 18;
  const barMaxH = h - labelH - 8;
  const maxCount = Math.max(1, ...decades.map((d) => d.count));

  ctx.save();
  ctx.font = `11px ${tokens.sans}`;
  decades.forEach((d, i) => {
    const cx = x + i * (colW + gap);
    const hgt = (d.count / maxCount) * barMaxH;
    ctx.fillStyle = tokens.eras[d.eraIndex];
    ctx.fillRect(cx, y + barMaxH - hgt, colW, hgt);
    ctx.strokeStyle = tokens.hairline;
    ctx.beginPath();
    ctx.moveTo(cx, y + barMaxH + 0.5);
    ctx.lineTo(cx + colW, y + barMaxH + 0.5);
    ctx.stroke();
    ctx.fillStyle = tokens.ink;
    ctx.globalAlpha = 0.62;
    const label = d.start === null ? 'pre-’40' : `’${String(d.start).slice(2)}s`;
    ctx.fillText(label, cx, y + barMaxH + 15);
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}
