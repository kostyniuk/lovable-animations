// "Streaming: partial events and field deltas"
//
// LLM (left) streams tokens -> Agent (mid-left) opens a partial and pushes
// PartialDeltas across a dashed "live side channel" to one or two browser
// tabs (right), which render text word by word. When a block finishes, the
// agent appends ONE solid event to the persisted Trajectory lane (bottom),
// sharing the partial's id, and every follower swaps its dashed in-flight
// copy for that authoritative event.

const W = 900, H = 480;

// ---------- layout ----------
const LLM = { x: 20, y: 70, w: 100, h: 110 };
const AGENT = { x: 190, y: 70, w: 120, h: 110 };
const TAB1 = { x: 470, y: 28, w: 260, h: 165 };
const TAB2 = { x: 470, y: 224, w: 260, h: 165 };
const BAND = { x: 10, y: 16, w: 870, h: 388 }; // live side channel
const LANE = { x: 20, y: 422, w: 860, h: 42 }; // trajectory
const LOG = { x: 24, y: 200, w: 380, h: 190 }; // wire log, under LLM/Agent
const ARROW_X = 440; // free vertical corridor between the log and the tabs

const AGENT_OUT = { x: AGENT.x + AGENT.w, y: AGENT.y + AGENT.h / 2 };
const LLM_OUT = { x: LLM.x + LLM.w, y: LLM.y + LLM.h / 2 };
const TAB1_IN = { x: TAB1.x, y: TAB1.y + TAB1.h / 2 };

const THINK_WORDS = ['Let', 'me', 'check', 'the', 'auth', 'flow', 'before', 'touching', 'the', 'route.'];
const CONTENT_WORDS = ["I've", 'reviewed', 'the', 'middleware —', 'updating', 'the', 'redirect', 'now.'];

