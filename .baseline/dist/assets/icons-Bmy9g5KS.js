// SVG icon factory with true 3D specular emboss filters.
// injectSprite() auto-runs on DOMContentLoaded. icon() returns SVGElement — no innerHTML ever.

const NS = 'http://www.w3.org/2000/svg'

const GOLD_NAMES = new Set([
  'rocket', 'vault', 'diamond', 'bolt', 'check-seal', 'star',
  'chart-pulse', 'spark', 'gear-luxe', 'dot-gold',
])

const ICONS = {
  rocket: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 2 L8.5 9 H10.5 V15 H13.5 V9 H15.5 Z' },
      { d: 'M8.5 9 L4 15 L8.5 13.5 Z' },
      { d: 'M15.5 9 L20 15 L15.5 13.5 Z' },
      { d: 'M10.5 15 L11 21 L12 18 L13 21 L13.5 15 Z', material: 'ruby' },
    ],
  },
  vault: {
    viewBox: '0 0 24 24',
    paths: [
      { type: 'circle', cx: '12', cy: '12', r: '9', fill: 'none', stroke: 'inherit', strokeWidth: '1.5' },
      { type: 'circle', cx: '12', cy: '12', r: '3', fill: 'none', stroke: 'inherit', strokeWidth: '1.5' },
      { type: 'line', x1: '12', y1: '3', x2: '12', y2: '9', stroke: 'inherit', strokeWidth: '1.5' },
      { type: 'line', x1: '12', y1: '15', x2: '12', y2: '21', stroke: 'inherit', strokeWidth: '1.5' },
      { type: 'line', x1: '3', y1: '12', x2: '9', y2: '12', stroke: 'inherit', strokeWidth: '1.5' },
      { type: 'line', x1: '15', y1: '12', x2: '21', y2: '12', stroke: 'inherit', strokeWidth: '1.5' },
      { type: 'circle', cx: '18', cy: '12', r: '1' },
    ],
  },
  diamond: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 2 L22 12 L12 22 L2 12 Z' },
      { d: 'M12 2 L16 9 L12 11 L8 9 Z', fill: 'rgba(255,255,255,0.2)' },
      { d: 'M12 22 L16 15 L12 13 L8 15 Z', fill: 'rgba(0,0,0,0.15)' },
    ],
  },
  flame: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 2 C10 7 7 10 7 14 C7 18 9.5 22 12 22 C14.5 22 17 18 17 14 C17 10.5 15 8 13.5 6 C13.5 9.5 12.5 11.5 12 13 C11.5 11 11 8 12 2 Z' },
      { d: 'M12 10 C11 12 10.5 13.5 10.5 15 C10.5 17 11 18.5 12 18.5 C13 18.5 13.5 17 13.5 15 C13.5 13.5 13 12 12 10 Z', fill: 'rgba(255,180,50,0.5)' },
    ],
  },
  bolt: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M13 2 L5 14 H11 L11 22 L19 10 H13 Z' },
    ],
  },
  'check-seal': {
    viewBox: '0 0 24 24',
    paths: [
      { type: 'circle', cx: '12', cy: '12', r: '9', fill: 'none', stroke: 'inherit', strokeWidth: '1.5' },
      { d: 'M7 12 L10.5 15.5 L17 8.5', fill: 'none', stroke: 'inherit', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
    ],
  },
  cross: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M5 5 L19 19', fill: 'none', stroke: 'inherit', strokeWidth: '2', strokeLinecap: 'round' },
      { d: 'M19 5 L5 19', fill: 'none', stroke: 'inherit', strokeWidth: '2', strokeLinecap: 'round' },
    ],
  },
  star: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 2 L14.9 9.5 L22.5 9.5 L16.7 14.2 L18.9 22 L12 17.5 L5.1 22 L7.3 14.2 L1.5 9.5 L9.1 9.5 Z' },
    ],
  },
  'chart-pulse': {
    viewBox: '0 0 24 24',
    paths: [
      { type: 'polyline', points: '3 17 7 8 11 12 15 5 19 11 22 11', fill: 'none', stroke: 'inherit', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
    ],
  },
  target: {
    viewBox: '0 0 24 24',
    paths: [
      { type: 'circle', cx: '12', cy: '12', r: '10', fill: 'none', stroke: 'inherit', strokeWidth: '1.2' },
      { type: 'circle', cx: '12', cy: '12', r: '6', fill: 'none', stroke: 'inherit', strokeWidth: '1.2' },
      { type: 'circle', cx: '12', cy: '12', r: '2.5' },
    ],
  },
  spark: {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12 2 L13.8 10.2 L22 12 L13.8 13.8 L12 22 L10.2 13.8 L2 12 L10.2 10.2 Z' },
    ],
  },
  'dot-gold': {
    viewBox: '0 0 24 24',
    paths: [
      { type: 'circle', cx: '12', cy: '12', r: '5' },
    ],
  },
  'gear-luxe': {
    viewBox: '0 0 24 24',
    paths: [
      { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', fill: 'none', stroke: 'inherit', strokeWidth: '1.5' },
      { type: 'circle', cx: '12', cy: '12', r: '3', fill: 'none', stroke: 'inherit', strokeWidth: '1.5' },
    ],
  },
}

