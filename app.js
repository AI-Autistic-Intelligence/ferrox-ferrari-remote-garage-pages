import { esc, lineChart, speedColour, trackMap } from './charts.js';

const $ = (id) => document.getElementById(id);
const REF_COLOUR = '#e10600';
const CMP_COLOUR = '#ffd400';
const COMPOUND_COLOUR = { SOFT: '#ff3b3b', MEDIUM: '#ffd400', HARD: '#f2f2f2', INTERMEDIATE: '#2ecc71', WET: '#2f8cff' };

const state = { sessionKey: null, overview: null, replay: null, replayMap: null };

/* ---------------- helpers ---------------- */
let pending = 0;
function loading(delta) {
  pending += delta;
  const bar = $('loader');
  bar.style.opacity = pending > 0 ? '1' : '0';
  bar.style.width = pending > 0 ? `${Math.min(90, 25 + pending * 15)}%` : '100%';
  if (pending === 0) setTimeout(() => { if (pending === 0) bar.style.width = '0'; }, 400);
}

async function api(path) {
  loading(1);
  try {
    let target = path;
    const isPages = window.location.hostname.endsWith('github.io') || window.location.protocol === 'file:' || !window.location.port;
    if (isPages) {
      if (path === '/api/health') target = './data/health.json';
      else if (path.startsWith('/api/sessions?year=')) {
        const yr = new URL(path, window.location.href).searchParams.get('year') || '2026';
        target = `./data/sessions-${yr}.json`;
      } else if (path === '/api/sessions/default') target = './data/sessions-default.json';
      else if (path.includes('/overview')) target = './data/overview-11396.json';
      else if (path.includes('/compare')) target = './data/compare-11396.json';
      else if (path.includes('/telemetry')) target = './data/telemetry-11396-16.json';
      else if (path === '/api/championship') target = './data/championship.json';
      else if (path === '/api/maranello') target = './data/maranello.json';
    }
    const res = await fetch(target, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.message || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    loading(-1);
  }
}

const fmtLap = (s) => {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m > 0 ? `${m}:${r.toFixed(3).padStart(6, '0')}` : r.toFixed(3);
};
const fmt = (v, d = 1, unit = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${unit}`);
const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
const dateLong = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
const colour = (hex) => `#${(hex || '888888').replace('#', '')}`;

function alertBox(html, kind = 'warning') {
  $('alerts').innerHTML = html ? `<div class="${kind}">${html}</div>` : '';
}

/* ---------------- header: sources & selectors ---------------- */
async function loadHealth() {
  try {
    const h = await api('/api/health');
    $('sources').innerHTML = h.upstreams
      .map((u) => {
        const cls = u.failures > 0 && !u.lastSuccessAt ? 'err' : 'ok';
        const title = `${u.baseUrl} · ${u.networkRequests} requests · ${u.cacheHits} cache hits${u.lastError ? ` · last error: ${u.lastError}` : ''}`;
        return `<span class="pill" title="${esc(title)}"><span class="dot ${cls}"></span>${esc(u.source)}</span>`;
      })
      .join('');
  } catch {
    $('sources').innerHTML = '<span class="pill"><span class="dot err"></span>API offline</span>';
  }
}

async function loadSessionList(year, selectKey) {
  const { sessions } = await api(`/api/sessions?year=${year}`);
  $('session-select').innerHTML = sessions
    .map((s) => {
      const d = new Date(s.dateStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const badge = s.availability === 'available' ? '' : s.availability === 'live' ? ' · LIVE (paid tier)' : ' · upcoming';
      return `<option value="${s.sessionKey}" ${s.availability !== 'available' ? 'disabled' : ''} ${s.sessionKey === selectKey ? 'selected' : ''}>${esc(`${d} · ${s.circuit} · ${s.name}${badge}`)}</option>`;
    })
    .join('');
  if (!selectKey) {
    const firstAvailable = sessions.find((s) => s.availability === 'available');
    if (firstAvailable) $('session-select').value = String(firstAvailable.sessionKey);
  }
}

/* ---------------- session overview ---------------- */
async function loadSession(key) {
  state.sessionKey = key;
  history.replaceState(null, '', `#session=${key}`);
  stopReplay();
  alertBox('');
  $('load-btn').disabled = true;
  try {
    const ov = await api(`/api/sessions/${key}/overview`);
    state.overview = ov;
    if (ov.warnings.length) alertBox(ov.warnings.map(esc).join('<br>'));
    renderSession(ov);
    renderDrivers(ov);
    renderLapChart(ov);
    renderStrategy(ov);
    renderStints(ov);
    renderPit(ov);
    renderRaceControl(ov);
    renderRadio(ov);
    renderWeather(ov);
    renderClassification(ov);
    populateDriverSelects(ov);
    if ($('ref-driver').value && $('cmp-driver').value) compare();
  } catch (err) {
    alertBox(esc(err.message), 'error');
  } finally {
    $('load-btn').disabled = false;
    loadHealth();
  }
}

function renderSession(ov) {
  const s = ov.session;
  const w = ov.weather.summary;
  const n = ov.neutralisations;
  const fl = ov.fastestLap;
  const flDriver = fl ? ov.classification.find((c) => c.driver === fl.driver) : null;
  $('session-card').innerHTML = `
    <div class="session-kicker">${esc(s.year)} · ${esc(s.country.toUpperCase())} · SESSION ${esc(s.sessionKey)}</div>
    <div class="session-title">${esc(s.circuit)}</div>
    <div class="session-sub">${esc(s.name)} · ${esc(dateLong(s.dateStart))}</div>
    <div class="kpis">
      <div class="kpi"><label>Fastest lap</label><b>${fmtLap(fl && fl.time)}</b><br><small>${flDriver ? esc(flDriver.acronym) : ''} ${fl ? `L${fl.lap}` : ''}</small></div>
      <div class="kpi"><label>Track temp</label><b>${w ? fmt(w.trackTemperature.max, 1, '°') : '—'}</b><br><small>${w ? `min ${fmt(w.trackTemperature.min, 1, '°')}` : 'no data'}</small></div>
      <div class="kpi"><label>Air temp</label><b>${w ? fmt(w.airTemperature.avg, 1, '°') : '—'}</b><br><small>${w ? `hum. max ${fmt(w.humidityMax, 0, '%')}` : ''}</small></div>
      <div class="kpi"><label>Rain</label><b>${w ? (w.rainDetected ? 'YES' : 'DRY') : '—'}</b><br><small>${w ? `${w.samples} samples` : ''}</small></div>
      <div class="kpi"><label>SC / VSC / Red</label><b>${n.safetyCars} / ${n.virtualSafetyCars} / ${n.redFlags}</b><br><small>race control</small></div>
      <div class="kpi"><label>Median pit lane</label><b>${fmt(ov.pitLane.medianLaneTime, 1, 's')}</b><br><small>${ov.pitLane.stops} stops</small></div>
    </div>`;
}

function renderDrivers(ov) {
  if (!ov.ferrari.length) {
    $('driver-cards').innerHTML = '<article class="card"><p class="muted">No Ferrari entry in this session.</p></article>';
    return;
  }
  $('driver-cards').innerHTML = ov.ferrari
    .map((f) => {
      const d = f.driver;
      const r = f.result;
      const l = f.laps;
      const photo = d.headshotUrl ? `<img class="driver-photo" src="${esc(d.headshotUrl)}" alt="${esc(d.fullName)}" loading="lazy" referrerpolicy="no-referrer">` : '<div class="driver-photo"></div>';
      const gapToTheory = l.bestLap && l.theoreticalBest ? l.bestLap.time - l.theoreticalBest : null;
      return `<article class="card driver-card">
        ${photo}
        <div>
          <span class="driver-pos">${r ? esc(r.status) : '—'}</span>
          <div class="driver-name"><span class="num">${esc(d.number)}</span>${esc(d.fullName)}</div>
          <div class="muted" style="font-size:13px">${r ? `${esc(r.gap)} · ${esc(r.points)} pts · ${esc(r.laps)} laps` : esc(d.team)}</div>
          <div class="driver-stats">
            <div><label>Best lap</label><b>${fmtLap(l.bestLap && l.bestLap.time)}</b></div>
            <div><label>Ideal lap</label><b>${fmtLap(l.theoreticalBest)}</b></div>
            <div><label>Left on table</label><b>${fmt(gapToTheory, 3, 's')}</b></div>
            <div><label>Median pace</label><b>${fmtLap(l.medianPace)}</b></div>
            <div><label>Consistency σ</label><b>${fmt(l.consistency, 3, 's')}</b></div>
            <div><label>Speed trap</label><b>${fmt(l.topSpeedTrap, 0)}</b></div>
          </div>
        </div>
      </article>`;
    })
    .join('');
}

function safetyCarBands(ov) {
  const bands = [];
  let open = null;
  for (const m of ov.raceControl) {
    if (m.lap === null) continue;
    if (/^(VIRTUAL )?SAFETY CAR DEPLOYED/i.test(m.message)) open = { x0: m.lap, colour: /VIRTUAL/i.test(m.message) ? '#ffb020' : '#ffd400' };
    else if (open && /(IN THIS LAP|ENDING)/i.test(m.message)) { bands.push({ ...open, x1: m.lap, opacity: 0.1 }); open = null; }
    else if (m.flag === 'RED') bands.push({ x0: m.lap, x1: m.lap + 1, colour: '#e10600', opacity: 0.15 });
  }
  return bands;
}

function renderLapChart(ov) {
  const lineColours = [REF_COLOUR, CMP_COLOUR, '#43b4ff', '#b26bff'];
  const series = ov.lapChart.map((d, i) => ({
    name: d.acronym,
    colour: d.ferrari ? lineColours[i % 2] : lineColours[2 + (i % 2)],
    width: d.ferrari ? 2.2 : 1.4,
    dash: d.ferrari ? null : '4 3',
    dots: true,
    points: d.laps
      .filter((l) => l.classification === 'representative')
      .map((l) => ({ x: l.lap, y: l.time, mark: d.ferrari ? COMPOUND_COLOUR[l.compound] : null, note: l.compound || '' })),
  }));
  const markers = [];
  ov.ferrari.forEach((f, i) => f.pitStops.forEach((p) => markers.push({ x: p.lap, colour: lineColours[i % 2], label: `${f.driver.acronym} box` })));
  lineChart($('lap-chart'), {
    title: 'Lap times',
    series,
    height: 300,
    xLabel: 'lap',
    xFmt: (v, full) => (full ? `Lap ${Math.round(v)}` : Math.round(v)),
    yFmt: (v) => fmtLap(v),
    bands: safetyCarBands(ov),
    markers,
    empty: 'No representative laps in this session.',
  });
  $('lap-chart').classList.remove('skeleton');
  $('lap-legend').innerHTML =
    series.map((s) => `<span><i style="background:${s.colour}"></i>${esc(s.name)}</span>`).join('') +
    '<span><i style="background:#ffd400;opacity:.5"></i>Safety car</span><span class="muted">dots = compound · dashed = race winner</span>';
}

function renderStrategy(ov) {
  const maxLap = Math.max(1, ...ov.strategy.flatMap((d) => d.stints.map((s) => s.lapEnd)));
  $('strategy').classList.remove('skeleton');
  $('strategy').innerHTML = ov.strategy.length
    ? ov.strategy
        .map((d) => `<div class="strategy-row ${d.ferrari ? 'ferrari' : ''}">
          <div class="who"><i style="background:${colour(d.colour)}"></i>${esc(d.acronym)}</div>
          <div class="strategy-bar">${d.stints
            .map((s) => `<div class="stint c-${esc(s.compound)}" title="${esc(`${s.compound} · laps ${s.lapStart}-${s.lapEnd} · tyre age at fit ${s.tyreAgeAtStart}`)}"
              style="left:${((s.lapStart - 1) / maxLap) * 100}%;width:${((s.lapEnd - s.lapStart + 1) / maxLap) * 100}%"></div>`)
            .join('')}</div></div>`)
        .join('')
    : '<p class="muted">No stint data.</p>';
}

function renderStints(ov) {
  const rows = ov.ferrari.flatMap((f) => f.stints.map((s) => ({ ...s, acronym: f.driver.acronym })));
  $('stint-table').classList.remove('skeleton');
  $('stint-table').innerHTML = rows.length
    ? `<table><thead><tr><th>Driver</th><th>Stint</th><th>Tyre</th><th>Laps</th><th>Avg pace</th><th>Best</th><th>Deg s/lap</th><th>R²</th></tr></thead><tbody>
      ${rows
        .map((s) => `<tr class="ferrari"><td>${esc(s.acronym)}</td><td>${s.stint}</td>
          <td><span class="compound" style="border-color:${COMPOUND_COLOUR[s.compound] || '#666'};background:#fff">${esc(s.compound[0])}</span></td>
          <td>${s.lapStart}–${s.lapEnd} <span class="muted">(${s.sampleLaps} used)</span></td>
          <td>${fmtLap(s.averagePace)}</td><td>${fmtLap(s.bestLap)}</td>
          <td class="${s.degradationPerLap > 0 ? 'neg' : 'pos'}">${s.degradationPerLap === null ? '—' : (s.degradationPerLap > 0 ? '+' : '') + s.degradationPerLap.toFixed(3)}</td>
          <td>${fmt(s.fitR2, 2)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">No stints published for Ferrari in this session.</p>';
}

function renderPit(ov) {
  const pl = ov.pitLane;
  const fastestDriver = pl.fastestLaneTime ? ov.classification.find((c) => c.driver === pl.fastestLaneTime.driver) : null;
  const rows = ov.ferrari.flatMap((f) => f.pitStops.map((p) => ({ ...p, acronym: f.driver.acronym })));
  $('pit-panel').classList.remove('skeleton');
  $('pit-panel').innerHTML = `
    <div class="kpis">
      <div class="kpi"><label>Stops (all cars)</label><b>${pl.stops}</b></div>
      <div class="kpi"><label>Median lane time</label><b>${fmt(pl.medianLaneTime, 2, 's')}</b></div>
      <div class="kpi"><label>Fastest lane</label><b>${pl.fastestLaneTime ? fmt(pl.fastestLaneTime.time, 2, 's') : '—'}</b><br><small>${fastestDriver ? esc(fastestDriver.acronym) : ''}</small></div>
      <div class="kpi"><label>Safety cars</label><b>${ov.neutralisations.safetyCars}</b><br><small>VSC ${ov.neutralisations.virtualSafetyCars}</small></div>
    </div>
    <table style="margin-top:14px"><thead><tr><th>Ferrari stop</th><th>Lap</th><th>Time (UTC)</th><th>Pit lane</th><th>Δ median</th></tr></thead><tbody>
    ${rows.length
      ? rows
          .map((p) => {
            const d = p.laneDuration !== null && pl.medianLaneTime !== null ? p.laneDuration - pl.medianLaneTime : null;
            return `<tr class="ferrari"><td>${esc(p.acronym)}</td><td>${p.lap}</td><td>${esc(time(p.date))}</td><td>${fmt(p.laneDuration, 2, 's')}</td>
              <td class="${d !== null && d > 0 ? 'neg' : 'pos'}">${d === null ? '—' : (d > 0 ? '+' : '') + d.toFixed(2) + 's'}</td></tr>`;
          })
          .join('')
      : '<tr><td colspan="5" class="muted">No Ferrari pit stops recorded.</td></tr>'}
    </tbody></table>`;
}

function renderRaceControl(ov) {
  $('race-control').classList.remove('skeleton');
  $('race-control').innerHTML = ov.raceControl.length
    ? ov.raceControl
        .map((m) => `<div class="feed-item flag-${esc(m.flag || '')} cat-${esc(m.category)}">
          <div class="meta">${m.lap !== null ? `L${m.lap}` : ''}<br>${esc(time(m.date))}</div><div>${esc(m.message)}</div></div>`)
        .join('')
    : '<p class="muted">No relevant race control messages.</p>';
}

function renderRadio(ov) {
  const clips = ov.ferrari.flatMap((f) => f.radio.map((r) => ({ ...r, acronym: f.driver.acronym, name: f.driver.fullName })));
  clips.sort((a, b) => a.date.localeCompare(b.date));
  $('radio').classList.remove('skeleton');
  $('radio').innerHTML = clips.length
    ? clips
        .map((c) => `<div class="radio-item"><div class="meta">${esc(c.acronym)} · ${esc(time(c.date))} UTC</div>
          <audio controls preload="none" src="${esc(c.recordingUrl)}"></audio></div>`)
        .join('')
    : '<p class="muted">No Ferrari team radio was published for this session.</p>';
}

function renderWeather(ov) {
  const tl = ov.weather.timeline;
  const t0 = tl.length ? Date.parse(tl[0].date) : 0;
  const mins = (iso) => (Date.parse(iso) - t0) / 60000;
  lineChart($('weather-chart'), {
    title: 'Track weather',
    height: 190,
    series: [
      { name: 'Track °C', colour: REF_COLOUR, points: tl.map((w) => ({ x: mins(w.date), y: w.trackTemperature })), area: true },
      { name: 'Air °C', colour: '#43b4ff', points: tl.map((w) => ({ x: mins(w.date), y: w.airTemperature })) },
    ],
    xLabel: 'minutes',
    xFmt: (v, full) => (full ? `+${Math.round(v)} min` : Math.round(v)),
    yFmt: (v) => `${(+v).toFixed(1)}°`,
    empty: 'No trackside weather published.',
  });
  $('weather-chart').classList.remove('skeleton');
  const w = ov.weather.summary;
  $('weather-kpis').innerHTML = w
    ? `<div class="kpis" style="margin-top:10px">
        <div class="kpi"><label>Wind</label><b>${fmt(w.latest.windSpeed, 1)} m/s</b><br><small>${w.latest.windDirection}°</small></div>
        <div class="kpi"><label>Pressure</label><b>${fmt(w.latest.pressure, 1)}</b><br><small>hPa</small></div>
        <div class="kpi"><label>Humidity</label><b>${fmt(w.latest.humidity, 0, '%')}</b></div>
      </div>`
    : '';
}

function renderClassification(ov) {
  $('classification').classList.remove('skeleton');
  $('classification').innerHTML = ov.classification.length
    ? `<table><thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Laps</th><th>Gap</th><th>Pts</th></tr></thead><tbody>
      ${ov.classification
        .map((c) => `<tr class="${c.ferrari ? 'ferrari' : ''}"><td>${esc(c.status)}</td>
          <td><span class="team-chip" style="background:${colour(c.teamColour)}"></span>${esc(c.fullName)}</td>
          <td>${esc(c.team)}</td><td>${c.laps}</td><td>${esc(c.gap)}</td><td>${c.points || ''}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">No classification published.</p>';
}

/* ---------------- telemetry comparison ---------------- */
function populateDriverSelects(ov) {
  const ferrari = ov.ferrari.map((f) => f.driver.number);
  const opts = [...ov.classification]
    .sort((a, b) => (b.ferrari ? 1 : 0) - (a.ferrari ? 1 : 0))
    .map((c) => `<option value="${c.driver}">${esc(`#${c.driver} ${c.acronym} · ${c.team}`)}</option>`)
    .join('');
  for (const id of ['ref-driver', 'cmp-driver', 'replay-driver']) $(id).innerHTML = opts;
  const winner = ov.classification.find((c) => c.position === 1);
  $('ref-driver').value = String(ferrari[0] ?? (ov.classification[0] && ov.classification[0].driver));
  const cmp = ferrari[1] ?? (winner && winner.driver !== ferrari[0] ? winner.driver : ov.classification[1] && ov.classification[1].driver);
  if (cmp !== undefined) $('cmp-driver').value = String(cmp);
  $('replay-driver').value = $('ref-driver').value;
  $('ref-lap').value = ''; $('cmp-lap').value = ''; $('replay-lap').value = '';
}

async function compare() {
  const ref = $('ref-driver').value, cmp = $('cmp-driver').value;
  const q = new URLSearchParams({ ref, cmp });
  if ($('ref-lap').value) q.set('refLap', $('ref-lap').value);
  if ($('cmp-lap').value) q.set('cmpLap', $('cmp-lap').value);
  $('compare-btn').disabled = true;
  try {
    const c = await api(`/api/sessions/${state.sessionKey}/compare?${q}`);
    renderCompare(c);
  } catch (err) {
    $('tel-map').classList.remove('skeleton');
    $('tel-map').innerHTML = `<div class="error">${esc(err.message)}</div>`;
  } finally {
    $('compare-btn').disabled = false;
  }
}

function renderCompare(c) {
  const R = c.reference, C = c.comparison;
  const nameR = `${R.driver.acronym} L${R.lap.lap}`, nameC = `${C.driver.acronym} L${C.lap.lap}`;
  const len = R.stats ? R.stats.lapDistance : 0;
  const scaleC = C.stats && C.stats.lapDistance ? len / C.stats.lapDistance : 1;
  const pts = (t, key, scale = 1) => t.trace.map((p) => ({ x: p.d * scale, y: p[key] }));
  let map;
  const hover = (x) => map && map.placeAtDistance(x);
  const common = { xMin: 0, xMax: len, xFmt: (v, full) => (full ? `${Math.round(v)} m` : `${(v / 1000).toFixed(1)}k`), onHover: hover };
  lineChart($('tel-speed'), { ...common, height: 200, series: [
    { name: nameR, colour: REF_COLOUR, points: pts(R, 'speed') },
    { name: nameC, colour: CMP_COLOUR, points: pts(C, 'speed', scaleC), width: 1.4 },
  ], yFmt: (v) => Math.round(v) });
  lineChart($('tel-throttle'), { ...common, height: 90, yMin: 0, yMax: 100, yTicks: 2, series: [
    { name: nameR, colour: REF_COLOUR, points: pts(R, 'throttle') },
    { name: nameC, colour: CMP_COLOUR, points: pts(C, 'throttle', scaleC), width: 1.2 },
  ], yFmt: (v) => Math.round(v) });
  lineChart($('tel-brake'), { ...common, height: 70, yMin: 0, yMax: 100, yTicks: 1, series: [
    { name: nameR, colour: REF_COLOUR, points: pts(R, 'brake'), step: true },
    { name: nameC, colour: CMP_COLOUR, points: pts(C, 'brake', scaleC), step: true, width: 1.2 },
  ], yFmt: (v) => (v > 0 ? 'ON' : 'off') });
  lineChart($('tel-gear'), { ...common, height: 90, yMin: 1, yMax: 8, yTicks: 3, series: [
    { name: nameR, colour: REF_COLOUR, points: pts(R, 'gear'), step: true },
    { name: nameC, colour: CMP_COLOUR, points: pts(C, 'gear', scaleC), step: true, width: 1.2 },
  ], yFmt: (v) => Math.round(v) });
  const drsActive = (v) => (v !== null && v >= 10 ? 1 : 0);
  lineChart($('tel-drs'), { ...common, height: 60, yMin: 0, yMax: 1, yTicks: 1, series: [
    { name: nameR, colour: REF_COLOUR, points: R.trace.map((p) => ({ x: p.d, y: drsActive(p.drs) })), step: true },
    { name: nameC, colour: CMP_COLOUR, points: C.trace.map((p) => ({ x: p.d * scaleC, y: drsActive(p.drs) })), step: true, width: 1.2 },
  ], yFmt: (v) => (v > 0 ? 'OPEN' : 'closed') });
  lineChart($('tel-delta'), { ...common, height: 130, zeroLine: true, series: [
    { name: `${C.driver.acronym} vs ${R.driver.acronym}`, colour: '#43b4ff', points: c.delta.map((p) => ({ x: p.d, y: p.delta })), area: true },
  ], yFmt: (v, full) => `${v > 0 ? '+' : ''}${(+v).toFixed(full ? 3 : 2)}` });

  const fd = c.finalDelta;
  $('delta-head').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
    <div><span style="color:${REF_COLOUR};font-weight:900">${esc(nameR)}</span> ${fmtLap(R.lap.duration)}<br>
    <span style="color:${CMP_COLOUR};font-weight:900">${esc(nameC)}</span> ${fmtLap(C.lap.duration)}</div>
    <div class="delta-badge ${fd > 0 ? 'pos' : 'neg'}">${fd === null ? '—' : `${fd > 0 ? '+' : ''}${fd.toFixed(3)}s`}</div></div>`;

  const segFor = (d) => c.dominance.find((s) => d >= s.fromDistance && d <= s.toDistance);
  $('tel-map').classList.remove('skeleton');
  map = trackMap($('tel-map'), c.map, (p) => {
    const s = segFor(p.d);
    return s ? (s.faster === 'ref' ? REF_COLOUR : CMP_COLOUR) : '#555';
  }, { width: 6 });
  const won = c.dominance.filter((s) => s.faster === 'ref').length;
  $('map-legend').innerHTML = `<span><i style="background:${REF_COLOUR}"></i>${esc(R.driver.acronym)} faster · ${won}/${c.dominance.length} mini-sectors</span>
    <span><i style="background:${CMP_COLOUR}"></i>${esc(C.driver.acronym)} faster · ${c.dominance.length - won}</span>`;

  const sr = R.stats, sc = C.stats;
  const row = (label, a, b, d = 0, unit = '') => `<div class="kpi"><label>${label}</label><b style="color:${REF_COLOUR}">${fmt(a, d, unit)}</b> <b style="color:${CMP_COLOUR};font-size:14px">${fmt(b, d, unit)}</b></div>`;
  $('tel-stats').innerHTML = sr && sc
    ? `<div class="stat-grid">
        ${row('Top speed', sr.topSpeed, sc.topSpeed, 0)}
        ${row('Min speed', sr.minimumSpeed, sc.minimumSpeed, 0)}
        ${row('Full throttle', sr.fullThrottlePct, sc.fullThrottlePct, 1, '%')}
        ${row('On brakes', sr.brakingPct, sc.brakingPct, 1, '%')}
        ${row('Gear changes', sr.gearChanges, sc.gearChanges, 0)}
        ${row('Braking zones', sr.brakingZones.length, sc.brakingZones.length, 0)}
      </div>`
    : '';
}

/* ---------------- replay (SSE) ---------------- */
function stopReplay() {
  if (state.replay) { state.replay.close(); state.replay = null; }
  $('replay-status').textContent = '';
}

async function startReplay() {
  stopReplay();
  const driver = $('replay-driver').value;
  const lap = $('replay-lap').value;
  const q = new URLSearchParams({ driver, speed: $('replay-speed').value });
  if (lap) q.set('lap', lap);
  let samples = [];
  try {
    const tq = new URLSearchParams({ driver });
    if (lap) tq.set('lap', lap);
    const tel = await api(`/api/sessions/${state.sessionKey}/telemetry?${tq}`);
    const s = tel.stats;
    state.replayMap = trackMap($('replay-map'), tel.map, (p) => speedColour(p.speed, s.minimumSpeed, s.topSpeed), { width: 6 });
    samples = tel.samples || [];
  } catch (err) {
    $('replay-status').textContent = err.message;
    return;
  }

  const isPages = window.location.hostname.endsWith('github.io') || window.location.protocol === 'file:' || !window.location.port;
  if (isPages && samples.length > 0) {
    const speedMultiplier = Number($('replay-speed').value) || 1;
    $('replay-status').textContent = `Driver ${driver} · ${samples.length} samples · ${speedMultiplier}× (Pages Live Mode)`;
    let idx = 0;
    const interval = Math.max(16, 50 / speedMultiplier);
    const timer = setInterval(() => {
      if (idx >= samples.length) {
        clearInterval(timer);
        $('replay-status').textContent += ' · finished';
        return;
      }
      const p = samples[idx++];
      $('g-speed').textContent = Math.round(p.speed);
      $('g-gear').textContent = p.gear || 'N';
      $('g-rpm').textContent = (p.rpm || 0).toLocaleString('en-GB');
      const drsVal = p.drs;
      const isDrsActive = drsVal !== null && drsVal >= 10;
      const isDrsAvail = drsVal === 8;
      const elDrs = $('g-drs');
      if (elDrs) {
        elDrs.textContent = isDrsActive ? 'OPEN' : isDrsAvail ? 'AVAIL' : 'CLOSED';
        elDrs.style.color = isDrsActive ? '#2ecc71' : isDrsAvail ? '#ffd400' : '#888';
      }
      $('g-time').textContent = fmtLap(p.t);
      $('g-thr').style.width = `${Math.max(0, Math.min(100, p.throttle))}%`;
      $('g-brk').style.width = `${p.brake > 0 ? 100 : 0}%`;
      $('g-progress').style.width = `${(p.progress * 100).toFixed(1)}%`;
      if (state.replayMap) state.replayMap.place(p.x, p.y);
    }, interval);
    state.replay = { close: () => clearInterval(timer) };
    return;
  }

  const es = new EventSource(`/api/sessions/${state.sessionKey}/replay?${q}`);
  state.replay = es;
  es.addEventListener('meta', (e) => {
    const m = JSON.parse(e.data);
    $('replay-status').textContent = `${m.driver.acronym} lap ${m.lap.lap} · ${m.samples} samples · ${m.speed}×`;
  });
  es.onmessage = (e) => {
    const p = JSON.parse(e.data);
    $('g-speed').textContent = Math.round(p.speed);
    $('g-gear').textContent = p.gear || 'N';
    $('g-rpm').textContent = p.rpm.toLocaleString('en-GB');
    const drsVal = p.drs;
    const isDrsActive = drsVal !== null && drsVal >= 10;
    const isDrsAvail = drsVal === 8;
    const elDrs = $('g-drs');
    if (elDrs) {
      elDrs.textContent = isDrsActive ? 'OPEN' : isDrsAvail ? 'AVAIL' : 'CLOSED';
      elDrs.style.color = isDrsActive ? '#2ecc71' : isDrsAvail ? '#ffd400' : '#888';
    }
    $('g-time').textContent = fmtLap(p.t);
    $('g-thr').style.width = `${Math.max(0, Math.min(100, p.throttle))}%`;
    $('g-brk').style.width = `${p.brake > 0 ? 100 : 0}%`;
    $('g-progress').style.width = `${(p.progress * 100).toFixed(1)}%`;
    if (state.replayMap) state.replayMap.place(p.x, p.y);
  };
  es.addEventListener('end', () => { es.close(); $('replay-status').textContent += ' · finished'; });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) return; es.close(); };
}

/* ---------------- championship ---------------- */
async function loadChampionship() {
  try {
    const [c, mar] = await Promise.all([api('/api/championship'), api('/api/maranello').catch(() => null)]);
    const f = c.ferrari;
    const nr = c.nextRace;
    $('championship').classList.remove('skeleton');
    $('championship').innerHTML = `
      ${c.warnings.length ? `<div class="warning">${c.warnings.map(esc).join('<br>')}</div>` : ''}
      <div class="kpis">
        <div class="kpi"><label>Constructors ${f.season ?? ''}</label><b>${f.constructor ? `P${f.constructor.position}` : '—'}</b><br><small>${f.constructor ? `${f.constructor.points} pts · ${f.constructor.wins} wins` : ''}</small></div>
        <div class="kpi"><label>Gap to leader</label><b>${f.gapToLeader === null ? '—' : f.gapToLeader === 0 ? 'LEADER' : `-${f.gapToLeader}`}</b><br><small>after round ${f.round ?? '—'}</small></div>
        ${f.drivers.map((d) => `<div class="kpi"><label>${esc(d.name)}</label><b>P${d.position}</b><br><small>${d.points} pts · ${d.wins} wins</small></div>`).join('')}
        ${mar ? `<div class="kpi"><label>Maranello now</label><b>${fmt(mar.temperature, 1, '°C')}</b><br><small>${esc(mar.description)}</small></div>` : ''}
      </div>
      <table style="margin-top:14px"><thead><tr><th>Pos</th><th>Constructor</th><th>Pts</th><th>Wins</th></tr></thead><tbody>
      ${c.constructors.map((k) => `<tr class="${k.constructorId === 'ferrari' ? 'ferrari' : ''}"><td>${k.position}</td><td>${esc(k.name)}</td><td>${k.points}</td><td>${k.wins}</td></tr>`).join('')}
      </tbody></table>
      ${nr ? `<h2 style="margin-top:18px"><span>Next: ${esc(nr.raceName)} · Round ${nr.round}</span><span class="tag">${esc(nr.circuitName)}, ${esc(nr.locality)}</span></h2>
        <div class="forecast">${c.forecast
          .map((s) => `<div class="fc"><label>${esc(s.name)}</label><small>${esc(dateLong(s.startUtc))}</small>
            ${s.forecast ? `<b>${fmt(s.forecast.temperature, 0, '°C')}</b><small>rain ${s.forecast.precipitationProbability}% · wind ${fmt(s.forecast.windSpeed, 0)} km/h</small>` : '<small class="muted">forecast not yet available</small>'}</div>`)
          .join('')}</div>` : ''}`;
  } catch (err) {
    $('championship').classList.remove('skeleton');
    $('championship').innerHTML = `<div class="error">${esc(err.message)}</div>`;
  }
}

/* ---------------- boot ---------------- */
async function boot() {
  loadHealth();
  loadChampionship();
  const now = new Date().getUTCFullYear();
  $('year-select').innerHTML = Array.from({ length: now - 2022 }, (_, i) => now - i).map((y) => `<option value="${y}">${y}</option>`).join('');

  const hashKey = Number((location.hash.match(/session=(\d+)/) || [])[1]);
  try {
    let key = hashKey;
    let year = now;
    if (!key) {
      const def = await api('/api/sessions/default');
      key = def.sessionKey;
      year = def.year;
    }
    $('year-select').value = String(year);
    await loadSessionList(year, key).catch(() => {});
    await loadSession(key);
  } catch (err) {
    alertBox(esc(err.message), 'error');
  }

  $('year-select').addEventListener('change', () => loadSessionList(Number($('year-select').value)).catch((e) => alertBox(esc(e.message), 'error')));
  $('load-btn').addEventListener('click', () => { const k = Number($('session-select').value); if (k) loadSession(k); });
  $('compare-btn').addEventListener('click', compare);
  $('replay-btn').addEventListener('click', startReplay);
  $('replay-stop').addEventListener('click', stopReplay);
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.overview) { renderLapChart(state.overview); renderWeather(state.overview); } }, 250);
  });
}

boot();
