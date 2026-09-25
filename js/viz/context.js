// "Context is a projection of the trajectory"
//
// Top lane:    the agent's own trajectory, growing right, scrolling like a tape.
// Middle lane: a side trajectory for the summarizer, branching off the Start chip.
// Bottom:      the prompt panel (rebuilt by a backward walk) + a context-size meter,
//              both built from the same per-event "cost" so you can watch the
//              meter's colored segments literally collapse into one lime segment.

const W = 900, H = 420;

const LANE = { x: 20, y: 34, w: 860, h: 64 };
const SIDE = { x: 20, y: 118, w: 860, h: 56 };
const PROMPT = { x: 20, y: 204, w: 430, h: 196 };
const METER = { x: 470, y: 204, w: 410, h: 74 };

const PAD = 12;
const PILL_H = 24;
const GAP = 8;
const ROW_H = 18;
const ROW_CAP = 9;

// Rough per-event-type "token cost", used to size both the prompt-panel bars
// and the meter segments so the two always agree with each other.
const COST = {
  UserMessage: 20, AgentStart: 8, IterationStart: 6, thinking: 30, content: 34,
  tool_call: 16, ToolExecutionStart: 8, ToolExecutionEnd: 26, IterationEnd: 6,
  PromptCompactionStart: 5, PromptCompactionEnd: 5,
};
const DEFAULT_COST = 12;
const SUMMARY_COST = 40;
const METER_MAX = 180; // cost that reads as "100%"
const PANEL_BAR_X = 168;
const PANEL_BAR_SCALE = 3.5;
const PANEL_BAR_MAX = 150;
const PANEL_INSET = 16; // prompt rows' left inset inside the panel

// Pills sit on each lane's vertical middle.
const MAIN_Y = LANE.y + (LANE.h - PILL_H) / 2;
const SIDE_Y = SIDE.y + (SIDE.h - PILL_H) / 2;
// Horizontal lane of the branch connector: halfway between the side box's
// top edge and its pills, so it never touches a label.
const BRANCH_LANE_Y = SIDE.y + (SIDE_Y - SIDE.y) / 2;
const CORNER = 4;

