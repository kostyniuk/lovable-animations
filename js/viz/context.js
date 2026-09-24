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
const PROMPT = { x: 20, y: 204, w: 430, h: 176 };
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
      const t = el('text', { class: 'mono', 'font-size': 10.5, text: label }, ctx.svg);
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
      x: LANE.x + PAD, y: LANE.y + PAD - 18, width: LANE.w - PAD * 2, height: PILL_H + 40,
    });
    const clip = el('clipPath', { id: clipId }, defs);
    clip.appendChild(clipRect);

    const laneViewport = el('g', { 'clip-path': `url(#${clipId})` }, ctx.root);
    const mainInner = el('g', {}, laneViewport);
    setPos(mainInner, LANE.x + PAD, LANE.y + PAD + 10);

    const sideInner = el('g', {}, ctx.root);
    setPos(sideInner, SIDE.x + PAD, SIDE.y + PAD + 10);
    const sideIdleLabel = el('text', {
      x: 4, y: PILL_H / 2 + 4, class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: '(idle)',
    }, sideInner);

    const headTag = el('g', {}, mainInner);
    el('path', { d: 'M0,3 L6,-7 L-6,-7 Z', fill: COLORS.activation }, headTag);
    el('text', {
      x: 0, y: -11, class: 'mono', 'font-size': 10.5, fill: COLORS.activation,
      'text-anchor': 'middle', text: 'head',
    }, headTag);

    // ---------- main lane state ----------
    const mainPills = []; // { node, label, x, w, dimmed }
    let mainRunX = 0;
    let compactStart = null;    // entry for PromptCompactionStart, once written
    let compactEndEntry = null; // entry for PromptCompactionEnd, once written
    let branchArrow = null;     // connector from the Start chip down to the side lane

    function scrollTarget() {
      const contentEnd = mainRunX > 0 ? mainRunX - GAP : 0;
      return Math.min(0, LANE.w - PAD * 2 - contentEnd);
    }

    // branchArrow lives directly under ctx.root (not clipped by the lane
    // viewport, since it has to reach down into the side lane below), so its
    // start point is mainInner's *local* compactStart position converted to
    // root/absolute coordinates using mainInner's current scroll offset.
    function branchPath() {
      const p = getPos(mainInner);
      const sx = p.x + compactStart.x + compactStart.w / 2;
      const sy = p.y + PILL_H;
      const ex = SIDE.x + PAD + 30;
      const ey = SIDE.y + PAD + 8;
      const mx = (sx + ex) / 2, my = (sy + ey) / 2;
      return `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
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
      setPos(headTag, x + w / 2, -6);

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
    setPos(promptGroup, PROMPT.x + PAD, PROMPT.y + PAD + 6);

    const meterLabelW = 74;
    const meterTrackX = METER.x + PAD;
    const meterTrackY = METER.y + PAD + 14;
    const meterTrackW = METER.w - PAD * 2 - meterLabelW;
    const meterClipId = 'ctx-meter-clip';
    const meterClip = el('clipPath', { id: meterClipId }, defs);
    el('rect', { x: 0, y: 0, width: meterTrackW, height: 14, rx: 7 }, meterClip);
    ctx.el('rect', { x: meterTrackX, y: meterTrackY, width: meterTrackW, height: 14, rx: 7, fill: COLORS.dim });
    const meterViewport = el('g', { 'clip-path': `url(#${meterClipId})` }, ctx.root);
    setPos(meterViewport, meterTrackX, meterTrackY);
    const meterTrack = el('g', {}, meterViewport);
    const meterPctLabel = ctx.el('text', {
      x: meterTrackX + meterTrackW + 12, y: meterTrackY + 11, class: 'mono', 'font-size': 11,
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
      setPos(pNode, -14, -ROW_H);
      pNode.setAttribute('opacity', 0);
      el('rect', { x: 0, y: 2, width: 4, height: 11, rx: 1.5, fill: color }, pNode);
      el('text', { x: 10, y: 11, class: 'mono', 'font-size': 10.5, fill: COLORS.text, text: label }, pNode);
      const barW = Math.min(PANEL_BAR_MAX, cost * PANEL_BAR_SCALE);
      el('rect', { x: PANEL_BAR_X, y: 4, width: barW, height: 7, rx: 2, fill: color, opacity: 0.55 }, pNode);
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
    const cursor = el('g', {}, mainInner);
    el('circle', { r: 5, fill: 'none', stroke: COLORS.activation, 'stroke-width': 2 }, cursor);
    cursor.setAttribute('opacity', 0);
    const pillCenter = (entry) => ({ x: entry.x + entry.w / 2, y: PILL_H / 2 });

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

          const c = pillCenter(entry);
          await ctx.move(cursor, c.x, c.y, 300);
          await ctx.pulse(c.x, c.y, COLORS.activation, 16, 460);
          await addHistoryLine(entry.label, ctx.colorOf(entry.label), COST[entry.label] ?? DEFAULT_COST);

          if (compactEndEntry && entry === compactEndEntry) {
            const sc = pillCenter(compactStart);
            previewArc = el('path', {
              d: `M${c.x},${c.y} Q${(c.x + sc.x) / 2},${c.y - 46} ${sc.x},${sc.y}`,
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
      'content', 'tool_call', 'ToolExecutionStart', 'ToolExecutionEnd',
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
    ctx.spawn(async () => {
      while (ctx.alive && summaryChip.isConnected) {
        await ctx.pulse(getPos(sideInner).x + sideRunX - 30, getPos(sideInner).y + PILL_H / 2, COLORS.compact, 12, 900);
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
    const fromAbs = { x: getPos(sideInner).x + sideRunX - pillWidth('Summary'), y: getPos(sideInner).y };
    const toAbs = { x: getPos(mainInner).x + mainRunX, y: getPos(mainInner).y };
    summaryChip.remove();
    ctx.root.appendChild(summaryChip);
    setPos(summaryChip, fromAbs.x, fromAbs.y);
    await ctx.move(summaryChip, toAbs.x, toAbs.y, 700);
    await ctx.fade(summaryChip, 0, 200);
    summaryChip.remove();

    compactEndEntry = await appendMainPill('PromptCompactionEnd');

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
