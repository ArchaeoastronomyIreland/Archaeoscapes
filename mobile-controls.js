(function () {
  'use strict';

  function bindContinuousActionButtons(container, options = {}) {
    if (!container || typeof options.onAction !== 'function') return () => {};
    let active = null;

    const stop = () => {
      if (!active) return;
      cancelAnimationFrame(active.raf);
      active.button.classList.remove(options.activeClass || 'is-held');
      if (typeof options.onStop === 'function') options.onStop(active.action, active.button);
      active = null;
    };

    const tick = (now) => {
      if (!active) return;
      const dt = (now - active.lastTime) / 1000;
      const held = (now - active.startTime) / 1000;
      active.lastTime = now;
      options.onAction(active.action, dt, held, active.button);
      active.raf = requestAnimationFrame(tick);
    };

    const onPointerDown = (e) => {
      const button = e.target.closest('button[data-action]');
      if (!button || !container.contains(button)) return;
      e.preventDefault();
      e.stopPropagation();
      stop();
      const action = button.getAttribute('data-action');
      const now = performance.now();
      active = { button, action, startTime: now, lastTime: now, raf: 0 };
      button.classList.add(options.activeClass || 'is-held');
      try { button.setPointerCapture(e.pointerId); } catch (_) {}
      if (typeof options.onStart === 'function') options.onStart(action, button);
      options.onAction(action, 1 / 60, 0, button);
      active.raf = requestAnimationFrame(tick);
    };

    container.addEventListener('pointerdown', onPointerDown);
    ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture'].forEach((eventName) => {
      container.addEventListener(eventName, stop);
    });

    return stop;
  }

  window.ArchaeoscapesMobileControls = {
    bindContinuousActionButtons
  };
})();