export default {
  width: W, height: H,

  async build(ctx) {
    const { COLORS, el, setPos, getPos } = ctx;
    let walking = false; // mutex so the "Build prompt" button can't collide with the script

    // ---------- static frame ----------
    ctx.box({ ...LANE, title: 'Agent trajectory' });
    ctx.box({ ...SIDE, title: 'Summarizer — side trajectory' });
    ctx.box({ ...PROMPT, title: 'Prompt sent to the model' });
    ctx.box({ ...METER, title: 'Context size' });

    // Measure text with the real font so pills are sized to their label,
    // never clipped or overflowing.
    function measureLabel(label) {
      const t = el('text', { class: 'mono', 'font-size': 11, text: label }, ctx.svg); // eventPill's font
      const w = t.getComputedTextLength();
      t.remove();
      return w;
    }
    function pillWidth(label) {
      return Math.max(50, measureLabel(label) + 26);
    }

    // clip viewport for the main lane (so old chips scroll off the left edge,
    // still in the DOM, just out of frame — nothing is deleted)
    const clipId = 'ctx-lane-clip';
    const defs = el('defs', {}, ctx.root);
    const clipRect = el('rect', {
      x: LANE.x + PAD, y: LANE.y + 1, width: LANE.w - PAD * 2, height: LANE.h - 2,
    });
    const clip = el('clipPath', { id: clipId }, defs);
    clip.appendChild(clipRect);

    const laneViewport = el('g', { 'clip-path': `url(#${clipId})` }, ctx.root);
    const mainInner = el('g', {}, laneViewport);
    setPos(mainInner, LANE.x + PAD, MAIN_Y);

    const sideInner = el('g', {}, ctx.root);
    setPos(sideInner, SIDE.x + PAD, SIDE_Y);
    const sideIdleLabel = el('text', {
      x: 0, y: PILL_H / 2, 'dominant-baseline': 'central', class: 'mono', 'font-size': 10.5,
      fill: COLORS.muted, text: '(idle)',
    }, sideInner);

    // Head marker: a triangle whose tip sits 3 units above the head pill's
    // top-center, labelled to its left so it fits the gap above the pills.
    const headTag = el('g', {}, mainInner);
    el('path', { d: 'M0,-3 L5,-11 L-5,-11 Z', fill: COLORS.activation }, headTag);
    el('text', {
      x: -9, y: -7, class: 'mono', 'font-size': 10.5, fill: COLORS.activation,
      'text-anchor': 'end', 'dominant-baseline': 'central', text: 'head',
    }, headTag);

    // ---------- main lane state ----------
    const mainPills = []; // { node, label, x, w, dimmed }
    let mainRunX = 0;
    let compactStart = null;    // entry for PromptCompactionStart, once written
    let compactEndEntry = null; // entry for PromptCompactionEnd, once written
    let branchArrow = null;     // connector from the Start chip down to the side lane

    const scrollFor = (contentEnd) => Math.min(0, LANE.w - PAD * 2 - contentEnd);
    const scrollTarget = () => scrollFor(mainRunX > 0 ? mainRunX - GAP : 0);

    // branchArrow lives directly under ctx.root (not clipped by the lane
    // viewport, since it has to reach down into the side lane below), so its
    // start point is mainInner's *local* compactStart position converted to
    // root/absolute coordinates using mainInner's current scroll offset.
    // Orthogonal route: down from the Start chip's bottom-center into the
    // side box, left along a lane above the side pills, then down onto the
    // top-center of the side trajectory's first pill (AgentStart).
    function branchPath() {
      const p = getPos(mainInner);
      const sx = p.x + compactStart.x + compactStart.w / 2;
      const sy = p.y + PILL_H;
      const ex = SIDE.x + PAD + pillWidth('AgentStart') / 2;
      const ey = SIDE_Y;
      const ly = BRANCH_LANE_Y, r = CORNER;
      return `M${sx},${sy} V${ly - r} Q${sx},${ly} ${sx - r},${ly} ` +
        `H${ex + r} Q${ex},${ly} ${ex},${ly + r} V${ey}`;
    }
    function redrawBranch() {
      if (branchArrow) branchArrow.setAttribute('d', branchPath());
    }

    async function appendMainPill(label, { instant = false } = {}) {
      const w = pillWidth(label);
      const x = mainRunX;
      mainRunX += w + GAP;
      const node = ctx.eventPill({ x, y: 0, name: label, w, h: PILL_H }, mainInner);
      const entry = { node, label, x, w, dimmed: false };
      mainPills.push(entry);
      setPos(headTag, x + w / 2, 0);

      const targetScroll = scrollTarget();
      if (instant) {
        setPos(mainInner, targetScroll, getPos(mainInner).y);
        node.setAttribute('opacity', 1);
        return entry;
      }
      node.setAttribute('opacity', 0);
      const from = getPos(mainInner);
      await Promise.all([
        ctx.fade(node, 1, 420),
        ctx.animate(420, (t) => {
          setPos(mainInner, from.x + (targetScroll - from.x) * t, from.y);
          redrawBranch();
        }),
      ]);
      return entry;
    }

    // ---------- side lane state ----------
    const sidePills = [];
    let sideRunX = 0;
    async function appendSidePill(label, opts = {}) {
      if (sidePills.length === 0) ctx.fade(sideIdleLabel, 0, 200);
      const w = pillWidth(label);
      const x = sideRunX;
      sideRunX += w + GAP;
      const node = ctx.eventPill({ x, y: 0, name: opts.name || label, label, w, h: PILL_H, type: opts.type }, sideInner);
      node.setAttribute('opacity', 0);
      sidePills.push({ node, label });
      await ctx.fade(node, 1, 260);
      return node;
    }

    // ---------- prompt panel + meter (built together from one "history") ----------
    const promptGroup = el('g', {}, ctx.root);
    // ROW_CAP rows, centered vertically in the panel.
    setPos(promptGroup, PROMPT.x + PANEL_INSET, PROMPT.y + (PROMPT.h - ROW_CAP * ROW_H) / 2);

    const meterLabelW = 74;
    const meterTrackX = METER.x + PAD;
    const meterTrackY = METER.y + (METER.h - 14) / 2;
    const meterTrackW = METER.w - PAD * 2 - meterLabelW;
    const meterClipId = 'ctx-meter-clip';
    const meterClip = el('clipPath', { id: meterClipId }, defs);
    el('rect', { x: 0, y: 0, width: meterTrackW, height: 14, rx: 7 }, meterClip);
    ctx.el('rect', { x: meterTrackX, y: meterTrackY, width: meterTrackW, height: 14, rx: 7, fill: COLORS.dim });
    const meterViewport = el('g', { 'clip-path': `url(#${meterClipId})` }, ctx.root);
    setPos(meterViewport, meterTrackX, meterTrackY);
    const meterTrack = el('g', {}, meterViewport);
    const meterPctLabel = ctx.el('text', {
      x: meterTrackX + meterTrackW + 12, y: meterTrackY + 7, 'dominant-baseline': 'central',
      class: 'mono', 'font-size': 11,
      fill: COLORS.muted, text: '0% used',
    });

    let history = []; // { promptNode, segNode, cost }
    let totalCost = 0;

    async function addHistoryLine(label, color, cost) {
      const segW = Math.max(4, Math.min(meterTrackW, cost * (meterTrackW / METER_MAX)));
      const moves = [];
      for (const h of history) {
        moves.push(ctx.move(h.promptNode, 0, getPos(h.promptNode).y + ROW_H, 240));
        moves.push(ctx.move(h.segNode, getPos(h.segNode).x + segW, 0, 240));
      }

      const pNode = el('g', {}, promptGroup);
      setPos(pNode, -8, 0);
      pNode.setAttribute('opacity', 0);
      // Stripe, label and bar all share the row's vertical middle.
      const mid = ROW_H / 2;
      el('rect', { x: 0, y: mid - 5.5, width: 4, height: 11, rx: 1.5, fill: color }, pNode);
      el('text', {
        x: 10, y: mid, 'dominant-baseline': 'central', class: 'mono', 'font-size': 10.5,
        fill: COLORS.text, text: label,
      }, pNode);
      const barW = Math.min(PANEL_BAR_MAX, cost * PANEL_BAR_SCALE);
      el('rect', { x: PANEL_BAR_X, y: mid - 3.5, width: barW, height: 7, rx: 2, fill: color, opacity: 0.55 }, pNode);
      moves.push(ctx.move(pNode, 0, 0, 240));
      moves.push(ctx.fade(pNode, 1, 240));

      const segNode = el('g', {}, meterTrack);
      setPos(segNode, -segW, 0);
      el('rect', { x: 0, y: 0, width: segW, height: 14, fill: color }, segNode);
      moves.push(ctx.move(segNode, 0, 0, 240));

      const entry = { promptNode: pNode, segNode, cost };
      history.unshift(entry);
      totalCost += cost;

      await Promise.all(moves);
      meterPctLabel.textContent = `${Math.round(Math.min(999, (totalCost / METER_MAX) * 100))}% used`;

      if (history.length > ROW_CAP) {
        const gone = history.pop();
        await Promise.all([ctx.fade(gone.promptNode, 0, 150), ctx.fade(gone.segNode, 0, 150)]);
        gone.promptNode.remove();
        gone.segNode.remove();
      }
    }

    async function clearHistory() {
      for (const h of history) { h.promptNode.remove(); h.segNode.remove(); }
      history = [];
      totalCost = 0;
      meterPctLabel.textContent = '0% used';
    }

    // ---------- backward-walk cursor ----------
    // An underline riding just below the current pill (never over its label).
    const CURSOR_INSET = 8, CURSOR_DY = PILL_H + 6;
    const cursor = el('rect', {
      x: 0, y: CURSOR_DY, width: 0, height: 3, rx: 1.5, fill: COLORS.activation, opacity: 0,
    }, mainInner);
    const cursorAt = (entry) => ({ x: entry.x + CURSOR_INSET, w: entry.w - CURSOR_INSET * 2 });
    function placeCursor(entry) {
      const c = cursorAt(entry);
      cursor.setAttribute('x', c.x);
      cursor.setAttribute('width', c.w);
    }
    function moveCursor(entry, ms) {
      const x0 = +cursor.getAttribute('x'), w0 = +cursor.getAttribute('width');
      const c = cursorAt(entry);
      return ctx.animate(ms, (t) => {
        cursor.setAttribute('x', x0 + (c.x - x0) * t);
        cursor.setAttribute('width', w0 + (c.w - w0) * t);
      });
    }
    // Activation flash: a yellow outline hugging the pill, fading out.
    async function flashPill(entry, ms) {
      const f = el('rect', {
        x: entry.x - 3, y: -3, width: entry.w + 6, height: PILL_H + 6, rx: 9,
        fill: 'none', stroke: COLORS.activation, 'stroke-width': 2,
      }, mainInner);
      await ctx.animate(ms, (t) => f.setAttribute('opacity', 1 - t), (t) => t);
      f.remove();
    }
    const pillTop = (entry) => ({ x: entry.x + entry.w / 2, y: 0 });

    // Walk the main trajectory backwards from head, materializing a prompt
    // line (and a matching meter segment) for every event it meets. Events
    // between a PromptCompactionEnd and its paired Start still render as
    // ordinary history — only once the walk actually reaches the Start does
    // everything before it collapse into one Summary line.
    async function runBackwardWalk() {
      if (walking) return;
      walking = true;
      try {
        await clearHistory();
        placeCursor(mainPills[mainPills.length - 1]);
        cursor.setAttribute('opacity', 1);
        let previewArc = null;
        for (let i = mainPills.length - 1; i >= 0; i--) {
          if (!ctx.alive) return;
          const entry = mainPills[i];

          if (compactStart && entry === compactStart) {
            await addHistoryLine('Summary (compacted)', COLORS.compact, SUMMARY_COST);
            for (let j = i; j >= 0; j--) {
              const e = mainPills[j];
              if (!e.dimmed) { e.dimmed = true; ctx.fade(e.node, 0.3, 400); }
            }
            if (previewArc) { await ctx.fade(previewArc, 0, 250); previewArc.remove(); }
            break;
          }

          await moveCursor(entry, 300);
          await flashPill(entry, 460);
          await addHistoryLine(entry.label, ctx.colorOf(entry.label), COST[entry.label] ?? DEFAULT_COST);

          if (compactEndEntry && entry === compactEndEntry) {
            // Top-center to top-center, peaking 14 above the pills.
            const c = pillTop(entry), sc = pillTop(compactStart);
            previewArc = el('path', {
              d: `M${c.x},${c.y} Q${(c.x + sc.x) / 2},${c.y - 28} ${sc.x},${sc.y}`,
              fill: 'none', stroke: COLORS.compact, 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
            }, mainInner);
            await ctx.draw(previewArc, 420);
          }
        }
        await ctx.wait(300);
        cursor.setAttribute('opacity', 0);
      } finally {
        walking = false;
      }
    }

    ctx.button('Build prompt', () => ctx.spawn(runBackwardWalk));

    // ================= script =================

    for (const name of [
      'UserMessage', 'AgentStart', 'IterationStart', 'thinking',
      'tool_call', 'ToolExecutionStart', 'ToolExecutionEnd', 'content',
    ]) {
      await appendMainPill(name, { instant: true });
    }

    await ctx.beat(
      'The trajectory is the source of truth — but it isn’t the prompt. ' +
      'A new <span class="mono">IterationStart</span> just landed.'
    );
    await appendMainPill('IterationStart');
    await ctx.beat(
      'Right after that, the prompt builder walks the head <strong>backwards</strong>, ' +
      'event by event, rendering a line into the prompt for each one it meets.'
    );
    await runBackwardWalk();
    await ctx.beat(
      'The panel now holds the whole history, oldest event on top — ' +
      'and the meter is closing in on the limit line.'
    );

    await appendMainPill('PromptCompactionStart');
    compactStart = mainPills[mainPills.length - 1];
    branchArrow = ctx.el('path', {
      d: branchPath(), fill: 'none', stroke: COLORS.compact, 'stroke-width': 1.5, 'stroke-dasharray': '3 3',
    });
    redrawBranch();

    await ctx.beat(
      'The agent writes <span class="mono">PromptCompactionStart</span> and keeps going — ' +
      'it never pauses for this. A summarizer spins up on a <strong>side trajectory</strong>.'
    );

    // Concurrent and literal: the main agent keeps appending real events
    // while the summarizer runs its own loop on the side trajectory. That
    // means Start and End won't be adjacent — which is exactly the point.
    await Promise.all([
      (async () => {
        await ctx.wait(300); await appendMainPill('IterationEnd'); redrawBranch();
        await ctx.wait(500); await appendMainPill('tool_call'); redrawBranch();
        await ctx.wait(500); await appendMainPill('IterationStart'); redrawBranch();
        await ctx.wait(500); await appendMainPill('IterationEnd'); redrawBranch();
      })(),
      (async () => {
        await appendSidePill('AgentStart', { type: 'agent' });
        await ctx.wait(500);
        await appendSidePill('content', { type: 'content' });
        await ctx.wait(500);
        await appendSidePill('AgentDone', { type: 'agent' });
      })(),
    ]);

    const summaryChip = await appendSidePill('Summary', { type: 'compact' });
    // "Waiting" halo: an outline around the chip that breathes, off the label.
    const summaryW = pillWidth('Summary');
    const halo = el('rect', {
      x: -3, y: -3, width: summaryW + 6, height: PILL_H + 6, rx: 9,
      fill: 'none', stroke: COLORS.compact, 'stroke-width': 1.5, opacity: 0,
    }, summaryChip);
    ctx.spawn(async () => {
      while (ctx.alive && halo.isConnected) {
        await ctx.fade(halo, 0.9, 450);
        await ctx.fade(halo, 0, 450);
        await ctx.wait(300);
      }
    });

    await ctx.beat(
      'Meanwhile the summary finishes on the side lane and waits there, like an inbox entry — ' +
      'it never lands on the agent trajectory directly.'
    );

    // Admit: the summary chip travels up onto the main trajectory.
    branchArrow.remove();
    branchArrow = null;
    // The lane scrolls to open the End slot while the chip flies into it,
    // then the chip cross-fades into the PromptCompactionEnd pill.
    halo.remove();
    const fromAbs = { x: getPos(sideInner).x + sideRunX - GAP - summaryW, y: getPos(sideInner).y };
    const laneFrom = getPos(mainInner);
    const laneTo = scrollFor(mainRunX + pillWidth('PromptCompactionEnd'));
    const toAbs = { x: LANE.x + PAD + laneTo + mainRunX, y: laneFrom.y };
    summaryChip.remove();
    ctx.root.appendChild(summaryChip);
    setPos(summaryChip, fromAbs.x, fromAbs.y);
    await Promise.all([
      ctx.move(summaryChip, toAbs.x, toAbs.y, 700),
      ctx.animate(700, (t) => setPos(mainInner, laneFrom.x + (laneTo - laneFrom.x) * t, laneFrom.y)),
    ]);
    const [endEntry] = await Promise.all([
      appendMainPill('PromptCompactionEnd'),
      ctx.fade(summaryChip, 0, 300),
    ]);
    summaryChip.remove();
    compactEndEntry = endEntry;

    await ctx.beat(
      'At its next boundary, the agent admits it: <span class="mono">PromptCompactionEnd</span> ' +
      'is appended, paired with its <span class="mono">Start</span> — several real iterations later.'
    );

    await appendMainPill('IterationStart');
    await ctx.beat(
      'A new <span class="mono">IterationStart</span> triggers another backward walk. It renders ' +
      'the recent events as usual, meets the <span class="mono">End</span>, and previews the arc to its ' +
      '<span class="mono">Start</span> — but keeps walking the events in between as ordinary history.'
    );
    await runBackwardWalk();
    await ctx.beat(
      'Only once the walk actually reaches <span class="mono">Start</span> does everything before it ' +
      'collapse into one <strong>Summary</strong> line. The meter drops — same trajectory, a smaller projection of it.'
    );

    await ctx.beat(
      'Nothing was deleted: the dimmed events are still on the trajectory, right where they were. ' +
      'The prompt is just one way of looking at it.'
    );
  },
};
