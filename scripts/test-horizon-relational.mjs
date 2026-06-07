/**
 * Node test: viewshed + horizon relational match at default and Loughcrew observer.
 */
import { Worker } from 'worker_threads';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerPath = join(__dirname, '..', 'horizon-worker.js');

const OBS_DEFAULT = { lat: 53.490266, lon: -7.5625666 };
const OBS_LOUGHCREW = { lat: 53.74255388257798, lon: -7.135280887259426 };

const ROI_URL = 'https://services-eu1.arcgis.com/HyjXgkV6KGMSF3jt/ArcGIS/rest/services/SMROpenData/FeatureServer/0/query';

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

async function fetchMonuments(observer, radiusKm = 120) {
  const r = radiusKm * 1000;
  const latOff = r / 111320;
  const lonOff = r / (111320 * Math.cos((observer.lat * Math.PI) / 180));
  const geom = `${observer.lon - lonOff},${observer.lat - latOff},${observer.lon + lonOff},${observer.lat + latOff}`;
  const where = encodeURIComponent(
    "MONUMENT_CLASS IN ('Megalithic tomb - passage tomb','Cairn - unclassified','Megalithic tomb - wedge tomb','Megalithic tomb - court tomb','Megalithic tomb - portal tomb')"
  );
  const url = `${ROI_URL}?f=json&where=${where}&geometry=${geom}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outFields=SMRS,MONUMENT_CLASS,TOWNLAND&outSR=4326&resultRecordCount=2000`;
  const j = await (await fetch(url)).json();
  return (j.features || []).map((f) => ({
    lat: f.geometry.y,
    lng: f.geometry.x,
    props: f.attributes || {}
  }));
}

function runWorkerPipeline(observer, monuments, floatM = 500) {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerPath);
    const token = 1;
    const t = setTimeout(() => {
      w.terminate();
      reject(new Error('timeout 300s'));
    }, 300000);
    let viewshedPayload = null;

    w.on('message', (msg) => {
      if (msg.token !== token) return;
      if (msg.type === 'PROGRESS') {
        process.stdout.write(`\r  ${msg.payload?.message || ''}`.padEnd(70));
        return;
      }
      if (msg.type === 'VIEWSHED_RESULT') {
        viewshedPayload = msg.payload;
        w.postMessage({
          type: 'MATCH_HORIZON_MONUMENTS',
          token,
          payload: {
            lat: observer.lat,
            lon: observer.lon,
            observerH: viewshedPayload.observerH,
            horizonData: viewshedPayload.horizonData,
            monuments,
            floatM,
            azClusterDeg: 0.4,
            resKey: 'quick'
          }
        });
        return;
      }
      if (msg.type === 'MATCH_RESULT') {
        clearTimeout(t);
        w.terminate();
        console.log('');
        resolve({ viewshed: viewshedPayload, match: msg.payload });
        return;
      }
      if (msg.type === 'ERROR') {
        clearTimeout(t);
        w.terminate();
        reject(new Error(msg.payload?.message || 'worker error'));
      }
    });

    w.on('error', reject);
    w.postMessage({
      type: 'COMPUTE_VIEWSHED',
      token,
      payload: { lat: observer.lat, lon: observer.lon, resKey: 'quick' }
    });
  });
}

async function runTest(label, observer) {
  console.log(`\n=== ${label} ===`);
  console.log(`Observer: ${observer.lat}, ${observer.lon}`);
  const monuments = await fetchMonuments(observer);
  console.log(`Relational monuments in 120 km envelope: ${monuments.length}`);
  const within5 = monuments.filter((m) => haversine(observer.lat, observer.lon, m.lat, m.lng) <= 5000);
  const within15 = monuments.filter((m) => haversine(observer.lat, observer.lon, m.lat, m.lng) <= 15000);
  console.log(`Within 5 km: ${within5.length}, within 15 km: ${within15.length}`);
  const ex = monuments.find((m) => String(m.props.SMRS || '').includes('ME015-003009'));
  if (ex) {
    console.log(`Example ME015-003009: ${haversine(observer.lat, observer.lon, ex.lat, ex.lng).toFixed(0)} m`);
  } else {
    console.log('Example ME015-003009: not in fetch');
  }

  const { viewshed, match } = await runWorkerPipeline(observer, monuments);
  console.log(`observerH: ${viewshed.observerH?.toFixed(2)} m`);
  console.log(`Profile bearings: ${viewshed.horizonData?.length}`);
  console.log(`Matched: ${match.matchCount}, clusters: ${match.clusters?.length}`);

  if (match.matchCount === 0 && monuments.length > 0) {
    console.log('DIAGNOSTIC: sample alt deltas for nearest 8 monuments...');
    const dem = null;
    const near = [...monuments]
      .map((m) => ({ m, d: haversine(observer.lat, observer.lon, m.lat, m.lng) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
    for (const { m, d } of near) {
      const brg = 0;
      console.log(`  ${m.props.SMRS} d=${d.toFixed(0)}m class=${m.props.MONUMENT_CLASS}`);
    }
  }

  return match.matchCount;
}

const d1 = await runTest('DEFAULT_OBSERVER', OBS_DEFAULT);
const d2 = await runTest('LOUGHCREW_EXAMPLE', OBS_LOUGHCREW);
console.log('\n=== SUMMARY ===');
console.log(`Default location matches: ${d1}`);
console.log(`Loughcrew example matches: ${d2}`);
process.exit(d1 > 0 || d2 > 0 ? 0 : 1);
