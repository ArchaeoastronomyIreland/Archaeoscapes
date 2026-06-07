/**
 * Quantify Sun/Moon path vs exact ephemeris mismatch near rise/set.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const OBS = { lon: -6.25, lat: 53.09, height: 120 };

function julianDayUT(y, m, d, hour) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045 + hour / 24;
}

function lerpAz(a1, a2, u) {
  const diff = ((a2 - a1 + 540) % 360) - 180;
  return (a1 + diff * u + 360) % 360;
}

function interpolatePath(horizontals, hour) {
  const f = (hour / 24) * (horizontals.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(horizontals.length - 1, i0 + 1);
  const u = f - i0;
  const a = horizontals[i0];
  const b = horizontals[i1];
  return {
    azimuth: lerpAz(a.az, b.az, u),
    altitude: a.alt + (b.alt - a.alt) * u,
    i0,
    i1,
    u
  };
}

async function loadSwiss() {
  const p = path.join(root, 'assets/swisseph/src/swisseph.js');
  const mod = await import(`file://${p.replace(/\\/g, '/')}`);
  const SwissEph = mod.default || mod.SwissEph || mod;
  const swe = new SwissEph();
  await swe.initSwissEph();
  swe.set_topo?.(OBS.lon, OBS.lat, OBS.height);
  return swe;
}

function bodyAzalt(swe, jd, bodyId, atpress = 0, attemp = 0) {
  const flags = (swe.SEFLG_SWIEPH ?? 2) | 256 | 2048 | 32768;
  const pos = swe.calc_ut(jd, bodyId, flags);
  const geopos = [OBS.lon, OBS.lat, OBS.height];
  const out = swe.azalt(jd, swe.SE_EQU2HOR ?? 1, geopos, atpress, attemp, [pos[0], pos[1], 0]);
  return {
    az: ((out.azimuth + 180) % 360 + 360) % 360,
    alt: Number(out.apparentAltitude),
    trueAlt: Number(out.trueAltitude),
    ra: pos[0],
    dec: pos[1]
  };
}

const PATH_COARSE = 25;
const PATH_LOW_ALT = 8;
const PATH_MAX_ERR = 0.06;
const PATH_MAX_DEPTH = 4;

function buildPathAdaptive(swe, jd0, bodyId) {
  const label = bodyId === (swe.SE_SUN ?? 0) ? 'Sun' : 'Moon';
  const coarse = [];
  for (let i = 0; i < PATH_COARSE; i += 1) {
    const hour = (i / (PATH_COARSE - 1)) * 24;
    const p = bodyAzalt(swe, jd0 + hour / 24, bodyId);
    coarse.push({ hour, hourUTC: hour, az: p.az, alt: p.alt });
  }
  function chordErr(a, b, hourMid) {
    const ex = bodyAzalt(swe, jd0 + hourMid / 24, bodyId);
    const chordAlt = a.alt + (b.alt - a.alt) * 0.5;
    return Math.abs(ex.alt - chordAlt);
  }
  function subdiv(a, b, depth, out) {
    const hourMid = (a.hourUTC + b.hourUTC) / 2;
    if (b.hourUTC - a.hourUTC < 1 / 120 || depth >= PATH_MAX_DEPTH) return;
    const err = chordErr(a, b, hourMid);
    if (Math.min(a.alt, b.alt) >= PATH_LOW_ALT && err <= PATH_MAX_ERR) return;
    const midP = bodyAzalt(swe, jd0 + hourMid / 24, bodyId);
    const mid = { hour: hourMid, hourUTC: hourMid, az: midP.az, alt: midP.alt };
    subdiv(a, mid, depth + 1, out);
    out.push(mid);
    subdiv(mid, b, depth + 1, out);
  }
  const out = [coarse[0]];
  for (let i = 1; i < coarse.length; i += 1) {
    const extra = [];
    subdiv(coarse[i - 1], coarse[i], 0, extra);
    extra.sort((x, y) => x.hourUTC - y.hourUTC);
    out.push(...extra, coarse[i]);
  }
  return out;
}

function interpolateByHour(path, hour) {
  let i0 = 0;
  let i1 = 1;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (hour >= path[i].hourUTC && hour <= path[i + 1].hourUTC) {
      i0 = i;
      i1 = i + 1;
      break;
    }
  }
  const a = path[i0];
  const b = path[i1];
  const u = (hour - a.hourUTC) / (b.hourUTC - a.hourUTC);
  const diff = ((b.az - a.az + 540) % 360) - 180;
  return {
    altitude: a.alt + (b.alt - a.alt) * u,
    i0,
    i1,
    u,
    n: path.length
  };
}

function findHorizonCrossing(swe, jd0, bodyId, rising = true) {
  let prev = bodyAzalt(swe, jd0, bodyId);
  for (let m = 1; m < 24 * 60; m += 1) {
    const cur = bodyAzalt(swe, jd0 + m / 1440, bodyId);
    const up = prev.alt <= 0 && cur.alt > 0;
    const down = prev.alt >= 0 && cur.alt < 0;
    if (rising && up) return { m, hour: m / 60, ...cur };
    if (!rising && down) return { m, hour: m / 60, ...cur };
    prev = cur;
  }
  return null;
}

async function main() {
  const swe = await loadSwiss();
  const sun = swe.SE_SUN ?? 0;
  const moon = swe.SE_MOON ?? 1;
  const jd0 = julianDayUT(2024, 6, 21, 0);

  console.log('=== Observer', OBS, '===\n');

  // Pressure model: atpress=0 vs explicit sea-level vs height-estimated
  const jdRise = jd0 + 3.5 / 24;
  const p0 = bodyAzalt(swe, jdRise, sun, 0, 0);
  const p1013 = bodyAzalt(swe, jdRise, sun, 1013.25, 15);
  console.log('Refraction sensitivity (Sun, ~rise):');
  console.log(`  atpress=0, attemp=0 (app): alt=${p0.alt.toFixed(4)}° true=${p0.trueAlt.toFixed(4)}°`);
  console.log(`  atpress=1013.25, attemp=15:     alt=${p1013.alt.toFixed(4)}° true=${p1013.trueAlt.toFixed(4)}°`);
  console.log(`  Δ apparent alt: ${(p0.alt - p1013.alt).toFixed(4)}°\n`);

  for (const [name, bodyId, jdDay] of [
    ['Sun', sun, julianDayUT(2024, 6, 21, 0)],
    ['Moon', moon, julianDayUT(2024, 6, 15, 0)]
  ]) {
    const path = buildPathAdaptive(swe, jdDay, bodyId);
    const path49 = [];
    for (let i = 0; i < 49; i += 1) {
      const hour = (i / 48) * 24;
      const p = bodyAzalt(swe, jdDay + hour / 24, bodyId);
      path49.push({ hour, hourUTC: hour, az: p.az, alt: p.alt });
    }
    const rise = findHorizonCrossing(swe, jdDay, bodyId, true);
    const set = findHorizonCrossing(swe, jdDay, bodyId, false);
    if (!rise) {
      console.log(`--- ${name}: no 0° apparent crossing (circumpolar?) ---\n`);
      continue;
    }
    const riseHour = rise.hour;
    const exact = bodyAzalt(swe, jdDay + riseHour / 24, bodyId);
    const interp = interpolateByHour(path, riseHour);
    const interp49 = interpolateByHour(path49, riseHour);

  // Also test every minute near rise for max interp error
    let maxErr = { dAlt: 0, hour: 0 };
    for (let m = Math.max(0, rise.m - 60); m < rise.m + 90; m += 1) {
      const hr = m / 60;
      const ex = bodyAzalt(swe, jdDay + hr / 24, bodyId);
      const ip = interpolateByHour(path, hr);
      const dAlt = Math.abs(ex.alt - ip.altitude);
      if (dAlt > maxErr.dAlt) maxErr = { dAlt, hour: hr, ex, ip };
    }

    console.log(`--- ${name} rise zone ---`);
    console.log(`Rise ~${riseHour.toFixed(3)} h UTC; exact alt=${exact.alt.toFixed(4)}°`);
    console.log(`At rise: adaptive n=${interp.n} interp alt=${interp.altitude.toFixed(4)}° Δ=${(exact.alt - interp.altitude).toFixed(4)}°`);
    console.log(`         old 49-pt Δ=${(exact.alt - interp49.altitude).toFixed(4)}°`);
    console.log(`Max |exact-interp| ±90min: adaptive=${maxErr.dAlt.toFixed(4)}° at h=${maxErr.hour.toFixed(3)}`);

    // Chord bias: midpoint between the two path samples bracketing rise
    const i1 = interp.i1;
    const i0 = interp.i0;
    if (i0 >= 0 && i1 < path.length) {
      const a = path[i0];
      const b = path[i1];
      const midHour = (a.hour + b.hour) / 2;
      const midExact = bodyAzalt(swe, jdDay + midHour / 24, bodyId);
      const midChordAlt = a.alt + (b.alt - a.alt) * 0.5;
      console.log(`30-min chord mid (${a.hour.toFixed(2)}–${b.hour.toFixed(2)}h): exact=${midExact.alt.toFixed(4)}° chord=${midChordAlt.toFixed(4)}° Δ=${(midExact.alt - midChordAlt).toFixed(4)}°`);
    }
    if (set) {
      const setHour = set.hour;
      const exSet = bodyAzalt(swe, jdDay + setHour / 24, bodyId);
      const ipSet = interpolateByHour(path, setHour);
      let maxSet = 0;
      for (let m = Math.max(0, set.m - 60); m < set.m + 90; m += 1) {
        const hr = m / 60;
        const d = Math.abs(bodyAzalt(swe, jdDay + hr / 24, bodyId).alt - interpolateByHour(path, hr).altitude);
        if (d > maxSet) maxSet = d;
      }
      console.log(`Set ~${setHour.toFixed(3)} h: interp Δ=${(exSet.alt - ipSet.altitude).toFixed(4)}° max|Δ|±90min=${maxSet.toFixed(4)}°`);
    }
    console.log('');
  }

  const rise = findHorizonCrossing(swe, jd0, sun, true);
  if (!rise) return;
  const hr = rise.hour;
  const e = bodyAzalt(swe, jd0 + hr / 24, sun);
  const adapt = buildPathAdaptive(swe, jd0, sun);
  const iAdapt = interpolateByHour(adapt, hr);
  console.log(`Sun rise adaptive path: ${adapt.length} vertices, Δalt=${Math.abs(e.alt - iAdapt.altitude).toFixed(4)}°`);
}

main().catch(console.error);
