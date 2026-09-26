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
  api: '#f0abfc',         // ACP calls, tools, streaming messages (captions)
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

// ---------- identifier highlighting ----------
// Names from the article (events, ACP calls, tools, protocol messages) get a
// weighted, color-coded chip wherever they appear in captions and prose, so
// the narration is easy to scan. Events use their family color; ACP calls,
// tools and streaming messages share one accent.
const API_NAMES = ['SpawnAgent', 'ForkAndSendMessage', 'SendMessage', 'NotifyParents', 'StopAgent',
  'send_message_to_project', 'PartialOpened', 'PartialDelta'];
const NAME_COLOR = {
  ...Object.fromEntries(Object.keys(EVENT_TYPE).map((n) => [n, COLORS[EVENT_TYPE[n]]])),
  ...Object.fromEntries(API_NAMES.map((n) => [n, COLORS.api])),
};
// Plain English words that are also event names only count when already marked up.
const AMBIGUOUS = new Set(['thinking', 'content']);
const NAME_RE = new RegExp(
  '(?<![\\w-])(' + Object.keys(NAME_COLOR).filter((n) => !AMBIGUOUS.has(n))
    .sort((a, b) => b.length - a.length).join('|') + ')(?![\\w-])', 'g');
const SKIP = 'code, .ident, .t, .mono, .step-badge, a';

function identChip(name, color) {
  const chip = document.createElement('span');
  chip.className = 'ident';
  chip.style.setProperty('--c', color);
  chip.textContent = name;
  return chip;
}

// Highlight identifiers inside `root` in place; optionally capitalize the
// first word unless the sentence opens with an identifier.
export function highlight(root, { capitalize = false } = {}) {
  // Existing markup naming an identifier adopts the same look.
  for (const el of root.querySelectorAll('code, .mono')) {
    const color = NAME_COLOR[el.textContent.trim()];
    if (color) { el.classList.add('ident'); el.style.setProperty('--c', color); }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const node of texts) {
    if (node.parentElement.closest(SKIP)) continue;
    const text = node.textContent;
    NAME_RE.lastIndex = 0;
    if (!NAME_RE.test(text)) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    text.replace(NAME_RE, (m, name, i) => {
      frag.append(text.slice(last, i), identChip(name, NAME_COLOR[name]));
      last = i + m.length;
    });
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  if (capitalize) {
    const first = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    }).nextNode();
    if (first && !first.parentElement.closest(SKIP)) {
      first.textContent = first.textContent.replace(/^(\s*)([a-z])/, (_, sp, c) => sp + c.toUpperCase());
    }
  }
}

function setCaption(el, html) {
  el.innerHTML = html;
  highlight(el, { capitalize: true });
}

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
    x: partial ? 10 : 12, y: h / 2, 'dominant-baseline': 'central', class: 'mono', 'font-size': 11,
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
// All timing runs on a per-scene virtual clock. In normal playback it advances
// with real time × speed. To step back, the scene is rebuilt with the same
// random seed and the clock is fast-forwarded event by event to the previous
// beat, replaying the reader's button clicks at the moments they happened.

const DEFAULT_SPEED = 0.6;

// Resolves on the next macrotask (setTimeout(0) clamps to 4ms when nested).
const channel = new MessageChannel();
const taskQueue = [];
channel.port1.onmessage = () => taskQueue.shift()?.();
const nextTask = () => new Promise((r) => { taskQueue.push(r); channel.port2.postMessage(0); });

// Seeded PRNG so a replayed scene makes the same "random" choices.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const formatSpeed = (v) => `${+v.toFixed(2)}×`;

// ---------- step-by-step mode ----------
// Per figure: in "Step by step" a figure never runs on its own. It plays up
// to its next beat and holds; each Next plays exactly one more beat. The
// choice is remembered per figure across visits.
const scenes = [];
const modeKey = (scene) => `viz-step-mode:${scene.figure.id}`;
const loadMode = (scene) => { try { return localStorage.getItem(modeKey(scene)) === '1'; } catch { return false; } };
const saveMode = (scene) => { try { localStorage.setItem(modeKey(scene), scene.manual ? '1' : '0'); } catch { /* private mode */ } };

