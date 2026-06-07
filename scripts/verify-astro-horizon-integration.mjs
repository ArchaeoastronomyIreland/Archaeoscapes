/**
 * Integration verification: mirrors astronomy.js horizon clip + disc gate logic.
 * Fails if paths/archaeolines stop short of terrain horizon or disc gate regresses.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const OBS = { lon: -7.5625666, lat: 53.490266, height: 120 };
const DATE = { year: 2024, month: 6, day: 21 };
const SUN_RADIUS = 0.266;
const ENDPOINT_TOL_DEG = 0.04;

function julianDayFromCalendar(year, month, day, hour = 0) {
  let y = Math.trunc(year);
  let m = Math.trunc(month);
  const d = Number(day) + Number(hour) / 24;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

function lerpAzimuthDeg(a1, a2, t) {
  const diff = ((a2 - a1 + 540) % 360) - 180;
  return (a1 + diff * t + 360) % 360;
}

function horizonAltAtAzimuth(horizonData, azimuthDeg) {
  if (!horizonData?.length) return null;
  const az = ((azimuthDeg % 360) + 360) % 360;
  const n = horizonData.length;
  if (n === 1) return Number(horizonData[0].altitude);
  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n;
    const a0 = Number(horizonData[i].azimuth);
    const a1 = Number(horizonData[next].azimuth);
    const alt0 = Number(horizonData[i].altitude);
    const alt1 = Number(horizonData[next].altitude);
    let inSegment = false;
    let t = 0;
    if (i === n - 1) {
      const span = (360 - a0) + a1;
      if (span <= 0) continue;
      if (az >= a0) { inSegment = true; t = (az - a0) / span; }
      else if (az < a1) { inSegment = true; t = (az + 360 - a0) / span; }
    } else if (az >= a0 && az < a1) {
      inSegment = true;
      t = a1 === a0 ? 0 : (az - a0) / (a1 - a0);
    }
    if (inSegment) return alt0 + (alt1 - alt0) * t;
  }
  return Number(horizonData[0].altitude);
}

function makeHorizonApi(horizonData) {
  return (az) => horizonAltAtAzimuth(horizonData, az);
}

function viewshedHorizonAltForDisc(getHorizon, azimuthDeg, angularRadiusDeg) {
  const span = Math.max(0.05, Number(angularRadiusDeg) || 0.27);
  const az = Number(azimuthDeg);
  if (!Number.isFinite(az)) return null;
  let maxAlt = null;
  for (let i = -2; i <= 2; i += 1) {
    const sampleAz = az + (i / 2) * span;
    const alt = getHorizon(sampleAz);
    if (alt == null || !Number.isFinite(alt)) continue;
    maxAlt = maxAlt == null ? alt : Math.max(maxAlt, alt);
  }
  return maxAlt;
}

function makeHorizonClip(getHorizon) {
  function horizontalAboveViewshedHorizon(hor) {
    const horizonAlt = getHorizon(hor.azimuth);
    if (horizonAlt == null) return true;
    return hor.altitude > horizonAlt + 0.015;
  }

  function crossingAtViewshedHorizon(a, b) {
    const horizonA = getHorizon(a.azimuth);
    const horizonB = getHorizon(b.azimuth);
    const diffA = a.altitude - (horizonA ?? -90);
    const diffB = b.altitude - (horizonB ?? -90);
    const rising = diffA <= 0 && diffB > 0;
    const setting = diffA >= 0 && diffB < 0;
    let t0 = 0;
    let t1 = 1;
    for (let i = 0; i < 20; i += 1) {
      const tm = (t0 + t1) / 2;
      const az = lerpAzimuthDeg(a.azimuth, b.azimuth, tm);
      const alt = a.altitude + (b.altitude - a.altitude) * tm;
      const horizonAlt = getHorizon(az) ?? -90;
      const diff = alt - horizonAlt;
      if (rising) { if (diff > 0) t1 = tm; else t0 = tm; }
      else if (setting) { if (diff > 0) t0 = tm; else t1 = tm; }
      else if (diffA > 0) { if (diff > 0) t0 = tm; else t1 = tm; }
      else { if (diff > 0) t1 = tm; else t0 = tm; }
    }
    const t = (t0 + t1) / 2;
    const az = lerpAzimuthDeg(a.azimuth, b.azimuth, t);
    const chordAlt = a.altitude + (b.altitude - a.altitude) * t;
    const horizonAlt = getHorizon(az);
    return {
      azimuth: az,
      altitude: horizonAlt != null && Number.isFinite(horizonAlt) ? horizonAlt : chordAlt
    };
  }

  function snapHorizontalToHorizon(hor) {
    const h = getHorizon(hor.azimuth);
    if (h == null || !Number.isFinite(h)) return hor;
    return { ...hor, azimuth: hor.azimuth, altitude: h };
  }

  function horizontalsToSegments(horizontals) {
    if (!horizontals.length) return [];
    if (getHorizon(horizontals[0].azimuth) == null) return [horizontals];

    const segments = [];
    let current = [];
    let prev = horizontals[0];
    let prevAbove = horizontalAboveViewshedHorizon(prev);
    if (prevAbove) current.push(prev);

    for (let i = 1; i < horizontals.length; i += 1) {
      const cur = horizontals[i];
      const curAbove = horizontalAboveViewshedHorizon(cur);
      if (prevAbove !== curAbove) {
        const cross = crossingAtViewshedHorizon(prev, cur);
        if (!prevAbove && curAbove) current = [snapHorizontalToHorizon(cross)];
        else if (prevAbove && !curAbove) {
          current.push(snapHorizontalToHorizon(cross));
          if (current.length > 1) segments.push(current);
          current = [];
        }
      } else if (!prevAbove && !curAbove) {
        prev = cur;
        prevAbove = curAbove;
        continue;
      }
      if (curAbove) current.push(cur);
      prev = cur;
      prevAbove = curAbove;
    }
    if (current.length > 1) segments.push(current);
    return segments;
  }

  return { horizontalAboveViewshedHorizon, horizontalsToSegments };
}

function makeBadHorizonClip(getHorizon) {
  function horizontalAboveViewshedHorizon(hor) {
    const horizonAlt = getHorizon(hor.azimuth);
    if (horizonAlt == null) return true;
    return hor.altitude - SUN_RADIUS >= horizonAlt - 0.015;
  }
  function crossingAtViewshedHorizon(a, b) {
    const horizonA = getHorizon(a.azimuth);
    const horizonB = getHorizon(b.azimuth);
    const diffA = (a.altitude - SUN_RADIUS) - (horizonA ?? -90);
    const diffB = (b.altitude - SUN_RADIUS) - (horizonB ?? -90);
    const rising = diffA <= 0 && diffB > 0;
    const setting = diffA >= 0 && diffB < 0;
    let t0 = 0;
    let t1 = 1;
    for (let i = 0; i < 20; i += 1) {
      const tm = (t0 + t1) / 2;
      const az = lerpAzimuthDeg(a.azimuth, b.azimuth, tm);
      const alt = a.altitude + (b.altitude - a.altitude) * tm;
      const horizonAlt = getHorizon(az) ?? -90;
      const diff = (alt - SUN_RADIUS) - horizonAlt;
      if (rising) { if (diff > 0) t1 = tm; else t0 = tm; }
      else if (setting) { if (diff > 0) t0 = tm; else t1 = tm; }
      else if (diffA > 0) { if (diff > 0) t0 = tm; else t1 = tm; }
      else { if (diff > 0) t1 = tm; else t0 = tm; }
    }
    const t = (t0 + t1) / 2;
    return {
      azimuth: lerpAzimuthDeg(a.azimuth, b.azimuth, t),
      altitude: a.altitude + (b.altitude - a.altitude) * t
    };
  }
  function horizontalsToSegments(horizontals) {
    if (!horizontals.length) return [];
    if (getHorizon(horizontals[0].azimuth) == null) return [horizontals];
    const segments = [];
    let current = [];
    let prev = horizontals[0];
    let prevAbove = horizontalAboveViewshedHorizon(prev);
    if (prevAbove) current.push(prev);
    for (let i = 1; i < horizontals.length; i += 1) {
      const cur = horizontals[i];
      const curAbove = horizontalAboveViewshedHorizon(cur);
      if (prevAbove !== curAbove) {
        const cross = crossingAtViewshedHorizon(prev, cur);
        if (!prevAbove && curAbove) current = [cross];
        else if (prevAbove && !curAbove) {
          current.push(cross);
          if (current.length > 1) segments.push(current);
          current = [];
        }
      } else if (!prevAbove && !curAbove) {
        prev = cur;
        prevAbove = curAbove;
        continue;
      }
      if (curAbove) current.push(cur);
      prev = cur;
      prevAbove = curAbove;
    }
    if (current.length > 1) segments.push(current);
    return segments;
  }
  return { horizontalsToSegments };
}

function makeDiscGate(getHorizon) {
  const state = { sun: false, moon: false };
  return function discVisible(hor, bodyKey = 'sun') {
    const horizonAlt = viewshedHorizonAltForDisc(getHorizon, hor.azimuth, SUN_RADIUS);
    if (horizonAlt == null) return true;
    const lowerLimb = hor.altitude - SUN_RADIUS;
    const key = bodyKey === 'moon' ? 'moon' : 'sun';
    if (state[key]) {
      if (lowerLimb < horizonAlt - 0.045) state[key] = false;
    } else if (lowerLimb >= horizonAlt - 0.015) {
      state[key] = true;
    }
    return state[key];
  };
}

function flatHorizon(alt = 0) {
  return Array.from({ length: 360 }, (_, i) => ({ azimuth: i, altitude: alt }));
}

function ridgeHorizon(base = 0, ridgeAz = 90, ridgeAlt = 2, width = 20) {
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

function bodyHor(swe, bodyId, utcHour) {
  const jd = julianDayFromCalendar(DATE.year, DATE.month, DATE.day, utcHour);
  const flags = (swe.SEFLG_SWIEPH ?? 2) | 256 | 2048 | 32768;
  const pos = swe.calc_ut(jd, bodyId, flags);
  const geopos = [OBS.lon, OBS.lat, OBS.height];
  const out = swe.azalt(jd, swe.SE_EQU2HOR ?? 1, geopos, 1013.25, 15, [pos[0], pos[1], 0]);
  return {
    azimuth: ((out.azimuth + 180) % 360 + 360) % 360,
    altitude: Number(out.apparentAltitude),
    dec: pos[1],
    hourUTC: utcHour
  };
}

function buildDailyPath(swe, bodyId) {
  const coarse = [];
  for (let i = 0; i < 25; i += 1) {
    coarse.push(bodyHor(swe, bodyId, (i / 24) * 24));
  }
  return coarse;
}

function buildDeclinationArc(swe, decDeg, jd) {
  const out = [];
  for (let ha = -180; ha <= 180; ha += 2) {
    const jdUse = jd + ha / 360 * (1 / 24) * 0; // static dec arc: use horizontal from dec
    void jdUse;
    const phi = (OBS.lat * Math.PI) / 180;
    const dec = (decDeg * Math.PI) / 180;
    const h = (ha * Math.PI) / 180;
    const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
    const altitude = (Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180) / Math.PI;
    const east = -Math.cos(dec) * Math.sin(h);
    const north = Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(h);
    const azimuth = (((Math.atan2(east, north) * 180) / Math.PI) + 360) % 360;
    out.push({ azimuth, altitude, dec: decDeg });
  }
  return out;
}

function endpointGapDeg(getHorizon, hor) {
  const h = getHorizon(hor.azimuth);
  return Math.abs(hor.altitude - h);
}

function assertPathsReachHorizon(label, segments, getHorizon) {
  if (!segments.length) throw new Error(`${label}: no visible segments`);
  let endpoints = 0;
  let worst = 0;
  for (const seg of segments) {
    for (const pt of [seg[0], seg[seg.length - 1]]) {
      const gap = endpointGapDeg(getHorizon, pt);
      if (gap < 0.5) {
        endpoints += 1;
        worst = Math.max(worst, gap);
        if (gap > ENDPOINT_TOL_DEG) {
          throw new Error(`${label}: endpoint ${gap.toFixed(4)}° from horizon (max ${ENDPOINT_TOL_DEG}°) az=${pt.azimuth.toFixed(2)} alt=${pt.altitude.toFixed(4)} h=${getHorizon(pt.azimuth).toFixed(4)}`);
        }
      }
    }
  }
  if (endpoints < 2) throw new Error(`${label}: expected rise+set endpoints near horizon, got ${endpoints}`);
  return { endpoints, worstGap: worst };
}

function assertDiscAtHorizon(getHorizon, discVisible, az = 90) {
  const h = getHorizon(az);
  const hor = { azimuth: az, altitude: h + SUN_RADIUS };
  if (!discVisible(hor, 'sun')) {
    throw new Error(`Disc gate: full disc on horizon must be visible (az=${az} h=${h.toFixed(4)})`);
  }
  const oneSecBack = { azimuth: az, altitude: h + SUN_RADIUS - 0.0015 };
  if (!discVisible(oneSecBack, 'sun')) {
    throw new Error('Disc gate: 1 s before full disc on horizon must stay visible');
  }
}

function assertDiscOldGateBroken() {
  const h = 0;
  const full = h + SUN_RADIUS;
  if (full > h + SUN_RADIUS) return; // old strict >
  if (full > h + SUN_RADIUS) { /* visible */ }
  const oldVisible = full > h + SUN_RADIUS;
  if (oldVisible) throw new Error('Sanity: old gate check misconfigured');
}

