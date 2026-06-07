/**
 * Loughcrew observer: compare monument altitude vs viewshed horizon at bearing.
 */
const OBS = { lat: 53.74255388257798, lon: -7.135280887259426 };
const FLOAT_M = 500;
const EARTH_R = 6371000;
const K = 0.13;
const TILE = 256;
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

function haversine(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return EARTH_R * 2 * Math.asin(Math.sqrt(a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function decodeElev(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

function project(lat, lon, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n * TILE;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE;
  return { x, y };
}

async function loadTile(z, x, y) {
  const url = TERRARIUM.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(TILE, TILE);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, TILE, TILE).data;
}

async function buildDem(centerLat, centerLon, z, radiusTiles) {
  const c = project(centerLat, centerLon, z);
  const tcx = Math.floor(c.x / TILE);
  const tcy = Math.floor(c.y / TILE);
  const w = radiusTiles * 2 + 1;
  const size = w * TILE;
  const data = new Float32Array(size * size);
  let ti = 0;
  for (let ty = -radiusTiles; ty <= radiusTiles; ty++) {
    for (let tx = -radiusTiles; tx <= radiusTiles; tx++) {
      process.stdout.write(`\rTile ${++ti}/${w * w}`);
      const px = await loadTile(z, tcx + tx, tcy + ty);
      const base = ((ty + radiusTiles) * w + (tx + radiusTiles)) * TILE;
      for (let py = 0; py < TILE; py++) {
        for (let px2 = 0; px2 < TILE; px2++) {
          const idx = (py * TILE + px2) * 4;
          data[base + py * size + px2] = decodeElev(px[idx], px[idx + 1], px[idx + 2]);
        }
      }
    }
  }
  console.log('');
  return { data, width: size, originX: (tcx - radiusTiles) * TILE, originY: (tcy - radiusTiles) * TILE, zoom: z };
}

function sampleH(dem, lat, lon) {
  const pt = project(lat, lon, dem.zoom);
  const lx = pt.x - dem.originX;
  const ly = pt.y - dem.originY;
  if (lx < 0 || ly < 0 || lx >= dem.width - 1 || ly >= dem.height - 1) return null;
  const x0 = Math.floor(lx);
  const y0 = Math.floor(ly);
  const dx = lx - x0;
  const dy = ly - y0;
  const w = dem.width;
  const idx = y0 * w + x0;
  const h00 = dem.data[idx];
  const h10 = dem.data[idx + 1];
  const h01 = dem.data[idx + w];
  const h11 = dem.data[idx + w + 1];
  if (![h00, h10, h01, h11].every(Number.isFinite)) return null;
  const h0 = h00 * (1 - dx) + h10 * dx;
  const h1 = h01 * (1 - dx) + h11 * dx;
  return h0 * (1 - dy) + h1 * dy;
}

function siteAlt(obsH, obsLat, obsLon, lat, lon, ground) {
  const d = haversine(obsLat, obsLon, lat, lon);
  if (d < 15) return null;
  const h = (d * d * (1 - K)) / (2 * EARTH_R);
  return (Math.atan2(ground - (obsH + h), d) * 180) / Math.PI;
}

function rayHorizonAlt(obsH, obsLat, obsLon, dem, az) {
  const z = dem.zoom;
  const mpp = (40075016 * Math.cos((obsLat * Math.PI) / 180)) / 2 ** (z + 8);
  const maxPx = 120000 / mpp;
  let maxA = -90;
  for (let r = 2; r < maxPx; r += 3) {
    const dist = r * mpp;
    const brg = (az * Math.PI) / 180;
    const lat2 = obsLat + (dist / 111320) * Math.cos(brg);
    const lon2 = obsLon + (dist / (111320 * Math.cos((obsLat * Math.PI) / 180))) * Math.sin(brg);
    const g = sampleH(dem, lat2, lon2);
    if (g === null) break;
    const h = (dist * dist * (1 - K)) / (2 * EARTH_R);
    const ang = (Math.atan2(g - (obsH + h), dist) * 180) / Math.PI;
    if (ang > maxA) maxA = ang;
  }
  return maxA;
}

const ROI = 'https://services-eu1.arcgis.com/HyjXgkV6KGMSF3jt/ArcGIS/rest/services/SMROpenData/FeatureServer/0/query';
const r = 120000;
const latOff = r / 111320;
const lonOff = r / (111320 * Math.cos((OBS.lat * Math.PI) / 180));
const geom = `${OBS.lon - lonOff},${OBS.lat - latOff},${OBS.lon + lonOff},${OBS.lat + latOff}`;
const url = `${ROI}?f=json&where=${encodeURIComponent("MONUMENT_CLASS IN ('Megalithic tomb - passage tomb','Cairn - unclassified')")}&geometry=${geom}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=SMRS,MONUMENT_CLASS&outSR=4326&resultRecordCount=400`;
const feats = (await (await fetch(url)).json()).features || [];
const mons = feats.map((f) => ({ lat: f.geometry.y, lng: f.geometry.x, smr: f.attributes.SMRS, cls: f.attributes.MONUMENT_CLASS }));

console.log('Loughcrew observer, monuments in envelope:', mons.length);
const near = mons.map((m) => ({ ...m, d: haversine(OBS.lat, OBS.lon, m.lat, m.lng) })).filter((m) => m.d < 20000).sort((a, b) => a.d - b.d);
console.log('Within 20 km:', near.length);

console.log('Building DEM Z11...');
const dem = await buildDem(OBS.lat, OBS.lon, 11, 10);
const obsG = sampleH(dem, OBS.lat, OBS.lon);
const obsH = (obsG ?? 0) + 2;
console.log('Observer AMSL+2m:', obsH.toFixed(1));

let pass = 0;
let failBelow = 0;
for (const m of near.slice(0, 50)) {
  const az = bearing(OBS.lat, OBS.lon, m.lat, m.lng);
  const g = sampleH(dem, m.lat, m.lng);
  if (g === null) {
    console.log(`  ${m.smr} NO DEM`);
    continue;
  }
  const monA = siteAlt(obsH, OBS.lat, OBS.lon, m.lat, m.lng, g);
  const horA = rayHorizonAlt(obsH, OBS.lat, OBS.lon, dem, az);
  const tol = Math.max(0.35, (Math.atan(FLOAT_M / m.d) * 180) / Math.PI);
  const ok = monA >= horA - tol && monA <= horA + tol * 3;
  if (ok) pass++;
  else if (monA < horA - tol) failBelow++;
  console.log(`  ${String(m.smr).slice(0, 16).padEnd(16)} ${m.d.toFixed(0).padStart(5)}m  mon=${monA?.toFixed(2).padStart(6)}° hor=${horA?.toFixed(2).padStart(6)}° Δ=${(monA - horA).toFixed(2).padStart(6)}° ${ok ? 'PASS' : 'fail'}`);
}
console.log(`\nMatch: ${pass} / ${Math.min(50, near.length)}  (below skyline: ${failBelow})`);