// ← / → step the figure nearest the middle of the viewport.
function sceneInView() {
  const mid = innerHeight / 2;
  let best = null, bestDist = Infinity;
  for (const s of scenes) {
    const r = s.figure.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const d = Math.abs((r.top + r.bottom) / 2 - mid);
    if (d < bestDist) { best = s; bestDist = d; }
  }
  return best;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const scene = sceneInView();
  if (!scene) return;
  e.preventDefault();
  if (e.key === 'ArrowRight') scene.step();
  else scene.stepBack();
});

export class Scene {
  constructor(figure, def) {
    this.figure = figure;
    this.def = def;
    this.speed = DEFAULT_SPEED;
    this.paused = true;
    this.gen = 0;
    this.visible = false;
    this.userPaused = false;
    this.stepMode = false;
    this.stepResolve = null;
    delete this.figure.dataset.held;
    this.clock = 0;
    this.timers = new Set();
    this.ff = false;       // fast-forwarding towards ffTarget
    this.ffTarget = 0;
    this.beatIndex = 0;    // beats reached in the current run
    this.clicks = [];      // { id, at } button clicks, replayed on step back
    this.seed = 0;
    this._buildDom();
    this._observe();
    this._loop();
    this.reset(false);
    scenes.push(this);
    this.manual = !def.ambient && loadMode(this);
    this._applyMode();
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
    this.backBtn = btn('⏮ Back', () => this.stepBack());
    this.backBtn.title = 'Step back to the previous beat';
    const stepBtn = (this.stepBtn = btn('Step ⏭', () => this.step()));
    stepBtn.title = 'Play to the next beat, then hold';
    const resetBtn = btn('↺ Reset', () => this.reset(true));
    this.playBtn.classList.add('viz-btn-play');
    const transport = document.createElement('div');
    transport.className = 'viz-transport';
    transport.setAttribute('role', 'group');
    transport.setAttribute('aria-label', 'Playback');
    transport.append(this.playBtn, this.backBtn, stepBtn, resetBtn);
    this.extraEl = document.createElement('div');
    this.extraEl.className = 'viz-extra';
    this.extraEl.setAttribute('role', 'group');
    this.extraEl.setAttribute('aria-label', 'Figure actions');

    const speedWrap = document.createElement('label');
    speedWrap.className = 'viz-speed';
    const speed = document.createElement('input');
    Object.assign(speed, { type: 'range', min: '0.1', max: '2', step: '0.05', value: String(DEFAULT_SPEED) });
    const speedVal = document.createElement('span');
    speedVal.textContent = formatSpeed(DEFAULT_SPEED);
    speed.addEventListener('input', () => {
      this.speed = parseFloat(speed.value);
      speedVal.textContent = formatSpeed(this.speed);
    });
    const speedLabel = document.createElement('span');
    speedLabel.className = 'viz-speed-label';
    speedLabel.textContent = 'speed';
    speedVal.className = 'viz-speed-val';
    speedWrap.append(speedLabel, speed, speedVal);

    // Auto / Step-by-step switch (not for ambient figures without beats).
    const mode = document.createElement('div');
    mode.className = 'viz-mode';
    mode.setAttribute('role', 'radiogroup');
    mode.setAttribute('aria-label', 'Playback mode');
    this.modeBtns = ['auto', 'manual'].map((m) => {
      const b = btn(m === 'auto' ? 'Auto' : 'Step by step', () => this.setManual(m === 'manual'));
      b.setAttribute('role', 'radio');
      b.dataset.mode = m;
      mode.appendChild(b);
      return b;
    });
    if (this.def.ambient) mode.hidden = true;

    bar.append(transport, mode, speedWrap, this.extraEl);
    this.figure.prepend(this.stage, this.captionEl, bar);
  }

