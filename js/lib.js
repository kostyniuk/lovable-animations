// Shared scene runner + SVG drawing helpers for every visualization.
//
// A visualization module default-exports:
//   { id, width, height, loop?, build(ctx) }
// `build` is an async function that draws into ctx.root and animates with
// ctx.wait / ctx.animate / ctx.move / ctx.fade. Reset (or loop restart)
// cancels the running build by throwing CANCEL out of any pending await.

const NS = 'http://www.w3.org/2000/svg';
export const CANCEL = Symbol('cancel');

// One color per event family. Keep in sync with --c-* tokens in styles.css.
export const COLORS = {
  user: '#ff8a3d',        // UserMessage
  agent: '#b18cff',       // AgentStart / AgentDone
  iter: '#4d9dff',        // IterationStart / IterationEnd
  thinking: '#8b8b98',    // thinking
  content: '#ececf1',     // content
  tool: '#3ddc97',        // tool_call + Tool* lifecycle
  fork: '#ff4fa3',        // ThreadForkConfig, heads
  compact: '#a3e635',     // PromptCompactionStart / End, summary
  notify: '#22d3ee',      // ExternalAgentNotification
  activation: '#fde047',  // activation signal (not an event)
  revert: '#ef4444',      // Revert, failures
  dim: '#3a3a44',
  line: '#56565f',
  text: '#ececf1',
  muted: '#8b8b98',
  panel: '#131317',
  bg: '#0b0b0d',
};

// Map concrete event names from the article to a color family.
export const EVENT_TYPE = {
  UserMessage: 'user',
  AgentStart: 'agent',
  AgentDone: 'agent',
  IterationStart: 'iter',
  IterationEnd: 'iter',
  thinking: 'thinking',
  content: 'content',
  tool_call: 'tool',
  ToolParametersValidated: 'tool',
  ToolExecutionStart: 'tool',
  ToolExecutionEnd: 'tool',
  ToolApprovalRequired: 'tool',
  ThreadForkConfig: 'fork',
  PromptCompactionStart: 'compact',
  PromptCompactionEnd: 'compact',
  ExternalAgentNotification: 'notify',
  Revert: 'revert',
};

export const colorOf = (typeOrName) =>
  COLORS[typeOrName] || COLORS[EVENT_TYPE[typeOrName]] || COLORS.content;

// ---------- easing ----------
export const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  back: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

// ---------- raw SVG helpers ----------
export function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  if (parent) parent.appendChild(node);
  return node;
}

// Position a <g> via translate and remember it so move() can tween from it.
export function setPos(node, x, y) {
  node._x = x;
  node._y = y;
  node.setAttribute('transform', `translate(${x},${y})`);
  return node;
}
export const getPos = (node) => ({ x: node._x ?? 0, y: node._y ?? 0 });

// A rounded "event" pill: colored left stripe, mono label. Origin = top-left.
// Returns a <g>; use setPos/ctx.move to place it.
export function eventPill(parent, { x = 0, y = 0, name, type, label, w = 150, h = 26, partial = false } = {}) {
  const c = colorOf(type || name);
  const g = el('g', { class: 'event' }, parent);
  setPos(g, x, y);
  el('rect', {
    width: w, height: h, rx: 6,
    fill: partial ? 'transparent' : COLORS.panel,
    stroke: c, 'stroke-width': 1.25,
    'stroke-dasharray': partial ? '4 3' : null,
    'stroke-opacity': partial ? 0.9 : 0.55,
  }, g);
  if (!partial) el('rect', { width: 4, height: h, rx: 2, fill: c }, g);
  el('text', {
    x: partial ? 10 : 12, y: h / 2 + 4, class: 'mono', 'font-size': 11,
    fill: partial ? c : COLORS.text, text: label ?? name,
  }, g);
  g._w = w;
  g._h = h;
  g._color = c;
  return g;
}

// A labelled box (agent, node, inbox, browser...). Origin = top-left.
export function box(parent, { x = 0, y = 0, w = 160, h = 80, title, color = COLORS.line, fill = COLORS.panel, rx = 10 } = {}) {
  const g = el('g', { class: 'box' }, parent);
  setPos(g, x, y);
  const rect = el('rect', { width: w, height: h, rx, fill, stroke: color, 'stroke-width': 1.25 }, g);
  let label;
  if (title) {
    label = el('text', {
      x: 12, y: -8, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
      'letter-spacing': '0.06em', text: title.toUpperCase(),
    }, g);
  }
  g._rect = rect;
  g._label = label;
  g._w = w;
  g._h = h;
  return g;
}

