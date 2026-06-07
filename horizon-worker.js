/* global self, OffscreenCanvas, createImageBitmap, fetch */
const self = globalThis;

const TILE_SIZE = 256;
const EARTH_RADIUS_M = 6371000;
const REFRACTION_COEFF_K = 0.13;
const PEAK_FIND_ZOOM = 14;
const VIEWPOINT_HEIGHT_M = 2;
const TERRARIUM_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

const VIEWSHED_SCAN_RADIUS_KM = 120;

/** Reused for horizon monument elevation samples (same Terrarium DEM as viewshed). */
let viewshedDemCache = null;
let viewshedDemZoom = 11;
let viewshedDemObserver = null;
let viewshedDemRadiusTiles = 0;

const RES_SETTINGS = {
  quick: { zoom: 11, steps: 360, scanRadiusKm: VIEWSHED_SCAN_RADIUS_KM },
  hires: { zoom: 11, steps: 3600, scanRadiusKm: VIEWSHED_SCAN_RADIUS_KM },
  super: { zoom: 12, steps: 3600, scanRadiusKm: VIEWSHED_SCAN_RADIUS_KM }
};

function toRad(d) { return (d * Math.PI) / 180; }
function toDeg(r) { return (r * 180) / Math.PI; }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function normalizeAzimuthDeg(a) {
  const x = Number(a);
  if (!isFinite(x)) return null;
  return ((x % 360) + 360) % 360;
}

function shortestAzDiffDeg(a, b) {
  const aa = normalizeAzimuthDeg(a);
  const bb = normalizeAzimuthDeg(b);
  if (aa === null || bb === null) return null;
  const d = Math.abs(aa - bb);
  return Math.min(d, 360 - d);
}

function projectLatLng(lat, lon, zoom) {
  const latRad = toRad(lat);
  const n = Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * n * TILE_SIZE;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * TILE_SIZE;
  return { x, y };
}

function destinationPoint(latDeg, lonDeg, distM, bearingDeg) {
  const φ1 = toRad(latDeg);
  const λ1 = toRad(lonDeg);
  const θ = toRad(bearingDeg);
  const δ = distM / EARTH_RADIUS_M;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const sinθ = Math.sin(θ);
  const cosθ = Math.cos(θ);
  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * cosθ;
  const φ2 = Math.asin(clamp(sinφ2, -1, 1));
  const y = sinθ * sinδ * cosφ1;
  const x = cosδ - sinφ1 * Math.sin(φ2);
  const λ2 = λ1 + Math.atan2(y, x);
  let lon2 = toDeg(λ2);
  lon2 = ((lon2 + 540) % 360) - 180;
  return { lat: toDeg(φ2), lon: lon2 };
}

function baseMetersPerPx(latDeg, zoom) {
  return (40075016 * Math.cos(toRad(latDeg))) / Math.pow(2, zoom + 8);
}

function terrariumUrl(z, x, y) {
  return `${TERRARIUM_BASE}/${z}/${x}/${y}.png`;
}

async function loadImageBitmap(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch (_) {
    return null;
  }
}

