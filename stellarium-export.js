(function () {
  'use strict';

  const DEFAULT_EXPORT = {
    width: 4096,
    height: 2048,
    slices: 16,
    pitchDeg: 0
  };

  const btn = document.getElementById('export-stellarium');

  function slugify(value) {
    return String(value || 'skyscape-landscape')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'skyscape-landscape';
  }

  function waitFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  function canvasToBlob(canvas, type = 'image/png') {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type });
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create panorama image.')), type);
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setButtonBusy(busy, label = '') {
    if (!btn) return;
    btn.disabled = busy;
    btn.classList.toggle('active', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.setAttribute('data-tip', busy ? (label || 'Exporting Stellarium landscape...') : 'Export Stellarium landscape');
  }

  function makeLandscapeIni(meta) {
    const description = [
      'Rendered transparent-sky landscape exported from Skyscape.',
      'This package intentionally omits horizon.txt; Stellarium uses the alpha channel in horizon_image.png.'
    ].join(' ');

    return `[landscape]
name = ${meta.name}
type = spherical
author = Skyscape
description = ${description}
maptex = horizon_image.png
angle_rotatez = -90

[location]
planet = Earth
latitude = ${meta.lat.toFixed(7)}
longitude = ${meta.lng.toFixed(7)}
altitude = ${Math.round(meta.altitudeM)}
`;
  }

  async function renderTransparentPanorama(runtime, options = {}) {
    const cfg = { ...DEFAULT_EXPORT, ...options };
    const state = runtime.getExportState();
    if (!state.ready) throw new Error('Load a site or View Location before exporting a Stellarium landscape.');

    await runtime.setPanoramaMode(true);
    await waitFrame();

    const THREE = runtime.THREE;
    const renderer = runtime.renderer;
    const scene = runtime.scene;
    const camera = runtime.camera;
    const skyDome = runtime.getSkyDome?.();

    const originalSize = renderer.getSize(new THREE.Vector2());
    const originalPixelRatio = renderer.getPixelRatio();
    const originalBackground = scene.background;
    const originalFog = scene.fog;
    const originalSkyVisible = skyDome ? skyDome.visible : null;
    const originalCamera = {
      fov: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone()
    };
    const clearColor = renderer.getClearColor(new THREE.Color()).clone();
    const clearAlpha = renderer.getClearAlpha();

    const panorama = document.createElement('canvas');
    panorama.width = cfg.width;
    panorama.height = cfg.height;
    const ctx = panorama.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Could not create panorama canvas.');
    ctx.clearRect(0, 0, cfg.width, cfg.height);

    const sliceWidth = Math.ceil(cfg.width / cfg.slices);
    const sliceAspect = sliceWidth / cfg.height;
    const horizontalFovDeg = 360 / cfg.slices;
    const verticalFovDeg = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(horizontalFovDeg) / 2) / sliceAspect)
    );

    runtime.setExternalRenderLock(true);
    try {
      scene.background = null;
      if (skyDome) skyDome.visible = false;
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(1);
      renderer.setSize(sliceWidth, cfg.height, false);

      for (let i = 0; i < cfg.slices; i += 1) {
        const bearing = (i * horizontalFovDeg) + (horizontalFovDeg / 2);
        runtime.setStageStatus?.(`Rendering Stellarium panorama slice ${i + 1} of ${cfg.slices}...`);
        runtime.setExportCameraView({
          bearing,
          pitch: cfg.pitchDeg,
          fov: verticalFovDeg,
          aspect: sliceAspect
        });
        runtime.render();
        await waitFrame();
        ctx.drawImage(renderer.domElement, i * sliceWidth, 0, sliceWidth, cfg.height);
      }
    } finally {
      scene.background = originalBackground;
      scene.fog = originalFog;
      if (skyDome && originalSkyVisible != null) skyDome.visible = originalSkyVisible;
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.setPixelRatio(originalPixelRatio);
      renderer.setSize(originalSize.x, originalSize.y, false);
      camera.fov = originalCamera.fov;
      camera.aspect = originalCamera.aspect;
      camera.near = originalCamera.near;
      camera.far = originalCamera.far;
      camera.position.copy(originalCamera.position);
      camera.quaternion.copy(originalCamera.quaternion);
      camera.updateProjectionMatrix();
      runtime.setExternalRenderLock(false);
      runtime.resize?.();
      runtime.updateCamera?.();
    }

    return canvasToBlob(panorama, 'image/png');
  }

  async function exportStellariumLandscape() {
    const runtime = window.SkyscapeRuntime;
    if (!runtime) throw new Error('Skyscape runtime is not ready.');
    if (!window.JSZip) throw new Error('JSZip is not available; cannot create the Stellarium package.');

    const initialState = runtime.getExportState();
    const name = initialState.title || 'Skyscape Landscape';
    const folderName = slugify(name);

    const horizonImage = await renderTransparentPanorama(runtime);
    const exportState = runtime.getExportState();
    const focus = exportState.focus || initialState.focus || { lat: 0, lng: 0 };
    const altitudeM = Number(exportState.observerTerrainElevationM ?? exportState.baseElevationM ?? 0);
    const zip = new JSZip();
    const folder = zip.folder(folderName);
    folder.file('horizon_image.png', horizonImage);
    folder.file('landscape.ini', makeLandscapeIni({
      name,
      lat: Number(focus.lat) || 0,
      lng: Number(focus.lng) || 0,
      altitudeM
    }));

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, `${folderName}-stellarium.zip`);
  }

  btn?.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!window.SkyscapeRuntime?.isPanoramaView?.()) {
      window.SkyscapeRuntime?.setStageStatus?.('Stellarium export is available in Panorama view only.');
      return;
    }
    try {
      setButtonBusy(true);
      await exportStellariumLandscape();
      window.SkyscapeRuntime?.setStageStatus?.('Exported Stellarium landscape package without horizon.txt.');
    } catch (err) {
      console.error('Stellarium export failed', err);
      window.SkyscapeRuntime?.setStageStatus?.(`Stellarium export failed: ${err?.message || String(err)}`);
      alert(`Stellarium export failed: ${err?.message || String(err)}`);
    } finally {
      setButtonBusy(false);
    }
  });
}());