  _observe() {
    const io = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (!this.visible) this.pause();
      else if (this.manual && this.stepMode) this._toNextBeat();
      else if (!this.userPaused) this.play();
    }, { threshold: 0.35 });
    io.observe(this.figure);
  }

  _loop() {
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(now - last, 100); // no big jump after a hidden tab
      last = now;
      if (!this.paused && !this.ff) {
        this.clock += dt * this.speed;
        this._process();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _process() {
    for (const tm of this.timers) {
      const t = tm.dur <= 0 ? 1 : Math.min(1, (this.clock - tm.start) / tm.dur);
      tm.onFrame(t);
      if (t >= 1) { this.timers.delete(tm); tm.resolve(); }
    }
  }

  _schedule(gen, dur, onFrame) {
    if (gen !== this.gen) return Promise.reject(CANCEL);
    return new Promise((resolve, reject) => {
      this.timers.add({ start: this.clock, dur: Math.max(0, dur), onFrame, resolve, reject });
    });
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
    this._syncStepLabel(true);
    if (this.stepResolve) { const r = this.stepResolve; this.stepResolve = null; r(); }
  }
  // In step-by-step mode, show that a beat is playing until it holds.
  _syncStepLabel(playing) {
    const busy = this.manual && playing;
    this.stepBtn.textContent = busy ? 'Playing…' : this.manual ? 'Next ⏭' : 'Step ⏭';
    this.stepBtn.classList.toggle('is-playing', busy);
  }
  setManual(on) {
    this.manual = on;
    saveMode(this);
    this._applyMode();
    // Some figures run an entirely different script per mode (not just a
    // pause/no-pause difference at the same beats) — restart so the build
    // picks the right one via ctx.manual.
    if (this.def.restartOnModeChange) this.reset(false);
  }
  // Sync controls and playback with this figure's mode.
  _applyMode() {
    this._syncStepLabel(false);
    this.stepBtn.title = this.manual ? 'Play one beat, then hold' : 'Play to the next beat, then hold';
    for (const b of this.modeBtns) b.setAttribute('aria-checked', String((b.dataset.mode === 'manual') === this.manual));
    if (this.manual) {
      // A figure mid-transition finishes its current beat, then holds.
      this.userPaused = true;
      this.stepMode = true;
      this.playBtn.textContent = '▶ Play';
      if (this.visible) this._toNextBeat();
    } else {
      this.stepMode = false;
      this.userPaused = false;
      if (this.visible) this.play();
    }
  }
  // Step mode: play up to the next beat unless already holding at one.
  _toNextBeat() {
    if (!this.stepResolve) { this.paused = false; this._syncStepLabel(true); }
  }
  // Replay the run up to the beat before the one on screen, then hold there.
  stepBack() {
    if (!this.beatIndex) return;
    this.userPaused = true;
    this.stepMode = true;
    this._run({ replay: true, target: Math.max(1, this.beatIndex - 1) });
  }

  reset(userInitiated) {
    if (userInitiated && this.stepMode) this.paused = true;
    this._run({ replay: false });
    if (this.manual && this.stepMode && this.visible) this._toNextBeat();
  }

  _run({ replay, target = 0 }) {
    this.gen++;
    for (const tm of this.timers) tm.reject(CANCEL);
    this.timers.clear();
    this.stepResolve = null;
    this.clock = 0;
    this.beatIndex = 0;
    this.buttonCount = 0;
    if (!replay) {
      this.seed = (Math.random() * 2 ** 32) >>> 0;
      this.clicks = [];
    }
    this.svg.innerHTML = '';
    this.extraEl.innerHTML = '';
    this.captionEl.textContent = '';
    this.ff = replay;
    this.ffTarget = target;
    this._syncBack();

    const gen = this.gen;
    const ctx = this._ctx(gen);
    Promise.resolve()
      .then(() => this.def.build(ctx))
      .then(async () => {
        if (gen !== this.gen) return;
        // Hold on the final beat's finished result before looping.
        if (this.beatIndex > 0) await this._holdPoint(gen);
        if (this.def.loop === false) return;
        await ctx.wait(2200);
        if (gen === this.gen) this._run({ replay: false });
      })
      .catch((e) => { if (e !== CANCEL) console.error(e); });
    if (replay) this._fastForward(gen);
  }

  // Discrete-event fast-forward: jump the clock to the next timer deadline,
  // let resulting microtasks settle, repeat — until ctx.beat() lands us.
  async _fastForward(gen) {
    for (let i = 0; i < 100000; i++) {
      await nextTask();
      if (!this.ff || gen !== this.gen) return;
      if (!this.timers.size) break;
      let next = Infinity;
      for (const tm of this.timers) next = Math.min(next, tm.start + tm.dur);
      this.clock = Math.max(this.clock, next);
      this._process();
    }
    if (gen === this.gen && this.ff) { this.ff = false; this.pause(); }
  }

  // Where stepping stops: after a beat's animation has finished. Also where a
  // step-back replay lands once it reaches its target beat.
  async _holdPoint(gen) {
    const landing = this.ff && this.beatIndex >= this.ffTarget;
    if (landing || (this.stepMode && !this.ff)) {
      // Let fire-and-forget transitions (fades, badges) finish so the held
      // frame never freezes mid-fade. During a step-back replay this resolves
      // instantly, before landing.
      await this._schedule(gen, 320, () => {});
    }
    if (landing) {
      this.ff = false;
      this.clicks = this.clicks.filter((c) => c.at <= this.clock);
      this.stepMode = true;
      this.pause();
    }
    if (this.stepMode && !this.ff) {
      this.paused = true;
      this._syncStepLabel(false);
      this.figure.dataset.held = '';  // marks "holding at a beat" (styling/tests)
      await new Promise((r) => { this.stepResolve = r; });
      delete this.figure.dataset.held;
      if (gen !== this.gen) throw CANCEL;
    }
  }

  _syncBack() {
    this.backBtn.disabled = this.beatIndex < 1;
  }

  _ctx(gen) {
    const scene = this;
    const root = el('g', {}, this.svg);
    const alive = () => { if (gen !== scene.gen) throw CANCEL; };
    const frames = (duration, onFrame) => scene._schedule(gen, duration, onFrame);

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
      // Read-only: whether this figure is in Step-by-step mode. Lets a build
      // that needs a wholly different script per mode (not just pausing at
      // the same beats) branch once, up front.
      get manual() { return scene.manual; },

      // Seeded randomness and virtual time: use these instead of
      // Math.random / performance.now so step-back replays match.
      random: mulberry32(this.seed),
      now: () => scene.clock,

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
      caption: (html) => { alive(); setCaption(scene.captionEl, html); },

      // A narrative checkpoint: sets the caption, holds in step mode,
      // then lingers `hold` ms so the reader can take it in.
      // A narrative beat: the caption describes what plays until the next
      // beat. Steps hold just before the next caption, so a held frame always
      // shows a caption together with its finished result.
      beat: async (html, hold = 900) => {
        alive();
        if (scene.beatIndex > 0) await scene._holdPoint(gen);
        scene.beatIndex++;
        setCaption(scene.captionEl, html);
        scene._syncBack();
        await ctx.wait(hold);
      },

      // Extra interactive button in the control bar (cleared on reset).
      button: (label, onClick, { title } = {}) => {
        const id = scene.buttonCount++;
        const b = btn(label, () => {
          if (gen !== scene.gen) return;
          scene.clicks.push({ id, at: scene.clock });
          onClick();
        });
        // On replay, re-fire this button's recorded clicks at their times.
        for (const c of scene.clicks) {
          if (c.id !== id) continue;
          frames(c.at - scene.clock, () => {})
            .then(() => { if (scene.clicks.includes(c)) onClick(); })
            .catch(() => {});
        }
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
