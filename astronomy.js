(function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    engine: 'swiss',
    swissAtmosphere: true,
    useSummertime: false,
    year: new Date().getUTCFullYear(),
    month: new Date().getUTCMonth() + 1,
    day: new Date().getUTCDate(),
    time: `${String(new Date().getUTCHours()).padStart(2, '0')}:${String(new Date().getUTCMinutes()).padStart(2, '0')}:${String(new Date().getUTCSeconds()).padStart(2, '0')}`,
    utcTotalSeconds: (() => {
      const n = new Date();
      return n.getUTCHours() * 3600 + n.getUTCMinutes() * 60 + n.getUTCSeconds();
    })(),
    bodyScale: 1.0,
    seaLevelPressureMbar: 1013.25,
    seaLevelHeightM: 0,
    atmospherePressureAuto: true,
    temperatureC: 15,
    showSun: true,
    showMoon: true,
    showPaths: true,
    showArchaeolines: false,
    showArchaeoEquinox: true,
    showArchaeoSolstice: true,
    showArchaeoCrossquarter: true,
    showArchaeoMajorLunar: true,
    showArchaeoMinorLunar: true,
    showHorizonCompass: false
  };

  const HORIZON_COMPASS_COLOR = 0xaaaaaa;
  const HORIZON_COMPASS_LABEL_CSS = '#b5b5b5';
  const HORIZON_COMPASS_TICK_DEG = 0.5;
  const HORIZON_COMPASS_TICK_MAJOR_DEG = 1.0;
  const HORIZON_COMPASS_DEG_LABEL_ALT = 1.55;
  const HORIZON_COMPASS_CARDINAL_ALT = 2.35;
  /** Above viewshed fill (12), horizon line (13), and body sprites (10). */
  const HORIZON_COMPASS_RENDER_ORDER = 20;

  const ARCHAEO_LINE_COLORS = {
    equinox: 0xffdd44,
    solstice: 0xff9933,
    crossquarter: 0x44bb55,
    majorLunar: 0x4499ff,
    minorLunar: 0xee4444
  };

  /** Paths/lines below body sprites so arcs are not visible through Sun/Moon discs. */
  const ASTRO_LINE_RENDER_ORDER = 0;
  const ASTRO_SUN_HALO_RENDER_ORDER = 8;
  const ASTRO_SUN_RENDER_ORDER = 10;
  const ASTRO_MOON_RENDER_ORDER = 11;

  const LUNAR_INCLINATION_DEG = 5.145396;
  const MOON_MEAN_DISTANCE_KM = 385000.56;
  const MOON_DISTANCE_ADJUST_KM = 20905.355 + 3699.111 + 2955.968 + 569.925 + 48.888 + 3.149 + 246.158 + 152.138 + 170.733
    + 204.586 + 129.620 + 108.743 + 104.755 + 10.321 + 79.661 + 34.782 + 23.210 + 21.636 + 24.208 + 30.824 + 8.379
    + 16.675 + 12.831 + 10.445 + 11.650 + 14.403 + 7.003 + 10.056 + 6.322 + 9.884;
  const EARTH_EQUATORIAL_RADIUS_KM = 6378.14;
  const EARTH_SEMIMINOR_OVER_A = 0.99664719;

  const SWISS_IMPORT_URLS = [
    './assets/swisseph/src/swisseph.js',
    'https://cdn.jsdelivr.net/gh/prolaxu/swisseph-wasm@main/src/swisseph.js'
  ];
  const SWISS_EPHE_FILES = [
    'semom06.se1.bin', 'semom12.se1.bin', 'semom18.se1.bin', 'semom24.se1.bin',
    'semom30.se1.bin', 'semom36.se1', 'semom36.se1.bin', 'semom42.se1.bin',
    'semom48.se1.bin', 'semom54.se1.bin', 'semo_00.se1.bin', 'semo_06.se1.bin',
    'semo_12.se1.bin', 'semo_18.se1.bin', 'semo_24.se1.bin', 'semo_m36.se1.bin',
    'seplm06.se1.bin', 'seplm12.se1.bin', 'seplm18.se1', 'seplm18.se1.bin',
    'seplm24.se1.bin', 'seplm30.se1', 'seplm30.se1.bin', 'seplm36.se1',
    'seplm36.se1.bin', 'seplm42.se1.bin', 'seplm48.se1.bin', 'seplm54.se1.bin',
    'sepl_00.se1.bin', 'sepl_06.se1.bin', 'sepl_12.se1.bin', 'sepl_18.se1.bin',
    'sepl_24.se1.bin', 'sepl_m18.se1.bin', 'sepl_m30.se1.bin', 'sepl_m36.se1.bin'
  ];

  function createSkyscapeAstronomy(options) {
    const THREE = options.THREE;
    const settings = { ...DEFAULT_SETTINGS };
    if (!Number.isFinite(settings.utcTotalSeconds)) {
      settings.utcTotalSeconds = parseTimeTotalSeconds(settings.time);
    }
    const pathCache = new Map();
    const group = new THREE.Group();
    group.name = 'archaeoastronomy-overlay';
    group.renderOrder = 2;
    options.scene.add(group);

    let sunSprite = null;
    let sunHaloSprite = null;
    let moonSprite = null;
    let simSunSprite = null;
    let simMoonSprite = null;
    let sunPath = null;
    let moonPath = null;
    const sunPathSegments = [];
    const moonPathSegments = [];
    let moonPhaseKey = null;
    let syncingDateTimeFields = false;
    let datetimeRevision = 0;
    const overlayState = {
      staticKey: '',
      datetimeRevision: -1,
      sunHor: null,
      moonHor: null,
      moonPhase: 180
    };
    const archaeoLines = new Map();
    let compassRingLine = null;
    let compassTicksLine = null;
    const compassLabelSprites = new Map();
    const fullMoonTexture = makeMoonTexture(180);
    const simulation = {
      active: false,
      body: null,
      label: '',
      dec: 0,
      event: 'rise',
      baseAzimuth: 0,
      azimuthOffset: 0,
      tone: 'equinox'
    };
    let swissLoadPromise = null;
    let swissEngine = null;
    let swissError = '';

    function usesJulianCalendar(year, month, day) {
      const y = Math.trunc(year);
      const m = Math.trunc(month);
      const d = Math.trunc(day);
      if (y < 1582) return true;
      if (y > 1582) return false;
      if (m < 10) return true;
      if (m > 10) return false;
      return d <= 4;
    }

    function calendarLabelForDate(year, month, day) {
      return usesJulianCalendar(year, month, day) ? 'Julian' : 'Gregorian';
    }

    function julianDayFromCalendar(year, month, day, hour = 0, forceJulian = null) {
      let y = Math.trunc(year);
      let m = Math.trunc(month);
      const d = Number(day) + Number(hour) / 24;
      if (m <= 2) {
        y -= 1;
        m += 12;
      }
      const julian = forceJulian ?? usesJulianCalendar(year, month, day);
      const a = Math.floor(y / 100);
      const b = julian ? 0 : (2 - a + Math.floor(a / 4));
      return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
    }

    function selectedTimeTotalSeconds() {
      return settings.utcTotalSeconds;
    }

    function bumpDatetimeRevision() {
      datetimeRevision += 1;
    }

    function setTimeTotalSeconds(totalSeconds) {
      const wrapped = ((Math.trunc(totalSeconds) % 86400) + 86400) % 86400;
      if (wrapped === settings.utcTotalSeconds) return false;
      settings.utcTotalSeconds = wrapped;
      settings.time = formatTimeFromTotalSeconds(wrapped);
      bumpDatetimeRevision();
      return true;
    }

    function stepUtcSeconds(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return false;
      return setTimeTotalSeconds(settings.utcTotalSeconds + Math.trunc(deltaSeconds));
    }

    function selectedHour(dayHour = null) {
      if (dayHour != null) return Number(dayHour);
      return settings.utcTotalSeconds / 3600;
    }

    function parseTimeParts(timeStr) {
      const parts = String(timeStr || '00:00:00').trim().split(':');
      return {
        hour: Math.max(0, Math.min(23, Number(parts[0]) || 0)),
        minute: Math.max(0, Math.min(59, Number(parts[1]) || 0)),
        second: Math.max(0, Math.min(59, Number(parts[2]) || 0))
      };
    }

    function parseTimeTotalSeconds(timeStr) {
      const p = parseTimeParts(timeStr);
      return p.hour * 3600 + p.minute * 60 + p.second;
    }

    function formatTimeFromTotalSeconds(totalSeconds) {
      const wrapped = ((Math.trunc(totalSeconds) % 86400) + 86400) % 86400;
      const hh = Math.floor(wrapped / 3600);
      const mm = Math.floor((wrapped % 3600) / 60);
      const ss = wrapped % 60;
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }

    function normalizeTimeString(timeStr) {
      return formatTimeFromTotalSeconds(parseTimeTotalSeconds(timeStr));
    }

    function parseTimeMinutes(timeStr) {
      return parseTimeTotalSeconds(timeStr) / 60;
    }

    function formatTimeFromMinutes(totalMinutes) {
      return formatTimeFromTotalSeconds(Math.round(Number(totalMinutes) * 60));
    }

    function readTimeComponent(value, min, max, fallback) {
      if (value === '' || value == null) return fallback;
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(min, Math.min(max, Math.trunc(n)));
    }

    /** Astronomical year: accepts leading minus while typing (e.g. "-" or "-3000"). */
    function parseYearInput(raw, fallback = null) {
      const s = String(raw ?? '').trim();
      if (s === '' || s === '-' || s === '+') return null;
      const n = Number(s);
      if (!Number.isFinite(n)) return fallback;
      return Math.trunc(n);
    }

    function localTimeOffsetSeconds() {
      return settings.useSummertime ? 3600 : 0;
    }

    function utcSecondsToDisplay(totalSeconds) {
      const wrapped = ((Math.trunc(totalSeconds) % 86400) + 86400) % 86400;
      return ((wrapped + localTimeOffsetSeconds()) % 86400 + 86400) % 86400;
    }

    function displaySecondsToUtc(displaySeconds) {
      const wrapped = ((Math.trunc(displaySeconds) % 86400) + 86400) % 86400;
      return ((wrapped - localTimeOffsetSeconds()) % 86400 + 86400) % 86400;
    }

    function displayTimePartsFromUtc() {
      const displaySec = utcSecondsToDisplay(settings.utcTotalSeconds);
      return {
        hour: Math.floor(displaySec / 3600),
        minute: Math.floor((displaySec % 3600) / 60),
        second: displaySec % 60
      };
    }

    function finalizeYearField(input) {
      if (!input) return;
      const parsed = parseYearInput(input.value, settings.year);
      input.value = String(parsed != null ? parsed : settings.year);
    }

    /** Apply one datetime-panel or config UTC field edit. Never reads unrelated DOM fields. */
    function commitDomTimeField(changedField) {
      if (syncingDateTimeFields) return;
      stopTimePlayback();
      const els = options.els;
      const prev = settings.utcTotalSeconds;
      const displayPrev = utcSecondsToDisplay(prev);
      const prevH = Math.floor(displayPrev / 3600);
      const prevM = Math.floor((displayPrev % 3600) / 60);
      const prevS = displayPrev % 60;
      let nextDisplay = displayPrev;

      if (changedField === 'hour') {
        const hour = readTimeComponent(els.dtHour?.value, 0, 23, prevH);
        nextDisplay = hour * 3600 + prevM * 60 + prevS;
      } else if (changedField === 'minute') {
        const minute = readTimeComponent(els.dtMinute?.value, 0, 59, prevM);
        nextDisplay = prevH * 3600 + minute * 60 + prevS;
      } else if (changedField === 'second') {
        const second = readTimeComponent(els.dtSecond?.value, 0, 59, prevS);
        nextDisplay = prevH * 3600 + prevM * 60 + second;
      } else if (changedField === 'astroTime') {
        const raw = String(els.astroTime?.value || '').trim();
        if (!raw) return;
        const parsed = parseTimeParts(raw);
        const second = raw.split(':').length >= 3 ? parsed.second : prevS;
        nextDisplay = parsed.hour * 3600 + parsed.minute * 60 + second;
      }

      const next = displaySecondsToUtc(nextDisplay);
      if (next === prev) return;
      setTimeTotalSeconds(next);
      applyTimeChange();
    }

    function setTimeToNow() {
      const now = new Date();
      const prevYear = settings.year;
      const prevMonth = settings.month;
      const prevDay = settings.day;
      settings.year = now.getUTCFullYear();
      settings.month = now.getUTCMonth() + 1;
      settings.day = now.getUTCDate();
      const timeChanged = setTimeTotalSeconds(now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds());
      if (!timeChanged && (settings.year !== prevYear || settings.month !== prevMonth || settings.day !== prevDay)) {
        bumpDatetimeRevision();
      }
    }

    let timePlaybackMode = null;
    let timePlaybackRaf = 0;
    let timePlaybackLast = 0;
    let timeSecondFraction = 0;

    const PLAYBACK_SECONDS_PER_SECOND = {
      play: 60,
      'fast-forward': 300,
      rewind: -300
    };

    function stopTimePlayback() {
      timePlaybackMode = null;
      timeSecondFraction = 0;
      if (timePlaybackRaf) cancelAnimationFrame(timePlaybackRaf);
      timePlaybackRaf = 0;
      updateTimeTransportButtons();
    }

    function applyTimeChange() {
      updateOverlay(false, { forceBodies: true });
      syncDateTimeFields();
    }

    function applySettingsChange() {
      pathCache.clear();
      invalidateStaticOverlay();
      updateOverlay(false);
      syncDateTimeFields();
    }

    function adjustTimeSeconds(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return;
      let wholeSeconds = 0;
      if (timePlaybackMode || Math.abs(deltaSeconds) < 1) {
        timeSecondFraction += deltaSeconds;
        if (timeSecondFraction > 0) wholeSeconds = Math.floor(timeSecondFraction);
        else if (timeSecondFraction < 0) wholeSeconds = Math.ceil(timeSecondFraction);
        if (wholeSeconds === 0) return;
        timeSecondFraction -= wholeSeconds;
      } else {
        wholeSeconds = Math.trunc(deltaSeconds);
      }
      if (!stepUtcSeconds(wholeSeconds)) return;
      applyTimeChange();
    }

    function adjustTimeMinutes(deltaMinutes) {
      adjustTimeSeconds(deltaMinutes * 60);
    }

    function applyTimeStepAction(action, dtSeconds = 1 / 60, holdSeconds = 0) {
      const dt = Math.max(0.001, Math.min(0.08, Number(dtSeconds) || 1 / 60));
      const accel = Math.min(3.2, 1 + Math.max(0, holdSeconds - 0.25) * 2.2);
      const secondsPerSecond = holdSeconds > 0.35 ? 20 * accel : 1;
      if (action === 'step-back') adjustTimeSeconds(-secondsPerSecond * dt);
      else if (action === 'step-forward') adjustTimeSeconds(secondsPerSecond * dt);
    }

    function tickTimePlayback(now) {
      if (!timePlaybackMode) return;
      const dt = Math.max(0, (now - timePlaybackLast) / 1000);
      timePlaybackLast = now;
      const rate = PLAYBACK_SECONDS_PER_SECOND[timePlaybackMode] || 0;
      if (rate !== 0) adjustTimeSeconds(rate * dt);
      timePlaybackRaf = requestAnimationFrame(tickTimePlayback);
    }

    function setTimePlayback(mode) {
      if (timePlaybackMode === mode) {
        stopTimePlayback();
        return;
      }
      stopTimePlayback();
      timePlaybackMode = mode;
      timePlaybackLast = performance.now();
      updateTimeTransportButtons();
      timePlaybackRaf = requestAnimationFrame(tickTimePlayback);
    }

    function updateTimeTransportButtons() {
      const els = options.els;
      const transport = els.dtTimeTransport;
      if (!transport) return;
      transport.querySelectorAll('[data-time-action]').forEach((btn) => {
        const action = btn.getAttribute('data-time-action');
        const active = action === timePlaybackMode;
        btn.classList.toggle('is-active', active);
        if (action === 'play') {
          const icon = btn.querySelector('i');
          if (icon) icon.className = active ? 'ph-bold ph-pause' : 'ph-bold ph-play';
          btn.setAttribute('data-tip', active ? 'Pause' : 'Play forward');
          btn.setAttribute('aria-label', active ? 'Pause time' : 'Play time forward');
        } else if (action === 'fast-forward') {
          btn.setAttribute('data-tip', active ? 'Stop fast forward' : 'Fast forward 5×');
          btn.setAttribute('aria-label', active ? 'Stop fast forward' : 'Fast forward time at 5 times speed');
        } else if (action === 'rewind') {
          btn.setAttribute('data-tip', active ? 'Stop rewind' : 'Rewind 5×');
          btn.setAttribute('aria-label', active ? 'Stop rewind' : 'Rewind time at 5 times speed');
        }
      });
    }

    function bindTimeTransportControls() {
      const transport = options.els.dtTimeTransport;
      if (!transport || transport.dataset.bound === 'true') return;
      transport.dataset.bound = 'true';
      let stepActive = null;
      let stepHoldTimer = null;
      const STEP_HOLD_DELAY_MS = 350;

      const stopStep = () => {
        if (stepHoldTimer) {
          clearTimeout(stepHoldTimer);
          stepHoldTimer = null;
        }
        if (!stepActive) return;
        cancelAnimationFrame(stepActive.raf);
        stepActive.button.classList.remove('is-held');
        stepActive = null;
      };

      const tickStep = (now) => {
        if (!stepActive) return;
        const dt = (now - stepActive.lastTime) / 1000;
        const held = (now - stepActive.startTime) / 1000;
        stepActive.lastTime = now;
        applyTimeStepAction(stepActive.action, dt, held);
        stepActive.raf = requestAnimationFrame(tickStep);
      };

      transport.addEventListener('pointerdown', (e) => {
        const button = e.target.closest('[data-time-action]');
        if (!button || !transport.contains(button)) return;
        e.preventDefault();
        e.stopPropagation();
        const action = button.getAttribute('data-time-action');
        if (action === 'play') {
          setTimePlayback('play');
          return;
        }
        if (action === 'fast-forward') {
          setTimePlayback('fast-forward');
          return;
        }
        if (action === 'rewind') {
          setTimePlayback('rewind');
          return;
        }
        if (action !== 'step-back' && action !== 'step-forward') return;
        stopTimePlayback();
        stopStep();
        adjustTimeSeconds(action === 'step-back' ? -1 : 1);
        try { button.setPointerCapture(e.pointerId); } catch (_) {}
        stepHoldTimer = window.setTimeout(() => {
          stepHoldTimer = null;
          const now = performance.now();
          stepActive = { button, action, startTime: now, lastTime: now, raf: 0 };
          button.classList.add('is-held');
          stepActive.raf = requestAnimationFrame(tickStep);
        }, STEP_HOLD_DELAY_MS);
      });

      ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture'].forEach((eventName) => {
        transport.addEventListener(eventName, stopStep);
      });
    }

    function selectedCalendarLabel() {
      return calendarLabelForDate(settings.year, settings.month, settings.day);
    }

    function selectedJulianDay(dayHour = null) {
      return julianDayFromCalendar(settings.year, settings.month, settings.day, selectedHour(dayHour));
    }

    function astronomyTime(dayHour = null) {
      if (!window.Astronomy) return null;
      return new window.Astronomy.AstroTime(selectedJulianDay(dayHour) - 2451545.0);
    }

    function astronomyBody(name) {
      return window.Astronomy?.Body?.[name] || name;
    }

    function observerDetails() {
      const currentFocus = options.getCurrentFocus?.();
      if (!currentFocus) return null;
      const observer = options.getObserverCameraLocal?.();
      const verticalExaggeration = Math.max(options.getVerticalExaggeration?.() || 1, 0.0001);
      const baseCenterElev = Number(options.getBaseCenterElev?.() || 0);
      const cameraState = options.getCameraState?.() || {};
      const elevationM = observer
        ? (observer.groundY / verticalExaggeration) + baseCenterElev + Number(cameraState.observerHeightOffsetM || 0)
        : baseCenterElev;

      return {
        latitude: Number(currentFocus.lat),
        longitude: Number(currentFocus.lng),
        height: elevationM,
        astronomyObserver: window.Astronomy
          ? new window.Astronomy.Observer(Number(currentFocus.lat), Number(currentFocus.lng), elevationM)
          : null
      };
    }

    function astronomyHorizontalForBody(bodyName, time, observer) {
      const Astronomy = window.Astronomy;
      if (!Astronomy || !time || !observer?.astronomyObserver) return null;
      const body = astronomyBody(bodyName);
      const equ = Astronomy.Equator(body, time, observer.astronomyObserver, true, true);
      const hor = Astronomy.Horizon(time, observer.astronomyObserver, equ.ra, equ.dec, 'normal');
      return { ...hor, dec: equ.dec, dist: equ.dist };
    }

    function astronomyHorizontalFromEquatorial(raDeg, decDeg, jd, observer) {
      const Astronomy = window.Astronomy;
      if (!Astronomy || !observer?.astronomyObserver) return null;
      const time = new Astronomy.AstroTime(jd - 2451545.0);
      const raHours = Number(raDeg) / 15;
      const hor = Astronomy.Horizon(time, observer.astronomyObserver, raHours, Number(decDeg), 'normal');
      return { azimuth: hor.azimuth, altitude: hor.altitude, dec: Number(decDeg) };
    }

    function directionFromAzAlt(azimuthDeg, altitudeDeg) {
      const az = THREE.MathUtils.degToRad(azimuthDeg);
      const alt = THREE.MathUtils.degToRad(altitudeDeg);
      const cosAlt = Math.cos(alt);
      return new THREE.Vector3(
        Math.sin(az) * cosAlt,
        Math.sin(alt),
        -Math.cos(az) * cosAlt
      ).normalize();
    }

    function compassSceneDistanceM() {
      const camera = options.camera;
      return Math.max(7000, Math.min(18000, (camera?.far || 20000) * 0.48));
    }

    function scenePointFromAzAlt(azimuthDeg, altitudeDeg, distanceM = compassSceneDistanceM()) {
      const camera = options.camera;
      const dir = directionFromAzAlt(azimuthDeg, altitudeDeg);
      return camera.position.clone().addScaledVector(dir, distanceM);
    }

    function lerpAzimuthDeg(a1, a2, t) {
      const diff = ((a2 - a1 + 540) % 360) - 180;
      return (a1 + diff * t + 360) % 360;
    }

    function viewshedHorizonAltDeg(azimuthDeg) {
      const compositeAlt = options.getCompositeHorizonAltDeg?.(azimuthDeg);
      if (Number.isFinite(compositeAlt)) return compositeAlt;
      const sample = options.getViewshedHorizonSample?.(azimuthDeg);
      if (sample && Number.isFinite(sample.altitude)) return Number(sample.altitude);
      return null;
    }

    function viewshedHorizonAltForDisc(azimuthDeg, angularRadiusDeg) {
      const span = Math.max(0.05, Number(angularRadiusDeg) || 0.27);
      const az = Number(azimuthDeg);
      if (!Number.isFinite(az)) return null;
      let maxAlt = null;
      for (let i = -2; i <= 2; i += 1) {
        const sampleAz = az + (i / 2) * span;
        const alt = viewshedHorizonAltDeg(sampleAz);
        if (alt == null || !Number.isFinite(alt)) continue;
        maxAlt = maxAlt == null ? alt : Math.max(maxAlt, alt);
      }
      return maxAlt;
    }

    /** Hide sprite only when the entire disc is below terrain; partial rise/set is clipped in the shader. */
    function discAnyPartAboveHorizon(hor, angularRadiusDeg) {
      const horizonAlt = viewshedHorizonAltForDisc(hor.azimuth, angularRadiusDeg);
      if (horizonAlt == null) return true;
      const upperLimb = Number(hor.altitude) + Number(angularRadiusDeg);
      if (!Number.isFinite(upperLimb)) return true;
      return upperLimb >= horizonAlt - 0.02;
    }

    const BODY_HORIZON_CLIP_VERSION = 2;
    let bodyHorizonClipFallback = null;
    let bodyHorizonMapFallback = null;
    const bodyHorizonClipUniforms = {
      fpvHorizonMask: { value: 0 },
      fpvHorizonScreenMask: { value: null },
      fpvHorizonMaskResolution: { value: new THREE.Vector2(1, 1) },
      viewshedHorizonClipEnabled: { value: 0 },
      viewshedHorizonMap: { value: null }
    };

    function bodyHorizonClipFallbackTexture() {
      if (!bodyHorizonClipFallback) {
        bodyHorizonClipFallback = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
        bodyHorizonClipFallback.needsUpdate = true;
      }
      return bodyHorizonClipFallback;
    }

    function bodyHorizonMapFallbackTexture() {
      if (!bodyHorizonMapFallback) {
        const data = new Uint8Array(4);
        data[0] = Math.round((90 / 180) * 255);
        data[3] = 255;
        bodyHorizonMapFallback = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
        bodyHorizonMapFallback.needsUpdate = true;
      }
      return bodyHorizonMapFallback;
    }

    const BODY_HORIZON_CLIP_FRAG = `
          if (fpvHorizonMask > 0.5) {
            vec2 bodyHorizonMaskUv = vec2(
              gl_FragCoord.x / fpvHorizonMaskResolution.x,
              gl_FragCoord.y / fpvHorizonMaskResolution.y
            );
            if (texture2D(fpvHorizonScreenMask, bodyHorizonMaskUv).r < 0.5) discard;
          }
          if (viewshedHorizonClipEnabled > 0.5) {
            vec3 dir = normalize(vBodyWorldDir);
            float alt = degrees(asin(clamp(dir.y, -1.0, 1.0)));
            float az = degrees(atan(dir.x, -dir.z));
            if (az < 0.0) az += 360.0;
            float encoded = texture2D(viewshedHorizonMap, vec2((az + 0.5) / 360.0, 0.5)).r;
            if (alt < encoded * 180.0 - 90.0 - 0.02) discard;
          }`;

    function attachHorizonClipToSpriteMaterial(material) {
      if (!material || material.userData?.bodyHorizonClipVersion === BODY_HORIZON_CLIP_VERSION) return;
      material.userData.bodyHorizonClipVersion = BODY_HORIZON_CLIP_VERSION;
      if (!bodyHorizonClipUniforms.fpvHorizonScreenMask.value) {
        bodyHorizonClipUniforms.fpvHorizonScreenMask.value = bodyHorizonClipFallbackTexture();
      }
      if (!bodyHorizonClipUniforms.viewshedHorizonMap.value) {
        bodyHorizonClipUniforms.viewshedHorizonMap.value = bodyHorizonMapFallbackTexture();
      }
      material.customProgramCacheKey = () => `body-horizon-clip-v${BODY_HORIZON_CLIP_VERSION}`;
      const priorCompile = material.onBeforeCompile;
      material.onBeforeCompile = (shader) => {
        priorCompile?.(shader);
        shader.uniforms.fpvHorizonMask = bodyHorizonClipUniforms.fpvHorizonMask;
        shader.uniforms.fpvHorizonScreenMask = bodyHorizonClipUniforms.fpvHorizonScreenMask;
        shader.uniforms.fpvHorizonMaskResolution = bodyHorizonClipUniforms.fpvHorizonMaskResolution;
        shader.uniforms.viewshedHorizonClipEnabled = bodyHorizonClipUniforms.viewshedHorizonClipEnabled;
        shader.uniforms.viewshedHorizonMap = bodyHorizonClipUniforms.viewshedHorizonMap;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>
          varying vec3 vBodyWorldDir;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          'gl_Position = projectionMatrix * mvPosition;',
          `gl_Position = projectionMatrix * mvPosition;
          vec3 bodyWorldCorner = (inverse( viewMatrix ) * mvPosition).xyz;
          vBodyWorldDir = normalize(bodyWorldCorner - cameraPosition);`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>
          varying vec3 vBodyWorldDir;
          uniform float fpvHorizonMask;
          uniform sampler2D fpvHorizonScreenMask;
          uniform vec2 fpvHorizonMaskResolution;
          uniform float viewshedHorizonClipEnabled;
          uniform sampler2D viewshedHorizonMap;`
        );
        // Three r160 sprites use opaque_fragment, not output_fragment.
        if (shader.fragmentShader.includes('#include <opaque_fragment>')) {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `${BODY_HORIZON_CLIP_FRAG}
          #include <opaque_fragment>`
          );
        } else {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <output_fragment>',
            `${BODY_HORIZON_CLIP_FRAG}
          #include <output_fragment>`
          );
        }
      };
      material.needsUpdate = true;
    }

    function syncHorizonClip(screenMaskTexture, width, height, horizonMapTexture = null) {
      const pano = Boolean(options.isPanoramaView?.());
      const screenEnabled = Boolean(pano && screenMaskTexture);
      const profileEnabled = Boolean(pano && horizonMapTexture);
      // Match terrain/viewshed fill (screen mask). Viewshed-only azimuth clip on sprites
      // misaligns with fill and chops disc corners; use it only when mask build fails.
      bodyHorizonClipUniforms.fpvHorizonMask.value = screenEnabled ? 1 : 0;
      bodyHorizonClipUniforms.fpvHorizonScreenMask.value = screenMaskTexture
        || bodyHorizonClipFallbackTexture();
      bodyHorizonClipUniforms.viewshedHorizonClipEnabled.value = (!screenEnabled && profileEnabled) ? 1 : 0;
      bodyHorizonClipUniforms.viewshedHorizonMap.value = horizonMapTexture
        || bodyHorizonMapFallbackTexture();
      if (screenEnabled) {
        bodyHorizonClipUniforms.fpvHorizonMaskResolution.value.set(
          Math.max(1, width || 1),
          Math.max(1, height || 1)
        );
      }
    }

    function horizontalAboveViewshedHorizon(hor) {
      const horizonAlt = viewshedHorizonAltDeg(hor.azimuth);
      if (horizonAlt == null) return true;
      return hor.altitude > horizonAlt + 0.015;
    }

    function crossingAtViewshedHorizon(a, b) {
      const horizonA = viewshedHorizonAltDeg(a.azimuth);
      const horizonB = viewshedHorizonAltDeg(b.azimuth);
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
        const horizonAlt = viewshedHorizonAltDeg(az) ?? -90;
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
      const horizonAlt = viewshedHorizonAltDeg(az);
      const chordAlt = a.altitude + (b.altitude - a.altitude) * t;
      return {
        azimuth: az,
        altitude: horizonAlt != null && Number.isFinite(horizonAlt) ? horizonAlt : chordAlt
      };
    }

    function snapHorizontalToHorizon(hor) {
      const horizonAlt = viewshedHorizonAltDeg(hor.azimuth);
      if (horizonAlt == null || !Number.isFinite(horizonAlt)) return hor;
      return { ...hor, azimuth: hor.azimuth, altitude: horizonAlt };
    }

    function horizontalsToPointSegments(horizontals, distanceM) {
      const camera = options.camera;
      if (!horizontals.length) return [];
      const firstHorizon = viewshedHorizonAltDeg(horizontals[0].azimuth);
      if (firstHorizon == null) {
        return [horizontals.map((hor) => {
          const dir = directionFromAzAlt(hor.azimuth, hor.altitude);
          return camera.position.clone().addScaledVector(dir, distanceM);
        })];
      }

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
          if (!prevAbove && curAbove) {
            current = [snapHorizontalToHorizon(cross)];
          } else if (prevAbove && !curAbove) {
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

      return segments.map((seg) => seg.map((hor) => {
        const dir = directionFromAzAlt(hor.azimuth, hor.altitude);
        return camera.position.clone().addScaledVector(dir, distanceM);
      }));
    }

    /** Flat disc fills the sprite; sprite scale = ephemeris angular diameter (horizon-crossing limb). */
    const SUN_HALO_SCALE_FACTOR = 2.15;

    function makeSunDiscTexture() {
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const cx = size / 2;
      const cy = size / 2;
      const discR = size / 2 - 0.5;
      ctx.fillStyle = 'rgb(255, 178, 48)';
      ctx.beginPath();
      ctx.arc(cx, cy, discR - 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgb(204, 88, 12)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, discR - 1.5, 0, Math.PI * 2);
      ctx.stroke();
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    function makeSunHaloTexture() {
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const cx = size / 2;
      const cy = size / 2;
      const outerR = size / 2;
      const innerR = outerR / SUN_HALO_SCALE_FACTOR;
      const glow = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
      glow.addColorStop(0, 'rgba(255, 210, 100, 0)');
      glow.addColorStop(0.35, 'rgba(255, 195, 75, 0.28)');
      glow.addColorStop(1, 'rgba(255, 170, 50, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    const SUN_DISC_TEXTURE_VERSION = 2;
    let cachedSunDiscTexture = null;
    let cachedSunHaloTexture = null;
    function getSunDiscTexture() {
      if (!cachedSunDiscTexture || cachedSunDiscTexture.__v !== SUN_DISC_TEXTURE_VERSION) {
        cachedSunDiscTexture?.dispose?.();
        cachedSunDiscTexture = makeSunDiscTexture();
        cachedSunDiscTexture.__v = SUN_DISC_TEXTURE_VERSION;
      }
      return cachedSunDiscTexture;
    }
    function getSunHaloTexture() {
      if (!cachedSunHaloTexture) cachedSunHaloTexture = makeSunHaloTexture();
      return cachedSunHaloTexture;
    }

    function ensureSunHaloSprite() {
      if (!sunHaloSprite) {
        const material = new THREE.SpriteMaterial({
          map: getSunHaloTexture(),
          transparent: true,
          depthTest: true,
          depthWrite: false,
          opacity: 0.85
        });
        attachHorizonClipToSpriteMaterial(material);
        sunHaloSprite = new THREE.Sprite(material);
        sunHaloSprite.center.set(0.5, 0.5);
        sunHaloSprite.name = 'astro-sun-halo';
        sunHaloSprite.renderOrder = ASTRO_SUN_HALO_RENDER_ORDER;
        group.add(sunHaloSprite);
      }
      return sunHaloSprite;
    }

    function makeMoonTexture(phaseDeg = 180) {
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const phase = ((Number(phaseDeg) % 360) + 360) % 360;
      const illum = (1 - Math.cos(THREE.MathUtils.degToRad(phase))) / 2;
      const waxing = phase <= 180;
      const discR = size / 2 - 0.5;
      const image = ctx.createImageData(size, size);
      const data = image.data;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const nx = (x + 0.5 - size / 2) / discR;
          const ny = (y + 0.5 - size / 2) / discR;
          const r2 = nx * nx + ny * ny;
          const idx = (y * size + x) * 4;
          if (r2 > 1) continue;
          const litThreshold = 1 - 2 * illum;
          const lit = waxing ? nx > litThreshold : nx < -litThreshold;
          const edge = Math.max(0, 1 - Math.sqrt(r2));
          const shade = lit ? 222 + edge * 28 : 34 + edge * 26;
          data[idx] = shade;
          data[idx + 1] = shade;
          data[idx + 2] = lit ? shade - 10 : shade + 4;
          data[idx + 3] = 245;
        }
      }
      ctx.putImageData(image, 0, 0);
      ctx.strokeStyle = 'rgb(92, 92, 98)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, discR - 1, 0, Math.PI * 2);
      ctx.stroke();
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    }

    function angularScaleAtDistance(distanceM, angularDiameterDeg) {
      return 2 * distanceM * Math.tan(THREE.MathUtils.degToRad(angularDiameterDeg) / 2);
    }

    function angularDiameterDeg(bodyName, horizontal) {
      const distAu = Number(horizontal?.dist);
      if (Number.isFinite(distAu) && distAu > 0) {
        const radiusAu = bodyName === 'Sun' ? 0.00465047 : 0.00001162;
        return THREE.MathUtils.radToDeg(2 * Math.atan(radiusAu / distAu));
      }
      return bodyName === 'Sun' ? 0.533 : 0.52;
    }

    function ensureSprite(kind, texture) {
      const isSun = kind === 'sun';
      let sprite = isSun ? sunSprite : moonSprite;
      if (!sprite) {
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: true,
          depthWrite: false,
          opacity: isSun ? 1 : 0.92
        });
        attachHorizonClipToSpriteMaterial(material);
        sprite = new THREE.Sprite(material);
        sprite.center.set(0.5, 0.5);
        sprite.name = `astro-${kind}`;
        sprite.renderOrder = isSun ? ASTRO_SUN_RENDER_ORDER : ASTRO_MOON_RENDER_ORDER;
        group.add(sprite);
        if (isSun) sunSprite = sprite;
        else moonSprite = sprite;
      } else if (texture) {
        sprite.material.map?.dispose?.();
        sprite.material.map = texture;
        sprite.material.needsUpdate = true;
      }
      // Ensure draw order stays correct even if sprites already existed.
      sprite.renderOrder = isSun ? ASTRO_SUN_RENDER_ORDER : ASTRO_MOON_RENDER_ORDER;
      if (isSun) {
        const tex = getSunDiscTexture();
        if (sprite.material.map !== tex) {
          sprite.material.map = tex;
          sprite.material.needsUpdate = true;
        }
      }
      return sprite;
    }

    function ensureSimSprite(kind, texture) {
      const isSun = kind === 'sun';
      let sprite = isSun ? simSunSprite : simMoonSprite;
      if (!sprite) {
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: true,
          depthWrite: false,
          opacity: isSun ? 0.94 : 0.9
        });
        attachHorizonClipToSpriteMaterial(material);
        sprite = new THREE.Sprite(material);
        sprite.name = `astro-sim-${kind}`;
        sprite.renderOrder = 2;
        group.add(sprite);
        if (isSun) simSunSprite = sprite;
        else simMoonSprite = sprite;
      }
      return sprite;
    }

    function setSprite(sprite, horizontal, diameterDeg, visible, bodyKey = 'sun') {
      if (!sprite) return;
      attachHorizonClipToSpriteMaterial(sprite.material);
      const scaleMul = Math.max(0.1, settings.bodyScale || 1);
      const angularRadiusDeg = (diameterDeg / 2) * scaleMul;
      const hasCoords = Boolean(
        horizontal
        && Number.isFinite(horizontal.azimuth)
        && Number.isFinite(horizontal.altitude)
      );
      const anyPartVisible = !options.isPanoramaView?.()
        || !hasCoords
        || discAnyPartAboveHorizon(horizontal, angularRadiusDeg);
      const show = Boolean(visible && hasCoords && anyPartVisible);

      if (hasCoords) {
        const camera = options.camera;
        const distanceM = Math.max(7000, Math.min(18000, camera.far * 0.48));
        const dir = directionFromAzAlt(horizontal.azimuth, horizontal.altitude);
        sprite.position.copy(camera.position).addScaledVector(dir, distanceM);
        const scale = angularScaleAtDistance(distanceM, diameterDeg) * scaleMul;
        sprite.scale.set(scale, scale, 1);
        if (sprite === sunSprite && sunHaloSprite) {
          attachHorizonClipToSpriteMaterial(sunHaloSprite.material);
          sunHaloSprite.position.copy(sprite.position);
          const haloScale = scale * SUN_HALO_SCALE_FACTOR;
          sunHaloSprite.scale.set(haloScale, haloScale, 1);
        }
      }

      sprite.visible = show;
      if (sprite === sunSprite && sunHaloSprite) {
        const haloRadiusDeg = angularRadiusDeg * SUN_HALO_SCALE_FACTOR;
        const haloVisible = show && (
          !options.isPanoramaView?.()
          || !hasCoords
          || discAnyPartAboveHorizon(horizontal, haloRadiusDeg)
        );
        sunHaloSprite.visible = haloVisible;
      }
    }

    function updatePath(kind, segments, color) {
      const isSun = kind === 'sun';
      const pool = isSun ? sunPathSegments : moonPathSegments;
      const segmentList = Array.isArray(segments?.[0]) ? segments : (segments?.length ? [segments] : []);
      const show = settings.showPaths && segmentList.some((seg) => seg.length > 1);
      if (!show) {
        pool.forEach((line) => { line.visible = false; });
        if (isSun && sunPath) sunPath.visible = false;
        if (!isSun && moonPath) moonPath.visible = false;
        return;
      }
      while (pool.length < segmentList.length) {
        const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.72,
          depthTest: true,
          depthWrite: false
        }));
        line.renderOrder = ASTRO_LINE_RENDER_ORDER;
        line.name = `astro-${kind}-path-${pool.length}`;
        group.add(line);
        pool.push(line);
      }
      for (let i = 0; i < pool.length; i += 1) {
        const line = pool[i];
        const points = segmentList[i];
        if (!points || points.length < 2) {
          line.visible = false;
          continue;
        }
        line.geometry.dispose();
        line.geometry = new THREE.BufferGeometry().setFromPoints(points);
        line.material.depthTest = true;
        line.material.depthWrite = false;
        line.renderOrder = ASTRO_LINE_RENDER_ORDER;
        line.material.color.setHex(color);
        line.visible = true;
      }
      if (isSun) sunPath = pool[0] || sunPath;
      else moonPath = pool[0] || moonPath;
    }

    function meanObliquityDeg(jd) {
      const t = (jd - 2451545.0) / 36525.0;
      const arcsec = 84381.448 - (46.8150 * t) - (0.00059 * t * t) + (0.001813 * t * t * t);
      return arcsec / 3600.0;
    }

    function lunarStandstillDeclinationsDeg(obliquityDeg, observer) {
      const eps = THREE.MathUtils.degToRad(obliquityDeg);
      const lunarI = THREE.MathUtils.degToRad(LUNAR_INCLINATION_DEG);
      const minDist = MOON_MEAN_DISTANCE_KM - MOON_DISTANCE_ADJUST_KM;
      const maxDist = MOON_MEAN_DISTANCE_KM + MOON_DISTANCE_ADJUST_KM;
      const sinPiMax = EARTH_EQUATORIAL_RADIUS_KM / minDist;
      const sinPiMin = EARTH_EQUATORIAL_RADIUS_KM / maxDist;
      const latRad = THREE.MathUtils.degToRad(observer.latitude);
      const u = Math.atan(EARTH_SEMIMINOR_OVER_A * Math.tan(latRad));
      const rhoSinPhiP = (EARTH_SEMIMINOR_OVER_A * Math.sin(u))
        + ((observer.height || 0) / 6378140.0) * Math.sin(latRad);
      const rhoCosPhiP = Math.cos(u) + ((observer.height || 0) / 6378140.0) * Math.cos(latRad);
      const geocentricDec = [
        eps + lunarI, eps + lunarI,
        eps - lunarI, eps - lunarI,
        -eps + lunarI, -eps + lunarI,
        -eps - lunarI, -eps - lunarI
      ];
      const sinPi = [sinPiMax, sinPiMin, sinPiMax, sinPiMin, sinPiMax, sinPiMin, sinPiMax, sinPiMin];
      const topoDec = [];
      for (let i = 0; i < 8; i += 1) {
        const dec = geocentricDec[i];
        const cosHo = Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(dec)));
        const sinHo = Math.sin(Math.acos(cosHo));
        const a = Math.cos(dec) * sinHo;
        const b = Math.cos(dec) * cosHo - rhoCosPhiP * sinPi[i];
        const c = Math.sin(dec) - rhoSinPhiP * sinPi[i];
        const q = Math.sqrt((a * a) + (b * b) + (c * c));
        topoDec.push(THREE.MathUtils.radToDeg(Math.asin(c / q)));
      }
      return {
        major: [topoDec[0], topoDec[1], topoDec[6], topoDec[7]],
        minor: [topoDec[2], topoDec[3], topoDec[4], topoDec[5]]
      };
    }

    /** When the Sun/Moon is near a nominal archaeo declination, use ephemeris dec so lines match daily paths. */
    const ARCHAEO_DECLINATION_ANCHOR_TOLERANCE_DEG = 0.85;

    function bodyGeocentricDeclinationDeg(bodyName, jd, observer) {
      if (settings.engine === 'swiss' && swissEngine) {
        const c = swissEngine.constants;
        const body = bodyName === 'Moon' ? c.moon : c.sun;
        const flags = c.swieph | c.speed | c.equatorial | c.topocentric;
        swissEngine.setTopo?.(observer.longitude, observer.latitude, observer.height || 0);
        const pos = swissEngine.calc(jd, body, flags);
        return Number(pos[1]);
      }
      if (settings.engine === 'astronomy' && window.Astronomy && observer?.astronomyObserver) {
        const time = new window.Astronomy.AstroTime(jd - 2451545.0);
        const equ = window.Astronomy.Equator(astronomyBody(bodyName), time, observer.astronomyObserver, true, true);
        return Number(equ.dec);
      }
      return null;
    }

    function refineArchaeoDeclinationDeg(nominalDecDeg, jd, observer, anchorBody) {
      const nominal = Number(nominalDecDeg);
      const bodyDec = bodyGeocentricDeclinationDeg(anchorBody, jd, observer);
      if (!isFinite(bodyDec)) return nominal;
      if (Math.abs(bodyDec - nominal) <= ARCHAEO_DECLINATION_ANCHOR_TOLERANCE_DEG) return bodyDec;
      return nominal;
    }

    function archaeoDeclinationSets(jd, observer) {
      const obliquity = meanObliquityDeg(jd);
      const crossQuarter = THREE.MathUtils.radToDeg(
        Math.asin(Math.sin(THREE.MathUtils.degToRad(obliquity)) / Math.sqrt(2))
      );
      const lunar = lunarStandstillDeclinationsDeg(obliquity, observer);
      const refineSun = (dec) => refineArchaeoDeclinationDeg(dec, jd, observer, 'Sun');
      const refineMoon = (dec) => refineArchaeoDeclinationDeg(dec, jd, observer, 'Moon');
      return {
        obliquity,
        crossQuarter,
        equinox: [refineSun(0)],
        solstice: [refineSun(obliquity), refineSun(-obliquity)],
        crossquarter: [refineSun(crossQuarter), refineSun(-crossQuarter)],
        majorLunar: lunar.major.map(refineMoon),
        minorLunar: lunar.minor.map(refineMoon)
      };
    }

    function viewshedCacheTag() {
      const tags = [];
      for (let az = 0; az < 360; az += 30) {
        const sample = options.getViewshedHorizonSample?.(az);
        tags.push(sample && Number.isFinite(sample.altitude) ? sample.altitude.toFixed(2) : 'na');
      }
      return tags.join(',');
    }

    function declinationArcPoints(decDeg, observer, jd) {
      const camera = options.camera;
      const distanceM = Math.max(7000, Math.min(18000, camera.far * 0.48));
      const focus = options.getCurrentFocus?.();
      const key = [
        'archaeo',
        'arch-azalt-v2',
        settings.engine,
        decDeg.toFixed(4),
        Number(jd).toFixed(6),
        settings.year,
        settings.month,
        settings.day,
        settings.time,
        Number(focus?.lat || 0).toFixed(6),
        Number(focus?.lng || 0).toFixed(6),
        Math.round(observer.height || 0),
        viewshedCacheTag(),
        swissAtmosphereCacheTag()
      ].join('|');
      let horizontals = pathCache.get(key);
      if (!horizontals) {
        horizontals = [];
        for (let hourAngle = -180; hourAngle <= 180; hourAngle += 2) {
          horizontals.push(horizontalForDeclinationArc(decDeg, hourAngle, observer, jd));
        }
        pathCache.set(key, horizontals);
      }
      return horizontalsToPointSegments(horizontals, distanceM);
    }

    function updateNamedLine(id, segments, color, visible, opacity = 0.62) {
      const segmentList = Array.isArray(segments?.[0]) ? segments : (segments?.length ? [segments] : []);
      const visibleSegIds = new Set();
      if (!visible || !segmentList.some((seg) => seg.length > 1)) {
        for (const [lineId, line] of archaeoLines.entries()) {
          if (lineId === id || lineId.startsWith(`${id}::`)) line.visible = false;
        }
        return;
      }
      for (let i = 0; i < segmentList.length; i += 1) {
        const segId = segmentList.length > 1 ? `${id}::${i}` : id;
        const points = segmentList[i];
        if (points.length < 2) continue;
        visibleSegIds.add(segId);
        let line = archaeoLines.get(segId);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        if (!line) {
          line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity,
            depthTest: true,
            depthWrite: false
          }));
          line.renderOrder = ASTRO_LINE_RENDER_ORDER;
          line.name = segId;
          group.add(line);
          archaeoLines.set(segId, line);
        } else {
          line.geometry.dispose();
          line.geometry = geometry;
          line.material.color.setHex(color);
          line.material.depthTest = true;
          line.material.depthWrite = false;
          line.renderOrder = ASTRO_LINE_RENDER_ORDER;
          line.visible = true;
        }
      }
      for (const [lineId, line] of archaeoLines.entries()) {
        if ((lineId === id || lineId.startsWith(`${id}::`)) && !visibleSegIds.has(lineId)) {
          line.visible = false;
        }
      }
    }

    const COMPASS_CARDINALS = [
      [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
      [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']
    ];

    function clearHorizonCompass() {
      if (compassRingLine) {
        group.remove(compassRingLine);
        compassRingLine.geometry?.dispose?.();
        compassRingLine.material?.dispose?.();
        compassRingLine = null;
      }
      if (compassTicksLine) {
        group.remove(compassTicksLine);
        compassTicksLine.geometry?.dispose?.();
        compassTicksLine.material?.dispose?.();
        compassTicksLine = null;
      }
      for (const sprite of compassLabelSprites.values()) {
        group.remove(sprite);
        sprite.material?.map?.dispose?.();
        sprite.material?.dispose?.();
      }
      compassLabelSprites.clear();
    }

    function compassLabelPixelRatio() {
      const raw = options.getDevicePixelRatio?.() ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);
      return Math.max(2, Math.min(4, Number(raw) || 1));
    }

    function makeCompassLineMaterial() {
      return new THREE.LineBasicMaterial({
        color: HORIZON_COMPASS_COLOR,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false
      });
    }

    function makeCompassLabelSprite(text, fontPx) {
      const dpr = compassLabelPixelRatio();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
      ctx.font = font;
      const pad = 6;
      const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
      const h = fontPx + pad * 2;
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = font;
      ctx.fillStyle = HORIZON_COMPASS_LABEL_CSS;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = Math.min(8, options.getMaxAnisotropy?.() || 4);
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(material);
      sprite.userData.compassLabel = true;
      sprite.userData.labelAspect = w / h;
      sprite.renderOrder = HORIZON_COMPASS_RENDER_ORDER;
      return sprite;
    }

    function placeCompassLabel(sprite, azimuthDeg, altitudeDeg, distanceM) {
      const camera = options.camera;
      const dir = directionFromAzAlt(azimuthDeg, altitudeDeg);
      sprite.position.copy(camera.position).addScaledVector(dir, distanceM);
      const labelWidthDeg = sprite.userData.labelKind === 'cardinal' ? 2.4 : 1.8;
      const scale = angularScaleAtDistance(distanceM, labelWidthDeg);
      const aspect = sprite.userData.labelAspect || 1;
      sprite.scale.set(scale * aspect, scale, 1);
    }

    function updateHorizonCompass() {
      if (!settings.showHorizonCompass || !options.isPanoramaView?.() || !group.visible) {
        clearHorizonCompass();
        return;
      }
      const distanceM = compassSceneDistanceM();
      const ringPoints = [];
      for (let az = 0; az <= 360; az += 1) {
        ringPoints.push(scenePointFromAzAlt(az, 0, distanceM));
      }
      if (!compassRingLine) {
        compassRingLine = new THREE.LineLoop(new THREE.BufferGeometry(), makeCompassLineMaterial());
        compassRingLine.name = 'astro-horizon-compass-ring';
        compassRingLine.renderOrder = HORIZON_COMPASS_RENDER_ORDER;
        compassRingLine.frustumCulled = false;
        group.add(compassRingLine);
      }
      compassRingLine.geometry.dispose();
      compassRingLine.geometry = new THREE.BufferGeometry().setFromPoints(ringPoints);
      compassRingLine.visible = true;

      const tickPositions = [];
      for (let az = 0; az < 360; az += 1) {
        const tickAlt = (az % 5 === 0) ? HORIZON_COMPASS_TICK_MAJOR_DEG : HORIZON_COMPASS_TICK_DEG;
        tickPositions.push(
          scenePointFromAzAlt(az, 0, distanceM),
          scenePointFromAzAlt(az, tickAlt, distanceM)
        );
      }
      if (!compassTicksLine) {
        compassTicksLine = new THREE.LineSegments(new THREE.BufferGeometry(), makeCompassLineMaterial());
        compassTicksLine.name = 'astro-horizon-compass-ticks';
        compassTicksLine.renderOrder = HORIZON_COMPASS_RENDER_ORDER;
        compassTicksLine.frustumCulled = false;
        group.add(compassTicksLine);
      }
      compassTicksLine.geometry.dispose();
      compassTicksLine.geometry = new THREE.BufferGeometry().setFromPoints(tickPositions);
      compassTicksLine.visible = true;

      const wantedLabels = new Map();
      for (let az = 0; az < 360; az += 10) {
        if (az % 45 === 0) continue;
        wantedLabels.set(`deg-${az}`, { az, text: String(az), alt: HORIZON_COMPASS_DEG_LABEL_ALT, kind: 'deg' });
      }
      for (const [az, text] of COMPASS_CARDINALS) {
        wantedLabels.set(`card-${az}`, { az, text, alt: HORIZON_COMPASS_CARDINAL_ALT, kind: 'cardinal' });
      }
      for (const [id, spec] of wantedLabels.entries()) {
        let sprite = compassLabelSprites.get(id);
        if (!sprite) {
          sprite = makeCompassLabelSprite(spec.text, spec.kind === 'cardinal' ? 22 : 18);
          sprite.userData.labelKind = spec.kind;
          compassLabelSprites.set(id, sprite);
          group.add(sprite);
        } else if (sprite.userData.labelText !== spec.text) {
          group.remove(sprite);
          sprite.material?.map?.dispose?.();
          sprite.material?.dispose?.();
          sprite = makeCompassLabelSprite(spec.text, spec.kind === 'cardinal' ? 22 : 18);
          sprite.userData.labelKind = spec.kind;
          sprite.userData.labelText = spec.text;
          compassLabelSprites.set(id, sprite);
          group.add(sprite);
        }
        sprite.userData.labelText = spec.text;
        placeCompassLabel(sprite, spec.az, spec.alt, distanceM);
        sprite.visible = true;
      }
      for (const [id, sprite] of compassLabelSprites.entries()) {
        if (!wantedLabels.has(id)) {
          group.remove(sprite);
          sprite.material?.map?.dispose?.();
          sprite.material?.dispose?.();
          compassLabelSprites.delete(id);
        }
      }
    }

    function updateArchaeoLines(observer, jd) {
      const sets = archaeoDeclinationSets(jd, observer);
      const showLines = settings.showArchaeolines;
      const configs = [
        { key: 'equinox', enabled: showLines && settings.showArchaeoEquinox, decs: sets.equinox, color: ARCHAEO_LINE_COLORS.equinox },
        { key: 'solstice', enabled: showLines && settings.showArchaeoSolstice, decs: sets.solstice, color: ARCHAEO_LINE_COLORS.solstice },
        { key: 'crossquarter', enabled: showLines && settings.showArchaeoCrossquarter, decs: sets.crossquarter, color: ARCHAEO_LINE_COLORS.crossquarter },
        { key: 'majorLunar', enabled: showLines && settings.showArchaeoMajorLunar, decs: sets.majorLunar, color: ARCHAEO_LINE_COLORS.majorLunar },
        { key: 'minorLunar', enabled: showLines && settings.showArchaeoMinorLunar, decs: sets.minorLunar, color: ARCHAEO_LINE_COLORS.minorLunar }
      ];
      const activeIds = new Set();
      for (const cfg of configs) {
        cfg.decs.forEach((dec, index) => {
          const id = `astro-archaeo-${cfg.key}-${index}`;
          activeIds.add(id);
          updateNamedLine(
            id,
            cfg.enabled ? declinationArcPoints(dec, observer, jd) : [],
            cfg.color,
            cfg.enabled
          );
        });
      }
      for (const [id, line] of archaeoLines.entries()) {
        if (!activeIds.has(id) && !Array.from(activeIds).some((activeId) => id.startsWith(`${activeId}::`))) {
          line.visible = false;
        }
      }
      return sets;
    }

    function riseSetHourAnglesDeg(decDeg, observer) {
      const phi = THREE.MathUtils.degToRad(observer.latitude);
      const dec = THREE.MathUtils.degToRad(decDeg);
      const limit = -Math.tan(phi) * Math.tan(dec);
      if (limit > 1 || limit < -1) return null;
      const h0 = THREE.MathUtils.radToDeg(Math.acos(limit));
      return { rise: -h0, set: h0 };
    }

    function riseSetHorizontal(decDeg, observer, event, jd) {
      const ha = riseSetHourAnglesDeg(decDeg, observer);
      if (!ha) return null;
      const hourAngle = event === 'rise' ? ha.rise : ha.set;
      const j = jd != null ? jd : selectedJulianDay();
      return horizontalForDeclinationArc(decDeg, hourAngle, observer, j);
    }

    function currentSimulationHorizontal() {
      if (!simulation.active) return null;
      return {
        azimuth: normalizeDeg(simulation.baseAzimuth + simulation.azimuthOffset),
        altitude: 0,
        dec: simulation.dec
      };
    }

    function activateSimulation(body, decDeg, event, label, tone) {
      const observer = observerDetails();
      if (!observer) return false;
      const hor = riseSetHorizontal(decDeg, observer, event);
      if (!hor) return false;
      simulation.active = true;
      simulation.body = body;
      simulation.dec = decDeg;
      simulation.event = event;
      simulation.label = label;
      simulation.tone = tone || 'equinox';
      simulation.baseAzimuth = hor.azimuth;
      simulation.azimuthOffset = 0;
      updateOverlay();
      return true;
    }

    function bumpSimulation(deltaDeg) {
      if (!simulation.active) return;
      simulation.azimuthOffset += deltaDeg;
      updateOverlay();
    }

    function clearSimulation() {
      simulation.active = false;
      simulation.body = null;
      if (simSunSprite) simSunSprite.visible = false;
      if (simMoonSprite) simMoonSprite.visible = false;
    }

    function refreshSimulationBase() {
      if (!simulation.active) return;
      const observer = observerDetails();
      if (!observer) {
        clearSimulation();
        return;
      }
      const jd = selectedJulianDay();
      const hor = riseSetHorizontal(simulation.dec, observer, simulation.event, jd);
      if (!hor) {
        clearSimulation();
        return;
      }
      simulation.baseAzimuth = hor.azimuth;
    }

    function updateSimulationSprite() {
      if (!simulation.active) {
        if (simSunSprite) simSunSprite.visible = false;
        if (simMoonSprite) simMoonSprite.visible = false;
        return;
      }
      const hor = currentSimulationHorizontal();
      const isSun = simulation.body === 'sun';
      const sprite = ensureSimSprite(isSun ? 'sun' : 'moon', isSun ? getSunDiscTexture() : fullMoonTexture);
      const other = isSun ? simMoonSprite : simSunSprite;
      if (other) other.visible = false;
      setSprite(sprite, hor, angularDiameterDeg(isSun ? 'Sun' : 'Moon', hor), true, isSun ? 'sun' : 'moon');
    }

    function refreshArchaeoSimulationPanel() {
      // Reserved for the Simulation display panel.
    }

    function horizontalFromDeclination(decDeg, hourAngleDeg, observer) {
      const phi = THREE.MathUtils.degToRad(observer.latitude);
      const dec = THREE.MathUtils.degToRad(decDeg);
      const h = THREE.MathUtils.degToRad(hourAngleDeg);
      const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
      const altitude = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, sinAlt))));
      const east = -Math.cos(dec) * Math.sin(h);
      const north = Math.cos(phi) * Math.sin(dec) - Math.sin(phi) * Math.cos(dec) * Math.cos(h);
      const azimuth = (THREE.MathUtils.radToDeg(Math.atan2(east, north)) + 360) % 360;
      return { azimuth, altitude, dec: decDeg };
    }

    function swissAtmosphereActive() {
      return settings.engine === 'swiss' && settings.swissAtmosphere !== false;
    }

    /** Stellarium-style barometric pressure from height above sea-level datum (ICAO troposphere). */
    function barometricPressureMbar(altitudeM, seaLevelPressureMbar = 1013.25) {
      const h = Number(altitudeM);
      const p0 = Number(seaLevelPressureMbar) || 1013.25;
      if (!isFinite(h) || h <= 0) return p0;
      return p0 * Math.pow(1 - 0.0000225577 * h, 5.25588);
    }

    /** Pressure at observer eye height: Stellarium auto (barometric) or fixed sea-level pressure. */
    function swissAtmosphereParams(observer) {
      const attemp = Number(settings.temperatureC);
      const p0 = Number(settings.seaLevelPressureMbar);
      const seaH = Number(settings.seaLevelHeightM);
      const eyeH = Number(observer?.height) || 0;
      const pSea = isFinite(p0) ? p0 : 1013.25;
      const h0 = isFinite(seaH) ? seaH : 0;
      const altitudeM = eyeH - h0;
      const auto = settings.atmospherePressureAuto !== false;
      const atpress = auto
        ? barometricPressureMbar(Math.max(0, altitudeM), pSea)
        : Math.max(400, Math.min(1100, pSea));
      return {
        atpress,
        attemp: isFinite(attemp) ? attemp : 15
      };
    }

    function swissAtmosphereCacheTag() {
      if (!swissAtmosphereActive()) return 'atm0';
      return [
        'atm-stellarium-v1',
        settings.atmospherePressureAuto !== false ? 'auto1' : 'auto0',
        Number(settings.seaLevelPressureMbar).toFixed(2),
        Number(settings.seaLevelHeightM).toFixed(1),
        Number(settings.temperatureC).toFixed(1)
      ].join('|');
    }

    /** Swiss Ephemeris azimuth is measured from south; app uses north = 0°. */
    function swissAzimuthNorthFromSouthDeg(azSouthDeg) {
      return normalizeDeg(Number(azSouthDeg) + 180);
    }

    function bennettRefractionDeg(trueAltDeg) {
      const h = Number(trueAltDeg);
      if (!isFinite(h)) return h;
      if (h < -5) return h;
      const r = 1.02 / Math.tan(THREE.MathUtils.degToRad(h + 10.3 / (h + 5.11))) / 60;
      return h + r;
    }

    function swissRefracTrueToApparent(trueAltDeg, observer) {
      const alt = Number(trueAltDeg);
      if (!isFinite(alt)) return alt;
      const { atpress, attemp } = swissAtmosphereParams(observer);
      const trueToApp = 0;
      const sweMod = swissEngine?.type === 'class' ? swissEngine.swe?.SweModule : swissEngine?.swe;
      if (sweMod?.ccall) {
        try {
          const app = sweMod.ccall('swe_refrac', 'number', ['number', 'number', 'number', 'number'], [alt, atpress, attemp, trueToApp]);
          if (isFinite(app)) return app;
        } catch (_) {}
      }
      return bennettRefractionDeg(alt);
    }

    function swissAzaltEquatorial(jd, observer, raDeg, decDeg) {
      if (!swissEngine) return null;
      const geopos = [Number(observer.longitude), Number(observer.latitude), Number(observer.height) || 0];
      const xin = [Number(raDeg), Number(decDeg), 0];
      const { atpress, attemp } = swissAtmosphereParams(observer);
      const equ2hor = 1;

      if (swissEngine.type === 'class' && typeof swissEngine.swe?.azalt === 'function') {
        const flag = swissEngine.swe.SE_EQU2HOR ?? equ2hor;
        const out = swissEngine.swe.azalt(jd, flag, geopos, atpress, attemp, xin);
        if (!out) return null;
        return {
          azimuth: swissAzimuthNorthFromSouthDeg(out.azimuth),
          altitude: Number(out.apparentAltitude),
          trueAltitude: Number(out.trueAltitude)
        };
      }

      const swe = swissEngine.swe;
      if (swissEngine.type === 'emscripten' && swe?.ccall && swe._malloc) {
        const xazPtr = swe._malloc(3 * 8);
        const xinPtr = swe._malloc(3 * 8);
        const geoposPtr = swe._malloc(3 * 8);
        try {
          const HEAPF64 = swe.HEAPF64;
          HEAPF64[xinPtr >> 3] = xin[0];
          HEAPF64[(xinPtr >> 3) + 1] = xin[1];
          HEAPF64[(xinPtr >> 3) + 2] = 0;
          HEAPF64[geoposPtr >> 3] = geopos[0];
          HEAPF64[(geoposPtr >> 3) + 1] = geopos[1];
          HEAPF64[(geoposPtr >> 3) + 2] = geopos[2];
          swe.ccall('swe_azalt', 'void', ['number', 'number', 'pointer', 'number', 'number', 'pointer', 'pointer'],
            [jd, equ2hor, geoposPtr, atpress, attemp, xinPtr, xazPtr]);
          return {
            azimuth: swissAzimuthNorthFromSouthDeg(HEAPF64[xazPtr >> 3]),
            altitude: HEAPF64[(xazPtr >> 3) + 2],
            trueAltitude: HEAPF64[(xazPtr >> 3) + 1]
          };
        } finally {
          swe._free(xazPtr);
          swe._free(xinPtr);
          swe._free(geoposPtr);
        }
      }
      return null;
    }

    function horizontalWithSwissAtmosphere(hor, observer) {
      if (!hor || !swissAtmosphereActive() || !swissEngine) return hor;
      const trueAlt = Number(hor.altitude);
      if (!isFinite(trueAlt)) return hor;
      const appAlt = swissRefracTrueToApparent(trueAlt, observer);
      if (!isFinite(appAlt)) return hor;
      return { ...hor, altitude: appAlt, trueAltitude: trueAlt };
    }

    function raDegFromHourAngle(jd, observer, hourAngleDeg) {
      const lst = normalizeDeg(greenwichSiderealDeg(jd) + observer.longitude);
      return normalizeDeg(lst - hourAngleDeg);
    }

    /** Declination circle point: same refraction pipeline as Sun/Moon daily paths. */
    function horizontalForDeclinationArc(decDeg, hourAngleDeg, observer, jd) {
      const dec = Number(decDeg);
      const ha = Number(hourAngleDeg);
      const ra = raDegFromHourAngle(jd, observer, ha);
      if (swissAtmosphereActive() && swissEngine) {
        const azalt = swissAzaltEquatorial(jd, observer, ra, dec);
        if (azalt) return { ...azalt, dec };
        const hor = horizontalFromDeclination(dec, ha, observer);
        return { ...horizontalWithSwissAtmosphere(hor, observer), dec };
      }
      if (settings.engine === 'astronomy' && window.Astronomy) {
        const hor = astronomyHorizontalFromEquatorial(ra, dec, jd, observer);
        if (hor) return hor;
      }
      return horizontalFromDeclination(dec, ha, observer);
    }

    function observerHorizontalFromDeclination(decDeg, hourAngleDeg, observer, jd) {
      const j = jd != null ? jd : selectedJulianDay();
      return horizontalForDeclinationArc(decDeg, hourAngleDeg, observer, j);
    }

    function bodyHorizontalAtHour(bodyLabel, observer, hourUTC) {
      const hour = Math.max(0, Math.min(24, Number(hourUTC) || 0));
      let hor = null;
      if (settings.engine === 'swiss' && swissEngine) {
        const jd = julianDayFromCalendar(settings.year, settings.month, settings.day, hour);
        hor = swissHorizontalForBody(bodyLabel, jd, observer);
      } else if (settings.engine === 'astronomy' && window.Astronomy) {
        const jd = julianDayFromCalendar(settings.year, settings.month, settings.day, hour);
        const time = new window.Astronomy.AstroTime(jd - 2451545.0);
        hor = astronomyHorizontalForBody(bodyLabel, time, observer);
      }
      return hor ? { ...hor, hourUTC: hour } : null;
    }

    /** Subdivide low-altitude chords so the path matches swe_azalt points (cached once per day). */
    const PATH_COARSE_STEPS = 25;
    const PATH_LOW_ALT_DEG = 8;
    const PATH_MAX_CHORD_ERROR_DEG = 0.04;
    const PATH_MAX_SUBDIV_DEPTH = 4;

    function pathSegmentChordErrorDeg(a, b, hourMid, bodyLabel, observer) {
      const exact = bodyHorizontalAtHour(bodyLabel, observer, hourMid);
      if (!exact) return 0;
      const chordAlt = a.altitude + (b.altitude - a.altitude) * 0.5;
      const chordAz = lerpAzimuthDeg(a.azimuth, b.azimuth, 0.5);
      const dAlt = Math.abs(exact.altitude - chordAlt);
      const dAz = Math.abs(((exact.azimuth - chordAz + 540) % 360) - 180);
      return dAlt + dAz * 0.02;
    }

    function subdividePathSegment(a, b, bodyLabel, observer, depth, out) {
      const hourA = a.hourUTC ?? 0;
      const hourB = b.hourUTC ?? 24;
      if (hourB - hourA < 1 / 120) return;
      const hourMid = (hourA + hourB) / 2;
      const minAlt = Math.min(a.altitude, b.altitude);
      const err = pathSegmentChordErrorDeg(a, b, hourMid, bodyLabel, observer);
      if (depth >= PATH_MAX_SUBDIV_DEPTH || (minAlt >= PATH_LOW_ALT_DEG && err <= PATH_MAX_CHORD_ERROR_DEG)) {
        return;
      }
      const mid = bodyHorizontalAtHour(bodyLabel, observer, hourMid);
      if (!mid) return;
      subdividePathSegment(a, mid, bodyLabel, observer, depth + 1, out);
      out.push(mid);
      subdividePathSegment(mid, b, bodyLabel, observer, depth + 1, out);
    }

    function densifyPathHorizontals(horizontals, bodyLabel, observer) {
      if (!horizontals?.length) return horizontals;
      const sorted = horizontals.slice().sort((x, y) => (x.hourUTC ?? 0) - (y.hourUTC ?? 0));
      const out = [sorted[0]];
      for (let i = 1; i < sorted.length; i += 1) {
        const extra = [];
        subdividePathSegment(sorted[i - 1], sorted[i], bodyLabel, observer, 0, extra);
        extra.sort((x, y) => x.hourUTC - y.hourUTC);
        out.push(...extra, sorted[i]);
      }
      return out;
    }

    function buildDailyPathHorizontals(bodyName, observer) {
      const label = bodyName === 'Sun' ? 'Sun' : 'Moon';
      const coarse = [];
      for (let i = 0; i < PATH_COARSE_STEPS; i += 1) {
        const hour = (i / (PATH_COARSE_STEPS - 1)) * 24;
        const hor = bodyHorizontalAtHour(label, observer, hour);
        if (hor) coarse.push(hor);
      }
      if (!coarse.length) return null;
      return densifyPathHorizontals(coarse, label, observer);
    }

    function pathHourForHorizontal(hor, index, count) {
      if (Number.isFinite(hor?.hourUTC)) return hor.hourUTC;
      if (count <= 1) return 0;
      return (index / (count - 1)) * 24;
    }

    /** Interpolate az/alt between path vertices by UTC hour (vertices are exact ephemeris + swe_azalt). */
    function interpolateHorizontalsByHour(horizontals, hourUTC) {
      if (!horizontals?.length) return null;
      if (horizontals.length === 1) return { ...horizontals[0] };
      const hour = Math.max(0, Math.min(24, Number(hourUTC) || 0));
      const n = horizontals.length;
      let i0 = 0;
      let i1 = 1;
      for (let i = 0; i < n - 1; i += 1) {
        const ha = pathHourForHorizontal(horizontals[i], i, n);
        const hb = pathHourForHorizontal(horizontals[i + 1], i + 1, n);
        if (hour >= ha && hour <= hb) {
          i0 = i;
          i1 = i + 1;
          break;
        }
        if (hour > hb) {
          i0 = i;
          i1 = i + 1;
        }
      }
      const a = horizontals[i0];
      const b = horizontals[i1];
      const ha = pathHourForHorizontal(a, i0, n);
      const hb = pathHourForHorizontal(b, i1, n);
      const u = hb > ha ? (hour - ha) / (hb - ha) : 0;
      return {
        ...a,
        hourUTC: hour,
        azimuth: lerpAzimuthDeg(a.azimuth, b.azimuth, u),
        altitude: a.altitude + (b.altitude - a.altitude) * u
      };
    }

    function dailyPathCacheKey(bodyName, observer, engineName) {
      const focus = options.getCurrentFocus?.();
      return [
        engineName,
        bodyName,
        settings.year,
        settings.month,
        settings.day,
        Number(focus?.lat || 0).toFixed(6),
        Number(focus?.lng || 0).toFixed(6),
        Math.round(observer.height || 0),
        viewshedCacheTag(),
        swissAtmosphereCacheTag(),
        'path-adaptive-v3'
      ].join('|');
    }

    function getDailyPathHorizontals(bodyName, observer, selectedHorizontal, engineName) {
      const key = dailyPathCacheKey(bodyName, observer, engineName);
      let horizontals = pathCache.get(key);
      if (!horizontals) {
        horizontals = buildDailyPathHorizontals(bodyName, observer);
        if (!horizontals?.length && selectedHorizontal && Number.isFinite(selectedHorizontal.dec)) {
          horizontals = [];
          for (let hourAngle = -180; hourAngle <= 180; hourAngle += 2) {
            horizontals.push(observerHorizontalFromDeclination(selectedHorizontal.dec, hourAngle, observer));
          }
        }
        pathCache.clear();
        pathCache.set(key, horizontals);
      }
      return horizontals;
    }

    function sampledPath(bodyName, observer, selectedHorizontal, engineName) {
      const camera = options.camera;
      const distanceM = Math.max(7000, Math.min(18000, camera.far * 0.48));
      if (!selectedHorizontal || !Number.isFinite(selectedHorizontal.dec)) return [];
      const horizontals = getDailyPathHorizontals(bodyName, observer, selectedHorizontal, engineName);
      return horizontalsToPointSegments(horizontals, distanceM);
    }

    function normalizeDeg(value) {
      return ((Number(value) % 360) + 360) % 360;
    }

    function greenwichSiderealDeg(jd) {
      const t = (jd - 2451545.0) / 36525;
      return normalizeDeg(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000);
    }

    function horizontalFromRaDec(raDeg, decDeg, jd, observer) {
      const hourAngle = normalizeDeg(greenwichSiderealDeg(jd) + observer.longitude - raDeg);
      return horizontalFromDeclination(decDeg, hourAngle > 180 ? hourAngle - 360 : hourAngle, observer);
    }

    function positionArray(pos) {
      if (Array.isArray(pos) || ArrayBuffer.isView(pos)) return Array.from(pos);
      if (pos && typeof pos === 'object') {
        return [
          pos.longitude ?? pos.lon ?? pos.ra ?? 0,
          pos.latitude ?? pos.lat ?? pos.declination ?? pos.dec ?? 0,
          pos.distance ?? pos.dist ?? 1
        ];
      }
      return [0, 0, 1];
    }

    async function preloadSwissEphemerisFiles(swe) {
      if (!swe?.FS_createDataFile || !swe?.FS_createPath) return;
      try { swe.FS_createPath('/', 'ephe', true, true); } catch (_) {}
      await Promise.all(SWISS_EPHE_FILES.map(async (name) => {
        try {
          const response = await fetch(`./assets/ephe/${name}`, { cache: 'force-cache' });
          if (!response.ok) return;
          const data = new Uint8Array(await response.arrayBuffer());
          try { swe.FS_createDataFile('/ephe', name, data, true, false, false); } catch (_) {}
          if (name.endsWith('.bin')) {
            try { swe.FS_createDataFile('/ephe', name.slice(0, -4), data, true, false, false); } catch (_) {}
          }
        } catch (_) {
          // Optional ephemeris files are loaded opportunistically.
        }
      }));
    }

    async function loadSwissEngine() {
      if (swissEngine) return swissEngine;
      if (swissLoadPromise) return swissLoadPromise;
      swissError = '';
      swissLoadPromise = (async () => {
        let lastError = null;
        for (const url of SWISS_IMPORT_URLS) {
          try {
            const mod = await import(url);
            const SwissEph = mod.default || mod.SwissEph || mod;
            if (!SwissEph) throw new Error('Swiss Ephemeris module did not export a constructor.');

            if (typeof SwissEph === 'function' && SwissEph.prototype?.initSwissEph) {
              const swe = new SwissEph();
              await swe.initSwissEph();
              await preloadSwissEphemerisFiles(swe.SweModule);
              try { swe.set_ephe_path?.('/ephe'); } catch (_) {}
              swissEngine = {
                name: 'Swiss Ephemeris',
                type: 'class',
                swe,
                calc(jd, body, flags) {
                  return positionArray(swe.calc_ut(jd, body, flags));
                },
                julday(year, month, day, hour) {
                  const julian = usesJulianCalendar(year, month, day);
                  const gregFlag = julian ? (swe.SE_JUL_CAL ?? 0) : (swe.SE_GREG_CAL ?? 1);
                  return swe.julday
                    ? swe.julday(year, month, day, hour, gregFlag)
                    : julianDayFromCalendar(year, month, day, hour, julian);
                },
                pheno(jd, body, flags) {
                  return typeof swe.pheno_ut === 'function' ? positionArray(swe.pheno_ut(jd, body, flags)) : null;
                },
                setTopo(lon, lat, height) {
                  if (typeof swe.set_topo === 'function') swe.set_topo(lon, lat, height);
                },
                constants: {
                  sun: swe.SE_SUN ?? 0,
                  moon: swe.SE_MOON ?? 1,
                  gregorian: swe.SE_GREG_CAL ?? 1,
                  swieph: swe.SEFLG_SWIEPH ?? 2,
                  speed: swe.SEFLG_SPEED ?? 256,
                  equatorial: swe.SEFLG_EQUATORIAL ?? 2048,
                  topocentric: swe.SEFLG_TOPOCTR ?? 32768
                }
              };
              return swissEngine;
            }

            if (typeof SwissEph === 'function') {
              const swe = await SwissEph({
                locateFile: (path) => `./assets/${path}`,
                printErr: () => {}
              });
              await preloadSwissEphemerisFiles(swe);
              try { swe.ccall('swe_set_ephe_path', null, ['string'], ['/ephe']); } catch (_) {}
              swissEngine = {
                name: 'Swiss Ephemeris',
                type: 'emscripten',
                swe,
                calc(jd, body, flags) {
                  const ptr = swe._malloc(48);
                  const err = swe._malloc(256);
                  swe.ccall('swe_calc_ut', 'number', ['number', 'number', 'number', 'number', 'number'], [jd, body, flags, ptr, err]);
                  const res = [swe.HEAPF64[ptr >> 3], swe.HEAPF64[(ptr >> 3) + 1], swe.HEAPF64[(ptr >> 3) + 2]];
                  swe._free(ptr);
                  swe._free(err);
                  return res;
                },
                julday(year, month, day, hour) {
                  const gregFlag = usesJulianCalendar(year, month, day) ? 0 : 1;
                  return swe.ccall('swe_julday', 'number', ['number', 'number', 'number', 'number', 'number'], [year, month, day, hour, gregFlag]);
                },
                pheno(jd, body, flags) {
                  const attr = swe._malloc(160);
                  const err = swe._malloc(256);
                  swe.ccall('swe_pheno_ut', 'number', ['number', 'number', 'number', 'number', 'number'], [jd, body, flags, attr, err]);
                  const phase = swe.HEAPF64[(attr >> 3) + 1];
                  swe._free(attr);
                  swe._free(err);
                  return [0, phase, 0];
                },
                setTopo(lon, lat, height) {
                  swe.ccall('swe_set_topo', null, ['number', 'number', 'number'], [lon, lat, height]);
                },
                constants: {
                  sun: 0,
                  moon: 1,
                  gregorian: 1,
                  swieph: 2,
                  speed: 256,
                  equatorial: 2048,
                  topocentric: 32768
                }
              };
              return swissEngine;
            }
          } catch (err) {
            lastError = err;
          }
        }
        throw lastError || new Error('Swiss Ephemeris module could not be loaded.');
      })().catch((err) => {
        swissLoadPromise = null;
        swissError = err?.message || String(err);
        throw err;
      });
      return swissLoadPromise;
    }

    function swissHorizontalForBody(bodyName, jd, observer) {
      if (!swissEngine) return null;
      const c = swissEngine.constants;
      const body = bodyName === 'Sun' ? c.sun : c.moon;
      const flags = c.swieph | c.speed | c.equatorial | c.topocentric;
      swissEngine.setTopo?.(observer.longitude, observer.latitude, observer.height || 0);
      const pos = swissEngine.calc(jd, body, flags);
      const raDeg = Number(pos[0]);
      const decDeg = Number(pos[1]);
      const dist = Number(pos[2]);
      if (swissAtmosphereActive()) {
        const azalt = swissAzaltEquatorial(jd, observer, raDeg, decDeg);
        if (azalt) return { ...azalt, dec: decDeg, dist };
        const hor = horizontalFromRaDec(raDeg, decDeg, jd, observer);
        return { ...horizontalWithSwissAtmosphere(hor, observer), dec: decDeg, dist };
      }
      const hor = horizontalFromRaDec(raDeg, decDeg, jd, observer);
      return { ...hor, dec: decDeg, dist };
    }

    function swissMoonPhase(jd) {
      if (!swissEngine) return 180;
      const c = swissEngine.constants;
      const flags = c.swieph | c.speed;
      const sun = swissEngine.calc(jd, c.sun, flags);
      const moon = swissEngine.calc(jd, c.moon, flags);
      return normalizeDeg(Number(moon[0]) - Number(sun[0]));
    }

    function setStatus(text) {
      if (options.els.astroStatus) options.els.astroStatus.textContent = text;
    }

    function syncDateTimeFields() {
      const els = options.els;
      const active = document.activeElement;
      const year = String(settings.year);
      const month = String(settings.month);
      const day = String(settings.day);
      const timeParts = displayTimePartsFromUtc();
      const timeLabel = settings.useSummertime ? 'UTC+1' : 'UTC';
      syncingDateTimeFields = true;
      try {
        if (els.astroYear && active !== els.astroYear) els.astroYear.value = year;
        if (els.astroMonth && active !== els.astroMonth) els.astroMonth.value = month;
        if (els.astroDay && active !== els.astroDay) els.astroDay.value = day;
        if (els.astroTime && active !== els.astroTime) {
          els.astroTime.value = formatTimeFromTotalSeconds(utcSecondsToDisplay(settings.utcTotalSeconds));
        }
        if (els.dtYear && active !== els.dtYear) els.dtYear.value = year;
        if (els.dtMonth && active !== els.dtMonth) els.dtMonth.value = month;
        if (els.dtDay && active !== els.dtDay) els.dtDay.value = day;
        if (els.dtHour && active !== els.dtHour) els.dtHour.value = String(timeParts.hour);
        if (els.dtMinute && active !== els.dtMinute) els.dtMinute.value = String(timeParts.minute);
        if (els.dtSecond && active !== els.dtSecond) els.dtSecond.value = String(timeParts.second);
        if (els.dtHourLabel) els.dtHourLabel.textContent = settings.useSummertime ? 'Hour (UTC+1)' : 'Hour (UTC)';
        if (els.astroTimeLabel) els.astroTimeLabel.textContent = settings.useSummertime ? 'Time (UTC+1, HH:MM:SS)' : 'UTC Time (HH:MM:SS)';
        if (els.dtUseSummertime) els.dtUseSummertime.checked = Boolean(settings.useSummertime);
        if (els.astroUseSummertime) els.astroUseSummertime.checked = Boolean(settings.useSummertime);
        if (els.dtCalendarLabel) {
          els.dtCalendarLabel.textContent = `Calendar: ${selectedCalendarLabel()} · Clock: ${timeLabel}`;
        }
      } finally {
        syncingDateTimeFields = false;
      }
    }

    function syncAtmosphereFields() {
      const els = options.els;
      const swiss = settings.engine === 'swiss';
      if (els.astroSeaLevelPressure) els.astroSeaLevelPressure.value = String(settings.seaLevelPressureMbar);
      if (els.astroSeaLevelHeight) els.astroSeaLevelHeight.value = String(settings.seaLevelHeightM);
      if (els.astroAtmosphereAuto) els.astroAtmosphereAuto.checked = settings.atmospherePressureAuto !== false;
      if (els.astroTemperature) els.astroTemperature.value = String(settings.temperatureC);
      const manualPressure = settings.atmospherePressureAuto === false;
      if (els.astroSeaLevelPressure) els.astroSeaLevelPressure.disabled = !swiss;
      if (els.astroSeaLevelHeight) els.astroSeaLevelHeight.disabled = !swiss || !settings.atmospherePressureAuto;
      if (els.astroAtmosphereAuto) els.astroAtmosphereAuto.disabled = !swiss;
      if (els.astroTemperature) els.astroTemperature.disabled = !swiss;
      if (els.astroSeaLevelPressure) {
        const label = els.astroSeaLevelPressure.closest('label')?.querySelector('span');
        if (label) {
          label.textContent = manualPressure ? 'Pressure (mbar)' : 'Sea-level pressure (mbar)';
        }
      }
    }

    function syncSwissAtmosphereControl() {
      const els = options.els;
      if (!els.astroSwissAtmosphere) return;
      const swiss = settings.engine === 'swiss';
      els.astroSwissAtmosphere.checked = swiss && settings.swissAtmosphere !== false;
      els.astroSwissAtmosphere.disabled = !swiss;
      els.astroSwissAtmosphere.closest('.layer-option')?.classList.toggle('panorama-only-disabled', !swiss);
      syncAtmosphereFields();
    }

    function syncArchaeoLineFields() {
      const els = options.els;
      if (els.astroShowArchaeolines) els.astroShowArchaeolines.checked = settings.showArchaeolines;
      if (els.astroShowHorizonCompass) els.astroShowHorizonCompass.checked = settings.showHorizonCompass;
      if (els.astroArchEquinox) els.astroArchEquinox.checked = settings.showArchaeoEquinox;
      if (els.astroArchSolstice) els.astroArchSolstice.checked = settings.showArchaeoSolstice;
      if (els.astroArchCrossquarter) els.astroArchCrossquarter.checked = settings.showArchaeoCrossquarter;
      if (els.astroArchMajorLunar) els.astroArchMajorLunar.checked = settings.showArchaeoMajorLunar;
      if (els.astroArchMinorLunar) els.astroArchMinorLunar.checked = settings.showArchaeoMinorLunar;
    }

    function updateSettingsFromControls() {
      const els = options.els;
      const prevYear = settings.year;
      const prevMonth = settings.month;
      const prevDay = settings.day;
      if (els.astroEngine) settings.engine = els.astroEngine.value === 'swiss' ? 'swiss' : 'astronomy';
      if (els.astroSwissAtmosphere) {
        settings.swissAtmosphere = settings.engine === 'swiss' && Boolean(els.astroSwissAtmosphere.checked);
      }
      const yearEl = document.activeElement === els.astroYear && els.astroYear
        ? els.astroYear
        : (document.activeElement === els.dtYear && els.dtYear ? els.dtYear : (els.dtYear || els.astroYear));
      const monthEl = document.activeElement === els.dtMonth && els.dtMonth
        ? els.dtMonth
        : (document.activeElement === els.astroMonth && els.astroMonth ? els.astroMonth : (els.astroMonth || els.dtMonth));
      const dayEl = document.activeElement === els.dtDay && els.dtDay
        ? els.dtDay
        : (document.activeElement === els.astroDay && els.astroDay ? els.astroDay : (els.astroDay || els.dtDay));
      if (yearEl) {
        const parsedYear = parseYearInput(yearEl.value, null);
        if (parsedYear != null) settings.year = parsedYear;
      }
      if (monthEl) settings.month = Math.max(1, Math.min(12, Number(monthEl.value) || 1));
      if (dayEl) settings.day = Math.max(1, Math.min(31, Number(dayEl.value) || 1));
      if (settings.year !== prevYear || settings.month !== prevMonth || settings.day !== prevDay) {
        bumpDatetimeRevision();
      }
      if (els.astroAtmosphereAuto) {
        settings.atmospherePressureAuto = settings.engine === 'swiss' && Boolean(els.astroAtmosphereAuto.checked);
      }
      if (els.astroSeaLevelPressure) {
        settings.seaLevelPressureMbar = Math.max(400, Math.min(1100, Number(els.astroSeaLevelPressure.value) || 1013.25));
      }
      if (els.astroSeaLevelHeight) settings.seaLevelHeightM = Number(els.astroSeaLevelHeight.value) || 0;
      if (els.astroTemperature) settings.temperatureC = Number(els.astroTemperature.value) ?? 15;
      if (els.astroBodyScale) settings.bodyScale = Math.max(0.1, Number(els.astroBodyScale.value) || 1);
      if (els.astroBodyScaleValue) els.astroBodyScaleValue.textContent = `${settings.bodyScale.toFixed(1)}x`;
      settings.showSun = els.astroShowSun ? Boolean(els.astroShowSun.checked) : true;
      settings.showMoon = els.astroShowMoon ? Boolean(els.astroShowMoon.checked) : true;
      settings.showPaths = els.astroShowPaths ? Boolean(els.astroShowPaths.checked) : true;
      settings.showArchaeolines = els.astroShowArchaeolines ? Boolean(els.astroShowArchaeolines.checked) : false;
      settings.showHorizonCompass = els.astroShowHorizonCompass ? Boolean(els.astroShowHorizonCompass.checked) : false;
      settings.showArchaeoEquinox = els.astroArchEquinox ? Boolean(els.astroArchEquinox.checked) : true;
      settings.showArchaeoSolstice = els.astroArchSolstice ? Boolean(els.astroArchSolstice.checked) : true;
      settings.showArchaeoCrossquarter = els.astroArchCrossquarter ? Boolean(els.astroArchCrossquarter.checked) : true;
      settings.showArchaeoMajorLunar = els.astroArchMajorLunar ? Boolean(els.astroArchMajorLunar.checked) : true;
      settings.showArchaeoMinorLunar = els.astroArchMinorLunar ? Boolean(els.astroArchMinorLunar.checked) : true;
      if (els.dtUseSummertime) settings.useSummertime = Boolean(els.dtUseSummertime.checked);
      else if (els.astroUseSummertime) settings.useSummertime = Boolean(els.astroUseSummertime.checked);
      syncDateTimeFields();
      syncArchaeoLineFields();
      syncSwissAtmosphereControl();
    }

    function syncControls() {
      const els = options.els;
      if (els.astroEngine) els.astroEngine.value = settings.engine;
      syncSwissAtmosphereControl();
      syncDateTimeFields();
      if (els.astroBodyScale) els.astroBodyScale.value = String(settings.bodyScale);
      if (els.astroBodyScaleValue) els.astroBodyScaleValue.textContent = `${settings.bodyScale.toFixed(1)}x`;
      if (els.astroShowSun) els.astroShowSun.checked = settings.showSun;
      if (els.astroShowMoon) els.astroShowMoon.checked = settings.showMoon;
      if (els.astroShowPaths) els.astroShowPaths.checked = settings.showPaths;
      syncArchaeoLineFields();
    }

    let controlsBound = false;

    function bindControls() {
      if (controlsBound) return;
      controlsBound = true;
      const els = options.els;
      const settingsInputs = [
        els.astroEngine,
        els.astroSwissAtmosphere,
        els.astroMonth,
        els.astroDay,
        els.astroAtmosphereAuto,
        els.astroSeaLevelPressure,
        els.astroSeaLevelHeight,
        els.astroTemperature,
        els.astroBodyScale,
        els.astroShowSun,
        els.astroShowMoon,
        els.astroShowPaths,
        els.astroShowArchaeolines,
        els.astroShowHorizonCompass,
        els.astroArchEquinox,
        els.astroArchSolstice,
        els.astroArchCrossquarter,
        els.astroArchMajorLunar,
        els.astroArchMinorLunar
      ];
      const onSettingsChange = () => {
        stopTimePlayback();
        updateSettingsFromControls();
        pathCache.clear();
        invalidateStaticOverlay();
        updateOverlay(false);
      };
      const onSummertimeToggle = () => {
        stopTimePlayback();
        updateSettingsFromControls();
        syncDateTimeFields();
        updateOverlay(false, { forceBodies: true });
      };
      const bindTimeField = (input, field) => {
        if (!input || input.dataset.timeBound === 'true') return;
        input.dataset.timeBound = 'true';
        const handler = () => commitDomTimeField(field);
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
      };
      bindTimeField(els.dtHour, 'hour');
      bindTimeField(els.dtMinute, 'minute');
      bindTimeField(els.dtSecond, 'second');
      bindTimeField(els.astroTime, 'astroTime');
      for (const input of [els.dtMonth, els.dtDay, ...settingsInputs]) {
        input?.addEventListener('input', onSettingsChange);
        input?.addEventListener('change', onSettingsChange);
      }
      for (const input of [els.dtYear, els.astroYear]) {
        if (!input || input.dataset.yearBound === 'true') continue;
        input.dataset.yearBound = 'true';
        input.addEventListener('input', onSettingsChange);
        input.addEventListener('change', onSettingsChange);
        input.addEventListener('blur', () => finalizeYearField(input));
      }
      for (const input of [els.dtUseSummertime, els.astroUseSummertime]) {
        input?.addEventListener('change', onSummertimeToggle);
      }
      bindTimeTransportControls();
      updateTimeTransportButtons();
    }

    function invalidateStaticOverlay() {
      overlayState.staticKey = '';
    }

    function staticOverlayKey(observer, engineName) {
      const focus = options.getCurrentFocus?.();
      return [
        engineName,
        settings.year,
        settings.month,
        settings.day,
        settings.engine,
        settings.swissAtmosphere,
        settings.seaLevelPressureMbar,
        settings.seaLevelHeightM,
        settings.atmospherePressureAuto,
        settings.temperatureC,
        settings.bodyScale,
        settings.showPaths,
        settings.showSun,
        settings.showMoon,
        settings.showArchaeolines,
        settings.showArchaeoEquinox,
        settings.showArchaeoSolstice,
        settings.showArchaeoCrossquarter,
        settings.showArchaeoMajorLunar,
        settings.showArchaeoMinorLunar,
        Number(focus?.lat || 0).toFixed(6),
        Number(focus?.lng || 0).toFixed(6),
        Math.round(observer?.height || 0),
        viewshedCacheTag(),
        swissAtmosphereCacheTag()
      ].join('|');
    }

    function repositionBodies() {
      if (!group.visible || !overlayState.sunHor || !overlayState.moonHor) return;
      const sun = sunSprite;
      const moon = moonSprite;
      if (!sun || !moon) return;
      setSprite(sun, overlayState.sunHor, angularDiameterDeg('Sun', overlayState.sunHor), settings.showSun, 'sun');
      setSprite(moon, overlayState.moonHor, angularDiameterDeg('Moon', overlayState.moonHor), settings.showMoon, 'moon');
      updateSimulationSprite();
    }

    function updateStatusLine(observer, engineName, jd, sunHor, moonHor, moonPhase, archaeoObliquity) {
      const atm = swissAtmosphereParams(observer);
      const atmNote = (settings.engine === 'swiss' && swissAtmosphereActive())
        ? ` · atmosphere P=${atm.atpress.toFixed(1)} mbar T=${atm.attemp.toFixed(0)}°C`
        : '';
      setStatus(`${engineName} (${selectedCalendarLabel()} calendar) UTC ${normalizeTimeString(settings.time)}${atmNote}: Sun az ${sunHor.azimuth.toFixed(2)}°, alt ${sunHor.altitude.toFixed(2)}°, dec ${sunHor.dec.toFixed(2)}°; Moon az ${moonHor.azimuth.toFixed(2)}°, alt ${moonHor.altitude.toFixed(2)}°, dec ${moonHor.dec.toFixed(2)}°, phase ${moonPhase.toFixed(1)}°. Obliquity ${archaeoObliquity.toFixed(2)}°.`);
    }

    function updateBodiesAtTime(observer, engineName, jd, time, archaeoObliquity) {
      const dayHour = selectedHour();
      const sunHor = bodyHorizontalAtHour('Sun', observer, dayHour);
      const moonHor = bodyHorizontalAtHour('Moon', observer, dayHour);
      if (!sunHor || !moonHor) {
        throw new Error('Could not compute Sun/Moon position for the selected time.');
      }
      overlayState.sunHor = sunHor;
      overlayState.moonHor = moonHor;
      overlayState.datetimeRevision = datetimeRevision;

      const moonPhase = settings.engine === 'swiss'
        ? swissMoonPhase(jd)
        : (window.Astronomy.MoonPhase ? window.Astronomy.MoonPhase(time) : 180);
      overlayState.moonPhase = moonPhase;

      const sun = ensureSprite('sun', sunSprite ? null : getSunDiscTexture());
      ensureSunHaloSprite();
      const nextMoonPhaseKey = Math.round(moonPhase / 3);
      const moon = ensureSprite('moon', moonSprite && moonPhaseKey === nextMoonPhaseKey ? null : makeMoonTexture(moonPhase));
      moonPhaseKey = nextMoonPhaseKey;
      setSprite(sun, sunHor, angularDiameterDeg('Sun', sunHor), settings.showSun, 'sun');
      setSprite(moon, moonHor, angularDiameterDeg('Moon', moonHor), settings.showMoon, 'moon');
      refreshSimulationBase();
      updateSimulationSprite();
      updateStatusLine(observer, engineName, jd, sunHor, moonHor, moonPhase, archaeoObliquity);
      options.onHorizonsUpdated?.();
    }

    function rebuildStaticLayers(observer, engineName, jd, time) {
      const sunPathHorizontals = getDailyPathHorizontals('Sun', observer, overlayState.sunHor || { dec: 0 }, engineName);
      const moonPathHorizontals = getDailyPathHorizontals('Moon', observer, overlayState.moonHor || { dec: 0 }, engineName);
      updatePath('sun', settings.showSun ? sampledPath('Sun', observer, overlayState.sunHor || sunPathHorizontals?.[0], engineName) : [], 0xffcc44);
      updatePath('moon', settings.showMoon ? sampledPath('Moon', observer, overlayState.moonHor || moonPathHorizontals?.[0], engineName) : [], 0xdbeafe);
      return updateArchaeoLines(observer, jd);
    }

    function updateOverlay(readControls = false, updateOptions = {}) {
      const { repositionOnly = false, forceBodies = false } = updateOptions;
      const focus = options.getCurrentFocus?.();
      if (!focus || !options.camera) {
        group.visible = false;
        overlayState.sunHor = null;
        overlayState.moonHor = null;
        setStatus('Load a view to place the Sun and Moon.');
        return;
      }
      if (!options.isPanoramaView?.()) {
        group.visible = false;
        overlayState.sunHor = null;
        overlayState.moonHor = null;
        clearHorizonCompass();
        setStatus('Sun, Moon, and archaeolines are shown in Panorama view only.');
        return;
      }
      if (repositionOnly) {
        if (group.visible) {
          repositionBodies();
          updateHorizonCompass();
        }
        return;
      }
      if (readControls) updateSettingsFromControls();
      const observer = observerDetails();
      if (!observer) return;

      if (settings.engine === 'swiss' && !swissEngine) {
        group.visible = false;
        overlayState.sunHor = null;
        overlayState.moonHor = null;
        setStatus(swissError ? `Swiss Ephemeris unavailable: ${swissError}` : 'Loading Swiss Ephemeris...');
        loadSwissEngine()
          .then(() => {
            pathCache.clear();
            invalidateStaticOverlay();
            updateOverlay();
          })
          .catch((err) => setStatus(`Swiss Ephemeris unavailable: ${err?.message || String(err)}`));
        return;
      }

      if (settings.engine === 'astronomy' && !window.Astronomy) {
        group.visible = false;
        overlayState.sunHor = null;
        overlayState.moonHor = null;
        setStatus('Astronomy Engine did not load.');
        return;
      }

      group.visible = true;
      try {
        const engineName = settings.engine === 'swiss' ? 'Swiss Ephemeris' : 'Astronomy Engine';
        const jd = selectedJulianDay();
        const time = astronomyTime();
        const staticKey = staticOverlayKey(observer, engineName);
        const needsStatic = staticKey !== overlayState.staticKey;
        const needsBodies = forceBodies || datetimeRevision !== overlayState.datetimeRevision;
        let archaeoObliquity = meanObliquityDeg(jd);

        if (needsStatic) {
          updateBodiesAtTime(observer, engineName, jd, time, archaeoObliquity);
          const archaeo = rebuildStaticLayers(observer, engineName, jd, time);
          overlayState.staticKey = staticKey;
          updateStatusLine(observer, engineName, jd, overlayState.sunHor, overlayState.moonHor, overlayState.moonPhase, archaeo.obliquity);
        } else if (needsBodies) {
          updateBodiesAtTime(observer, engineName, jd, time, archaeoObliquity);
        } else {
          repositionBodies();
        }
        updateHorizonCompass();
      } catch (err) {
        group.visible = false;
        overlayState.sunHor = null;
        overlayState.moonHor = null;
        clearHorizonCompass();
        setStatus(`Astronomy overlay failed: ${err?.message || String(err)}`);
      }
    }

    setTimeToNow();

    function getDateTimeSnapshot() {
      return {
        year: settings.year,
        month: settings.month,
        day: settings.day,
        utcTotalSeconds: settings.utcTotalSeconds,
        useSummertime: !!settings.useSummertime
      };
    }

    function applyDateTimeSnapshot(snap) {
      if (!snap || typeof snap !== 'object') return;
      stopTimePlayback();
      const prevYear = settings.year;
      const prevMonth = settings.month;
      const prevDay = settings.day;
      if (Number.isFinite(Number(snap.year))) settings.year = Math.trunc(Number(snap.year));
      if (Number.isFinite(Number(snap.month))) settings.month = Math.max(1, Math.min(12, Math.trunc(Number(snap.month))));
      if (Number.isFinite(Number(snap.day))) settings.day = Math.max(1, Math.min(31, Math.trunc(Number(snap.day))));
      if (Number.isFinite(Number(snap.utcTotalSeconds))) {
        setTimeTotalSeconds(Number(snap.utcTotalSeconds));
      } else if (snap.hour != null || snap.minute != null || snap.second != null) {
        const h = Math.max(0, Math.min(23, Number(snap.hour) || 0));
        const m = Math.max(0, Math.min(59, Number(snap.minute) || 0));
        const s = Math.max(0, Math.min(59, Number(snap.second) || 0));
        setTimeTotalSeconds(h * 3600 + m * 60 + s);
      }
      if (typeof snap.useSummertime === 'boolean') settings.useSummertime = snap.useSummertime;
      if (settings.year !== prevYear || settings.month !== prevMonth || settings.day !== prevDay) bumpDatetimeRevision();
      syncDateTimeFields();
      pathCache.clear();
      invalidateStaticOverlay();
      updateOverlay(false, { forceBodies: true });
    }

    return {
      settings,
      group,
      bindControls,
      syncControls,
      getDateTimeSnapshot,
      applyDateTimeSnapshot,
      updateSettingsFromControls,
      updateOverlay,
      syncHorizonClip,
      stopTimePlayback,
      refreshArchaeoSimulationPanel,
      clearSimulation,
      clearCache() {
        pathCache.clear();
        invalidateStaticOverlay();
      },
      repositionBodies() {
        repositionBodies();
      },
      getBodyHorizons() {
        if (!overlayState.sunHor || !overlayState.moonHor) return null;
        return { sun: overlayState.sunHor, moon: overlayState.moonHor };
      }
    };
  }

  window.SkyscapeAstronomy = { create: createSkyscapeAstronomy };
}());
