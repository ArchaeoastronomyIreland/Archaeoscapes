/**
 * Fast sanity check: polyline float match (no viewshed fetch).
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Worker } from 'worker_threads';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = join(__dirname, '..', 'horizon-worker.js');
const src = readFileSync(workerPath, 'utf8');

if (!src.includes('pointToPolylineDistanceMeters(lat, lng, poly)')) {
  console.error('FAIL: worker must use polyline distance for float match');
  process.exit(1);
}
if (src.includes('floatMToAltTolDeg')) {
  console.error('FAIL: altitude-tolerance float match should be removed');
  process.exit(1);
}

// Minimal viewshed ring around observer; monument on the ring.
const observer = { lat: 53.74255, lon: -7.13528 };
const observerH = 250;
const rKm = 5;
const horizonData = [];
for (let i = 0; i < 360; i++) {
  const brg = i;
  const rad = (brg * Math.PI) / 180;
  const dLat = (rKm * 1000 * Math.cos(rad)) / 111320;
  const dLon = (rKm * 1000 * Math.sin(rad)) / (111320 * Math.cos((observer.lat * Math.PI) / 180));
  horizonData.push({
    azimuth: brg,
    altitude: 0.5,
    horizonLat: observer.lat + dLat,
    horizonLon: observer.lon + dLon
  });
}

const monumentOnRing = {
  lat: observer.lat + (rKm * 1000 * Math.cos(0)) / 111320,
  lng: observer.lon,
  props: { SMRS: 'TEST-RING', MONUMENT_CLASS: 'Cairn - unclassified' }
};

const monumentFar = {
  lat: observer.lat + 0.5,
  lng: observer.lon,
  props: { SMRS: 'TEST-FAR', MONUMENT_CLASS: 'Cairn - unclassified' }
};

function matchInWorker(monuments, floatM) {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerPath);
    const token = 99;
    const t = setTimeout(() => {
      w.terminate();
      reject(new Error('timeout 60s'));
    }, 60000);
    w.on('message', (msg) => {
      if (msg.token !== token) return;
      if (msg.type === 'MATCH_RESULT') {
        clearTimeout(t);
        w.terminate();
        resolve(msg.payload);
      }
      if (msg.type === 'ERROR') {
        clearTimeout(t);
        w.terminate();
        reject(new Error(msg.payload?.message || 'error'));
      }
    });
    w.on('error', reject);
    w.postMessage({
      type: 'MATCH_HORIZON_MONUMENTS',
      token,
      payload: {
        lat: observer.lat,
        lon: observer.lon,
        observerH,
        horizonData,
        monuments,
        floatM,
        azClusterDeg: 0.4,
        resKey: 'quick'
      }
    });
  });
}

const near = await matchInWorker([monumentOnRing], 500);
const far = await matchInWorker([monumentFar], 100);
console.log('On ring (float 500m):', near.matchCount, 'expected 1');
console.log('Far site (float 100m):', far.matchCount, 'expected 0');
if (near.matchCount !== 1 || far.matchCount !== 0) {
  console.error('FAIL');
  process.exit(1);
}
console.log('OK polyline float match');
