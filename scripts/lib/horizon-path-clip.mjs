/**
 * Canonical viewshed horizon clip for Sun/Moon paths and archaeolines.
 * Keep astronomy.js crossing/snap/densify logic in sync (see test-astronomy-horizon-clip-parity.mjs).
 */
export const HORIZON_MARGIN_DEG = 0.015;
export const ENDPOINT_TOL_DEG = 0.002;
export const MAX_PLUNGE_DEG = 0.08;

export function lerpAzimuthDeg(a1, a2, t) {
  const diff = ((a2 - a1 + 540) % 360) - 180;
  return (a1 + diff * t + 360) % 360;
}

export function horizonAltAtAzimuth(horizonData, azimuthDeg) {
  if (!horizonData?.length) return null;
  const az = ((azimuthDeg % 360) + 360) % 360;
  const n = horizonData.length;
  if (n === 1) {
    const only = Number(horizonData[0]?.altitude);
    return Number.isFinite(only) ? only : null;
  }
  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n;
    const a0 = Number(horizonData[i].azimuth);
    const a1 = Number(horizonData[next].azimuth);
    const alt0 = Number(horizonData[i].altitude);
    const alt1 = Number(horizonData[next].altitude);
    if (!Number.isFinite(a0) || !Number.isFinite(a1) || !Number.isFinite(alt0) || !Number.isFinite(alt1)) continue;
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
  const fallback = Number(horizonData[0]?.altitude);
  return Number.isFinite(fallback) ? fallback : null;
}

export function createHorizonPathClip(getHorizonAltDeg, options = {}) {
  const margin = options.marginDeg ?? HORIZON_MARGIN_DEG;
  const maxChordDipDepth = options.maxChordDipDepth ?? 4;
  const useHorizonSnap = options.useHorizonSnap !== false;

  function horizontalAbove(hor) {
    const horizonAlt = getHorizonAltDeg(hor.azimuth);
    if (horizonAlt == null) return true;
    return hor.altitude > horizonAlt + margin;
  }

  function crossingAtHorizon(a, b) {
    const horizonA = getHorizonAltDeg(a.azimuth);
    const horizonB = getHorizonAltDeg(b.azimuth);
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
      const horizonAlt = getHorizonAltDeg(az) ?? -90;
      const diff = alt - horizonAlt;
      if (rising) {
        if (diff > 0) t1 = tm;
        else t0 = tm;
      } else if (setting) {
        if (diff > 0) t0 = tm;
        else t1 = tm;
      } else if (diffA > 0) {
        if (diff > 0) t0 = tm;
        else t1 = tm;
      } else {
        if (diff > 0) t1 = tm;
        else t0 = tm;
      }
    }
    const t = (t0 + t1) / 2;
    const az = lerpAzimuthDeg(a.azimuth, b.azimuth, t);
    const chordAlt = a.altitude + (b.altitude - a.altitude) * t;
    if (!useHorizonSnap) return { azimuth: az, altitude: chordAlt };
    const horizonAlt = getHorizonAltDeg(az);
    return {
      azimuth: az,
      altitude: horizonAlt != null && Number.isFinite(horizonAlt) ? horizonAlt : chordAlt
    };
  }

  function snapToHorizon(hor) {
    if (!useHorizonSnap) return hor;
    const horizonAlt = getHorizonAltDeg(hor.azimuth);
    if (horizonAlt == null || !Number.isFinite(horizonAlt)) return hor;
    return { ...hor, azimuth: hor.azimuth, altitude: horizonAlt };
  }

  function chordDipsBelowHorizon(a, b) {
    if (!horizontalAbove(a) || !horizontalAbove(b)) return false;
    for (const t of [0.25, 0.5, 0.75]) {
      const az = lerpAzimuthDeg(a.azimuth, b.azimuth, t);
      const alt = a.altitude + (b.altitude - a.altitude) * t;
      const h = getHorizonAltDeg(az) ?? -90;
      if (alt <= h + margin) return true;
    }
    return false;
  }

  function densifyAgainstChordDip(horizontals, resampleMid) {
    if (!horizontals?.length || typeof resampleMid !== 'function') return horizontals;
    const subdivide = (a, b, depth, out) => {
      if (depth >= maxChordDipDepth || !chordDipsBelowHorizon(a, b)) return;
      const mid = resampleMid(a, b);
      if (!mid) return;
      subdivide(a, mid, depth + 1, out);
      out.push(mid);
      subdivide(mid, b, depth + 1, out);
    };
    const out = [horizontals[0]];
    for (let i = 1; i < horizontals.length; i += 1) {
      const a = out[out.length - 1];
      const b = horizontals[i];
      const extra = [];
      subdivide(a, b, 0, extra);
      out.push(...extra, b);
    }
    return out;
  }

  function horizontalsToSegments(horizontals) {
    if (!horizontals.length) return [];
    const firstHorizon = getHorizonAltDeg(horizontals[0].azimuth);
    if (firstHorizon == null) return [horizontals.slice()];

    const segments = [];
    let current = [];
    let prev = horizontals[0];
    let prevAbove = horizontalAbove(prev);
    if (prevAbove) current.push(prev);

    for (let i = 1; i < horizontals.length; i += 1) {
      const cur = horizontals[i];
      const curAbove = horizontalAbove(cur);
      if (prevAbove !== curAbove) {
        const cross = snapToHorizon(crossingAtHorizon(prev, cur));
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

  return {
    horizontalAbove,
    crossingAtHorizon,
    snapToHorizon,
    chordDipsBelowHorizon,
    densifyAgainstChordDip,
    horizontalsToSegments
  };
}

/** Worst endpoint gap and terminal-segment plunge vs terrain horizon. */
export function segmentHorizonMetrics(segments, getHorizonAltDeg) {
  let worstGap = 0;
  let worstPlunge = 0;
  let worstInteriorDip = 0;
  for (const seg of segments) {
    for (let i = 0; i < seg.length; i += 1) {
      const pt = seg[i];
      const h = getHorizonAltDeg(pt.azimuth) ?? -90;
      const gap = Math.abs(pt.altitude - h);
      if (i === 0 || i === seg.length - 1) {
        if (gap < 0.5) worstGap = Math.max(worstGap, gap);
      } else {
        const dip = h + HORIZON_MARGIN_DEG - pt.altitude;
        if (dip > 0) worstInteriorDip = Math.max(worstInteriorDip, dip);
      }
    }
    if (seg.length >= 2) {
      const end = seg[seg.length - 1];
      const prev = seg[seg.length - 2];
      const hEnd = getHorizonAltDeg(end.azimuth) ?? 0;
      const hPrev = getHorizonAltDeg(prev.azimuth) ?? 0;
      const plunge = Math.abs((end.altitude - prev.altitude) - (hEnd - hPrev));
      if (end.altitude - hEnd < 0.5) worstPlunge = Math.max(worstPlunge, plunge);
    }
  }
  return { worstGap, worstPlunge, worstInteriorDip };
}
