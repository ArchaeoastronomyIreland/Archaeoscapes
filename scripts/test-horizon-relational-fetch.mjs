/**
 * Verifies split horizon relational fetch: ROI typed server filter + NI broad SMRNo + client classify.
 */
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ROI_URL = 'https://services-eu1.arcgis.com/HyjXgkV6KGMSF3jt/ArcGIS/rest/services/SMROpenData/FeatureServer/0/query';
const NI_URL = 'https://services2.arcgis.com/BdBkthNLO9mzGAMO/arcgis/rest/services/Historic_Environment_Division_GIS_Data/FeatureServer/0/query';

const OBS_LOUGHCREW = { lat: 53.74255388257798, lng: -7.135280887259426, label: 'Loughcrew (ROI)' };
const OBS_BELFAST = { lat: 54.5762, lng: -5.9640, label: 'Belfast NI' };

const SELECTED_CLASSES = new Set([
  'Megalithic tomb - passage tomb',
  'Megalithic tomb - wedge tomb',
  'Megalithic tomb - court tomb',
  'Megalithic tomb - portal tomb',
  'Megalithic tomb - unclassified',
  'Cairn - unclassified',
  'Stone circle',
  'Standing stone',
  'Standing stone - pair',
  'Stone row',
  'Henge'
]);

const ROI_TYPED_WHERE = `MONUMENT_CLASS IN (${[...SELECTED_CLASSES].map((c) => `'${c.replace(/'/g, "''")}'`).join(',')})`;
const NI_BROAD_WHERE = 'SMRNo IS NOT NULL';

function sqlLike(field, text) {
  const t = String(text || '').replace(/'/g, "''");
  return `UPPER(${field}) LIKE '%${t.replace(/\s+/g, '%')}%'`;
}

function whereForNiType(monumentClass) {
  const cls = String(monumentClass || '').trim();
  const general = 'General_Type';
  const edited = 'Edited_Type';
  if (cls === 'Megalithic tomb - passage tomb') return sqlLike(edited, 'PASSAGE TOMB');
  if (cls === 'Stone circle') return `(${general} = 'STONE CIRCLE' OR ${sqlLike(edited, 'STONE CIRCLE')})`;
  if (cls === 'Standing stone') return `(${general} = 'STANDING STONE' OR ${sqlLike(edited, 'STANDING STONE')})`;
  return '1=0';
}

function niTypedWhere() {
  const clauses = [...SELECTED_CLASSES].map(whereForNiType).filter((w) => w && w !== '1=0');
  return clauses.length ? `(${clauses.join(') OR (')})` : '1=0';
}

function envelopeFor(observer, radiusKm = 120) {
  const r = radiusKm * 1000;
  const latOff = r / 111320;
  const lonOff = r / (111320 * Math.cos((observer.lat * Math.PI) / 180));
  return {
    nw: { lat: observer.lat + latOff, lng: observer.lng - lonOff },
    se: { lat: observer.lat - latOff, lng: observer.lng + lonOff }
  };
}

function cleanLookupText(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyNiMonument(attrs) {
  const a = attrs || {};
  const edited = cleanLookupText(a.Edited_Type || a.Edited_Typ);
  const general = cleanLookupText(a.General_Type || a.General_Ty);
  const hay = `${edited} ${general}`.trim();
  if (!hay) return '';
  if (/\bPASSAGE TOMB\b/.test(hay)) return 'Megalithic tomb - passage tomb';
  if (/\bCOURT TOMB\b/.test(hay)) return 'Megalithic tomb - court tomb';
  if (/\bPORTAL TOMB\b/.test(hay)) return 'Megalithic tomb - portal tomb';
  if (/\bWEDGE TOMB\b/.test(hay)) return 'Megalithic tomb - wedge tomb';
  if (/\bMEGALITHIC TOMB\b/.test(hay)) return 'Megalithic tomb - unclassified';
  if (/\bSTONE CIRCLE\b/.test(hay)) return 'Stone circle';
  if (/\bSTANDING STONE\b/.test(hay)) return 'Standing stone';
  if (/\bCAIRN\b/.test(hay)) return 'Cairn - unclassified';
  return '';
}

async function fetchArcgis(url, where, env, maxFeatures = 12000) {
  const collected = [];
  let offset = 0;
  const pageSize = 2000;
  while (collected.length < maxFeatures) {
    const take = Math.min(pageSize, maxFeatures - collected.length);
    const params = new URLSearchParams({
      f: 'json',
      where,
      returnGeometry: 'true',
      outFields: '*',
      outSR: '4326',
      resultRecordCount: String(take),
      resultOffset: String(offset),
      inSR: '4326',
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      geometry: `${env.nw.lng},${env.se.lat},${env.se.lng},${env.nw.lat}`
    });
    const res = await fetch(`${url}?${params}`);
    const json = await res.json();
    if (json?.error) {
      throw new Error(json.error.message || 'ArcGIS error');
    }
    const features = json.features || [];
    collected.push(...features);
    if (features.length < take) break;
    offset += features.length;
  }
  return collected;
}

function filterRoi(features) {
  return features.filter((f) => {
    const cls = String(f.attributes?.MONUMENT_CLASS || '').trim();
    return SELECTED_CLASSES.has(cls);
  });
}

function filterNi(features) {
  return features.filter((f) => {
    const cls = classifyNiMonument(f.attributes);
    return cls && SELECTED_CLASSES.has(cls);
  });
}

async function probe(label, url, where, observer, maxFeatures) {
  const env = envelopeFor(observer);
  try {
    const features = await fetchArcgis(url, where, env, maxFeatures);
    return { ok: true, count: features.length, error: null, features };
  } catch (e) {
    return { ok: false, count: 0, error: e.message || String(e), features: [] };
  }
}

let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures += 1;
  } else {
    console.log(`OK: ${msg}`);
  }
}

