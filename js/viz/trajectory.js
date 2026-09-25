// #viz-trajectory — "Trajectories: an event log modeled after Git"
// One append-only lane of events, each with a single parent pointer.
// Forking from a boundary (IterationEnd / AgentDone) is free: a new head,
// a pink ThreadForkConfig pointing back at the fork point, zero copies.

import { COLORS, colorOf } from '../lib.js';

const ROW_A_Y = 85;
const ROW_B_Y = 165;
const GUTTER_Y = 125; // midway between the two main rows — the wrap arrow's elbow
const FORK_Y = [240, 305, 370];
const EXT_Y = 435;
const COL_X = [70, 178, 286, 394, 502, 610, 718];
const EXT_GUTTER_Y = (FORK_Y[FORK_Y.length - 1] + EXT_Y) / 2; // lane for the wrap into the append row
const NODE_R = 8;      // plain node: r=7 circle + half its 2px stroke
const RING_R = 11.5;   // boundary node: dashed r=11 ring + half its 1px stroke
const LABEL_DY = 20;   // label center sits this far above/below the node center
const edgeR = (boundary) => (boundary ? RING_R : NODE_R);

const ROW_A = [
  ['UserMessage', false], ['AgentStart', false], ['IterationStart', false],
  ['thinking', false], ['tool_call', false], ['ToolParametersValidated', false],
  ['ToolExecutionStart', false],
];
const ROW_B = [
  ['ToolExecutionEnd', false], ['IterationEnd', true], ['IterationStart', false],
  ['content', false], ['IterationEnd', true], ['AgentDone', true],
];

