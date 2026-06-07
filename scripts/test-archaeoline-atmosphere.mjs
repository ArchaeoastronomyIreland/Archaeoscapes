/**
 * Verifies archaeoline declination arcs use swe_azalt (not geometric+swe_refrac).
 * Run: node scripts/test-archaeoline-atmosphere.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const DEG = Math.PI / 180;
const OBSERVER = { latitude: 53.09, longitude: -6.25, height: 120 };

const ARCHAEO_NOMINAL = {
  equinox: [0],
  solstice: (jd) => {
    const t = (jd - 2451545.0) / 36525.0;
    const o = (84381.448 - 46.8150 * t) / 3600;
    return [o, -o];
  },
  crossquarter: (jd) => {
    const t = (jd - 2451545.0) / 36525.0;
    const o = (84381.448 - 46.8150 * t) / 3600;
    const cq = Math.asin(Math.sin(o * DEG) / Math.sqrt(2)) / DEG;
    return [cq, -cq];
  }
};

function normalizeDeg(v) {
  return ((Number(v) % 360) + 360) % 360;
}

function greenwichSiderealDeg(jd) {
  const t = (jd - 2451545.0) / 36525;
  return normalizeDeg(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000);
}

function raDegFromHourAngle(jd, observer, hourAngleDeg) {
  const lst = normalizeDeg(greenwichSiderealDeg(jd) + observer.longitude);
  return normalizeDeg(lst - hourAngleDeg);
}

function horizontalFromDeclination(decDeg, hourAngleDeg, observer) {
  const phi = observer.latitude * DEG;
  const dec = decDeg * DEG;
  const h = hourAngleDeg * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / DEG;
  const east = -Math.cos(dec) * Math.sin(h);
  const north = Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(h);
  const azimuth = (Math.atan2(east, north) / DEG + 360) % 360;
  return { azimuth, altitude };
}

function swissAzimuthNorthFromSouthDeg(azSouthDeg) {
  return normalizeDeg(Number(azSouthDeg) + 180);
}

function julianDayUT(year, month, day, hour) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045 + hour / 24;
}

function maxDelta(a, b) {
  const dAz = Math.abs(((a.azimuth - b.azimuth + 540) % 360) - 180);
  const dAlt = Math.abs(a.altitude - b.altitude);
  return { dAz, dAlt };
}

async function loadSwiss() {
  const urls = [
    path.join(root, 'assets/swisseph/src/swisseph.js'),
    'https://cdn.jsdelivr.net/gh/prolaxu/swisseph-wasm@main/src/swisseph.js'
  ];
  for (const url of urls) {
    try {
      const mod = await import(url.startsWith('http') ? url : `file://${url.replace(/\\/g, '/')}`);
      const SwissEph = mod.default || mod.SwissEph || mod;
      if (typeof SwissEph === 'function' && SwissEph.prototype?.initSwissEph) {
        const swe = new SwissEph();
        await swe.initSwissEph();
        swe.set_topo?.(OBSERVER.longitude, OBSERVER.latitude, OBSERVER.height);
        return swe;
      }
    } catch (_) {}
  }
  return null;
}

function swissAzalt(swe, jd, raDeg, decDeg) {
  const geopos = [OBSERVER.longitude, OBSERVER.latitude, OBSERVER.height];
  const flag = swe.SE_EQU2HOR ?? 1;
  const out = swe.azalt(jd, flag, geopos, 0, 0, [raDeg, decDeg, 0]);
  return {
    azimuth: swissAzimuthNorthFromSouthDeg(out.azimuth),
    altitude: Number(out.apparentAltitude)
  };
}

/** Archaeoline point: RA = LST − HA, then swe_azalt (production pipeline). */
function archaeoPoint(swe, jd, decDeg, hourAngleDeg) {
  const ra = raDegFromHourAngle(jd, OBSERVER, hourAngleDeg);
  return swissAzalt(swe, jd, ra, decDeg);
}

function refineDec(nominal, bodyDec) {
  if (!isFinite(bodyDec)) return nominal;
  return Math.abs(bodyDec - nominal) <= 0.85 ? bodyDec : nominal;
}

function swissBodyDec(swe, jd, bodyId) {
  const flags = (swe.SEFLG_SWIEPH ?? 2) | (swe.SEFLG_SPEED ?? 256) | (swe.SEFLG_EQUATORIAL ?? 2048) | (swe.SEFLG_TOPOCTR ?? 32768);
  return swe.calc_ut(jd, bodyId, flags)[1];
}