async function fetchTerrainPatch(centerLat, centerLon, zoom, radiusTiles, onTileProgress) {
  const centerPt = projectLatLng(centerLat, centerLon, zoom);
  const centerTileX = Math.floor(centerPt.x / TILE_SIZE);
  const centerTileY = Math.floor(centerPt.y / TILE_SIZE);
  const minX = centerTileX - radiusTiles;
  const maxX = centerTileX + radiusTiles;
  const minY = centerTileY - radiusTiles;
  const maxY = centerTileY + radiusTiles;
  const tiles = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) tiles.push({ x, y });
  }
  const imgs = [];
  const CHUNK = 32;
  let done = 0;
  for (let i = 0; i < tiles.length; i += CHUNK) {
    const slice = tiles.slice(i, i + CHUNK);
    const part = await Promise.all(slice.map(async (t) => {
      const bmp = await loadImageBitmap(terrariumUrl(zoom, t.x, t.y));
      return bmp ? { x: t.x, y: t.y, bmp } : null;
    }));
    for (const p of part) if (p) imgs.push(p);
    done += slice.length;
    if (onTileProgress) onTileProgress(done, tiles.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  const gridTiles = radiusTiles * 2 + 1;
  const gridWidth = gridTiles * TILE_SIZE;
  const originX = minX * TILE_SIZE;
  const originY = minY * TILE_SIZE;
  const canvas = new OffscreenCanvas(gridWidth, gridWidth);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (const t of imgs) {
    const ox = (t.x * TILE_SIZE) - originX;
    const oy = (t.y * TILE_SIZE) - originY;
    ctx.drawImage(t.bmp, ox, oy);
    t.bmp.close?.();
  }
  const raw = ctx.getImageData(0, 0, gridWidth, gridWidth).data;
  const data = new Float32Array(gridWidth * gridWidth);
  for (let i = 0, j = 0; i < raw.length; i += 4, j++) {
    data[j] = (raw[i] * 256 + raw[i + 1] + raw[i + 2] / 256) - 32768;
  }
  return { data, width: gridWidth, zoom, originX, originY };
}

function bilinearHeight(dem, globalX, globalY) {
  const lx = globalX - dem.originX;
  const ly = globalY - dem.originY;
  if (lx < 0 || ly < 0 || lx >= dem.width - 1 || ly >= dem.width - 1) return null;
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
  if (!isFinite(h00) || !isFinite(h10) || !isFinite(h01) || !isFinite(h11)) return null;
  const h0 = h00 * (1 - dx) + h10 * dx;
  const h1 = h01 * (1 - dx) + h11 * dx;
  return h0 * (1 - dy) + h1 * dy;
}

async function getObserverHeightM(observerLat, observerLon, postProgress) {
  if (postProgress) postProgress('observer', 0, 1, 'Sampling observer height…');
  const obsData = await fetchTerrainPatch(observerLat, observerLon, PEAK_FIND_ZOOM, 1);
  const pt = projectLatLng(observerLat, observerLon, PEAK_FIND_ZOOM);
  const ground = bilinearHeight(obsData, pt.x, pt.y) ?? 0;
  if (postProgress) postProgress('observer', 1, 1, 'Observer height sampled.');
  return ground + VIEWPOINT_HEIGHT_M;
}

async function computeHorizonData(lat, lon, resKey, postProgress) {
  const normalizedKey = resKey === 'max' ? 'super' : resKey;
  const cfg = RES_SETTINGS[normalizedKey] || RES_SETTINGS.quick;
  const { zoom, steps, scanRadiusKm } = cfg;
  const metersPerPx = baseMetersPerPx(lat, zoom);
  const radiusTiles = Math.ceil((scanRadiusKm * 1000) / (metersPerPx * TILE_SIZE)) + 3;
  const gridTiles = radiusTiles * 2 + 1;
  if (postProgress) {
    postProgress('dem', 0, 1, `Fetching ${gridTiles}×${gridTiles} terrain tiles (${scanRadiusKm} km scan, Z${zoom})…`);
  }
  const dem = await fetchTerrainPatch(lat, lon, zoom, radiusTiles, (done, total) => {
    if (postProgress) {
      postProgress('dem', done, total, `Fetching terrain tiles ${done}/${total} (${scanRadiusKm} km scan)…`);
    }
  });
  viewshedDemCache = dem;
  viewshedDemZoom = zoom;
  viewshedDemObserver = { lat, lon };
  viewshedDemRadiusTiles = radiusTiles;
  const observerH = await getObserverHeightM(lat, lon, postProgress);
  const maxPx = (scanRadiusKm * 1000) / metersPerPx;
  const horizonData = [];
  let maxReachDistM = 0;
  const YIELD_INTERVAL = Math.max(10, Math.floor(steps / 40));
  for (let i = 0; i < steps; i++) {
    const bearing = i * (360 / steps);
    let maxAngle = -90;
    let horizonLat = NaN;
    let horizonLon = NaN;
    let rayReachM = 0;
    for (let r = 2; r < maxPx; r += 1) {
      const distMeters = r * metersPerPx;
      const dest = destinationPoint(lat, lon, distMeters, bearing);
      const pt = projectLatLng(dest.lat, dest.lon, zoom);
      const terrainH = bilinearHeight(dem, pt.x, pt.y);
      if (terrainH === null) break;
      rayReachM = distMeters;
      const h = (distMeters * distMeters * (1 - REFRACTION_COEFF_K)) / (2 * EARTH_RADIUS_M);
      const horizonHeight = observerH + h;
      const heightDiff = terrainH - horizonHeight;
      const angleDeg = clamp(Math.atan2(heightDiff, distMeters) * (180 / Math.PI), -90, 90);
      if (angleDeg > maxAngle) {
        maxAngle = angleDeg;
        horizonLat = dest.lat;
        horizonLon = dest.lon;
      }
    }
    if (rayReachM > maxReachDistM) maxReachDistM = rayReachM;
    horizonData.push({
      azimuth: bearing,
      altitude: clamp(maxAngle, -90, 90),
      horizonLat,
      horizonLon
    });
    if (postProgress && ((i + 1) % YIELD_INTERVAL === 0 || i + 1 === steps)) {
      postProgress('viewshed', i + 1, steps, `Computing viewshed (${scanRadiusKm} km scan, ${i + 1}/${steps})…`);
    }
    if ((i + 1) % YIELD_INTERVAL === 0) await new Promise((r) => setTimeout(r, 0));
  }
  horizonData.sort((a, b) => a.azimuth - b.azimuth);
  return {
    horizonData,
    observerH,
    zoom,
    steps,
    scanRadiusKm,
    maxReachDistKm: maxReachDistM / 1000
  };
}

function latLngToMercatorMeters(lat, lng) {
  const x = lng * 20037508.34 / 180;
  const latRad = toRad(lat);
  const y = Math.log(Math.tan(Math.PI / 4 + latRad / 2)) * 20037508.34 / Math.PI;
  return { x, y };
}

function mercatorDistanceMeters(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDistanceMeters(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLen2 = abx * abx + aby * aby;
  if (abLen2 <= 0) return mercatorDistanceMeters(px, py, ax, ay);
  let t = (apx * abx + apy * aby) / abLen2;
  t = clamp(t, 0, 1);
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return mercatorDistanceMeters(px, py, cx, cy);
}

function pointToPolylineDistanceMeters(lat, lon, poly) {
  const pts = Array.isArray(poly) ? poly : [];
  if (pts.length < 2) return Infinity;
  const p = latLngToMercatorMeters(lat, lon);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const pa = latLngToMercatorMeters(a.lat, a.lng);
    const pb = latLngToMercatorMeters(b.lat, b.lng);
    const d = pointToSegmentDistanceMeters(p.x, p.y, pa.x, pa.y, pb.x, pb.y);
    if (d < best) best = d;
  }
  return best;
}

function computeBearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeAzimuthDeg(toDeg(Math.atan2(y, x)));
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(clamp(a, 0, 1)));
}

