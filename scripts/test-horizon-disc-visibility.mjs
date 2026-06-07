/**
 * Sun disc must not be binary at rise/set:
 * - anyPartVisible when upper limb clears terrain (incl. half-disc on horizon)
 * - shader clip handles partial occlusion (screen mask parity with sky dome)
 * - old lower-limb + hysteresis gate was binary and wrong
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const OBS = { lon: -7.5625666, lat: 53.490266, height: 120 };
const DATE = { year: 2024, month: 6, day: 21 };
const SUN_RADIUS_DEG = 0.266;

function julianDayFromCalendar(year, month, day, hour = 0) {
  let y = Math.trunc(year);
  let m = Math.trunc(month);
  const d = Number(day) + Number(hour) / 24;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
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

function sunAltAz(swe, utcTotalSeconds) {
  const hour = utcTotalSeconds / 3600;
  const jd = julianDayFromCalendar(DATE.year, DATE.month, DATE.day, hour);
  const flags = (swe.SEFLG_SWIEPH ?? 2) | 256 | 2048 | 32768;
  const pos = swe.calc_ut(jd, swe.SE_SUN ?? 0, flags);
  const geopos = [OBS.lon, OBS.lat, OBS.height];
  const out = swe.azalt(jd, swe.SE_EQU2HOR ?? 1, geopos, 1013.25, 15, [pos[0], pos[1], 0]);
  return { alt: Number(out.apparentAltitude), az: ((out.azimuth + 180) % 360 + 360) % 360 };
}

function oldBinaryGate(alt, horizonAlt) {
  return alt > horizonAlt + SUN_RADIUS_DEG;
}

function oldHysteresisGateFactory() {
  let visible = false;
  return function gate(alt, horizonAlt) {
    const lowerLimb = alt - SUN_RADIUS_DEG;
    if (visible) {
      if (lowerLimb < horizonAlt - 0.045) visible = false;
    } else if (lowerLimb >= horizonAlt - 0.015) {
      visible = true;
    }
    return visible;
  };
}

function anyPartAboveHorizon(alt, horizonAlt) {
  return (alt + SUN_RADIUS_DEG) >= horizonAlt - 0.02;
}

function runAnalytic() {
  const h = 0;
  const halfDiscCenter = h;
  const fullDiscCenter = h + SUN_RADIUS_DEG;
  const oneSecBeforeHalf = halfDiscCenter - 0.0015;

  if (oldBinaryGate(halfDiscCenter, h)) {
    throw new Error('Old binary gate must hide half-disc (center on horizon)');
  }
  if (!anyPartAboveHorizon(halfDiscCenter, h)) {
    throw new Error('anyPartAboveHorizon must show half-disc (center on horizon)');
  }
  if (!anyPartAboveHorizon(oneSecBeforeHalf, h)) {
    throw new Error('anyPartAboveHorizon must show 1s before half-disc');
  }
  if (!anyPartAboveHorizon(fullDiscCenter, h)) {
    throw new Error('anyPartAboveHorizon must show full disc above horizon');
  }
  const fullyBelow = h - SUN_RADIUS_DEG - 0.05;
  if (anyPartAboveHorizon(fullyBelow, h)) {
    throw new Error('anyPartAboveHorizon must hide fully-below disc');
  }

  const hysteresis = oldHysteresisGateFactory();
  if (hysteresis(halfDiscCenter, h) !== hysteresis(oneSecBeforeHalf, h)) {
    // acceptable if both true; fail only if half visible then 1s back fully hidden
  }
  if (hysteresis(halfDiscCenter, h) && !hysteresis(oneSecBeforeHalf, h)) {
    throw new Error('Hysteresis gate flickered off 1s before half-disc');
  }

  return { halfDiscCenter, fullDiscCenter, fullyBelow };
}

async function runSunriseWindow(swe) {
  let start = 3 * 3600;
  for (; start < 6 * 3600; start += 1) {
    if (sunAltAz(swe, start).alt > -SUN_RADIUS_DEG) break;
  }
  let toggles = 0;
  let prev = null;
  for (let t = start; t <= start + 180; t += 1) {
    const { alt } = sunAltAz(swe, t);
    const vis = anyPartAboveHorizon(alt, 0);
    if (prev !== null && vis !== prev) toggles += 1;
    prev = vis;
  }
  if (toggles > 2) {
    throw new Error(`anyPartAboveHorizon toggled ${toggles} times in 180s window (expected <=2)`);
  }
  return { start, toggles };
}

const analytic = runAnalytic();
const swe = await loadSwiss();
const window = await runSunriseWindow(swe);
console.log('OK horizon disc partial visibility logic');
console.log(JSON.stringify({ analytic, window }, null, 2));