// Straight or curved arrow. Returns the <path>.
export function arrow(parent, x1, y1, x2, y2, { color = COLORS.line, curve = 0, dash, width = 1.25, head = true } = {}) {
  ensureMarker(parent.ownerSVGElement || parent, color);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx - (dy / len) * curve, cy = my + (dx / len) * curve;
  return el('path', {
    d: curve ? `M${x1},${y1} Q${cx},${cy} ${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`,
    fill: 'none', stroke: color, 'stroke-width': width,
    'stroke-dasharray': dash, 'marker-end': head ? `url(#${markerId(color)})` : null,
  }, parent);
}

const markerId = (color) => 'arrow-' + color.replace(/[^a-z0-9]/gi, '');
function ensureMarker(svg, color) {
  const id = markerId(color);
  if (svg.querySelector('#' + id)) return;
  let defs = svg.querySelector('defs');
  if (!defs) defs = el('defs', {}, svg);
  const m = el('marker', {
    id, viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse',
  }, defs);
  el('path', { d: 'M0,1 L9,5 L0,9 z', fill: color }, m);
}

// Point along an SVG path at fraction t (0..1).
export function pointOnPath(path, t) {
  const L = path.getTotalLength();
  return path.getPointAtLength(L * t);
}

// ---------- Scene runner ----------
export class Scene {
  constructor(figure, def) {
    this.figure = figure;
    this.def = def;
    this.speed = 1;
    this.paused = true;
    this.gen = 0;
    this.visible = false;
    this.userPaused = false;
    this.stepMode = false;
    this.stepResolve = null;
    this._buildDom();
    this._observe();
    this.reset(false);
  }

  _buildDom() {
    const { width, height } = this.def;
    this.figure.classList.add('viz');
    this.stage = document.createElement('div');
    this.stage.className = 'viz-stage';
    this.svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img' });
    this.stage.appendChild(this.svg);

    this.captionEl = document.createElement('div');
    this.captionEl.className = 'viz-caption';

    const bar = document.createElement('div');
    bar.className = 'viz-controls';
    this.playBtn = btn('▶ Play', () => this.togglePlay());
    const stepBtn = btn('Step ⏭', () => this.step());
    const resetBtn = btn('↺ Reset', () => this.reset(true));
    this.extraEl = document.createElement('div');
    this.extraEl.className = 'viz-extra';

    const speedWrap = document.createElement('label');
    speedWrap.className = 'viz-speed';
    const speed = document.createElement('input');
    Object.assign(speed, { type: 'range', min: '0.25', max: '3', step: '0.25', value: '1' });
    const speedVal = document.createElement('span');
    speedVal.textContent = '1×';
    speed.addEventListener('input', () => {
      this.speed = parseFloat(speed.value);
      speedVal.textContent = this.speed + '×';
    });
    speedWrap.append('speed', speed, speedVal);

    bar.append(this.playBtn, stepBtn, resetBtn, this.extraEl, speedWrap);
    this.figure.prepend(this.stage, this.captionEl, bar);
  }