/** Nearest viewshed sample for a ground bearing (monument → observer). */
function horizonSampleAtBearing(horizonData, bearingDeg) {
  const data = Array.isArray(horizonData) ? horizonData : [];
  if (!data.length) return null;
  const az = normalizeAzimuthDeg(bearingDeg);
  if (az === null) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const p of data) {
    const d = shortestAzDiffDeg(p?.azimuth, az);
    if (d !== null && d < bestDiff) {
      bestDiff = d;
      best = p;
    }
  }
  return best;
}

function buildHorizonPolyline(horizonData) {
  const src = Array.isArray(horizonData) ? horizonData : [];
  const poly = [];
  for (const p of src) {
    const lat = Number(p?.horizonLat);
    const lng = Number(p?.horizonLon);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    poly.push({ lat, lng });
  }
  if (poly.length >= 2) poly.push({ ...poly[0] });
  return poly;
}

function viewshedObserverMatches(a, b, eps = 0.00004) {
  if (!a || !b) return false;
  return Math.abs(Number(a.lat) - Number(b.lat)) <= eps
    && Math.abs(Number(a.lon) - Number(b.lon)) <= eps;
}

function sampleGroundM(dem, lat, lon, zoom) {
  if (!dem) return null;
  const pt = projectLatLng(lat, lon, zoom);
  return bilinearHeight(dem, pt.x, pt.y);
}

