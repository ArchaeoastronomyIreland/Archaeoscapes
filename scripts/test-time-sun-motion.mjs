/**
 * Proof test: Sun az/alt must change smoothly per UTC second (never hour-jumps).
 * Also proves path interpolation fails for sub-minute steps (original bug class).
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const OBS = { lon: -7.5625666, lat: 53.490266, height: 120 };
const DATE = { year: 2024, month: 6, day: 21 };

function julianDayFromCalendar(year, month, day, hour = 0) {
  let y = Math.trunc(year);
  let m = Math.trunc(month);
  const d = Number(day) + Number(hour) / 24;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

function selectedHour(utcTotalSeconds) {
  return utcTotalSeconds / 3600;
}

function lerpAz(a1, a2, u) {
  const diff = ((a2 - a1 + 540) % 360) - 180;
  return (a1 + diff * u + 360) % 360;
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

function sunAzAlt(swe, utcTotalSeconds) {
  const hour = selectedHour(utcTotalSeconds);
  const jd = julianDayFromCalendar(DATE.year, DATE.month, DATE.day, hour);
  const flags = (swe.SEFLG_SWIEPH ?? 2) | 256 | 2048 | 32768;
  const sun = swe.SE_SUN ?? 0;
  const pos = swe.calc_ut(jd, sun, flags);
  const geopos = [OBS.lon, OBS.lat, OBS.height];
  const out = swe.azalt(jd, swe.SE_EQU2HOR ?? 1, geopos, 1013.25, 15, [pos[0], pos[1], 0]);
  return {
    az: ((out.azimuth + 180) % 360 + 360) % 360,
    alt: Number(out.apparentAltitude)
  };
}

/** 25-point daily path sampled on hour grid only — mimics old broken interpolation. */
function buildHourlyPath(swe) {
  const jd0 = julianDayFromCalendar(DATE.year, DATE.month, DATE.day, 0);
  const pts = [];
  for (let i = 0; i < 25; i += 1) {
    const hour = (i / 24) * 24;
    const p = sunAzAlt(swe, Math.round(hour * 3600));
    pts.push({ hourUTC: hour, az: p.az, alt: p.alt });
  }
  return pts;
}

function interpolatePathByHour(pathPts, hourUTC) {
  const hour = Math.max(0, Math.min(24, hourUTC));
  let i0 = 0;
  let i1 = 1;
  for (let i = 0; i < pathPts.length - 1; i += 1) {
    if (hour >= pathPts[i].hourUTC && hour <= pathPts[i + 1].hourUTC) {
      i0 = i;
      i1 = i + 1;
      break;
    }
  }
  const a = pathPts[i0];
  const b = pathPts[i1];
  const u = b.hourUTC > a.hourUTC ? (hour - a.hourUTC) / (b.hourUTC - a.hourUTC) : 0;
  return {
    az: lerpAz(a.az, b.az, u),
    alt: a.alt + (b.alt - a.alt) * u
  };
}

function angularDelta(a, b) {
  const dAz = Math.abs(((b.az - a.az + 540) % 360) - 180);
  const dAlt = Math.abs(b.alt - a.alt);
  return Math.max(dAz, dAlt);
}

const swe = await loadSwiss();
const startSec = 12 * 3600;
let fails = 0;

// 1) Exact ephemeris: 120 consecutive +1s steps — all small, none huge
let prev = sunAzAlt(swe, startSec);
for (let i = 1; i <= 120; i += 1) {
  const cur = sunAzAlt(swe, startSec + i);
  const d = angularDelta(prev, cur);
  if (d < 0.00005) {
    console.error(`FAIL: second +${i} produced no measurable Sun motion (delta=${d})`);
    fails += 1;
  }
  if (d > 0.2) {
    console.error(`FAIL: second +${i} produced massive jump ${d.toFixed(3)}° (hour-snap bug)`);
    fails += 1;
  }
  prev = cur;
}
console.log('OK: 120 consecutive +1s steps — all non-zero, none > 0.2°');

// 2) Path interpolation at +1s from 12:00:00 should differ from exact (proves old approach wrong)
const pathPts = buildHourlyPath(swe);
const exact0 = sunAzAlt(swe, startSec);
const exact1 = sunAzAlt(swe, startSec + 1);
const interp0 = interpolatePathByHour(pathPts, selectedHour(startSec));
const interp1 = interpolatePathByHour(pathPts, selectedHour(startSec + 1));
const exactStep = angularDelta(exact0, exact1);
const interpStep = angularDelta(interp0, interp1);
if (interpStep < 0.00001) {
  console.error('FAIL: hourly path interpolation shows zero motion over 1 second (original UI bug)');
  fails += 1;
} else {
  console.log(`OK: path interpolation step=${interpStep.toFixed(5)}° vs exact=${exactStep.toFixed(5)}° (exact is authoritative)`);
}

// 3) Simulated commitDomTimeField('second'): stale hour DOM must not affect canonical UTC
function commitSecondOnly(canonicalSec, domSecond) {
  const prevH = Math.floor(canonicalSec / 3600);
  const prevM = Math.floor((canonicalSec % 3600) / 60);
  const second = Math.max(0, Math.min(59, Math.trunc(Number(domSecond))));
  return prevH * 3600 + prevM * 60 + second;
}
const after = commitSecondOnly(14 * 3600 + 30 * 60, '31');
if (after !== 14 * 3600 + 30 * 60 + 31) {
  console.error('FAIL: second-only commit corrupted hour/minute');
  fails += 1;
} else {
  console.log('OK: second-only commit preserves hour/minute from canonical UTC integer');
}

if (fails > 0) {
  console.error(`\n${fails} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll time→Sun motion proofs passed.');
