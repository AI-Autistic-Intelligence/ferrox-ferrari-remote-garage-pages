// Dependency-free SVG charting for the pit wall console.
const NS = 'http://www.w3.org/2000/svg';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function nearestIndex(points, x) {
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) lo = mid; else hi = mid;
  }
  return Math.abs(points[lo].x - x) <= Math.abs(points[hi].x - x) ? lo : hi;
}

/**
 * series: [{ name, colour, points: [{x, y}], width?, dash?, step?, area? }]
 */
export function lineChart(el, opts) {
  const series = (opts.series || []).filter((s) => s.points && s.points.length);
  el.innerHTML = '';
  el.classList.add('chart');
  if (!series.length) {
    el.innerHTML = `<p class="muted">${esc(opts.empty || 'No data published for this selection.')}</p>`;
    return;
  }
  const W = Math.max(el.clientWidth || 600, 280);
  const H = opts.height || 220;
  const m = { t: 10, r: 14, b: opts.xLabel ? 32 : 22, l: 52 };
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  const xMin = opts.xMin ?? Math.min(...xs), xMax = opts.xMax ?? Math.max(...xs);
  let yMin = opts.yMin ?? Math.min(...ys), yMax = opts.yMax ?? Math.max(...ys);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * (opts.yPad ?? 0.06);
  if (opts.yMin === undefined) yMin -= pad;
  if (opts.yMax === undefined) yMax += pad;
  const sx = (x) => m.l + ((x - xMin) / (xMax - xMin || 1)) * (W - m.l - m.r);
  const sy = (y) => (opts.invertY
    ? m.t + ((y - yMin) / (yMax - yMin)) * (H - m.t - m.b)
    : H - m.b - ((y - yMin) / (yMax - yMin)) * (H - m.t - m.b));
  const xf = opts.xFmt || ((v) => v);
  const yf = opts.yFmt || ((v) => v);

  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(opts.title || 'chart')}">`;
  for (const b of opts.bands || []) {
    svg += `<rect x="${sx(b.x0)}" y="${m.t}" width="${Math.max(sx(b.x1) - sx(b.x0), 1)}" height="${H - m.t - m.b}" fill="${b.colour}" opacity="${b.opacity ?? 0.08}"/>`;
  }
  svg += '<g class="axis">';
  for (const t of niceTicks(yMin, yMax, opts.yTicks || 4)) {
    svg += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${sy(t)}" y2="${sy(t)}"/><text x="${m.l - 6}" y="${sy(t) + 3}" text-anchor="end">${esc(yf(t))}</text>`;
  }
  for (const t of niceTicks(xMin, xMax, opts.xTicks || 8)) {
    svg += `<text x="${sx(t)}" y="${H - m.b + 14}" text-anchor="middle">${esc(xf(t))}</text>`;
  }
  svg += '</g>';
  if (opts.zeroLine && yMin < 0 && yMax > 0) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" stroke="rgba(255,255,255,0.3)"/>`;
  }
  if (opts.xLabel) svg += `<text class="axis-label" x="${W - m.r}" y="${H - 2}" text-anchor="end">${esc(opts.xLabel)}</text>`;
  if (opts.yLabel) svg += `<text class="axis-label" x="${m.l}" y="${m.t + 2}" dx="4" dy="8">${esc(opts.yLabel)}</text>`;

  for (const s of series) {
    let d = '';
    s.points.forEach((p, i) => {
      const X = sx(p.x).toFixed(1), Y = sy(p.y).toFixed(1);
      if (i === 0) d += `M${X},${Y}`;
      else if (s.step) d += `H${X}V${Y}`;
      else d += `L${X},${Y}`;
    });
    if (s.area) {
      const base = sy(Math.max(yMin, Math.min(0, yMax)));
      svg += `<path d="${d}L${sx(s.points[s.points.length - 1].x)},${base}L${sx(s.points[0].x)},${base}Z" fill="${s.colour}" opacity="0.12"/>`;
    }
    svg += `<path d="${d}" fill="none" stroke="${s.colour}" stroke-width="${s.width || 1.8}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    if (s.dots) {
      for (const p of s.points) {
        if (p.mark) svg += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="3.2" fill="${p.mark}" stroke="#000" stroke-width="1"/>`;
      }
    }
  }
  for (const mk of opts.markers || []) {
    svg += `<line x1="${sx(mk.x)}" x2="${sx(mk.x)}" y1="${m.t}" y2="${H - m.b}" stroke="${mk.colour}" stroke-dasharray="2 3" opacity="0.7"/>`;
    if (mk.label) svg += `<text x="${sx(mk.x) + 3}" y="${m.t + 10}" fill="${mk.colour}" font-size="10" font-family="JetBrains Mono">${esc(mk.label)}</text>`;
  }
  svg += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
  svg += '</svg>';
  el.innerHTML = svg;

  const tip = document.createElement('div');
  tip.className = 'tooltip';
  el.appendChild(tip);
  const root = el.querySelector('svg');
  const cross = root.querySelector('.crosshair');
  const hit = root.querySelector('.hit');
  const toData = (evt) => {
    const r = root.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * W;
    return { px, x: xMin + ((px - m.l) / (W - m.l - m.r)) * (xMax - xMin), r };
  };
  hit.addEventListener('mousemove', (evt) => {
    const { x, r } = toData(evt);
    const rows = series.map((s) => {
      const p = s.points[nearestIndex(s.points, x)];
      return `<div><span style="color:${s.colour}">■</span> ${esc(s.name)}: <b>${esc(yf(p.y, true))}</b>${p.note ? ` <span class="muted">${esc(p.note)}</span>` : ''}</div>`;
    });
    const X = sx(x);
    cross.setAttribute('x1', X); cross.setAttribute('x2', X); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="muted">${esc(xf(x, true))}</div>${rows.join('')}`;
    tip.style.left = `${(X / W) * r.width}px`;
    tip.style.top = `${evt.clientY - r.top}px`;
    tip.classList.add('show');
    if (opts.onHover) opts.onHover(x);
  });
  hit.addEventListener('mouseleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tip.classList.remove('show');
    if (opts.onHover) opts.onHover(null);
  });
}

/** Colour scale from slow (blue) to fast (red/yellow) for speed heat maps. */
export function speedColour(v, min, max) {
  const k = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  const stops = [[47, 140, 255], [46, 229, 157], [255, 212, 0], [225, 6, 0]];
  const pos = k * (stops.length - 1);
  const i = Math.min(Math.floor(pos), stops.length - 2);
  const f = pos - i;
  const c = stops[i].map((a, j) => Math.round(a + (stops[i + 1][j] - a) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Draws the circuit from OpenF1 positions. colourFn(point, index) -> stroke colour per segment.
 * Returns helpers to place a marker.
 */
export function trackMap(el, map, colourFn, opts = {}) {
  el.innerHTML = '';
  if (!map || !map.points || map.points.length < 2) {
    el.innerHTML = '<p class="muted">OpenF1 published no position data for this lap.</p>';
    return { place() {} };
  }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
  svg.setAttribute('class', 'track-svg');
  const pts = map.points;
  const base = document.createElementNS(NS, 'polyline');
  base.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
  base.setAttribute('class', 'track-base');
  svg.appendChild(base);
  for (let i = 1; i < pts.length; i++) {
    const seg = document.createElementNS(NS, 'line');
    seg.setAttribute('x1', pts[i - 1].x); seg.setAttribute('y1', pts[i - 1].y);
    seg.setAttribute('x2', pts[i].x); seg.setAttribute('y2', pts[i].y);
    seg.setAttribute('stroke', colourFn(pts[i], i));
    seg.setAttribute('stroke-width', opts.width || 5);
    seg.setAttribute('stroke-linecap', 'round');
    svg.appendChild(seg);
  }
  const start = document.createElementNS(NS, 'rect');
  start.setAttribute('x', pts[0].x - 6); start.setAttribute('y', pts[0].y - 2);
  start.setAttribute('width', 12); start.setAttribute('height', 4);
  start.setAttribute('fill', '#fff');
  svg.appendChild(start);
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('r', 8); dot.setAttribute('class', 'car-dot'); dot.setAttribute('visibility', 'hidden');
  svg.appendChild(dot);
  el.appendChild(svg);
  return {
    place(x, y) {
      if (x === null || x === undefined) { dot.setAttribute('visibility', 'hidden'); return; }
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
    },
    placeAtDistance(d) {
      if (d === null) { dot.setAttribute('visibility', 'hidden'); return; }
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.d - d) < Math.abs(best.d - d)) best = p;
      this.place(best.x, best.y);
    },
  };
}