/** Same refraction/curvature model as viewshed ray-march. */
function siteAltitudeDeg(observerH, obsLat, obsLon, siteLat, siteLon, siteGroundM) {
  const distM = haversineMeters(obsLat, obsLon, siteLat, siteLon);
  if (!isFinite(distM) || distM < 15) return null;
  const h = (distM * distM * (1 - REFRACTION_COEFF_K)) / (2 * EARTH_RADIUS_M);
  const horizonHeight = observerH + h;
  const heightDiff = siteGroundM - horizonHeight;
  return clamp(Math.atan2(heightDiff, distM) * (180 / Math.PI), -90, 90);
}

async function ensureViewshedDemForObserver(lat, lon, resKey = 'quick') {
  const observer = { lat, lon };
  if (viewshedDemCache && viewshedDemObserver && viewshedObserverMatches(observer, viewshedDemObserver)) {
    return viewshedDemCache;
  }
  const cfg = RES_SETTINGS[resKey === 'max' ? 'super' : resKey] || RES_SETTINGS.quick;
  const zoom = cfg.zoom;
  const scanRadiusKm = cfg.scanRadiusKm;
  const metersPerPx = baseMetersPerPx(lat, zoom);
  const radiusTiles = Math.ceil((scanRadiusKm * 1000) / (metersPerPx * TILE_SIZE)) + 3;
  const dem = await fetchTerrainPatch(lat, lon, zoom, radiusTiles);
  viewshedDemCache = dem;
  viewshedDemZoom = zoom;
  viewshedDemObserver = observer;
  viewshedDemRadiusTiles = radiusTiles;
  return dem;
}

/**
 * MACE / autodetect style: monument within floatM (m) of the viewshed horizon polyline.
 * Altitude and azimuth come from the site DEM (same model as viewshed) for panorama markers.
 */
async function filterMonumentsNearHorizon(observer, observerH, horizonData, monuments, floatM, resKey, onProgress) {
  const poly = buildHorizonPolyline(horizonData);
  if (poly.length < 2) return [];
  const fm = Math.max(0, Number(floatM) || 0);
  const obsLat = Number(observer?.lat);
  const obsLon = Number(observer?.lon);
  const obsH = Number(observerH);
  if (!isFinite(obsLat) || !isFinite(obsLon)) return [];

  const profile = Array.isArray(horizonData) ? horizonData : [];
  const maxScanM = VIEWSHED_SCAN_RADIUS_KM * 1000;
  const observerPt = { lat: obsLat, lon: obsLon };
  let dem = null;
  let zoom = viewshedDemZoom;
  // Site alt/az uses the DEM already loaded for viewshed — never refetch on MATCH alone.
  if (isFinite(obsH) && viewshedDemCache && viewshedDemObserver && viewshedObserverMatches(observerPt, viewshedDemObserver)) {
    dem = viewshedDemCache;
    zoom = viewshedDemZoom;
  }

  const matches = [];
  const total = monuments.length;
  for (let i = 0; i < monuments.length; i++) {
    const m = monuments[i];
    const lat = Number(m?.lat);
    const lng = Number(m?.lng);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    if (onProgress && (i % 200 === 0 || i === total - 1)) onProgress(i + 1, total);

    const distToHorizonM = pointToPolylineDistanceMeters(lat, lng, poly);
    if (!isFinite(distToHorizonM) || distToHorizonM > fm) continue;

    const distM = haversineMeters(obsLat, obsLon, lat, lng);
    if (!isFinite(distM) || distM > maxScanM || distM < 15) continue;

    const azimuth = computeBearingDeg(obsLat, obsLon, lat, lng);
    let altitude = null;
    if (dem && isFinite(obsH)) {
      const siteGround = sampleGroundM(dem, lat, lng, zoom);
      if (siteGround !== null) {
        altitude = siteAltitudeDeg(obsH, obsLat, obsLon, lat, lng, siteGround);
      }
    }
    if (!isFinite(altitude)) {
      const sample = horizonSampleAtBearing(profile, azimuth);
      altitude = sample ? Number(sample.altitude) : 0;
    }

    matches.push({
      ...m,
      azimuth,
      altitude,
      distM,
      distToHorizonM,
      bearing: azimuth
    });
  }
  matches.sort((a, b) => a.azimuth - b.azimuth);
  return matches;
}