  _observe() {
    const io = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible && !this.userPaused) this.play();
      else if (!this.visible) this.pause();
    }, { threshold: 0.35 });
    io.observe(this.figure);
  }

  togglePlay() {
    if (this.paused || this.stepMode) {
      this.userPaused = false;
      this.stepMode = false;
      this.play();
    } else {
      this.userPaused = true;
      this.pause();
    }
  }
  play() {
    this.paused = false;
    this.playBtn.textContent = '❚❚ Pause';
    if (this.stepResolve) { const r = this.stepResolve; this.stepResolve = null; r(); }
  }
  pause() {
    this.paused = true;
    this.playBtn.textContent = '▶ Play';
  }
  // Step mode: run until the next ctx.beat(), then hold.
  step() {
    this.userPaused = true;
    this.stepMode = true;
    this.paused = false;
    this.playBtn.textContent = '▶ Play';
    if (this.stepResolve) { const r = this.stepResolve; this.stepResolve = null; r(); }
  }

  reset(userInitiated) {
    this.gen++;
    this.stepResolve = null;
    this.svg.innerHTML = '';
    this.extraEl.innerHTML = '';
    this.captionEl.textContent = '';
    if (userInitiated && this.stepMode) this.paused = true;
    const gen = this.gen;
    const ctx = this._ctx(gen);
    Promise.resolve()
      .then(() => this.def.build(ctx))
      .then(async () => {
        if (gen !== this.gen) return;
        if (this.def.loop === false) return;
        await ctx.wait(2200);
        if (gen === this.gen) this.reset(false);
      })
      .catch((e) => { if (e !== CANCEL) console.error(e); });
  }

  _ctx(gen) {
    const scene = this;
    const root = el('g', {}, this.svg);
    const alive = () => { if (gen !== scene.gen) throw CANCEL; };

    // Frame loop that only advances while playing, scaled by speed.
    const frames = (duration, onFrame) => new Promise((resolve, reject) => {
      let elapsed = 0;
      let last = performance.now();
      const tick = (now) => {
        if (gen !== scene.gen) return reject(CANCEL);
        const dt = now - last;
        last = now;
        if (!scene.paused) elapsed += dt * scene.speed;
        const t = duration <= 0 ? 1 : Math.min(1, elapsed / duration);
        onFrame(t);
        if (t >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const ctx = {
      svg: this.svg,
      root,
      W: this.def.width,
      H: this.def.height,
      COLORS,
      el: (tag, attrs, parent = root) => el(tag, attrs, parent),
      eventPill: (opts, parent = root) => eventPill(parent, opts),
      box: (opts, parent = root) => box(parent, opts),
      arrow: (x1, y1, x2, y2, opts, parent = root) => arrow(parent, x1, y1, x2, y2, opts),
      setPos,
      getPos,
      pointOnPath,
      ease,
      colorOf,

      get alive() { return gen === scene.gen; },

      // Speed- and pause-aware delay.
      wait: (ms) => frames(ms, () => {}),

      // Generic tween: onUpdate receives eased t in [0,1].
      animate: (ms, onUpdate, easing = ease.inOut) =>
        frames(ms, (t) => onUpdate(easing(t))),

      // Tween a <g> positioned with setPos to (x, y).
      move: (node, x, y, ms = 600, easing = ease.inOut) => {
        const { x: x0, y: y0 } = getPos(node);
        return frames(ms, (t) => {
          const k = easing(t);
          setPos(node, x0 + (x - x0) * k, y0 + (y - y0) * k);
        });
      },

      // Move a <g> along a path (its origin rides the path).
      along: (node, path, ms = 800, easing = ease.inOut) =>
        frames(ms, (t) => {
          const p = pointOnPath(path, easing(t));
          setPos(node, p.x, p.y);
        }),

      fade: (node, to, ms = 300) => {
        const from = parseFloat(node.getAttribute('opacity') ?? '1');
        return frames(ms, (t) => node.setAttribute('opacity', from + (to - from) * ease.inOut(t)));
      },

      // Reveal a path by stroke-dashoffset.
      draw: (path, ms = 500) => {
        const L = path.getTotalLength();
        const dash = path.getAttribute('stroke-dasharray');
        path.setAttribute('stroke-dasharray', `${L} ${L}`);
        path.setAttribute('stroke-dashoffset', L);
        return frames(ms, (t) => path.setAttribute('stroke-dashoffset', L * (1 - ease.inOut(t))))
          .then(() => {
            if (dash) path.setAttribute('stroke-dasharray', dash);
            else path.removeAttribute('stroke-dasharray');
            path.removeAttribute('stroke-dashoffset');
          });
      },

      // Expanding ring at (x, y): used for activations and "something happened".
      pulse: async (x, y, color = COLORS.activation, r = 22, ms = 700) => {
        const c = el('circle', { cx: x, cy: y, r: 2, fill: 'none', stroke: color, 'stroke-width': 2 }, root);
        await frames(ms, (t) => {
          c.setAttribute('r', 2 + r * ease.out(t));
          c.setAttribute('opacity', 1 - t);
        });
        c.remove();
      },

      // Narration line under the stage.
      caption: (html) => { alive(); scene.captionEl.innerHTML = html; },

      // A narrative checkpoint: sets the caption, holds in step mode,
      // then lingers `hold` ms so the reader can take it in.
      beat: async (html, hold = 900) => {
        alive();
        scene.captionEl.innerHTML = html;
        if (scene.stepMode) {
          scene.paused = true;
          await new Promise((r) => { scene.stepResolve = r; });
          alive();
        }
        await ctx.wait(hold);
      },

      // Extra interactive button in the control bar (cleared on reset).
      button: (label, onClick, { title } = {}) => {
        const b = btn(label, () => { if (gen === scene.gen) onClick(); });
        b.classList.add('viz-btn-accent');
        if (title) b.title = title;
        scene.extraEl.appendChild(b);
        return b;
      },

      // Run fn in the background without awaiting; swallows CANCEL.
      spawn: (fn) => { Promise.resolve().then(fn).catch((e) => { if (e !== CANCEL) console.error(e); }); },
    };
    return ctx;
  }
}

function btn(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'viz-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function mount(selector, def) {
  const fig = document.querySelector(selector);
  if (!fig) return console.warn('missing figure', selector);
  return new Scene(fig, def);
}