export default {
  width: 900, height: 475,
  loop: false,
  async build(ctx) {
    const root = ctx.root;

    // ---------- counter panel ----------
    let stored = 0;
    const copied = 0;
    const counterEl = ctx.el('text', {
      x: 880, y: 24, class: 'mono', 'font-size': 11, 'text-anchor': 'end', fill: COLORS.muted, text: '',
    }, root);
    const copiedEl = ctx.el('text', {
      x: 880, y: 40, class: 'mono', 'font-size': 11, 'text-anchor': 'end', fill: COLORS.muted, text: '',
    }, root);
    const renderCounter = () => {
      counterEl.textContent = `stored: ${stored}`;
      copiedEl.textContent = `copied: ${copied} — forking is free`;
    };
    renderCounter();

    // ---------- head tags ----------
    // Offset places the tag clear of the node's dashed boundary ring (r=11)
    // plus a small gap, then out by half the tag's own width — so tags of
    // any label length never touch the node or the next node's ring.
    function headOffset(label) {
      const w = 16 + label.length * 6.4;
      return 11 + 8 + w / 2;
    }
    function makeHead(label) {
      const g = ctx.el('g', {}, root);
      const w = 16 + label.length * 6.4;
      ctx.el('rect', {
        width: w, height: 18, rx: 9, x: -w / 2, y: -9,
        fill: COLORS.panel, stroke: COLORS.fork, 'stroke-width': 1.25,
      }, g);
      ctx.el('text', {
        x: 0, y: 0, class: 'mono', 'font-size': 10.5, 'text-anchor': 'middle',
        'dominant-baseline': 'central', fill: COLORS.fork, text: label,
      }, g);
      g._offset = headOffset(label);
      ctx.setPos(g, -100, -100);
      return g;
    }
    const mainHead = makeHead('main');

    // ---------- event drawing ----------
    // registry of every event drawn, for the backward-walk demo
    const events = [];

    function drawDot(x, y, name, boundary) {
      const g = ctx.el('g', {}, root);
      ctx.setPos(g, x, y);
      const c = colorOf(name);
      ctx.el('circle', { r: 7, fill: COLORS.panel, stroke: c, 'stroke-width': 2 }, g);
      if (boundary) {
        ctx.el('circle', {
          r: 11, fill: 'none', stroke: c, 'stroke-width': 1,
          'stroke-dasharray': '2 2', opacity: 0.7,
        }, g);
      }
      g.setAttribute('opacity', 0);
      return g;
    }
    function drawLabel(x, y, name, above) {
      return ctx.el('text', {
        x, y: above ? y - LABEL_DY : y + LABEL_DY, class: 'mono', 'font-size': 10.5,
        'text-anchor': 'middle', 'dominant-baseline': 'central', fill: COLORS.text, opacity: 0, text: name,
      }, root);
    }

    // Parent arrow from the child's edge to the parent's edge (never center
    // to center, so the head touches the parent's outline). With `gutter`
    // the route is orthogonal: out of the child vertically into the gutter
    // lane, flat along it, then vertically into the parent — used for row
    // wraps and forks so no edge cuts diagonally across another row.
    // Also returns the untrimmed center-to-center route for the backward walk.
    function parentArrow(c, p, { color = COLORS.line, gutter = null, dash, width = 1.25 } = {}) {
      const rc = edgeR(c.boundary), rp = edgeR(p.boundary);
      let d, walkD;
      if (gutter != null && c.x !== p.x) {
        const y1 = c.y + Math.sign(gutter - c.y) * rc;
        const y2 = p.y + Math.sign(gutter - p.y) * rp;
        d = `M${c.x},${y1} L${c.x},${gutter} L${p.x},${gutter} L${p.x},${y2}`;
        walkD = `M${c.x},${c.y} L${c.x},${gutter} L${p.x},${gutter} L${p.x},${p.y}`;
      } else {
        const dx = p.x - c.x, dy = p.y - c.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        d = `M${c.x + ux * rc},${c.y + uy * rc} L${p.x - ux * rp},${p.y - uy * rp}`;
        walkD = `M${c.x},${c.y} L${p.x},${p.y}`;
      }
      // ctx.arrow registers the per-color arrowhead marker; then take its route.
      const path = ctx.arrow(0, 0, 1, 0, { color, dash, width });
      path.setAttribute('d', d);
      return { path, walkD };
    }

    // Appends one event: slides in from the parent position, draws its
    // parent arrow, updates the counter, and (optionally) moves a head tag.
    async function addEvent({ x, y, name, boundary, parent, above, head, arrowColor, gutter = null }) {
      const g = drawDot(x, y, name, boundary);
      const label = drawLabel(x, y, name, above);
      const from = parent ? { x: parent.x, y: parent.y } : { x: x - 40, y };
      ctx.setPos(g, from.x, from.y);

      let path = null, walkD = null;
      await Promise.all([
        ctx.move(g, x, y, 420),
        ctx.animate(420, (t) => { g.setAttribute('opacity', t); label.setAttribute('opacity', t); }),
      ]);
      if (parent) {
        ({ path, walkD } = parentArrow(
          { x, y, boundary },
          { x: parent.x, y: parent.y, boundary: !!(parent.ev && parent.ev.boundary) },
          { color: arrowColor || COLORS.line, gutter },
        ));
        await ctx.draw(path, 300);
      }
      stored += 1;
      renderCounter();
      const ev = { name, x, y, boundary, parentEv: parent ? parent.ev : null, path, walkD };
      events.push(ev);
      if (head) {
        await ctx.move(head, x + head._offset, y, 300);
        root.appendChild(head); // keep the tag above every line drawn after it
      }
      return ev;
    }

    // Mutable story state — declared up front so the buttons (wired up
    // immediately, but only meaningful once the scripted intro lands) never
    // read a not-yet-initialized binding if clicked early.
    let ready = false;
    let busy = false; // serializes button clicks so rapid taps can't race
    let forkLanes = [];
    let lastBoundaryMain = null;
    let extCount = 0;
    let extTip = null;
    const EXT_PATTERN = ['IterationStart', 'content', 'IterationEnd'];

    async function appendEvent() {
      if (!ready) {
        ctx.caption('Still building the log — try again in a moment, or hit Step to catch up.');
        return;
      }
      if (busy) return;
      busy = true;
      try {
        await appendEventBody();
      } finally {
        busy = false;
      }
    }
    async function appendEventBody() {
      if (extCount >= 3) {
        await ctx.pulse(extTip.x, extTip.y, COLORS.muted, 18, 500);
        ctx.caption('Cap reached for this demo — hit Reset to try more appends.');
        return;
      }
      const name = EXT_PATTERN[extCount % EXT_PATTERN.length];
      const boundary = name === 'IterationEnd';
      const x = COL_X[extCount], y = EXT_Y;
      const ev = await addEvent({
        x, y, name, boundary, parent: extTip, above: false, head: mainHead,
        gutter: extCount === 0 ? EXT_GUTTER_Y : null, // wrap down like the main row does
      });
      extTip = { x, y, ev };
      if (boundary) lastBoundaryMain = extTip;
      extCount += 1;
      ctx.caption(`Appended <span class="t t-iter">${name}</span> onto main\'s tip — the log only ever grows.`);
    }

    async function forkHere() {
      if (!ready) {
        ctx.caption('Still building the log — try again in a moment, or hit Step to catch up.');
        return;
      }
      if (busy) return;
      busy = true;
      try {
        await forkHereBody();
      } finally {
        busy = false;
      }
    }
    async function forkHereBody() {
      if (forkLanes.length >= FORK_Y.length) {
        await ctx.pulse(lastBoundaryMain.x, lastBoundaryMain.y, COLORS.muted, 18, 500);
        ctx.caption('Lane cap reached for this demo — hit Reset to fork again from a clean slate.');
        return;
      }
      const laneIndex = forkLanes.length;
      await ctx.pulse(lastBoundaryMain.x, lastBoundaryMain.y, COLORS.fork, 22, 700);
      await drawFork(lastBoundaryMain.ev, laneIndex, `fork-${laneIndex + 1}`);
      ctx.caption(`New head <span class="t t-fork">fork-${laneIndex + 1}</span> forked from the latest boundary on main — zero events copied.`);
    }

    ctx.button('Fork here', () => ctx.spawn(() => forkHere()));
    ctx.button('Append event', () => ctx.spawn(() => appendEvent()));

    // ================= scripted story =================
    await ctx.beat(
      'Every builder turn is an append-only log. Each new event points back at ' +
      'exactly one parent — <span class="t t-user">UserMessage</span> starts the trajectory.'
    );

    let prev = null;
    for (let i = 0; i < ROW_A.length; i++) {
      const [name, boundary] = ROW_A[i];
      const x = COL_X[i], y = ROW_A_Y;
      const ev = await addEvent({
        x, y, name, boundary, parent: prev, above: i % 2 === 0, head: mainHead,
      });
      prev = { x, y, ev };
      if (i === 2) {
        await ctx.beat(
          '<span class="t t-iter">IterationStart</span> opens one LLM call. Thinking, a tool call, ' +
          'and the tool lifecycle all append in order.'
        );
      }
    }

    await ctx.beat('The row is full — the same lane just continues, wrapping down.');
    for (let i = 0; i < ROW_B.length; i++) {
      const [name, boundary] = ROW_B[i];
      const x = COL_X[i], y = ROW_B_Y;
      const ev = await addEvent({
        x, y, name, boundary, parent: prev, above: i % 2 === 1, head: mainHead,
        gutter: i === 0 ? GUTTER_Y : null,
      });
      prev = { x, y, ev };
    }
    const forkPoint = { x: COL_X[1], y: ROW_B_Y, ev: events.find((e) => e.name === 'IterationEnd') };
    lastBoundaryMain = prev;
    let mainTip = prev; // true tip of main, boundary or not

    await ctx.beat(
      'The dashed rings mark <span class="t t-iter">IterationEnd</span> / ' +
      '<span class="t t-agent">AgentDone</span> — the only points a new head is allowed to start from.'
    );

    // ---------- fork ----------
    async function drawFork(fromEv, laneIndex, label) {
      const y = FORK_Y[laneIndex];
      const x0 = COL_X[1];
      const head = makeHead(label);
      let p = { x: fromEv.x, y: fromEv.y, ev: fromEv };
      // Parent above (main rows): rise orthogonally through the gutter just
      // above this lane. Parent below (the append row): a straight drop, with
      // the label moved above the node so the arrow never crosses it.
      const parentAbove = fromEv.y < y;
      const gutter = parentAbove ? ((laneIndex === 0 ? ROW_B_Y : FORK_Y[laneIndex - 1]) + y) / 2 : null;
      const cfg = await addEvent({
        x: x0, y, name: 'ThreadForkConfig', boundary: false, parent: p,
        above: !parentAbove, head, arrowColor: COLORS.fork, gutter,
      });
      p = { x: x0, y, ev: cfg };
      const extra = [
        [COL_X[2], 'IterationStart', false],
        [COL_X[3], 'tool_call', false],
        [COL_X[4], 'IterationEnd', true],
      ];
      for (const [x, name, boundary] of extra) {
        const ev = await addEvent({ x, y, name, boundary, parent: p, above: false, head });
        p = { x, y, ev };
      }
      forkLanes.push({ head, tip: p, label });
      return p;
    }

    ctx.pulse(forkPoint.x, forkPoint.y, COLORS.fork, 24, 800);
    await ctx.beat(
      'Highlighting a boundary and forking: a new lane appears, and a pink ' +
      '<span class="t t-fork">ThreadForkConfig</span> lands with its parent arrow pointing straight ' +
      'back at the fork point. Nothing before it is copied.'
    );
    await drawFork(forkPoint.ev, 0, 'fork-1');
    await ctx.beat('Counter confirms it: events stored keeps climbing, events copied stays at zero.');

    // ---------- backward walk ----------
    const marker = ctx.el('circle', {
      r: 13, fill: 'none', stroke: COLORS.activation, 'stroke-width': 2, opacity: 0,
    }, root);
    const tipEv = forkLanes[0].tip.ev;
    ctx.setPos(marker, tipEv.x, tipEv.y);
    marker.setAttribute('opacity', 1);
    await ctx.beat(
      'Walking backward from <span class="t t-fork">fork-1</span>\'s tip: parent, parent, parent — ' +
      'through <span class="t t-fork">ThreadForkConfig</span> and straight into the shared main history.'
    );
    let cur = tipEv;
    while (cur.parentEv && ctx.alive) {
      // Ride the center-to-center route (the drawn arrow is trimmed to the
      // node edges), so the ring starts and lands exactly on node centers.
      const route = ctx.el('path', { d: cur.walkD, fill: 'none', stroke: 'none' }, root);
      await ctx.along(marker, route, 480);
      route.remove();
      cur = cur.parentEv;
      await ctx.pulse(cur.x, cur.y, COLORS.activation, 16, 360);
    }
    await ctx.fade(marker, 0, 300);
    marker.remove();
    await ctx.beat('The fork sees the exact same history all the way back to UserMessage — for free.');

    // ---------- never merge ----------
    const { path: ghost } = parentArrow(forkLanes[0].tip.ev, lastBoundaryMain.ev, {
      color: COLORS.muted, dash: '5 4', width: 1.5,
    });
    await ctx.draw(ghost, 500);
    // Strike the ghost at its own midpoint, perpendicular to it, short enough
    // to stay clear of the neighbouring labels.
    const { x: mx, y: my } = ctx.pointOnPath(ghost, 0.5);
    const a0 = ctx.pointOnPath(ghost, 0.45), a1 = ctx.pointOnPath(ghost, 0.55);
    const tl = Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1;
    const STRIKE_HALF = 14;
    const nx = (-(a1.y - a0.y) / tl) * STRIKE_HALF, ny = ((a1.x - a0.x) / tl) * STRIKE_HALF;
    const strike = ctx.el('line', {
      x1: mx - nx, y1: my - ny, x2: mx + nx, y2: my + ny, 'stroke-linecap': 'round',
      stroke: COLORS.revert, 'stroke-width': 3,
    }, root);
    await ctx.draw(strike, 250);
    await ctx.beat('Trajectories never merge — agents share results by sending each other messages, not by joining lanes.');
    await Promise.all([ctx.fade(ghost, 0, 300), ctx.fade(strike, 0, 300)]);
    ghost.remove();
    strike.remove();

    // ---------- revert ----------
    const revertX = COL_X[6];
    const revertEv = await addEvent({
      x: revertX, y: ROW_B_Y, name: 'Revert', boundary: false, parent: mainTip,
      above: true, head: mainHead,
    });
    mainTip = { x: revertX, y: ROW_B_Y, ev: revertEv };
    // Revert is not a boundary — lastBoundaryMain stays put at AgentDone,
    // since only IterationEnd/AgentDone are legal fork points.
    await ctx.beat('Even a revert is just another appended event — <span class="t t-revert">Revert</span>. Nothing before it is deleted.');

    // ================= interactive: buttons =================
    extTip = mainTip; // "Append event" continues the real tip, not the last boundary
    ready = true;
    ctx.caption(
      'Try the buttons: <strong>Fork here</strong> branches from main\'s latest boundary; ' +
      '<strong>Append event</strong> keeps growing the log. Copied always stays 0.'
    );
  },
};