function clusterMatchesByAzimuth(matches, azClusterDeg) {
  const tol = Math.max(0.05, Number(azClusterDeg) || 0.4);
  if (!matches.length) return [];
  const clusters = [];
  let current = null;
  for (const m of matches) {
    if (!current) {
      current = { members: [m], bearingMin: m.bearing, bearingMax: m.bearing };
      clusters.push(current);
      continue;
    }
    const diff = shortestAzDiffDeg(m.bearing, current.bearingMax);
    if (diff !== null && diff <= tol) {
      current.members.push(m);
      current.bearingMax = m.bearing;
    } else {
      current = { members: [m], bearingMin: m.bearing, bearingMax: m.bearing };
      clusters.push(current);
    }
  }
  if (clusters.length > 1) {
    const first = clusters[0];
    const last = clusters[clusters.length - 1];
    const wrapDiff = shortestAzDiffDeg(first.bearingMin, last.bearingMax);
    if (wrapDiff !== null && wrapDiff <= tol) {
      last.members.push(...first.members);
      clusters.shift();
    }
  }
  return clusters.map((c, idx) => {
    const lats = c.members.map((m) => m.lat);
    const lngs = c.members.map((m) => m.lng);
    const lat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const lng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
    const bearing = normalizeAzimuthDeg((c.bearingMin + c.bearingMax) / 2);
    const altSum = c.members.reduce((s, mem) => s + (Number(mem.altitude) || 0), 0);
    const distSum = c.members.reduce((s, mem) => s + (Number(mem.distM) || 0), 0);
    const n = c.members.length;
    return {
      id: `hz-cluster-${idx}`,
      bearing,
      bearingMin: c.bearingMin,
      bearingMax: c.bearingMax,
      azimuth: bearing,
      altitude: n ? altSum / n : 0,
      distM: n ? distSum / n : 0,
      lat,
      lng,
      count: n,
      members: c.members
    };
  });
}

function workerPost(msg, token) {
  const out = { ...msg, token };
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.postMessage(out);
    return;
  }
  try {
    require('node:worker_threads').parentPort?.postMessage(out);
  } catch (_) {}
}