function wrapText(node, text, maxWidth, fontSize, lh, maxLines = 3) {
  node.textContent = '';
  const charW = fontSize * 0.6;
  const perLine = Math.max(6, Math.floor(maxWidth / charW));
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (t.length > perLine && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  // keep only the tail so the bubble never overflows its slot
  const shown = lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
  shown.forEach((line, i) => {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    t.setAttribute('x', '8');
    t.setAttribute('y', 29 + i * lh);
    t.textContent = line;
    node.appendChild(t);
  });
  return lines.length;
}

export default {
  width: W, height: H,
  async build(ctx) {
    const { el, box, eventPill, setPos, colorOf, COLORS } = ctx;

    // ---- static scaffold ----
    el('rect', {
      x: BAND.x, y: BAND.y, width: BAND.w, height: BAND.h, rx: 12,
      fill: 'none', stroke: COLORS.muted, 'stroke-opacity': 0.35, 'stroke-dasharray': '5 4',
    });
    el('text', {
      x: BAND.x + 14, y: BAND.y + 18, class: 'mono', 'font-size': 10.5,
      fill: COLORS.muted, 'letter-spacing': '0.06em', text: 'LIVE SIDE CHANNEL · NOT PERSISTED',
    });

    el('rect', {
      x: LANE.x, y: LANE.y, width: LANE.w, height: LANE.h, rx: 10,
      fill: COLORS.panel, stroke: COLORS.line, 'stroke-width': 1.25,
    });
    el('text', {
      x: LANE.x + 12, y: LANE.y - 8, class: 'mono', 'font-size': 10.5,
      fill: COLORS.muted, 'letter-spacing': '0.06em', text: 'TRAJECTORY · PERSISTED',
    });

    const llmBox = box({ ...LLM, title: 'LLM' });
    const agentBox = box({ ...AGENT, title: 'Agent' });
    box({ ...TAB1, title: 'Browser tab 1' });

    el('text', { x: LLM.w / 2, y: LLM.h / 2 - 6, class: 'mono', 'font-size': 20, fill: COLORS.muted, text: '⋯', 'text-anchor': 'middle' }, llmBox);
    const llmTokenEl = el('text', {
      x: LLM.w / 2, y: LLM.h / 2 + 18, class: 'mono', 'font-size': 11, fill: COLORS.text,
      'text-anchor': 'middle', text: 'token stream',
    }, llmBox);
    const llmRecent = [];
    function pushToken(word) {
      llmRecent.push(word);
      if (llmRecent.length > 2) llmRecent.shift();
      llmTokenEl.textContent = llmRecent.join(' ');
    }

    // Agent's own live view: which partial(s) it currently has open, and how
    // many characters have accumulated in the field being edited.
    const agentIdEl = el('text', {
      x: AGENT.w / 2, y: AGENT.h / 2 - 2, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
      'text-anchor': 'middle', text: 'no open partial',
    }, agentBox);
    const agentDetailEl = el('text', {
      x: AGENT.w / 2, y: AGENT.h / 2 + 16, class: 'mono', 'font-size': 10.5, fill: COLORS.text,
      'text-anchor': 'middle', text: '',
    }, agentBox);
    function renderAgentPanel(open) {
      if (!open) {
        agentIdEl.setAttribute('fill', COLORS.muted);
        agentIdEl.textContent = 'no open partial';
        agentDetailEl.textContent = '';
        return;
      }
      const chars = open.words.join(' ').length;
      agentIdEl.setAttribute('fill', colorOf(open.kind));
      agentIdEl.textContent = open.id;
      agentDetailEl.textContent = `${open.kind} · ${chars} ch`;
    }

    // main static arrow: llm -> agent (raw model stream)
    ctx.arrow(LLM_OUT.x, LLM_OUT.y, AGENT.x, AGENT.y + AGENT.h / 2, { color: COLORS.muted, width: 1.25, dash: '3 3' });

    // ---- wire log: what actually goes out on the not-persisted channel ----
    el('text', {
      x: LOG.x, y: LOG.y - 8, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
      'letter-spacing': '0.06em', text: 'WIRE LOG',
    });
    const logGroup = el('g', {});
    const LOG_LH = 16, LOG_TOP = LOG.y + 14; // clear of the "WIRE LOG" label above
    const LOG_MAX = Math.max(3, Math.floor((LOG.h - 14) / LOG_LH));
    const logLines = [];
    function wireLog(text, color = COLORS.muted) {
      logLines.push({ text, color });
      if (logLines.length > LOG_MAX) logLines.shift();
      logGroup.innerHTML = '';
      logLines.forEach((entry, i) => {
        const fade = 0.4 + 0.6 * ((i + 1) / logLines.length);
        el('text', {
          x: LOG.x, y: LOG_TOP + i * LOG_LH, class: 'mono', 'font-size': 10.5,
          fill: entry.color, opacity: fade, text: entry.text,
        }, logGroup);
      });
    }

    // ---- trajectory lane state ----
    let laneX = LANE.x + 10;
    const laneY = LANE.y + LANE.h / 2 - 13;
    const persisted = [];
    function appendTrajectory({ type, label }) {
      const w = Math.max(70, label.length * 6.6 + 24);
      const p = eventPill({ x: laneX, y: laneY, type, label, w, h: 26 });
      if (persisted.length) {
        ctx.arrow(laneX - 4, laneY + 13, laneX, laneY + 13, { color: COLORS.line, width: 1, head: false, dash: '2 3' });
      }
      persisted.push({ type, label, pill: p, x: laneX, w });
      laneX += w + 14;
      return p;
    }

    // seed the trajectory with what's already happened
    appendTrajectory({ type: 'user', label: 'UserMessage' });
    appendTrajectory({ type: 'agent', label: 'AgentStart' });
    appendTrajectory({ type: 'iter', label: 'IterationStart' });

    // ---- browser tab bubble slots ----
    function makeTab(tabRect) {
      const thinkSlot = { x: tabRect.x + 14, y: tabRect.y + 30, w: tabRect.w - 28, h: 56 };
      const contentSlot = { x: tabRect.x + 14, y: tabRect.y + 96, w: tabRect.w - 28, h: 60 };
      // Where delta chips dock: right at the tab's own left border, in the
      // clear strip above the thinking bubble. Chips travel from the agent
      // (always to the tab's left) and stop at this threshold, so the
      // straight-line flight path never has to cross the bubble text to get
      // there — it arrives at the edge of the tab, not deep inside it.
      const dock = { x: tabRect.x + 6, y: tabRect.y + 16 };
      return { rect: tabRect, thinkSlot, contentSlot, dock, bubbles: {} };
    }
    const tab1 = makeTab(TAB1);
    let tab2 = null; // created on demand

    function bubbleSlot(tab, kind) { return kind === 'thinking' ? tab.thinkSlot : tab.contentSlot; }

    function createBubble(tab, kind, id) {
      removeBubble(tab, kind); // a slot only ever holds one in-flight block at a time
      const slot = bubbleSlot(tab, kind);
      const c = colorOf(kind);
      const g = el('g', {});
      setPos(g, slot.x, slot.y);
      const rect = el('rect', {
        width: slot.w, height: slot.h, rx: 8, fill: 'transparent',
        stroke: c, 'stroke-width': 1.25, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.9,
      }, g);
      const idLabel = el('text', {
        x: 8, y: 14, class: 'mono', 'font-size': 10.5, fill: c, text: `${kind} #${id}`,
      }, g);
      const txt = el('text', {
        x: 8, y: 29, 'font-size': 11, fill: COLORS.text, 'font-family': 'var(--sans)',
      }, g);
      const handle = { g, rect, idLabel, txt, words: [], kind, id, slot };
      tab.bubbles[kind] = handle;
      return handle;
    }

    function appendWord(handle, word) {
      handle.words.push(word);
      wrapText(handle.txt, handle.words.join(' '), handle.slot.w - 16, 11, 13);
    }

    function solidify(handle) {
      handle.rect.setAttribute('stroke-dasharray', null);
      handle.rect.setAttribute('stroke-opacity', 0.55);
      handle.rect.setAttribute('fill', COLORS.panel);
      handle.idLabel.textContent = `${handle.kind} #${handle.id}`; // drop any "(materialized)" suffix
    }

    function removeBubble(tab, kind) {
      const h = tab.bubbles[kind];
      if (h) { h.g.remove(); delete tab.bubbles[kind]; }
    }

    // ---- streaming state (so late joiners / refresh can read "now") ----
    const state = { openPartial: null }; // { id, kind, words }

    // Fly a small dashed chip from `from` to a tab's dock point — the tab's
    // own left border, in the clear strip above the bubble — so the flight
    // path never has to cross into the bubble text, then fade it out in
    // place before the caller mutates any text underneath.
    async function flyChip(from, tab, label, color, ms = 650) {
      const w = label.length * 6.2 + 20, h = 22;
      const toX = tab.dock.x, toY = tab.dock.y - h / 2;
      const fromX = from.x, fromY = from.y - h / 2;
      const g = eventPill({ x: fromX, y: fromY, name: label, label, w, h, partial: true });
      g.querySelector('rect').setAttribute('stroke', color);
      g.querySelector('text').setAttribute('fill', color);
      await ctx.animate(ms, (t) => {
        setPos(g, fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
      }, ctx.ease.out);
      await ctx.fade(g, 0, 120);
      g.remove();
    }

    async function openPartial(id, kind) {
      state.openPartial = { id, kind, words: [] };
      renderAgentPanel(state.openPartial);
      wireLog(`PartialOpened ${id} {type: ${kind}}`, COLORS.muted);
      await flyChip(AGENT_OUT, tab1, `PartialOpened ${id}`, COLORS.muted, 700);
      createBubble(tab1, kind, id);
      if (tab2) createBubble(tab2, kind, id);
    }

    async function sendDelta(word, kind) {
      state.openPartial.words.push(word);
      renderAgentPanel(state.openPartial);
      pushToken(word);
      wireLog(`PartialDelta ${state.openPartial.id} text += "${word}"`, colorOf(kind));
      // Capture each tab's bubble handle *now*, before the chip travels: a
      // join or a refresh can swap in a freshly materialized bubble mid-flight
      // (folding in whatever was already pushed above), so appending on
      // arrival must target the handle that was live when this delta was
      // sent — re-resolving after the await would double the word.
      const targets = [{ tab: tab1, handle: tab1.bubbles[kind] }];
      // Only fan out to tab2 once its bubble actually exists: a join can be
      // in progress (tab2 created but its partial not yet materialized), and
      // that materialization folds in whatever was already pushed above —
      // targeting a not-yet-created bubble would double-count that word.
      if (tab2 && tab2.bubbles[kind]) targets.push({ tab: tab2, handle: tab2.bubbles[kind] });
      await Promise.all(targets.map(async ({ tab, handle }) => {
        await flyChip(AGENT_OUT, tab, `+ '${word}'`, colorOf(kind), 550);
        if (handle) appendWord(handle, word);
      }));
    }

    async function closePartial(label) {
      const { id, kind } = state.openPartial;
      const persistedLabel = `${label} #${id}`;
      wireLog(`Event ${persistedLabel} (persisted)`, COLORS.text);
      const pill = appendTrajectory({ type: kind, label: persistedLabel });
      // Route as a right-angle drop through the free corridor at ARROW_X
      // (between the wire log and the browser tabs) so the dashed line never
      // crosses the log text on its way down to the trajectory lane.
      const dropY = AGENT.y + AGENT.h + 24;
      const arrowOpts = { color: COLORS.line, width: 1, dash: '2 3' };
      ctx.arrow(AGENT.x + AGENT.w / 2, AGENT.y + AGENT.h, ARROW_X, dropY, { ...arrowOpts, head: false });
      ctx.arrow(ARROW_X, dropY, ARROW_X, laneY, { ...arrowOpts, head: false });
      ctx.arrow(ARROW_X, laneY, pill._x + 6, laneY, arrowOpts);
      await Promise.all([
        ctx.pulse(pill._x + pill._w / 2, laneY + 13, colorOf(kind), 20, 550),
        ctx.pulse(tab1.rect.x + tab1.rect.w / 2, bubbleSlot(tab1, kind).y + 24, colorOf(kind), 20, 550),
        tab2 ? ctx.pulse(tab2.rect.x + tab2.rect.w / 2, bubbleSlot(tab2, kind).y + 24, colorOf(kind), 20, 550) : Promise.resolve(),
      ]);
      solidify(tab1.bubbles[kind]);
      if (tab2 && tab2.bubbles[kind]) solidify(tab2.bubbles[kind]);
      state.openPartial = null;
      renderAgentPanel(null);
    }

    async function streamBlock(kind, label, words) {
      await openPartial(`p_${Math.random().toString(16).slice(2, 6)}`, kind);
      for (const w of words) {
        if (!ctx.alive) return;
        await sendDelta(w, kind);
        await ctx.wait(70);
      }
      await closePartial(label);
    }

    // ---- late-tab join: batch replay + one materialized (folded) partial ----
    async function joinLateTab() {
      if (tab2) return;
      tab2 = makeTab(TAB2);
      const tabBox = box({ ...TAB2, title: 'Browser tab 2 (late join)' }, ctx.root);
      tabBox.setAttribute('opacity', 0);
      await ctx.fade(tabBox, 1, 300);

      // batch: persisted events replay as one compact burst
      wireLog(`Batch → tab2: ${persisted.length} persisted events`, COLORS.muted);
      const batch = eventPill({
        x: LANE.x + 10, y: TAB2.y - 34, name: 'batch',
        label: `batch: ${persisted.length} persisted events`, w: 210, h: 22, partial: true,
      });
      await ctx.move(batch, TAB2.x + 8, TAB2.y - 34, 500);
      await ctx.fade(batch, 0, 250);
      batch.remove();

      // one materialized partial, deltas already folded in
      if (state.openPartial) {
        const { id, kind, words } = state.openPartial;
        wireLog(`Materialize ${kind}#${id} (folded, ${words.length} deltas)`, colorOf(kind));
        const h = createBubble(tab2, kind, id);
        h.idLabel.textContent = `${kind} #${id} (materialized)`;
        wrapText(h.txt, words.join(' '), h.slot.w - 16, 11, 13);
        h.words = words.slice();
        await ctx.pulse(tab2.rect.x + tab2.rect.w / 2, bubbleSlot(tab2, kind).y + 24, colorOf(kind), 18, 500);
      }
    }

    async function refreshTab1() {
      for (const kind of ['thinking', 'content']) removeBubble(tab1, kind);
      await ctx.wait(250);
      if (state.openPartial) {
        const { id, kind, words } = state.openPartial;
        wireLog(`Materialize ${kind}#${id} (folded, ${words.length} deltas) → tab1`, colorOf(kind));
        const h = createBubble(tab1, kind, id);
        h.idLabel.textContent = `${kind} #${id} (materialized)`;
        wrapText(h.txt, words.join(' '), h.slot.w - 16, 11, 13);
        h.words = words.slice();
        await ctx.pulse(tab1.rect.x + tab1.rect.w / 2, bubbleSlot(tab1, kind).y + 24, colorOf(kind), 18, 500);
      }
    }

    ctx.button('Open a late tab', () => ctx.spawn(async () => {
      if (tab2) return;
      await joinLateTab();
    }));
    ctx.button('Refresh tab 1', () => ctx.spawn(async () => {
      await refreshTab1();
    }));

    // ================= main script =================
    await ctx.beat(
      'The trajectory already has <span class="mono">UserMessage</span>, <span class="mono">AgentStart</span>, ' +
      '<span class="mono">IterationStart</span>. The LLM starts producing a <span class="mono">thinking</span> block.'
    );

    await ctx.beat(
      'The agent opens a partial — <span class="mono">PartialOpened&nbsp;p_xxxx</span> — a dashed, unpersisted marker ' +
      'that travels straight to the browser. Tab 1 shows a dashed, in-flight thinking bubble.'
    );
    {
      const id = 'p_7f3a';
      state.openPartial = { id, kind: 'thinking', words: [] };
      renderAgentPanel(state.openPartial);
      wireLog(`PartialOpened ${id} {type: thinking}`, COLORS.muted);
      await flyChip(AGENT_OUT, tab1, `PartialOpened ${id}`, COLORS.muted, 700);
      createBubble(tab1, 'thinking', id);
    }

    await ctx.beat(
      'As tokens stream in, the agent pushes <span class="mono">PartialDelta</span> chips — small edits, ' +
      '"append this text". The trajectory lane below does <strong>not</strong> change.'
    );
    for (const w of THINK_WORDS) {
      if (!ctx.alive) return;
      await sendDelta(w, 'thinking');
      await ctx.wait(60);
    }

    await ctx.beat(
      'The block finishes. The agent appends one solid <span class="mono">thinking #p_7f3a</span> event to the ' +
      'trajectory, sharing the partial\'s id — the id flashes on both sides, and the browser swaps its dashed copy ' +
      'for the authoritative one.'
    );
    await closePartial('thinking');

    await ctx.beat('Now a <span class="mono">content</span> block streams the same way — same mechanism, different field.');
    await streamBlock('content', 'content', CONTENT_WORDS);

    await ctx.beat(
      'A second tab joins mid-stream. It gets the persisted events as one batch, plus any open partial ' +
      '<strong>materialized once</strong> — deltas already folded in — then follows the live channel in sync.'
    );
    {
      const id = `p_${Math.random().toString(16).slice(2, 6)}`;
      await openPartial(id, 'thinking');
      const half = THINK_WORDS.slice(0, 4);
      for (const w of half) { if (!ctx.alive) return; await sendDelta(w, 'thinking'); await ctx.wait(60); }
      await joinLateTab();
      const rest = THINK_WORDS.slice(4);
      for (const w of rest) { if (!ctx.alive) return; await sendDelta(w, 'thinking'); await ctx.wait(60); }
      await closePartial('thinking');
    }

    await ctx.beat(
      'Refreshes, reconnects, extra tabs — they all converge on the same trajectory, because the trajectory is ' +
      'the only thing that was ever written.'
    );
  },
};