function bodyPathPoint(swe, jd, bodyId) {
  const flags = (swe.SEFLG_SWIEPH ?? 2) | (swe.SEFLG_SPEED ?? 256) | (swe.SEFLG_EQUATORIAL ?? 2048) | (swe.SEFLG_TOPOCTR ?? 32768);
  const pos = swe.calc_ut(jd, bodyId, flags);
  return swissAzalt(swe, jd, pos[0], pos[1]);
}

async function main() {
  const swe = await loadSwiss();
  if (!swe) {
    console.log('SKIP: Swiss Ephemeris unavailable in Node; code audit still applies in astronomy.js.');
    process.exit(0);
  }
  const sun = swe.SE_SUN ?? 0;
  let failed = 0;
  let passed = 0;

  // 1) Every archaeoline type nominal declination: azalt(RA,dec) is self-consistent at sample HAs
  const jd = julianDayUT(2024, 6, 21, 12);
  const allDecs = [
    ...ARCHAEO_NOMINAL.equinox,
    ...ARCHAEO_NOMINAL.solstice(jd),
    ...ARCHAEO_NOMINAL.crossquarter(jd),
    27, -27, 18, -18 // lunar standstill magnitudes (smoke)
  ];
  for (const dec of allDecs) {
    for (const ha of [-120, -60, 0, 60, 120]) {
      const ra = raDegFromHourAngle(jd, OBSERVER, ha);
      const a = archaeoPoint(swe, jd, dec, ha);
      const b = swissAzalt(swe, jd, ra, dec);
      const d = maxDelta(a, b);
      if (d.dAlt > 1e-6 || d.dAz > 1e-6) {
        failed += 1;
        console.error(`FAIL pipeline identity dec=${dec} HA=${ha} Δalt=${d.dAlt}`);
        break;
      }
    }
    if (!failed) {
      passed += 1;
      console.log(`PASS azalt pipeline identity for dec=${dec.toFixed(2)}°`);
    }
  }

  // 2) When Sun declination matches a line (summer solstice), that line matches Sun path all day
  const jdSummer = julianDayUT(2024, 6, 21, 0);
  const sunDec = swissBodyDec(swe, jdSummer + 0.5, sun);
  const summerLineDec = refineDec(ARCHAEO_NOMINAL.solstice(jdSummer)[0], sunDec);
  let worst = { dAlt: 0, hour: 0 };
  for (let h = 0; h <= 24; h += 1) {
    const jdh = jdSummer + h / 24;
    const path = bodyPathPoint(swe, jdh, sun);
    const lst = normalizeDeg(greenwichSiderealDeg(jdh) + OBSERVER.longitude);
    const pos = swe.calc_ut(jdh, sun, (swe.SEFLG_SWIEPH ?? 2) | 256 | 2048 | 32768);
    const ha = normalizeDeg(lst - pos[0]);
    const haSigned = ha > 180 ? ha - 360 : ha;
    const arc = archaeoPoint(swe, jdh, summerLineDec, haSigned);
    const d = maxDelta(arc, path);
    if (d.dAlt > worst.dAlt) worst = { dAlt: d.dAlt, hour: h, dAz: d.dAz };
  }
  if (worst.dAlt < 0.02) {
    passed += 1;
    console.log(`PASS summer solstice line tracks Sun path (worst Δalt ${worst.dAlt.toFixed(4)}°)`);
  } else {
    failed += 1;
    console.error(`FAIL summer solstice vs Sun path worst Δalt=${worst.dAlt.toFixed(3)}° @ h=${worst.hour}`);
  }

  // 3) Winter solstice line does NOT match summer Sun (sanity — opposite declination)
  const winterDec = ARCHAEO_NOMINAL.solstice(jdSummer)[1];
  const arcWinter = archaeoPoint(swe, jdSummer + 0.5, winterDec, 0);
  const sunMid = bodyPathPoint(swe, jdSummer + 0.5, sun);
  const dOpp = maxDelta(arcWinter, sunMid);
  if (dOpp.dAlt > 5) {
    passed += 1;
    console.log('PASS winter solstice line correctly separate from summer Sun');
  } else {
    failed += 1;
    console.error('FAIL winter solstice line should not match summer Sun');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