export function injectSprite() {
  if (document.getElementById('nexus-icon-sprite')) return

  const svg = document.createElementNS(NS, 'svg')
  svg.id = 'nexus-icon-sprite'
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'

  const defs = document.createElementNS(NS, 'defs')

  // ── GOLD METAL GRADIENT (5-stop) ──
  const gradGold = document.createElementNS(NS, 'linearGradient')
  gradGold.id = 'grad-gold-metal'
  gradGold.setAttribute('x1', '0'); gradGold.setAttribute('y1', '0')
  gradGold.setAttribute('x2', '0'); gradGold.setAttribute('y2', '1')
  ;[['0%','#FFEAB0'],['25%','#F4D77A'],['55%','#D4AF37'],['85%','#9E7A1F'],['100%','#6F540D']].forEach(([offset, color]) => {
    const s = document.createElementNS(NS, 'stop')
    s.setAttribute('offset', offset); s.setAttribute('stop-color', color)
    gradGold.appendChild(s)
  })

  // ── RUBY FIRE GRADIENT (radial) ──
  const gradRuby = document.createElementNS(NS, 'radialGradient')
  gradRuby.id = 'grad-ruby-3d'
  gradRuby.setAttribute('cx', '35%'); gradRuby.setAttribute('cy', '30%'); gradRuby.setAttribute('r', '75%')
  ;[['0%','#FF6B4A'],['40%','#FF1E00'],['80%','#A50F00'],['100%','#3E0500']].forEach(([offset, color]) => {
    const s = document.createElementNS(NS, 'stop')
    s.setAttribute('offset', offset); s.setAttribute('stop-color', color)
    gradRuby.appendChild(s)
  })

  // ── GOLD 3D FILTER (outer shadow + bevel + specular) ──
  const fxGold = document.createElementNS(NS, 'filter')
  fxGold.id = 'fx-gold-3d'
  fxGold.setAttribute('x', '-30%'); fxGold.setAttribute('y', '-30%')
  fxGold.setAttribute('width', '160%'); fxGold.setAttribute('height', '160%')

  const _mk = (tag, attrs) => {
    const el = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    return el
  }

  // Outer shadow
  fxGold.appendChild(_mk('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '1.5', result: 'sb' }))
  fxGold.appendChild(_mk('feOffset', { in: 'sb', dx: '0', dy: '2', result: 'so' }))
  fxGold.appendChild(_mk('feFlood', { 'flood-color': '#000', 'flood-opacity': '0.55', result: 'sc' }))
  fxGold.appendChild(_mk('feComposite', { in: 'sc', in2: 'so', operator: 'in', result: 'outer-shadow' }))
  // Bevel highlight
  fxGold.appendChild(_mk('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: '0.6', result: 'inset' }))
  fxGold.appendChild(_mk('feGaussianBlur', { in: 'inset', stdDeviation: '0.8', result: 'ib' }))
  fxGold.appendChild(_mk('feOffset', { in: 'ib', dx: '0', dy: '-0.5', result: 'io' }))
  fxGold.appendChild(_mk('feComposite', { in: 'SourceAlpha', in2: 'io', operator: 'out', result: 'bevel-shape' }))
  fxGold.appendChild(_mk('feFlood', { 'flood-color': '#FFEAB0', 'flood-opacity': '0.85', result: 'bc' }))
  fxGold.appendChild(_mk('feComposite', { in: 'bc', in2: 'bevel-shape', operator: 'in', result: 'bevel' }))
  // Specular highlight
  const spec1 = _mk('feSpecularLighting', { in: 'SourceAlpha', surfaceScale: '3', specularConstant: '1.1', specularExponent: '22', 'lighting-color': '#FFF8DC', result: 'spec' })
  spec1.appendChild(_mk('feDistantLight', { azimuth: '225', elevation: '45' }))
  fxGold.appendChild(spec1)
  fxGold.appendChild(_mk('feComposite', { in: 'spec', in2: 'SourceAlpha', operator: 'in', result: 'spec-clip' }))
  const merge1 = document.createElementNS(NS, 'feMerge')
  ;['outer-shadow', 'SourceGraphic', 'bevel', 'spec-clip'].forEach(n => {
    const node = document.createElementNS(NS, 'feMergeNode')
    node.setAttribute('in', n); merge1.appendChild(node)
  })
  fxGold.appendChild(merge1)

  // ── RUBY 3D FILTER (outer shadow + inner glow + specular) ──
  const fxRuby = document.createElementNS(NS, 'filter')
  fxRuby.id = 'fx-ruby-3d'
  fxRuby.setAttribute('x', '-30%'); fxRuby.setAttribute('y', '-30%')
  fxRuby.setAttribute('width', '160%'); fxRuby.setAttribute('height', '160%')

  fxRuby.appendChild(_mk('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '1.5', result: 'sb' }))
  fxRuby.appendChild(_mk('feOffset', { in: 'sb', dx: '0', dy: '2', result: 'so' }))
  fxRuby.appendChild(_mk('feFlood', { 'flood-color': '#000', 'flood-opacity': '0.6', result: 'sc' }))
  fxRuby.appendChild(_mk('feComposite', { in: 'sc', in2: 'so', operator: 'in', result: 'outer-shadow' }))
  // Inner glow
  fxRuby.appendChild(_mk('feFlood', { 'flood-color': '#FF1E00', 'flood-opacity': '0.9', result: 'gc' }))
  fxRuby.appendChild(_mk('feComposite', { in: 'gc', in2: 'SourceAlpha', operator: 'in', result: 'inner-glow' }))
  fxRuby.appendChild(_mk('feGaussianBlur', { in: 'inner-glow', stdDeviation: '1.5', result: 'inner-glow-blur' }))
  // Specular
  const spec2 = _mk('feSpecularLighting', { in: 'SourceAlpha', surfaceScale: '2.5', specularConstant: '1.3', specularExponent: '28', 'lighting-color': '#FFD0B0', result: 'spec' })
  spec2.appendChild(_mk('feDistantLight', { azimuth: '225', elevation: '55' }))
  fxRuby.appendChild(spec2)
  fxRuby.appendChild(_mk('feComposite', { in: 'spec', in2: 'SourceAlpha', operator: 'in', result: 'spec-clip' }))
  const merge2 = document.createElementNS(NS, 'feMerge')
  ;['outer-shadow', 'inner-glow-blur', 'SourceGraphic', 'spec-clip'].forEach(n => {
    const node = document.createElementNS(NS, 'feMergeNode')
    node.setAttribute('in', n); merge2.appendChild(node)
  })
  fxRuby.appendChild(merge2)

  // Legacy simple gradients kept for backward compat (cursor.js fallback + existing dashboard SVGs)
  const gradGoldSimple = document.createElementNS(NS, 'linearGradient')
  gradGoldSimple.id = 'grad-gold'
  gradGoldSimple.setAttribute('x1', '0%'); gradGoldSimple.setAttribute('y1', '0%')
  gradGoldSimple.setAttribute('x2', '0%'); gradGoldSimple.setAttribute('y2', '100%')
  ;[['0%','#F4D77A'],['100%','#B8941F']].forEach(([offset, color]) => {
    const s = document.createElementNS(NS, 'stop')
    s.setAttribute('offset', offset); s.setAttribute('stop-color', color)
    gradGoldSimple.appendChild(s)
  })

  const gradFire = document.createElementNS(NS, 'linearGradient')
  gradFire.id = 'grad-fire'
  gradFire.setAttribute('x1', '0%'); gradFire.setAttribute('y1', '0%')
  gradFire.setAttribute('x2', '0%'); gradFire.setAttribute('y2', '100%')
  ;[['0%','#FF6B35'],['100%','#FF1E00']].forEach(([offset, color]) => {
    const s = document.createElementNS(NS, 'stop')
    s.setAttribute('offset', offset); s.setAttribute('stop-color', color)
    gradFire.appendChild(s)
  })

  defs.appendChild(gradGold)
  defs.appendChild(gradRuby)
  defs.appendChild(fxGold)
  defs.appendChild(fxRuby)
  defs.appendChild(gradGoldSimple)
  defs.appendChild(gradFire)
  svg.appendChild(defs)
  document.body.insertBefore(svg, document.body.firstChild)
}

function _makeEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) el.setAttribute(k, v)
  }
  return el
}

const _warnedIcons = new Set()

export function icon(name, { size = 24, className = '', material } = {}) {
  const data = ICONS[name]
  if (!data) {
    if (!_warnedIcons.has(name)) {
      console.warn(`[icons] unknown icon: "${name}", using fallback`)
      _warnedIcons.add(name)
    }
    return icon('dot-gold', { size, className })
  }

  const mat = material || (GOLD_NAMES.has(name) ? 'gold' : 'ruby')
  const gradId = mat === 'gold' ? 'grad-gold-metal' : 'grad-ruby-3d'
  const filterId = mat === 'gold' ? 'fx-gold-3d' : 'fx-ruby-3d'
  const strokeColor = mat === 'gold' ? 'url(#grad-gold-metal)' : 'url(#grad-ruby-3d)'

  const svg = _makeEl('svg', {
    viewBox: data.viewBox || '0 0 24 24',
    width: String(size),
    height: String(size),
    'aria-hidden': 'true',
    focusable: 'false',
    class: `nx-icon${className ? ' ' + className : ''}`,
    filter: `url(#${filterId})`,
  })
  svg.style.cssText = 'display:inline-block;vertical-align:middle;flex-shrink:0;overflow:visible'

  for (const p of data.paths) {
    // Per-path material override
    const pMat = p.material === 'ruby' ? 'ruby' : mat
    const pGrad = pMat === 'ruby' ? 'grad-ruby-3d' : 'grad-gold-metal'
    const pFill = p.fill !== undefined ? p.fill : `url(#${pGrad})`
    const pStroke = (p.stroke === 'inherit') ? `url(#${pGrad})` : p.stroke

    let el
    switch (p.type) {
      case 'circle':
        el = _makeEl('circle', { cx: p.cx, cy: p.cy, r: p.r, fill: pFill, stroke: pStroke, 'stroke-width': p.strokeWidth })
        break
      case 'polyline':
        el = _makeEl('polyline', { points: p.points, fill: p.fill !== undefined ? p.fill : 'none', stroke: pStroke, 'stroke-width': p.strokeWidth, 'stroke-linecap': p.strokeLinecap, 'stroke-linejoin': p.strokeLinejoin })
        break
      case 'line':
        el = _makeEl('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: pStroke, 'stroke-width': p.strokeWidth, 'stroke-linecap': 'round' })
        break
      default:
        el = _makeEl('path', { d: p.d, fill: pFill, stroke: pStroke, 'stroke-width': p.strokeWidth, 'stroke-linecap': p.strokeLinecap, 'stroke-linejoin': p.strokeLinejoin, 'fill-rule': p.fillRule })
    }
    svg.appendChild(el)
  }

  return svg
}

function _injectIconCSS() {
  if (document.getElementById('nexus-icon-styles')) return
  const style = document.createElement('style')
  style.id = 'nexus-icon-styles'
  style.textContent = `.nx-icon{transition:filter .25s,transform .25s;overflow:visible;}.nx-icon:hover,.nx-icon-wrap:hover .nx-icon{transform:scale(1.1);}`
  document.head.appendChild(style)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { injectSprite(); _injectIconCSS() })
} else {
  injectSprite()
  _injectIconCSS()
}
