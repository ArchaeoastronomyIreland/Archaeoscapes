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
  // Phase 1 terrain: centre Z15 + one outer ring Z13 (~25 km). Z12 ~50 km deferred to Phase 4.
  // Aerial coverage is independent of DEM merge boundaries — UVs map geography to each canvas.
  const HORIZON_MID_Z = 13;
  const HORIZON_MID_TILE_RADIUS = 8;
  const HORIZON_MID_AERIAL_Z = 13;
  const HORIZON_MID_EXTENT_M = 25000;
  const TERRAIN_OUTER_Z = HORIZON_MID_Z;
  const TERRAIN_OUTER_TILE_RADIUS = HORIZON_MID_TILE_RADIUS;
  const TERRAIN_OUTER_AERIAL_Z = HORIZON_MID_AERIAL_Z;
  const TERRAIN_OUTER_EXTENT_M = HORIZON_MID_EXTENT_M;
  // Reserved for Phase 4 — not loaded in Phase 1.
  const HORIZON_OUTER_Z = 12;
  const HORIZON_OUTER_TILE_RADIUS = 8;
  const HORIZON_OUTER_AERIAL_Z = 12;
  const HORIZON_OUTER_EXTENT_M = 50000;
  const HORIZON_STITCH_WIDTH_M = 50;
  const HORIZON_AERIAL_OVERLAP_M = 1000;
  const CAMERA_FAR_M = 70000;
  const GRID = 180;
  const DEFAULT_OBSERVER_LAT = 53.490266;
  const DEFAULT_OBSERVER_LNG = -7.5625666;
  const OBSERVER_HEIGHT_OFFSET_M = 2;
  const VIEWSHED_SCAN_RADIUS_KM = 120;
  const HORIZON_RELATIONAL_ROI_MAX = 12000;
  const HORIZON_RELATIONAL_NI_MAX = 25000;
  const VIEWSHED_DRAW_RADIUS_M = 25000;
  const VIEWSHED_SETTINGS_VERSION = 7;
  const HORIZON_WORKER_URL = './horizon-worker.js?v=20260602-viewshed-horizon';

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
  let terrainOuterRing = null;
  let aerialTexture = null;
  let aerialTextureOuter = null;
  let baseElev = null;
  let baseElevSize = 0;
  let baseCenterElev = 0;
  let horizonPatchMeters = 0;
  let verticalExaggeration = 1.0;

  function effectiveVerticalExaggeration() {
    return cameraState.observerMode ? 1 : verticalExaggeration;
  }
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
  let showHorizonRelational = false;
  let relatedMarkers = [];
  let relationalMarkers = [];
  let allMonumentMarkers = [];
  let horizonClusterMarkers = [];
  let horizonMemberMarkers = [];
  let horizonClusters = [];
  let horizonExpandedClusters = new Set();
  let horizonLoadToken = 0;
  let horizonRelationalLoading = false;
  let horizonFloatM = 500;
  let horizonAzClusterDeg = 0.4;
  let viewshedHorizonWaiters = [];
  let viewshedHorizonToken = 0;
  let viewshedHorizonComputing = false;
  let viewshedHorizonData = null;
  let horizonDrawProfile = null;
  let viewshedHorizonObserver = null;
  let viewshedObserverH = null;
  let horizonFillMesh = null;
  let horizonLineMesh = null;
  let viewshedHorizonLookupTexture = null;
  let viewshedHorizonComputedResKey = null;
  let viewshedHorizonScanRadiusKm = null;
  let viewshedHorizonSettingsVersion = null;
  let fpvHorizonScreenMaskTexture = null;
  let fpvHorizonScreenMaskBuffer = null;
  let fpvHorizonScreenMaskSize = { w: 0, h: 0 };
  let fpvHorizonScreenMaskFallback = null;
  const _fpvHorizonProjVec = new THREE.Vector3();
  // Viewshed horizon is authoritative: do not bias the projected ring upward.
  const FPV_HORIZON_LINE_Y_OFFSET = 0;
  let horizonWorker = null;
  let horizonResKey = 'quick';
  let viewshedRescheduleTimer = null;

  function normalizeHorizonResKey(key) {
    const k = String(key || 'quick');
    if (k === 'max') return 'super';
    return (k === 'hires' || k === 'super') ? k : 'quick';
  }
  let panoramaObserverFocus = null;
  const FPV_LOCKED_MOVE_ACTIONS = new Set(['move-forward', 'move-back', 'move-left', 'move-right']);
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
  let datetimePanelOpen = false;
  let datetimePanelBgOn = true;
  let customLabels = [];
  let customLabelMarkers = [];
  let customLabelPanelOpen = false;
  let customLabelPickMode = false;
  let customLabelPanelBgOn = true;
  let activeLabelId = null;
  let allLabelsLoadToken = 0;
  let relatedLoadToken = 0;
  let relationalLoadToken = 0;
  let siteDemReady = false;
  let externalRenderLock = false;
  let stageResizeObserver = null;
  const displaySettings = {
    brightness: 1.19,
    gamma: 0.84,
    hazeStartM: 12500,
    hazeStrength: 0.19,
    desaturateStrength: 0.19,
    fadeDistanceM: 46000
  };
  const terrainPaintSettings = {
    heightStrength: 0.08,
    relativeHeightStrength: 0.49,
    heightContrast: 2.15,
    hillshadeStrength: 0.47,
    distanceStrength: 0.65,
    distanceDesaturate: 0.90,
    distanceStartM: 5500,
    distanceEndM: 9000,
    distanceBands: false
  };
  let astronomyOverlay = null;

  const cameraState = {
    pitch: 8,
    bearing: 28,
    distance: 1850,
    fov: 45,
    target: new THREE.Vector3(0, 80, 0),
    observerMode: false,
    observerHeightOffsetM: OBSERVER_HEIGHT_OFFSET_M
  };

  const ORBIT_CAMERA_FOV = 45;
  const OBSERVER_FOV_DEFAULT = 45;
  const OBSERVER_FOV_MIN = 2;
  const OBSERVER_FOV_MAX = 75;

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
    sunReadoutWrap: document.getElementById('sun-readout-wrap'),
    sunAltReadout: document.getElementById('sun-alt-readout'),
    sunAziReadout: document.getElementById('sun-azi-readout'),
    moonReadoutWrap: document.getElementById('moon-readout-wrap'),
    moonAltReadout: document.getElementById('moon-alt-readout'),
    moonAziReadout: document.getElementById('moon-azi-readout'),
    stageViewCaption: document.getElementById('stage-view-caption'),
    nmsStatus: document.getElementById('nms-status'),
    presetStatus: document.getElementById('preset-status'),
    presetList: document.getElementById('preset-list'),
    heightSlider: document.getElementById('height-exaggeration'),
    heightValue: document.getElementById('height-exaggeration-value'),
    astroEngine: document.getElementById('astro-engine'),
    astroSwissAtmosphere: document.getElementById('astro-swiss-atmosphere'),
    astroAtmosphereAuto: document.getElementById('astro-atmosphere-auto'),
    astroSeaLevelPressure: document.getElementById('astro-sea-level-pressure'),
    astroSeaLevelHeight: document.getElementById('astro-sea-level-height'),
    astroTemperature: document.getElementById('astro-temperature'),
    astroYear: document.getElementById('astro-year'),
    astroMonth: document.getElementById('astro-month'),
    astroDay: document.getElementById('astro-day'),
    astroTime: document.getElementById('astro-time'),
    astroTimeLabel: document.getElementById('astro-time-label'),
    astroUseSummertime: document.getElementById('astro-use-summertime'),
    astroBodyScale: document.getElementById('astro-body-scale'),
    astroBodyScaleValue: document.getElementById('astro-body-scale-value'),
    astroShowSun: document.getElementById('astro-show-sun'),
    astroShowMoon: document.getElementById('astro-show-moon'),
    astroShowPaths: document.getElementById('astro-show-paths'),
    astroShowArchaeolines: document.getElementById('astro-show-archaeolines'),
    astroShowHorizonCompass: document.getElementById('astro-show-horizon-compass'),
    astroArchEquinox: document.getElementById('astro-arch-equinox'),
    astroArchSolstice: document.getElementById('astro-arch-solstice'),
    astroArchCrossquarter: document.getElementById('astro-arch-crossquarter'),
    astroArchMajorLunar: document.getElementById('astro-arch-major-lunar'),
    astroArchMinorLunar: document.getElementById('astro-arch-minor-lunar'),
    astroStatus: document.getElementById('astro-status'),
    datetimeInline: document.getElementById('datetime-inline'),
    dtYear: document.getElementById('dt-year'),
    dtMonth: document.getElementById('dt-month'),
    dtDay: document.getElementById('dt-day'),
    dtHour: document.getElementById('dt-hour'),
    dtHourLabel: document.getElementById('dt-hour-label'),
    dtMinute: document.getElementById('dt-minute'),
    dtSecond: document.getElementById('dt-second'),
    dtUseSummertime: document.getElementById('dt-use-summertime'),
    dtTimeTransport: document.getElementById('dt-time-transport'),
    dtCalendarLabel: document.getElementById('dt-calendar-label'),
    datetimeBgToggle: document.getElementById('datetime-bg-toggle'),
    datetimeClose: document.getElementById('datetime-close'),
    toggleDatetimePanel: document.getElementById('toggle-datetime-panel'),
    customLabelInline: document.getElementById('custom-label-inline'),
    customLabelForm: document.getElementById('custom-label-form'),
    customLabelHeading: document.getElementById('custom-label-heading'),
    customLabelSubtext: document.getElementById('custom-label-subtext'),
    customLabelAlt: document.getElementById('custom-label-alt'),
    customLabelAzi: document.getElementById('custom-label-azi'),
    customLabelPick: document.getElementById('custom-label-pick'),
    customLabelAdd: document.getElementById('custom-label-add'),
    customLabelRemove: document.getElementById('custom-label-remove'),
    customLabelBgToggle: document.getElementById('custom-label-bg-toggle'),
    customLabelClose: document.getElementById('custom-label-close'),
    customLabelPickOverlay: document.getElementById('custom-label-pick-overlay'),
    toggleCustomLabel: document.getElementById('toggle-custom-label'),
    simulationInline: document.getElementById('simulation-inline'),
    simulationScroll: document.getElementById('simulation-scroll'),
    simulationBgToggle: document.getElementById('simulation-bg-toggle'),
    simulationClose: document.getElementById('simulation-close'),
    toggleSurface: document.getElementById('toggle-surface'),
    paintHeightStrength: document.getElementById('paint-height-strength'),
    paintHeightStrengthValue: document.getElementById('paint-height-strength-value'),
    paintRelativeHeight: document.getElementById('paint-relative-height'),
    paintRelativeHeightValue: document.getElementById('paint-relative-height-value'),
    paintHeightContrast: document.getElementById('paint-height-contrast'),
    paintHeightContrastValue: document.getElementById('paint-height-contrast-value'),
    paintHillshade: document.getElementById('paint-hillshade'),
    paintHillshadeValue: document.getElementById('paint-hillshade-value'),
    paintDistanceStrength: document.getElementById('paint-distance-strength'),
    paintDistanceStrengthValue: document.getElementById('paint-distance-strength-value'),
    paintDistanceDesaturate: document.getElementById('paint-distance-desaturate'),
    paintDistanceDesaturateValue: document.getElementById('paint-distance-desaturate-value'),
    paintDistanceStart: document.getElementById('paint-distance-start'),
    paintDistanceStartValue: document.getElementById('paint-distance-start-value'),
    paintDistanceEnd: document.getElementById('paint-distance-end'),
    paintDistanceEndValue: document.getElementById('paint-distance-end-value'),
    paintDistanceBands: document.getElementById('paint-distance-bands'),
    displayBrightness: document.getElementById('display-brightness'),
    displayBrightnessValue: document.getElementById('display-brightness-value'),
    displayGamma: document.getElementById('display-gamma'),
    displayGammaValue: document.getElementById('display-gamma-value'),
    displayHazeStart: document.getElementById('display-haze-start'),
    displayHazeStartValue: document.getElementById('display-haze-start-value'),
    displayHazeStrength: document.getElementById('display-haze-strength'),
    displayHazeStrengthValue: document.getElementById('display-haze-strength-value'),
    displayDesaturate: document.getElementById('display-desaturate'),
    displayDesaturateValue: document.getElementById('display-desaturate-value'),
    displayFadeDistance: document.getElementById('display-fade-distance'),
    displayFadeDistanceValue: document.getElementById('display-fade-distance-value'),
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
    horizonResKey: document.getElementById('horizon-res-key'),
    showHorizonRelational: document.getElementById('show-horizon-relational'),
    horizonFloatM: document.getElementById('horizon-float-m'),
    horizonAzCluster: document.getElementById('horizon-az-cluster'),
    exportStellarium: document.getElementById('export-stellarium'),
    toggleFpv: document.getElementById('toggle-fpv'),
    toggleAstronomy: document.getElementById('toggle-astronomy'),
    astronomyToolbar: document.getElementById('astronomy-toolbar'),
    fpvHorizonHires: document.getElementById('fpv-horizon-hires'),
    fpvHorizonSuper: document.getElementById('fpv-horizon-super'),
    fpvHorizonStatusWrap: document.getElementById('fpv-horizon-status-wrap'),
    horizonCalcPanel: document.getElementById('horizon-calc-panel'),
    horizonCalcText: document.getElementById('horizon-calc-text'),
    horizonCalcProgress: document.getElementById('horizon-calc-progress'),
    horizonCalcProgressFill: document.getElementById('horizon-calc-progress-fill'),
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
  const toggleInfoBtn = document.getElementById('toggle-info');
  let stageInfoVisible = false;
  const fullscreenViewBtn = document.getElementById('fullscreen-view');
  const saveViewBtn = document.getElementById('save-view');
  const copyViewBtn = document.getElementById('copy-view');
  const exportViewsBtn = document.getElementById('export-views');
  const importViewsBtn = document.getElementById('import-views');
  const captureViewBtn = document.getElementById('capture-view');
  const helpViewBtn = document.getElementById('help-view');
  const loadingHelpViewBtn = document.getElementById('loading-help-view');
  const loadingImportViewBtn = document.getElementById('loading-import-view');
  const helpOverlay = document.getElementById('help-overlay');
  const helpCloseBtn = document.getElementById('help-close');
  const orbitSiteBtn = document.getElementById('orbit-site');
  const tourStageEl = document.querySelector('.tour-stage');

  let orbitRaf = 0;
  let orbitToken = 0;
  let astronomyToolbarOpen = false;
  let cameraAnimRaf = 0;
  let cameraAnimToken = 0;
  let viewRestoreToken = 0;
  let suppressHorizonRelationalAutoLoad = false;

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
    if (!siteDemReady) {
      updateStageViewCaption();
      if (!els.stageLoading) return;
      els.stageLoading.classList.remove('hidden');
      return;
    }

    updateStageViewCaption();

    if (!els.stageLoading) return;

    // Show 100% briefly before hiding, so it is visible.
    setStageLoadingProgress(1, { indeterminate: false, cap: 1 });
    stageProgress.hideTimer = window.setTimeout(() => {
      if (siteDemReady) els.stageLoading.classList.add('hidden');
    }, 260);
  }

  function isViewLocationSite(site) {
    if (!site) return true;
    const id = String(site.id || '');
    const townland = String(site.townland || '').trim();
    const mClass = String(site.props?.MONUMENT_CLASS || '').trim();
    return id.startsWith('location-') || townland === 'View Location' || mClass === 'View Location';
  }

  function syncStageInfoButton() {
    toggleInfoBtn?.classList.toggle('active', stageInfoVisible);
    toggleInfoBtn?.setAttribute('aria-pressed', stageInfoVisible ? 'true' : 'false');
    toggleInfoBtn?.setAttribute('data-tip', stageInfoVisible ? 'Hide site information' : 'Show site information');
    toggleInfoBtn?.setAttribute('aria-label', stageInfoVisible ? 'Hide site information' : 'Show site information');
  }

  function updateStageViewCaption() {
    if (!els.stageViewCaption) return;
    if (!siteDemReady || !currentFocus || !isFinite(currentFocus.lat) || !isFinite(currentFocus.lng)) {
      els.stageViewCaption.classList.add('hidden');
      els.stageViewCaption.replaceChildren();
      return;
    }
    if (!stageInfoVisible) {
      els.stageViewCaption.classList.add('hidden');
      return;
    }
    const lat = Number(currentFocus.lat);
    const lng = Number(currentFocus.lng);
    const coord = (v) => (Number.isFinite(v) ? v.toFixed(6) : '—');
    const lines = [];
    if (isViewLocationSite(selectedSite)) {
      lines.push('Current Location');
      lines.push(`Lat: ${coord(lat)} · Lon: ${coord(lng)}`);
    } else {
      const props = selectedSite?.props || {};
      const townland = titleCaseWords(shortName(selectedSite?.townland || props.TOWNLAND || props.TOWNLAND_NAME || '')) || '—';
      const mClass = String(props.MONUMENT_CLASS || '').trim() || '—';
      const smr = String(selectedSite?.smr || props.SMRS || props.SMR_NO || props.SMR || props.OBJECTID || '').trim() || '—';
      const county = titleCaseWords(selectedSite?.county || props.COUNTY || '') || '—';
      lines.push(`Townland: ${townland} · Type: ${mClass}`);
      lines.push(`SMR: ${smr} · County: ${county}`);
      lines.push(`Lat: ${coord(lat)} · Lon: ${coord(lng)}`);
    }
    els.stageViewCaption.replaceChildren();
    for (const text of lines) {
      const span = document.createElement('span');
      span.className = 'stage-view-caption-line';
      span.textContent = text;
      els.stageViewCaption.appendChild(span);
    }
    els.stageViewCaption.classList.remove('hidden');
  }

  toggleInfoBtn?.addEventListener('click', () => {
    stageInfoVisible = !stageInfoVisible;
    syncStageInfoButton();
    updateStageViewCaption();
  });
  syncStageInfoButton();

  function removeNonSelectedLabels() {
    const keep = [];
    for (const item of labelItems) {
      if (item.kind === 'selected' || item.kind === 'custom') {
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
    updateCustomLabelPanel();
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
      activateStagePanel(null);
    });
  }

  function layoutStagePanels() {
    const stackTop = 16;
    const toolbarH = 42;
    const stackGap = 8;
    const panelGap = 10;
    let top = stackTop + toolbarH + panelGap;
    const astroVisible = astronomyToolbarOpen && els.astronomyToolbar && !els.astronomyToolbar.classList.contains('hidden');
    if (astroVisible) top += toolbarH + stackGap;
    if (els.notesInline && !els.notesInline.classList.contains('hidden')) {
      els.notesInline.style.top = `${top}px`;
    }
    if (datetimePanelOpen && els.datetimeInline) {
      els.datetimeInline.style.top = `${top}px`;
    }
    if (customLabelPanelOpen && els.customLabelInline) {
      els.customLabelInline.style.top = `${top}px`;
    }
    layoutCustomLabelPickOverlay(top);
  }

  function layoutCustomLabelPickOverlay(panelTop = null) {
    if (!els.customLabelPickOverlay) return;
    if (panelTop == null) {
      const stackTop = 16;
      const toolbarH = 42;
      const panelGap = 10;
      const stackGap = 8;
      panelTop = stackTop + toolbarH + panelGap;
      const astroVisible = astronomyToolbarOpen && els.astronomyToolbar && !els.astronomyToolbar.classList.contains('hidden');
      if (astroVisible) panelTop += toolbarH + stackGap;
    }
    els.customLabelPickOverlay.style.top = `${panelTop}px`;
  }

  function normalizeCustomAzimuth(deg) {
    const n = Number(deg);
    if (!isFinite(n)) return NaN;
    return ((n % 360) + 360) % 360;
  }

  function customLabelDetailText(azimuth, altitude, subText) {
    const meta = `Az ${Number(azimuth).toFixed(1)}° · Alt ${Number(altitude).toFixed(2)}°`;
    const detail = String(subText || '').trim();
    return detail || meta;
  }

  function screenPointToAzAlt(clientX, clientY) {
    if (!cameraState.observerMode || !els.container || !camera) return null;
    const rect = els.container.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const d = raycaster.ray.direction;
    const bearingRad = Math.atan2(d.x, -d.z);
    const altRad = Math.asin(Math.max(-1, Math.min(1, d.y)));
    return {
      azimuth: normalizeCustomAzimuth(THREE.MathUtils.radToDeg(bearingRad)),
      altitude: THREE.MathUtils.radToDeg(altRad)
    };
  }

  function fillCustomLabelCoordInputs(azimuth, altitude) {
    if (els.customLabelAzi && isFinite(azimuth)) els.customLabelAzi.value = Number(azimuth).toFixed(1);
    if (els.customLabelAlt && isFinite(altitude)) els.customLabelAlt.value = Number(altitude).toFixed(2);
  }

  function setCustomLabelPickMode(on) {
    customLabelPickMode = !!on;
    tourStageEl?.classList.toggle('custom-label-pick-active', customLabelPickMode);
    els.customLabelPickOverlay?.classList.toggle('hidden', !customLabelPickMode);
    els.customLabelPickOverlay?.setAttribute('aria-hidden', customLabelPickMode ? 'false' : 'true');
    els.customLabelPick?.classList.toggle('is-active', customLabelPickMode);
    els.customLabelPick?.setAttribute('aria-pressed', customLabelPickMode ? 'true' : 'false');
    if (customLabelPickMode) layoutCustomLabelPickOverlay();
  }

  function updateCustomLabelPanel() {
    if (!els.customLabelInline) return;
    const visible = customLabelPanelOpen && cameraState.observerMode && siteDemReady;
    els.customLabelInline.classList.toggle('hidden', !visible);
    els.customLabelInline.classList.toggle('with-bg', visible && customLabelPanelBgOn);
    els.toggleCustomLabel?.classList.toggle('active', visible);
    els.toggleCustomLabel?.setAttribute('aria-pressed', visible ? 'true' : 'false');
    if (!visible) setCustomLabelPickMode(false);
    const activeCustom = activeLabelId && labelItems.some(x => x.id === activeLabelId && x.kind === 'custom');
    els.customLabelRemove?.classList.toggle('hidden', !activeCustom);
    layoutStagePanels();
  }

  function toggleCustomLabelPanel() {
    if (!cameraState.observerMode) return;
    if (customLabelPanelOpen) {
      activateStagePanel(null);
      return;
    }
    activateStagePanel('customLabel');
  }

  function removeCustomSkyLabel(id, { silent = false } = {}) {
    const labelId = String(id || '');
    if (!labelId) return;
    customLabelMarkers = customLabelMarkers.filter((m) => {
      if (m.id === labelId) {
        m.el?.remove();
        return false;
      }
      return true;
    });
    customLabels = customLabels.filter((c) => c.id !== labelId);
    if (hasLabel(labelId)) removeFlatLabel(labelId);
    if (!silent && activeLabelId === labelId) {
      activeLabelId = null;
      setActiveLabelById(null);
    }
    updateCustomLabelPanel();
  }

  function clearCustomLabels() {
    for (const m of customLabelMarkers) m.el?.remove();
    customLabelMarkers = [];
    customLabels = [];
    const keep = [];
    for (const item of labelItems) {
      if (item.kind === 'custom') {
        item.el?.remove();
        item.line?.remove();
        continue;
      }
      keep.push(item);
    }
    labelItems = keep;
    if (activeLabelId && !labelItems.some(x => x.id === activeLabelId)) {
      activeLabelId = null;
      setActiveLabelById(null);
    }
    updateCustomLabelPanel();
  }

  function addCustomSkyLabel({ id = null, heading = '', subText = '', azimuth, altitude, distM = null, activate = true } = {}) {
    if (!cameraState.observerMode || !els.labelLayer || !els.labelLines || !els.markerLayer) return null;
    const az = normalizeCustomAzimuth(azimuth);
    const alt = Number(altitude);
    if (!isFinite(az) || !isFinite(alt)) return null;
    const labelId = String(id || `custom-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
    const title = String(heading || 'Custom').trim() || 'Custom';
    const detail = customLabelDetailText(az, alt, subText);
    const dist = Math.max(80, Number(distM) || viewshedDisplayRadiusM());

    removeCustomSkyLabel(labelId, { silent: true });

    const markerEl = document.createElement('div');
    markerEl.className = 'rel-marker rel-marker--custom';
    markerEl.dataset.customId = labelId;
    markerEl.title = title;
    markerEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (customLabelPickMode) return;
      if (activeLabelId === labelId) {
        activeLabelId = null;
        setActiveLabelById(null);
        updateCustomLabelPanel();
        return;
      }
      setActiveLabelById(labelId);
      updateCustomLabelPanel();
    });
    els.markerLayer.appendChild(markerEl);
    customLabelMarkers.push({ id: labelId, el: markerEl, azimuth: az, altitude: alt, distM: dist });

    const el = document.createElement('div');
    el.className = 'site-label site-label--custom';
    el.innerHTML = `<span class="label-title">${escapeHtml(title)}</span><span class="detail">${escapeHtml(detail)}</span>`;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (customLabelPickMode) return;
      if (activeLabelId === labelId) {
        activeLabelId = null;
        setActiveLabelById(null);
        updateCustomLabelPanel();
        return;
      }
      setActiveLabelById(labelId);
      updateCustomLabelPanel();
    });
    els.labelLayer.appendChild(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    els.labelLines.appendChild(line);
    labelItems.push({
      id: labelId,
      kind: 'custom',
      local: null,
      lat: null,
      lng: null,
      props: { CUSTOM_LABEL: true, HEADING: title, SUB_TEXT: detail },
      el,
      line,
      visible: true,
      horizonAzimuth: az,
      horizonAltitude: alt,
      horizonDistM: dist
    });
    customLabels.push({ id: labelId, heading: title, subText: String(subText || '').trim(), azimuth: az, altitude: alt, distM: dist });
    if (activate) setActiveLabelById(labelId);
    updateCustomLabelPanel();
    return labelId;
  }

  function restoreCustomLabels(state) {
    clearCustomLabels();
    const list = Array.isArray(state?.customLabels) ? state.customLabels : [];
    for (const entry of list) {
      if (!entry || !isFinite(entry.azimuth) || !isFinite(entry.altitude)) continue;
      addCustomSkyLabel({
        id: entry.id,
        heading: entry.heading,
        subText: entry.subText,
        azimuth: entry.azimuth,
        altitude: entry.altitude,
        distM: entry.distM,
        activate: false
      });
    }
    const active = list.find(x => x?.active)?.id;
    if (active && hasLabel(active)) setActiveLabelById(active);
    updateCustomLabelPanel();
  }

  function updateCustomMarkers() {
    if (!customLabelMarkers.length || !els.container) return;
    for (const marker of customLabelMarkers) {
      const pt = projectedScreenPointHorizon(marker.azimuth, marker.altitude, marker.distM);
      if (!pt) {
        marker.el.style.display = 'none';
        continue;
      }
      marker.el.style.display = 'block';
      marker.el.style.left = `${pt.x}px`;
      marker.el.style.top = `${pt.y}px`;
    }
  }

  function commitCustomLabelFromForm() {
    const heading = String(els.customLabelHeading?.value || '').trim();
    const subText = String(els.customLabelSubtext?.value || '').trim();
    const azimuth = normalizeCustomAzimuth(els.customLabelAzi?.value);
    const altitude = Number(els.customLabelAlt?.value);
    if (!heading) {
      els.customLabelHeading?.focus();
      return null;
    }
    if (!isFinite(azimuth) || !isFinite(altitude)) return null;
    const id = addCustomSkyLabel({ heading, subText, azimuth, altitude });
    if (id) {
      if (els.customLabelHeading) els.customLabelHeading.value = '';
      if (els.customLabelSubtext) els.customLabelSubtext.value = '';
      if (els.customLabelAlt) els.customLabelAlt.value = '';
      if (els.customLabelAzi) els.customLabelAzi.value = '';
      setCustomLabelPickMode(false);
    }
    return id;
  }

  function currentViewType() {
    return cameraState.observerMode ? 'fpv' : 'default';
  }

  function viewTypeLabel(viewType) {
    return viewType === 'fpv' ? 'FP view' : 'Orbit';
  }

  function ensurePanoramaObserverFocusFromState(state) {
    if (!cameraState.observerMode) {
      panoramaObserverFocus = null;
      return;
    }
    const site = state?.selectedSite || null;
    const focus = state?.focus || site || currentFocus;
    const lat = Number(site?.lat ?? focus?.lat);
    const lng = Number(site?.lng ?? focus?.lng);
    if (!isFinite(lat) || !isFinite(lng)) return;
    panoramaObserverFocus = { lat, lng };
    currentFocus = { lat, lng };
    if (els.observerLat) els.observerLat.value = String(lat);
    if (els.observerLon) els.observerLon.value = String(lng);
  }

  function syncMonumentModeUiFromFlags() {
    if (els.showRelatedMonuments) els.showRelatedMonuments.checked = !!showRelatedMonuments;
    if (els.showAllRelational) els.showAllRelational.checked = !!showAllRelational;
    if (els.showAllMonuments) els.showAllMonuments.checked = !!showAllMonuments;
    if (els.showHorizonRelational) els.showHorizonRelational.checked = !!showHorizonRelational;
    const horizonRelBtn = document.querySelector('button[data-toggle="show-horizon-relational"]');
    if (horizonRelBtn) {
      horizonRelBtn.classList.toggle('active', !!showHorizonRelational);
      horizonRelBtn.setAttribute('aria-pressed', showHorizonRelational ? 'true' : 'false');
    }
  }

  function resolveMonumentModeFromViewState(state) {
    const viewType = normalizeViewType(state);
    const mode = state?.monumentMode || null;
    if (viewType === 'fpv') {
      if (mode === 'horizon' || state?.astroToggles?.showHorizonRelational) return 'horizon';
      if (mode === 'type' || mode === 'relational' || mode === 'all') return mode;
      return null;
    }
    if (mode === 'horizon') return null;
    return mode;
  }

  function setMonumentModeFlags(mode) {
    showRelatedMonuments = mode === 'type';
    showAllRelational = mode === 'relational';
    showAllMonuments = mode === 'all';
    showHorizonRelational = mode === 'horizon';
    syncMonumentModeUiFromFlags();
    updateLegendPanel();
  }

  function clearAllMonumentMarkerLayers() {
    relationalLoadToken += 1;
    horizonLoadToken += 1;
    clearRelatedMarkers();
    clearRelationalMarkers();
    clearAllMonumentMarkers();
    clearHorizonRelationalMarkers();
  }

  async function reloadMonumentMarkersForCurrentMode() {
    if (!currentPatch) return;
    if (showRelatedMonuments) await addNmsMarkers();
    else if (showAllRelational) await loadRelationalMarkersInView();
    else if (showAllMonuments) await loadAllMonumentMarkersInView();
    else if (showHorizonRelational && cameraState.observerMode) await loadHorizonRelationalMarkers();
    updateRelationalMarkers();
    syncShowAllLabelsState();
    updateLegendPanel();
  }

  function captureDateTimeState() {
    if (astronomyOverlay?.getDateTimeSnapshot) {
      return cloneForStorage(astronomyOverlay.getDateTimeSnapshot());
    }
    return {
      year: els.dtYear ? Number(els.dtYear.value) : null,
      month: els.dtMonth ? Number(els.dtMonth.value) : null,
      day: els.dtDay ? Number(els.dtDay.value) : null,
      utcTotalSeconds: (() => {
        const h = Number(els.dtHour?.value) || 0;
        const m = Number(els.dtMinute?.value) || 0;
        const s = Number(els.dtSecond?.value) || 0;
        return h * 3600 + m * 60 + s;
      })(),
      useSummertime: !!els.dtUseSummertime?.checked
    };
  }

  function applyDateTimeState(datetime) {
    if (!datetime || typeof datetime !== 'object') return;
    if (astronomyOverlay?.applyDateTimeSnapshot) {
      astronomyOverlay.applyDateTimeSnapshot(datetime);
      return;
    }
    if (els.dtYear && datetime.year != null) { els.dtYear.value = String(datetime.year); dispatchInputChange(els.dtYear); }
    if (els.dtMonth && datetime.month != null) { els.dtMonth.value = String(datetime.month); dispatchInputChange(els.dtMonth); }
    if (els.dtDay && datetime.day != null) { els.dtDay.value = String(datetime.day); dispatchInputChange(els.dtDay); }
    if (els.dtHour && datetime.hour != null) { els.dtHour.value = String(datetime.hour); dispatchInputChange(els.dtHour); }
    if (els.dtMinute && datetime.minute != null) { els.dtMinute.value = String(datetime.minute); dispatchInputChange(els.dtMinute); }
    if (els.dtSecond && datetime.second != null) { els.dtSecond.value = String(datetime.second); dispatchInputChange(els.dtSecond); }
    if (els.dtUseSummertime && typeof datetime.useSummertime === 'boolean') {
      els.dtUseSummertime.checked = datetime.useSummertime;
      dispatchInputChange(els.dtUseSummertime);
    }
  }

  function syncFpvToolbar() {
    const fpv = !!cameraState.observerMode;
    els.toggleFpv?.classList.toggle('active', fpv);
    els.toggleFpv?.setAttribute('aria-pressed', fpv ? 'true' : 'false');
    els.toggleFpv?.setAttribute('data-tip', fpv ? 'Exit FP View' : 'Show FP View');
    els.toggleFpv?.setAttribute('aria-label', fpv ? 'Exit FP View' : 'Show FP View');
  }

  function syncAstronomyToolbar() {
    const fpv = !!cameraState.observerMode;
    if (!fpv) astronomyToolbarOpen = false;
    const open = astronomyToolbarOpen && fpv;
    els.astronomyToolbar?.classList.toggle('hidden', !open);
    els.astronomyToolbar?.setAttribute('aria-hidden', open ? 'false' : 'true');
    els.toggleAstronomy?.classList.toggle('panorama-only-disabled', !fpv);
    els.toggleAstronomy?.classList.toggle('active', open);
    els.toggleAstronomy?.setAttribute('aria-pressed', open ? 'true' : 'false');
    els.toggleAstronomy?.setAttribute('aria-disabled', fpv ? 'false' : 'true');
    els.toggleAstronomy?.setAttribute('data-tip', open ? 'Hide Astronomy Tools' : 'Show Astronomy Tools');
    els.toggleAstronomy?.setAttribute('aria-label', open ? 'Hide Astronomy Tools' : 'Show Astronomy Tools');
    syncFpvToolbar();
    layoutStagePanels();
  }

  async function toggleFpvMode() {
    if (cameraState.observerMode) {
      astronomyToolbarOpen = false;
      syncAstronomyToolbar();
      await setPanoramaMode(false);
      return;
    }
    astronomyToolbarOpen = false;
    await setPanoramaMode(true);
    syncAstronomyToolbar();
  }

  async function toggleAstronomyMode() {
    if (!cameraState.observerMode) return;
    astronomyToolbarOpen = !astronomyToolbarOpen;
    syncAstronomyToolbar();
  }

  function refreshStagePanelToolbar() {
    const notesBtn = document.querySelector('button[data-toggle="show-notes"]');
    const notesActive = !!els.showNotes?.checked && !datetimePanelOpen && !customLabelPanelOpen;
    notesBtn?.classList.toggle('active', notesActive);
    notesBtn?.setAttribute('aria-pressed', notesActive ? 'true' : 'false');
    els.toggleDatetimePanel?.classList.toggle('active', datetimePanelOpen);
    els.toggleDatetimePanel?.setAttribute('aria-pressed', datetimePanelOpen ? 'true' : 'false');
    els.toggleCustomLabel?.classList.toggle('active', customLabelPanelOpen);
    els.toggleCustomLabel?.setAttribute('aria-pressed', customLabelPanelOpen ? 'true' : 'false');
  }

  function refreshSurfaceToolbar() {
    const terrainOn = imageryKey === 'terrain';
    const tip = terrainOn ? 'Surface: Terrain relief' : 'Surface: Esri Aerial Clarity';
    els.toggleSurface?.classList.toggle('active', terrainOn);
    els.toggleSurface?.setAttribute('aria-pressed', terrainOn ? 'true' : 'false');
    els.toggleSurface?.setAttribute('data-tip', tip);
    els.toggleSurface?.setAttribute('aria-label', tip);
  }

  function syncImageryRadioButtons() {
    document.querySelectorAll('input[name="imagery-base"]').forEach((input) => {
      input.checked = input.value === imageryKey;
    });
  }

  async function applyImageryKey(key) {
    imageryKey = key;
    syncImageryRadioButtons();
    refreshSurfaceToolbar();
    if (currentFocus || selectedSite || sites[0]) {
      await buildTerrain(currentFocus || selectedSite || sites[0]);
    } else {
      applyDisplaySettings();
    }
  }

  async function toggleSurfaceImagery() {
    await applyImageryKey(imageryKey === 'terrain' ? 'esri-clarity' : 'terrain');
  }

  function activateStagePanel(panel) {
    datetimePanelOpen = panel === 'datetime';
    customLabelPanelOpen = panel === 'customLabel';
    if (els.showNotes) els.showNotes.checked = panel === 'notes';
    if (panel !== 'customLabel') setCustomLabelPickMode(false);
    updateNotesPanel();
    updateDatetimePanel();
    updateCustomLabelPanel();
    refreshStagePanelToolbar();
    if (datetimePanelOpen) astronomyOverlay?.syncControls();
  }

  function toggleStagePanel(panel) {
    const open = panel === 'notes'
      ? (!!els.showNotes?.checked && !datetimePanelOpen && !customLabelPanelOpen)
      : panel === 'datetime'
        ? datetimePanelOpen
        : customLabelPanelOpen;
    activateStagePanel(open ? null : panel);
  }

  function updateDatetimePanel() {
    if (!els.datetimeInline) return;
    els.datetimeInline.classList.toggle('hidden', !datetimePanelOpen);
    els.datetimeInline.classList.toggle('with-bg', datetimePanelOpen && datetimePanelBgOn);
    els.toggleDatetimePanel?.classList.toggle('active', datetimePanelOpen);
    els.toggleDatetimePanel?.setAttribute('aria-pressed', datetimePanelOpen ? 'true' : 'false');
    if (datetimePanelOpen) {
      astronomyOverlay?.syncControls();
    }
    layoutStagePanels();
  }

  els.toggleDatetimePanel?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!cameraState.observerMode) return;
    toggleStagePanel('datetime');
  });
  els.toggleCustomLabel?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!cameraState.observerMode) return;
    toggleCustomLabelPanel();
  });
  els.customLabelClose?.addEventListener('click', () => {
    activateStagePanel(null);
  });
  els.customLabelBgToggle?.addEventListener('click', () => {
    customLabelPanelBgOn = !customLabelPanelBgOn;
    els.customLabelInline?.classList.toggle('with-bg', customLabelPanelOpen && customLabelPanelBgOn);
  });
  els.customLabelPick?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!customLabelPanelOpen) return;
    setCustomLabelPickMode(!customLabelPickMode);
  });
  els.customLabelForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    commitCustomLabelFromForm();
  });
  els.customLabelRemove?.addEventListener('click', () => {
    if (!activeLabelId) return;
    const item = labelItems.find(x => x.id === activeLabelId && x.kind === 'custom');
    if (!item) return;
    removeCustomSkyLabel(item.id);
  });
  els.customLabelPickOverlay?.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const coords = screenPointToAzAlt(e.clientX, e.clientY);
    if (!coords) return;
    fillCustomLabelCoordInputs(coords.azimuth, coords.altitude);
    setCustomLabelPickMode(false);
    els.customLabelHeading?.focus();
  });
  els.customLabelPickOverlay?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
  }, { passive: false });
  els.datetimeClose?.addEventListener('click', () => {
    activateStagePanel(null);
  });
  els.datetimeBgToggle?.addEventListener('click', () => {
    datetimePanelBgOn = !datetimePanelBgOn;
    els.datetimeInline?.classList.toggle('with-bg', datetimePanelOpen && datetimePanelBgOn);
  });

  els.simulationClose?.addEventListener('click', () => {
    els.simulationInline?.classList.add('hidden');
  });
  els.simulationBgToggle?.addEventListener('click', () => {
    els.simulationInline?.classList.toggle('with-bg');
  });

  els.astroShowArchaeolines?.addEventListener('change', () => {
    astronomyOverlay?.updateOverlay();
  });
  els.astroShowHorizonCompass?.addEventListener('change', () => {
    astronomyOverlay?.updateOverlay();
  });

  window.addEventListener('resize', layoutStagePanels);

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

  const SCENE_SKY_CLEAR = 0xbfe3ff;
  const FPV_BELOW_HORIZON_CLEAR = 0x667659;

  const scene = new THREE.Scene();
  // Keep the near terrain crisp: push atmospheric fade far out.
  scene.background = new THREE.Color(SCENE_SKY_CLEAR);
  scene.fog = new THREE.Fog(0xd6efff, 14000, 52000);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(
    Math.max(1, els.container.clientWidth),
    Math.max(1, els.container.clientHeight)
  );
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  els.container.appendChild(renderer.domElement);
  bindStageResizeObserver();

  const camera = new THREE.PerspectiveCamera(45, 1, 1, CAMERA_FAR_M);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-1200, 2400, 900);
  scene.add(sun);

  let skyDome = null;
  addSkyDome();
  markerGroup = new THREE.Group();
  scene.add(markerGroup);
  astronomyOverlay = window.SkyscapeAstronomy?.create({
    THREE,
    scene,
    camera,
    els,
    getCurrentFocus: () => observerFocusCoords() || currentFocus,
    getObserverCameraLocal: () => observerCameraLocal(),
    getVerticalExaggeration: () => verticalExaggeration,
    getBaseCenterElev: () => baseCenterElev,
    getCameraState: () => cameraState,
    isPanoramaView: () => !!cameraState.observerMode,
    getViewshedHorizonSample: (azimuthDeg) => horizonSampleAtAzimuth(horizonDrawProfileData(), azimuthDeg),
    getCompositeHorizonAltDeg: (azimuthDeg) => horizonAltAtAzimuth(horizonDrawProfileData(), azimuthDeg),
    getDevicePixelRatio: () => renderer.getPixelRatio(),
    getMaxAnisotropy: () => renderer.capabilities.getMaxAnisotropy(),
    onHorizonsUpdated: () => syncAstroReadout()
  });

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
      exponent: { value: 1.35 },
      viewshedMaskEnabled: { value: 0.0 },
      viewshedHorizonMap: { value: null },
      fpvHorizonMask: { value: 0.0 },
      fpvHorizonScreenMask: { value: null },
      fpvHorizonMaskResolution: { value: new THREE.Vector2(1, 1) }
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
        uniform float viewshedMaskEnabled;
        uniform sampler2D viewshedHorizonMap;
        uniform float fpvHorizonMask;
        uniform sampler2D fpvHorizonScreenMask;
        uniform vec2 fpvHorizonMaskResolution;

        float hash12(vec2 p) {
          vec3 p3  = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        float viewshedHorizonAltDeg(vec3 dir) {
          float az = degrees(atan(dir.x, -dir.z));
          if (az < 0.0) az += 360.0;
          float encoded = texture2D(viewshedHorizonMap, vec2((az + 0.5) / 360.0, 0.5)).r;
          return encoded * 180.0 - 90.0;
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          if (fpvHorizonMask > 0.5) {
            vec2 maskUv = vec2(
              gl_FragCoord.x / fpvHorizonMaskResolution.x,
              gl_FragCoord.y / fpvHorizonMaskResolution.y
            );
            if (texture2D(fpvHorizonScreenMask, maskUv).r < 0.5) discard;
          } else if (viewshedMaskEnabled > 0.5) {
            float alt = degrees(asin(clamp(dir.y, -1.0, 1.0)));
            if (alt < viewshedHorizonAltDeg(dir) - 0.02) discard;
          }

          // y is -1..1. Horizon ~0. We want a strong haze band around horizon.
          float y = clamp(dir.y, -1.0, 1.0);

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

  function horizonAltAtAzimuth(horizonData, azimuthDeg) {
    if (!horizonData?.length) return -90;
    const az = ((azimuthDeg % 360) + 360) % 360;
    const n = horizonData.length;
    if (n === 1) {
      const only = Number(horizonData[0]?.altitude);
      return isFinite(only) ? only : -90;
    }
    for (let i = 0; i < n; i += 1) {
      const next = (i + 1) % n;
      const a0 = Number(horizonData[i].azimuth);
      const a1 = Number(horizonData[next].azimuth);
      const alt0 = Number(horizonData[i].altitude);
      const alt1 = Number(horizonData[next].altitude);
      if (!isFinite(a0) || !isFinite(a1) || !isFinite(alt0) || !isFinite(alt1)) continue;
      let inSegment = false;
      let t = 0;
      if (i === n - 1) {
        const span = (360 - a0) + a1;
        if (span <= 0) continue;
        if (az >= a0) {
          inSegment = true;
          t = (az - a0) / span;
        } else if (az < a1) {
          inSegment = true;
          t = (az + 360 - a0) / span;
        }
      } else if (az >= a0 && az < a1) {
        inSegment = true;
        t = a1 === a0 ? 0 : (az - a0) / (a1 - a0);
      }
      if (inSegment) return alt0 + (alt1 - alt0) * t;
    }
    const fallback = Number(horizonData[0]?.altitude);
    return isFinite(fallback) ? fallback : -90;
  }

  function buildViewshedHorizonLookupTexture(horizonData) {
    const n = Math.max(360, Math.min(8192, (horizonData?.length || 0) * 8 || 4096));
    const data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i += 1) {
      const az = (i / n) * 360;
      const alt = horizonAltAtAzimuth(horizonData, az);
      const encoded = Math.max(0, Math.min(255, Math.round(((alt + 90) / 180) * 255)));
      const idx = i * 4;
      data[idx] = encoded;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 255;
    }
    if (!viewshedHorizonLookupTexture || viewshedHorizonLookupTexture.image.width !== n) {
      viewshedHorizonLookupTexture?.dispose?.();
      viewshedHorizonLookupTexture = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
      viewshedHorizonLookupTexture.minFilter = THREE.NearestFilter;
      viewshedHorizonLookupTexture.magFilter = THREE.NearestFilter;
      viewshedHorizonLookupTexture.wrapS = THREE.RepeatWrapping;
      viewshedHorizonLookupTexture.wrapT = THREE.ClampToEdgeWrapping;
      viewshedHorizonLookupTexture.needsUpdate = true;
    } else {
      viewshedHorizonLookupTexture.image.data.set(data);
      viewshedHorizonLookupTexture.needsUpdate = true;
    }
    return viewshedHorizonLookupTexture;
  }

  function visibleHorizonArcs(projected) {
    const n = projected.length;
    if (!n) return [];
    const isVisible = (pt) => pt.z >= -1 && pt.z <= 1;
    const vis = projected.map(isVisible);
    const visibleCount = vis.filter(Boolean).length;
    if (visibleCount < 2) return [];
    if (visibleCount === n) return [projected.slice()];

    const arcs = [];
    let current = [];
    for (let i = 0; i < n; i += 1) {
      if (vis[i]) {
        current.push(projected[i]);
      } else if (current.length) {
        if (current.length >= 2) arcs.push(current);
        current = [];
      }
    }
    if (current.length >= 2) arcs.push(current);
    if (vis[0] && vis[n - 1] && arcs.length >= 2) {
      const last = arcs[arcs.length - 1];
      const first = arcs[0];
      arcs[0] = last.concat(first);
      arcs.pop();
    }
    return arcs.filter((arc) => arc.length >= 2);
  }

  function buildFpvHorizonScreenMaskFromRing(ring) {
    if (!ring?.length || !camera) return null;
    const w = Math.max(1, renderer.domElement.width | 0);
    const h = Math.max(1, renderer.domElement.height | 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const projected = ring.map((p) => {
      _fpvHorizonProjVec.set(p.x, p.y + FPV_HORIZON_LINE_Y_OFFSET, p.z);
      _fpvHorizonProjVec.project(camera);
      return {
        cx: (_fpvHorizonProjVec.x * 0.5 + 0.5) * w,
        cy: h - (_fpvHorizonProjVec.y * 0.5 + 0.5) * h,
        z: _fpvHorizonProjVec.z
      };
    });
    const arcs = visibleHorizonArcs(projected);
    if (!arcs.length) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    for (const arc of arcs) {
      if (arc.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(arc[arc.length - 1].cx, arc[arc.length - 1].cy);
      for (let i = arc.length - 1; i >= 0; i -= 1) ctx.lineTo(arc[i].cx, arc[i].cy);
      ctx.lineTo(0, arc[0].cy);
      ctx.closePath();
      ctx.fill();
    }

    const img = ctx.getImageData(0, 0, w, h);
    const needed = w * h * 4;
    if (!fpvHorizonScreenMaskBuffer || fpvHorizonScreenMaskSize.w !== w || fpvHorizonScreenMaskSize.h !== h) {
      fpvHorizonScreenMaskBuffer = new Uint8Array(needed);
      fpvHorizonScreenMaskSize = { w, h };
      fpvHorizonScreenMaskTexture?.dispose?.();
      fpvHorizonScreenMaskTexture = new THREE.DataTexture(fpvHorizonScreenMaskBuffer, w, h, THREE.RGBAFormat);
      fpvHorizonScreenMaskTexture.minFilter = THREE.NearestFilter;
      fpvHorizonScreenMaskTexture.magFilter = THREE.NearestFilter;
      fpvHorizonScreenMaskTexture.wrapS = THREE.ClampToEdgeWrapping;
      fpvHorizonScreenMaskTexture.wrapT = THREE.ClampToEdgeWrapping;
    }
    const data = fpvHorizonScreenMaskBuffer;
    for (let cy = 0; cy < h; cy += 1) {
      for (let cx = 0; cx < w; cx += 1) {
        const src = (cy * w + cx) * 4;
        const glY = h - 1 - cy;
        const dst = (glY * w + cx) * 4;
        data[dst] = img.data[src] > 127 ? 255 : 0;
        data[dst + 1] = 0;
        data[dst + 2] = 0;
        data[dst + 3] = 255;
      }
    }
    fpvHorizonScreenMaskTexture.needsUpdate = true;
    return fpvHorizonScreenMaskTexture;
  }

  function syncFpvHorizonClearColor(active) {
    scene.background.setHex(active ? FPV_BELOW_HORIZON_CLEAR : SCENE_SKY_CLEAR);
  }

  function updateSkyDomeScreenMask(screenMaskTexture) {
    if (!skyDome?.material?.uniforms) return;
    const u = skyDome.material.uniforms;
    const enabled = !!screenMaskTexture;
    u.fpvHorizonMask.value = enabled ? 1.0 : 0.0;
    u.fpvHorizonScreenMask.value = screenMaskTexture || fpvHorizonScreenMaskFallbackTexture();
    if (enabled) {
      u.fpvHorizonMaskResolution.value.set(
        Math.max(1, renderer.domElement.width),
        Math.max(1, renderer.domElement.height)
      );
    }
  }

  function updateSkyDomeViewshedMask() {
    if (!skyDome?.material?.uniforms) return;
    // FPV uses screen-space horizon mask (same as terrain); not world-space az/alt.
    skyDome.material.uniforms.viewshedMaskEnabled.value = 0.0;
  }

  function formatDisplayValue(key, value) {
    if (key === 'hazeStartM' || key === 'fadeDistanceM') return `${Math.round(value)}m`;
    return Number(value).toFixed(2);
  }

  function syncDisplayControlValues() {
    if (els.displayBrightnessValue) els.displayBrightnessValue.textContent = formatDisplayValue('brightness', displaySettings.brightness);
    if (els.displayGammaValue) els.displayGammaValue.textContent = formatDisplayValue('gamma', displaySettings.gamma);
    if (els.displayHazeStartValue) els.displayHazeStartValue.textContent = formatDisplayValue('hazeStartM', displaySettings.hazeStartM);
    if (els.displayHazeStrengthValue) els.displayHazeStrengthValue.textContent = formatDisplayValue('hazeStrength', displaySettings.hazeStrength);
    if (els.displayDesaturateValue) els.displayDesaturateValue.textContent = formatDisplayValue('desaturateStrength', displaySettings.desaturateStrength);
    if (els.displayFadeDistanceValue) els.displayFadeDistanceValue.textContent = formatDisplayValue('fadeDistanceM', displaySettings.fadeDistanceM);
  }

  function syncTerrainPaintControlValues() {
    if (els.paintHeightStrengthValue) els.paintHeightStrengthValue.textContent = terrainPaintSettings.heightStrength.toFixed(2);
    if (els.paintRelativeHeightValue) els.paintRelativeHeightValue.textContent = terrainPaintSettings.relativeHeightStrength.toFixed(2);
    if (els.paintHeightContrastValue) els.paintHeightContrastValue.textContent = terrainPaintSettings.heightContrast.toFixed(2);
    if (els.paintHillshadeValue) els.paintHillshadeValue.textContent = terrainPaintSettings.hillshadeStrength.toFixed(2);
    if (els.paintDistanceStrengthValue) els.paintDistanceStrengthValue.textContent = terrainPaintSettings.distanceStrength.toFixed(2);
    if (els.paintDistanceDesaturateValue) els.paintDistanceDesaturateValue.textContent = terrainPaintSettings.distanceDesaturate.toFixed(2);
    if (els.paintDistanceStartValue) els.paintDistanceStartValue.textContent = `${Math.round(terrainPaintSettings.distanceStartM)}m`;
    if (els.paintDistanceEndValue) els.paintDistanceEndValue.textContent = `${Math.round(terrainPaintSettings.distanceEndM)}m`;
  }

  function terrainPaintHeightRange(material) {
    const minY = Number(material?.userData?.paintMinY);
    const maxY = Number(material?.userData?.paintMaxY);
    if (!Number.isFinite(minY) || !Number.isFinite(maxY) || Math.abs(maxY - minY) < 0.01) {
      return { minY: -80, maxY: 180 };
    }
    return { minY, maxY };
  }

  function terrainPaintReferenceHeight() {
    try {
      if (currentFocus && currentPatch) {
        const local = localFromLonLatUnbounded(currentFocus.lng, currentFocus.lat);
        if (local) return groundYAtLocal(local.x, local.z);
      }
    } catch (_) {}
    return Number(cameraState.target?.y || 0) - 80;
  }

  function updateMaterialPaintRange(mesh) {
    const position = mesh?.geometry?.attributes?.position;
    const material = mesh?.material;
    if (!position || !material) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      const y = position.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return;
    material.userData.paintMinY = minY;
    material.userData.paintMaxY = maxY;
    applyDisplayMaterial(material);
  }

  function disposeAerialTextures() {
    aerialTexture?.dispose?.();
    aerialTextureOuter?.dispose?.();
    aerialTexture = null;
    aerialTextureOuter = null;
  }

  function terrainAerialUvUniforms() {
    if (!currentPatch) return null;
    const p = currentPatch;
    const ring = terrainOuterRing;
    const centerPx = patchCenterDemPx(p);
    const hiScale = 2 ** ((p.effectiveAerialZ ?? AERIAL_Z) - TERRAIN_Z);
    const hiCount = Math.max(1, p.aerialCount || 1);
    const hiDenom = TILE_SIZE * p.mpp * hiCount;
    const hiUx = hiScale / hiDenom;
    const hiU0 = ((p.originX + centerPx.x / TILE_SIZE) * hiScale - (p.aerialOriginX ?? 0)) / hiCount;
    const hiVy = -hiScale / hiDenom;
    const hiV0 = 1 - ((p.originY + centerPx.y / TILE_SIZE) * hiScale - (p.aerialOriginY ?? 0)) / hiCount;

    let outerUx = hiUx;
    let outerU0 = hiU0;
    let outerVy = hiVy;
    let outerV0 = hiV0;
    if (ring) {
      const ringMpp = ring.ringMpp ?? metersPerPixel(p.focus?.lat ?? DEFAULT_OBSERVER_LAT, ring.demZ);
      const ringPx = Math.max(1, ring.px || 1);
      const ringFocusPxX = ring.focusPxX ?? ringPx / 2;
      const ringFocusPxY = ring.focusPxY ?? ringPx / 2;
      outerUx = 1 / (ringMpp * ringPx);
      outerU0 = ringFocusPxX / ringPx;
      outerVy = -1 / (ringMpp * ringPx);
      outerV0 = 1 - ringFocusPxY / ringPx;
    }

    return { hiUx, hiU0, hiVy, hiV0, outerUx, outerU0, outerVy, outerV0 };
  }

  function attachTerrainAerialUniforms(shader, coeffs) {
    const c = coeffs || terrainAerialUvUniforms() || {
      hiUx: 0, hiU0: 0.5, hiVy: 0, hiV0: 0.5,
      outerUx: 0, outerU0: 0.5, outerVy: 0, outerV0: 0.5
    };
    shader.uniforms.hiUx = { value: c.hiUx };
    shader.uniforms.hiU0 = { value: c.hiU0 };
    shader.uniforms.hiVy = { value: c.hiVy };
    shader.uniforms.hiV0 = { value: c.hiV0 };
    shader.uniforms.outerUx = { value: c.outerUx };
    shader.uniforms.outerU0 = { value: c.outerU0 };
    shader.uniforms.outerVy = { value: c.outerVy };
    shader.uniforms.outerV0 = { value: c.outerV0 };
  }

  function attachTerrainAerialShader(material) {
    const AERIAL_SHADER_VERSION = 3;
    if (!material?.userData?.terrainAerial) return;
    if (material.userData.terrainAerialAttached === AERIAL_SHADER_VERSION) return;
    material.userData.terrainAerialAttached = AERIAL_SHADER_VERSION;
    material.userData.terrainAerialShader = null;
    const priorCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader) => {
      priorCompile?.(shader);
      shader.uniforms.mapOuter = { value: aerialTextureOuter || aerialTexture };
      attachTerrainAerialUniforms(shader);
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
          #include <common>
          varying vec2 vTerrainLocalXZ;
        `
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          #include <begin_vertex>
          vTerrainLocalXZ = vec2(position.x, position.z);
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_pars_fragment>',
        `
          #include <map_pars_fragment>
          uniform sampler2D mapOuter;
          uniform float hiUx;
          uniform float hiU0;
          uniform float hiVy;
          uniform float hiV0;
          uniform float outerUx;
          uniform float outerU0;
          uniform float outerVy;
          uniform float outerV0;
          varying vec2 vTerrainLocalXZ;
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
          float hiU = hiUx * vTerrainLocalXZ.x + hiU0;
          float hiV = hiVy * vTerrainLocalXZ.y + hiV0;
          float outerU = outerUx * vTerrainLocalXZ.x + outerU0;
          float outerV = outerVy * vTerrainLocalXZ.y + outerV0;
          bool hiInside = hiU >= 0.0 && hiU <= 1.0 && hiV >= 0.0 && hiV <= 1.0;
          bool outerInside = outerU >= 0.0 && outerU <= 1.0 && outerV >= 0.0 && outerV <= 1.0;
          vec4 sampledDiffuseColor;
          if (hiInside) {
            sampledDiffuseColor = texture2D(map, vec2(hiU, hiV));
          } else if (outerInside) {
            sampledDiffuseColor = texture2D(mapOuter, vec2(outerU, outerV));
          } else {
            discard;
          }
          diffuseColor *= sampledDiffuseColor;
        `
      );
      material.userData.terrainAerialShader = shader;
    };
    material.needsUpdate = true;
  }

  function updateTerrainAerialUniforms(material) {
    const shader = material?.userData?.terrainAerialShader;
    if (!shader?.uniforms) return;
    shader.uniforms.mapOuter.value = aerialTextureOuter || aerialTexture;
    const coeffs = terrainAerialUvUniforms();
    if (!coeffs) return;
    shader.uniforms.hiUx.value = coeffs.hiUx;
    shader.uniforms.hiU0.value = coeffs.hiU0;
    shader.uniforms.hiVy.value = coeffs.hiVy;
    shader.uniforms.hiV0.value = coeffs.hiV0;
    shader.uniforms.outerUx.value = coeffs.outerUx;
    shader.uniforms.outerU0.value = coeffs.outerU0;
    shader.uniforms.outerVy.value = coeffs.outerVy;
    shader.uniforms.outerV0.value = coeffs.outerV0;
  }

  const TERRAIN_DISPLAY_SHADER_VERSION = 6;
  const TERRAIN_HORIZON_MASK_DISCARD = `
            if (fpvHorizonMask > 0.5) {
              vec2 maskUv = vec2(gl_FragCoord.x / fpvHorizonMaskResolution.x, gl_FragCoord.y / fpvHorizonMaskResolution.y);
              if (texture2D(fpvHorizonScreenMask, maskUv).r > 0.5) discard;
            }
  `;

  function fpvHorizonScreenMaskFallbackTexture() {
    if (!fpvHorizonScreenMaskFallback) {
      fpvHorizonScreenMaskFallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
      fpvHorizonScreenMaskFallback.needsUpdate = true;
    }
    return fpvHorizonScreenMaskFallback;
  }

  function ensureTerrainHorizonMaskUniforms(material) {
    if (!material) return null;
    if (!material.userData.terrainHorizonMaskUniforms) {
      material.userData.terrainHorizonMaskUniforms = {
        fpvHorizonMask: { value: 0 },
        fpvHorizonScreenMask: { value: fpvHorizonScreenMaskFallbackTexture() },
        fpvHorizonMaskResolution: { value: new THREE.Vector2(1, 1) }
      };
    }
    return material.userData.terrainHorizonMaskUniforms;
  }

  function updateTerrainHorizonMaskUniforms(material, screenMaskTexture = null) {
    if (!material) return;
    const maskUniforms = ensureTerrainHorizonMaskUniforms(material);
    if (!maskUniforms) return;
    const profile = horizonDrawProfileData();
    const enabled = !!(cameraState.observerMode && profile?.length && screenMaskTexture);
    maskUniforms.fpvHorizonMask.value = enabled ? 1 : 0;
    maskUniforms.fpvHorizonScreenMask.value = screenMaskTexture || fpvHorizonScreenMaskFallbackTexture();
    if (!enabled) return;
    maskUniforms.fpvHorizonMaskResolution.value.set(
      Math.max(1, renderer.domElement.width),
      Math.max(1, renderer.domElement.height)
    );
  }

  function applyDisplayMaterial(material) {
    if (!material) return;
    material.color?.setScalar?.(1);
    material.fog = true;
    const aerialSurface = imageryKey !== 'terrain';
    const terrainPaintOverlay = aerialSurface ? 0 : 1;
    if (material.userData.displayControlsVersion !== TERRAIN_DISPLAY_SHADER_VERSION) {
      material.userData.displayControlsAttached = false;
      material.userData.displayControlsVersion = TERRAIN_DISPLAY_SHADER_VERSION;
      material.userData.terrainAerialAttached = 0;
      material.userData.terrainAerialShader = null;
    }
    if (!material.userData.displayControlsAttached) {
      material.userData.displayControlsAttached = true;
      const horizonMaskUniforms = ensureTerrainHorizonMaskUniforms(material);
      material.onBeforeCompile = (shader) => {
        shader.uniforms.fpvHorizonMask = horizonMaskUniforms.fpvHorizonMask;
        shader.uniforms.fpvHorizonScreenMask = horizonMaskUniforms.fpvHorizonScreenMask;
        shader.uniforms.fpvHorizonMaskResolution = horizonMaskUniforms.fpvHorizonMaskResolution;
        shader.uniforms.displayBrightness = { value: displaySettings.brightness };
        shader.uniforms.displayGamma = { value: displaySettings.gamma };
        shader.uniforms.displayDesaturate = { value: displaySettings.desaturateStrength };
        shader.uniforms.paintHeightStrength = { value: terrainPaintSettings.heightStrength };
        shader.uniforms.paintRelativeHeightStrength = { value: terrainPaintSettings.relativeHeightStrength };
        shader.uniforms.paintHeightContrast = { value: terrainPaintSettings.heightContrast };
        shader.uniforms.paintHillshadeStrength = { value: terrainPaintSettings.hillshadeStrength };
        shader.uniforms.paintDistanceStrength = { value: terrainPaintSettings.distanceStrength };
        shader.uniforms.paintDistanceDesaturate = { value: terrainPaintSettings.distanceDesaturate };
        shader.uniforms.paintDistanceStart = { value: terrainPaintSettings.distanceStartM };
        shader.uniforms.paintDistanceEnd = { value: terrainPaintSettings.distanceEndM };
        shader.uniforms.paintDistanceBands = { value: terrainPaintSettings.distanceBands ? 1.0 : 0.0 };
        shader.uniforms.paintReferenceHeight = { value: terrainPaintReferenceHeight() };
        const range = terrainPaintHeightRange(material);
        shader.uniforms.paintHeightMin = { value: range.minY };
        shader.uniforms.paintHeightMax = { value: range.maxY };
        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `
            #include <common>
            varying vec3 vPaintWorldPosition;
            varying vec3 vPaintNormal;
            varying float vPaintHeight;
          `
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
            #include <begin_vertex>
            vPaintWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vPaintNormal = normalize(normalMatrix * normal);
            vPaintHeight = transformed.y;
          `
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `
            float paintRange = max(1.0, paintHeightMax - paintHeightMin);
            if (paintTerrainOverlay > 0.5) {
              float heightT = clamp((vPaintHeight - paintHeightMin) / paintRange, 0.0, 1.0);
              heightT = pow(heightT, 1.0 / max(paintHeightContrast, 0.001));
              vec3 lowTint = vec3(0.38, 0.48, 0.27);
              vec3 midTint = vec3(0.74, 0.58, 0.36);
              vec3 highTint = vec3(0.78, 0.83, 0.88);
              vec3 heightTint = mix(lowTint, midTint, smoothstep(0.05, 0.62, heightT));
              heightTint = mix(heightTint, highTint, smoothstep(0.58, 1.0, heightT));
              gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * heightTint * 1.28, paintHeightStrength);

              float relativeT = smoothstep(-0.22, 0.26, ((vPaintHeight - paintReferenceHeight) / paintRange) * paintHeightContrast);
              vec3 relativeTint = mix(vec3(0.72, 0.82, 1.0), vec3(1.12, 0.94, 0.72), relativeT);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * relativeTint, paintRelativeHeightStrength);

              vec3 paintSun = normalize(vec3(-0.45, 0.78, 0.42));
              float shade = dot(normalize(vPaintNormal), paintSun) * 0.5 + 0.5;
              shade = mix(1.0 - paintHillshadeStrength * 0.65, 1.0 + paintHillshadeStrength * 0.55, shade);
              gl_FragColor.rgb *= shade;
            }

            float paintDistance = distance(vPaintWorldPosition, cameraPosition);
            float distanceT = smoothstep(paintDistanceStart, max(paintDistanceStart + 1.0, paintDistanceEnd), paintDistance);
            float nearT = 1.0 - smoothstep(0.0, paintDistanceStart, paintDistance);
            float distanceLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
            vec3 farGrey = mix(gl_FragColor.rgb, vec3(distanceLum), paintDistanceDesaturate * distanceT);
            vec3 farCool = mix(farGrey, vec3(0.66, 0.78, 0.92), 0.52 * distanceT);
            farCool = mix(farCool, vec3(0.82, 0.88, 0.95), 0.18 * distanceT);
            vec3 nearRich = gl_FragColor.rgb * mix(1.0, 1.10, nearT * paintDistanceStrength);
            gl_FragColor.rgb = mix(nearRich, farCool, clamp(paintDistanceStrength * distanceT, 0.0, 1.0));

            float band = smoothstep(0.48, 0.5, abs(fract(paintDistance / 2500.0) - 0.5));
            gl_FragColor.rgb *= 1.0 - (1.0 - band) * paintDistanceBands * paintDistanceStrength * 0.08;

            gl_FragColor.rgb *= displayBrightness;
            gl_FragColor.rgb = pow(max(gl_FragColor.rgb, vec3(0.0)), vec3(1.0 / max(displayGamma, 0.001)));
            float displayLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(displayLum), displayDesaturate);
            ${TERRAIN_HORIZON_MASK_DISCARD}
            #include <dithering_fragment>
          `
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          'void main() {',
          `
            varying vec3 vPaintWorldPosition;
            varying vec3 vPaintNormal;
            varying float vPaintHeight;
            uniform float fpvHorizonMask;
            uniform sampler2D fpvHorizonScreenMask;
            uniform vec2 fpvHorizonMaskResolution;
            uniform float displayBrightness;
            uniform float displayGamma;
            uniform float displayDesaturate;
            uniform float paintTerrainOverlay;
            uniform float paintHeightStrength;
            uniform float paintRelativeHeightStrength;
            uniform float paintHeightContrast;
            uniform float paintHillshadeStrength;
            uniform float paintDistanceStrength;
            uniform float paintDistanceDesaturate;
            uniform float paintDistanceStart;
            uniform float paintDistanceEnd;
            uniform float paintDistanceBands;
            uniform float paintReferenceHeight;
            uniform float paintHeightMin;
            uniform float paintHeightMax;
            void main() {
          `
        );
        shader.uniforms.paintTerrainOverlay = { value: terrainPaintOverlay };
        material.userData.displayShader = shader;
      };
      material.needsUpdate = true;
    }
    const shader = material.userData.displayShader;
    if (shader?.uniforms) {
      let distStart;
      let distEnd;
      let distStrength;
      let distDesat;
      if (aerialSurface) {
        distStart = 80000;
        distEnd = 90000;
        distStrength = 0;
        distDesat = 0;
      } else {
        distStart = terrainPaintSettings.distanceStartM;
        distEnd = terrainPaintSettings.distanceEndM;
        distStrength = terrainPaintSettings.distanceStrength;
        distDesat = terrainPaintSettings.distanceDesaturate;
      }
      shader.uniforms.displayBrightness.value = displaySettings.brightness;
      shader.uniforms.displayGamma.value = displaySettings.gamma;
      shader.uniforms.displayDesaturate.value = displaySettings.desaturateStrength;
      shader.uniforms.paintTerrainOverlay.value = terrainPaintOverlay;
      shader.uniforms.paintHeightStrength.value = terrainPaintSettings.heightStrength;
      shader.uniforms.paintRelativeHeightStrength.value = terrainPaintSettings.relativeHeightStrength;
      shader.uniforms.paintHeightContrast.value = terrainPaintSettings.heightContrast;
      shader.uniforms.paintHillshadeStrength.value = terrainPaintSettings.hillshadeStrength;
      shader.uniforms.paintDistanceStrength.value = distStrength;
      shader.uniforms.paintDistanceDesaturate.value = distDesat;
      shader.uniforms.paintDistanceStart.value = distStart;
      shader.uniforms.paintDistanceEnd.value = distEnd;
      shader.uniforms.paintDistanceBands.value = terrainPaintSettings.distanceBands ? 1.0 : 0.0;
      shader.uniforms.paintReferenceHeight.value = terrainPaintReferenceHeight();
      const range = terrainPaintHeightRange(material);
      shader.uniforms.paintHeightMin.value = range.minY;
      shader.uniforms.paintHeightMax.value = range.maxY;
    }
    if (material.userData.terrainAerial) {
      attachTerrainAerialShader(material);
      updateTerrainAerialUniforms(material);
    }
    updateTerrainHorizonMaskUniforms(material);
  }

  function applyDisplaySettings() {
    syncTerrainPaintControlValues();
    syncDisplayControlValues();

    renderer.domElement.style.filter = '';
    renderer.toneMappingExposure = displaySettings.brightness;

    if (scene.fog) {
      if (displaySettings.hazeStrength <= 0.001) {
        scene.fog.near = 1e9;
        scene.fog.far = 1e9;
      } else {
        scene.fog.near = displaySettings.hazeStartM;
        scene.fog.far = displaySettings.hazeStartM + (displaySettings.fadeDistanceM / (0.28 + displaySettings.hazeStrength * 1.7));
      }
    }

    if (skyDome?.material?.uniforms) {
      const uniforms = skyDome.material.uniforms;
      uniforms.hazeStart.value = -0.12 + displaySettings.hazeStrength * 0.12;
      uniforms.hazeEnd.value = 0.34 + displaySettings.hazeStrength * 0.18;
      uniforms.exponent.value = Math.max(0.7, Math.min(2.2, 1.35 / displaySettings.gamma));
    }

    applyDisplayMaterial(terrainMesh?.material);
  }

  function updateTerrainMaterialUniforms() {
    applyDisplayMaterial(terrainMesh?.material);
  }

  function updateAstroOverlay() {
    astronomyOverlay?.updateOverlay(false, { repositionOnly: true });
  }

  function syncAstroReadout() {
    const show = !!cameraState.observerMode;
    els.sunReadoutWrap?.classList.toggle('hidden', !show);
    els.moonReadoutWrap?.classList.toggle('hidden', !show);
    if (!show) return;

    const fmtDeg = (v) => (Number.isFinite(v) ? Number(v).toFixed(1) : '--');
    const horizons = astronomyOverlay?.getBodyHorizons?.();
    const sun = horizons?.sun;
    const moon = horizons?.moon;
    if (els.sunAltReadout) els.sunAltReadout.textContent = fmtDeg(sun?.altitude);
    if (els.sunAziReadout) els.sunAziReadout.textContent = fmtDeg(sun?.azimuth);
    if (els.moonAltReadout) els.moonAltReadout.textContent = fmtDeg(moon?.altitude);
    if (els.moonAziReadout) els.moonAziReadout.textContent = fmtDeg(moon?.azimuth);
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

  function corePatchHalfM(lat) {
    const count = demAreaKey === 'double' ? TERRAIN_TILE_COUNT_DOUBLE : TERRAIN_TILE_COUNT;
    const mpp = metersPerPixel(lat, TERRAIN_Z);
    return (count * TILE_SIZE * mpp) / 2;
  }

  function buildTerrainOuterRingConfig(lat) {
    const coreHalf = corePatchHalfM(lat);
    return {
      demZ: TERRAIN_OUTER_Z,
      aerialZ: TERRAIN_OUTER_AERIAL_Z,
      tileRadius: TERRAIN_OUTER_TILE_RADIUS,
      extentRadiusM: TERRAIN_OUTER_EXTENT_M,
      innerBoundaryHalfM: coreHalf
    };
  }

  function terrainOuterRingLayers() {
    return terrainOuterRing ? [terrainOuterRing] : [];
  }

  function terrainTileCount() {
    return demAreaKey === 'double' ? TERRAIN_TILE_COUNT_DOUBLE : TERRAIN_TILE_COUNT;
  }

  function terrainGridSize(count) {
    return Math.round(GRID * (count / TERRAIN_TILE_COUNT));
  }

  function aerialZoomForTileCount(count) {
    return AERIAL_Z;
  }

  function configureTerrainTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  function downscaleCanvasIfNeeded(canvas, maxPx) {
    const maxDim = Math.max(canvas.width, canvas.height);
    if (maxDim <= maxPx) return canvas;
    const scale = maxPx / maxDim;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    return out;
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

  async function fetchMonumentsFromSources(sourceIds, queryOpts) {
    const collected = [];
    let failures = 0;
    await Promise.all(sourceIds.map(async (sourceId) => {
      try {
        const features = await fetchArcgisFeaturesFromSource(sourceId, queryOpts);
        collected.push(...features);
      } catch (e) {
        failures += 1;
        console.warn(`[nms] ${sourceId} query failed:`, e?.message || e);
      }
    }));
    if (!collected.length && failures === sourceIds.length) {
      throw new Error('Monument data unavailable from all sources (network or CORS).');
    }
    return collected;
  }

  async function fetchAllMonumentsInEnvelope(env, maxFeatures = 12000) {
    const roi = await fetchMonumentsFromSources([MONUMENT_SOURCE_ROI], {
      where: whereForSourceAllMonuments(MONUMENT_SOURCE_ROI),
      envelope: env,
      maxFeatures
    }).catch(() => []);
    const ni = await fetchMonumentsFromSources([MONUMENT_SOURCE_NI], {
      where: whereForSourceAllMonuments(MONUMENT_SOURCE_NI),
      envelope: env,
      maxFeatures
    }).catch(() => []);
    return [...roi, ...ni];
  }

  async function fetchRelationalMonumentsInEnvelope(env) {
    const warnings = [];
    let roi = [];
    let ni = [];

    try {
      roi = await fetchArcgisFeaturesFromSource(MONUMENT_SOURCE_ROI, {
        where: whereForSourceAllTypes(MONUMENT_SOURCE_ROI),
        envelope: env,
        maxFeatures: HORIZON_RELATIONAL_ROI_MAX
      });
    } catch (e) {
      const msg = e?.message || String(e);
      warnings.push(`ROI query failed: ${msg}`);
      console.warn('[horizon-relational] ROI fetch failed:', msg);
    }

    try {
      ni = await fetchArcgisFeaturesFromSource(MONUMENT_SOURCE_NI, {
        where: whereForSourceAllMonuments(MONUMENT_SOURCE_NI),
        envelope: env,
        maxFeatures: HORIZON_RELATIONAL_NI_MAX
      });
    } catch (e) {
      const msg = e?.message || String(e);
      warnings.push(`NI HED query failed: ${msg}`);
      console.warn('[horizon-relational] NI fetch failed:', msg);
    }

    if (!roi.length && !ni.length) {
      throw new Error(warnings.length ? warnings.join(' · ') : 'No monuments returned from ROI or NI.');
    }

    return {
      features: [...roi, ...ni],
      warnings,
      sourceCounts: { roi: roi.length, ni: ni.length }
    };
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

    for (const m of horizonClusterMarkers) {
      const mClass = String(m.cluster?.members?.[0]?.props?.MONUMENT_CLASS || m.props?.MONUMENT_CLASS || '').trim();
      if (!mClass) continue;
      if (!set.has(mClass)) set.set(mClass, true);
    }

    for (const m of horizonMemberMarkers) {
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
      let features = [];
      try {
        features = await fetchArcgisFeaturesFromSource(sourceId, { where, maxFeatures: 20000 });
      } catch (e) {
        console.warn(`[nms] ${sourceId} query failed:`, e?.message || e);
        continue;
      }
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

  function setConfigSectionOpen(section, open) {
    if (!section) return;
    const body = section.querySelector('.config-section-body');
    const icon = section.querySelector('.config-section-toggle i');
    if (!body) return;
    body.classList.toggle('hidden', !open);
    if (icon) icon.className = open ? 'ph-bold ph-caret-up' : 'ph-bold ph-caret-down';
  }

  function initConfigInnerSections() {
    document.querySelectorAll('.panel-config .panel.config-inner').forEach((section) => {
      if (section.querySelector('.config-section-head')) return;
      const title = section.querySelector(':scope > .panel-title');
      if (!title) return;
      const contentNodes = [];
      let node = title.nextSibling;
      while (node) {
        contentNodes.push(node);
        node = node.nextSibling;
      }
      const head = document.createElement('div');
      head.className = 'config-section-head';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'panel-toggle config-section-toggle';
      toggle.setAttribute('aria-label', 'Toggle configuration section');
      toggle.innerHTML = '<i class="ph-bold ph-caret-down"></i>';
      head.appendChild(title);
      head.appendChild(toggle);
      section.insertBefore(head, section.firstChild);
      const body = document.createElement('div');
      body.className = 'config-section-body hidden';
      contentNodes.forEach((child) => body.appendChild(child));
      section.appendChild(body);
      setConfigSectionOpen(section, false);
    });
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

  async function drawTileIntoMosaic(ctx, template, z, x, y, dx, dy, crossOrigin) {
    const slotX = dx * TILE_SIZE;
    const slotY = dy * TILE_SIZE;
    try {
      const img = await loadImage(tileUrl(template, z, x, y), crossOrigin);
      ctx.drawImage(img, slotX, slotY, TILE_SIZE, TILE_SIZE);
      return true;
    } catch (_) {}
    if (z > 0) {
      try {
        const img = await loadImage(tileUrl(template, z - 1, Math.floor(x / 2), Math.floor(y / 2)), crossOrigin);
        ctx.drawImage(img, slotX, slotY, TILE_SIZE, TILE_SIZE);
        return true;
      } catch (_) {}
    }
    return false;
  }

  async function drawTileMosaic(template, z, originX, originY, count, options = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = count * TILE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: !!options.read });
    const crossOrigin = options.crossOrigin ?? 'anonymous';
    let failures = 0;

    await Promise.all(Array.from({ length: count * count }, async (_, i) => {
      const dx = i % count;
      const dy = Math.floor(i / count);
      const x = originX + dx;
      const y = originY + dy;
      const ok = await drawTileIntoMosaic(ctx, template, z, x, y, dx, dy, crossOrigin);
      if (!ok) failures += 1;
    }));

    if (options.required && failures === count * count) {
      throw new Error('No tiles loaded.');
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

  function centrePatchHalfM() {
    if (currentPatch?.patchMeters) return currentPatch.patchMeters / 2;
    const lat = currentFocus?.lat ?? selectedSite?.lat ?? DEFAULT_OBSERVER_LAT;
    return corePatchHalfM(lat);
  }

  function ringOutsideDistanceM(x, z, innerHalfM) {
    const outsideX = Math.max(-innerHalfM - x, x - innerHalfM, 0);
    const outsideZ = Math.max(-innerHalfM - z, z - innerHalfM, 0);
    return Math.max(outsideX, outsideZ);
  }

  function centreElevAtLocal(x, z) {
    if (!baseElev || !currentPatch) return 0;
    const u = (x / currentPatch.patchMeters) + 0.5;
    const v = (z / currentPatch.patchMeters) + 0.5;
    return sampleElevation(baseElev, baseElevSize, u, v);
  }

  function layerTileUvAtLocal(x, z, layer) {
    if (!layer?.elev || !currentPatch || layer.originX == null) return null;
    const focusPxX = currentPatch.focusDemPxX ?? currentPatch.patchPx / 2;
    const focusPxY = currentPatch.focusDemPxY ?? currentPatch.patchPx / 2;
    const terrainScale = 2 ** (TERRAIN_Z - layer.demZ);
    const xPx = x / currentPatch.mpp + focusPxX;
    const yPx = z / currentPatch.mpp + focusPxY;
    const hTileX = (currentPatch.originX + xPx / TILE_SIZE) / terrainScale;
    const hTileY = (currentPatch.originY + yPx / TILE_SIZE) / terrainScale;
    const u = (hTileX - layer.originX) / layer.count;
    const v = (hTileY - layer.originY) / layer.count;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return { u, v };
  }

  function layerElevAbsoluteAtLocal(x, z, layer) {
    const uv = layerTileUvAtLocal(x, z, layer);
    if (!uv) return centreElevAtLocal(x, z);
    return sampleElevation(layer.elev, layer.elevSize, uv.u, uv.v);
  }

  // ---------------------------------------------------------------------------
  // TERRAIN BUILDER (Phase 1)
  // One mesh: centre Z15 + one outer ring Z13 (~25 km), 50 m height blend.
  // Local metres (x,z=0) = geometric patch centre. Inner aerial UV uses patch centre;
  // outer ring aerial/heights keep focus-site origin (FPV viewshed / horizon relational).
  // ---------------------------------------------------------------------------

  function elevFromLayersUpTo(x, z, layerCount) {
    let h = centreElevAtLocal(x, z);
    const layers = terrainOuterRingLayers();
    for (let i = 0; i < layerCount && i < layers.length; i++) {
      const layer = layers[i];
      const outside = ringOutsideDistanceM(x, z, layer.innerBoundaryHalfM);
      const hSelf = layerElevAbsoluteAtLocal(x, z, layer);
      const t = smoothstep(0, HORIZON_STITCH_WIDTH_M, outside);
      h = lerp(h, hSelf, t);
    }
    return h;
  }

  function mergedTerrainHeightAt(x, z) {
    const layers = terrainOuterRingLayers();
    if (!layers.length) return centreElevAtLocal(x, z);
    return elevFromLayersUpTo(x, z, layers.length);
  }

  function ringAerialSquareHalfM() {
    const ring = terrainOuterRing;
    if (!ring || !currentPatch) return TERRAIN_OUTER_EXTENT_M;
    const lat = currentPatch.focus?.lat ?? currentFocus?.lat ?? DEFAULT_OBSERVER_LAT;
    const mpp = ring.ringMpp ?? metersPerPixel(lat, ring.demZ);
    const px = Math.max(1, ring.px || 1);
    const focusPxX = ring.focusPxX ?? px / 2;
    const focusPxY = ring.focusPxY ?? px / 2;
    const marginPx = TILE_SIZE * 0.35;
    const maxX = Math.max(0, Math.min(focusPxX - marginPx, px - focusPxX - marginPx)) * mpp;
    const maxZ = Math.max(0, Math.min(focusPxY - marginPx, px - focusPxY - marginPx)) * mpp;
    return Math.min(maxX, maxZ);
  }

  function outerAerialUvInsideAtLocal(x, z, epsilon = 0.002) {
    const uv = outerAerialUvAtLocal(x, z);
    return uv.u >= epsilon && uv.u <= 1 - epsilon && uv.v >= epsilon && uv.v <= 1 - epsilon;
  }

  function terrainMeshExtentHalfM() {
    if (!currentPatch) return TERRAIN_OUTER_EXTENT_M;
    const coreStep = currentPatch.patchMeters / terrainGridSize(currentPatch.count);
    const outerStep = Math.max(120, coreStep * 3);
    const ringHalf = ringAerialSquareHalfM();
    const targetHalf = Math.min(TERRAIN_OUTER_EXTENT_M, ringHalf) - outerStep;
    let extentHalf = Math.max(currentPatch.patchMeters / 2 + 50, targetHalf);
    while (extentHalf > currentPatch.patchMeters / 2 + 50 && !outerAerialUvInsideAtLocal(extentHalf, extentHalf)) {
      extentHalf -= outerStep;
    }
    return extentHalf;
  }

  function buildTerrainAxisLines(extentHalf) {
    if (!currentPatch) return [0];
    const coreHalf = currentPatch.patchMeters / 2;
    const coreStep = currentPatch.patchMeters / terrainGridSize(currentPatch.count);
    const outerStep = Math.max(120, coreStep * 3);
    const stitch = HORIZON_STITCH_WIDTH_M;
    const lines = new Set();

    const addRange = (min, max, step) => {
      if (max < min) return;
      lines.add(Number(min.toFixed(3)));
      lines.add(Number(max.toFixed(3)));
      const start = Math.ceil(min / step) * step;
      for (let v = start; v <= max + 1e-4; v += step) lines.add(Number(v.toFixed(3)));
    };

    addRange(-extentHalf, -coreHalf, outerStep);
    addRange(coreHalf, extentHalf, outerStep);
    addRange(-coreHalf, coreHalf, coreStep);
    addRange(-coreHalf - stitch, coreHalf + stitch, Math.max(10, coreStep / 2));
    lines.add(-extentHalf);
    lines.add(extentHalf);
    lines.add(-coreHalf);
    lines.add(coreHalf);
    lines.add(0);

    return Array.from(lines).filter((v) => v >= -extentHalf && v <= extentHalf).sort((a, b) => a - b);
  }

  function highResAerialUvAtLocal(x, z) {
    if (!currentPatch?.aerialCount) return { u: 0.5, v: 0.5 };
    const demPx = localMetersToDemPx(x, z);
    const xPx = demPx.x;
    const yPx = demPx.y;
    const aerialScale = 2 ** ((currentPatch.effectiveAerialZ ?? AERIAL_Z) - TERRAIN_Z);
    const aerialTileX = (currentPatch.originX + xPx / TILE_SIZE) * aerialScale;
    const aerialTileY = (currentPatch.originY + yPx / TILE_SIZE) * aerialScale;
    const u = (aerialTileX - currentPatch.aerialOriginX) / currentPatch.aerialCount;
    const v = (aerialTileY - currentPatch.aerialOriginY) / currentPatch.aerialCount;
    return { u, v: 1 - v };
  }

  function outerAerialUvAtLocal(x, z) {
    const ring = terrainOuterRing;
    if (!ring) return highResAerialUvAtLocal(x, z);
    const ringMpp = ring.ringMpp ?? metersPerPixel(currentPatch.focus?.lat ?? DEFAULT_OBSERVER_LAT, ring.demZ);
    const pxX = (ring.focusPxX ?? ring.px / 2) + x / ringMpp;
    const pxY = (ring.focusPxY ?? ring.px / 2) + z / ringMpp;
    const u = pxX / ring.px;
    const v = 1 - pxY / ring.px;
    return { u, v };
  }

  function terrainUvsAtLocal(x, z) {
    const hi = highResAerialUvAtLocal(x, z);
    const outer = outerAerialUvAtLocal(x, z);
    return { u: hi.u, v: hi.v, outerU: outer.u, outerV: outer.v };
  }

  function buildTerrainMeshGeometry(ve = effectiveVerticalExaggeration()) {
    const extentHalf = terrainMeshExtentHalfM();
    const xLines = buildTerrainAxisLines(extentHalf);
    const zLines = buildTerrainAxisLines(extentHalf);
    const positions = [];
    const uvs = [];
    const uvOuters = [];
    const indices = [];

    for (let iz = 0; iz < zLines.length; iz++) {
      const z = zLines[iz];
      for (let ix = 0; ix < xLines.length; ix++) {
        const x = xLines[ix];
        const h = mergedTerrainHeightAt(x, z);
        positions.push(x, (h - baseCenterElev) * ve, z);
        const uv = terrainUvsAtLocal(x, z);
        uvs.push(uv.u, uv.v);
        uvOuters.push(uv.outerU, uv.outerV);
      }
    }

    const rowStride = xLines.length;
    for (let iz = 0; iz < zLines.length - 1; iz++) {
      for (let ix = 0; ix < xLines.length - 1; ix++) {
        const a = iz * rowStride + ix;
        const b = a + 1;
        const c = a + rowStride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uvOuter', new THREE.Float32BufferAttribute(uvOuters, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function applyTerrainMeshHeights(mesh, ve = effectiveVerticalExaggeration()) {
    if (!mesh) return;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const h = mergedTerrainHeightAt(pos.getX(i), pos.getZ(i));
      pos.setY(i, (h - baseCenterElev) * ve);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    updateMaterialPaintRange(mesh);
  }

  function rebuildTerrainHeights() {
    const ve = effectiveVerticalExaggeration();
    if (terrainMesh && baseElev && currentPatch) {
      applyTerrainMeshHeights(terrainMesh, ve);
    }
    addSiteMarker(currentPatch?.site);
  }

  function clearTerrainOuterRing() {
    terrainOuterRing = null;
    horizonPatchMeters = 0;
  }

  async function loadTerrainOuterRingPack(focus, cfg, aerialTemplate, useRelief) {
    const tile = lonLatToTile(focus.lng, focus.lat, cfg.demZ);
    const count = cfg.tileRadius * 2 + 1;
    const originX = Math.floor(tile.x) - cfg.tileRadius;
    const originY = Math.floor(tile.y) - cfg.tileRadius;
    const demCanvas = await drawTileMosaic(TERRARIUM_URL, cfg.demZ, originX, originY, count, { read: true, required: true });
    const px = count * TILE_SIZE;
    const mppSkirt = metersPerPixel(focus.lat, cfg.demZ);
    let aerialCanvas;
    if (useRelief) {
      const elevTmp = decodeTerrariumCanvas(demCanvas);
      aerialCanvas = buildTerrainReliefCanvas(elevTmp, px, mppSkirt);
    } else {
      const aerialScale = 2 ** (cfg.aerialZ - cfg.demZ);
      const aerialOriginX = originX * aerialScale;
      const aerialOriginY = originY * aerialScale;
      const aerialCount = count * aerialScale;
      try {
        aerialCanvas = await drawTileMosaic(aerialTemplate, cfg.aerialZ, aerialOriginX, aerialOriginY, aerialCount, { required: true });
      } catch (_) {
        aerialCanvas = await drawTileMosaic(ESRI_CLARITY_URL, cfg.aerialZ, aerialOriginX, aerialOriginY, aerialCount, { required: true });
      }
    }
    const centerU = ((tile.x - originX) * TILE_SIZE) / px;
    const centerV = ((tile.y - originY) * TILE_SIZE) / px;
    const elev = decodeTerrariumCanvas(demCanvas);
    const centerElev = sampleElevation(elev, px, centerU, centerV);
    const focusPxX = (tile.x - originX) * TILE_SIZE;
    const focusPxY = (tile.y - originY) * TILE_SIZE;
    return {
      demZ: cfg.demZ,
      innerBoundaryHalfM: cfg.innerBoundaryHalfM,
      extentRadiusM: cfg.extentRadiusM,
      originX,
      originY,
      count,
      px,
      meters: px * mppSkirt,
      ringMpp: mppSkirt,
      focusPxX,
      focusPxY,
      elev,
      elevSize: px,
      centerElev,
      aerialCanvas,
      demCanvas
    };
  }

  async function buildTerrain(focus, options = {}) {
    const skipMonumentLoad = !!options.skipMonumentLoad;
    const token = ++loadingToken;
    const focusObserver = { lat: Number(focus.lat), lng: Number(focus.lng) };
    if (!horizonCacheValidForObserver(focusObserver)) {
      clearViewshedHorizon();
    } else {
      cancelViewshedHorizonCompute();
    }
    clearTerrainOuterRing();

    const centerTile = lonLatToTile(focus.lng, focus.lat, TERRAIN_Z);
    const count = terrainTileCount();
    const effectiveAerialZ = aerialZoomForTileCount(count);
    const aerialTemplate = imageryKey === 'esri-clarity' ? ESRI_CLARITY_URL : GOOGLE_AERIAL_URL;
    const useRelief = imageryKey === 'terrain';
    const outerKm = Math.round(TERRAIN_OUTER_EXTENT_M / 1000);
    els.nmsStatus.textContent = `Loading ${demAreaKey === 'double' ? 'double' : 'standard'} high-res DEM (Z${TERRAIN_Z}) + outer ring Z${TERRAIN_OUTER_Z} (~${outerKm} km)…`;
    if (!siteDemReady) {
      setStageLoadingText(els.nmsStatus.textContent);
      setStageLoadingProgress(0.05, { cap: 0.22 });
    }
    const originX = Math.floor(centerTile.x - count / 2);
    const originY = Math.floor(centerTile.y - count / 2);
    const patchPx = count * TILE_SIZE;
    const mpp = metersPerPixel(focus.lat, TERRAIN_Z);
    const patchMeters = patchPx * mpp;

    const outerRingConfig = buildTerrainOuterRingConfig(focus.lat);
    const outerRingPromise = loadTerrainOuterRingPack(focus, outerRingConfig, aerialTemplate, useRelief);

    if (!siteDemReady) setStageLoadingProgress(0.08, { cap: 0.24 });
    const demCanvas = await drawTileMosaic(TERRARIUM_URL, TERRAIN_Z, originX, originY, count, { read: true, required: true });
    if (token !== loadingToken) return;

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

    let aerialCanvas = null;
    let aerialOriginX = originX;
    let aerialOriginY = originY;
    let aerialCount = count;
    if (useRelief) {
      aerialCanvas = buildTerrainReliefCanvas(elev, patchPx, mpp);
    } else {
      if (!siteDemReady) {
        setStageLoadingText('Loading imagery…');
        setStageLoadingProgress(0.46, { cap: 0.70 });
      }
      const aerialScale = 2 ** (effectiveAerialZ - TERRAIN_Z);
      const aerialMarginTiles = Math.max(1, Math.ceil(HORIZON_AERIAL_OVERLAP_M / (TILE_SIZE * metersPerPixel(focus.lat, effectiveAerialZ))));
      aerialOriginX = originX * aerialScale - aerialMarginTiles;
      aerialOriginY = originY * aerialScale - aerialMarginTiles;
      aerialCount = count * aerialScale + aerialMarginTiles * 2;
      try {
        aerialCanvas = await drawTileMosaic(aerialTemplate, effectiveAerialZ, aerialOriginX, aerialOriginY, aerialCount, { required: true });
      } catch (e) {
        aerialCanvas = await drawTileMosaic(ESRI_CLARITY_URL, effectiveAerialZ, aerialOriginX, aerialOriginY, aerialCount, { required: true });
        els.nmsStatus.textContent = 'Google texture failed; displayed Esri Clarity texture for WebGL terrain.';
        if (!siteDemReady) setStageLoadingText(els.nmsStatus.textContent);
      }
      aerialCanvas = downscaleCanvasIfNeeded(aerialCanvas, renderer.capabilities.maxTextureSize);
    }

    terrainOuterRing = await outerRingPromise;
    if (token !== loadingToken) return;

    horizonPatchMeters = terrainOuterRing?.meters || 0;

    if (!siteDemReady) {
      setStageLoadingText('Building terrain mesh…');
      setStageLoadingProgress(0.72, { cap: 0.92 });
    }

    clearLabels();
    currentPatch = {
      site: selectedSite || focus,
      focus: { lat: focus.lat, lng: focus.lng },
      originX,
      originY,
      count,
      patchPx,
      patchMeters,
      mpp,
      centerTile,
      centerElev,
      focusDemPxX: centerPxX,
      focusDemPxY: centerPxY,
      effectiveAerialZ,
      aerialOriginX,
      aerialOriginY,
      aerialCount
    };

    const textureCanvas = aerialCanvas;

    if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.geometry.dispose();
      terrainMesh.material.dispose();
    }
    disposeAerialTextures();

    aerialTexture = configureTerrainTexture(new THREE.CanvasTexture(textureCanvas));
    if (!useRelief && terrainOuterRing?.aerialCanvas) {
      const outerCanvas = downscaleCanvasIfNeeded(terrainOuterRing.aerialCanvas, renderer.capabilities.maxTextureSize);
      aerialTextureOuter = configureTerrainTexture(new THREE.CanvasTexture(outerCanvas));
    }

    const terrainMaterial = new THREE.MeshLambertMaterial({ map: aerialTexture });
    terrainMaterial.userData.terrainAerial = !useRelief;
    applyDisplayMaterial(terrainMaterial);
    const geometry = buildTerrainMeshGeometry(effectiveVerticalExaggeration());
    terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    updateMaterialPaintRange(terrainMesh);
    terrainMesh.receiveShadow = true;
    terrainMesh.renderOrder = 2;
    terrainMesh.frustumCulled = false;
    scene.add(terrainMesh);

    addSiteMarker(selectedSite || focus);
    if (!siteDemReady) setStageLoadingProgress(0.92, { cap: 0.99 });
    const selectedLabel = labelItems.find(x => x.id === 'selected-site');
    if (selectedLabel) {
      notesActionItem = { id: selectedLabel.id, local: selectedLabel.local, lat: selectedLabel.lat, lng: selectedLabel.lng, props: selectedLabel.props, text: markerLabelText(selectedLabel.props || {}), detail: markerLabelDetail(selectedLabel.props || {}), el: selectedLabel.el };
      setActiveLabelById(selectedLabel.id);
    }
    updateNotesActions();
    if (!skipMonumentLoad) {
      if (showRelatedMonuments) await addNmsMarkers();
      if (showAllRelational) await loadRelationalMarkersInView();
      if (showAllMonuments) await loadAllMonumentMarkersInView();
      if (showHorizonRelational) await loadHorizonRelationalMarkers();
      if (showAllLabels) rebuildAllLabelsFromShownMarkers();
    }
    updateFocusTarget();
    updateCamera();
    els.nmsStatus.textContent = `3D terrain loaded. Single mesh: Z${TERRAIN_Z} centre + Z${TERRAIN_OUTER_Z} outer (~${outerKm} km).`;
    if (!siteDemReady) setStageLoadingProgress(1, { cap: 1 });
    syncTerrainViewAstroUi();
    purgeViewshedVisualsUnlessPanorama();
    if (cameraState.observerMode) {
      if (viewshedHorizonData?.length && viewshedHorizonObserver) {
        applyViewshedHorizonVisuals(viewshedHorizonData, viewshedHorizonObserver, viewshedObserverH);
      } else {
        scheduleViewshedHorizonBackground(null, false);
      }
    }
    applyDisplaySettings();
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

  function patchCenterDemPx(patch = currentPatch) {
    const px = patch?.patchPx ?? 0;
    return { x: px / 2, y: px / 2 };
  }

  function localMetersToDemPx(x, z, patch = currentPatch) {
    const center = patchCenterDemPx(patch);
    const mpp = patch?.mpp ?? 1;
    return { x: x / mpp + center.x, y: z / mpp + center.y };
  }

  function terrainYAtLocal(x, z) {
    if (!terrainMesh || !currentPatch || !baseElev) return 0;
    const h = mergedTerrainHeightAt(x, z);
    return (h - baseCenterElev) * effectiveVerticalExaggeration();
  }

  function horizonYAtLocal(x, z) {
    return terrainYAtLocal(x, z);
  }

  function groundYAtLocal(x, z) {
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
    cameraState.target.set(local.x, terrainYAtLocal(local.x, local.z) + 80, local.z);
  }

  function observerFocusCoords() {
    if (cameraState.observerMode && panoramaObserverFocus) return panoramaObserverFocus;
    return currentFocus;
  }

  function observerCameraLocal() {
    const focus = observerFocusCoords();
    if (!cameraState.observerMode || !focus || !currentPatch) return null;
    const local = localFromLonLatUnbounded(focus.lng, focus.lat);
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
    if (!observer || !focus) {
      els.observerStatus.textContent = 'Observer camera not positioned yet.';
      return;
    }
    els.observerStatus.textContent = `Camera at ${Number(focus.lat).toFixed(6)}, ${Number(focus.lng).toFixed(6)}; terrain ${(observer.groundY / Math.max(verticalExaggeration, 0.0001) + (baseCenterElev || 0)).toFixed(2)}m, camera Y ${observer.y.toFixed(2)}m.`;
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
    if (cameraState.observerMode) return;
    if (!currentFocus) return;
    const b = THREE.MathUtils.degToRad(cameraState.bearing);
    const eastM = (Math.sin(b) * forwardM) + (Math.cos(b) * rightM);
    const northM = (Math.cos(b) * forwardM) - (Math.sin(b) * rightM);
    currentFocus = offsetLonLat(currentFocus.lat, currentFocus.lng, eastM, northM);
    updateFocusTarget();
    updateCamera();
    updateNotesPanel();
    scheduleTerrainReloadIfNeeded(false);
    if (cameraState.observerMode) scheduleViewshedHorizonIfMoved();
  }

  function cameraStepMeters(multiplier = 1) {
    return Math.max(90, Math.min(2200, cameraState.distance * 0.9)) * multiplier;
  }

  function minimumPitchDeg() {
    return cameraState.observerMode ? 0 : 8;
  }

  function clampObserverFov(fov) {
    return Math.max(OBSERVER_FOV_MIN, Math.min(OBSERVER_FOV_MAX, Number(fov) || OBSERVER_FOV_DEFAULT));
  }

  function observerZoomFactor() {
    return OBSERVER_FOV_DEFAULT / clampObserverFov(cameraState.fov);
  }

  function observerZoomReadout() {
    const factor = observerZoomFactor();
    const fov = Math.round(clampObserverFov(cameraState.fov));
    if (factor >= 9.95) return `${fov}° · ${Math.round(factor)}×`;
    if (factor >= 1.95) return `${fov}° · ${factor.toFixed(1)}×`;
    return `${fov}° · ${factor.toFixed(2)}×`;
  }

  function applyObserverFovZoom(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    cameraState.fov = clampObserverFov(cameraState.fov * factor);
  }

  function syncCameraProjection(useObserverFov) {
    camera.fov = useObserverFov ? clampObserverFov(cameraState.fov) : ORBIT_CAMERA_FOV;
    camera.updateProjectionMatrix();
  }

  function applyCameraAction(action, dtSeconds = 1 / 60, holdSeconds = 0) {
    if (cameraState.observerMode && FPV_LOCKED_MOVE_ACTIONS.has(action)) return;
    const dt = Math.max(0.001, Math.min(0.08, Number(dtSeconds) || 1 / 60));
    const accel = Math.min(2.8, 1 + Math.max(0, holdSeconds - 0.35) * 1.6);
    const moveM = cameraStepMeters(dt * accel);
    const rotateDeg = 70 * dt * accel;
    const pitchDeg = 34 * dt * accel;
    const zoomRate = 1.8 * dt * accel;
    let movedFocus = false;

    if (action === 'zoom-in') {
      if (cameraState.observerMode) {
        applyObserverFovZoom(1 / (1 + zoomRate));
      } else {
        cameraState.distance = Math.max(380, cameraState.distance / (1 + zoomRate));
      }
    } else if (action === 'zoom-out') {
      if (cameraState.observerMode) {
        applyObserverFovZoom(1 + zoomRate);
      } else {
        cameraState.distance = Math.min(6500, cameraState.distance * (1 + zoomRate));
      }
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

  function notifyViewshedHorizonReady() {
    const waiters = viewshedHorizonWaiters.splice(0);
    for (const fn of waiters) {
      try { fn(); } catch (e) { console.warn('[viewshed] waiter failed', e); }
    }
  }

  function waitForViewshedHorizonReady(observer, resKey = null, timeoutMs = 900000) {
    if (horizonCacheValidForObserver(observer, resKey)) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const idx = viewshedHorizonWaiters.indexOf(done);
        if (idx >= 0) viewshedHorizonWaiters.splice(idx, 1);
        reject(new Error('Viewshed horizon timed out'));
      }, timeoutMs);
      const done = () => {
        window.clearTimeout(timer);
        resolve(horizonCacheValidForObserver(observer, resKey));
      };
      viewshedHorizonWaiters.push(done);
    });
  }

  function horizonQueryEnvelope() {
    const observer = getHorizonObserverFocus();
    if (!observer) return null;
    const r = VIEWSHED_SCAN_RADIUS_KM * 1000;
    const nw = offsetLonLat(observer.lat, observer.lng, -r, r);
    const se = offsetLonLat(observer.lat, observer.lng, r, -r);
    return { nw, se };
  }

  function relationalMonumentsForHorizonWorker(features) {
    const out = [];
    const selectedSmr = normSmr(selectedSite?.smr || '');
    for (const f of features) {
      const g = f?.geometry;
      const a = f?.attributes || {};
      if (!g || !isFinite(g.y) || !isFinite(g.x)) continue;
      if (!selectedMonumentClasses.has(String(a.MONUMENT_CLASS || '').trim())) continue;
      const thisSmr = normSmr(a.SMRS || '');
      if (selectedSmr && thisSmr && thisSmr === selectedSmr) continue;
      if (selectedSite && isFinite(selectedSite.lat) && isFinite(selectedSite.lng)) {
        if (distanceMeters(selectedSite.lat, selectedSite.lng, g.y, g.x) < 6) continue;
      }
      out.push({ lat: g.y, lng: g.x, props: a });
    }
    return out;
  }

  function bearingDegFromObserver(obsLat, obsLng, lat, lng) {
    const φ1 = THREE.MathUtils.degToRad(obsLat);
    const φ2 = THREE.MathUtils.degToRad(lat);
    const Δλ = THREE.MathUtils.degToRad(lng - obsLng);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((THREE.MathUtils.radToDeg(Math.atan2(y, x)) % 360) + 360) % 360;
  }

  function shortestHorizonAzDiffDeg(a, b) {
    return Math.abs(((Number(a) - Number(b) + 540) % 360) - 180);
  }

  async function matchHorizonMonumentsInWorker(observer, horizonData, monuments, resKey, matchToken, onProgress) {
    const worker = ensureHorizonWorker(false);
    if (!worker) throw new Error('Horizon worker unavailable');
    if (!isFinite(viewshedObserverH)) throw new Error('Viewshed observer height not ready.');
    const token = matchToken ?? horizonLoadToken;
    return new Promise((resolve, reject) => {
      const onMessage = (ev) => {
        if (ev.data?.token !== token) return;
        const msg = ev.data || {};
        if (msg.type === 'PROGRESS') {
          const done = Number(msg.payload?.done) || 0;
          const total = Math.max(1, Number(msg.payload?.total) || 1);
          const message = msg.payload?.message || 'Matching monuments to horizon…';
          const pct = 0.45 + (done / total) * 0.48;
          onProgress?.(message, pct);
          return;
        }
        if (msg.type === 'MATCH_RESULT') {
          worker.removeEventListener('message', onMessage);
          resolve(msg.payload);
        }
        if (msg.type === 'ERROR') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(msg.payload?.message || 'Horizon match failed'));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({
        type: 'MATCH_HORIZON_MONUMENTS',
        token,
        payload: {
          lat: observer.lat,
          lon: observer.lng,
          observerH: viewshedObserverH,
          horizonData,
          monuments,
          floatM: horizonFloatM,
          azClusterDeg: horizonAzClusterDeg,
          resKey: normalizeHorizonResKey(resKey)
        }
      });
    });
  }

  function clearHorizonMemberMarkers(clusterId = null) {
    const keep = [];
    for (const m of horizonMemberMarkers) {
      if (!clusterId || m.clusterId === clusterId) {
        m.el?.remove();
      } else {
        keep.push(m);
      }
    }
    horizonMemberMarkers = keep;
    const keepLabels = [];
    for (const item of labelItems) {
      if (item.kind === 'horizonMember' && (!clusterId || String(item.id).includes(clusterId))) {
        item.el?.remove();
        item.line?.remove();
      } else {
        keepLabels.push(item);
      }
    }
    labelItems = keepLabels;
  }

  function clearHorizonClusterMarkers() {
    for (const m of horizonClusterMarkers) m.el?.remove();
    horizonClusterMarkers = [];
    horizonClusters = [];
    horizonExpandedClusters = new Set();
    clearHorizonMemberMarkers();
    clearLabelsByKind('horizon');
    clearLabelsByKind('horizonMember');
  }

  function clearHorizonRelationalMarkers() {
    clearHorizonClusterMarkers();
  }

  function findHorizonCluster(clusterId) {
    return horizonClusters.find((c) => c.id === clusterId) || null;
  }

  function horizonClusterLabelId(clusterId) {
    return `hz-label-${clusterId}`;
  }

  function horizonMemberMarkerId(clusterId, props, lng, lat) {
    return `hz-mem-${clusterId}-${monumentStableKey(props, lng, lat)}`;
  }

  function horizonClusterTitle(cluster) {
    const members = Array.isArray(cluster?.members) ? cluster.members : [];
    if (members.length === 1) {
      return markerLabelText(members[0]?.props || {});
    }
    const n = Number(cluster?.count) || members.length;
    return `${n} sites on horizon`;
  }

  function horizonClusterDetail(cluster) {
    const members = Array.isArray(cluster?.members) ? cluster.members : [];
    if (members.length <= 1) {
      return markerLabelDetail(members[0]?.props || {});
    }
    return '';
  }

  function setHorizonClusterLabelExpanded(clusterId, expanded) {
    const labelId = horizonClusterLabelId(clusterId);
    const item = labelItems.find((x) => x.id === labelId);
    if (!item?.el) return;
    const btn = item.el.querySelector('.label-expand-btn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    btn.title = expanded ? 'Collapse All' : 'Expand All';
    btn.setAttribute('aria-label', expanded ? 'Collapse All' : 'Expand All');
  }

  function expandHorizonCluster(clusterId) {
    const cluster = findHorizonCluster(clusterId);
    if (!cluster) return;
    horizonExpandedClusters.add(clusterId);
    const members = Array.isArray(cluster.members) ? cluster.members : [];
    for (const mem of members) {
      const lat = Number(mem?.lat);
      const lng = Number(mem?.lng);
      const props = mem?.props || {};
      if (!isFinite(lat) || !isFinite(lng)) continue;
      const local = localFromLonLatUnbounded(lng, lat);
      if (!local) continue;
      const markerId = horizonMemberMarkerId(clusterId, props, lng, lat);
      if (horizonMemberMarkers.some((m) => m.id === markerId)) continue;
      const azimuth = Number(mem?.azimuth);
      const altitude = Number(mem?.altitude);
      const distM = Number(mem?.distM);
      if (!isFinite(azimuth) || !isFinite(altitude)) continue;

      const mClass = props.MONUMENT_CLASS || '';
      const el = document.createElement('div');
      el.className = 'rel-marker rel-marker--horizon-member';
      el.title = String(mClass || 'Monument');
      el.innerHTML = '<span class="megicon"></span>';
      renderMegIconInto(el.querySelector('.megicon'), mClass, TOUR_MARKER_ICON_SIZE);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!showHorizonRelational) return;
        const labelId = `hz-mem-label-${markerId}`;
        if (hasLabel(labelId)) {
          removeFlatLabel(labelId);
          return;
        }
        addHorizonSiteLabel({
          id: labelId,
          kind: 'horizonMember',
          lat,
          lng,
          props,
          azimuth,
          altitude,
          distM,
          text: markerLabelText(props),
          detail: markerLabelDetail(props)
        });
      });
      els.markerLayer?.appendChild(el);
      horizonMemberMarkers.push({
        id: markerId, clusterId, el, local, lat, lng, props, azimuth, altitude, distM
      });
    }
    setHorizonClusterLabelExpanded(clusterId, true);
  }

  function collapseHorizonCluster(clusterId) {
    horizonExpandedClusters.delete(clusterId);
    clearHorizonMemberMarkers(clusterId);
    setHorizonClusterLabelExpanded(clusterId, false);
  }

  function toggleHorizonClusterExpanded(clusterId) {
    if (horizonExpandedClusters.has(clusterId)) collapseHorizonCluster(clusterId);
    else expandHorizonCluster(clusterId);
  }

  function addHorizonSiteLabel({ id, kind, lat, lng, props, azimuth, altitude, distM, text, detail, clusterId = null }) {
    if (hasLabel(id)) return;
    const local = localFromLonLatUnbounded(lng, lat);
    const el = document.createElement('div');
    el.className = 'site-label nms';
    const az = Number(azimuth);
    const alt = Number(altitude);
    const meta = (isFinite(az) && isFinite(alt))
      ? `Az ${az.toFixed(1)}° · Alt ${alt.toFixed(2)}°`
      : '';
    el.innerHTML = `<span class="label-title">${escapeHtml(text || 'SMR')}</span>`
      + `<span class="detail">${escapeHtml(detail || meta)}</span>`;
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
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
      notesActionItem = { id, lat, lng, props, text, detail, el };
      updateNotesPanel();
      updateNotesActions();
    });
    els.labelLayer.appendChild(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    els.labelLines.appendChild(line);
    labelItems.push({
      id,
      kind,
      local,
      lat,
      lng,
      props,
      el,
      line,
      visible: true,
      horizonAzimuth: azimuth,
      horizonAltitude: altitude,
      horizonDistM: distM,
      clusterId
    });
  }

  function addHorizonClusterLabel(cluster, local) {
    const clusterId = cluster.id;
    const labelId = horizonClusterLabelId(clusterId);
    if (hasLabel(labelId)) return;
    const members = Array.isArray(cluster.members) ? cluster.members : [];
    const isMultiCluster = members.length > 1;
    const title = horizonClusterTitle(cluster);
    const detail = horizonClusterDetail(cluster);
    const el = document.createElement('div');
    el.className = 'site-label nms site-label--horizon-cluster';
    if (isMultiCluster) {
      el.innerHTML = `<div class="horizon-cluster-label-head">`
        + '<button type="button" class="label-expand-btn" aria-pressed="false" aria-label="Expand All" title="Expand All"><i class="ph-bold ph-arrows-out" aria-hidden="true"></i></button>'
        + `</div>`
        + `<span class="label-title">${escapeHtml(title)}</span>`;
    } else {
      el.innerHTML = `<span class="label-title">${escapeHtml(title)}</span>`
        + (detail ? `<span class="detail">${escapeHtml(detail)}</span>` : '');
    }
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.label-expand-btn')) return;
      ev.stopPropagation();
      if (activeLabelId === labelId) {
        activeLabelId = null;
        setActiveLabelById(null);
        if (previewNotesSite?.id === labelId) previewNotesSite = null;
        if (notesActionItem?.id === labelId) notesActionItem = null;
        updateNotesPanel();
        updateNotesActions();
        return;
      }
      setActiveLabelById(labelId);
      const anchor = members[0] || cluster;
      previewNotesSite = {
        id: labelId,
        lat: Number(anchor.lat),
        lng: Number(anchor.lng),
        props: anchor.props || {}
      };
      notesActionItem = {
        id: labelId,
        local,
        lat: Number(anchor.lat),
        lng: Number(anchor.lng),
        props: anchor.props || {},
        text: horizonClusterTitle(cluster),
        detail: horizonClusterDetail(cluster),
        el
      };
      updateNotesPanel();
      updateNotesActions();
    });
    const expandBtn = el.querySelector('.label-expand-btn');
    expandBtn?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleHorizonClusterExpanded(clusterId);
    });
    els.labelLayer.appendChild(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    els.labelLines.appendChild(line);
    labelItems.push({
      id: labelId,
      kind: 'horizon',
      local,
      lat: Number(cluster.lat),
      lng: Number(cluster.lng),
      props: members[0]?.props || {},
      el,
      line,
      visible: true,
      clusterId,
      horizonAzimuth: Number(cluster.azimuth ?? cluster.bearing),
      horizonAltitude: Number(cluster.altitude),
      horizonDistM: Number(cluster.distM)
    });
    if (horizonExpandedClusters.has(clusterId)) setHorizonClusterLabelExpanded(clusterId, true);
  }

  function renderHorizonClusterMarkers(clusters) {
    clearHorizonClusterMarkers();
    horizonClusters = Array.isArray(clusters) ? clusters : [];
    for (const cluster of horizonClusters) {
      const members = Array.isArray(cluster.members) ? cluster.members : [];
      const count = Number(cluster.count) || members.length;
      const isCluster = count > 1;
      const anchor = isCluster ? cluster : (members[0] || cluster);
      const lat = Number(anchor?.lat);
      const lng = Number(anchor?.lng);
      const azimuth = Number(anchor?.azimuth ?? anchor?.bearing);
      const altitude = Number(anchor?.altitude);
      const distM = Number(anchor?.distM);
      if (!isFinite(azimuth) || !isFinite(altitude)) continue;
      const local = localFromLonLatUnbounded(lng, lat);
      if (!local) continue;
      const clusterId = cluster.id;
      const repClass = members[0]?.props?.MONUMENT_CLASS || '';

      const el = document.createElement('div');
      el.className = isCluster ? 'rel-marker rel-marker--horizon' : 'rel-marker rel-marker--horizon rel-marker--horizon-single';
      el.title = horizonClusterTitle(cluster);
      el.innerHTML = `<span class="megicon"></span>${isCluster ? `<span class="horizon-count">${count}</span>` : ''}`;
      renderMegIconInto(el.querySelector('.megicon'), repClass, TOUR_MARKER_ICON_SIZE);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!showHorizonRelational) return;
        const labelId = horizonClusterLabelId(clusterId);
        if (hasLabel(labelId)) {
          removeFlatLabel(labelId);
          if (horizonExpandedClusters.has(clusterId)) collapseHorizonCluster(clusterId);
          return;
        }
        addHorizonClusterLabel(cluster, local);
      });
      els.markerLayer?.appendChild(el);
      horizonClusterMarkers.push({
        id: clusterId, el, local, lat, lng, cluster, isCluster, azimuth, altitude, distM
      });
    }
    updateRelationalMarkers();
  }

  async function loadHorizonRelationalMarkers() {
    const token = ++horizonLoadToken;
    clearHorizonRelationalMarkers();
    if (!currentPatch || !showHorizonRelational || !cameraState.observerMode) return;

    const observer = getHorizonObserverFocus();
    if (!observer) return;

    horizonRelationalLoading = true;
    let ownedProgressUi = false;
    const progress = (message, pct = null) => {
      if (!showHorizonRelational || token !== horizonLoadToken) return;
      if (!ownedProgressUi) {
        syncFpvCenterControls();
        ownedProgressUi = true;
      }
      showHorizonCalcPanel(true);
      setHorizonCalcProgress(message, pct);
    };
    const finishProgress = (message, pct = 1, delayMs = 800) => {
      if (!ownedProgressUi) {
        horizonRelationalLoading = false;
        return;
      }
      if (message) progress(message, pct);
      window.setTimeout(() => {
        if (token !== horizonLoadToken) return;
        ownedProgressUi = false;
        horizonRelationalLoading = false;
        hideHorizonCalcPanelUnlessViewshed();
      }, delayMs);
    };
    const abortProgress = () => {
      ownedProgressUi = false;
      horizonRelationalLoading = false;
      hideHorizonCalcPanelUnlessViewshed();
    };

    const resKey = normalizeHorizonResKey(horizonResKey);
    try {
      progress('Horizon relational monuments…', 0.05);
      try {
        if (!horizonCacheValidForObserver(observer, resKey)) {
          progress('Waiting for viewshed horizon…', 0.12);
          scheduleViewshedHorizonBackground(resKey, false);
          await waitForViewshedHorizonReady(observer, resKey);
        }
      } catch (e) {
        els.nmsStatus.textContent = `Horizon viewshed: ${e.message || e}`;
        abortProgress();
        return;
      }
      if (!showHorizonRelational || token !== horizonLoadToken) {
        abortProgress();
        return;
      }
      if (!viewshedHorizonData?.length) {
        els.nmsStatus.textContent = 'Horizon profile not ready — wait for viewshed in panorama.';
        abortProgress();
        return;
      }

      const env = horizonQueryEnvelope();
      if (!env) {
        abortProgress();
        return;
      }

      if (!selectedMonumentClasses.size) {
        els.nmsStatus.textContent = 'Horizon relational: enable at least one monument class in Configuration.';
        abortProgress();
        return;
      }

      progress(`Fetching relational monuments (${VIEWSHED_SCAN_RADIUS_KM} km)…`, null);
      let features = [];
      let sourceCounts = { roi: 0, ni: 0 };
      let fetchWarnings = [];
      try {
        const fetchResult = await fetchRelationalMonumentsInEnvelope(env);
        features = fetchResult.features || [];
        sourceCounts = fetchResult.sourceCounts || sourceCounts;
        fetchWarnings = fetchResult.warnings || [];
        if (fetchWarnings.length) {
          console.warn('[horizon-relational] partial fetch', fetchWarnings, sourceCounts);
        }
      } catch (e) {
        els.nmsStatus.textContent = `Horizon monuments request failed: ${e.message || e}`;
        abortProgress();
        return;
      }
      if (!showHorizonRelational || token !== horizonLoadToken) {
        abortProgress();
        return;
      }

      const monuments = relationalMonumentsForHorizonWorker(features);
      if (!monuments.length) {
        els.nmsStatus.textContent = `Horizon relational: 0 monuments in ${VIEWSHED_SCAN_RADIUS_KM} km (check monument class selection).`;
        finishProgress('Horizon relational: no monuments in range', 1, 600);
        return;
      }

      progress(`Matching ${monuments.length} sites to viewshed alt/az…`, 0.42);
      let matchPayload = null;
      try {
        matchPayload = await matchHorizonMonumentsInWorker(
          observer,
          viewshedHorizonData,
          monuments,
          resKey,
          token,
          (message, pct) => progress(message, pct)
        );
      } catch (e) {
        els.nmsStatus.textContent = `Horizon match failed: ${e.message || e}`;
        abortProgress();
        return;
      }
      if (!showHorizonRelational || token !== horizonLoadToken) {
        abortProgress();
        return;
      }

      progress('Placing horizon markers…', 0.96);
      const clusters = matchPayload?.clusters || [];
      const matchCount = Number(matchPayload?.matchCount) || 0;
      console.info('[horizon-relational]', {
        fetched: features.length,
        roi: sourceCounts.roi,
        ni: sourceCounts.ni,
        relational: monuments.length,
        onSkyline: matchCount,
        markers: clusters.length,
        fetchWarnings: fetchWarnings.length ? fetchWarnings : undefined
      });

      renderHorizonClusterMarkers(clusters);
      const singles = clusters.filter((c) => (c.count || c.members?.length || 0) <= 1).length;
      const multi = clusters.length - singles;
      if (!clusters.length) {
        const obs = getHorizonObserverFocus();
        const obsTxt = obs ? `${obs.lat.toFixed(5)}, ${obs.lng.toFixed(5)}` : 'unknown';
        els.nmsStatus.textContent = `Horizon relational: 0 within float at ${obsTxt} (${monuments.length} relational in ${VIEWSHED_SCAN_RADIUS_KM} km). Wait for viewshed, then try a larger float (m).`;
        console.warn('[horizon-relational] no matches', { observer: obs, monuments: monuments.length, viewshedPoints: viewshedHorizonData?.length });
        finishProgress('Horizon relational: no sites within float', 1);
      } else {
        const warnTxt = fetchWarnings.length ? ` (${fetchWarnings.join('; ')})` : '';
        els.nmsStatus.textContent = `Horizon relational: ${matchCount} site${matchCount === 1 ? '' : 's'} on skyline — ${singles} individual marker${singles === 1 ? '' : 's'}${multi ? `, ${multi} cluster${multi === 1 ? '' : 's'}` : ''} — fetched ROI ${sourceCounts.roi}, NI ${sourceCounts.ni}${warnTxt}.`;
        finishProgress(
          `Horizon relational ready — ${matchCount} site${matchCount === 1 ? '' : 's'}, ${clusters.length} marker${clusters.length === 1 ? '' : 's'}`,
          1
        );
      }
      updateLegendPanel();
    } catch (e) {
      console.warn('[horizon-relational] load failed', e);
      abortProgress();
    }
  }

  function getHorizonObserverFocus() {
    if (cameraState.observerMode && panoramaObserverFocus) {
      return { lat: Number(panoramaObserverFocus.lat), lng: Number(panoramaObserverFocus.lng) };
    }
    if (currentFocus && isFinite(currentFocus.lat) && isFinite(currentFocus.lng)) {
      return { lat: Number(currentFocus.lat), lng: Number(currentFocus.lng) };
    }
    if (selectedSite && isFinite(selectedSite.lat) && isFinite(selectedSite.lng)) {
      return { lat: Number(selectedSite.lat), lng: Number(selectedSite.lng) };
    }
    return null;
  }

  function horizonObserverMatches(a, b, eps = 0.00004) {
    if (!a || !b) return false;
    return Math.abs(Number(a.lat) - Number(b.lat)) <= eps
      && Math.abs(Number(a.lng) - Number(b.lng)) <= eps;
  }

  function setHorizonCalcProgress(message, pct = null) {
    const msg = String(message || '');
    if (els.horizonCalcText) els.horizonCalcText.textContent = msg;
    const indeterminate = !!msg && pct == null;
    if (els.horizonCalcProgress) {
      els.horizonCalcProgress.dataset.mode = indeterminate ? 'indeterminate' : 'determinate';
    }
    if (!indeterminate) {
      const p = pct == null ? null : Math.max(0, Math.min(1, Number(pct) || 0));
      if (p != null && els.horizonCalcProgressFill) {
        els.horizonCalcProgressFill.style.transform = `scaleX(${p})`;
      }
      if (p != null && els.horizonCalcProgress) {
        els.horizonCalcProgress.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      }
    }
  }

  function hideHorizonCalcPanelUnlessViewshed() {
    if (!viewshedHorizonComputing) showHorizonCalcPanel(false);
  }

  function maxHorizonBlockDistM(horizonData, observer) {
    let maxD = 0;
    for (const p of horizonData || []) {
      const d = horizonFeatureDistanceM(observer, p?.horizonLat, p?.horizonLon);
      if (isFinite(d) && d > maxD) maxD = d;
    }
    return maxD;
  }

  function viewshedProgressLabel(resKey, scanRadiusKm = VIEWSHED_SCAN_RADIUS_KM) {
    const key = normalizeHorizonResKey(resKey);
    const steps = key === 'quick' ? 360 : 3600;
    const zoom = key === 'super' ? 12 : 11;
    return `${scanRadiusKm} km scan · Z${zoom} · ${steps} bearings`;
  }

  function horizonCacheValidForObserver(observer, resKey = null) {
    if (!viewshedHorizonData?.length || !viewshedHorizonObserver || !observer) return false;
    if (!horizonObserverMatches(viewshedHorizonObserver, observer)) return false;
    if (Number(viewshedHorizonScanRadiusKm) !== VIEWSHED_SCAN_RADIUS_KM) return false;
    if (viewshedHorizonSettingsVersion !== VIEWSHED_SETTINGS_VERSION) return false;
    if (resKey && viewshedHorizonComputedResKey && viewshedHorizonComputedResKey !== resKey) return false;
    return true;
  }

  function syncHorizonResUiFromCache() {
    const key = normalizeHorizonResKey(viewshedHorizonComputedResKey || horizonResKey);
    horizonResKey = key;
    if (els.horizonResKey) els.horizonResKey.value = key;
    setHorizonDrawButtonsActive(key === 'hires' || key === 'super' ? key : null);
  }

  function restoreViewshedHorizonIfCached(observer, resKey = null) {
    if (!horizonCacheValidForObserver(observer, resKey)) return false;
    syncHorizonResUiFromCache();
    showHorizonCalcPanel(false);
    syncViewshedHorizonVisibility();
    updateSkyDomeViewshedMask();
    notifyViewshedHorizonReady();
    updateTerrainHorizonMaskUniforms(terrainMesh?.material, null);
    astronomyOverlay?.updateOverlay();
    return true;
  }

  function showHorizonCalcPanel(show) {
    els.horizonCalcPanel?.classList.toggle('hidden', !show);
    if (!show) setHorizonCalcProgress('', 0);
  }

  function setHorizonDrawButtonsActive(resKey) {
    els.fpvHorizonHires?.classList.toggle('active', resKey === 'hires');
    els.fpvHorizonSuper?.classList.toggle('active', resKey === 'super');
  }

  function syncFpvCenterControls() {
    const fpv = !!cameraState.observerMode;
    els.fpvHorizonStatusWrap?.classList.toggle('hidden', !fpv);
    els.fpvHorizonStatusWrap?.setAttribute('aria-hidden', fpv ? 'false' : 'true');
    if (!fpv) {
      showHorizonCalcPanel(false);
      setHorizonDrawButtonsActive(null);
    }
  }

  function runHorizonDrawAtRes(resKey) {
    if (!cameraState.observerMode || !currentPatch) return;
    const key = normalizeHorizonResKey(resKey);
    horizonResKey = key;
    if (els.horizonResKey) els.horizonResKey.value = key;
    setHorizonDrawButtonsActive(key === 'hires' || key === 'super' ? key : null);
    scheduleViewshedHorizonBackground(key, true);
  }

  function viewshedDrawRadiusM() {
    return VIEWSHED_DRAW_RADIUS_M;
  }

  // 300526 backup — eye-sync fallback radius for near-field composite only (not draw ring).
  function viewshedDisplayRadiusM() {
    if (!currentPatch) return 12000;
    const outerHalf = horizonPatchMeters > 0 ? horizonPatchMeters * 0.5 : 0;
    const patchHalf = centrePatchHalfM();
    return Math.min(48000, Math.max(9000, outerHalf * 0.94, patchHalf * 0.96));
  }

  function horizonDrawProfileData() {
    return horizonDrawProfile?.length ? horizonDrawProfile : viewshedHorizonData;
  }

  // Viewshed azimuth uses compass bearing (0°=north, 90°=east), same as camera bearing:
  //   x += sin(bearing), z -= cos(bearing)
  function horizonSampleAtAzimuth(horizonData, azimuthDeg) {
    let best = null;
    let bestDiff = Infinity;
    for (const p of horizonData) {
      const az = Number(p?.azimuth);
      if (!isFinite(az)) continue;
      const diff = Math.abs(((az - azimuthDeg + 540) % 360) - 180);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
    return best;
  }

  function horizonFeatureDistanceM(observer, horizonLat, horizonLon) {
    const lat1 = Number(observer?.lat);
    const lon1 = Number(observer?.lng);
    const lat2 = Number(horizonLat);
    const lon2 = Number(horizonLon);
    if (!isFinite(lat1) || !isFinite(lon1) || !isFinite(lat2) || !isFinite(lon2)) return null;
    const φ1 = THREE.MathUtils.degToRad(lat1);
    const φ2 = THREE.MathUtils.degToRad(lat2);
    const Δλ = THREE.MathUtils.degToRad(lon2 - lon1);
    const a = Math.sin((φ2 - φ1) * 0.5) ** 2
      + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ * 0.5) ** 2;
    return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function viewshedAltitudeForSceneEye(altitudeDeg, observer, horizonLat, horizonLon, radiusM, sceneEyeAmal, workerEyeAmal) {
    let alt = Number(altitudeDeg);
    if (!isFinite(alt)) return 0;
    const groundDelta = sceneEyeAmal - workerEyeAmal;
    if (Math.abs(groundDelta) < 0.05) return alt;
    const distM = horizonFeatureDistanceM(observer, horizonLat, horizonLon) || radiusM;
    alt += THREE.MathUtils.radToDeg(Math.atan(groundDelta / Math.max(50, distM)));
    return Math.max(-90, Math.min(90, alt));
  }

  function viewshedObserverEyeY(observerLocal) {
    const observer = observerCameraLocal();
    if (observer) return observer.y;
    if (observerLocal) return groundYAtLocal(observerLocal.x, observerLocal.z) + OBSERVER_HEIGHT_OFFSET_M;
    return OBSERVER_HEIGHT_OFFSET_M;
  }

  function viewshedRingPointForAzimuth(horizonData, observerLocal, obsY, radiusM, azimuthDeg) {
    const sample = horizonSampleAtAzimuth(horizonData, azimuthDeg);
    if (!sample || !observerLocal) return null;
    const alt = Number(sample.altitude);
    if (!isFinite(alt)) return null;
    const bearingRad = THREE.MathUtils.degToRad(azimuthDeg);
    return {
      x: observerLocal.x + Math.sin(bearingRad) * radiusM,
      y: obsY + Math.tan(THREE.MathUtils.degToRad(alt)) * radiusM,
      z: observerLocal.z - Math.cos(bearingRad) * radiusM,
      alt,
      azimuth: Number(sample.azimuth)
    };
  }

  function terrainMeshSampleValidAtLocal(x, z) {
    if (!currentPatch) return false;
    const extent = terrainMeshExtentHalfM();
    if (Math.abs(x) > extent + 20 || Math.abs(z) > extent + 20) return false;
    return outerAerialUvInsideAtLocal(x, z, 0.008);
  }

  function meshHorizonStepM(distM) {
    if (distM < 2500) return 25;
    if (distM < 8000) return 80;
    return 220;
  }

  function meshHorizonAltDegAtAzimuth(azimuthDeg, observerLocal, obsY) {
    if (!observerLocal || !currentPatch) return -90;
    const bearingRad = THREE.MathUtils.degToRad(azimuthDeg);
    const sinB = Math.sin(bearingRad);
    const cosB = Math.cos(bearingRad);
    const ox = observerLocal.x;
    const oz = observerLocal.z;
    const maxDist = terrainMeshExtentHalfM() * 1.02;
    let maxAlt = -90;
    for (let d = 20; d <= maxDist; d += meshHorizonStepM(d)) {
      const x = ox + sinB * d;
      const z = oz - cosB * d;
      if (!terrainMeshSampleValidAtLocal(x, z)) break;
      const ty = terrainYAtLocal(x, z);
      if (!Number.isFinite(ty)) continue;
      const alt = THREE.MathUtils.radToDeg(Math.atan2(ty - obsY, Math.max(d, 1)));
      if (alt > maxAlt) maxAlt = alt;
    }
    return Math.max(-90, Math.min(90, maxAlt));
  }

  function sceneObserverEyeAmal(observerLocal) {
    const observer = observerCameraLocal();
    const ve = Math.max(0.0001, effectiveVerticalExaggeration());
    if (observer?.inside) {
      return observer.groundY / ve + Number(baseCenterElev || 0) + OBSERVER_HEIGHT_OFFSET_M;
    }
    if (observerLocal) {
      return groundYAtLocal(observerLocal.x, observerLocal.z) / ve + Number(baseCenterElev || 0) + OBSERVER_HEIGHT_OFFSET_M;
    }
    return Number(viewshedObserverH || 0);
  }

  function buildHorizonDrawProfile(viewshedData, observer, observerH = viewshedObserverH) {
    if (!viewshedData?.length || !observer) return null;
    const observerLocal = localFromLonLatUnbounded(observer.lng, observer.lat);
    if (!observerLocal) return null;
    const obsY = viewshedObserverEyeY(observerLocal);
    const sceneEyeAmal = sceneObserverEyeAmal(observerLocal);
    const workerEyeAmal = Number.isFinite(observerH) ? Number(observerH) : sceneEyeAmal;
    const nearEyeSyncRadiusM = viewshedDisplayRadiusM();
    const farCutoffM = terrainMeshExtentHalfM() + 500;
    const profile = [];
    for (const p of viewshedData) {
      const az = Number(p?.azimuth);
      if (!Number.isFinite(az)) continue;
      const viewshedAlt = viewshedAltitudeForSceneEye(
        p?.altitude,
        observer,
        p?.horizonLat,
        p?.horizonLon,
        nearEyeSyncRadiusM,
        sceneEyeAmal,
        workerEyeAmal
      );
      const blockDistM = horizonFeatureDistanceM(observer, p?.horizonLat, p?.horizonLon);
      const rawViewshedAlt = Number(p?.altitude);
      let altitude;
      // Viewshed horizon is the horizon. Use eye-synced viewshed where possible; fall back to raw.
      // This ensures terrain is clipped to the same skyline and can never exceed it.
      if (isFinite(blockDistM) && blockDistM > farCutoffM) {
        altitude = Number.isFinite(rawViewshedAlt) ? rawViewshedAlt : viewshedAlt;
      } else {
        altitude = Number.isFinite(viewshedAlt) ? viewshedAlt : rawViewshedAlt;
      }
      if (!Number.isFinite(altitude)) continue;
      profile.push({ azimuth: az, altitude });
    }
    profile.sort((a, b) => a.azimuth - b.azimuth);
    return profile.length ? profile : null;
  }

  // Draw az/alt on a fixed-radius ring at the observer eye — angular only.
  function buildHorizonRingFromProfile(horizonData, observer) {
    const observerLocal = localFromLonLatUnbounded(observer.lng, observer.lat);
    if (!observerLocal || !Array.isArray(horizonData) || !horizonData.length) {
      return { observerLocal, ring: [], obsY: 0, radiusM: 0 };
    }
    const radiusM = viewshedDrawRadiusM();
    const obsY = viewshedObserverEyeY(observerLocal);
    const ring = [];
    for (const p of horizonData) {
      const az = Number(p?.azimuth);
      const alt = Number(p?.altitude);
      if (!Number.isFinite(az) || !Number.isFinite(alt)) continue;
      const bearingRad = THREE.MathUtils.degToRad(az);
      ring.push({
        x: observerLocal.x + Math.sin(bearingRad) * radiusM,
        y: obsY + Math.tan(THREE.MathUtils.degToRad(alt)) * radiusM,
        z: observerLocal.z - Math.cos(bearingRad) * radiusM
      });
    }
    return { observerLocal, ring, obsY, radiusM };
  }

  function clearHorizonLineMesh() {
    if (!horizonLineMesh) return;
    scene.remove(horizonLineMesh);
    horizonLineMesh.geometry?.dispose?.();
    horizonLineMesh.material?.dispose?.();
    horizonLineMesh = null;
  }

  function clearHorizonFillMesh() {
    if (!horizonFillMesh) return;
    scene.remove(horizonFillMesh);
    horizonFillMesh.geometry?.dispose?.();
    horizonFillMesh.material?.dispose?.();
    horizonFillMesh = null;
  }

  function clearViewshedHorizonVisuals() {
    clearHorizonLineMesh();
    clearHorizonFillMesh();
  }

  function purgeViewshedVisualsUnlessPanorama() {
    if (cameraState.observerMode) return;
    if (horizonLineMesh || horizonFillMesh) {
      clearViewshedHorizonVisuals();
    }
  }

  function cancelViewshedHorizonCompute() {
    viewshedHorizonToken++;
    viewshedHorizonComputing = false;
    showHorizonCalcPanel(false);
    setHorizonCalcProgress('', 0);
  }

  function clearViewshedHorizon() {
    cancelViewshedHorizonCompute();
    viewshedHorizonData = null;
    horizonDrawProfile = null;
    viewshedHorizonObserver = null;
    viewshedObserverH = null;
    viewshedHorizonComputedResKey = null;
    viewshedHorizonScanRadiusKm = null;
    viewshedHorizonSettingsVersion = null;
    clearViewshedHorizonVisuals();
    updateSkyDomeViewshedMask();
  }

  // ---------------------------------------------------------------------------
  // VIEWSHED HORIZON VISUALS (Phase 2 scope — not modified in Phase 0/1)
  // Panorama mode: horizon line + fill polygon. Astronomy paths attach here in Phase 3.
  // ---------------------------------------------------------------------------

  const HORIZON_LINE_COLOR = 0x505050;
  const HORIZON_FILL_TOP_COLOR = new THREE.Color(0xd1d5db);
  const HORIZON_FILL_FLOOR_COLOR = new THREE.Color(0x7a8064);
  const HORIZON_FILL_ALT_BLEND_DEG = 0.2 / 3;

  function horizonFillVertexColor(altDeg, horizonAltDeg, out) {
    const t = Math.max(0, Math.min(1, (horizonAltDeg - altDeg) / HORIZON_FILL_ALT_BLEND_DEG));
    out.copy(HORIZON_FILL_TOP_COLOR).lerp(HORIZON_FILL_FLOOR_COLOR, t);
  }

  function buildHorizonFillMesh(ring, observerLocal, includeInnerCap = false) {
    clearHorizonFillMesh();
    if (!ring || ring.length < 3 || !observerLocal) return;

    const obsY = viewshedObserverEyeY(observerLocal);
    const horizonAltByIdx = ring.map((top) => {
      const dx = top.x - observerLocal.x;
      const dz = top.z - observerLocal.z;
      const d = Math.max(1, Math.hypot(dx, dz));
      return THREE.MathUtils.radToDeg(Math.atan2(top.y - obsY, d));
    });
    const vertexColor = new THREE.Color();

    const groundPts = ring.map((top) => {
      const gy = groundYAtLocal(top.x, top.z);
      return { x: top.x, y: Math.min(gy, top.y - 0.05), z: top.z };
    });

    const positions = [];
    const colors = [];
    const indices = [];
    const n = ring.length;

    function pushVertex(x, y, z, horizonAltDeg) {
      positions.push(x, y, z);
      const dx = x - observerLocal.x;
      const dz = z - observerLocal.z;
      const d = Math.max(1, Math.hypot(dx, dz));
      const altDeg = THREE.MathUtils.radToDeg(Math.atan2(y - obsY, d));
      horizonFillVertexColor(altDeg, horizonAltDeg, vertexColor);
      colors.push(vertexColor.r, vertexColor.g, vertexColor.b);
    }

    // Distant curtain: viewshed horizon ring down to ground at each bearing.
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const topA = ring[i];
      const topB = ring[i2];
      const botA = groundPts[i];
      const botB = groundPts[i2];
      const base = positions.length / 3;
      pushVertex(topA.x, topA.y, topA.z, horizonAltByIdx[i]);
      pushVertex(topB.x, topB.y, topB.z, horizonAltByIdx[i2]);
      pushVertex(botB.x, botB.y, botB.z, horizonAltByIdx[i2]);
      pushVertex(botA.x, botA.y, botA.z, horizonAltByIdx[i]);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    // Inner cap only when terrain mesh is hidden (legacy fallback).
    if (includeInnerCap) {
      const obsGroundY = groundYAtLocal(observerLocal.x, observerLocal.z);
      const centerIdx = positions.length / 3;
      const centerHorizonAlt = horizonAltByIdx.reduce((a, b) => a + b, 0) / Math.max(1, horizonAltByIdx.length);
      pushVertex(observerLocal.x, obsGroundY, observerLocal.z, centerHorizonAlt);
      for (let i = 0; i < n; i++) {
        const g = groundPts[i];
        pushVertex(g.x, g.y, g.z, horizonAltByIdx[i]);
      }
      for (let i = 0; i < n; i++) {
        const i2 = (i + 1) % n;
        indices.push(centerIdx, centerIdx + 1 + i, centerIdx + 1 + i2);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      fog: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide
    });

    horizonFillMesh = new THREE.Mesh(geom, mat);
    horizonFillMesh.userData.viewshedHorizon = true;
    horizonFillMesh.renderOrder = 12;
    horizonFillMesh.frustumCulled = false;
    scene.add(horizonFillMesh);
  }

  function buildHorizonLineMesh(ring) {
    clearHorizonLineMesh();
    if (!ring || ring.length < 3) return;
    const positions = [];
    for (const p of ring) positions.push(p.x, p.y + 1.5, p.z);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: HORIZON_LINE_COLOR,
      transparent: false,
      opacity: 1,
      depthTest: false,
      depthWrite: false
    });
    horizonLineMesh = new THREE.LineLoop(geom, mat);
    horizonLineMesh.userData.viewshedHorizon = true;
    horizonLineMesh.renderOrder = 13;
    horizonLineMesh.frustumCulled = false;
    scene.add(horizonLineMesh);
  }

  function applyViewshedHorizonVisuals(horizonData, observer, observerH = null) {
    if (!currentPatch || !Array.isArray(horizonData) || !horizonData.length || !observer) return;
    viewshedHorizonData = horizonData;
    viewshedHorizonObserver = { lat: Number(observer.lat), lng: Number(observer.lng) };
    if (isFinite(observerH)) viewshedObserverH = Number(observerH);
    horizonDrawProfile = buildHorizonDrawProfile(horizonData, viewshedHorizonObserver, viewshedObserverH);
    if (!cameraState.observerMode) {
      clearViewshedHorizonVisuals();
      return;
    }
    const { observerLocal, ring } = buildHorizonRingFromProfile(horizonDrawProfileData(), viewshedHorizonObserver);
    if (!observerLocal || ring.length < 3) return;
    buildHorizonFillMesh(ring, observerLocal);
    buildHorizonLineMesh(ring);
    updateSkyDomeViewshedMask();
    updateTerrainHorizonMaskUniforms(terrainMesh?.material, null);
    astronomyOverlay?.updateOverlay();
  }

  function rebuildViewshedHorizonVisuals() {
    syncViewshedHorizonVisibility();
  }

  function syncViewshedHorizonVisibility() {
    if (!cameraState.observerMode) {
      clearViewshedHorizonVisuals();
      return;
    }
    if (!viewshedHorizonData || !viewshedHorizonObserver) return;
    applyViewshedHorizonVisuals(viewshedHorizonData, viewshedHorizonObserver, viewshedObserverH);
  }

  function scheduleViewshedHorizonIfMoved(debounceMs = 450) {
    clearTimeout(viewshedRescheduleTimer);
    viewshedRescheduleTimer = setTimeout(() => {
      if (!cameraState.observerMode || !currentPatch) return;
      const observer = getHorizonObserverFocus();
      if (!observer) return;
      if (viewshedHorizonData && horizonObserverMatches(viewshedHorizonObserver, observer)) {
        rebuildViewshedHorizonVisuals();
        return;
      }
      scheduleViewshedHorizonBackground(null, false);
    }, debounceMs);
  }

  function ensureHorizonWorker(forceNew = false) {
    if (forceNew && horizonWorker) {
      horizonWorker.terminate();
      horizonWorker = null;
    }
    if (horizonWorker) return horizonWorker;
    try {
      horizonWorker = new Worker(HORIZON_WORKER_URL);
    } catch (e) {
      console.warn('[viewshed] worker unavailable', e);
      horizonWorker = null;
    }
    return horizonWorker;
  }

  function scheduleViewshedHorizonBackground(resKeyOverride = null, force = false) {
    if (!cameraState.observerMode || !currentPatch) return Promise.resolve(false);

    const observer = getHorizonObserverFocus();
    if (!observer) return Promise.resolve(false);

    const resKey = normalizeHorizonResKey(resKeyOverride || els.horizonResKey?.value || horizonResKey);

    // View toggles reuse any completed horizon for this observer — do not recompute.
    if (!force && restoreViewshedHorizonIfCached(observer, resKey)) return Promise.resolve(true);

    horizonResKey = resKey;
    if (els.horizonResKey) els.horizonResKey.value = resKey;

    cancelViewshedHorizonCompute();
    const token = viewshedHorizonToken; // token captured after cancel (new compute generation)
    if (showHorizonRelational) clearHorizonRelationalMarkers();
    clearViewshedHorizonVisuals();
    viewshedHorizonData = null;
    horizonDrawProfile = null;
    viewshedHorizonObserver = null;
    viewshedObserverH = null;
    viewshedHorizonComputedResKey = null;
    viewshedHorizonScanRadiusKm = null;
    viewshedHorizonSettingsVersion = null;

    const worker = ensureHorizonWorker(false);
    if (!worker) {
      showHorizonCalcPanel(true);
      setHorizonCalcProgress('Viewshed worker unavailable — hard refresh (Ctrl+F5)', 0);
      console.error('[viewshed] worker unavailable');
      return Promise.reject(new Error('Viewshed worker unavailable'));
    }

    viewshedHorizonComputing = true;
    showHorizonCalcPanel(true);
    setHorizonCalcProgress(`Computing viewshed horizon (${viewshedProgressLabel(resKey)})…`, 0.05);

    setHorizonDrawButtonsActive(resKey === 'hires' || resKey === 'super' ? resKey : null);

    return new Promise((resolve, reject) => {
      const onMessage = (ev) => {
        if (ev.data?.token !== token) return;
        const msg = ev.data || {};
        if (msg.type === 'PROGRESS') {
          if (!cameraState.observerMode || ev.data?.token !== token) return;
          const done = Number(msg.payload?.done) || 0;
          const total = Math.max(1, Number(msg.payload?.total) || 1);
          const phase = String(msg.payload?.phase || '');
          const base = phase === 'dem' ? 0.1 : phase === 'viewshed' ? 0.22 : phase === 'observer' ? 0.14 : 0.06;
          const span = phase === 'dem' ? 0.12 : phase === 'viewshed' ? 0.62 : 0.08;
          const pct = base + (done / total) * span;
          setHorizonCalcProgress(msg.payload?.message || 'Calculating viewshed horizon…', pct);
          return;
        }
        if (msg.type === 'VIEWSHED_RESULT') {
          worker.removeEventListener('message', onMessage);
          resolve(msg.payload);
        }
        if (msg.type === 'ERROR') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(msg.payload?.message || 'Viewshed worker failed'));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({
        type: 'COMPUTE_VIEWSHED',
        token,
        payload: {
          lat: observer.lat,
          lon: observer.lng,
          resKey
        }
      });
    })
      .then((result) => {
        if (!result || token !== viewshedHorizonToken) {
          throw new Error('Viewshed cancelled');
        }
        const liveObserver = getHorizonObserverFocus() || observer;
        if (!horizonObserverMatches(liveObserver, observer)) {
          throw new Error('Observer moved during viewshed');
        }

        viewshedHorizonData = result.horizonData || [];
        viewshedHorizonObserver = { lat: Number(observer.lat), lng: Number(observer.lng) };
        if (isFinite(result.observerH)) viewshedObserverH = Number(result.observerH);
        viewshedHorizonComputedResKey = resKey;
        viewshedHorizonScanRadiusKm = Number(result.scanRadiusKm) || VIEWSHED_SCAN_RADIUS_KM;
        viewshedHorizonSettingsVersion = VIEWSHED_SETTINGS_VERSION;

        if (!cameraState.observerMode) {
          showHorizonCalcPanel(false);
          setHorizonDrawButtonsActive(null);
          throw new Error('Left astronomy view during viewshed');
        }

        applyViewshedHorizonVisuals(viewshedHorizonData, viewshedHorizonObserver, viewshedObserverH);
        notifyViewshedHorizonReady();
        if (showHorizonRelational && !suppressHorizonRelationalAutoLoad) {
          window.setTimeout(() => {
            if (showHorizonRelational && !suppressHorizonRelationalAutoLoad) void loadHorizonRelationalMarkers();
          }, 0);
        }
        const blockKm = Math.round(maxHorizonBlockDistM(viewshedHorizonData, viewshedHorizonObserver) / 1000);
        const reachKm = Math.round(Number(result.maxReachDistKm) || 0);
        setHorizonCalcProgress(
          `Viewshed ready — ${viewshedHorizonScanRadiusKm} km scan, blockers to ${blockKm} km${reachKm ? ` (rays to ${reachKm} km)` : ''}`,
          1
        );
        console.info('[viewshed]', viewshedProgressLabel(resKey, viewshedHorizonScanRadiusKm), `max blocker ${blockKm} km`, reachKm ? `max ray ${reachKm} km` : '');
        if (reachKm > 0 && reachKm < viewshedHorizonScanRadiusKm * 0.75) {
          console.warn(`[viewshed] rays stopped at ${reachKm} km (configured ${viewshedHorizonScanRadiusKm} km) — DEM fetch may be incomplete`);
        }
        window.setTimeout(() => {
          if (token === viewshedHorizonToken) {
            viewshedHorizonComputing = false;
            if (!horizonRelationalLoading) hideHorizonCalcPanelUnlessViewshed();
            setHorizonDrawButtonsActive(null);
          }
        }, 900);
        return result;
      })
      .catch((err) => {
        if (token !== viewshedHorizonToken) return Promise.reject(err);
        viewshedHorizonComputing = false;
        showHorizonCalcPanel(false);
        setHorizonDrawButtonsActive(null);
        console.warn('[viewshed] background compute failed', err);
        return Promise.reject(err);
      });
  }

  async function enableRelationalMonumentsForCurrentView() {
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

    if (showAllRelational && relationalMarkers.length) {
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

    if (showHorizonRelational && horizonClusterMarkers.length) {
      for (const m of horizonClusterMarkers) {
        const anchor = horizonMarkerScreenPoint(m);
        if (!anchor) {
          m.el.style.display = 'none';
          continue;
        }
        m.el.style.display = 'block';
        m.el.style.left = `${anchor.x}px`;
        m.el.style.top = `${anchor.y}px`;
      }
    }

    if (showHorizonRelational && horizonMemberMarkers.length) {
      for (const m of horizonMemberMarkers) {
        const anchor = horizonMarkerScreenPoint(m);
        if (!anchor) {
          m.el.style.display = 'none';
          continue;
        }
        m.el.style.display = 'block';
        m.el.style.left = `${anchor.x}px`;
        m.el.style.top = `${anchor.y}px`;
      }
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
    clearCustomLabels();
    for (const item of labelItems) {
      item.el?.remove();
      item.line?.remove();
    }
    labelItems = [];
    if (els.labelLines) els.labelLines.replaceChildren();
    closeLabelPopup();
    activeLabelId = null;
  }

  function removeFlatLabel(id, { force = false } = {}) {
    const removedKind = labelItems.find(item => item.id === id)?.kind || null;
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
    if (removedKind === 'custom') {
      customLabelMarkers = customLabelMarkers.filter((m) => m.id !== id);
      customLabels = customLabels.filter((c) => c.id !== id);
      updateCustomLabelPanel();
    }
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
      kind === 'horizon' ||
      kind === 'horizonMember' ||
      kind === 'custom' ||
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

  /** Place horizon target markers on the skyline at computed azimuth + altitude. */
  function projectedScreenPointHorizon(azimuthDeg, altitudeDeg, distanceM) {
    const observer = observerCameraLocal();
    if (!observer) return null;
    const bearingRad = THREE.MathUtils.degToRad(azimuthDeg);
    const altRad = THREE.MathUtils.degToRad(altitudeDeg);
    const dist = Math.max(80, Number(distanceM) || viewshedDisplayRadiusM());
    const horiz = Math.cos(altRad) * dist;
    const v = new THREE.Vector3(
      observer.x + Math.sin(bearingRad) * horiz,
      observer.y + Math.sin(altRad) * dist,
      observer.z - Math.cos(bearingRad) * horiz
    );
    v.project(camera);
    if (v.z < -1 || v.z > 1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * els.container.clientWidth,
      y: (-v.y * 0.5 + 0.5) * els.container.clientHeight
    };
  }

  function horizonMarkerScreenPoint(marker) {
    if (!marker || !isFinite(marker.azimuth) || !isFinite(marker.altitude)) return null;
    return projectedScreenPointHorizon(marker.azimuth, marker.altitude, marker.distM);
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
      const anchor = (item.horizonAzimuth != null && item.horizonAltitude != null)
        ? projectedScreenPointHorizon(item.horizonAzimuth, item.horizonAltitude, item.horizonDistM)
        : projectedScreenPoint(item.local, 0);
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

  async function goToSite(site, options = {}) {
    const skipDefaultMonuments = !!options.skipDefaultMonuments;
    const viewRestore = !!options.viewRestore;
    if (!viewRestore) {
      cameraState.observerMode = false;
      panoramaObserverFocus = null;
      syncPanoramaButton();
    }
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
    if (!viewRestore) {
      cameraState.pitch = 8;
      cameraState.bearing = 28;
      cameraState.distance = 1850;
    }
    renderSites();
    updateFocusTarget();
    updateCamera();
    try {
      await buildTerrain(currentFocus, { skipMonumentLoad: viewRestore });
      // DEM is now rendered (terrain mesh built + added). Reveal site UI.
      if (selectedSiteId === site.id) {
        setStageLoadingProgress(1);
        setStageDemReady(true);
        syncPanoramaButton();
        updateNotesPanel();
        if (!skipDefaultMonuments && !viewRestore) await enableRelationalMonumentsForCurrentView();
        setSidebarHidden(true);
      }
    } catch (e) {
      setStageLoadingText(`Failed to load DEM: ${e?.message || String(e)}`);
      setStageLoadingProgress(0.02, { indeterminate: true });
    }
  }

  function parseCoordinateValue(raw) {
    if (raw == null) return NaN;
    if (typeof raw === 'number') return raw;
    let s = String(raw).trim();
    if (!s) return NaN;
    s = s.replace(/[\u2212\u2013\u2014]/g, '-').replace(/\u00a0/g, ' ');

    let hemiSign = 1;
    const hemi = s.match(/[NSEW]/i);
    if (hemi) {
      const h = hemi[0].toUpperCase();
      if (h === 'S' || h === 'W') hemiSign = -1;
      s = s.replace(/[NSEW]/gi, '').trim();
    }

    // DMS: 53°29'24" or 53 29 24
    const dms = s.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:°|d|deg)?\s*(\d+(?:[.,]\d+)?)?\s*(?:'|′|m|min)?\s*(\d+(?:[.,]\d+)?)?\s*(?:"|″|s|sec)?/i);
    if (dms && (dms[2] != null || dms[3] != null)) {
      const deg = Math.abs(parseFloat(String(dms[1]).replace(',', '.')) || 0);
      const min = parseFloat(String(dms[2] || '0').replace(',', '.')) || 0;
      const sec = parseFloat(String(dms[3] || '0').replace(',', '.')) || 0;
      let val = deg + min / 60 + sec / 3600;
      if ((parseFloat(String(dms[1]).replace(',', '.')) || 0) < 0) val = -val;
      else if (hemiSign < 0) val = -val;
      return val;
    }

    // Decimal: European comma, or strip thousands separators
    if (s.includes(',') && !s.includes('.')) {
      s = s.replace(',', '.');
    } else if (s.includes(',') && s.includes('.')) {
      const lastComma = s.lastIndexOf(',');
      const lastDot = s.lastIndexOf('.');
      if (lastComma > lastDot) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    }

    const m = s.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!m) return NaN;
    let val = parseFloat(m[0]);
    if (!Number.isFinite(val)) return NaN;
    if (hemi && hemiSign < 0) val = -Math.abs(val);
    return val;
  }

  function normalizeLongitudeDeg(lng) {
    if (!Number.isFinite(lng)) return NaN;
    let x = lng;
    if (x > 180 || x < -180) {
      x = ((x + 180) % 360 + 360) % 360 - 180;
    }
    return x;
  }

  function parseObserverCoordinates(latRaw, lngRaw) {
    let lat = parseCoordinateValue(latRaw);
    let lng = parseCoordinateValue(lngRaw);
    lng = normalizeLongitudeDeg(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  function readObserverLocationFromForm() {
    let latRaw = els.observerLat?.value;
    let lngRaw = els.observerLon?.value;
    const latStr = latRaw != null ? String(latRaw).trim() : '';
    const lngStr = lngRaw != null ? String(lngRaw).trim() : '';
    if (latStr && !lngStr && /[,;]/.test(latStr)) {
      const parts = latStr.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        latRaw = parts[0];
        lngRaw = parts[1];
      }
    }
    return parseObserverCoordinates(latRaw, lngRaw);
  }

  async function goToObserverLocation(lat, lng) {
    const parsed = (lat != null && lng != null && typeof lat !== 'object')
      ? parseObserverCoordinates(lat, lng)
      : readObserverLocationFromForm();
    if (!parsed) {
      if (els.observerStatus) els.observerStatus.textContent = 'Enter a valid latitude and longitude.';
      return;
    }
    const cleanLat = parsed.lat;
    const cleanLng = parsed.lng;
    if (els.observerLat) els.observerLat.value = String(cleanLat);
    if (els.observerLon) els.observerLon.value = String(cleanLng);

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
    panoramaObserverFocus = null;
    astronomyToolbarOpen = false;
    syncPanoramaButton();
    syncTerrainViewAstroUi();
    syncPanoramaViewControls();
    syncViewshedHorizonVisibility();
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
        syncTerrainViewAstroUi();
        syncViewshedHorizonVisibility();
        updateCamera();
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
      syncCameraProjection(true);
      const pitchRad = THREE.MathUtils.degToRad(cameraState.pitch);
      const bearingRad = THREE.MathUtils.degToRad(cameraState.bearing);
      const lookDistance = 120;
      camera.position.set(observer.x, observer.y, observer.z);
      camera.lookAt(
        observer.x + Math.sin(bearingRad) * Math.cos(pitchRad) * lookDistance,
        observer.y + Math.sin(pitchRad) * lookDistance,
        observer.z - Math.cos(bearingRad) * Math.cos(pitchRad) * lookDistance
      );
      updateTerrainMaterialUniforms();
      updateAstroOverlay();
      purgeViewshedVisualsUnlessPanorama();
      els.zoom.textContent = observerZoomReadout();
      els.pitch.textContent = Math.round(cameraState.pitch);
      els.bearing.textContent = ((Math.round(cameraState.bearing) % 360) + 360) % 360;
      syncAstroReadout();
      updateObserverStatus();
      return;
    }
    syncCameraProjection(false);
    const pitchRad = THREE.MathUtils.degToRad(cameraState.pitch);
    const bearingRad = THREE.MathUtils.degToRad(cameraState.bearing);
    const horizontal = Math.cos(pitchRad) * cameraState.distance;
    const y = Math.sin(pitchRad) * cameraState.distance;
    camera.position.set(
      cameraState.target.x - Math.sin(bearingRad) * horizontal,
      cameraState.target.y + y,
      cameraState.target.z + Math.cos(bearingRad) * horizontal
    );
    camera.lookAt(cameraState.target);
    updateTerrainMaterialUniforms();
    updateAstroOverlay();
    purgeViewshedVisualsUnlessPanorama();
    els.zoom.textContent = Math.round(cameraState.distance);
    els.pitch.textContent = Math.round(cameraState.pitch);
    els.bearing.textContent = ((Math.round(cameraState.bearing) % 360) + 360) % 360;
    syncAstroReadout();
  }

  function resize() {
    if (!els.container || !renderer) return;
    const w = Math.max(1, Math.floor(els.container.clientWidth));
    const h = Math.max(1, Math.floor(els.container.clientHeight));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (els.labelLines) {
      els.labelLines.setAttribute('width', String(w));
      els.labelLines.setAttribute('height', String(h));
      els.labelLines.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
  }

  function bindStageResizeObserver() {
    if (!els.container || stageResizeObserver || typeof ResizeObserver === 'undefined') return;
    stageResizeObserver = new ResizeObserver(() => {
      resize();
      layoutStagePanels();
    });
    stageResizeObserver.observe(els.container);
  }

  function renderScene() {
    let screenMask = null;
    let horizonMap = null;
    const profile = horizonDrawProfileData();
    if (cameraState.observerMode && profile?.length && viewshedHorizonObserver && currentPatch) {
      const { ring } = buildHorizonRingFromProfile(profile, viewshedHorizonObserver);
      if (ring.length >= 2) screenMask = buildFpvHorizonScreenMaskFromRing(ring);
      horizonMap = buildViewshedHorizonLookupTexture(profile);
    }
    updateTerrainHorizonMaskUniforms(terrainMesh?.material, screenMask);
    updateSkyDomeScreenMask(screenMask);
    astronomyOverlay?.syncHorizonClip?.(
      screenMask,
      renderer.domElement.width,
      renderer.domElement.height,
      horizonMap
    );
    syncFpvHorizonClearColor(!!screenMask);
    renderer.render(scene, camera);
  }

  function animate() {
    requestAnimationFrame(animate);
    if (!externalRenderLock) renderScene();
    updateFlatLabels();
    updateRelationalMarkers();
    updateCustomMarkers();
    if (els.legendInline && els.showLegend && els.showLegend.checked) {
      const now = performance.now();
      if ((now - legendLastUpdate) > 350) {
        legendLastUpdate = now;
        updateLegendPanel();
      }
    }
  }

  function setExportCameraView({ bearing, pitch = 0, fov = 60, aspect = 1 }) {
    const observer = observerCameraLocal();
    const pitchRad = THREE.MathUtils.degToRad(pitch);
    const bearingRad = THREE.MathUtils.degToRad(bearing);
    const lookDistance = 120;
    camera.fov = fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    if (observer) {
      camera.position.set(observer.x, observer.y, observer.z);
      camera.lookAt(
        observer.x + Math.sin(bearingRad) * Math.cos(pitchRad) * lookDistance,
        observer.y + Math.sin(pitchRad) * lookDistance,
        observer.z - Math.cos(bearingRad) * Math.cos(pitchRad) * lookDistance
      );
      return;
    }

    const horizontal = Math.cos(pitchRad) * cameraState.distance;
    const y = Math.sin(pitchRad) * cameraState.distance;
    camera.position.set(
      cameraState.target.x - Math.sin(bearingRad) * horizontal,
      cameraState.target.y + y,
      cameraState.target.z + Math.cos(bearingRad) * horizontal
    );
    camera.lookAt(cameraState.target);
  }

  function skyscapeExportState() {
    const observer = observerCameraLocal();
    return {
      ready: Boolean(currentPatch && (currentFocus || selectedSite)),
      title: selectedSite?.name || selectedSite?.Name || selectedSite?.monumentClass || 'Skyscape Landscape',
      focus: currentFocus ? { lat: currentFocus.lat, lng: currentFocus.lng } : null,
      observer: observer ? { ...observer } : null,
      baseElevationM: Number(baseCenterElev || 0),
      verticalExaggeration,
      observerTerrainElevationM: observer
        ? (observer.groundY / Math.max(verticalExaggeration, 0.0001)) + Number(baseCenterElev || 0)
        : Number(baseCenterElev || 0),
      displaySettings: { ...displaySettings },
      terrainPaintSettings: { ...terrainPaintSettings },
      rendererSize: renderer.getSize(new THREE.Vector2()),
      pixelRatio: renderer.getPixelRatio()
    };
  }

  window.SkyscapeRuntime = {
    THREE,
    renderer,
    scene,
    camera,
    getSkyDome: () => skyDome,
    getExportState: skyscapeExportState,
    setPanoramaMode,
    setExportCameraView,
    updateCamera,
    resize,
    render: () => renderScene(),
    setExternalRenderLock: (locked) => { externalRenderLock = Boolean(locked); },
    setStageStatus: (message) => {
      if (els.nmsStatus && message) els.nmsStatus.textContent = message;
      if (els.stageLoadingText && message && !siteDemReady) els.stageLoadingText.textContent = message;
    },
    isPanoramaView: () => !!cameraState.observerMode
  };

  function setSidebarHidden(hidden) {
    const shell = document.querySelector('.app-shell');
    if (!shell) return;
    shell.classList.toggle('sidebar-hidden', !!hidden);
    if (toggleSidebarBtn) toggleSidebarBtn.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    if (sidebarPeekBtn) sidebarPeekBtn.setAttribute('aria-hidden', hidden ? 'false' : 'true');
    requestAnimationFrame(() => {
      resize();
      requestAnimationFrame(resize);
    });
    window.setTimeout(resize, 280);
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
    updateStageViewCaption();
    // Controls affect available viewport; keep renderer in sync.
    window.setTimeout(resize, 60);
    resize();
  }

  function syncPanoramaButton() {
    syncAstronomyToolbar();
  }

  function syncPanoramaSceneVisuals() {
    if (terrainMesh) terrainMesh.visible = true;
    updateSkyDomeViewshedMask();
  }

  function syncPanoramaViewControls() {
    const fpv = !!cameraState.observerMode;
    document.querySelectorAll('.controls button[data-action]').forEach((btn) => {
      const action = btn.getAttribute('data-action');
      if (!FPV_LOCKED_MOVE_ACTIONS.has(action)) return;
      btn.classList.toggle('fpv-location-locked', fpv);
      btn.setAttribute('aria-disabled', fpv ? 'true' : 'false');
    });
    if (els.observerLat) els.observerLat.disabled = false;
    if (els.observerLon) els.observerLon.disabled = false;
    const observerSubmit = els.observerForm?.querySelector('button[type="submit"]');
    observerSubmit?.removeAttribute('disabled');
    els.observerForm?.classList.remove('fpv-location-locked');
  }

  function syncTerrainViewAstroUi() {
    const panorama = !!cameraState.observerMode;
    const archBtn = document.querySelector('button[data-toggle="astro-show-archaeolines"]');
    const compassBtn = document.querySelector('button[data-toggle="astro-show-horizon-compass"]');
    const horizonRelBtn = document.querySelector('button[data-toggle="show-horizon-relational"]');
    for (const btn of [els.toggleDatetimePanel, archBtn, compassBtn, horizonRelBtn, els.fpvHorizonHires, els.fpvHorizonSuper, els.exportStellarium, els.toggleCustomLabel]) {
      if (!btn) continue;
      btn.classList.toggle('panorama-only-disabled', !panorama);
      btn.setAttribute('aria-disabled', panorama ? 'false' : 'true');
    }
    if (els.horizonResKey) {
      els.horizonResKey.disabled = false;
      els.horizonResKey.closest('.coord-row')?.classList.remove('panorama-only-disabled');
    }
    if (els.showHorizonRelational) {
      els.showHorizonRelational.disabled = !panorama;
      els.showHorizonRelational.closest('.layer-option')?.classList.toggle('panorama-only-disabled', !panorama);
    }
    if (!panorama) {
      cancelViewshedHorizonCompute();
      clearHorizonRelationalMarkers();
      if (els.showHorizonRelational) {
        els.showHorizonRelational.checked = !!showHorizonRelational;
      }
      if (datetimePanelOpen || customLabelPanelOpen) activateStagePanel(null);
      setCustomLabelPickMode(false);
      clearCustomLabels();
      astronomyToolbarOpen = false;
      syncAstronomyToolbar();
    }
    syncPanoramaSceneVisuals();
    syncPanoramaViewControls();
    syncFpvCenterControls();
    astronomyOverlay?.updateOverlay();
    applyDisplaySettings();
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
      panoramaObserverFocus = { lat: focus.lat, lng: focus.lng };
      cameraState.observerMode = true;
      cameraState.observerHeightOffsetM = OBSERVER_HEIGHT_OFFSET_M;
      cameraState.fov = OBSERVER_FOV_DEFAULT;
      cameraState.pitch = 0;
      if (els.observerLat) els.observerLat.value = String(focus.lat);
      if (els.observerLon) els.observerLon.value = String(focus.lng);
      syncPanoramaButton();
      syncTerrainViewAstroUi();
      if (!currentPatch) await buildTerrain(currentFocus);
      rebuildTerrainHeights();
      updateFocusTarget();
      updateCamera();
      updateObserverStatus();
      syncViewshedHorizonVisibility();
      const obs = getHorizonObserverFocus();
      const forceViewshed = !horizonCacheValidForObserver(obs, normalizeHorizonResKey(horizonResKey));
      scheduleViewshedHorizonBackground(null, forceViewshed);
      return;
    }

    cameraState.observerMode = false;
    panoramaObserverFocus = null;
    cameraState.pitch = Math.max(8, cameraState.pitch);
    astronomyToolbarOpen = false;
    syncPanoramaButton();
    syncTerrainViewAstroUi();
    rebuildTerrainHeights();
    cancelViewshedHorizonCompute();
    clearViewshedHorizonVisuals();
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
      const req = indexedDB.open(SAVED_VIEWS_DB, 4);
      req.onupgradeneeded = () => {
        const db = req.result;
        const oldVersion = Number(req.oldVersion || 0);
        if (oldVersion > 0 && oldVersion < 4) {
          try {
            if (db.objectStoreNames.contains('scenes')) db.deleteObjectStore('scenes');
          } catch (_) {}
          try {
            if (db.objectStoreNames.contains(SAVED_VIEWS_STORE)) db.deleteObjectStore(SAVED_VIEWS_STORE);
          } catch (_) {}
        }
        if (!db.objectStoreNames.contains(SAVED_VIEWS_STORE)) {
          const store = db.createObjectStore(SAVED_VIEWS_STORE, { keyPath: 'id' });
          try { store.createIndex('viewType', 'viewType', { unique: false }); } catch (_) {}
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Failed to open saved views database.'));
    });
  }

  function idbRequestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Saved views request failed.'));
    });
  }

  async function savedViewsTx(mode, fn, storeName = SAVED_VIEWS_STORE) {
    const db = await openSavedViewsDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      let settled = false;
      const finishOk = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(result);
      };
      const finishErr = (err) => {
        if (settled) return;
        settled = true;
        db.close();
        reject(err || new Error('Saved views database error.'));
      };
      tx.oncomplete = () => finishOk();
      tx.onerror = () => finishErr(tx.error);
      tx.onabort = () => finishErr(tx.error || new Error('Saved views transaction aborted.'));
      try {
        const out = fn(store);
        if (out && typeof out.then === 'function') {
          out.then((value) => { result = value; }, (err) => {
            try { tx.abort(); } catch (_) {}
            finishErr(err);
          });
        } else {
          result = out;
        }
      } catch (err) {
        finishErr(err);
      }
    });
  }

  async function getSavedViews() {
    return savedViewsTx('readonly', (store) => idbRequestToPromise(store.getAll()).then((rows) => rows || []));
  }

  async function putSavedView(view) {
    return savedViewsTx('readwrite', (store) => idbRequestToPromise(store.put(view)));
  }

  async function deleteSavedView(id) {
    return savedViewsTx('readwrite', (store) => idbRequestToPromise(store.delete(id)));
  }

  async function clearSavedViews() {
    return savedViewsTx('readwrite', (store) => idbRequestToPromise(store.clear()));
  }

  async function getMonumentSelectionSetting() {
    return savedViewsTx('readonly', (store) => idbRequestToPromise(store.get(MONUMENT_SELECTION_SETTING_ID)).then((row) => row || null), SETTINGS_STORE);
  }

  async function saveMonumentSelectionSetting() {
    if (!monumentSelectionStorageEnabled()) return;
    const classes = Array.from(selectedMonumentClasses.values()).map(String).filter(Boolean);
    await savedViewsTx('readwrite', (store) => idbRequestToPromise(store.put({
      id: MONUMENT_SELECTION_SETTING_ID,
      classes,
      updatedAt: Date.now()
    })), SETTINGS_STORE);
  }

  async function clearMonumentSelectionSetting() {
    await savedViewsTx('readwrite', (store) => idbRequestToPromise(store.delete(MONUMENT_SELECTION_SETTING_ID)), SETTINGS_STORE);
  }

  function cloneForStorage(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  function compactSiteForState(site) {
    if (!site) return null;
    const props = cloneForStorage(site.props || {});
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
    if (showHorizonRelational) return 'horizon';
    if (showAllMonuments) return 'all';
    if (showAllRelational) return 'relational';
    if (showRelatedMonuments) return 'type';
    return null;
  }

  function normalizeViewType(state) {
    if (state?.viewType === 'fpv' || state?.viewType === 'default') return state.viewType;
    return state?.camera?.observerMode ? 'fpv' : 'default';
  }

  function captureAstroToggleState() {
    const archBtn = document.querySelector('button[data-toggle="astro-show-archaeolines"]');
    return {
      showArchaeolines: !!(els.astroShowArchaeolines?.checked ?? archBtn?.classList.contains('active')),
      showHorizonRelational: !!showHorizonRelational
    };
  }

  function applyAstroToggleState(astroToggles) {
    if (!astroToggles || typeof astroToggles !== 'object') return;
    if (typeof astroToggles.showArchaeolines === 'boolean') {
      if (els.astroShowArchaeolines) {
        els.astroShowArchaeolines.checked = astroToggles.showArchaeolines;
        dispatchInputChange(els.astroShowArchaeolines);
      }
      const archBtn = document.querySelector('button[data-toggle="astro-show-archaeolines"]');
      if (archBtn) {
        archBtn.classList.toggle('active', astroToggles.showArchaeolines);
        archBtn.setAttribute('aria-pressed', astroToggles.showArchaeolines ? 'true' : 'false');
      }
    }
  }

  function captureViewState(name = '') {
    const shell = document.querySelector('.app-shell');
    const viewType = currentViewType();
    let monumentMode = currentMonumentMode();
    if (viewType === 'fpv' && showHorizonRelational) monumentMode = 'horizon';
    const state = {
      version: 2,
      viewType,
      name: String(name || '').trim(),
      savedAt: Date.now(),
      selectedSite: compactSiteForState(selectedSite),
      focus: currentFocus ? { lat: Number(currentFocus.lat), lng: Number(currentFocus.lng) } : null,
      camera: {
        pitch: cameraState.pitch,
        bearing: cameraState.bearing,
        distance: cameraState.distance,
        fov: clampObserverFov(cameraState.fov),
        observerMode: viewType === 'fpv'
      },
      imageryKey,
      demAreaKey,
      verticalExaggeration,
      activeType,
      selectedClasses: Array.from(selectedMonumentClasses.values()),
      monumentMode,
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
    if (viewType === 'fpv') {
      state.datetime = captureDateTimeState();
      state.horizonResKey = normalizeHorizonResKey(horizonResKey);
      state.astroToggles = captureAstroToggleState();
      state.customLabels = customLabels.map((c) => ({
        id: c.id,
        heading: c.heading,
        subText: c.subText,
        azimuth: c.azimuth,
        altitude: c.altitude,
        distM: c.distM,
        active: c.id === activeLabelId
      }));
    }
    return state;
  }

  async function rebuildAstronomyViewAfterRestore(state, monumentMode) {
    if (!cameraState.observerMode || !currentPatch) return;
    const observer = getHorizonObserverFocus();
    if (!observer) return;
    const token = ++viewRestoreToken;
    const wantsHorizonRelational = monumentMode === 'horizon';
    const resKey = normalizeHorizonResKey(state?.horizonResKey || horizonResKey);
    horizonResKey = resKey;
    if (els.horizonResKey) els.horizonResKey.value = resKey;
    setHorizonDrawButtonsActive(resKey === 'hires' || resKey === 'super' ? resKey : null);

    rebuildTerrainHeights();
    syncTerrainViewAstroUi();
    syncFpvCenterControls();
    syncViewshedHorizonVisibility();
    applyDateTimeState(state?.datetime);
    astronomyOverlay?.clearCache?.();
    astronomyOverlay?.updateOverlay?.(false, { forceBodies: true });

    showHorizonCalcPanel(true);
    setHorizonCalcProgress('Rebuilding astronomy horizon viewshed…', 0.03);

    suppressHorizonRelationalAutoLoad = true;
    try {
      await scheduleViewshedHorizonBackground(resKey, true);
    } catch (e) {
      if (token === viewRestoreToken) {
        console.warn('[view-restore] viewshed rebuild failed', e);
      }
    } finally {
      suppressHorizonRelationalAutoLoad = false;
    }
    if (token !== viewRestoreToken) return;

    if (wantsHorizonRelational) await loadHorizonRelationalMarkers();
    astronomyOverlay?.updateOverlay?.(false, { forceBodies: true });
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

  function promptSavedViewName(defaultName, { title = 'Save View', inputLabel = 'Saved view name' } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'saved-view-pop';
      overlay.innerHTML = `
        <div class="saved-view-pop-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <div class="saved-view-pop-title">${escapeHtml(title)}</div>
          <input class="saved-view-pop-input" type="text" maxlength="80" value="${escapeHtml(defaultName || 'Saved View')}" aria-label="${escapeHtml(inputLabel)}">
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
      const commitName = () => {
        const value = String(input?.value || '').trim();
        if (!value) {
          input?.focus();
          input?.select();
          return;
        }
        close(value);
      };
      overlay.querySelector('[data-cancel]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        close(null);
      });
      overlay.querySelector('[data-save]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        commitName();
      });
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter') {
          e.preventDefault();
          commitName();
        }
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(null);
      });
      document.body.appendChild(overlay);
      input?.focus();
      input?.select();
    });
  }

  async function saveCurrentView(anchor = saveViewBtn) {
    if (!savedViewsEnabled()) {
      setSavedViewsStatus('Stored views are disabled.');
      showCopiedPop(anchor, 'Stored views disabled');
      return;
    }
    const viewType = currentViewType();
    const fallback = selectedSite
      ? (titleCaseWords(shortName(selectedSite.townland)) || 'Saved View')
      : (viewType === 'fpv' ? 'FP View' : 'Saved View');
    const name = await promptSavedViewName(fallback);
    if (!name) return;
    try {
      const state = cloneForStorage(captureViewState(name));
      const item = {
        id: `view-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        viewType: state.viewType,
        name: state.name,
        savedAt: state.savedAt,
        state
      };
      await putSavedView(item);
      await renderSavedViewsList();
      setSavedViewsStatus(`Saved "${state.name}" (${viewTypeLabel(viewType)}).`);
      showCopiedPop(anchor, 'View Saved');
    } catch (err) {
      console.warn('Save view failed', err);
      setSavedViewsStatus(`Save failed: ${err?.message || err}`);
      showCopiedPop(anchor, 'Save failed');
    }
  }

  function downloadJsonFile(filename, obj) {
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function slugifyViewsFilename(name) {
    const slug = String(name || 'views')
      .trim()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72);
    return slug || 'views';
  }

  async function exportSavedViewsToJson(anchor = null) {
    try {
      const rows = await getSavedViews();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJsonFile(`archaeoscapes-views-${slugifyViewsFilename(stamp)}.json`, {
        kind: 'views',
        version: 2,
        exportedAt: Date.now(),
        views: rows.map((row) => ({
          name: row.name,
          viewType: row.viewType || normalizeViewType(row.state),
          savedAt: row.savedAt,
          state: row.state
        }))
      });
      setSavedViewsStatus(`Exported ${rows.length} view${rows.length === 1 ? '' : 's'}.`);
      showCopiedPop(anchor, 'Exported');
    } catch (err) {
      console.warn('Export views failed', err);
      setSavedViewsStatus(`Export failed: ${err?.message || err}`);
      showCopiedPop(anchor, 'Export failed');
    }
  }

  async function importViewsFromJsonFile(file, { openAfter = false } = {}) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed?.views) ? parsed.views : (parsed?.state ? [parsed] : []);
    if (!rows.length) throw new Error('No views found in file');
    let imported = 0;
    for (const raw of rows) {
      const state = raw?.state || raw;
      if (!state || typeof state !== 'object' || !state.camera) continue;
      const viewType = raw?.viewType || normalizeViewType(state);
      state.viewType = viewType;
      state.version = 2;
      const name = String(raw?.name || state.name || 'Imported View').trim() || 'Imported View';
      state.name = name;
      const savedAt = Number(raw?.savedAt || state.savedAt || Date.now()) || Date.now();
      await putSavedView({
        id: `view-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        viewType,
        name,
        savedAt,
        state: cloneForStorage(state)
      });
      imported += 1;
    }
    if (!imported) throw new Error('No valid views in file');
    await renderSavedViewsList();
    setSavedViewsStatus(`Imported ${imported} view${imported === 1 ? '' : 's'}.`);
    if (openAfter && rows[0]) {
      const state = rows[0]?.state || rows[0];
      if (state?.camera) await restoreViewState(state);
    }
    return imported;
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

  function dispatchInputChange(el) {
    if (!el) return;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
  }

  function shortestBearingDeltaDeg(fromDeg, toDeg) {
    return ((Number(toDeg) - Number(fromDeg) + 540) % 360) - 180;
  }

  function animateCameraTo(targetCamera, durationMs = 480) {
    if (!targetCamera) {
      updateCamera();
      return;
    }
    cameraAnimToken += 1;
    const token = cameraAnimToken;
    if (cameraAnimRaf) cancelAnimationFrame(cameraAnimRaf);
    const start = {
      pitch: Number(cameraState.pitch),
      bearing: Number(cameraState.bearing),
      distance: Number(cameraState.distance),
      fov: clampObserverFov(cameraState.fov)
    };
    const end = {
      pitch: isFinite(targetCamera.pitch) ? Number(targetCamera.pitch) : start.pitch,
      bearing: isFinite(targetCamera.bearing) ? Number(targetCamera.bearing) : start.bearing,
      distance: isFinite(targetCamera.distance) ? Number(targetCamera.distance) : start.distance,
      fov: targetCamera.fov != null && isFinite(targetCamera.fov) ? clampObserverFov(targetCamera.fov) : start.fov
    };
    const bearingDelta = shortestBearingDeltaDeg(start.bearing, end.bearing);
    const t0 = performance.now();
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const tick = () => {
      if (token !== cameraAnimToken) return;
      const u = Math.min(1, (performance.now() - t0) / Math.max(120, durationMs));
      const e = easeInOut(u);
      cameraState.pitch = start.pitch + (end.pitch - start.pitch) * e;
      cameraState.bearing = start.bearing + bearingDelta * e;
      cameraState.distance = start.distance + (end.distance - start.distance) * e;
      cameraState.fov = start.fov + (end.fov - start.fov) * e;
      updateCamera();
      if (u < 1) cameraAnimRaf = requestAnimationFrame(tick);
      else cameraAnimRaf = 0;
    };
    cameraAnimRaf = requestAnimationFrame(tick);
  }

  async function restoreViewState(state) {
    if (!state || typeof state !== 'object') return;
    const targetViewType = normalizeViewType(state);
    const monumentMode = resolveMonumentModeFromViewState(state);
    if (Array.isArray(state.selectedClasses) && state.selectedClasses.length) {
      selectedMonumentClasses = new Set(state.selectedClasses.map(String).filter(Boolean));
      await cacheIconsForSelected();
      renderTypeList();
    }
    activeType = state.activeType || activeType;
    imageryKey = state.imageryKey || imageryKey;
    syncImageryRadioButtons();
    refreshSurfaceToolbar();
    demAreaKey = state.demAreaKey === 'double' ? 'double' : 'standard';
    verticalExaggeration = Number(state.verticalExaggeration ?? verticalExaggeration) || 0;
    if (els.heightSlider) els.heightSlider.value = String(verticalExaggeration);
    if (els.heightValue) els.heightValue.textContent = `${verticalExaggeration.toFixed(1)}x`;
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

    const savedCamera = {
      pitch: Number(state.camera?.pitch ?? cameraState.pitch),
      bearing: Number(state.camera?.bearing ?? cameraState.bearing),
      distance: Number(state.camera?.distance ?? cameraState.distance),
      fov: state.camera?.fov != null ? clampObserverFov(state.camera.fov) : clampObserverFov(cameraState.fov),
      observerMode: targetViewType === 'fpv'
    };

    clearAllMonumentMarkerLayers();
    setMonumentModeFlags(monumentMode);
    cameraState.pitch = savedCamera.pitch;
    cameraState.bearing = savedCamera.bearing;
    cameraState.distance = savedCamera.distance;
    cameraState.fov = savedCamera.fov;
    cameraState.observerMode = savedCamera.observerMode;
    if (targetViewType === 'fpv') ensurePanoramaObserverFocusFromState(state);
    syncPanoramaButton();

    const site = state.selectedSite || (state.focus ? { id: `view-${state.focus.lat},${state.focus.lng}`, lat: state.focus.lat, lng: state.focus.lng, townland: '', county: '', smr: '', props: {} } : null);
    if (site && isFinite(site.lat) && isFinite(site.lng)) {
      await goToSite(site, { skipDefaultMonuments: true, viewRestore: true });

      clearAllMonumentMarkerLayers();
      setMonumentModeFlags(monumentMode);
      cameraState.pitch = savedCamera.pitch;
      cameraState.bearing = savedCamera.bearing;
      cameraState.distance = savedCamera.distance;
      cameraState.fov = savedCamera.fov;
      cameraState.observerMode = savedCamera.observerMode;
      if (targetViewType === 'fpv') ensurePanoramaObserverFocusFromState(state);
      syncPanoramaButton();
      syncTerrainViewAstroUi();
      syncPanoramaSceneVisuals();
      syncViewshedHorizonVisibility();
      updateCamera();

      if (targetViewType === 'fpv') {
        if (state.horizonResKey) {
          horizonResKey = normalizeHorizonResKey(state.horizonResKey);
          if (els.horizonResKey) els.horizonResKey.value = horizonResKey;
        }
        applyAstroToggleState(state.astroToggles);
        applyDateTimeState(state?.datetime);
        await rebuildAstronomyViewAfterRestore(state, monumentMode);
        if (monumentMode !== 'horizon') await reloadMonumentMarkersForCurrentMode();
      } else {
        await reloadMonumentMarkersForCurrentMode();
        astronomyOverlay?.updateOverlay?.(false, { forceBodies: true });
      }

      restoreOpenLabels(state);
      if (targetViewType === 'fpv') restoreCustomLabels(state);
      updateLegendPanel();
    } else {
      updateCamera();
      astronomyOverlay?.updateOverlay?.(false, { forceBodies: true });
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
      const viewType = view.viewType || normalizeViewType(view.state);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'saved-view-item';
      const savedSite = view.state?.selectedSite || {};
      const savedProps = savedSite.props || {};
      const monumentClass = String(savedProps.MONUMENT_CLASS || view.state?.activeType || '').trim();
      const smr = String(savedSite.smr || savedProps.SMRS || savedProps.SMRNo || '').trim();
      const county = titleCaseWords(savedSite.county || savedProps.COUNTY || '');
      const meta = [viewTypeLabel(viewType), smr, county].filter(Boolean).join(' · ');
      row.innerHTML = `
        <span class="saved-icon megicon"></span>
        <span><span class="saved-name">${escapeHtml(view.name || 'Saved view')}</span><span class="saved-meta">${escapeHtml(meta)}</span></span>
        <span class="saved-view-delete" role="button" title="Delete saved view"><i class="ph-bold ph-trash"></i></span>
      `;
      renderMegIconInto(row.querySelector('.saved-icon'), monumentClass, TOUR_LIST_ICON_SIZE);
      row.addEventListener('click', async (e) => {
        if (e.target.closest('.saved-view-delete')) {
          e.stopPropagation();
          try {
            await deleteSavedView(view.id);
            await renderSavedViewsList();
            setSavedViewsStatus(`Deleted "${view.name || 'Saved view'}".`);
          } catch (err) {
            console.warn('Delete saved view failed', err);
            setSavedViewsStatus(`Delete failed: ${err?.message || err}`);
          }
          return;
        }
        try {
          await restoreViewState(view.state);
          setSavedViewsStatus(`Restored "${view.name || 'Saved view'}".`);
        } catch (err) {
          console.warn('Restore saved view failed', err);
          setSavedViewsStatus(`Restore failed: ${err?.message || err}`);
        }
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

  async function promptImportViewFile(anchor = null) {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) return;
        try {
          await importViewsFromJsonFile(file, { openAfter: true });
          showCopiedPop(anchor, 'Imported');
        } catch (err) {
          console.warn('Import views failed', err);
          setSavedViewsStatus(`Import failed: ${err?.message || err}`);
          showCopiedPop(anchor, 'Import failed');
        }
      }, { once: true });
      document.body.appendChild(input);
      input.click();
    } catch (err) {
      console.warn('Import views failed', err);
      setSavedViewsStatus(`Import failed: ${err?.message || err}`);
      showCopiedPop(anchor, 'Import failed');
    }
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
  const sidebarEl = document.querySelector('.sidebar');
  if (sidebarEl) {
    sidebarEl.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'width') resize();
    });
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
  if (els.toggleFpv) {
    els.toggleFpv.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleFpvMode();
    });
  }
  if (els.toggleAstronomy) {
    els.toggleAstronomy.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleAstronomyMode();
    });
  }
  syncAstronomyToolbar();
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
  loadingImportViewBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await promptImportViewFile(e.currentTarget);
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
  saveViewBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await saveCurrentView(e.currentTarget);
  });
  copyViewBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const state = cloneForStorage(captureViewState());
      await copyText(shareUrlForState(state));
      showCopiedPop(e.currentTarget, 'Copied !');
    } catch (err) {
      console.warn('Copy view URL failed', err);
      setSavedViewsStatus(`Copy failed: ${err?.message || err}`);
      showCopiedPop(e.currentTarget, 'Copy failed');
    }
  });
  exportViewsBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await exportSavedViewsToJson(e.currentTarget);
  });
  importViewsBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await promptImportViewFile(e.currentTarget);
  });
  if (els.savedViewsEnabled) {
    els.savedViewsEnabled.checked = savedViewsEnabled();
    els.savedViewsEnabled.addEventListener('change', async () => {
      localStorage.setItem(SAVED_VIEWS_ENABLED_KEY, els.savedViewsEnabled.checked ? 'true' : 'false');
      await renderSavedViewsList();
    });
  }
  els.savedViewPurge?.addEventListener('click', async () => {
    if (!window.confirm('Purge all saved view data from this browser?')) return;
    try {
      await clearSavedViews();
      await renderSavedViewsList();
      setSavedViewsStatus('Saved view data purged.');
    } catch (err) {
      console.warn('Purge saved views failed', err);
      setSavedViewsStatus(`Purge failed: ${err?.message || err}`);
    }
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
    await applyImageryKey(input.value);
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
        setChecked(els.showHorizonRelational, false);
      } else if (mode === 'relational') {
        setChecked(els.showRelatedMonuments, false);
        setChecked(els.showAllMonuments, false);
        setChecked(els.showHorizonRelational, false);
      } else if (mode === 'all') {
        setChecked(els.showRelatedMonuments, false);
        setChecked(els.showAllRelational, false);
        setChecked(els.showHorizonRelational, false);
      } else if (mode === 'horizon') {
        setChecked(els.showRelatedMonuments, false);
        setChecked(els.showAllRelational, false);
        setChecked(els.showAllMonuments, false);
      }
    } finally {
      monumentModeSync = false;
    }
  };
  const normalizeExclusiveMonumentMode = () => {
    if (els.showAllMonuments?.checked) enforceExclusiveMonumentMode('all');
    else if (els.showHorizonRelational?.checked) enforceExclusiveMonumentMode('horizon');
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

  if (els.showHorizonRelational) {
    showHorizonRelational = !!els.showHorizonRelational.checked;
    els.showHorizonRelational.addEventListener('change', async () => {
      showHorizonRelational = !!els.showHorizonRelational.checked;
      if (!cameraState.observerMode) {
        showHorizonRelational = false;
        els.showHorizonRelational.checked = false;
        return;
      }
      if (showHorizonRelational) enforceExclusiveMonumentMode('horizon');
      if (!currentPatch) return;
      if (!showHorizonRelational) {
        horizonLoadToken++;
        clearHorizonRelationalMarkers();
        hideHorizonCalcPanelUnlessViewshed();
        updateLegendPanel();
        return;
      }
      await loadHorizonRelationalMarkers();
    });
  }

  if (els.horizonFloatM) {
    horizonFloatM = Math.max(0, Number(els.horizonFloatM.value) || 300);
    els.horizonFloatM.addEventListener('change', async () => {
      horizonFloatM = Math.max(0, Number(els.horizonFloatM.value) || 300);
      if (!showHorizonRelational || !currentPatch) return;
      await loadHorizonRelationalMarkers();
    });
  }

  if (els.horizonAzCluster) {
    horizonAzClusterDeg = Math.max(0.05, Number(els.horizonAzCluster.value) || 0.4);
    els.horizonAzCluster.addEventListener('change', async () => {
      horizonAzClusterDeg = Math.max(0.05, Number(els.horizonAzCluster.value) || 0.4);
      if (!showHorizonRelational || !currentPatch) return;
      await loadHorizonRelationalMarkers();
    });
  }

  if (els.horizonResKey) horizonResKey = normalizeHorizonResKey(els.horizonResKey.value);
  els.horizonResKey?.addEventListener('change', () => {
    horizonResKey = normalizeHorizonResKey(els.horizonResKey.value);
    if (cameraState.observerMode && currentPatch) scheduleViewshedHorizonBackground(horizonResKey, true);
  });
  els.fpvHorizonHires?.addEventListener('click', () => runHorizonDrawAtRes('hires'));
  els.fpvHorizonSuper?.addEventListener('click', () => runHorizonDrawAtRes('super'));

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
      if (els.showNotes.checked) {
        datetimePanelOpen = false;
        updateDatetimePanel();
      }
      updateNotesPanel();
      refreshStagePanelToolbar();
    });
  }
  
  // Display Options toolbar (top-right) mirrors sidebar toggles; astronomy toolbar shares data-toggle wiring.
  const displayToolbar = document.getElementById('display-toolbar');
  const toolbarToggleRoots = [displayToolbar, els.astronomyToolbar].filter(Boolean);
  if (toolbarToggleRoots.length) {
    const btns = toolbarToggleRoots.flatMap((root) => Array.from(root.querySelectorAll('button[data-toggle]')));
    const refresh = () => {
      refreshStagePanelToolbar();
      refreshSurfaceToolbar();
      for (const b of btns) {
        const targetId = b.getAttribute('data-toggle');
        if (targetId === 'show-notes') continue;
        const input = targetId ? document.getElementById(targetId) : null;
        const on = !!input?.checked;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    };
    for (const b of btns) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = b.getAttribute('data-toggle');
        if (targetId === 'show-notes') {
          toggleStagePanel('notes');
          refresh();
          return;
        }
        if (targetId === 'astro-show-archaeolines' && !cameraState.observerMode) return;
        if (targetId === 'astro-show-horizon-compass' && !cameraState.observerMode) return;
        if (targetId === 'show-horizon-relational' && !cameraState.observerMode) return;
        const input = targetId ? document.getElementById(targetId) : null;
        if (!input) return;
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        refresh();
      });
    }
    els.toggleSurface?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleSurfaceImagery();
      refresh();
    });
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
    syncViewshedHorizonVisibility();
  });

  function bindDisplayRange(input, key) {
    input?.addEventListener('input', () => {
      displaySettings[key] = Number(input.value);
      applyDisplaySettings();
    });
  }

  function bindTerrainPaintRange(input, key) {
    input?.addEventListener('input', () => {
      terrainPaintSettings[key] = Number(input.value);
      applyDisplaySettings();
    });
  }

  bindTerrainPaintRange(els.paintHeightStrength, 'heightStrength');
  bindTerrainPaintRange(els.paintRelativeHeight, 'relativeHeightStrength');
  bindTerrainPaintRange(els.paintHeightContrast, 'heightContrast');
  bindTerrainPaintRange(els.paintHillshade, 'hillshadeStrength');
  bindTerrainPaintRange(els.paintDistanceStrength, 'distanceStrength');
  bindTerrainPaintRange(els.paintDistanceDesaturate, 'distanceDesaturate');
  bindTerrainPaintRange(els.paintDistanceStart, 'distanceStartM');
  bindTerrainPaintRange(els.paintDistanceEnd, 'distanceEndM');
  els.paintDistanceBands?.addEventListener('change', () => {
    terrainPaintSettings.distanceBands = Boolean(els.paintDistanceBands.checked);
    applyDisplaySettings();
  });

  astronomyOverlay?.bindControls();
  syncTerrainViewAstroUi();

  bindDisplayRange(els.displayBrightness, 'brightness');
  bindDisplayRange(els.displayGamma, 'gamma');
  bindDisplayRange(els.displayHazeStart, 'hazeStartM');
  bindDisplayRange(els.displayHazeStrength, 'hazeStrength');
  bindDisplayRange(els.displayDesaturate, 'desaturateStrength');
  bindDisplayRange(els.displayFadeDistance, 'fadeDistanceM');

  els.observerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await goToObserverLocation();
  });

  document.getElementById('reset-view').addEventListener('click', () => {
    cameraState.pitch = cameraState.observerMode ? 0 : 8;
    cameraState.bearing = 28;
    if (cameraState.observerMode) {
      cameraState.fov = OBSERVER_FOV_DEFAULT;
      updateCamera();
      return;
    }
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
    if (cameraState.observerMode) return;
    if (!currentFocus) return;
    const metersPerPixel = Math.max(0.8, cameraState.distance / 520);
    moveFocus(dy * metersPerPixel, -dx * metersPerPixel);
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (customLabelPickMode) return;
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
      if (cameraState.observerMode) {
        applyObserverFovZoom(scale);
      } else {
        cameraState.distance = Math.max(380, Math.min(6500, cameraState.distance * scale));
        panFocusFromScreenDelta(dx, dy);
      }
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
    if (cameraState.observerMode) {
      applyObserverFovZoom(e.deltaY > 0 ? 1.12 : 0.9);
    } else {
      cameraState.distance = Math.max(380, Math.min(6500, cameraState.distance * (e.deltaY > 0 ? 1.12 : 0.9)));
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
  astronomyOverlay?.syncControls();
  syncImageryRadioButtons();
  refreshSurfaceToolbar();
  if (els.heightSlider) verticalExaggeration = Number(els.heightSlider.value) || 0;
  if (els.heightValue) els.heightValue.textContent = `${verticalExaggeration.toFixed(1)}x`;
  if (els.paintHeightStrength) terrainPaintSettings.heightStrength = Number(els.paintHeightStrength.value);
  if (els.paintRelativeHeight) terrainPaintSettings.relativeHeightStrength = Number(els.paintRelativeHeight.value);
  if (els.paintHeightContrast) terrainPaintSettings.heightContrast = Number(els.paintHeightContrast.value) || terrainPaintSettings.heightContrast;
  if (els.paintHillshade) terrainPaintSettings.hillshadeStrength = Number(els.paintHillshade.value);
  if (els.paintDistanceStrength) terrainPaintSettings.distanceStrength = Number(els.paintDistanceStrength.value);
  if (els.paintDistanceDesaturate) terrainPaintSettings.distanceDesaturate = Number(els.paintDistanceDesaturate.value);
  if (els.paintDistanceStart) terrainPaintSettings.distanceStartM = Number(els.paintDistanceStart.value) || terrainPaintSettings.distanceStartM;
  if (els.paintDistanceEnd) terrainPaintSettings.distanceEndM = Number(els.paintDistanceEnd.value) || terrainPaintSettings.distanceEndM;
  terrainPaintSettings.distanceBands = els.paintDistanceBands ? Boolean(els.paintDistanceBands.checked) : false;
  if (els.displayBrightness) displaySettings.brightness = Number(els.displayBrightness.value) || displaySettings.brightness;
  if (els.displayGamma) displaySettings.gamma = Number(els.displayGamma.value) || displaySettings.gamma;
  if (els.displayHazeStart) displaySettings.hazeStartM = Number(els.displayHazeStart.value) || displaySettings.hazeStartM;
  if (els.displayHazeStrength) displaySettings.hazeStrength = Number(els.displayHazeStrength.value);
  if (els.displayDesaturate) displaySettings.desaturateStrength = Number(els.displayDesaturate.value);
  if (els.displayFadeDistance) displaySettings.fadeDistanceM = Number(els.displayFadeDistance.value) || displaySettings.fadeDistanceM;
  applyDisplaySettings();
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
  initConfigInnerSections();
  initPresetsUI();
  renderSavedViewsList();
  window.setTimeout(() => {
    if (!window.location.hash) return;
    restoreViewFromHash();
  }, 250);

  document.addEventListener('click', (e) => {
    const configSectionToggle = e.target.closest('.config-section-toggle');
    if (configSectionToggle) {
      const section = configSectionToggle.closest('.panel.config-inner');
      const body = section?.querySelector('.config-section-body');
      if (body) setConfigSectionOpen(section, body.classList.contains('hidden'));
      return;
    }
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
