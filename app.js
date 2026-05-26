(function () {
  'use strict';

  const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const GOOGLE_AERIAL_URL = 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
  const ESRI_CLARITY_URL = 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const NMS_ROI_SMR_URL = 'https://services-eu1.arcgis.com/HyjXgkV6KGMSF3jt/ArcGIS/rest/services/SMROpenData/FeatureServer/0';
  const NMS_NI_HED_URL = 'https://services2.arcgis.com/BdBkthNLO9mzGAMO/arcgis/rest/services/Historic_Environment_Division_GIS_Data/FeatureServer/0';

  const MONUMENT_SOURCE_ROI = 'roi';
  const MONUMENT_SOURCE_NI = 'ni';

  const NI_CANONICAL_TYPES = [
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
    'Henge',
    'Barrow - mound barrow',
    'Barrow - bowl-barrow',
    'Barrow - ring-barrow',
    'Barrow - unclassified',
    'Boulder-burial',
    'Rock art',
    'Cursus',
    'Embanked enclosure',
    'Ceremonial enclosure'
  ];

  // Default monument types (initial selection).
  // NMS distinct types are loaded dynamically from ArcGIS; these seed the Presets UI.
  const MEGALITHIC_TYPES = [
    { monumentClass: 'Megalithic tomb - passage tomb', color: 'red' },
    { monumentClass: 'Megalithic tomb - wedge tomb', color: 'pink' },
    { monumentClass: 'Megalithic tomb - court tomb', color: 'yellow' },
    { monumentClass: 'Megalithic tomb - portal tomb', color: 'purple' },
    { monumentClass: 'Megalithic tomb - unclassified', color: '#D4FC67' },
    { monumentClass: 'Cairn - unclassified', color: 'green' },
    { monumentClass: 'Henge', color: 'orange' },
    { monumentClass: 'Cursus', color: 'grey' },
    { monumentClass: 'Rock art', color: '#8A477E' },
    { monumentClass: 'Stone circle - embanked', color: '#C2FA15' },
    { monumentClass: 'Embanked enclosure', color: '#97D138' },
    { monumentClass: 'Stone circle', color: 'blue' },
    { monumentClass: 'Stone circle - five-stone', color: '#D795F4' },
    { monumentClass: 'Ceremonial enclosure', color: '#F8FA7E' },
    { monumentClass: 'Barrow - mound barrow', color: '#AF7EFA' },
    { monumentClass: 'Standing stone', color: '#49C9FC' },
    { monumentClass: 'Standing stone - pair', color: '#F22E87' },
    { monumentClass: 'Stone row', color: '#C70039' },
    { monumentClass: 'Linkardstown burial', color: '#F2782E' }
  ];

  // Icon sizes: list/legend vs on-stage marker layer.
  const TOUR_LIST_ICON_SIZE = 18;
  const TOUR_MARKER_ICON_SIZE = 12;

  const TILE_SIZE = 256;
  const TERRAIN_Z = 15;
  const AERIAL_Z = 16;
  const TERRAIN_TILE_COUNT = 7;
  const TERRAIN_TILE_COUNT_DOUBLE = 14;
  const HORIZON_Z = 13;
  const HORIZON_AERIAL_Z = 14;
  const HORIZON_TILE_RADIUS = 3; // wider, lower-resolution terrain skirt
  const GRID = 180;
  const DEFAULT_OBSERVER_LAT = 53.490266;
  const DEFAULT_OBSERVER_LNG = -7.5625666;
  const OBSERVER_HEIGHT_OFFSET_M = 2;

  let sites = [];
  let activeType = null; // monumentClass (string)

  let allMonumentClasses = [];
  let selectedMonumentClasses = new Set(MEGALITHIC_TYPES.map(t => String(t.monumentClass)));
  const specByMonumentClass = new Map(); // monumentClass -> spec (MegIcon)

  let selectedScreenMarker = null; // { el, local, monumentClass }

  let selectedSiteId = null;
  let imageryKey = 'esri-clarity';
  let demAreaKey = 'standard';
  let terrainMesh = null;
  let horizonMesh = null;
  let aerialTexture = null;
  let baseElev = null;
  let baseElevSize = 0;
  let baseCenterElev = 0;
  let horizonElev = null;
  let horizonElevSize = 0;
  let horizonCenterElev = 0;
  let horizonPatchMeters = 0;
  let horizonPatchOriginX = null;
  let horizonPatchOriginY = null;
  let horizonPatchCount = null;
  let verticalExaggeration = 1.0;
  let markerGroup = null;
  let siteMarker = null;
  let labelItems = [];
  let activeLabelPopup = null;
  let selectedSite = null;
  let currentFocus = null;
  let currentPatch = null;
  let loadingToken = 0;
  let terrainReloadTimer = null;
  let showRelatedMonuments = false;
  let showAllRelational = false;
  let showAllMonuments = false;
  let relatedMarkers = [];
  let relationalMarkers = [];
  let allMonumentMarkers = [];
  let showAllLabels = false;
  let relatedRangeM = 0;
  let allRelationalRangeM = 0;
  let sortByCountyOn = false;
  let notesBackgroundOn = true;
  let legendBackgroundOn = true;
  let overlayAlpha = 0.40;
  let overlayAlphaLastNonZero = 0.40;
  let legendLastUpdate = 0;
  let allLabelsQueryKey = null;
  let previewNotesSite = null;
  let notesActionItem = null;
  let notesDetailsOpen = false;
  let activeLabelId = null;
  let allLabelsLoadToken = 0;
  let relatedLoadToken = 0;
  let relationalLoadToken = 0;
  let siteDemReady = false;

  const cameraState = {
    pitch: 8,
    bearing: 28,
    distance: 1850,
    target: new THREE.Vector3(0, 80, 0),
    observerMode: false,
    observerHeightOffsetM: OBSERVER_HEIGHT_OFFSET_M
  };

  const els = {
    stage: document.querySelector('.tour-stage'),
    stageLoading: document.getElementById('stage-loading'),
    stageLoadingText: document.getElementById('stage-loading-text'),
    stageLoadingProgress: document.getElementById('stage-loading-progress'),
    stageLoadingProgressFill: document.getElementById('stage-loading-progress-fill'),
    container: document.getElementById('map'),
    typeList: document.getElementById('type-list'),
    siteList: document.getElementById('site-list'),
    typesPanelTitle: document.getElementById('types-panel-title'),
    typesTypeDot: document.getElementById('types-type-dot'),
    sitesPanelTitle: document.getElementById('sites-panel-title'),
    sitesTypeDot: document.getElementById('sites-type-dot'),
    title: document.getElementById('site-title'),
    typeLine: document.getElementById('site-type'),
    subtitle: document.getElementById('site-subtitle'),
    zoom: document.getElementById('zoom-readout'),
    pitch: document.getElementById('pitch-readout'),
    bearing: document.getElementById('bearing-readout'),
    nmsStatus: document.getElementById('nms-status'),
    presetStatus: document.getElementById('preset-status'),
    presetList: document.getElementById('preset-list'),
    heightSlider: document.getElementById('height-exaggeration'),
    heightValue: document.getElementById('height-exaggeration-value'),
    observerForm: document.getElementById('observer-location-form'),
    observerLat: document.getElementById('observer-lat'),
    observerLon: document.getElementById('observer-lon'),
    observerStatus: document.getElementById('observer-status'),
    demAreaOptions: document.getElementById('dem-area-options'),
    showRelatedMonuments: document.getElementById('show-related-monuments'),
    relatedRange: document.getElementById('related-range'),
    relatedRangeValue: document.getElementById('related-range-value'),
    showAllRelational: document.getElementById('show-all-relational'),
    allRelationalRange: document.getElementById('all-relational-range'),
    allRelationalRangeValue: document.getElementById('all-relational-range-value'),
    showAllMonuments: document.getElementById('show-all-monuments'),
    showAllLabels: document.getElementById('show-all-labels'),
    sortByCounty: document.getElementById('sort-by-county'),
    showNotes: document.getElementById('show-notes'),
    notesInline: document.getElementById('notes-inline'),
    notesInlineText: document.getElementById('notes-inline-text'),
    overlayOpacity: document.getElementById('overlay-opacity'),
    overlayOpacityValue: document.getElementById('overlay-opacity-value'),
    notesInlineDetails: document.getElementById('notes-inline-details'),
    notesLat: document.getElementById('notes-lat'),
    notesLon: document.getElementById('notes-lon'),
    notesDetailTableWrap: document.getElementById('notes-detail-table-wrap'),
    notesOpenGmaps: document.getElementById('notes-open-gmaps'),
    notesOpenNms: document.getElementById('notes-open-nms'),
    copyLat: document.getElementById('copy-lat'),
    copyLon: document.getElementById('copy-lon'),
    notesBgToggle: document.getElementById('notes-bg-toggle'),
    notesClose: document.getElementById('notes-close'),
    notesView: document.getElementById('notes-view'),
    notesMore: document.getElementById('notes-more'),
    showLegend: document.getElementById('show-legend'),
    legendInline: document.getElementById('legend-inline'),
    legendInlineList: document.getElementById('legend-inline-list'),
    legendBgToggle: document.getElementById('legend-bg-toggle'),
    legendClose: document.getElementById('legend-close'),
    labelLayer: document.getElementById('label-layer'),
    labelLines: document.getElementById('label-lines'),
    markerLayer: document.getElementById('marker-layer'),
    savedViewsEnabled: document.getElementById('saved-views-enabled'),
    savedViewsStatus: document.getElementById('saved-views-status'),
    savedViewsList: document.getElementById('saved-views-list'),
    savedViewPurge: document.getElementById('saved-view-purge'),
    saveMonumentSelectionEnabled: document.getElementById('save-monument-selection-enabled'),
    resetMonumentSelection: document.getElementById('reset-monument-selection')
  };

  const stageToolbarLeft = document.getElementById('stage-toolbar-left');
  const toggleSidebarBtn = document.getElementById('toggle-sidebar');
  const sidebarPeekBtn = document.getElementById('sidebar-peek');
  const hideControlsBtn = document.getElementById('hide-controls');
  const fullscreenViewBtn = document.getElementById('fullscreen-view');
  const panoramaViewBtn = document.getElementById('panorama-view');
  const saveViewBtn = document.getElementById('save-view');
  const copyViewBtn = document.getElementById('copy-view');
  const captureViewBtn = document.getElementById('capture-view');
  const helpViewBtn = document.getElementById('help-view');
  const loadingHelpViewBtn = document.getElementById('loading-help-view');
  const helpOverlay = document.getElementById('help-overlay');
  const helpCloseBtn = document.getElementById('help-close');
  const orbitSiteBtn = document.getElementById('orbit-site');

  let orbitRaf = 0;
  let orbitToken = 0;

  async function ensureMegIconLoaded() {
    if (!window.MegIcon) return false;
    try {
      await window.MegIcon.ensureMapLoaded('./megicon/');
      return true;
    } catch (_) {
      return !!window.MegIcon;
    }
  }

  async function getMegIconSpec(monumentClass) {
    const key = String(monumentClass || '').trim();
    if (!key) return null;
    if (specByMonumentClass.has(key)) return specByMonumentClass.get(key);
    if (!window.MegIcon) return null;
    try {
      const spec = await window.MegIcon.getSpecForMonumentClass(key, './megicon/');
      specByMonumentClass.set(key, spec);
      return spec;
    } catch (_) {
      return null;
    }
  }

  async function renderMegIconInto(el, monumentClass, size = TOUR_LIST_ICON_SIZE) {
    if (!el) return;
    const key = String(monumentClass || '').trim();
    if (!key || !window.MegIcon) {
      el.innerHTML = '';
      return;
    }

    // CRITICAL: Do NOT reuse the same SVG markup string in multiple places.
    // These icons rely on <mask id="...">, and duplicated IDs cause the mask to break
    // (looks like a square fill with a different shape outline "overlaid").
    const tokenKey = '__megiconToken';
    const token = (el[tokenKey] || 0) + 1;
    el[tokenKey] = token;
    try {
      const svg = await window.MegIcon.svgForMonumentClass(key, { size, basePath: './megicon/' });
      if (el[tokenKey] !== token) return;
      el.innerHTML = svg;
    } catch (_) {
      if (el[tokenKey] !== token) return;
      el.innerHTML = '';
    }
  }

  function renderHelpMegIconExamples() {
    document.querySelectorAll('[data-help-megicon]').forEach((el) => {
      const monumentClass = el.getAttribute('data-help-megicon') || '';
      renderMegIconInto(el, monumentClass, 24);
    });
  }

  function setStageLoadingText(text) {
    if (!els.stageLoadingText) return;
    els.stageLoadingText.textContent = String(text || '');
  }

  const stageProgress = {
    value: 0,
    target: 0,
    cap: 0.15,
    indeterminate: false,
    raf: 0,
    lastTs: 0,
    hideTimer: 0
  };

  function resetStageLoadingProgress({ start = 0 } = {}) {
    if (stageProgress.hideTimer) {
      clearTimeout(stageProgress.hideTimer);
      stageProgress.hideTimer = 0;
    }
    stageProgress.indeterminate = false;
    stageProgress.value = Math.max(0, Math.min(1, Number(start) || 0));
    stageProgress.target = stageProgress.value;
    stageProgress.cap = Math.max(0.12, stageProgress.value);
    paintStageProgress();
    ensureStageProgressRunning();
  }

  function paintStageProgress() {
    const wrap = els.stageLoadingProgress;
    const fill = els.stageLoadingProgressFill;
    if (!wrap || !fill) return;
    wrap.dataset.mode = stageProgress.indeterminate ? 'indeterminate' : 'determinate';
    const pct = Math.round(Math.max(0, Math.min(1, stageProgress.value)) * 100);
    wrap.setAttribute('aria-valuenow', String(pct));
    if (!stageProgress.indeterminate) {
      fill.style.transform = `scaleX(${Math.max(0, Math.min(1, stageProgress.value))})`;
    }
  }

  function tickStageProgress(ts) {
    stageProgress.raf = requestAnimationFrame(tickStageProgress);
    const last = stageProgress.lastTs || ts;
    const dt = Math.min(64, Math.max(0, ts - last));
    stageProgress.lastTs = ts;
    if (stageProgress.indeterminate) return;

    const cap = Math.max(0, Math.min(1, stageProgress.cap));
    const hard = Math.max(0, Math.min(1, stageProgress.target));

    // Smooth continuous movement: creep toward cap even if hard target hasn't advanced.
    const creepPerMs = 0.00012; // ~12% per second max creep
    const creep = Math.min(cap, stageProgress.value + dt * creepPerMs);
    const desired = Math.max(Math.min(cap, hard), creep);

    // Exponential smoothing for "smooth" feel.
    const tau = 240; // ms
    const a = 1 - Math.exp(-dt / tau);
    stageProgress.value = stageProgress.value + (desired - stageProgress.value) * a;

    // Clamp and paint.
    if (Math.abs(stageProgress.value - desired) < 0.0006) stageProgress.value = desired;
    paintStageProgress();
  }

  function ensureStageProgressRunning() {
    if (stageProgress.raf) return;
    stageProgress.lastTs = 0;
    stageProgress.raf = requestAnimationFrame(tickStageProgress);
  }

  function setStageLoadingProgress(p, { indeterminate = false, cap = null } = {}) {
    const wrap = els.stageLoadingProgress;
    const fill = els.stageLoadingProgressFill;
    if (!wrap || !fill) return;

    if (stageProgress.hideTimer) {
      clearTimeout(stageProgress.hideTimer);
      stageProgress.hideTimer = 0;
    }

    stageProgress.indeterminate = !!indeterminate;
    if (cap != null && isFinite(cap)) stageProgress.cap = Math.max(stageProgress.value, Math.max(0, Math.min(1, Number(cap))));

    if (stageProgress.indeterminate || p == null || !isFinite(p)) {
      paintStageProgress();
      return;
    }

    const clamped = Math.max(0, Math.min(1, Number(p)));
    stageProgress.target = Math.max(stageProgress.target, clamped);
    stageProgress.cap = Math.max(stageProgress.cap, stageProgress.target);
    ensureStageProgressRunning();
    paintStageProgress();
  }

  function setStageDemReady(ready) {
    siteDemReady = !!ready;
    if (els.stage) els.stage.classList.toggle('dem-ready', siteDemReady);
    if (els.stageLoading) {
      els.stageLoading.setAttribute('aria-busy', siteDemReady ? 'false' : 'true');
    }
    if (!els.stageLoading) return;

    if (!siteDemReady) {
      els.stageLoading.classList.remove('hidden');
      return;
    }

    // Show 100% briefly before hiding, so it is visible.
    setStageLoadingProgress(1, { indeterminate: false, cap: 1 });
    stageProgress.hideTimer = window.setTimeout(() => {
      if (siteDemReady) els.stageLoading.classList.add('hidden');
    }, 260);
  }

  function removeNonSelectedLabels() {
    const keep = [];
    for (const item of labelItems) {
      if (item.kind === 'selected') {
        keep.push(item);
        continue;
      }
      item.el?.remove();
      item.line?.remove();
    }
    labelItems = keep;
    // No automatic "reactivation": if the active label was removed, clear it.
    if (activeLabelId && !labelItems.some(x => x.id === activeLabelId)) {
      activeLabelId = null;
      previewNotesSite = null;
      notesActionItem = null;
      setActiveLabelById(null);
      updateNotesPanel();
      updateNotesActions();
    }
    closeLabelPopup();
  }

  function setActiveLabelById(id) {
    activeLabelId = id || null;
    for (const item of labelItems) {
      if (!item?.el) continue;
      item.el.classList.toggle('active', !!(id && item.id === id));
    }
  }

  function rebuildAllLabelsFromShownMarkers() {
    // This is the wiring you have been asking for:
    // "Show All Labels" labels ONLY the monuments that are currently being shown as markers.
    // If no relational marker modes are enabled, we show no extra labels (selected site still shows).
    removeNonSelectedLabels();
    if (!showAllLabels) return;

    const wantType = !!showRelatedMonuments;
    const wantAll = !!showAllRelational;
    const wantMon = !!showAllMonuments;
    if (!wantType && !wantAll && !wantMon) return;

    const selectedSmr = normSmr(selectedSite?.smr || '');

    const addFor = (prefix, list) => {
      for (const m of (Array.isArray(list) ? list : [])) {
        const a = m?.props || {};
        const lat = m?.lat;
        const lng = m?.lng;
        if (!isFinite(lat) || !isFinite(lng)) continue;
        const thisSmr = normSmr(a.SMRS || '');
        if (selectedSmr && thisSmr && thisSmr === selectedSmr) continue;
        if (selectedSite && isFinite(selectedSite.lat) && isFinite(selectedSite.lng)) {
          if (distanceMeters(selectedSite.lat, selectedSite.lng, lat, lng) < 6) continue;
        }
        const stableId = monumentStableKey(a, lng, lat);
        addFlatLabel({
          id: `${prefix}-${stableId}`,
          className: 'nms',
          kind: 'all',
          local: m.local,
          lat,
          lng,
          props: a,
          text: markerLabelText(a),
          detail: markerLabelDetail(a)
        });
      }
    };

    if (wantType) addFor('alltype', relatedMarkers);
    if (wantAll) addFor('allrel', relationalMarkers);
    if (wantMon) addFor('allmon', allMonumentMarkers);
  }

  function syncShowAllLabelsState() {
    // Invariant: "Show All Labels" only makes sense when at least one relational marker mode is on.
    // If both relational toggles are off, auto-turn it off (UI + state) and clear extra labels.
    if (!els.showAllLabels) return;
    const hasSources = !!showRelatedMonuments || !!showAllRelational || !!showAllMonuments;
    if (showAllLabels && !hasSources) {
      els.showAllLabels.checked = false;
      // Drive through the normal handler so toolbar + sidebar stay consistent.
      els.showAllLabels.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (showAllLabels) rebuildAllLabelsFromShownMarkers();
  }

  if (els.notesBgToggle && els.notesInline) {
    els.notesBgToggle.addEventListener('click', () => {
      notesBackgroundOn = !notesBackgroundOn;
      els.notesInline.classList.toggle('with-bg', notesBackgroundOn);
      // Keep slider in sync (0 === background off)
      const a = notesBackgroundOn ? (overlayAlphaLastNonZero || 0.40) : 0;
      overlayAlpha = a;
      if (a > 0) overlayAlphaLastNonZero = a;
      document.documentElement.style.setProperty('--tour-overlay-alpha', String(overlayAlpha));
      if (els.overlayOpacity) els.overlayOpacity.value = String(overlayAlpha);
      if (els.overlayOpacityValue) els.overlayOpacityValue.textContent = overlayAlpha <= 0 ? 'Off' : `${Math.round(overlayAlpha * 100)}%`;
    });
  }
  if (els.notesClose && els.showNotes) {
    els.notesClose.addEventListener('click', () => {
      els.showNotes.checked = false;
      updateNotesPanel();
    });
  }

  function sameMonumentAsSelected(props, lat, lng) {
    const a = normSmr(props?.SMRS || props?.SMR || props?.SMR_NO || '');
    const b = normSmr(selectedSite?.smr || selectedSite?.props?.SMRS || '');
    if (a && b && a === b) return true;
    if (selectedSite && isFinite(selectedSite.lat) && isFinite(selectedSite.lng) && isFinite(lat) && isFinite(lng)) {
      return distanceMeters(selectedSite.lat, selectedSite.lng, lat, lng) < 6;
    }
    return false;
  }

  function updateNotesActions() {
    if (els.notesView) els.notesView.disabled = true;
    if (els.notesMore) els.notesMore.disabled = true;
    if (els.notesOpenGmaps) els.notesOpenGmaps.disabled = true;
    if (els.notesOpenNms) els.notesOpenNms.disabled = true;
    if (els.copyLat) els.copyLat.disabled = true;
    if (els.copyLon) els.copyLon.disabled = true;
    if (!els.showNotes || !els.showNotes.checked) return;
    if (!notesActionItem) return;
    if (els.notesMore) els.notesMore.disabled = false;
    const p = notesActionItem.props || {};
    const lat = isFinite(notesActionItem.lat) ? Number(notesActionItem.lat) : (isFinite(p.LATITUDE) ? Number(p.LATITUDE) : NaN);
    const lng = isFinite(notesActionItem.lng) ? Number(notesActionItem.lng) : (isFinite(p.LONGITUDE) ? Number(p.LONGITUDE) : NaN);
    if (els.notesView) els.notesView.disabled = sameMonumentAsSelected(p, lat, lng);
    if (els.notesOpenGmaps) els.notesOpenGmaps.disabled = !(isFinite(lat) && isFinite(lng));
    if (els.copyLat) els.copyLat.disabled = !isFinite(lat);
    if (els.copyLon) els.copyLon.disabled = !isFinite(lng);
    if (els.notesOpenNms) {
      const url = safeUrlFromProps(p);
      els.notesOpenNms.disabled = !url;
    }
  }

  if (els.notesMore) {
    els.notesMore.addEventListener('click', (e) => {
      e.stopPropagation();
      notesDetailsOpen = !notesDetailsOpen;
      updateNotesPanel();
    });
  }

  if (els.notesOpenGmaps) {
    els.notesOpenGmaps.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!notesActionItem) return;
      const p = notesActionItem.props || {};
      const lat = isFinite(notesActionItem.lat) ? Number(notesActionItem.lat) : (isFinite(p.LATITUDE) ? Number(p.LATITUDE) : NaN);
      const lng = isFinite(notesActionItem.lng) ? Number(notesActionItem.lng) : (isFinite(p.LONGITUDE) ? Number(p.LONGITUDE) : NaN);
      if (!isFinite(lat) || !isFinite(lng)) return;
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
      window.open(url, '_blank', 'noopener');
    });
  }

  if (els.notesOpenNms) {
    els.notesOpenNms.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!notesActionItem) return;
      const url = safeUrlFromProps(notesActionItem.props || {});
      if (!url) return;
      window.open(url, '_blank', 'noopener');
    });
  }

  const copyText = async (text) => {
    const value = String(text || '');
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      ta.remove();
      return ok;
    }
  };

  function showCopiedPop(anchor, text = 'Copied !') {
    document.querySelectorAll('.copied-pop').forEach(el => el.remove());
    const stageRect = els.stage?.getBoundingClientRect?.() || { left: 0, top: 0, width: window.innerWidth };
    const pop = document.createElement('div');
    pop.className = 'copied-pop';
    pop.textContent = text;
    document.body.appendChild(pop);
    pop.style.left = `${stageRect.left + stageRect.width / 2}px`;
    pop.style.top = `${stageRect.top + 70}px`;
    requestAnimationFrame(() => pop.classList.add('show'));
    window.setTimeout(() => {
      pop.classList.remove('show');
      window.setTimeout(() => pop.remove(), 160);
    }, 900);
  }

  if (els.copyLat) {
    els.copyLat.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!notesActionItem) return;
      const p = notesActionItem.props || {};
      const lat = isFinite(notesActionItem.lat) ? Number(notesActionItem.lat) : (isFinite(p.LATITUDE) ? Number(p.LATITUDE) : NaN);
      if (!isFinite(lat)) return;
      await copyText(String(lat));
      showCopiedPop(e.currentTarget);
    });
  }
  if (els.copyLon) {
    els.copyLon.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!notesActionItem) return;
      const p = notesActionItem.props || {};
      const lng = isFinite(notesActionItem.lng) ? Number(notesActionItem.lng) : (isFinite(p.LONGITUDE) ? Number(p.LONGITUDE) : NaN);
      if (!isFinite(lng)) return;
      await copyText(String(lng));
      showCopiedPop(e.currentTarget);
    });
  }

  if (els.notesView) {
    els.notesView.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!notesActionItem) return;
      const p = notesActionItem.props || {};
      const lat = isFinite(notesActionItem.lat) ? Number(notesActionItem.lat) : (isFinite(p.LATITUDE) ? Number(p.LATITUDE) : NaN);
      const lng = isFinite(notesActionItem.lng) ? Number(notesActionItem.lng) : (isFinite(p.LONGITUDE) ? Number(p.LONGITUDE) : NaN);
      if (!isFinite(lat) || !isFinite(lng)) return;
      if (sameMonumentAsSelected(p, lat, lng)) return;
      const smr = String(p.SMRS || p.SMR || p.SMR_NO || p.OBJECTID || notesActionItem.id || '').trim();
      const townland = String(p.TOWNLAND || '').trim();
      const county = String(p.COUNTY || '').trim();
      await goToSite({ id: smr || `ll-${lat},${lng}`, smr, townland, county, lat, lng, props: p });
    });
  }

  if (els.legendBgToggle && els.legendInline) {
    els.legendBgToggle.addEventListener('click', () => {
      legendBackgroundOn = !legendBackgroundOn;
      els.legendInline.classList.toggle('with-bg', legendBackgroundOn);
      const a = legendBackgroundOn ? (overlayAlphaLastNonZero || 0.40) : 0;
      overlayAlpha = a;
      if (a > 0) overlayAlphaLastNonZero = a;
      document.documentElement.style.setProperty('--tour-overlay-alpha', String(overlayAlpha));
      if (els.overlayOpacity) els.overlayOpacity.value = String(overlayAlpha);
      if (els.overlayOpacityValue) els.overlayOpacityValue.textContent = overlayAlpha <= 0 ? 'Off' : `${Math.round(overlayAlpha * 100)}%`;
    });
  }
  if (els.legendClose && els.showLegend) {
    els.legendClose.addEventListener('click', () => {
      els.showLegend.checked = false;
      updateLegendPanel();
    });
  }
  if (els.showLegend) {
    els.showLegend.addEventListener('change', () => updateLegendPanel());
  }

  // Display Visibility (overlay background opacity for notes + legend)
  if (els.overlayOpacity) {
    // Init CSS var + label.
    overlayAlpha = Math.max(0, Math.min(1, Number(els.overlayOpacity.value)));
    if (overlayAlpha > 0) overlayAlphaLastNonZero = overlayAlpha;
    document.documentElement.style.setProperty('--tour-overlay-alpha', String(overlayAlpha));
    if (els.overlayOpacityValue) els.overlayOpacityValue.textContent = overlayAlpha <= 0 ? 'Off' : `${Math.round(overlayAlpha * 100)}%`;

    els.overlayOpacity.addEventListener('input', () => {
      overlayAlpha = Math.max(0, Math.min(1, Number(els.overlayOpacity.value)));
      if (overlayAlpha > 0) overlayAlphaLastNonZero = overlayAlpha;
      document.documentElement.style.setProperty('--tour-overlay-alpha', String(overlayAlpha));
      if (els.overlayOpacityValue) els.overlayOpacityValue.textContent = overlayAlpha <= 0 ? 'Off' : `${Math.round(overlayAlpha * 100)}%`;

      // 0 means "background off" like your current toggle behavior.
      const on = overlayAlpha > 0;
      notesBackgroundOn = on;
      legendBackgroundOn = on;
      els.notesInline?.classList.toggle('with-bg', on);
      els.legendInline?.classList.toggle('with-bg', on);
    });
  }

  const scene = new THREE.Scene();
  // Keep the near terrain crisp: push atmospheric fade far out.
  scene.background = new THREE.Color(0xbfe3ff);
  scene.fog = new THREE.Fog(0xd6efff, 14000, 52000);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(els.container.clientWidth, els.container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  els.container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 25000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-1200, 2400, 900);
  scene.add(sun);

  let skyDome = null;
  addSkyDome();
  markerGroup = new THREE.Group();
  scene.add(markerGroup);

  function addSkyDome() {
    if (skyDome) {
      scene.remove(skyDome);
      skyDome.geometry.dispose();
      skyDome.material.dispose();
      skyDome = null;
    }

    const uniforms = {
      topColor: { value: new THREE.Color('#1e5bd6') },
      midColor: { value: new THREE.Color('#6fb7ff') },
      hazeColor: { value: new THREE.Color('#eaf6ff') },
      bottomColor: { value: new THREE.Color('#ffffff') },
      // Controls where the haze band sits. Higher = haze pulled further down.
      hazeStart: { value: -0.08 },
      hazeEnd: { value: 0.32 },
      // Controls contrast above haze.
      exponent: { value: 1.35 }
    };

    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms,
      vertexShader: `
        varying vec3 vWorldDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(worldPos.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vWorldDir;
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 hazeColor;
        uniform vec3 bottomColor;
        uniform float hazeStart;
        uniform float hazeEnd;
        uniform float exponent;

        float hash12(vec2 p) {
          vec3 p3  = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          // y is -1..1. Horizon ~0. We want a strong haze band around horizon.
          float y = clamp(vWorldDir.y, -1.0, 1.0);

          // Base vertical blend from bottom->top
          float t = pow(clamp((y + 1.0) * 0.5, 0.0, 1.0), exponent);
          vec3 col = mix(bottomColor, topColor, t);

          // Mid-sky tint (adds more visible change at typical pitch)
          float midT = smoothstep(0.08, 0.62, (y + 1.0) * 0.5);
          col = mix(col, midColor, midT * 0.55);

          // Horizon haze band: pulled down so horizon sits ~1/3 from top with visible gradient.
          float hazeT = smoothstep(hazeStart, hazeEnd, y);
          col = mix(hazeColor, col, hazeT);

          // Subtle dither to avoid banding.
          float n = (hash12(gl_FragCoord.xy) - 0.5) * (1.0/255.0) * 8.0;
          col += n;

          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    skyDome = new THREE.Mesh(new THREE.SphereGeometry(18000, 64, 32), mat);
    skyDome.frustumCulled = false;
    skyDome.onBeforeRender = function (_r, _s, cam) {
      // Keep the sky centered on the camera so it reads like an atmosphere.
      this.position.copy(cam.position);
    };
    scene.add(skyDome);
  }

  function tileUrl(template, z, x, y) {
    const s = Math.abs((x + y + z) % 4);
    return template
      .replace('{s}', String(s))
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
  }

  function lonLatToTile(lon, lat, z) {
    const n = 2 ** z;
    const latRad = lat * Math.PI / 180;
    return {
      x: n * ((lon + 180) / 360),
      y: n * (1 - (Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2
    };
  }

  function tileToLonLat(x, y, z) {
    const n = 2 ** z;
    const lon = x / n * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
    return { lon, lat };
  }

  function metersPerPixel(lat, z) {
    return (40075016.686 * Math.cos(lat * Math.PI / 180)) / (TILE_SIZE * (2 ** z));
  }

  function terrainTileCount() {
    return demAreaKey === 'double' ? TERRAIN_TILE_COUNT_DOUBLE : TERRAIN_TILE_COUNT;
  }

  function terrainGridSize(count) {
    return Math.round(GRID * (count / TERRAIN_TILE_COUNT));
  }

  function aerialZoomForTileCount(count) {
    const requestedScale = 2 ** (AERIAL_Z - TERRAIN_Z);
    const requestedTexturePx = count * requestedScale * TILE_SIZE;
    return requestedTexturePx <= renderer.capabilities.maxTextureSize ? AERIAL_Z : TERRAIN_Z;
  }

  function offsetLonLat(lat, lng, eastM, northM) {
    const lat2 = lat + (northM / 111320);
    const lon2 = lng + (eastM / (111320 * Math.max(0.15, Math.cos(lat * Math.PI / 180))));
    return { lat: lat2, lng: lon2 };
  }

  function rangeText(meters) {
    const km = Math.round(Math.max(0, Number(meters) || 0) / 1000);
    return `${km} km`;
  }

  function currentQueryEnvelope(extraMeters = 0) {
    if (!currentPatch) return null;
    const focus = currentPatch.focus || currentFocus || selectedSite || currentPatch.site;
    if (!focus || !isFinite(focus.lat) || !isFinite(focus.lng)) return null;
    const half = Math.max(0, (currentPatch.patchMeters || 0) / 2);
    const r = half + Math.max(0, Number(extraMeters) || 0);
    const nw = offsetLonLat(focus.lat, focus.lng, -r, r);
    const se = offsetLonLat(focus.lat, focus.lng, r, -r);
    return { nw, se };
  }

  function loadImage(url, crossOrigin = 'anonymous') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = crossOrigin;
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed image: ${url}`));
      img.src = url;
    });
  }

  function sqlQuote(value) {
    return String(value || '').replace(/'/g, "''");
  }

  function sqlLike(field, value) {
    return `${field} LIKE '%${sqlQuote(value)}%'`;
  }

  function sourceUrl(sourceId) {
    return sourceId === MONUMENT_SOURCE_NI ? NMS_NI_HED_URL : NMS_ROI_SMR_URL;
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
    if (!hay) return { monumentClass: '', certainty: '', condition: '' };

    let monumentClass = '';
    if (/\bPASSAGE TOMB\b/.test(hay)) monumentClass = 'Megalithic tomb - passage tomb';
    else if (/\bCOURT TOMB\b/.test(hay)) monumentClass = 'Megalithic tomb - court tomb';
    else if (/\bPORTAL TOMB\b/.test(hay)) monumentClass = 'Megalithic tomb - portal tomb';
    else if (/\bWEDGE TOMB\b/.test(hay)) monumentClass = 'Megalithic tomb - wedge tomb';
    else if (/\bMEGALITHIC TOMB\b/.test(hay)) monumentClass = 'Megalithic tomb - unclassified';
    else if (/\bBOWL BARROW\b/.test(hay)) monumentClass = 'Barrow - bowl-barrow';
    else if (/\bRING BARROW\b|\bRING DITCH\b/.test(hay)) monumentClass = 'Barrow - ring-barrow';
    else if (/\bMOUND BARROW\b|\bMOUND\b/.test(hay) && /\bBARROW\b/.test(hay)) monumentClass = 'Barrow - mound barrow';
    else if (/\bBARROW\b/.test(hay)) monumentClass = 'Barrow - unclassified';
    else if (/\bBOULDER BURIAL\b/.test(hay)) monumentClass = 'Boulder-burial';
    else if (/\bSTONE CIRCLE\b/.test(hay)) monumentClass = 'Stone circle';
    else if (/\bSTANDING STONE PAIR\b|\bPAIR OF STANDING STONES\b|\bSTANDING STONES\b.*\bPAIR\b/.test(hay)) monumentClass = 'Standing stone - pair';
    else if (/\bSTANDING STONE\b/.test(hay)) monumentClass = 'Standing stone';
    else if (/\bSTONE ROW\b|\bSTONE ALIGNMENT\b/.test(hay)) monumentClass = 'Stone row';
    else if (/\bHENGE\b/.test(hay)) monumentClass = 'Henge';
    else if (/\bCAIRN\b/.test(hay)) monumentClass = 'Cairn - unclassified';
    else if (/\bCUP AND RING\b|\bCUP MARKED\b|\bROCK ART\b/.test(hay)) monumentClass = 'Rock art';
    else if (/\bCURSUS\b/.test(hay)) monumentClass = 'Cursus';
    else if (/\bEMBANKED ENCLOSURE\b/.test(hay)) monumentClass = 'Embanked enclosure';
    else if (/\bCEREMONIAL ENCLOSURE\b|\bPREHISTORIC RITUAL COMPLEX\b/.test(hay)) monumentClass = 'Ceremonial enclosure';
    else monumentClass = titleCaseWords(general || edited);

    const certainty = /\bPOSSIBLE\b|\bPROBABLE\b|\bUNCERTAIN\b/.test(hay) ? 'Possible/uncertain' : 'Recorded';
    const condition = /\bDESTROYED\b/.test(hay) ? 'Destroyed'
      : /\bREMAINS OF\b|\bREMAINS\b/.test(hay) ? 'Remains'
      : /\bUNLOCATED\b/.test(hay) ? 'Unlocated'
      : '';
    return { monumentClass, certainty, condition };
  }

  function whereForNiType(monumentClass) {
    const cls = String(monumentClass || '').trim();
    const general = 'General_Type';
    const edited = 'Edited_Type';
    const megalithicSpecific = [
      sqlLike(edited, 'PASSAGE TOMB'),
      sqlLike(edited, 'COURT TOMB'),
      sqlLike(edited, 'PORTAL TOMB'),
      sqlLike(edited, 'WEDGE TOMB')
    ].join(' OR ');

    if (cls === 'Megalithic tomb - passage tomb') return sqlLike(edited, 'PASSAGE TOMB');
    if (cls === 'Megalithic tomb - court tomb') return sqlLike(edited, 'COURT TOMB');
    if (cls === 'Megalithic tomb - portal tomb') return sqlLike(edited, 'PORTAL TOMB');
    if (cls === 'Megalithic tomb - wedge tomb') return sqlLike(edited, 'WEDGE TOMB');
    if (cls === 'Megalithic tomb - unclassified') return `(${general} = 'MEGALITHIC TOMB' OR ${sqlLike(edited, 'MEGALITHIC TOMB')}) AND NOT (${megalithicSpecific})`;
    if (cls === 'Barrow - bowl-barrow') return sqlLike(edited, 'BOWL BARROW');
    if (cls === 'Barrow - ring-barrow') return `(${sqlLike(edited, 'RING BARROW')} OR ${sqlLike(general, 'RING DITCH')})`;
    if (cls === 'Barrow - mound barrow') return `(${sqlLike(edited, 'MOUND BARROW')} OR (${sqlLike(edited, 'MOUND')} AND ${sqlLike(edited, 'BARROW')}))`;
    if (cls === 'Barrow - unclassified') return `(${general} = 'BARROW' OR ${sqlLike(edited, 'BARROW')})`;
    if (cls === 'Boulder-burial') return sqlLike(edited, 'BOULDER BURIAL');
    if (cls === 'Stone circle') return `(${general} = 'STONE CIRCLE' OR ${sqlLike(edited, 'STONE CIRCLE')})`;
    if (cls === 'Standing stone - pair') return `(${sqlLike(edited, 'STANDING STONE PAIR')} OR ${sqlLike(edited, 'PAIR OF STANDING STONES')})`;
    if (cls === 'Standing stone') return `(${general} = 'STANDING STONE' OR ${sqlLike(edited, 'STANDING STONE')})`;
    if (cls === 'Stone row') return `(${general} = 'STONE ALIGNMENT' OR ${sqlLike(edited, 'STONE ROW')} OR ${sqlLike(edited, 'STONE ALIGNMENT')})`;
    if (cls === 'Henge') return `(${sqlLike(general, 'HENGE')} OR ${sqlLike(edited, 'HENGE')})`;
    if (cls === 'Cairn - unclassified') return `(${general} = 'CAIRN' OR ${sqlLike(edited, 'CAIRN')})`;
    if (cls === 'Rock art') return `(${sqlLike(edited, 'ROCK ART')} OR ${sqlLike(edited, 'CUP MARKED')} OR ${sqlLike(edited, 'CUP AND RING')})`;
    if (cls === 'Cursus') return `(${general} = 'CURSUS' OR ${sqlLike(edited, 'CURSUS')})`;
    if (cls === 'Embanked enclosure') return `(${general} = 'EMBANKMENT' OR ${sqlLike(edited, 'EMBANKED ENCLOSURE')})`;
    if (cls === 'Ceremonial enclosure') return `(${sqlLike(edited, 'CEREMONIAL ENCLOSURE')} OR ${sqlLike(general, 'PREHISTORIC RITUAL COMPLEX')})`;
    return '1=0';
  }

  function whereForSourceType(sourceId, monumentClass) {
    if (sourceId === MONUMENT_SOURCE_NI) return whereForNiType(monumentClass);
    const v = sqlQuote(monumentClass);
    return `MONUMENT_CLASS = '${v}'`;
  }

  function whereForSourceAllTypes(sourceId) {
    const vals = Array.from(selectedMonumentClasses.values()).map(v => String(v || '').trim()).filter(Boolean);
    if (!vals.length) return '1=0';
    if (sourceId === MONUMENT_SOURCE_NI) {
      const clauses = vals.map(whereForNiType).filter(w => w && w !== '1=0');
      return clauses.length ? `(${clauses.join(') OR (')})` : '1=0';
    }
    return `MONUMENT_CLASS IN (${vals.map(v => `'${sqlQuote(v)}'`).join(',')})`;
  }

  function whereForSourceAllMonuments(sourceId) {
    return sourceId === MONUMENT_SOURCE_NI ? 'SMRNo IS NOT NULL' : 'MONUMENT_CLASS IS NOT NULL';
  }

  function countyFromNiSmr(smr) {
    const prefix = String(smr || '').trim().match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
    const counties = {
      ANT: 'Antrim',
      ARM: 'Armagh',
      DOW: 'Down',
      FER: 'Fermanagh',
      LDY: 'Derry',
      LDR: 'Derry',
      TYR: 'Tyrone'
    };
    return counties[prefix] || '';
  }

  function nismrPublicUrlFromMonId(monId) {
    const id = String(monId || '').trim();
    if (!/^\d+$/.test(id)) return '';
    return `https://apps.communities-ni.gov.uk/NISMR-public/Details.aspx?MonID=${encodeURIComponent(id)}`;
  }

  function normalizeMonumentFeature(feature, sourceId) {
    const g = feature?.geometry || null;
    const raw = feature?.attributes || {};
    const a = { ...raw };
    if (sourceId === MONUMENT_SOURCE_NI) {
      const edited = String(raw.Edited_Type || raw.Edited_Typ || '').trim();
      const general = String(raw.General_Type || raw.General_Ty || '').trim();
      const period = String(raw.General_Period || raw.General_Pe || '').trim();
      const classification = classifyNiMonument(raw);
      const council = String(raw.Council || '').trim();
      const monId = String(raw.MONID || '').trim();
      const smr = String(raw.SMRNo || monId || raw.OBJECTID || '').trim();
      const county = countyFromNiSmr(smr);
      const publicUrl = nismrPublicUrlFromMonId(monId);
      const sourceNotes = [
        edited ? `Edited Type: ${edited}` : '',
        general ? `General Type: ${general}` : '',
        period ? `Period: ${period}` : '',
        classification.certainty ? `Certainty: ${classification.certainty}` : '',
        classification.condition ? `Condition: ${classification.condition}` : '',
        county ? `County: ${county}` : '',
        council ? `Council: ${titleCaseWords(council)}` : '',
        raw.Protection ? `Protection: ${String(raw.Protection).trim()}` : '',
        raw.Located ? `Located: ${String(raw.Located).trim()}` : ''
      ].filter(Boolean).join('\n');
      a.SOURCE = 'NI HED';
      a.RAW_EDITED_TYPE = edited;
      a.RAW_GENERAL_TYPE = general;
      a.RAW_GENERAL_PERIOD = period;
      a.MONUMENT_CLASS = classification.monumentClass;
      a.CATEGORY_CERTAINTY = classification.certainty;
      a.CONDITION = classification.condition;
      a.TOWNLAND = String(raw.Townland_s_ || raw.Townland_s || '').trim();
      a.COUNTY = county;
      a.COUNCIL = council;
      a.MONID = monId || raw.MONID;
      a.SMRS = smr;
      a.WEBSITE_LINK = publicUrl;
      a.NISMR_PUBLIC_LINK = publicUrl;
      a.WEB_NOTES = sourceNotes || edited || general;
    } else {
      a.SOURCE = a.SOURCE || 'NMS ROI';
    }
    if (g && isFinite(g.y)) a.LATITUDE = g.y;
    if (g && isFinite(g.x)) a.LONGITUDE = g.x;
    return { geometry: g, attributes: a };
  }

  async function fetchArcgisFeaturesFromSource(sourceId, { where, envelope = null, pageSize = 2000, maxFeatures = 12000 } = {}) {
    const collected = [];
    let resultOffset = 0;
    while (collected.length < maxFeatures) {
      const take = Math.min(pageSize, maxFeatures - collected.length);
      const params = new URLSearchParams({
        f: 'json',
        where: where || '1=1',
        returnGeometry: 'true',
        outFields: '*',
        outSR: '4326',
        resultRecordCount: String(take),
        resultOffset: String(resultOffset)
      });
      if (envelope) {
        params.set('inSR', '4326');
        params.set('geometryType', 'esriGeometryEnvelope');
        params.set('spatialRel', 'esriSpatialRelIntersects');
        params.set('geometry', `${envelope.nw.lng},${envelope.se.lat},${envelope.se.lng},${envelope.nw.lat}`);
      }
      const res = await fetch(`${sourceUrl(sourceId)}/query?${params.toString()}`);
      const json = await res.json();
      if (json && json.error) {
        const msg = json.error?.message || 'ArcGIS query failed.';
        const details = Array.isArray(json.error?.details) ? json.error.details.join(' ') : '';
        throw new Error(`${msg}${details ? ` ${details}` : ''}`);
      }
      const features = Array.isArray(json.features) ? json.features : [];
      collected.push(...features.map(f => normalizeMonumentFeature(f, sourceId)));
      if (features.length < take) break;
      resultOffset += features.length;
    }
    return collected;
  }

  async function fetchAllMonumentsInEnvelope(env, maxFeatures = 12000) {
    const batches = await Promise.all([MONUMENT_SOURCE_ROI, MONUMENT_SOURCE_NI].map((sourceId) => (
      fetchArcgisFeaturesFromSource(sourceId, {
        where: whereForSourceAllMonuments(sourceId),
        envelope: env,
        maxFeatures
      })
    )));
    return batches.flat();
  }

  function monumentStableKey(props, lng, lat) {
    const p = props || {};
    return [p.SOURCE || 'src', p.SMRS || p.SMR_NO || p.SMR || p.OBJECTID || p.OID || p.FID || `${lng},${lat}`].filter(Boolean).join(':');
  }

  function safeUrlFromProps(props) {
    const p = props || {};
    const candidates = [
      // Prefer explicit NMS field (as requested)
      p.WEBSITE_LINK, p.website_link, p.Website_Link,
      // Legacy fallbacks / alternate schemas
      p.WEB_LINK, p.WEBLINK, p.WEB_URL, p.WEBURL, p.WEB, p.URL, p.LINK, p.WEBPAGE
    ].map(v => String(v || '').trim()).filter(Boolean);
    const raw = candidates[0] || '';
    const url = candidates.find(u => /^https?:\/\//i.test(u)) || (raw && /^www\./i.test(raw) ? `https://${raw}` : '');
    return url || '';
  }

  function buildPropsTableHtml(props, excludeKeys = new Set()) {
    const p = props || {};
    const rows = [];
    const keys = Object.keys(p).sort((a, b) => a.localeCompare(b));
    for (const k of keys) {
      if (excludeKeys.has(k)) continue;
      const v = p[k];
      if (v == null) continue;
      const s = String(v).trim();
      if (!s) continue;
      rows.push(`<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(s)}</td></tr>`);
      if (rows.length >= 40) break;
    }
    if (!rows.length) return '';
    return `<table class="notes-detail-table">${rows.join('')}</table>`;
  }

  function colorForMonumentClass(monumentClass) {
    const key = String(monumentClass || '').trim();
    const spec = specByMonumentClass.get(key);
    return spec?.a || '#9333ea';
  }

  function shortName(s) {
    const v = String(s || '').trim();
    if (!v) return v;
    const iComma = v.indexOf(',');
    const iParen = v.indexOf('(');
    const iSemi = v.indexOf(';');
    let cut = v.length;
    if (iComma >= 0) cut = Math.min(cut, iComma);
    if (iParen >= 0) cut = Math.min(cut, iParen);
    if (iSemi >= 0) cut = Math.min(cut, iSemi);
    return v.slice(0, cut).trim();
  }

  function titleCaseWords(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return raw;

    const cap = (s) => (s ? (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()) : s);
    const capHyphen = (s) => s.split('-').map(cap).join('-');
    const capApos = (s) => s.split("'").map(capHyphen).join("'");

    // Preserve spaces, title-case each word-like segment.
    return raw
      .toLowerCase()
      .split(/\s+/g)
      .map(capApos)
      .join(' ')
      .trim();
  }

  function updateNotesPanel() {
    if (!els.notesInline || !els.showNotes) return;
    if (!siteDemReady) {
      els.notesInline.classList.add('hidden');
      if (els.notesInlineText) els.notesInlineText.textContent = '';
      else els.notesInline.textContent = '';
      if (els.notesInlineDetails) els.notesInlineDetails.classList.add('hidden');
      updateNotesActions();
      return;
    }
    const on = !!els.showNotes.checked;
    // Notes are tied to the ACTIVE label (not merely the selected site).
    // This ensures hiding/deselecting the active label also hides notes.
    const activeItem = activeLabelId ? (labelItems.find(x => x.id === activeLabelId) || null) : null;
    const props = activeItem?.props || null;
    const notes = props?.WEB_NOTES ? String(props.WEB_NOTES).trim() : '';
    if (!on || !activeItem || !notes) {
      els.notesInline.classList.add('hidden');
      if (els.notesInlineText) els.notesInlineText.textContent = '';
      else els.notesInline.textContent = '';
      if (els.notesInlineDetails) els.notesInlineDetails.classList.add('hidden');
      updateNotesActions();
      return;
    }
    const townland = titleCaseWords(String(props?.TOWNLAND || props?.TOWNLAND_NAME || props?.TOWNLAND_N || '').trim());
    const mClass = String(props?.MONUMENT_CLASS || '').trim();
    const smr = String(props?.SMRS || props?.SMR_NO || props?.SMR || props?.OBJECTID || '').trim();
    const county = String(props?.COUNTY || '').trim();
    const headerLines = [
      townland ? `Townland: ${townland}` : '',
      mClass ? `Monument Type: ${mClass}` : '',
      smr ? `SMR: ${smr}` : '',
      county ? `County: ${county.toUpperCase()}` : ''
    ].filter(Boolean);
    const header = headerLines.join('\n');
    const body = `${header}\n\n${notes}`.trim();
    if (els.notesInlineText) els.notesInlineText.textContent = body;
    else els.notesInline.textContent = body;
    els.notesInline.classList.remove('hidden');
    els.notesInline.classList.toggle('with-bg', notesBackgroundOn);

    // Details section (lat/lon + table)
    const lat = Number(activeItem.lat);
    const lon = Number(activeItem.lng);
    if (els.notesLat) els.notesLat.textContent = isFinite(lat) ? lat.toFixed(6) : '--';
    if (els.notesLon) els.notesLon.textContent = isFinite(lon) ? lon.toFixed(6) : '--';
    if (els.notesDetailTableWrap) {
      const exclude = new Set(['WEB_NOTES', 'MONUMENT_CLASS', 'COUNTY', 'TOWNLAND', 'TOWNLAND_NAME', 'TOWNLAND_N', 'SMRS', 'SMR', 'SMR_NO', 'OBJECTID', 'OID', 'O_ID']);
      els.notesDetailTableWrap.innerHTML = buildPropsTableHtml(props, exclude);
    }
    if (els.notesInlineDetails) els.notesInlineDetails.classList.toggle('hidden', !notesDetailsOpen);
    if (els.notesMore) els.notesMore.setAttribute('aria-pressed', notesDetailsOpen ? 'true' : 'false');
    updateNotesActions();
  }

  function updateLegendPanel() {
    if (!els.legendInline || !els.legendInlineList || !els.showLegend) return;
    if (!siteDemReady) {
      els.legendInline.classList.add('hidden');
      els.legendInlineList.replaceChildren();
      return;
    }
    const on = !!els.showLegend.checked;
    if (!on || !currentPatch) {
      els.legendInline.classList.add('hidden');
      els.legendInlineList.replaceChildren();
      return;
    }

    const set = new Map(); // mClass -> true

    for (const item of labelItems) {
      const mClass = String(item.props?.MONUMENT_CLASS || item.props?.monumentClass || '').trim();
      if (!mClass) continue;
      if (!set.has(mClass)) set.set(mClass, true);
    }

    for (const m of relationalMarkers) {
      const mClass = String(m.props?.MONUMENT_CLASS || '').trim();
      if (!mClass) continue;
      if (!set.has(mClass)) set.set(mClass, true);
    }

    for (const m of relatedMarkers) {
      const mClass = String(m.props?.MONUMENT_CLASS || '').trim();
      if (!mClass) continue;
      if (!set.has(mClass)) set.set(mClass, true);
    }

    for (const m of allMonumentMarkers) {
      const mClass = String(m.props?.MONUMENT_CLASS || '').trim();
      if (!mClass) continue;
      if (!set.has(mClass)) set.set(mClass, true);
    }

    const entries = Array.from(set.keys()).sort((a, b) => a.localeCompare(b));
    els.legendInlineList.replaceChildren();
    for (const mClass of entries) {
      const row = document.createElement('div');
      row.className = 'legend-item';
      row.innerHTML = `<span class="megicon megicon--sm"></span><span class="legend-name">${escapeHtml(mClass)}</span>`;
      const wrap = row.querySelector('.megicon');
      renderMegIconInto(wrap, mClass, TOUR_LIST_ICON_SIZE);
      els.legendInlineList.appendChild(row);
    }

    els.legendInline.classList.remove('hidden');
    els.legendInline.classList.toggle('with-bg', legendBackgroundOn);
  }

  function renderTypeList() {
    if (!els.typeList) return;
    els.typeList.innerHTML = '';
    const types = Array.from(selectedMonumentClasses.values()).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
    for (const monumentClass of types) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `type-item${activeType === monumentClass ? ' active' : ''}`;
      const iconWrap = document.createElement('span');
      iconWrap.className = 'megicon megicon--sm';
      // Render a unique SVG instance to avoid mask-id collisions.
      renderMegIconInto(iconWrap, monumentClass, TOUR_LIST_ICON_SIZE);
      const text = document.createElement('span');
      text.className = 'text';
      text.innerHTML = `<span class="name">${escapeHtml(monumentClass)}</span>`;
      btn.appendChild(iconWrap);
      btn.appendChild(text);
      btn.addEventListener('click', () => selectType(monumentClass));
      els.typeList.appendChild(btn);
    }
  }

  async function loadSitesForType(monumentClass) {
    if (!els.siteList) return;
    els.siteList.innerHTML = `<div class="status">Loading sites for: ${escapeHtml(monumentClass)}…</div>`;

    const collected = [];

    for (const sourceId of [MONUMENT_SOURCE_ROI, MONUMENT_SOURCE_NI]) {
      const where = whereForSourceType(sourceId, monumentClass);
      if (!where || where === '1=0') continue;
      const features = await fetchArcgisFeaturesFromSource(sourceId, { where, maxFeatures: 20000 });
      for (const f of features) {
        const g = f.geometry;
        const a = f.attributes || {};
        if (!g || !isFinite(g.x) || !isFinite(g.y)) continue;
        if (String(a.MONUMENT_CLASS || '').trim() !== String(monumentClass || '').trim()) continue;
        const smr = String(a.SMRS || a.SMR || a.SMR_NO || a.OBJECTID || '').trim();
        const townland = String(a.TOWNLAND || a.TOWNLAND_NAME || a.TOWNLAND_N || '').trim();
        const county = String(a.COUNTY || a.COUNTYNAME || '').trim();
        collected.push({
          id: monumentStableKey(a, g.x, g.y),
          smr,
          townland,
          county,
          lat: g.y,
          lng: g.x,
          props: a
        });
      }
    }

    collected.sort((x, y) => {
      const a = (x.townland || '').localeCompare(y.townland || '');
      if (a !== 0) return a;
      return (x.smr || '').localeCompare(y.smr || '');
    });

    sites = collected;
    renderSites();
  }

  function setPanelOpen(key, open) {
    const body = document.querySelector(`[data-panel-body=\"${key}\"]`);
    const icon = document.querySelector(`[data-panel-action=\"${key}-toggle\"] i`);
    if (!body) return;
    if (open) body.classList.remove('hidden');
    else body.classList.add('hidden');
    if (icon) {
      if (key === 'config' || key === 'presets' || key === 'saved-views' || key === 'about') icon.className = open ? 'ph-bold ph-caret-up' : 'ph-bold ph-caret-down';
      else icon.className = open ? 'ph-bold ph-minus' : 'ph-bold ph-plus';
    }
  }

  async function selectType(monumentClass) {
    activeType = String(monumentClass || '').trim() || null;
    renderTypeList();
    if (els.typesPanelTitle) els.typesPanelTitle.textContent = activeType || 'Monument Types';
    if (els.sitesPanelTitle) els.sitesPanelTitle.textContent = activeType || 'Sites';
    // Header icons (use megicon at the same size as list items).
    if (els.typesTypeDot) {
      els.typesTypeDot.classList.add('megicon', 'megicon--sm');
      els.typesTypeDot.style.display = activeType ? 'inline-flex' : 'none';
      if (activeType) renderMegIconInto(els.typesTypeDot, activeType, TOUR_LIST_ICON_SIZE);
      else els.typesTypeDot.innerHTML = '';
    }
    if (els.sitesTypeDot) {
      els.sitesTypeDot.classList.add('megicon', 'megicon--sm');
      els.sitesTypeDot.style.display = activeType ? 'inline-flex' : 'none';
      if (activeType) renderMegIconInto(els.sitesTypeDot, activeType, TOUR_LIST_ICON_SIZE);
      else els.sitesTypeDot.innerHTML = '';
    }
    setPanelOpen('sites', true);
    setPanelOpen('types', false);
    try {
      await loadSitesForType(activeType);
      els.nmsStatus.textContent = `Loaded ${sites.length} sites for ${activeType}.`;
    } catch (e) {
      els.nmsStatus.textContent = `Failed to load sites: ${e?.message || e}`;
      if (els.siteList) els.siteList.innerHTML = `<div class=\"status\">Failed to load: ${escapeHtml(e?.message || String(e))}</div>`;
    }
  }

  async function fetchDistinctMonumentClasses() {
    const params = {
      where: '1=1',
      outFields: 'MONUMENT_CLASS',
      returnDistinctValues: true,
      returnGeometry: false,
      orderByFields: 'MONUMENT_CLASS',
      f: 'json'
    };

    // 1) Prefer native fetch (fast path).
    try {
      const qs = new URLSearchParams(Object.entries(params).reduce((acc, [k, v]) => {
        acc[k] = String(v);
        return acc;
      }, {}));
      const res = await fetch(`${NMS_ROI_SMR_URL}/query?${qs.toString()}`);
      const json = await res.json();
      const vals = (json.features || [])
        .map(f => f?.attributes?.MONUMENT_CLASS)
        .filter(Boolean)
        .map(s => String(s).trim())
        .filter(Boolean);
      return Array.from(new Set([...vals, ...NI_CANONICAL_TYPES])).sort((a, b) => a.localeCompare(b));
    } catch (e) {
      // 2) Fallback: Esri Leaflet request (can JSONP when CORS/network is hostile).
      if (typeof L !== 'undefined' && L.esri && typeof L.esri.request === 'function') {
        const json = await new Promise((resolve, reject) => {
          try {
            L.esri.request(`${NMS_ROI_SMR_URL}/query`, params, (err, resp) => {
              if (err) reject(err);
              else resolve(resp);
            });
          } catch (err) { reject(err); }
        });
        const vals = (json?.features || [])
          .map(f => f?.attributes?.MONUMENT_CLASS)
          .filter(Boolean)
          .map(s => String(s).trim())
          .filter(Boolean);
        return Array.from(new Set([...vals, ...NI_CANONICAL_TYPES])).sort((a, b) => a.localeCompare(b));
      }
      throw e;
    }
  }

  function computeDefaultSelected(all) {
    const sel = new Set(MEGALITHIC_TYPES.map(t => String(t.monumentClass)));
    for (const v of all) {
      if (String(v).startsWith('Barrow -')) sel.add(v);
      if (String(v) === 'Boulder-burial') sel.add(v);
    }
    return sel;
  }

  async function cacheIconsForSelected() {
    await ensureMegIconLoaded();
    const list = Array.from(selectedMonumentClasses.values());
    // Cache SPECS only. (SVG markup must be unique per placement due to mask ids.)
    await Promise.all(list.map(async (cls) => {
      const s = await getMegIconSpec(cls);
      if (s) specByMonumentClass.set(cls, s);
    }));
  }

  function syncPresetCheckboxes() {
    if (!els.presetList) return;
    els.presetList.querySelectorAll('input[type="checkbox"][data-monument-class]').forEach((input) => {
      input.checked = selectedMonumentClasses.has(input.dataset.monumentClass || '');
    });
  }

  async function applyDefaultMonumentSelection({ persist = true } = {}) {
    selectedMonumentClasses = computeDefaultSelected(allMonumentClasses);
    await cacheIconsForSelected();
    syncPresetCheckboxes();
    if (activeType && !selectedMonumentClasses.has(activeType)) {
      activeType = null;
      if (els.siteList) els.siteList.innerHTML = '<div class="status">Select a monument type.</div>';
      setPanelOpen('sites', false);
      setPanelOpen('types', true);
      if (els.typesPanelTitle) els.typesPanelTitle.textContent = 'Monument Types';
      if (els.typesTypeDot) { els.typesTypeDot.style.display = 'none'; els.typesTypeDot.innerHTML = ''; }
      if (els.sitesPanelTitle) els.sitesPanelTitle.textContent = 'Sites';
      if (els.sitesTypeDot) { els.sitesTypeDot.style.display = 'none'; els.sitesTypeDot.innerHTML = ''; }
    }
    renderTypeList();
    if (persist) await saveMonumentSelectionSetting();
  }

  async function initPresetsUI() {
    if (!els.presetList || !els.presetStatus) return;
    els.presetStatus.textContent = 'Loading monument type list…';
    els.presetList.replaceChildren();
    try {
      allMonumentClasses = await fetchDistinctMonumentClasses();
      selectedMonumentClasses = computeDefaultSelected(allMonumentClasses);
      if (monumentSelectionStorageEnabled()) {
        try {
          const stored = await getMonumentSelectionSetting();
          const storedClasses = Array.isArray(stored?.classes) ? stored.classes.map(String).filter(Boolean) : [];
          if (storedClasses.length) {
            const valid = new Set(allMonumentClasses);
            selectedMonumentClasses = new Set(storedClasses.filter(cls => valid.has(cls)));
          }
        } catch (_) {}
      }
      await cacheIconsForSelected();

      // Build preset list (checkboxes). Icons optional; we show them for readability.
      const frag = document.createDocumentFragment();
      for (const cls of allMonumentClasses) {
        const row = document.createElement('label');
        row.className = 'preset-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedMonumentClasses.has(cls);
        cb.dataset.monumentClass = cls;

        const icon = document.createElement('span');
        icon.className = 'megicon megicon--sm';
        // Render a unique SVG instance to avoid mask-id collisions.
        renderMegIconInto(icon, cls, TOUR_LIST_ICON_SIZE);

        const text = document.createElement('span');
        text.className = 'label';
        text.textContent = cls;

        row.appendChild(cb);
        row.appendChild(icon);
        row.appendChild(text);
        frag.appendChild(row);
      }
      els.presetList.appendChild(frag);
      els.presetStatus.textContent = `Loaded ${allMonumentClasses.length} monument classes.`;

      els.presetList.addEventListener('change', async (e) => {
        const input = e.target.closest('input[type="checkbox"][data-monument-class]');
        if (!input) return;
        const cls = input.dataset.monumentClass;
        if (!cls) return;
        if (input.checked) selectedMonumentClasses.add(cls);
        else selectedMonumentClasses.delete(cls);
        await cacheIconsForSelected();
        await saveMonumentSelectionSetting();
        // If current active type is no longer selected, clear it and collapse sites.
        if (activeType && !selectedMonumentClasses.has(activeType)) {
          activeType = null;
          if (els.siteList) els.siteList.innerHTML = '<div class="status">Select a monument type.</div>';
          setPanelOpen('sites', false);
          setPanelOpen('types', true);
          if (els.typesPanelTitle) els.typesPanelTitle.textContent = 'Monument Types';
          if (els.typesTypeDot) { els.typesTypeDot.style.display = 'none'; els.typesTypeDot.innerHTML = ''; }
          if (els.sitesPanelTitle) els.sitesPanelTitle.textContent = 'Sites';
          if (els.sitesTypeDot) { els.sitesTypeDot.style.display = 'none'; els.sitesTypeDot.innerHTML = ''; }
        }
        renderTypeList();
      }, { passive: true });

      renderTypeList();
    } catch (e) {
      els.presetStatus.textContent = `Failed to load monument types: ${e?.message || String(e)}`;
    }
  }

  async function drawTileMosaic(template, z, originX, originY, count, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = count * TILE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: !!options.read });
    const failures = [];

    await Promise.all(Array.from({ length: count * count }, async (_, i) => {
      const dx = i % count;
      const dy = Math.floor(i / count);
      const x = originX + dx;
      const y = originY + dy;
      try {
        const img = await loadImage(tileUrl(template, z, x, y), options.crossOrigin ?? 'anonymous');
        ctx.drawImage(img, dx * TILE_SIZE, dy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      } catch (e) {
        failures.push(e);
      }
    }));

    if (options.required && failures.length === count * count) {
      throw failures[0] || new Error('No tiles loaded.');
    }
    return canvas;
  }

  function decodeTerrariumCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const out = new Float32Array(canvas.width * canvas.height);
    for (let i = 0, j = 0; i < img.length; i += 4, j++) {
      out[j] = (img[i] * 256 + img[i + 1] + img[i + 2] / 256) - 32768;
    }
    return out;
  }

  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function smoothstep(a, b, x) {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }

  function elevationRampRgb(h) {
    // Simple hypsometric tint (meters). Tuned for a "pseudo-real" look.
    if (!isFinite(h)) return [120, 120, 120];
    if (h < 0) {
      const t = clamp01((h + 40) / 40);
      return [
        Math.round(lerp(10, 54, t)),
        Math.round(lerp(38, 108, t)),
        Math.round(lerp(80, 170, t))
      ];
    }
    if (h < 150) {
      const t = smoothstep(0, 150, h);
      return [
        Math.round(lerp(72, 108, t)),
        Math.round(lerp(118, 154, t)),
        Math.round(lerp(66, 98, t))
      ];
    }
    if (h < 400) {
      const t = smoothstep(150, 400, h);
      return [
        Math.round(lerp(108, 156, t)),
        Math.round(lerp(154, 142, t)),
        Math.round(lerp(98, 102, t))
      ];
    }
    if (h < 900) {
      const t = smoothstep(400, 900, h);
      return [
        Math.round(lerp(156, 132, t)),
        Math.round(lerp(142, 116, t)),
        Math.round(lerp(102, 96, t))
      ];
    }
    const t = clamp01((h - 900) / 900);
    return [
      Math.round(lerp(150, 235, t)),
      Math.round(lerp(140, 240, t)),
      Math.round(lerp(140, 245, t))
    ];
  }

  function buildTerrainReliefCanvas(elev, size, metersPerPxAtZ, targetMaxPx = 2048) {
    // Render hillshade + hypsometric tint to a canvas texture.
    // Downsample if the DEM is very large to keep this responsive.
    const scale = Math.max(1, Math.ceil(size / targetMaxPx));
    const w = Math.max(1, Math.floor(size / scale));
    const h = w;
    const mpp = metersPerPxAtZ * scale;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.createImageData(w, h);
    const data = img.data;

    const azDeg = 315;
    const altDeg = 45;
    const az = azDeg * Math.PI / 180;
    const alt = altDeg * Math.PI / 180;
    const lx = Math.sin(az) * Math.cos(alt);
    const lyScreen = -Math.cos(az) * Math.cos(alt); // screen +y is south
    const lz = Math.sin(alt);

    const idx = (x, y) => (y * size + x);
    for (let y = 0; y < h; y++) {
      const oy = Math.min(size - 1, Math.round(y * scale));
      const oyU = Math.max(0, oy - scale);
      const oyD = Math.min(size - 1, oy + scale);
      for (let x = 0; x < w; x++) {
        const ox = Math.min(size - 1, Math.round(x * scale));
        const oxL = Math.max(0, ox - scale);
        const oxR = Math.min(size - 1, ox + scale);

        const hC = elev[idx(ox, oy)];
        const hL = elev[idx(oxL, oy)];
        const hR = elev[idx(oxR, oy)];
        const hU = elev[idx(ox, oyU)];
        const hD = elev[idx(ox, oyD)];

        const dzdx = (hR - hL) / (2 * mpp);
        const dzdy = (hD - hU) / (2 * mpp);
        const invLen = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        const nx = -dzdx * invLen;
        const ny = -dzdy * invLen;
        const nz = 1 * invLen;

        const shade = Math.max(0, nx * lx + ny * lyScreen + nz * lz);
        const slope = Math.min(1, Math.sqrt(dzdx * dzdx + dzdy * dzdy) * 0.85);
        const ao = 0.75 + 0.25 * (1 - slope);
        const light = Math.pow(0.35 + 0.65 * shade, 1.15) * ao;

        const [r0, g0, b0] = elevationRampRgb(hC);
        const r = Math.max(0, Math.min(255, Math.round(r0 * light)));
        const g = Math.max(0, Math.min(255, Math.round(g0 * light)));
        const b = Math.max(0, Math.min(255, Math.round(b0 * light)));

        const i = (y * w + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function sampleElevation(elev, size, u, v) {
    const x = Math.max(0, Math.min(size - 1, u * (size - 1)));
    const y = Math.max(0, Math.min(size - 1, v * (size - 1)));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(size - 1, x0 + 1);
    const y1 = Math.min(size - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const a = elev[y0 * size + x0];
    const b = elev[y0 * size + x1];
    const c = elev[y1 * size + x0];
    const d = elev[y1 * size + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  function applyUvSampledHeights(mesh, elev, size, centerElev, exaggeration, offsetY = 0) {
    const pos = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i);
      const v = 1 - uv.getY(i);
      const h = sampleElevation(elev, size, u, v);
      pos.setY(i, (h - centerElev) * exaggeration + offsetY);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  function rebuildTerrainHeights() {
    if (terrainMesh && baseElev && currentPatch) {
      applyUvSampledHeights(terrainMesh, baseElev, baseElevSize, baseCenterElev, verticalExaggeration);
    }

    if (horizonMesh && horizonElev && horizonPatchMeters) {
      applyUvSampledHeights(horizonMesh, horizonElev, horizonElevSize, horizonCenterElev, verticalExaggeration, -1.2);
    }

    addSiteMarker(currentPatch.site);
  }

  function addHorizonSkirt(texture, elev, elevSize, centerElev, horizonPatch) {
    if (horizonMesh) {
      scene.remove(horizonMesh);
      horizonMesh.geometry.dispose();
      horizonMesh.material.map?.dispose?.();
      horizonMesh.material.dispose();
      horizonMesh = null;
    }
    horizonElev = elev;
    horizonElevSize = elevSize;
    horizonCenterElev = centerElev;
    horizonPatchMeters = horizonPatch.meters;
    horizonPatchOriginX = horizonPatch.originX;
    horizonPatchOriginY = horizonPatch.originY;
    horizonPatchCount = horizonPatch.count;

    const segments = 80;
    const positions = [];
    const uvs = [];
    const indices = [];
    const terrainScale = 2 ** (TERRAIN_Z - HORIZON_Z);

    for (let iy = 0; iy <= segments; iy++) {
      const fy = iy / segments;
      for (let ix = 0; ix <= segments; ix++) {
        const fx = ix / segments;
        const terrainTileX = (horizonPatch.originX + fx * horizonPatch.count) * terrainScale;
        const terrainTileY = (horizonPatch.originY + fy * horizonPatch.count) * terrainScale;
        const xPx = (terrainTileX - currentPatch.originX) * TILE_SIZE;
        const yPx = (terrainTileY - currentPatch.originY) * TILE_SIZE;
        const x = (xPx - currentPatch.patchPx / 2) * currentPatch.mpp;
        const z = (yPx - currentPatch.patchPx / 2) * currentPatch.mpp;
        const h = sampleElevation(elev, elevSize, fx, fy);
        positions.push(x, (h - centerElev) * verticalExaggeration - 1.2, z);
        uvs.push(fx, 1 - fy);
      }
    }

    for (let iy = 0; iy < segments; iy++) {
      for (let ix = 0; ix < segments; ix++) {
        const a = iy * (segments + 1) + ix;
        const b = a + 1;
        const c = a + (segments + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ map: texture, depthWrite: true });
    horizonMesh = new THREE.Mesh(geometry, mat);
    scene.add(horizonMesh);
    if (terrainMesh) terrainMesh.renderOrder = 2;
  }

  async function buildTerrain(focus) {
    const token = ++loadingToken;

    const centerTile = lonLatToTile(focus.lng, focus.lat, TERRAIN_Z);
    const count = terrainTileCount();
    const grid = terrainGridSize(count);
    const effectiveAerialZ = aerialZoomForTileCount(count);
    els.nmsStatus.textContent = `Loading ${demAreaKey === 'double' ? 'double' : 'standard'} high-res DEM area (${count}x${count} Z${TERRAIN_Z} DEM, Z${effectiveAerialZ} aerial)...`;
    if (!siteDemReady) {
      setStageLoadingText(els.nmsStatus.textContent);
      setStageLoadingProgress(0.05, { cap: 0.18 });
    }
    const originX = Math.floor(centerTile.x - count / 2);
    const originY = Math.floor(centerTile.y - count / 2);
    const patchPx = count * TILE_SIZE;
    const mpp = metersPerPixel(focus.lat, TERRAIN_Z);
    const patchMeters = patchPx * mpp;

    const aerialTemplate = imageryKey === 'esri-clarity' ? ESRI_CLARITY_URL : GOOGLE_AERIAL_URL;
    if (!siteDemReady) setStageLoadingProgress(0.10, { cap: 0.22 });
    const demCanvas = await drawTileMosaic(TERRARIUM_URL, TERRAIN_Z, originX, originY, count, { read: true, required: true });
    let aerialCanvas = null;
    let horizonCanvas = null;
    let horizonDemCanvas = null;
    let horizonTile = null;
    let horizonCount = HORIZON_TILE_RADIUS * 2 + 1;
    let horizonOriginX = null;
    let horizonOriginY = null;
    let horizonAerialOriginX = null;
    let horizonAerialOriginY = null;
    let horizonAerialCount = null;
    try {
      horizonTile = lonLatToTile(focus.lng, focus.lat, HORIZON_Z);
      horizonOriginX = Math.floor(horizonTile.x) - HORIZON_TILE_RADIUS;
      horizonOriginY = Math.floor(horizonTile.y) - HORIZON_TILE_RADIUS;
      const horizonAerialScale = 2 ** (HORIZON_AERIAL_Z - HORIZON_Z);
      horizonAerialOriginX = horizonOriginX * horizonAerialScale;
      horizonAerialOriginY = horizonOriginY * horizonAerialScale;
      horizonAerialCount = horizonCount * horizonAerialScale;
      horizonDemCanvas = await drawTileMosaic(TERRARIUM_URL, HORIZON_Z, horizonOriginX, horizonOriginY, horizonCount, { read: true, required: true });
    } catch (_) {
      horizonTile = lonLatToTile(focus.lng, focus.lat, HORIZON_Z);
      horizonOriginX = Math.floor(horizonTile.x) - HORIZON_TILE_RADIUS;
      horizonOriginY = Math.floor(horizonTile.y) - HORIZON_TILE_RADIUS;
      const horizonAerialScale = 2 ** (HORIZON_AERIAL_Z - HORIZON_Z);
      horizonAerialOriginX = horizonOriginX * horizonAerialScale;
      horizonAerialOriginY = horizonOriginY * horizonAerialScale;
      horizonAerialCount = horizonCount * horizonAerialScale;
      horizonDemCanvas = await drawTileMosaic(TERRARIUM_URL, HORIZON_Z, horizonOriginX, horizonOriginY, horizonCount, { read: true, required: true });
    }

    if (token !== loadingToken) return;

    if (!siteDemReady) {
      setStageLoadingText('Building terrain mesh…');
      setStageLoadingProgress(0.26, { cap: 0.42 });
    }
    const elev = decodeTerrariumCanvas(demCanvas);
    baseElev = elev;
    baseElevSize = patchPx;
    baseCenterElev = null;
    const centerPxX = (centerTile.x - originX) * TILE_SIZE;
    const centerPxY = (centerTile.y - originY) * TILE_SIZE;
    const centerU = centerPxX / patchPx;
    const centerV = centerPxY / patchPx;
    const centerElev = sampleElevation(elev, patchPx, centerU, centerV);
    baseCenterElev = centerElev;

    if (imageryKey === 'terrain') {
      if (!siteDemReady) setStageLoadingProgress(0.44, { cap: 0.58 });
      aerialCanvas = buildTerrainReliefCanvas(elev, patchPx, mpp);
      const hElevTmp = decodeTerrariumCanvas(horizonDemCanvas);
      const horizonPxTmp = horizonCount * TILE_SIZE;
      const hCenterU = ((horizonTile.x - horizonOriginX) * TILE_SIZE) / horizonPxTmp;
      const hCenterV = ((horizonTile.y - horizonOriginY) * TILE_SIZE) / horizonPxTmp;
      const hCenterElevTmp = sampleElevation(hElevTmp, horizonPxTmp, hCenterU, hCenterV);
      horizonCanvas = buildTerrainReliefCanvas(hElevTmp, horizonPxTmp, metersPerPixel(focus.lat, HORIZON_Z));
      // Keep these for the skirt mesh later.
      horizonDemCanvas = horizonDemCanvas;
    } else {
      if (!siteDemReady) {
        setStageLoadingText('Loading imagery…');
        setStageLoadingProgress(0.46, { cap: 0.70 });
      }
      const aerialScale = 2 ** (effectiveAerialZ - TERRAIN_Z);
      const aerialOriginX = originX * aerialScale;
      const aerialOriginY = originY * aerialScale;
      const aerialCount = count * aerialScale;
      try {
        aerialCanvas = await drawTileMosaic(aerialTemplate, effectiveAerialZ, aerialOriginX, aerialOriginY, aerialCount, { required: true });
      } catch (e) {
        // Google tiles can be CORS-hostile in some browser states; keep the terrain usable with Esri texture.
        aerialCanvas = await drawTileMosaic(ESRI_CLARITY_URL, effectiveAerialZ, aerialOriginX, aerialOriginY, aerialCount, { required: true });
        els.nmsStatus.textContent = 'Google texture failed; displayed Esri Clarity texture for WebGL terrain.';
        if (!siteDemReady) setStageLoadingText(els.nmsStatus.textContent);
      }
      try {
        horizonCanvas = await drawTileMosaic(aerialTemplate, HORIZON_AERIAL_Z, horizonAerialOriginX, horizonAerialOriginY, horizonAerialCount, { required: true });
      } catch (_) {
        horizonCanvas = await drawTileMosaic(ESRI_CLARITY_URL, HORIZON_AERIAL_Z, horizonAerialOriginX, horizonAerialOriginY, horizonAerialCount, { required: true });
      }
    }

    if (!siteDemReady) {
      setStageLoadingText('Finalising…');
      setStageLoadingProgress(0.72, { cap: 0.92 });
    }
    const geometry = new THREE.PlaneGeometry(patchMeters, patchMeters, grid, grid);
    geometry.rotateX(-Math.PI / 2);

    if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.geometry.dispose();
      terrainMesh.material.map?.dispose?.();
      terrainMesh.material.dispose();
    }

    aerialTexture = new THREE.CanvasTexture(aerialCanvas);
    aerialTexture.colorSpace = THREE.SRGBColorSpace;
    aerialTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    terrainMesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: aerialTexture }));
    applyUvSampledHeights(terrainMesh, elev, patchPx, centerElev, verticalExaggeration);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    if (!siteDemReady) setStageLoadingProgress(0.88, { cap: 0.97 });
    // Reset label layer each build: selected label always shown; related labels optional.
    clearLabels();

    currentPatch = { site: selectedSite || focus, focus: { lat: focus.lat, lng: focus.lng }, originX, originY, count, patchPx, patchMeters, mpp, centerTile, centerElev };
    if (horizonCanvas) {
      const horizonTexture = new THREE.CanvasTexture(horizonCanvas);
      horizonTexture.colorSpace = THREE.SRGBColorSpace;
      horizonTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const hElev = decodeTerrariumCanvas(horizonDemCanvas);
      const horizonPx = horizonCount * TILE_SIZE;
      const hCenterU = ((horizonTile.x - horizonOriginX) * TILE_SIZE) / horizonPx;
      const hCenterV = ((horizonTile.y - horizonOriginY) * TILE_SIZE) / horizonPx;
      const hCenterElev = sampleElevation(hElev, horizonPx, hCenterU, hCenterV);
      const horizonMeters = horizonCount * TILE_SIZE * metersPerPixel(focus.lat, HORIZON_Z);
      addHorizonSkirt(horizonTexture, hElev, horizonPx, hCenterElev, {
        originX: horizonOriginX,
        originY: horizonOriginY,
        count: horizonCount,
        meters: horizonMeters
      });
    }
    addSiteMarker(selectedSite || focus);
    if (!siteDemReady) setStageLoadingProgress(0.92, { cap: 0.99 });
    // Ensure Notes "More" is enabled for the current site,
    // and ensure exactly one label is highlighted by default.
    const selectedLabel = labelItems.find(x => x.id === 'selected-site');
    if (selectedLabel) {
      notesActionItem = { id: selectedLabel.id, local: selectedLabel.local, lat: selectedLabel.lat, lng: selectedLabel.lng, props: selectedLabel.props, text: markerLabelText(selectedLabel.props || {}), detail: markerLabelDetail(selectedLabel.props || {}), el: selectedLabel.el };
      setActiveLabelById(selectedLabel.id);
    }
    updateNotesActions();
    if (showRelatedMonuments) await addNmsMarkers();
    if (showAllRelational) await loadRelationalMarkersInView();
    if (showAllMonuments) await loadAllMonumentMarkersInView();
    if (showAllLabels) rebuildAllLabelsFromShownMarkers();
    updateFocusTarget();
    updateCamera();
    els.nmsStatus.textContent = `3D terrain loaded. High-res DEM area: ${count}x${count} tiles (${Math.round(patchMeters)} m wide).`;
    if (!siteDemReady) setStageLoadingProgress(1, { cap: 1 });
  }

  function localFromLonLat(lng, lat) {
    if (!currentPatch) return null;
    const local = localFromLonLatUnbounded(lng, lat);
    if (!local) return null;
    if (local.x < -currentPatch.patchMeters / 2 || local.x > currentPatch.patchMeters / 2 || local.z < -currentPatch.patchMeters / 2 || local.z > currentPatch.patchMeters / 2) return null;
    return local;
  }

  function localFromLonLatUnbounded(lng, lat) {
    if (!currentPatch) return null;
    const p = lonLatToTile(lng, lat, TERRAIN_Z);
    const xPx = (p.x - currentPatch.originX) * TILE_SIZE;
    const yPx = (p.y - currentPatch.originY) * TILE_SIZE;
    const x = (xPx / currentPatch.patchPx - 0.5) * currentPatch.patchMeters;
    const z = (yPx / currentPatch.patchPx - 0.5) * currentPatch.patchMeters;
    return { x, z };
  }

  function terrainYAtLocal(x, z) {
    if (!terrainMesh || !currentPatch || !baseElev) return 0;
    const u = (x / currentPatch.patchMeters) + 0.5;
    const v = (z / currentPatch.patchMeters) + 0.5;
    const h = sampleElevation(baseElev, baseElevSize, u, v);
    return (h - baseCenterElev) * verticalExaggeration;
  }

  function horizonYAtLocal(x, z) {
    if (!horizonMesh || !currentPatch || !horizonElev || !horizonPatchCount || horizonPatchOriginX == null) return null;
    const terrainScale = 2 ** (TERRAIN_Z - HORIZON_Z);

    // Invert local->terrain tile transform used in addHorizonSkirt.
    const xPx = x / currentPatch.mpp + currentPatch.patchPx / 2;
    const yPx = z / currentPatch.mpp + currentPatch.patchPx / 2;
    const terrainTileX = currentPatch.originX + (xPx / TILE_SIZE);
    const terrainTileY = currentPatch.originY + (yPx / TILE_SIZE);
    const hTileX = terrainTileX / terrainScale;
    const hTileY = terrainTileY / terrainScale;
    const u = (hTileX - horizonPatchOriginX) / horizonPatchCount;
    const v = (hTileY - horizonPatchOriginY) / horizonPatchCount;

    // Only trust horizon sampling when actually within the horizon patch envelope.
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const h = sampleElevation(horizonElev, horizonElevSize, u, v);
    return (h - horizonCenterElev) * verticalExaggeration - 1.2;
  }

  function groundYAtLocal(x, z) {
    if (!currentPatch) return 0;
    const half = (currentPatch.patchMeters || 0) / 2;
    const inMain = Math.abs(x) <= half && Math.abs(z) <= half;
    if (inMain) return terrainYAtLocal(x, z);
    const hy = horizonYAtLocal(x, z);
    if (hy != null) return hy;
    return terrainYAtLocal(x, z);
  }

  function updateFocusTarget() {
    if (!currentFocus || !currentPatch) {
      cameraState.target.set(0, 80, 0);
      return;
    }
    const local = localFromLonLatUnbounded(currentFocus.lng, currentFocus.lat);
    if (!local) {
      cameraState.target.set(0, 80, 0);
      return;
    }
    const inside = Math.abs(local.x) <= currentPatch.patchMeters / 2 && Math.abs(local.z) <= currentPatch.patchMeters / 2;
    cameraState.target.set(local.x, (inside ? terrainYAtLocal(local.x, local.z) : 0) + 80, local.z);
  }

  function observerCameraLocal() {
    if (!cameraState.observerMode || !currentFocus || !currentPatch) return null;
    const local = localFromLonLatUnbounded(currentFocus.lng, currentFocus.lat);
    if (!local) return null;
    const inside = Math.abs(local.x) <= currentPatch.patchMeters / 2 && Math.abs(local.z) <= currentPatch.patchMeters / 2;
    const groundY = inside ? terrainYAtLocal(local.x, local.z) : 0;
    return {
      x: local.x,
      y: groundY + cameraState.observerHeightOffsetM,
      z: local.z,
      groundY,
      inside
    };
  }

  function updateObserverStatus() {
    if (!els.observerStatus) return;
    const observer = observerCameraLocal();
    if (!observer || !currentFocus) {
      els.observerStatus.textContent = 'Observer camera not positioned yet.';
      return;
    }
    els.observerStatus.textContent = `Camera at ${Number(currentFocus.lat).toFixed(6)}, ${Number(currentFocus.lng).toFixed(6)}; terrain ${(observer.groundY / Math.max(verticalExaggeration, 0.0001) + (baseCenterElev || 0)).toFixed(2)}m, camera Y ${observer.y.toFixed(2)}m.`;
  }

  function scheduleTerrainReloadIfNeeded(force = false) {
    if (!currentFocus) return;
    if (force || !currentPatch) {
      clearTimeout(terrainReloadTimer);
      terrainReloadTimer = setTimeout(() => buildTerrain(currentFocus), 80);
      return;
    }
    const local = localFromLonLatUnbounded(currentFocus.lng, currentFocus.lat);
    const threshold = currentPatch.patchMeters * 0.16;
    if (!local || Math.abs(local.x) > threshold || Math.abs(local.z) > threshold) {
      clearTimeout(terrainReloadTimer);
      els.nmsStatus.textContent = 'Streaming high-resolution DEM/aerial data for current view...';
      terrainReloadTimer = setTimeout(() => buildTerrain(currentFocus), 40);
    }
  }

  function moveFocus(forwardM, rightM) {
    if (!currentFocus) return;
    const b = THREE.MathUtils.degToRad(cameraState.bearing);
    const eastM = (-Math.sin(b) * forwardM) + (Math.cos(b) * rightM);
    const northM = (Math.cos(b) * forwardM) + (Math.sin(b) * rightM);
    currentFocus = offsetLonLat(currentFocus.lat, currentFocus.lng, eastM, northM);
    updateFocusTarget();
    updateCamera();
    updateNotesPanel();
    scheduleTerrainReloadIfNeeded(false);
  }

  function cameraStepMeters(multiplier = 1) {
    return Math.max(90, Math.min(2200, cameraState.distance * 0.9)) * multiplier;
  }

  function minimumPitchDeg() {
    return cameraState.observerMode ? 0 : 8;
  }

  function applyCameraAction(action, dtSeconds = 1 / 60, holdSeconds = 0) {
    const dt = Math.max(0.001, Math.min(0.08, Number(dtSeconds) || 1 / 60));
    const accel = Math.min(2.8, 1 + Math.max(0, holdSeconds - 0.35) * 1.6);
    const moveM = cameraStepMeters(dt * accel);
    const rotateDeg = 70 * dt * accel;
    const pitchDeg = 34 * dt * accel;
    const zoomRate = 1.8 * dt * accel;
    let movedFocus = false;

    if (action === 'zoom-in') {
      cameraState.distance = Math.max(380, cameraState.distance / (1 + zoomRate));
      if (cameraState.distance < 1100) {
        moveFocus(Math.max(18, cameraState.distance * 0.035 * accel), 0);
        return;
      }
    } else if (action === 'zoom-out') {
      cameraState.distance = Math.min(6500, cameraState.distance * (1 + zoomRate));
    } else if (action === 'move-forward') {
      moveFocus(moveM, 0);
      movedFocus = true;
    } else if (action === 'move-back') {
      moveFocus(-moveM, 0);
      movedFocus = true;
    } else if (action === 'move-left') {
      moveFocus(0, -moveM);
      movedFocus = true;
    } else if (action === 'move-right') {
      moveFocus(0, moveM);
      movedFocus = true;
    } else if (action === 'pitch-up') {
      cameraState.pitch = Math.min(78, cameraState.pitch + pitchDeg);
    } else if (action === 'pitch-down') {
      cameraState.pitch = Math.max(minimumPitchDeg(), cameraState.pitch - pitchDeg);
    } else if (action === 'rotate-left') {
      cameraState.bearing -= rotateDeg;
    } else if (action === 'rotate-right') {
      cameraState.bearing += rotateDeg;
    }

    if (!movedFocus) updateCamera();
  }

  function bindContinuousActionButtons(container, applyAction) {
    if (window.ArchaeoscapesMobileControls?.bindContinuousActionButtons) {
      return window.ArchaeoscapesMobileControls.bindContinuousActionButtons(container, {
        onStart: () => closeLabelPopup(),
        onAction: applyAction
      });
    }
    if (!container) return;
    let active = null;

    const stop = () => {
      if (!active) return;
      cancelAnimationFrame(active.raf);
      active.button.classList.remove('is-held');
      active = null;
    };

    const tick = (now) => {
      if (!active) return;
      const dt = (now - active.lastTime) / 1000;
      const held = (now - active.startTime) / 1000;
      active.lastTime = now;
      applyAction(active.action, dt, held);
      active.raf = requestAnimationFrame(tick);
    };

    container.addEventListener('pointerdown', (e) => {
      const button = e.target.closest('button[data-action]');
      if (!button || !container.contains(button)) return;
      e.preventDefault();
      e.stopPropagation();
      closeLabelPopup();
      stop();
      const action = button.getAttribute('data-action');
      const now = performance.now();
      active = { button, action, startTime: now, lastTime: now, raf: 0 };
      button.classList.add('is-held');
      try { button.setPointerCapture(e.pointerId); } catch (_) {}
      applyAction(action, 1 / 60, 0);
      active.raf = requestAnimationFrame(tick);
    });

    ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture'].forEach((eventName) => {
      container.addEventListener(eventName, stop);
    });
  }

  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function normSmr(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function clearRelatedLabels() {
    const keep = [];
    for (const item of labelItems) {
      if (item.kind === 'related') {
        item.el?.remove();
        item.line?.remove();
      } else {
        keep.push(item);
      }
    }
    labelItems = keep;
  }

  function clearRelatedMarkers() {
    for (const m of relatedMarkers) {
      m.el?.remove?.();
    }
    relatedMarkers = [];
  }

  function clearRelationalMarkers() {
    for (const m of relationalMarkers) {
      m.el?.remove?.();
    }
    relationalMarkers = [];
  }

  function clearAllMonumentMarkers() {
    for (const m of allMonumentMarkers) {
      m.el?.remove?.();
    }
    allMonumentMarkers = [];
  }

  async function enableRelationalMonumentsForCurrentView() {
    showRelatedMonuments = false;
    showAllMonuments = false;
    showAllRelational = true;
    if (els.showRelatedMonuments) els.showRelatedMonuments.checked = false;
    if (els.showAllMonuments) els.showAllMonuments.checked = false;
    if (els.showAllRelational) els.showAllRelational.checked = true;
    clearRelatedMarkers();
    clearAllMonumentMarkers();
    await loadRelationalMarkersInView();
    syncShowAllLabelsState();
    updateLegendPanel();
  }

  function clearLabelsByKind(kind) {
    const keep = [];
    for (const item of labelItems) {
      if (item.kind === kind) {
        item.el?.remove();
        item.line?.remove();
      } else {
        keep.push(item);
      }
    }
    labelItems = keep;
    if (activeLabelId && !labelItems.some(x => x.id === activeLabelId)) {
      activeLabelId = null;
      previewNotesSite = null;
      notesActionItem = null;
      setActiveLabelById(null);
      updateNotesPanel();
      updateNotesActions();
    }
  }

  function updateRelationalMarkers() {
    if (selectedScreenMarker?.el && selectedScreenMarker?.local) {
      const anchor = projectedScreenPoint(selectedScreenMarker.local, 0);
      if (!anchor) {
        selectedScreenMarker.el.style.display = 'none';
      } else {
        selectedScreenMarker.el.style.display = 'block';
        selectedScreenMarker.el.style.left = `${anchor.x}px`;
        selectedScreenMarker.el.style.top = `${anchor.y}px`;
      }
    }

    if (showRelatedMonuments && relatedMarkers.length) {
      for (const m of relatedMarkers) {
        const anchor = projectedScreenPoint(m.local, 0);
        if (!anchor) {
          m.el.style.display = 'none';
          continue;
        }
        m.el.style.display = 'block';
        m.el.style.left = `${anchor.x}px`;
        m.el.style.top = `${anchor.y}px`;
      }
    }

    if (showAllMonuments && allMonumentMarkers.length) {
      for (const m of allMonumentMarkers) {
        const anchor = projectedScreenPoint(m.local, 0);
        if (!anchor) {
          m.el.style.display = 'none';
          continue;
        }
        m.el.style.display = 'block';
        m.el.style.left = `${anchor.x}px`;
        m.el.style.top = `${anchor.y}px`;
      }
    }

    if (!showAllRelational || !relationalMarkers.length) return;
    for (const m of relationalMarkers) {
      const anchor = projectedScreenPoint(m.local, 0);
      if (!anchor) {
        m.el.style.display = 'none';
        continue;
      }
      m.el.style.display = 'block';
      m.el.style.left = `${anchor.x}px`;
      m.el.style.top = `${anchor.y}px`;
    }
  }

  async function loadRelationalMarkersInView() {
    const token = ++relationalLoadToken;
    clearRelationalMarkers();
    clearLabelsByKind('relational');
    if (!currentPatch) return;
    if (!showAllRelational) return;

    const env = currentQueryEnvelope(allRelationalRangeM);
    if (!env) return;

    let features = [];
    try {
      features = await fetchAllMonumentsInEnvelope(env, 12000);
    } catch (e) {
      els.nmsStatus.textContent = `NMS request failed: ${e.message || e}`;
      return;
    }
    if (!showAllRelational || token !== relationalLoadToken) return;

    const selectedSmr = normSmr(selectedSite?.smr || '');
    for (const f of features) {
      if (!showAllRelational || token !== relationalLoadToken) return;
      const g = f.geometry;
      const a = f.attributes || {};
      if (!g || !isFinite(g.x) || !isFinite(g.y)) continue;
      if (!selectedMonumentClasses.has(String(a.MONUMENT_CLASS || '').trim())) continue;
      const thisSmr = normSmr(a.SMRS || '');
      if (selectedSmr && thisSmr && thisSmr === selectedSmr) continue;
      if (selectedSite && isFinite(selectedSite.lat) && isFinite(selectedSite.lng)) {
        if (distanceMeters(selectedSite.lat, selectedSite.lng, g.y, g.x) < 6) continue;
      }

      const local = localFromLonLatUnbounded(g.x, g.y);
      if (!local) continue;

      const mClass = a.MONUMENT_CLASS || '';
      const el = document.createElement('div');
      el.className = 'rel-marker';
      el.title = String(mClass || 'Monument');
      el.innerHTML = `<span class="megicon"></span>`;
      renderMegIconInto(el.querySelector('.megicon'), mClass, TOUR_MARKER_ICON_SIZE);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!showAllRelational) return;
        const stableKey = monumentStableKey(a, g.x, g.y);
        const labelId = `rel-${stableKey}`;
        if (hasLabel(labelId)) {
          removeFlatLabel(labelId);
          return;
        }
        addFlatLabel({
          id: labelId,
          className: 'nms',
          kind: 'relational',
          local,
          lat: g.y,
          lng: g.x,
          props: a,
          text: markerLabelText(a),
          detail: markerLabelDetail(a)
        });
      });
      els.markerLayer?.appendChild(el);
      relationalMarkers.push({ el, local, lat: g.y, lng: g.x, props: a });
    }

    if (showAllLabels) rebuildAllLabelsFromShownMarkers();
  }

  async function loadAllMonumentMarkersInView() {
    const token = ++relationalLoadToken;
    clearAllMonumentMarkers();
    clearLabelsByKind('monumentsRelational');
    if (!currentPatch) return;
    if (!showAllMonuments) return;

    const env = currentQueryEnvelope(allRelationalRangeM);
    if (!env) return;

    const collected = [];
    try {
      collected.push(...(await fetchAllMonumentsInEnvelope(env, 12000)));
    } catch (e) {
      els.nmsStatus.textContent = `NMS request failed: ${e.message || e}`;
      return;
    }
    if (!showAllMonuments || token !== relationalLoadToken) return;

    const selectedSmr = normSmr(selectedSite?.smr || '');
    for (const f of collected) {
      if (!showAllMonuments || token !== relationalLoadToken) return;
      const g = f.geometry;
      const a = f.attributes || {};
      if (!g || !isFinite(g.x) || !isFinite(g.y)) continue;
      const thisSmr = normSmr(a.SMRS || '');
      if (selectedSmr && thisSmr && thisSmr === selectedSmr) continue;
      if (selectedSite && isFinite(selectedSite.lat) && isFinite(selectedSite.lng)) {
        if (distanceMeters(selectedSite.lat, selectedSite.lng, g.y, g.x) < 6) continue;
      }

      const local = localFromLonLatUnbounded(g.x, g.y);
      if (!local) continue;

      const mClass = String(a.MONUMENT_CLASS || '').trim();
      const el = document.createElement('div');
      el.className = 'rel-marker rel-marker--relational';
      el.title = String(mClass || 'Monument');
      el.innerHTML = `<span class="megicon"></span>`;
      renderMegIconInto(el.querySelector('.megicon'), mClass, TOUR_MARKER_ICON_SIZE);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!showAllMonuments) return;
        const stableKey = monumentStableKey(a, g.x, g.y);
        const labelId = `mon-${stableKey}`;
        if (hasLabel(labelId)) {
          removeFlatLabel(labelId);
          return;
        }
        addFlatLabel({
          id: labelId,
          className: 'nms',
          kind: 'monumentsRelational',
          local,
          lat: g.y,
          lng: g.x,
          props: a,
          text: markerLabelText(a),
          detail: markerLabelDetail(a)
        });
      });
      els.markerLayer?.appendChild(el);
      allMonumentMarkers.push({ el, local, lat: g.y, lng: g.x, props: a });
    }

    if (showAllLabels) rebuildAllLabelsFromShownMarkers();
  }

  async function addNmsMarkers() {
    const token = ++relatedLoadToken;
    markerGroup.clear();
    clearRelatedLabels();
    clearRelatedMarkers();
    if (!currentPatch) return;
    if (!showRelatedMonuments) return;
    const targetType = String(activeType || selectedSite?.props?.MONUMENT_CLASS || selectedSite?.monumentClass || '').trim();
    if (!targetType) return;
    const env = currentQueryEnvelope(relatedRangeM);
    if (!env) return;

    try {
      const features = await fetchAllMonumentsInEnvelope(env, 12000);
      if (!showRelatedMonuments || token !== relatedLoadToken) return;
      const selectedSmr = normSmr(selectedSite?.smr || '');
      for (const f of features) {
        if (!showRelatedMonuments || token !== relatedLoadToken) return;
        const g = f.geometry;
        const a = f.attributes || {};
        if (!g || !isFinite(g.x) || !isFinite(g.y)) continue;
        if (String(a.MONUMENT_CLASS || '').trim() !== targetType) continue;
        const thisSmr = normSmr(a.SMRS || '');
        if (selectedSmr && thisSmr && thisSmr === selectedSmr) continue;
        if (selectedSite && isFinite(selectedSite.lat) && isFinite(selectedSite.lng)) {
          if (distanceMeters(selectedSite.lat, selectedSite.lng, g.y, g.x) < 6) continue;
        }
        const local = localFromLonLatUnbounded(g.x, g.y);
        if (!local) continue;

        // On-stage marker icon (MegIcon). Avoid legacy dot markers entirely.
        const mClass = String(a.MONUMENT_CLASS || targetType || '').trim();
        if (els.markerLayer && mClass) {
          const el = document.createElement('div');
          el.className = 'rel-marker rel-marker--related';
          el.title = mClass;
          el.innerHTML = `<span class="megicon"></span>`;
          renderMegIconInto(el.querySelector('.megicon'), mClass, TOUR_MARKER_ICON_SIZE);
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (!showRelatedMonuments) return;
            const stableKey = monumentStableKey(a, g.x, g.y);
            const labelId = `rtype-${stableKey}`;
            if (hasLabel(labelId)) {
              removeFlatLabel(labelId);
              return;
            }
            addFlatLabel({
              id: labelId,
              className: 'nms',
              kind: 'relatedRelational',
              local,
              lat: g.y,
              lng: g.x,
              props: a,
              text: markerLabelText(a),
              detail: markerLabelDetail(a)
            });
          });
          els.markerLayer.appendChild(el);
          relatedMarkers.push({ el, local, lat: g.y, lng: g.x, props: a });
        }
      }
    } catch (e) {
      els.nmsStatus.textContent = `NMS request failed: ${e.message || e}`;
    }

    if (showAllLabels) rebuildAllLabelsFromShownMarkers();
  }

  function addSiteMarker(site) {
    if (siteMarker) {
      markerGroup.remove(siteMarker);
      siteMarker = null;
    }
    removeFlatLabel('selected-site', { force: true });
    if (selectedScreenMarker?.el) selectedScreenMarker.el.remove();
    selectedScreenMarker = null;
    const local = localFromLonLat(site.lng, site.lat) || { x: 0, z: 0 };
    const props = site?.props || site || {};
    addFlatLabel({
      id: 'selected-site',
      className: 'source',
      kind: 'selected',
      local,
      lat: site.lat,
      lng: site.lng,
      props,
      text: markerLabelText(props),
      detail: markerLabelDetail(props)
    });

    // Selected-site icon on the display area (use MegIcon, same size as other stage markers).
    const mClass = String(props.MONUMENT_CLASS || props.monumentClass || activeType || '').trim();
    if (els.markerLayer && mClass) {
      const el = document.createElement('div');
      el.className = 'rel-marker rel-marker--selected';
      el.title = 'Selected site';
      el.innerHTML = `<span class="megicon"></span>`;
      renderMegIconInto(el.querySelector('.megicon'), mClass, TOUR_MARKER_ICON_SIZE);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const labelId = 'selected-site';
        if (hasLabel(labelId)) {
          removeFlatLabel(labelId);
          return;
        }
        addFlatLabel({
          id: labelId,
          className: 'source',
          kind: 'selected',
          local,
          lat: site.lat,
          lng: site.lng,
          props,
          text: markerLabelText(props),
          detail: markerLabelDetail(props)
        });
      });
      els.markerLayer.appendChild(el);
      selectedScreenMarker = { el, local, monumentClass: mClass };
    }
  }

  function makeMarker(color, size) {
    const group = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(size, 20, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 })
    );
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(size * 0.16, size * 0.16, size * 2.2, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    );
    stem.position.y = -size * 1.15;
    group.add(stem, sphere);
    return group;
  }

  function clearLabels() {
    for (const item of labelItems) item.el?.remove();
    labelItems = [];
    if (els.labelLines) els.labelLines.replaceChildren();
    closeLabelPopup();
    activeLabelId = null;
  }

  function removeFlatLabel(id, { force = false } = {}) {
    const keep = [];
    for (const item of labelItems) {
      if (item.id === id) {
        item.el?.remove();
        item.line?.remove();
      } else {
        keep.push(item);
      }
    }
    labelItems = keep;
    if (activeLabelId === id) {
      activeLabelId = null;
      setActiveLabelById(null);
    }
    if (notesActionItem?.id === id) notesActionItem = null;
    if (previewNotesSite?.id === id) previewNotesSite = null;
    updateNotesPanel();
    updateNotesActions();
  }

  function hasLabel(id) {
    return labelItems.some(item => item.id === id);
  }

  function addFlatLabel({ id, className, kind = 'related', local, lat = null, lng = null, props, text, detail }) {
    if (!els.labelLayer || !els.labelLines) return;
    // Label visibility rules:
    // - selected: always
    // - related: only when "Show Relational Monuments of Type" is on (or Show All Labels)
    // - all: only when "Show All Labels" is on
    // - relational: explicit user click on marker -> always allowed
    const allowed =
      kind === 'selected' ||
      kind === 'relational' ||
      kind === 'relatedRelational' ||
      kind === 'monumentsRelational' ||
      (kind === 'all' && showAllLabels) ||
      (kind === 'related' && (showAllLabels || showRelatedMonuments));
    if (!allowed) return;
    const el = document.createElement('div');
    el.className = `site-label${className ? ` ${className}` : ''}`;
    el.innerHTML = `<span class="label-title">${escapeHtml(text || 'SMR')}</span><span class="detail">${escapeHtml(detail || '')}</span>`;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // Wiring:
      // - Clicking a label makes it active
      // - Clicking the active label deselects it
      // Notes are shown only if the Notes toggle is already on.
      if (activeLabelId === id) {
        activeLabelId = null;
        setActiveLabelById(null);
        if (previewNotesSite?.id === id) previewNotesSite = null;
        if (notesActionItem?.id === id) notesActionItem = null;
        updateNotesPanel();
        updateNotesActions();
        return;
      }
      setActiveLabelById(id);
      previewNotesSite = { id, lat, lng, props };
      notesActionItem = { id, local, lat, lng, props, text, detail, el };
      updateNotesPanel();
      updateNotesActions();
    });
    els.labelLayer.appendChild(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    els.labelLines.appendChild(line);
    labelItems.push({ id, kind, local, lat, lng, props, el, line, visible: true });
    if (!activeLabelId && kind === 'selected') setActiveLabelById(id);
  }

  function markerLabelText(props) {
    return shortName(props.TOWNLAND) || props.SMRS || props.SMR_NO || props.SMR || props.OBJECTID || 'SMR';
  }

  function markerLabelDetail(props) {
    const smr = props.SMRS || props.SMR_NO || props.SMR || props.OBJECTID || '';
    const county = props.COUNTY || '';
    const mClass = props.MONUMENT_CLASS || '';
    return [smr, county, mClass].filter(Boolean).join(' · ');
  }

  function compactInfoHtml(props) {
    const p = props || {};
    const mClass = (p.MONUMENT_CLASS ?? '').toString().trim();
    const townland = (p.TOWNLAND ?? '').toString().trim();
    const county = (p.COUNTY ?? '').toString().trim();
    const smr = (p.SMRS || p.SMR_NO || p.SMR || p.OBJECTID || '').toString().trim();
    const parts = [];
    if (mClass) parts.push(mClass);
    const meta = [smr, county].filter(Boolean).join(' · ');
    if (townland) parts.push(townland);
    if (meta) parts.push(meta);
    return `<div class="compact-lines">${parts.map(x => `<div>${escapeHtml(x)}</div>`).join('')}</div>`;
  }

  function projectedScreenPoint(local, yOffset) {
    const v = new THREE.Vector3(local.x, groundYAtLocal(local.x, local.z) + yOffset, local.z);
    v.project(camera);
    if (v.z < -1 || v.z > 1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * els.container.clientWidth,
      y: (-v.y * 0.5 + 0.5) * els.container.clientHeight
    };
  }

  function screenOffsets() {
    return [
      [0, 0], [0, -34], [0, 34], [56, 0], [-56, 0],
      [56, -34], [-56, -34], [56, 34], [-56, 34],
      [0, -70], [0, 70], [112, 0], [-112, 0],
      [112, -70], [-112, -70], [112, 70], [-112, 70]
    ];
  }

  function updateFlatLabels() {
    if (!els.labelLayer || !els.labelLines || !labelItems.length) return;
    const placed = [];
    const candidates = [];
    const safeTop = 86;
    const safeBottom = 82;
    const safeSide = 10;
    const lift = 74;
    const gap = 22;
    const maxX = els.container.clientWidth;
    const maxY = els.container.clientHeight;

    for (const item of labelItems) {
      // anchor at ground (so leader line terminates at the site)
      const anchor = projectedScreenPoint(item.local, 0);
      if (!anchor) {
        item.el.style.display = 'none';
        item.line.style.display = 'none';
        continue;
      }
      // Only render labels whose anchors are visible on screen.
      const offscreen = anchor.x < 0 || anchor.x > maxX || anchor.y < 0 || anchor.y > maxY;
      if (offscreen) {
        item.el.style.display = 'none';
        item.line.style.display = 'none';
        continue;
      }
      const w = item.el.offsetWidth || 80;
      const h = item.el.offsetHeight || 28;
      const preferredBottom = anchor.y - lift;
      const placeBelow = preferredBottom - h < safeTop;
      item.el.style.display = 'block';
      item.line.style.display = 'block';
      candidates.push({
        item,
        anchor,
        desiredX: anchor.x,
        desiredY: placeBelow ? anchor.y + gap + h : preferredBottom,
        w,
        h,
        placeBelow
      });
    }

    candidates.sort((a, b) => {
      if (a.item.id === 'selected-site') return -1;
      if (b.item.id === 'selected-site') return 1;
      return a.anchor.y - b.anchor.y;
    });
    const pad = 7;
    const offsets = screenOffsets();

    for (const c of candidates) {
      let chosen = null;
      for (const [dx, dy] of offsets) {
        const left = Math.max(safeSide, Math.min(maxX - c.w - safeSide, c.desiredX - c.w / 2 + dx));
        const top = Math.max(safeTop, Math.min(maxY - c.h - safeBottom, c.desiredY - c.h + dy));
        const rect = { left, top, right: left + c.w, bottom: top + c.h };
        const overlaps = placed.some(p => rect.left < p.right + pad && rect.right + pad > p.left && rect.top < p.bottom + pad && rect.bottom + pad > p.top);
        const lineTooShort = Math.abs((left + c.w / 2) - c.anchor.x) < 8 && Math.abs((top + c.h) - c.anchor.y) < 12;
        if (!overlaps && !lineTooShort) {
          chosen = rect;
          break;
        }
      }
      if (!chosen) {
        const left = Math.max(safeSide, Math.min(maxX - c.w - safeSide, c.desiredX - c.w / 2));
        const spread = (placed.length % 10) * 9;
        const direction = c.placeBelow ? 1 : -1;
        const fallbackBottom = c.desiredY + direction * spread;
        const top = Math.max(safeTop, Math.min(maxY - c.h - safeBottom, fallbackBottom - c.h));
        chosen = { left, top, right: left + c.w, bottom: top + c.h };
      }
      placed.push(chosen);
      c.item.el.style.left = `${chosen.left + c.w / 2}px`;
      c.item.el.style.top = `${chosen.top + c.h}px`;
      c.item.line.setAttribute('x1', String(c.anchor.x));
      c.item.line.setAttribute('y1', String(c.anchor.y));
      c.item.line.setAttribute('x2', String(chosen.left + c.w / 2));
      c.item.line.setAttribute('y2', String(chosen.top + c.h));
    }

  }

  function showLabelPopup(item) {
    closeLabelPopup();
    const popup = document.createElement('div');
    popup.className = 'label-popup';
    const title = item.text || markerLabelText(item.props || {});
    const mode = item.mode || 'full';
    const footerHtml = mode === 'compact' ? `
      <div class="label-popup-footer">
        <button class="label-popup-footbtn" type="button" data-popup-view aria-label="View" title="View">
          <i class="ph-bold ph-eye"></i>
        </button>
        <button class="label-popup-footbtn" type="button" data-popup-more aria-label="More" title="More">
          <i class="ph-bold ph-dots-three-outline"></i>
        </button>
      </div>
    ` : '';
    popup.innerHTML = `
      <div class="label-popup-header">
        <span class="label-popup-title">${escapeHtml(title || 'Site detail')}</span>
        <div class="label-popup-header-actions">
          <button class="label-popup-tools${mode === 'compact' ? ' hidden' : ''}" type="button" aria-label="Tools" title="Tools" aria-pressed="false">
            <i class="ph-bold ph-wrench"></i>
          </button>
          <button class="label-popup-close" type="button" aria-label="Close" title="Close">×</button>
        </div>
      </div>
      <div class="label-popup-tools-section hidden${mode === 'compact' ? ' hidden' : ''}" data-popup-tools-section>
        <div class="label-popup-actions" data-popup-actions>
          <div class="label-popup-actions-left">
            <button type="button" class="label-popup-action" data-action="rise-set" aria-pressed="false">Calculate Rise/Set</button>
            <button type="button" class="label-popup-action" data-action="horizon" aria-pressed="false">Generate Horizon</button>
            <button type="button" class="label-popup-action" data-action="panorama" aria-pressed="false">Generate Panorama</button>
          </div>
          <div class="label-popup-actions-right">
            <button type="button" class="label-popup-generate" data-popup-generate>
              <i class="ph-bold ph-play"></i> Generate
            </button>
            <button type="button" class="label-popup-tools-hide" data-popup-tools-hide aria-label="Hide tools" title="Hide tools">
              <i class="ph-bold ph-x"></i>
            </button>
          </div>
        </div>
      </div>
      <div class="label-popup-body${mode === 'compact' ? ' compact' : ''}">${mode === 'compact' ? compactInfoHtml(item.props || {}) : propsTableHtml(item.props || {})}</div>
      ${footerHtml}
    `;
    popup.querySelector('.label-popup-close')?.addEventListener('click', closeLabelPopup);
    const toolsSection = popup.querySelector('[data-popup-tools-section]');
    const toolsBtn = popup.querySelector('.label-popup-tools');
    const toolsHideBtn = popup.querySelector('[data-popup-tools-hide]');
    const setToolsOpen = (open) => {
      if (!toolsSection) return;
      toolsSection.classList.toggle('hidden', !open);
      if (toolsBtn) toolsBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    };
    toolsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !!(toolsSection && toolsSection.classList.contains('hidden'));
      setToolsOpen(open);
    });
    toolsHideBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      setToolsOpen(false);
    });

    popup.querySelector('[data-popup-view]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const p = item.props || {};
      const lat = isFinite(item.lat) ? Number(item.lat) : (isFinite(p.LATITUDE) ? Number(p.LATITUDE) : null);
      const lng = isFinite(item.lng) ? Number(item.lng) : (isFinite(p.LONGITUDE) ? Number(p.LONGITUDE) : null);
      if (!isFinite(lat) || !isFinite(lng)) return;
      const smr = String(p.SMRS || p.SMR || p.SMR_NO || p.OBJECTID || item.id || '').trim();
      const townland = String(p.TOWNLAND || '').trim();
      const county = String(p.COUNTY || '').trim();
      await goToSite({ id: smr || `ll-${lat},${lng}`, smr, townland, county, lat, lng, props: p });
    });
    popup.querySelector('[data-popup-more]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      showLabelPopup({ ...item, mode: 'full' });
    });

    popup.querySelector('[data-popup-actions]')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const on = !btn.classList.contains('active');
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    popup.querySelector('[data-popup-generate]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      // Dummy: in future this will dispatch into Skyscraper workflows.
      const selected = Array.from(popup.querySelectorAll('button[data-action].active')).map(b => b.getAttribute('data-action'));
      console.log('[tour] popup generate (stub)', { selected, props: item.props || {} });
    });

    // Draggable popup (drag by header background; ignore header buttons)
    const header = popup.querySelector('.label-popup-header');
    let dragging = false;
    let dragDx = 0;
    let dragDy = 0;
    const onDown = (ev) => {
      const t = ev.target;
      if (t && t.closest && t.closest('button')) return;
      if (!header) return;
      dragging = true;
      const pr = popup.getBoundingClientRect();
      dragDx = ev.clientX - pr.left;
      dragDy = ev.clientY - pr.top;
      popup.style.cursor = 'grabbing';
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
    };
    const onMove = (ev) => {
      if (!dragging) return;
      const stageRect = els.stage.getBoundingClientRect();
      const w = popup.offsetWidth || 360;
      const h = popup.offsetHeight || 220;
      const left = Math.max(12, Math.min(stageRect.width - w - 12, (ev.clientX - stageRect.left) - dragDx));
      const top = Math.max(92, Math.min(stageRect.height - h - 12, (ev.clientY - stageRect.top) - dragDy));
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    };
    const onUp = () => {
      dragging = false;
      popup.style.cursor = '';
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
    };
    header?.addEventListener('pointerdown', onDown, true);
    popup.querySelectorAll('[data-copy]')?.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const v = btn.getAttribute('data-copy') || '';
        await copyText(v);
        showCopiedPop(e.currentTarget);
      });
    });
    els.stage.appendChild(popup);
    activeLabelPopup = popup;

    const rect = item.el.getBoundingClientRect();
    const stageRect = els.stage.getBoundingClientRect();
    const w = popup.offsetWidth || 360;
    const h = popup.offsetHeight || 220;
    const left = Math.max(12, Math.min(stageRect.width - w - 12, rect.left - stageRect.left + 10));
    const top = Math.max(92, Math.min(stageRect.height - h - 12, rect.bottom - stageRect.top + 8));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function closeLabelPopup() {
    activeLabelPopup?.remove();
    activeLabelPopup = null;
  }

  function propsTableHtml(props) {
    const p = props || {};
    const rows = [];
    const push = (k, vHtml) => rows.push(`<tr><td>${escapeHtml(k)}</td><td>${vHtml}</td></tr>`);
    const get = (k) => (p[k] === null || p[k] === undefined || String(p[k]).trim() === '') ? null : String(p[k]);

    const monumentClass = get('MONUMENT_CLASS');
    const townland = get('TOWNLAND');
    const county = get('COUNTY');
    const smr = get('SMRS');
    const lat = get('LATITUDE') || get('LAT');
    const lon = get('LONGITUDE') || get('LON');
    const webNotes = get('WEB_NOTES');

    if (monumentClass) push('Monument Class', escapeHtml(monumentClass));
    if (townland) push('Townland', escapeHtml(townland));
    if (county) push('County', escapeHtml(county));
    if (smr) push('SMR', escapeHtml(smr));

    if (lat || lon) {
      const latHtml = lat ? `<code>${escapeHtml(lat)}</code><button type="button" class="copy-btn" data-copy="${escapeHtml(lat)}" title="Copy latitude" aria-label="Copy latitude"><i class="ph-bold ph-copy"></i></button>` : '<span class="text-slate-400">—</span>';
      const lonHtml = lon ? `<code>${escapeHtml(lon)}</code><button type="button" class="copy-btn" data-copy="${escapeHtml(lon)}" title="Copy longitude" aria-label="Copy longitude"><i class="ph-bold ph-copy"></i></button>` : '<span class="text-slate-400">—</span>';
      const both = (lat && lon) ? `${lat}, ${lon}` : '';
      const bothBtn = both ? `<button type="button" class="copy-btn" data-copy="${escapeHtml(both)}" title="Copy lat, lon" aria-label="Copy lat, lon"><i class="ph-bold ph-copy"></i></button>` : '';
      push('Lat / Lon', `<div>${latHtml} ${lonHtml} ${bothBtn}</div>`);
    }

    if (webNotes) push('Web Notes', escapeHtml(webNotes));

    // Any remaining fields (alphabetical)
    const used = new Set(['MONUMENT_CLASS','TOWNLAND','COUNTY','SMRS','LATITUDE','LONGITUDE','LAT','LON','WEB_NOTES']);
    const rest = Object.entries(p)
      .filter(([k, v]) => !used.has(k) && v !== null && v !== undefined && String(v).trim() !== '')
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [k, v] of rest) push(k, escapeHtml(String(v)));

    if (!rows.length) return '<div style="padding:12px;">No detail available.</div>';
    return `<table class="popup-kv"><tbody>${rows.join('')}</tbody></table>`;
  }

  function renderSites() {
    els.siteList.innerHTML = '';
    if (!sites.length) {
      els.siteList.innerHTML = '<div class="status">No sites returned.</div>';
      return;
    }

    const sortControl = document.createElement('label');
    sortControl.className = 'sort-control';
    sortControl.innerHTML = `<input id="sort-by-county-rendered" type="checkbox"${sortByCountyOn ? ' checked' : ''} /><span>Sort by County</span>`;
    const sortInput = sortControl.querySelector('input');
    sortInput?.addEventListener('change', () => {
      sortByCountyOn = !!sortInput.checked;
      renderSites();
    });
    els.siteList.appendChild(sortControl);

    const sortCounty = sortByCountyOn;
    const ordered = sites.slice().sort((a, b) => {
      if (sortCounty) {
        const ca = String(a.county || '');
        const cb = String(b.county || '');
        const c = ca.localeCompare(cb);
        if (c !== 0) return c;
      }
      const ta = String(a.townland || '');
      const tb = String(b.townland || '');
      const t = ta.localeCompare(tb);
      if (t !== 0) return t;
      return String(a.smr || '').localeCompare(String(b.smr || ''));
    });

    ordered.forEach(site => {
      const btn = document.createElement('button');
      btn.className = `site-card${selectedSiteId === site.id ? ' active' : ''}`;
      btn.type = 'button';
      const name = titleCaseWords(shortName(site.townland)) || '(no townland)';
      const county = titleCaseWords(site.county || '');
      const meta = `${site.smr || site.id}${county ? ` · ${county}` : ''}`;
      btn.innerHTML = `<div class="name">${escapeHtml(name)}</div><div class="meta">${escapeHtml(meta)}</div>`;
      btn.addEventListener('click', () => goToSite(site));
      els.siteList.appendChild(btn);
    });
  }

  async function goToSite(site) {
    cameraState.observerMode = false;
    syncPanoramaButton();
    selectedSiteId = site.id;
    selectedSite = site;
    previewNotesSite = null;
    currentFocus = { lat: site.lat, lng: site.lng };
    const nm = titleCaseWords(shortName(site.townland)) || '(no townland)';
    const smr = site.smr || site.id || '';
    // Preload state: grey background, no site text/notes until DEM mesh renders.
    setStageDemReady(false);
    setStageLoadingText('Loading DEM…');
    // Always reset progress when selecting a new view.
    resetStageLoadingProgress({ start: 0 });
    // Start at a visible baseline and allow smooth creep.
    setStageLoadingProgress(0.02, { indeterminate: false, cap: 0.18 });
    if (els.title) els.title.textContent = '';
    if (els.typeLine) els.typeLine.textContent = '';
    if (els.subtitle) els.subtitle.textContent = '';
    updateNotesPanel();
    cameraState.pitch = 8;
    cameraState.bearing = 28;
    cameraState.distance = 1850;
    renderSites();
    updateFocusTarget();
    updateCamera();
    try {
      await buildTerrain(currentFocus);
      // DEM is now rendered (terrain mesh built + added). Reveal site UI.
      if (selectedSiteId === site.id) {
        setStageLoadingProgress(1);
        setStageDemReady(true);
        syncPanoramaButton();
        updateNotesPanel();
        await enableRelationalMonumentsForCurrentView();
        setSidebarHidden(true);
      }
    } catch (e) {
      setStageLoadingText(`Failed to load DEM: ${e?.message || String(e)}`);
      setStageLoadingProgress(0.02, { indeterminate: true });
    }
  }

  async function goToObserverLocation(lat, lng) {
    const cleanLat = Number(lat);
    const cleanLng = Number(lng);
    if (!Number.isFinite(cleanLat) || !Number.isFinite(cleanLng) || cleanLat < -90 || cleanLat > 90 || cleanLng < -180 || cleanLng > 180) {
      if (els.observerStatus) els.observerStatus.textContent = 'Enter a valid latitude and longitude.';
      return;
    }

    const locationSite = {
      id: `location-${cleanLat.toFixed(6)}-${cleanLng.toFixed(6)}`,
      smr: 'Location',
      townland: 'View Location',
      county: '',
      lat: cleanLat,
      lng: cleanLng,
      props: {
        MONUMENT_CLASS: 'View Location',
        TOWNLAND: 'View Location',
        LATITUDE: cleanLat,
        LONGITUDE: cleanLng,
        WEB_NOTES: 'Standard camera view for specified latitude and longitude.'
      }
    };

    cameraState.observerMode = false;
    syncPanoramaButton();
    cameraState.observerHeightOffsetM = OBSERVER_HEIGHT_OFFSET_M;
    selectedSiteId = locationSite.id;
    selectedSite = locationSite;
    previewNotesSite = null;
    currentFocus = { lat: cleanLat, lng: cleanLng };
    cameraState.pitch = 8;
    cameraState.bearing = 28;
    cameraState.distance = 1850;

    setStageDemReady(false);
    setStageLoadingText('Loading location terrain...');
    resetStageLoadingProgress({ start: 0 });
    setStageLoadingProgress(0.02, { indeterminate: false, cap: 0.18 });
    if (els.title) els.title.textContent = '';
    if (els.typeLine) els.typeLine.textContent = '';
    if (els.subtitle) els.subtitle.textContent = '';
    if (els.observerStatus) els.observerStatus.textContent = 'Loading standard camera view for location...';
    updateNotesPanel();
    updateFocusTarget();
    updateCamera();

    try {
      await buildTerrain(currentFocus);
      if (selectedSiteId === locationSite.id) {
        setStageLoadingProgress(1);
        setStageDemReady(true);
        syncPanoramaButton();
        updateNotesPanel();
        await enableRelationalMonumentsForCurrentView();
        setSidebarHidden(true);
        if (els.observerStatus) els.observerStatus.textContent = `Viewing ${cleanLat.toFixed(6)}, ${cleanLng.toFixed(6)} with standard camera and relational monuments.`;
      }
    } catch (e) {
      setStageLoadingText(`Failed to load location DEM: ${e?.message || String(e)}`);
      setStageLoadingProgress(0.02, { indeterminate: true });
      if (els.observerStatus) els.observerStatus.textContent = `Failed: ${e?.message || String(e)}`;
    }
  }

  function updateCamera() {
    const observer = observerCameraLocal();
    if (observer) {
      const pitchRad = THREE.MathUtils.degToRad(cameraState.pitch);
      const bearingRad = THREE.MathUtils.degToRad(cameraState.bearing);
      const lookDistance = 120;
      camera.position.set(observer.x, observer.y, observer.z);
      camera.lookAt(
        observer.x - Math.sin(bearingRad) * Math.cos(pitchRad) * lookDistance,
        observer.y + Math.sin(pitchRad) * lookDistance,
        observer.z + Math.cos(bearingRad) * Math.cos(pitchRad) * lookDistance
      );
      els.zoom.textContent = 'observer';
      els.pitch.textContent = Math.round(cameraState.pitch);
      els.bearing.textContent = ((Math.round(cameraState.bearing) % 360) + 360) % 360;
      updateObserverStatus();
      return;
    }
    const pitchRad = THREE.MathUtils.degToRad(cameraState.pitch);
    const bearingRad = THREE.MathUtils.degToRad(cameraState.bearing);
    const horizontal = Math.cos(pitchRad) * cameraState.distance;
    const y = Math.sin(pitchRad) * cameraState.distance;
    camera.position.set(
      cameraState.target.x + Math.sin(bearingRad) * horizontal,
      cameraState.target.y + y,
      cameraState.target.z + Math.cos(bearingRad) * horizontal
    );
    camera.lookAt(cameraState.target);
    els.zoom.textContent = Math.round(cameraState.distance);
    els.pitch.textContent = Math.round(cameraState.pitch);
    els.bearing.textContent = ((Math.round(cameraState.bearing) % 360) + 360) % 360;
  }

  function resize() {
    const w = els.container.clientWidth || window.innerWidth;
    const h = els.container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (els.labelLines) {
      els.labelLines.setAttribute('width', String(w));
      els.labelLines.setAttribute('height', String(h));
      els.labelLines.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
    updateFlatLabels();
    updateRelationalMarkers();
    if (els.legendInline && els.showLegend && els.showLegend.checked) {
      const now = performance.now();
      if ((now - legendLastUpdate) > 350) {
        legendLastUpdate = now;
        updateLegendPanel();
      }
    }
  }

  function setSidebarHidden(hidden) {
    const shell = document.querySelector('.app-shell');
    if (!shell) return;
    shell.classList.toggle('sidebar-hidden', !!hidden);
    if (toggleSidebarBtn) toggleSidebarBtn.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    if (sidebarPeekBtn) sidebarPeekBtn.setAttribute('aria-hidden', hidden ? 'false' : 'true');
    // Resize after the transition so the renderer/camera match the new viewport.
    window.setTimeout(resize, 260);
    resize();
  }

  let sidebarPeekTimer = 0;

  function scheduleSidebarOpen(delayMs = 420) {
    clearTimeout(sidebarPeekTimer);
    sidebarPeekTimer = window.setTimeout(() => setSidebarHidden(false), delayMs);
  }

  function cancelScheduledSidebarOpen() {
    clearTimeout(sidebarPeekTimer);
    sidebarPeekTimer = 0;
  }

  function setControlsHidden(hidden) {
    const shell = document.querySelector('.app-shell');
    if (!shell) return;
    shell.classList.toggle('controls-hidden', !!hidden);
    if (hideControlsBtn) hideControlsBtn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    // Controls affect available viewport; keep renderer in sync.
    window.setTimeout(resize, 60);
    resize();
  }

  function syncPanoramaButton() {
    if (!panoramaViewBtn) return;
    panoramaViewBtn.classList.toggle('active', !!cameraState.observerMode);
    panoramaViewBtn.setAttribute('aria-pressed', cameraState.observerMode ? 'true' : 'false');
    panoramaViewBtn.setAttribute('data-tip', cameraState.observerMode ? 'Exit panorama view' : 'Panorama first-person view');
    panoramaViewBtn.setAttribute('aria-label', cameraState.observerMode ? 'Exit panorama view' : 'Panorama first-person view');
  }

  async function setPanoramaMode(enabled) {
    if (enabled) {
      const focus = selectedSite
        ? { lat: Number(selectedSite.lat), lng: Number(selectedSite.lng) }
        : currentFocus
          ? { lat: Number(currentFocus.lat), lng: Number(currentFocus.lng) }
          : null;
      if (!focus || !Number.isFinite(focus.lat) || !Number.isFinite(focus.lng)) {
        if (els.observerStatus) els.observerStatus.textContent = 'Load a site or enter a lat/lon before enabling panorama.';
        return;
      }
      currentFocus = focus;
      cameraState.observerMode = true;
      cameraState.observerHeightOffsetM = OBSERVER_HEIGHT_OFFSET_M;
      cameraState.pitch = 0;
      if (els.observerLat) els.observerLat.value = String(focus.lat);
      if (els.observerLon) els.observerLon.value = String(focus.lng);
      syncPanoramaButton();
      if (!currentPatch) await buildTerrain(currentFocus);
      updateFocusTarget();
      updateCamera();
      updateObserverStatus();
      return;
    }

    cameraState.observerMode = false;
    cameraState.pitch = Math.max(8, cameraState.pitch);
    syncPanoramaButton();
    updateFocusTarget();
    updateCamera();
  }

  function isFullscreen() {
    return !!document.fullscreenElement;
  }

  function syncFullscreenButton() {
    if (!fullscreenViewBtn) return;
    const on = isFullscreen();
    fullscreenViewBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    fullscreenViewBtn.setAttribute('data-tip', on ? 'Exit fullscreen' : 'Fullscreen');
    fullscreenViewBtn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
    const icon = fullscreenViewBtn.querySelector('i');
    if (icon) icon.className = on ? 'ph-bold ph-arrows-in' : 'ph-bold ph-arrows-out';
    window.setTimeout(resize, 80);
    resize();
  }

  async function toggleFullscreen() {
    if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) return;
    const shell = document.querySelector('.app-shell') || document.documentElement;
    try {
      if (isFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      } else if (shell.requestFullscreen) {
        await shell.requestFullscreen({ navigationUI: 'hide' });
      } else if (shell.webkitRequestFullscreen) {
        await shell.webkitRequestFullscreen();
      }
    } catch (e) {
      console.warn('Fullscreen request failed', e);
    } finally {
      syncFullscreenButton();
    }
  }

  function setHelpOpen(open) {
    if (!helpOverlay) return;
    helpOverlay.classList.toggle('hidden', !open);
    helpOverlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (helpViewBtn) helpViewBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    if (open) {
      renderHelpMegIconExamples();
      helpOverlay.querySelector('.help-scroll')?.scrollTo({ top: 0, behavior: 'auto' });
      helpCloseBtn?.focus({ preventScroll: true });
    } else {
      helpViewBtn?.focus({ preventScroll: true });
    }
  }

  async function captureStageImage(anchor) {
    if (!els.stage || !window.html2canvas) return;
    closeLabelPopup();
    updateCamera();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const canvas = await window.html2canvas(els.stage, {
      backgroundColor: null,
      useCORS: true,
      allowTaint: false,
      logging: false,
      scale: Math.min(window.devicePixelRatio || 1, 2),
      ignoreElements: (el) => el?.id === 'help-overlay' || el?.classList?.contains('copied-pop')
    });

    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `archaeoscapes-${stamp}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    link.remove();
    showCopiedPop(anchor, 'Captured !');
  }

  function startOrbitOnce() {
    if (!selectedSite || !currentPatch) return;
    // Cancel any prior orbit.
    orbitToken += 1;
    const token = orbitToken;
    if (orbitRaf) cancelAnimationFrame(orbitRaf);

    currentFocus = { lat: selectedSite.lat, lng: selectedSite.lng };
    if (cameraState.observerMode) cameraState.pitch = 0;
    updateFocusTarget();

    const startBearing = cameraState.bearing;
    const endBearing = startBearing + 360;
    const durationMs = 26000;
    const t0 = performance.now();

    const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    const tick = () => {
      if (token !== orbitToken) return;
      const t = (performance.now() - t0) / durationMs;
      if (t >= 1) {
        cameraState.bearing = endBearing;
        updateCamera();
        orbitRaf = 0;
        return;
      }
      cameraState.bearing = startBearing + (endBearing - startBearing) * easeInOut(Math.max(0, Math.min(1, t)));
      updateCamera();
      orbitRaf = requestAnimationFrame(tick);
    };
    orbitRaf = requestAnimationFrame(tick);
  }

  const SAVED_VIEWS_DB = 'archaeoscapes-tour-views';
  const SAVED_VIEWS_STORE = 'views';
  const SETTINGS_STORE = 'settings';
  const MONUMENT_SELECTION_SETTING_ID = 'monument-selection';
  const SAVED_VIEWS_ENABLED_KEY = 'archaeoscapes_saved_views_enabled';
  const MONUMENT_SELECTION_ENABLED_KEY = 'archaeoscapes_monument_selection_enabled';

  function savedViewsEnabled() {
    return localStorage.getItem(SAVED_VIEWS_ENABLED_KEY) !== 'false';
  }

  function monumentSelectionStorageEnabled() {
    return localStorage.getItem(MONUMENT_SELECTION_ENABLED_KEY) !== 'false';
  }

  function setSavedViewsStatus(text) {
    if (els.savedViewsStatus) els.savedViewsStatus.textContent = String(text || '');
  }

  function openSavedViewsDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(SAVED_VIEWS_DB, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SAVED_VIEWS_STORE)) {
          db.createObjectStore(SAVED_VIEWS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Failed to open saved views database.'));
    });
  }

  async function savedViewsTx(mode, fn, storeName = SAVED_VIEWS_STORE) {
    const db = await openSavedViewsDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let out;
      tx.oncomplete = () => { db.close(); resolve(out); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('Saved views database error.')); };
      out = fn(store);
    });
  }

  async function getSavedViews() {
    return savedViewsTx('readonly', (store) => {
      const req = store.getAll();
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function putSavedView(view) {
    return savedViewsTx('readwrite', (store) => store.put(view));
  }

  async function deleteSavedView(id) {
    return savedViewsTx('readwrite', (store) => store.delete(id));
  }

  async function clearSavedViews() {
    return savedViewsTx('readwrite', (store) => store.clear());
  }

  async function getMonumentSelectionSetting() {
    return savedViewsTx('readonly', (store) => {
      const req = store.get(MONUMENT_SELECTION_SETTING_ID);
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }, SETTINGS_STORE);
  }

  async function saveMonumentSelectionSetting() {
    if (!monumentSelectionStorageEnabled()) return;
    const classes = Array.from(selectedMonumentClasses.values()).map(String).filter(Boolean);
    await savedViewsTx('readwrite', (store) => store.put({
      id: MONUMENT_SELECTION_SETTING_ID,
      classes,
      updatedAt: Date.now()
    }), SETTINGS_STORE);
  }

  async function clearMonumentSelectionSetting() {
    await savedViewsTx('readwrite', (store) => store.delete(MONUMENT_SELECTION_SETTING_ID), SETTINGS_STORE);
  }

  function compactSiteForState(site) {
    if (!site) return null;
    const props = site.props || {};
    return {
      id: site.id || monumentStableKey(props, site.lng, site.lat),
      smr: site.smr || props.SMRS || props.SMRNo || props.SMR_NO || props.SMR || '',
      townland: site.townland || props.TOWNLAND || props.Townland_s_ || props.Townland_s || '',
      county: site.county || props.COUNTY || '',
      lat: Number(site.lat),
      lng: Number(site.lng),
      props
    };
  }

  function currentMonumentMode() {
    if (showAllMonuments) return 'all';
    if (showAllRelational) return 'relational';
    if (showRelatedMonuments) return 'type';
    return null;
  }

  function captureViewState(name = '') {
    const shell = document.querySelector('.app-shell');
    return {
      version: 1,
      name: String(name || '').trim(),
      savedAt: Date.now(),
      selectedSite: compactSiteForState(selectedSite),
      focus: currentFocus ? { lat: Number(currentFocus.lat), lng: Number(currentFocus.lng) } : null,
      camera: { pitch: cameraState.pitch, bearing: cameraState.bearing, distance: cameraState.distance },
      imageryKey,
      demAreaKey,
      verticalExaggeration,
      activeType,
      selectedClasses: Array.from(selectedMonumentClasses.values()),
      monumentMode: currentMonumentMode(),
      ranges: { related: relatedRangeM, allRelational: allRelationalRangeM },
      toggles: {
        showNotes: !!els.showNotes?.checked,
        showLegend: !!els.showLegend?.checked,
        showAllLabels,
        sidebarHidden: !!shell?.classList.contains('sidebar-hidden'),
        controlsHidden: !!shell?.classList.contains('controls-hidden')
      },
      openLabels: labelItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        stableKey: monumentStableKey(item.props || {}, item.lng, item.lat),
        active: item.id === activeLabelId
      }))
    };
  }

  function encodeViewState(state) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
  }

  function decodeViewState(encoded) {
    return JSON.parse(decodeURIComponent(escape(atob(String(encoded || '')))));
  }

  function shareUrlForState(state) {
    const url = new URL(window.location.href);
    url.hash = `view=${encodeViewState(state)}`;
    return url.toString();
  }

  function promptSavedViewName(defaultName) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'saved-view-pop';
      overlay.innerHTML = `
        <div class="saved-view-pop-card" role="dialog" aria-modal="true" aria-label="Save view">
          <div class="saved-view-pop-title">Save View</div>
          <input class="saved-view-pop-input" type="text" maxlength="80" value="${escapeHtml(defaultName || 'Saved View')}" aria-label="Saved view name">
          <div class="saved-view-pop-actions">
            <button type="button" data-cancel>Cancel</button>
            <button type="button" data-save>Save</button>
          </div>
        </div>
      `;
      const input = overlay.querySelector('.saved-view-pop-input');
      const close = (value) => {
        overlay.remove();
        resolve(value);
      };
      overlay.querySelector('[data-cancel]')?.addEventListener('click', () => close(null));
      overlay.querySelector('[data-save]')?.addEventListener('click', () => close(String(input?.value || '').trim()));
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter') close(String(input?.value || '').trim());
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(null);
      });
      document.body.appendChild(overlay);
      input?.focus();
      input?.select();
    });
  }

  async function saveCurrentView() {
    if (!savedViewsEnabled()) {
      setSavedViewsStatus('Stored views are disabled.');
      return;
    }
    const fallback = selectedSite ? (titleCaseWords(shortName(selectedSite.townland)) || 'Saved View') : 'Saved View';
    const name = await promptSavedViewName(fallback);
    if (!name) return;
    const state = captureViewState(name);
    const item = { id: `view-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: state.name, savedAt: state.savedAt, state };
    await putSavedView(item);
    await renderSavedViewsList();
    setSavedViewsStatus(`Saved "${state.name}".`);
  }

  function findMarkerForStableKey(stableKey) {
    const lists = [relatedMarkers, relationalMarkers, allMonumentMarkers];
    for (const list of lists) {
      const match = list.find(m => monumentStableKey(m.props || {}, m.lng, m.lat) === stableKey);
      if (match) return match;
    }
    return null;
  }

  function restoreOpenLabels(state) {
    const labels = Array.isArray(state?.openLabels) ? state.openLabels : [];
    for (const saved of labels) {
      if (!saved || saved.id === 'selected-site') continue;
      const marker = findMarkerForStableKey(saved.stableKey);
      if (!marker || hasLabel(saved.id)) continue;
      addFlatLabel({
        id: saved.id,
        className: 'nms',
        kind: saved.kind || 'all',
        local: marker.local,
        lat: marker.lat,
        lng: marker.lng,
        props: marker.props,
        text: markerLabelText(marker.props || {}),
        detail: markerLabelDetail(marker.props || {})
      });
    }
    const active = labels.find(x => x?.active);
    if (active && hasLabel(active.id)) setActiveLabelById(active.id);
    updateNotesPanel();
  }

  async function restoreViewState(state) {
    if (!state || typeof state !== 'object') return;
    if (Array.isArray(state.selectedClasses) && state.selectedClasses.length) {
      selectedMonumentClasses = new Set(state.selectedClasses.map(String).filter(Boolean));
      await cacheIconsForSelected();
      renderTypeList();
    }
    activeType = state.activeType || activeType;
    imageryKey = state.imageryKey || imageryKey;
    demAreaKey = state.demAreaKey === 'double' ? 'double' : 'standard';
    verticalExaggeration = Number(state.verticalExaggeration ?? verticalExaggeration) || 0;
    if (els.heightSlider) els.heightSlider.value = String(verticalExaggeration);
    if (els.heightValue) els.heightValue.textContent = `${verticalExaggeration.toFixed(1)}x`;
    cameraState.pitch = Number(state.camera?.pitch ?? cameraState.pitch);
    cameraState.bearing = Number(state.camera?.bearing ?? cameraState.bearing);
    cameraState.distance = Number(state.camera?.distance ?? cameraState.distance);
    relatedRangeM = Number(state.ranges?.related ?? relatedRangeM) || 0;
    allRelationalRangeM = Number(state.ranges?.allRelational ?? allRelationalRangeM) || 0;
    if (els.relatedRange) els.relatedRange.value = String(relatedRangeM);
    if (els.relatedRangeValue) els.relatedRangeValue.textContent = rangeText(relatedRangeM);
    if (els.allRelationalRange) els.allRelationalRange.value = String(allRelationalRangeM);
    if (els.allRelationalRangeValue) els.allRelationalRangeValue.textContent = rangeText(allRelationalRangeM);
    if (els.showNotes) els.showNotes.checked = !!state.toggles?.showNotes;
    if (els.showLegend) els.showLegend.checked = !!state.toggles?.showLegend;
    showAllLabels = !!state.toggles?.showAllLabels;
    if (els.showAllLabels) els.showAllLabels.checked = showAllLabels;
    setControlsHidden(!!state.toggles?.controlsHidden);
    setSidebarHidden(!!state.toggles?.sidebarHidden);
    const mode = state.monumentMode || null;
    showRelatedMonuments = mode === 'type';
    showAllRelational = mode === 'relational';
    showAllMonuments = mode === 'all';
    if (els.showRelatedMonuments) els.showRelatedMonuments.checked = showRelatedMonuments;
    if (els.showAllRelational) els.showAllRelational.checked = showAllRelational;
    if (els.showAllMonuments) els.showAllMonuments.checked = showAllMonuments;
    normalizeExclusiveMonumentMode();
    const site = state.selectedSite || (state.focus ? { id: `view-${state.focus.lat},${state.focus.lng}`, lat: state.focus.lat, lng: state.focus.lng, townland: '', county: '', smr: '', props: {} } : null);
    if (site && isFinite(site.lat) && isFinite(site.lng)) {
      await goToSite(site);
      restoreOpenLabels(state);
      updateLegendPanel();
    } else {
      updateCamera();
    }
  }

  async function renderSavedViewsList() {
    if (!els.savedViewsList) return;
    els.savedViewsList.replaceChildren();
    if (!savedViewsEnabled()) {
      setSavedViewsStatus('Stored views are disabled.');
      return;
    }
    let views = [];
    try {
      views = await getSavedViews();
    } catch (e) {
      setSavedViewsStatus(`Saved views unavailable: ${e?.message || e}`);
      return;
    }
    views.sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
    setSavedViewsStatus('');
    for (const view of views) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'saved-view-item';
      const savedSite = view.state?.selectedSite || {};
      const savedProps = savedSite.props || {};
      const monumentClass = String(savedProps.MONUMENT_CLASS || view.state?.activeType || '').trim();
      const smr = String(savedSite.smr || savedProps.SMRS || savedProps.SMRNo || '').trim();
      const county = titleCaseWords(savedSite.county || savedProps.COUNTY || '');
      const meta = [smr, county].filter(Boolean).join(' · ');
      row.innerHTML = `
        <span class="saved-icon megicon"></span>
        <span><span class="saved-name">${escapeHtml(view.name || 'Saved view')}</span><span class="saved-meta">${escapeHtml(meta)}</span></span>
        <span class="saved-view-delete" role="button" title="Delete saved view"><i class="ph-bold ph-trash"></i></span>
      `;
      renderMegIconInto(row.querySelector('.saved-icon'), monumentClass, TOUR_LIST_ICON_SIZE);
      row.addEventListener('click', async (e) => {
        if (e.target.closest('.saved-view-delete')) {
          e.stopPropagation();
          await deleteSavedView(view.id);
          await renderSavedViewsList();
          return;
        }
        await restoreViewState(view.state);
      });
      els.savedViewsList.appendChild(row);
    }
  }

  async function restoreViewFromHash() {
    const raw = window.location.hash.match(/(?:^#|&)view=([^&]+)/)?.[1];
    if (!raw) return;
    try {
      await restoreViewState(decodeViewState(raw));
    } catch (e) {
      setSavedViewsStatus(`Failed to restore shared view: ${e?.message || e}`);
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s ?? '');
    return div.innerHTML;
  }

  bindContinuousActionButtons(document.querySelector('.controls'), applyCameraAction);

  // Stage toolbar (top-left)
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const shell = document.querySelector('.app-shell');
      const hidden = !!shell?.classList.contains('sidebar-hidden');
      setSidebarHidden(!hidden);
    });
  }
  if (sidebarPeekBtn) {
    const openSidebarSlowly = (e) => {
      e.stopPropagation();
      scheduleSidebarOpen(e.pointerType === 'touch' ? 260 : 520);
    };
    sidebarPeekBtn.addEventListener('mouseenter', openSidebarSlowly);
    sidebarPeekBtn.addEventListener('mouseleave', cancelScheduledSidebarOpen);
    sidebarPeekBtn.addEventListener('pointerdown', openSidebarSlowly);
    sidebarPeekBtn.addEventListener('pointerup', cancelScheduledSidebarOpen);
    sidebarPeekBtn.addEventListener('pointercancel', cancelScheduledSidebarOpen);
    sidebarPeekBtn.addEventListener('focus', () => scheduleSidebarOpen(420));
    sidebarPeekBtn.addEventListener('blur', cancelScheduledSidebarOpen);
    sidebarPeekBtn.setAttribute('aria-hidden', 'true');
  }
  if (hideControlsBtn) {
    hideControlsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const shell = document.querySelector('.app-shell');
      const hidden = !!shell?.classList.contains('controls-hidden');
      setControlsHidden(!hidden);
    });
  }
  if (fullscreenViewBtn) {
    fullscreenViewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullscreen();
    });
    document.addEventListener('fullscreenchange', syncFullscreenButton);
    document.addEventListener('webkitfullscreenchange', syncFullscreenButton);
    syncFullscreenButton();
  }
  if (panoramaViewBtn) {
    panoramaViewBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await setPanoramaMode(!cameraState.observerMode);
    });
    syncPanoramaButton();
  }
  if (helpViewBtn) {
    helpViewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !!helpOverlay && !helpOverlay.classList.contains('hidden');
      setHelpOpen(!open);
    });
  }
  captureViewBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await captureStageImage(e.currentTarget);
    } catch (err) {
      console.warn('Capture failed', err);
      showCopiedPop(e.currentTarget, 'Capture failed');
    }
  });
  loadingHelpViewBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    setHelpOpen(true);
  });
  helpCloseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    setHelpOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!helpOverlay || helpOverlay.classList.contains('hidden')) return;
    setHelpOpen(false);
  });
  if (orbitSiteBtn) {
    orbitSiteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startOrbitOnce();
    });
  }
  if (saveViewBtn) {
    saveViewBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await saveCurrentView();
    });
  }
  if (copyViewBtn) {
    copyViewBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const state = captureViewState();
      await copyText(shareUrlForState(state));
      showCopiedPop(e.currentTarget);
    });
  }
  if (els.savedViewsEnabled) {
    els.savedViewsEnabled.checked = savedViewsEnabled();
    els.savedViewsEnabled.addEventListener('change', async () => {
      localStorage.setItem(SAVED_VIEWS_ENABLED_KEY, els.savedViewsEnabled.checked ? 'true' : 'false');
      await renderSavedViewsList();
    });
  }
  els.savedViewPurge?.addEventListener('click', async () => {
    if (!window.confirm('Purge all saved view data from this browser?')) return;
    await clearSavedViews();
    await renderSavedViewsList();
    setSavedViewsStatus('Saved view data purged.');
  });
  if (els.saveMonumentSelectionEnabled) {
    els.saveMonumentSelectionEnabled.checked = monumentSelectionStorageEnabled();
    els.saveMonumentSelectionEnabled.addEventListener('change', async () => {
      const enabled = !!els.saveMonumentSelectionEnabled.checked;
      localStorage.setItem(MONUMENT_SELECTION_ENABLED_KEY, enabled ? 'true' : 'false');
      if (enabled) await saveMonumentSelectionSetting();
      else await clearMonumentSelectionSetting();
    });
  }
  els.resetMonumentSelection?.addEventListener('click', async () => {
    await applyDefaultMonumentSelection({ persist: monumentSelectionStorageEnabled() });
  });

  document.getElementById('imagery-options')?.addEventListener('change', async (e) => {
    const input = e.target.closest('input[name="imagery-base"]');
    if (!input) return;
    imageryKey = input.value;
    await buildTerrain(currentFocus || selectedSite || sites[0]);
  });

  // Mutually exclusive monument marker modes (keep checkboxes; ticking one unticks the others).
  let monumentModeSync = false;
  const setChecked = (input, checked) => {
    if (!input) return;
    if (!!input.checked === !!checked) return;
    input.checked = !!checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const enforceExclusiveMonumentMode = (mode) => {
    if (monumentModeSync) return;
    monumentModeSync = true;
    try {
      if (mode === 'type') {
        setChecked(els.showAllRelational, false);
        setChecked(els.showAllMonuments, false);
      } else if (mode === 'relational') {
        setChecked(els.showRelatedMonuments, false);
        setChecked(els.showAllMonuments, false);
      } else if (mode === 'all') {
        setChecked(els.showRelatedMonuments, false);
        setChecked(els.showAllRelational, false);
      }
    } finally {
      monumentModeSync = false;
    }
  };
  const normalizeExclusiveMonumentMode = () => {
    if (els.showAllMonuments?.checked) enforceExclusiveMonumentMode('all');
    else if (els.showAllRelational?.checked) enforceExclusiveMonumentMode('relational');
    else if (els.showRelatedMonuments?.checked) enforceExclusiveMonumentMode('type');
  };

  if (els.showRelatedMonuments) {
    showRelatedMonuments = !!els.showRelatedMonuments.checked;
    els.showRelatedMonuments.addEventListener('change', async () => {
      showRelatedMonuments = !!els.showRelatedMonuments.checked;
      if (showRelatedMonuments) enforceExclusiveMonumentMode('type');
      if (!currentPatch) { syncShowAllLabelsState(); return; }
      if (!showRelatedMonuments) {
        relatedLoadToken++;
        clearRelatedLabels();
        clearRelatedMarkers();
        clearLabelsByKind('relatedRelational');
        syncShowAllLabelsState();
        return;
      }
      await addNmsMarkers();
      syncShowAllLabelsState();
    });
  }

  if (els.relatedRange) {
    relatedRangeM = Number(els.relatedRange.value) || 0;
    if (els.relatedRangeValue) els.relatedRangeValue.textContent = rangeText(relatedRangeM);
    els.relatedRange.addEventListener('input', async () => {
      relatedRangeM = Number(els.relatedRange.value) || 0;
      if (els.relatedRangeValue) els.relatedRangeValue.textContent = rangeText(relatedRangeM);
    });
    els.relatedRange.addEventListener('change', async () => {
      if (!currentPatch || !showRelatedMonuments) return;
      await addNmsMarkers();
    });
  }

  if (els.showAllLabels) {
    showAllLabels = !!els.showAllLabels.checked;
    els.showAllLabels.addEventListener('change', async () => {
      showAllLabels = !!els.showAllLabels.checked;
      if (!showAllLabels) {
        allLabelsQueryKey = null;
        allLabelsLoadToken++;
        removeNonSelectedLabels();
        return;
      }
      // If there are no relational marker sources, immediately switch back off.
      if (!showRelatedMonuments && !showAllRelational && !showAllMonuments) {
        showAllLabels = false;
        els.showAllLabels.checked = false;
        removeNonSelectedLabels();
        return;
      }
      rebuildAllLabelsFromShownMarkers();
    });
  }

  if (els.showAllRelational) {
    showAllRelational = !!els.showAllRelational.checked;
    els.showAllRelational.addEventListener('change', async () => {
      showAllRelational = !!els.showAllRelational.checked;
      if (showAllRelational) enforceExclusiveMonumentMode('relational');
      if (!currentPatch) { syncShowAllLabelsState(); return; }
      if (!showAllRelational) {
        relationalLoadToken++;
        clearRelationalMarkers();
        clearLabelsByKind('relational');
        syncShowAllLabelsState();
        return;
      }
      await loadRelationalMarkersInView();
      syncShowAllLabelsState();
    });
  }

  if (els.showAllMonuments) {
    showAllMonuments = !!els.showAllMonuments.checked;
    els.showAllMonuments.addEventListener('change', async () => {
      showAllMonuments = !!els.showAllMonuments.checked;
      if (showAllMonuments) enforceExclusiveMonumentMode('all');
      if (!currentPatch) { syncShowAllLabelsState(); return; }
      if (!showAllMonuments) {
        relationalLoadToken++;
        clearAllMonumentMarkers();
        clearLabelsByKind('monumentsRelational');
        syncShowAllLabelsState();
        return;
      }
      await loadAllMonumentMarkersInView();
      syncShowAllLabelsState();
    });
  }

  if (els.allRelationalRange) {
    allRelationalRangeM = Number(els.allRelationalRange.value) || 0;
    if (els.allRelationalRangeValue) els.allRelationalRangeValue.textContent = rangeText(allRelationalRangeM);
    els.allRelationalRange.addEventListener('input', async () => {
      allRelationalRangeM = Number(els.allRelationalRange.value) || 0;
      if (els.allRelationalRangeValue) els.allRelationalRangeValue.textContent = rangeText(allRelationalRangeM);
    });
    els.allRelationalRange.addEventListener('change', async () => {
      if (!currentPatch || !showAllRelational) return;
      await loadRelationalMarkersInView();
    });
  }

  // Normalize any persisted/initial state (only one monument mode should be active).
  normalizeExclusiveMonumentMode();

  if (els.showNotes) {
    els.showNotes.addEventListener('change', () => {
      updateNotesPanel();
    });
  }
  
  // Display Options toolbar (top-right) mirrors sidebar toggles.
  const displayToolbar = document.getElementById('display-toolbar');
  if (displayToolbar) {
    const hintEl = document.getElementById('display-toolbar-hint');
    const btns = Array.from(displayToolbar.querySelectorAll('button[data-toggle]'));
    const resetBtn = displayToolbar.querySelector('#reset-view');
    const refresh = () => {
      for (const b of btns) {
        const targetId = b.getAttribute('data-toggle');
        const input = targetId ? document.getElementById(targetId) : null;
        const on = !!input?.checked;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    };
    const setHint = (s) => {
      if (!hintEl) return;
      hintEl.textContent = String(s || '');
    };
    for (const b of btns) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = b.getAttribute('data-toggle');
        const input = targetId ? document.getElementById(targetId) : null;
        if (!input) return;
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        refresh();
      });
      b.addEventListener('pointerenter', () => setHint(b.getAttribute('data-tip') || ''));
      b.addEventListener('pointerleave', () => setHint(''));
    }
    resetBtn?.addEventListener('pointerenter', () => setHint(resetBtn.getAttribute('data-tip') || ''));
    resetBtn?.addEventListener('pointerleave', () => setHint(''));
    displayToolbar.addEventListener('pointerleave', () => setHint(''));
    // Keep in sync when sidebar checkboxes change.
    for (const b of btns) {
      const targetId = b.getAttribute('data-toggle');
      const input = targetId ? document.getElementById(targetId) : null;
      input?.addEventListener('change', refresh);
    }
    refresh();
  }

  els.demAreaOptions?.addEventListener('change', async (e) => {
    const input = e.target.closest('input[name="dem-area"]');
    if (!input) return;
    demAreaKey = input.value === 'double' ? 'double' : 'standard';
    await buildTerrain(currentFocus || selectedSite || sites[0]);
  });

  els.heightSlider?.addEventListener('input', () => {
    verticalExaggeration = Number(els.heightSlider.value) || 0;
    if (els.heightValue) els.heightValue.textContent = `${verticalExaggeration.toFixed(1)}x`;
    rebuildTerrainHeights();
    if (cameraState.observerMode) updateCamera();
  });

  els.observerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await goToObserverLocation(Number(els.observerLat?.value), Number(els.observerLon?.value));
  });

  document.getElementById('reset-view').addEventListener('click', () => {
    cameraState.pitch = cameraState.observerMode ? 0 : 8;
    cameraState.bearing = 28;
    cameraState.distance = 1850;
    if (selectedSite) {
      currentFocus = { lat: selectedSite.lat, lng: selectedSite.lng };
      updateFocusTarget();
      scheduleTerrainReloadIfNeeded(true);
    }
    updateCamera();
  });

  const stagePointers = new Map();
  let stageGesture = null;

  function pointerList() {
    return Array.from(stagePointers.values());
  }

  function distanceBetweenPointers(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpointBetweenPointers(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function panFocusFromScreenDelta(dx, dy) {
    if (!currentFocus) return;
    const metersPerPixel = Math.max(0.8, cameraState.distance / 520);
    moveFocus(dy * metersPerPixel, -dx * metersPerPixel);
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    closeLabelPopup();
    stagePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch (_) {}
    const points = pointerList();
    if (points.length >= 2) {
      const [a, b] = points;
      stageGesture = {
        mode: 'pinch-pan',
        distance: distanceBetweenPointers(a, b),
        midpoint: midpointBetweenPointers(a, b)
      };
    } else {
      stageGesture = { mode: 'orbit', last: { x: e.clientX, y: e.clientY } };
    }
  }, { passive: false });

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!stagePointers.has(e.pointerId) || !stageGesture) return;
    e.preventDefault();
    stagePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const points = pointerList();
    if (points.length >= 2) {
      const [a, b] = points;
      const nextDistance = distanceBetweenPointers(a, b);
      const nextMidpoint = midpointBetweenPointers(a, b);
      if (stageGesture.mode !== 'pinch-pan') {
        stageGesture = { mode: 'pinch-pan', distance: nextDistance, midpoint: nextMidpoint };
        return;
      }
      const scale = nextDistance > 0 && stageGesture.distance > 0 ? stageGesture.distance / nextDistance : 1;
      const dx = nextMidpoint.x - stageGesture.midpoint.x;
      const dy = nextMidpoint.y - stageGesture.midpoint.y;
      cameraState.distance = Math.max(380, Math.min(6500, cameraState.distance * scale));
      panFocusFromScreenDelta(dx, dy);
      stageGesture.distance = nextDistance;
      stageGesture.midpoint = nextMidpoint;
      updateCamera();
      return;
    }

    if (stageGesture.mode !== 'orbit') {
      stageGesture = { mode: 'orbit', last: { x: e.clientX, y: e.clientY } };
      return;
    }
    const dx = e.clientX - stageGesture.last.x;
    const dy = e.clientY - stageGesture.last.y;
    cameraState.bearing -= dx * 0.22;
    cameraState.pitch = Math.max(minimumPitchDeg(), Math.min(78, cameraState.pitch + dy * 0.12));
    stageGesture.last = { x: e.clientX, y: e.clientY };
    updateCamera();
  }, { passive: false });

  function releaseStagePointer(e) {
    stagePointers.delete(e.pointerId);
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (_) {}
    const points = pointerList();
    if (points.length === 1) {
      stageGesture = { mode: 'orbit', last: { x: points[0].x, y: points[0].y } };
    } else if (points.length === 0) {
      stageGesture = null;
    }
  }

  renderer.domElement.addEventListener('pointerup', releaseStagePointer);
  renderer.domElement.addEventListener('pointercancel', releaseStagePointer);
  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    closeLabelPopup();
    cameraState.distance = Math.max(380, Math.min(6500, cameraState.distance * (e.deltaY > 0 ? 1.12 : 0.9)));
    if (e.deltaY < 0 && cameraState.distance < 1100) {
      moveFocus(Math.max(60, cameraState.distance * 0.05), 0);
    }
    updateCamera();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const actionByKey = {
      w: 'move-forward',
      W: 'move-forward',
      ArrowUp: 'move-forward',
      s: 'move-back',
      S: 'move-back',
      ArrowDown: 'move-back',
      a: 'move-left',
      A: 'move-left',
      ArrowLeft: 'move-left',
      d: 'move-right',
      D: 'move-right',
      ArrowRight: 'move-right',
      '+': 'zoom-in',
      '=': 'zoom-in',
      '-': 'zoom-out',
      '_': 'zoom-out',
      q: 'rotate-left',
      Q: 'rotate-left',
      e: 'rotate-right',
      E: 'rotate-right'
    };
    const action = actionByKey[e.key];
    if (!action) return;
    e.preventDefault();
    closeLabelPopup();
    applyCameraAction(action, e.repeat ? 1 / 12 : 1 / 8, e.repeat ? 0.7 : 0);
  });

  window.addEventListener('resize', resize);
  resize();
  if (els.heightSlider) verticalExaggeration = Number(els.heightSlider.value) || 0;
  if (els.heightValue) els.heightValue.textContent = `${verticalExaggeration.toFixed(1)}x`;
  updateCamera();
  animate();
  // Initial state: no site selected; keep stage greyed out with a centered status.
  setStageDemReady(false);
  setStageLoadingText('Select a site or use View Location…');
  // Init: no location selected by default. Render types; sites panel stays collapsed until selection.
  renderTypeList();
  setPanelOpen('location', false);
  setPanelOpen('types', true);
  setPanelOpen('sites', false);
  setPanelOpen('saved-views', false);
  setPanelOpen('config', false);
  setPanelOpen('presets', false);
  setPanelOpen('about', false);
  initPresetsUI();
  renderSavedViewsList();
  window.setTimeout(() => {
    if (window.location.hash) restoreViewFromHash();
  }, 250);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-panel-action]');
    if (!btn) return;
    const act = btn.getAttribute('data-panel-action');
    if (act === 'location-toggle') {
      const body = document.querySelector('[data-panel-body="location"]');
      setPanelOpen('location', body?.classList.contains('hidden'));
    }
    if (act === 'types-toggle') {
      const body = document.querySelector('[data-panel-body="types"]');
      setPanelOpen('types', body?.classList.contains('hidden'));
    }
    if (act === 'sites-toggle') {
      const body = document.querySelector('[data-panel-body="sites"]');
      setPanelOpen('sites', body?.classList.contains('hidden'));
    }
    if (act === 'config-toggle') {
      const body = document.querySelector('[data-panel-body="config"]');
      setPanelOpen('config', body?.classList.contains('hidden'));
    }
    if (act === 'saved-views-toggle') {
      const body = document.querySelector('[data-panel-body="saved-views"]');
      setPanelOpen('saved-views', body?.classList.contains('hidden'));
    }
    if (act === 'presets-toggle') {
      const body = document.querySelector('[data-panel-body="presets"]');
      setPanelOpen('presets', body?.classList.contains('hidden'));
    }
    if (act === 'about-toggle') {
      const body = document.querySelector('[data-panel-body="about"]');
      setPanelOpen('about', body?.classList.contains('hidden'));
    }
  }, true);
})();