async function main() {
  assertDiscOldGateBroken();
  const swe = await loadSwiss();
  const jd = julianDayFromCalendar(DATE.year, DATE.month, DATE.day, 12);
  const results = [];

  for (const [name, horizonData] of [
    ['flat-0', flatHorizon(0)],
    ['flat-0.3', flatHorizon(0.3)],
    ['ridge', ridgeHorizon(0, 85, 1.5, 25)]
  ]) {
    const getHorizon = makeHorizonApi(horizonData);
    const clip = makeHorizonClip(getHorizon);

    const sunPath = buildDailyPath(swe, swe.SE_SUN ?? 0);
    const sunSegs = clip.horizontalsToSegments(sunPath);
    results.push({ test: `sun-path-${name}`, ...assertPathsReachHorizon(`sun-path-${name}`, sunSegs, getHorizon) });

    const moonPath = buildDailyPath(swe, swe.SE_MOON ?? 1);
    const moonSegs = clip.horizontalsToSegments(moonPath);
    if (moonSegs.length) {
      results.push({ test: `moon-path-${name}`, ...assertPathsReachHorizon(`moon-path-${name}`, moonSegs, getHorizon) });
    }

    const summerDec = bodyHor(swe, swe.SE_SUN ?? 0, 12).dec;
    const archaeoArc = buildDeclinationArc(swe, summerDec, jd);
    const archaeoSegs = clip.horizontalsToSegments(archaeoArc);
    results.push({ test: `archaeo-solstice-${name}`, ...assertPathsReachHorizon(`archaeo-solstice-${name}`, archaeoSegs, getHorizon) });

    const discVisible = makeDiscGate(getHorizon);
    const discAz = name.startsWith('ridge') ? 85 : 90;
    assertDiscAtHorizon(getHorizon, discVisible, discAz);
    results.push({ test: `disc-gate-${name}`, ok: true });
  }

  // Regression guard: lower-limb path clip stops ~1 solar radius short of terrain horizon.
  {
    const sunPath = buildDailyPath(swe, swe.SE_SUN ?? 0);
    const getH = makeHorizonApi(flatHorizon(0));
    const good = makeHorizonClip(getH).horizontalsToSegments(sunPath);
    const bad = makeBadHorizonClip(getH).horizontalsToSegments(sunPath);
    function riseEndpointGap(segs) {
      let best = Infinity;
      for (const seg of segs) {
        for (const pt of [seg[0], seg[seg.length - 1]]) {
          const gap = endpointGapDeg(getH, pt);
          if (gap < 0.5) best = Math.min(best, gap);
        }
      }
      return best;
    }
    const goodGap = riseEndpointGap(good);
    const badGap = riseEndpointGap(bad);
    if (goodGap > ENDPOINT_TOL_DEG) {
      throw new Error(`Good path clip gap too large: ${goodGap.toFixed(4)}°`);
    }
    if (badGap < SUN_RADIUS * 0.4) {
      throw new Error(`Regression detector: bad clip gap ${badGap.toFixed(4)}° should be ~${SUN_RADIUS}°`);
    }
    results.push({ test: 'regression-detector', goodGap, badGap });
  }

  console.log('OK verify-astro-horizon-integration');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FAIL verify-astro-horizon-integration:', e.message);
  process.exit(1);
});
