/* MegIcon — geometric icon library for monument types.
   - Shapes: circle / square / triangle
   - No overlay by default (icons are color-splits of the base shape)
   - White outline like map markers
   - Fill patterns: solid, split-lr, split-tb, quad

   Usage:
     MegIcon.svgForMonumentClass('Megalithic tomb - passage tomb', { basePath: './megicon/' })
*/
(function () {
  'use strict';

  const BUILTIN_OVERRIDES = {
    'Megalithic tomb - passage tomb': { shape: 'circle', fill: 'solid', a: '#ef4444', overlay: 'none' },
    'Megalithic tomb - wedge tomb': { shape: 'circle', fill: 'solid', a: '#ec4899', overlay: 'none' },
    'Megalithic tomb - court tomb': { shape: 'circle', fill: 'solid', a: '#eab308', overlay: 'none' },
    'Megalithic tomb - portal tomb': { shape: 'circle', fill: 'solid', a: '#a855f7', overlay: 'none' },
    'Megalithic tomb - unclassified': { shape: 'circle', fill: 'split-lr', a: '#84cc16', b: '#22c55e', overlay: 'none' },

    'Barrow - mound barrow': { shape: 'triangle', fill: 'solid', a: '#60a5fa', overlay: 'none' },
    'Barrow - bowl-barrow': { shape: 'triangle', fill: 'split-lr', a: '#fb7185', b: '#f97316', overlay: 'none' },
    'Barrow - ring-barrow': { shape: 'triangle', fill: 'split-tb', a: '#34d399', b: '#22c55e', overlay: 'none' },
    'Barrow - unclassified': { shape: 'triangle', fill: 'solid', a: '#a78bfa', overlay: 'none' },

    'Cairn - unclassified': { shape: 'square', fill: 'solid', a: '#22c55e', overlay: 'none' },
    Cursus: { shape: 'square', fill: 'split-lr', a: '#94a3b8', b: '#64748b', overlay: 'none' },
    Henge: { shape: 'square', fill: 'solid', a: '#f97316', overlay: 'none' },
    'Rock art': { shape: 'square', fill: 'solid', a: '#8b5cf6', overlay: 'none' },

    'Stone circle': { shape: 'square', fill: 'solid', a: '#3b82f6', overlay: 'none' },
    'Stone circle - five-stone': { shape: 'square', fill: 'split-lr', a: '#3b82f6', b: '#a855f7', overlay: 'none' },
    'Stone circle - embanked': { shape: 'square', fill: 'split-tb', a: '#3b82f6', b: '#22c55e', overlay: 'none' },
    'Embanked enclosure': { shape: 'square', fill: 'split-lr', a: '#22c55e', b: '#84cc16', overlay: 'none' },
    'Ceremonial enclosure': { shape: 'square', fill: 'split-tb', a: '#fde047', b: '#f59e0b', overlay: 'none' },

    'Standing stone': { shape: 'triangle', fill: 'solid', a: '#38bdf8', overlay: 'none' },
    'Standing stone - pair': { shape: 'triangle', fill: 'split-lr', a: '#38bdf8', b: '#f472b6', overlay: 'none' },
    'Stone row': { shape: 'triangle', fill: 'split-tb', a: '#ef4444', b: '#f97316', overlay: 'none' },

    Church: { shape: 'circle', fill: 'solid', a: '#0f172a', overlay: 'none' },
    Cross: { shape: 'diamond', fill: 'solid', a: '#7c3aed', overlay: 'none' },
    'Religious house': { shape: 'circle', fill: 'quad', a: '#0f172a', b: '#334155', c: '#0ea5e9', d: '#38bdf8', overlay: 'none' }
  };

  const BASE_SHAPES = ['circle', 'square', 'triangle', 'diamond'];

  const FAMILY_RULES = [
    { test: (s) => s.startsWith('Megalithic tomb'), shape: 'circle' },
    { test: (s) => s.startsWith('Barrow'), shape: 'triangle' },
    { test: (s) => s.startsWith('Cairn'), shape: 'square' },
    { test: (s) => s.startsWith('Castle'), shape: 'square' },
    { test: (s) => s.startsWith('Tomb'), shape: 'circle' },
    { test: (s) => s === 'Cross' || s.startsWith('Cross -') || s.startsWith('Cross-inscribed') || s.startsWith('Cross inscribed'), shape: 'diamond' }
  ];

  function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 100) / 100;
    l = clamp(l, 0, 100) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (0 <= hp && hp < 1) [r, g, b] = [c, x, 0];
    else if (1 <= hp && hp < 2) [r, g, b] = [x, c, 0];
    else if (2 <= hp && hp < 3) [r, g, b] = [0, c, x];
    else if (3 <= hp && hp < 4) [r, g, b] = [0, x, c];
    else if (4 <= hp && hp < 5) [r, g, b] = [x, 0, c];
    else if (5 <= hp && hp < 6) [r, g, b] = [c, 0, x];
    const m = l - c / 2;
    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function colorsForSeed(seed, n = 4) {
    const baseHue = seed % 360;
    const hues = [
      baseHue,
      (baseHue + 137) % 360,
      (baseHue + 274) % 360,
      (baseHue + 51) % 360
    ];
    const out = [];
    for (let i = 0; i < n; i++) {
      const h = hues[i % hues.length];
      out.push(hslToHex(h, 78, 48));
    }
    return out;
  }

  function normalizeClassName(s) {
    return String(s ?? '').trim();
  }

  function familyKey(monumentClass) {
    const s = normalizeClassName(monumentClass);
    if (!s) return '';
    if (s.includes(' - ')) return s.split(' - ')[0].trim();
    return s;
  }

  function shapeForFamily(monumentClass) {
    const s = normalizeClassName(monumentClass);
    const fam = familyKey(s);
    for (const rule of FAMILY_RULES) {
      if (rule.test(s) || (fam && rule.test(fam))) return rule.shape || 'circle';
    }
    const seed = fnv1a32(fam || s || 'default');
    return BASE_SHAPES[seed % BASE_SHAPES.length] || 'circle';
  }

  function specFromRules(monumentClass) {
    const s = normalizeClassName(monumentClass);
    const fam = familyKey(s);
    let base = { shape: shapeForFamily(s), fill: 'solid', overlay: 'none' };
    const seed = fnv1a32(s || fam || 'default');
    const [a, b, c, d] = colorsForSeed(seed, 4);

    let fill = 'solid';
    const r = seed % 7;
    fill = (r === 0) ? 'split-lr'
      : (r === 1) ? 'split-tb'
      : (r === 2) ? 'quad'
      : (r === 3) ? 'split-lr'
      : (r === 4) ? 'solid'
      : (r === 5) ? 'split-tb'
      : 'solid';
    return { ...base, fill, a, b, c, d };
  }

  async function loadJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to load ' + url);
    return await res.json();
  }

  let explicitMap = null;
  async function ensureMapLoaded(basePath = './') {
    if (explicitMap) return explicitMap;
    try {
      const loaded = await loadJson(basePath.replace(/\/?$/, '/') + 'monument-icon-map.json');
      explicitMap = { ...BUILTIN_OVERRIDES, ...(loaded || {}) };
      return explicitMap;
    } catch (_) {
      explicitMap = { ...BUILTIN_OVERRIDES };
      return explicitMap;
    }
  }

  function mergeSpec(base, over) {
    if (!over) return base;
    return {
      shape: base.shape,
      fill: over.fill || base.fill,
      a: over.a || base.a,
      b: over.b || base.b,
      c: over.c || base.c,
      d: over.d || base.d,
      overlay: base.overlay,
      rotate: base.rotate
    };
  }

  let idCounter = 0;
  function nextId(prefix = 'meg') {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
  }

  function shapePath(shape) {
    if (shape === 'square') return { kind: 'rect' };
    if (shape === 'triangle') return { kind: 'path', d: 'M12 2 L22 20 L2 20 Z' };
    if (shape === 'diamond') return { kind: 'path', d: 'M12 2 L22 12 L12 22 L2 12 Z' };
    return { kind: 'circle' };
  }

  function svgForSpec(spec, opts = {}) {
    const size = Number(opts.size || 24);
    const stroke = opts.stroke || 'var(--megicon-stroke, #fff)';
    const strokeW = Number(opts.strokeWidth || 2.2);

    const shape = spec.shape || 'circle';
    const fill = spec.fill || 'solid';
    const a = spec.a || '#64748b';
    const b = spec.b || a;
    const c = spec.c || a;
    const d = spec.d || b;
    const overlay = spec.overlay || 'none';
    const rotate = Number(spec.rotate || 0);

    const id = nextId('megicon');
    const maskId = `${id}-mask`;
    const gRotate = rotate ? ` transform=\"rotate(${rotate} 12 12)\"` : '';

    const shp = shapePath(shape);
    const maskShape = (shp.kind === 'rect')
      ? `<rect x=\"2\" y=\"2\" width=\"20\" height=\"20\" rx=\"3\" ry=\"3\" fill=\"#fff\" />`
      : (shp.kind === 'circle')
        ? `<circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"#fff\" />`
        : `<path d=\"${shp.d}\" fill=\"#fff\" />`;

    const outline = (shp.kind === 'rect')
      ? `<rect x=\"2\" y=\"2\" width=\"20\" height=\"20\" rx=\"3\" ry=\"3\" fill=\"none\" stroke=\"${stroke}\" stroke-width=\"${strokeW}\" />`
      : (shp.kind === 'circle')
        ? `<circle cx=\"12\" cy=\"12\" r=\"10\" fill=\"none\" stroke=\"${stroke}\" stroke-width=\"${strokeW}\" />`
        : `<path d=\"${shp.d}\" fill=\"none\" stroke=\"${stroke}\" stroke-width=\"${strokeW}\" stroke-linejoin=\"round\" />`;

    let fills = '';
    if (fill === 'split-lr') {
      fills = [
        `<rect x=\"0\" y=\"0\" width=\"12\" height=\"24\" fill=\"${a}\" />`,
        `<rect x=\"12\" y=\"0\" width=\"12\" height=\"24\" fill=\"${b}\" />`
      ].join('');
    } else if (fill === 'split-tb') {
      fills = [
        `<rect x=\"0\" y=\"0\" width=\"24\" height=\"12\" fill=\"${a}\" />`,
        `<rect x=\"0\" y=\"12\" width=\"24\" height=\"12\" fill=\"${b}\" />`
      ].join('');
    } else if (fill === 'quad') {
      fills = [
        `<rect x=\"0\" y=\"0\" width=\"12\" height=\"12\" fill=\"${a}\" />`,
        `<rect x=\"12\" y=\"0\" width=\"12\" height=\"12\" fill=\"${b}\" />`,
        `<rect x=\"0\" y=\"12\" width=\"12\" height=\"12\" fill=\"${c}\" />`,
        `<rect x=\"12\" y=\"12\" width=\"12\" height=\"12\" fill=\"${d}\" />`
      ].join('');
    } else {
      fills = `<rect x=\"0\" y=\"0\" width=\"24\" height=\"24\" fill=\"${a}\" />`;
    }

    const plus = (overlay === 'plus')
      ? `<path d=\"M12 7 v10 M7 12 h10\" stroke=\"${stroke}\" stroke-width=\"${Math.max(2.1, strokeW)}\" stroke-linecap=\"round\" />`
      : '';

    return `
<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${size}\" height=\"${size}\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\">
  <defs>
    <mask id=\"${maskId}\">
      <rect x=\"0\" y=\"0\" width=\"24\" height=\"24\" fill=\"#000\" />
      <g${gRotate}>${maskShape}</g>
    </mask>
  </defs>
  <g mask=\"url(#${maskId})\">${fills}</g>
  <g${gRotate}>
    ${outline}
    ${plus}
  </g>
</svg>`.trim();
  }

  async function getSpecForMonumentClass(monumentClass, basePath = './') {
    const key = normalizeClassName(monumentClass);
    const base = specFromRules(key);
    try {
      const m = await ensureMapLoaded(basePath);
      const over = m && m[key] ? m[key] : null;
      return mergeSpec(base, over);
    } catch (_) {
      const over = BUILTIN_OVERRIDES[key] || null;
      return mergeSpec(base, over);
    }
  }

  async function svgForMonumentClass(monumentClass, opts = {}) {
    const spec = await getSpecForMonumentClass(monumentClass, opts.basePath || './');
    return svgForSpec(spec, opts);
  }

  window.MegIcon = {
    ensureMapLoaded,
    getSpecForMonumentClass,
    svgForSpec,
    svgForMonumentClass
  };
})();