console.log('=== Horizon relational split fetch ===\n');

for (const observer of [OBS_LOUGHCREW, OBS_BELFAST]) {
  console.log(`--- ${observer.label} ---`);
  const env = envelopeFor(observer);

  const roiTyped = await probe('ROI typed', ROI_URL, ROI_TYPED_WHERE, observer, 12000);
  console.log(`ROI typed: ${roiTyped.ok ? roiTyped.count : `ERROR ${roiTyped.error}`}`);
  if (roiTyped.ok) {
    const filtered = filterRoi(roiTyped.features);
    console.log(`  ROI after class filter: ${filtered.length}`);
  }

  const niBroad = await probe('NI broad', NI_URL, NI_BROAD_WHERE, observer, 25000);
  console.log(`NI broad (SMRNo): ${niBroad.ok ? niBroad.count : `ERROR ${niBroad.error}`}`);
  if (niBroad.ok) {
    const filtered = filterNi(niBroad.features);
    console.log(`  NI after classify filter: ${filtered.length}`);
  }

  const niTyped = await probe('NI typed OR', NI_URL, niTypedWhere(), observer, 12000);
  console.log(`NI typed OR (legacy): ${niTyped.ok ? niTyped.count : `ERROR ${niTyped.error}`}`);

  if (observer === OBS_LOUGHCREW) {
    assert(roiTyped.ok && roiTyped.count > 0, 'Loughcrew ROI typed fetch returns monuments');
    assert(roiTyped.count >= filterRoi(roiTyped.features).length, 'ROI typed results pass class filter');
  }
  if (observer === OBS_BELFAST) {
    assert(niBroad.ok && niBroad.count > 0, 'Belfast NI broad fetch returns monuments');
    assert(filterNi(niBroad.features).length > 0, 'Belfast NI broad + classify yields selected classes');
  }
  console.log('');
}

console.log('=== SUMMARY ===');
if (failures) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('All horizon relational fetch checks passed.');
process.exit(0);