const onWorkerMessage = async (raw) => {
  const e = raw?.data !== undefined ? raw : { data: raw };
  const { type, token, payload } = e.data || {};
  const post = (msg) => workerPost(msg, token);

  if (type === 'COMPUTE_VIEWSHED') {
    try {
      const lat = Number(payload?.lat);
      const lon = Number(payload?.lon);
      if (!isFinite(lat) || !isFinite(lon)) throw new Error('Invalid observer coordinates.');
      const resKey = String(payload?.resKey || 'quick');
      const postProgress = (phase, done, total, message) => {
        post({ type: 'PROGRESS', payload: { phase, done, total, message } });
      };
      postProgress('start', 0, 1, `Starting viewshed (${VIEWSHED_SCAN_RADIUS_KM} km scan)…`);
      const out = await computeHorizonData(lat, lon, resKey, postProgress);
      post({
        type: 'VIEWSHED_RESULT',
        payload: {
          horizonData: out.horizonData,
          observerH: out.observerH,
          resKey,
          scanRadiusKm: out.scanRadiusKm,
          maxReachDistKm: out.maxReachDistKm,
          steps: out.steps,
          zoom: out.zoom
        }
      });
    } catch (err) {
      post({ type: 'ERROR', payload: { message: String(err?.message || err) } });
    }
    return;
  }

  if (type === 'MATCH_HORIZON_MONUMENTS') {
    try {
      const lat = Number(payload?.lat);
      const lon = Number(payload?.lon);
      if (!isFinite(lat) || !isFinite(lon)) throw new Error('Invalid observer coordinates.');
      const observerH = Number(payload?.observerH);
      if (!isFinite(observerH)) throw new Error('Observer height required for horizon matching.');
      const horizonData = Array.isArray(payload?.horizonData) ? payload.horizonData : [];
      if (!horizonData.length) throw new Error('Horizon profile required for monument matching.');
      const floatM = Math.max(0, Number(payload?.floatM) || 300);
      const azClusterDeg = Math.max(0.05, Number(payload?.azClusterDeg) || 0.4);
      const resKey = String(payload?.resKey || 'quick');
      const monuments = Array.isArray(payload?.monuments) ? payload.monuments : [];
      const observer = { lat, lon };
      const postProgress = (done, total, message) => {
        post({ type: 'PROGRESS', payload: { phase: 'match', done, total, message } });
      };
      const matches = await filterMonumentsNearHorizon(
        observer,
        observerH,
        horizonData,
        monuments,
        floatM,
        resKey,
        (done, total) => postProgress(done, total, `Matching monuments to skyline (${done}/${total})…`)
      );
      postProgress(monuments.length, Math.max(1, monuments.length), 'Clustering horizon markers…');
      const clusters = clusterMatchesByAzimuth(matches, azClusterDeg);
      post({
        type: 'MATCH_RESULT',
        payload: {
          floatM,
          azClusterDeg,
          matchCount: matches.length,
          clusters
        }
      });
    } catch (err) {
      post({ type: 'ERROR', payload: { message: String(err?.message || err) } });
    }
    return;
  }

  if (type !== 'COMPUTE') return;

  try {
    const lat = Number(payload?.lat);
    const lon = Number(payload?.lon);
    if (!isFinite(lat) || !isFinite(lon)) throw new Error('Invalid observer coordinates.');
    const resKey = String(payload?.resKey || 'quick');
    const floatM = Math.max(0, Number(payload?.floatM) || 300);
    const azClusterDeg = Math.max(0.05, Number(payload?.azClusterDeg) || 0.4);
    const monuments = Array.isArray(payload?.monuments) ? payload.monuments : [];
    const postProgress = (phase, done, total, message) => {
      post({ type: 'PROGRESS', payload: { phase, done, total, message } });
    };
    postProgress('start', 0, 1, `Starting viewshed (${VIEWSHED_SCAN_RADIUS_KM} km scan)…`);
    const out = await computeHorizonData(lat, lon, resKey, postProgress);
    postProgress('match', 0, 1, `Matching monuments to skyline alt/az…`);
    const observer = { lat, lon };
    const matches = await filterMonumentsNearHorizon(observer, out.observerH, out.horizonData, monuments, floatM, resKey);
    const clusters = clusterMatchesByAzimuth(matches, azClusterDeg);
    post({
      type: 'RESULT',
      payload: {
        horizonData: out.horizonData,
        observerH: out.observerH,
        resKey,
        scanRadiusKm: out.scanRadiusKm,
        maxReachDistKm: out.maxReachDistKm,
        steps: out.steps,
        zoom: out.zoom,
        floatM,
        azClusterDeg,
        matchCount: matches.length,
        clusters
      }
    });
  } catch (err) {
    post({ type: 'ERROR', payload: { message: String(err?.message || err) } });
  }
};

if (typeof self !== 'undefined') self.onmessage = onWorkerMessage;
try {
  const { parentPort } = require('node:worker_threads');
  if (parentPort) parentPort.on('message', onWorkerMessage);
} catch (_) {}
