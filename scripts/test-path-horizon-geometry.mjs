/**
 * Path/archaeoline endpoints must sit ON the terrain horizon, not on a chord
 * (which causes visible "plunge" near rise/set).
 * Run: node scripts/test-path-horizon-geometry.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createHorizonPathClip,
  horizonAltAtAzimuth,
  segmentHorizonMetrics,
  ENDPOINT_TOL_DEG,
  MAX_PLUNGE_DEG
} from './lib/horizon-path-clip.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const OBS = { lon: -7.5625666, lat: 53.490266, height: 120 };
const DATE = { year: 2024, month: 6, day: 21 };

function julianDayFromCalendar(year, month, day, hour = 0) {
  let y = Math.trunc(year);
  let m = Math.trunc(month);
  const d = Number(day) + Number(hour) / 24;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

function flatHorizon(alt = 0) {
  return Array.from({ length: 360 }, (_, i) => ({ azimuth: i, altitude: alt }));
}

function ridgeHorizon(base = 0, ridgeAz = 90, ridgeAlt = 1.2, width = 25) {
  return Array.from({ length: 360 }, (_, i) => {
    let d = Math.abs(i - ridgeAz);
    if (d > 180) d = 360 - d;
    const bump = d < width ? ridgeAlt * (1 - d / width) : 0;
    return { azimuth: i, altitude: base + bump };
  });
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

function bodyHor(swe, hour) {
  const jd = julianDayFromCalendar(DATE.year, DATE.month, DATE.day, hour);
  const flags = (swe.SEFLG_SWIEPH ?? 2) | 256 | 2048 | 32768;
  const pos = swe.calc_ut(jd, swe.SE_SUN ?? 0, flags);
  const geopos = [OBS.lon, OBS.lat, OBS.height];
  const out = swe.azalt(jd, swe.SE_EQU2HOR ?? 1, geopos, 1013.25, 15, [pos[0], pos[1], 0]);
  return {
    azimuth: ((out.azimuth + 180) % 360 + 360) % 360,
    altitude: Number(out.apparentAltitude),
    hourUTC: hour
  };
}

function buildCoarseDailyPath(swe) {
  const out = [];
  for (let i = 0; i < 25; i += 1) {
    out.push(bodyHor(swe, (i / 24) * 24));
  }
  return out;
}

const swe = await loadSwiss();
const pathHor = buildCoarseDailyPath(swe);
const profiles = [
  ['flat', flatHorizon(0)],
  ['ridge', ridgeHorizon(0, 85, 1.5, 25)]
];

for (const [name, profile] of profiles) {
  const getHorizon = (az) => horizonAltAtAzimuth(profile, az);
  const broken = createHorizonPathClip(getHorizon, { useHorizonSnap: false });
  const fixed = createHorizonPathClip(getHorizon);
  const brokenSegs = broken.horizontalsToSegments(pathHor);
  const fixedSegs = fixed.horizontalsToSegments(pathHor);
  const b = segmentHorizonMetrics(brokenSegs, getHorizon);
  const f = segmentHorizonMetrics(fixedSegs, getHorizon);

  if (f.worstGap > ENDPOINT_TOL_DEG) {
    throw new Error(`${name}: fixed endpoint gap ${f.worstGap.toFixed(4)}° > ${ENDPOINT_TOL_DEG}°`);
  }
  if (b.worstGap <= f.worstGap && b.worstGap < 0.01) {
    throw new Error(`${name}: broken snap should be worse than fixed (regression test invalid)`);
  }
  if (f.worstPlunge > MAX_PLUNGE_DEG) {
    throw new Error(`${name}: fixed plunge ${f.worstPlunge.toFixed(4)}° > ${MAX_PLUNGE_DEG}°`);
  }
  console.log(`OK ${name}: gap broken=${b.worstGap.toFixed(4)}° fixed=${f.worstGap.toFixed(4)}° plunge=${f.worstPlunge.toFixed(4)}°`);
}

console.log('OK path-horizon-geometry (endpoints on terrain horizon, no chord plunge)');
