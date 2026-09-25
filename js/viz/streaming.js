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
const BAND = { x: 10, y: 16, w: 880, h: 384 }; // live side channel
const LANE = { x: 10, y: 422, w: 880, h: 42 }; // trajectory
const PAD = 20; // band inner padding, left and right
const HEAD_Y = BAND.y + 18; // baseline shared by the band label and tab 1's title
const LLM = { x: BAND.x + PAD, y: 70, w: 120, h: 110 };
const AGENT = { x: LLM.x + LLM.w + 50, y: 70, w: 120, h: 110 };
// Tab interior: a 32-unit strip on top where delta chips dock, then two
// 52-unit bubbles (id row + two text lines) separated by 8, 14 padding.
const STRIP_H = 32, BUBBLE_H = 52, BUBBLE_GAP = 8, TAB_PAD = 14;
const TAB_W = 380, TAB_H = STRIP_H + BUBBLE_H * 2 + BUBBLE_GAP + TAB_PAD;
const TAB_X = BAND.x + BAND.w - PAD - TAB_W;
const TAB1 = { x: TAB_X, y: HEAD_Y + 8, w: TAB_W, h: TAB_H };
const TAB2 = { x: TAB_X, y: TAB1.y + TAB_H + 30, w: TAB_W, h: TAB_H };
const LOG = { x: LLM.x, y: 200, w: 380, h: BAND.y + BAND.h - 12 - 200 }; // wire log, under LLM/Agent
const ARROW_X = 440; // free vertical corridor between the log and the tabs
const MONO_CH = 6.6; // advance of an 11px mono glyph

const AGENT_OUT = { x: AGENT.x + AGENT.w, y: AGENT.y + AGENT.h / 2 };
const LLM_OUT = { x: LLM.x + LLM.w, y: LLM.y + LLM.h / 2 };

const THINK_WORDS = ['Let', 'me', 'check', 'the', 'auth', 'flow', 'before', 'touching', 'the', 'route.'];
const CONTENT_WORDS = ["I've", 'reviewed', 'the', 'middleware —', 'updating', 'the', 'redirect', 'now.'];

function wrapText(node, text, maxWidth, fontSize, lh, maxLines = 3) {
  node.textContent = '';
  const charW = fontSize * 0.55; // average advance of the sans body face
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

// Seeded per run (ctx.random) so step-back replays make the same choices.
let rand = Math.random;

export default {
  width: W, height: H,
  async build(ctx) {
    rand = ctx.random;
    const { el, box, eventPill, setPos, colorOf, COLORS } = ctx;

    // ---- static scaffold ----
    el('rect', {
      x: BAND.x, y: BAND.y, width: BAND.w, height: BAND.h, rx: 12,
      fill: 'none', stroke: COLORS.muted, 'stroke-opacity': 0.35, 'stroke-dasharray': '5 4',
    });
    el('text', {
      x: BAND.x + 12, y: HEAD_Y, class: 'mono', 'font-size': 10.5,
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

    // Both boxes show two rows at the same heights: h/2 -/+ 10.
    const ROW1 = LLM.h / 2 - 10, ROW2 = LLM.h / 2 + 10;
    el('text', { x: LLM.w / 2, y: ROW1, class: 'mono', 'font-size': 20, fill: COLORS.muted, text: '⋯', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, llmBox);
    const llmTokenEl = el('text', {
      x: LLM.w / 2, y: ROW2, class: 'mono', 'font-size': 11, fill: COLORS.text,
      'text-anchor': 'middle', 'dominant-baseline': 'central', text: 'token stream',
    }, llmBox);
    const LLM_MAX_CH = Math.floor((LLM.w - 16) / MONO_CH); // keep 8 units clear of each border
    const llmRecent = [];
    function pushToken(word) {
      llmRecent.push(word);
      while (llmRecent.length > 2 || (llmRecent.length > 1 && llmRecent.join(' ').length > LLM_MAX_CH)) llmRecent.shift();
      llmTokenEl.textContent = llmRecent.join(' ');
    }

    // Agent's own live view: which partial(s) it currently has open, and how
    // many characters have accumulated in the field being edited.
    const agentIdEl = el('text', {
      x: AGENT.w / 2, y: AGENT.h / 2, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
      'text-anchor': 'middle', 'dominant-baseline': 'central', text: 'no open partial',
    }, agentBox);
    const agentDetailEl = el('text', {
      x: AGENT.w / 2, y: ROW2, class: 'mono', 'font-size': 10.5, fill: COLORS.text,
      'text-anchor': 'middle', 'dominant-baseline': 'central', text: '',
    }, agentBox);
    function renderAgentPanel(open) {
      if (!open) {
        agentIdEl.setAttribute('fill', COLORS.muted);
        agentIdEl.setAttribute('y', AGENT.h / 2); // lone row: box middle
        agentIdEl.textContent = 'no open partial';
        agentDetailEl.textContent = '';
        return;
      }
      const chars = open.words.join(' ').length;
      agentIdEl.setAttribute('fill', colorOf(open.kind));
      agentIdEl.setAttribute('y', ROW1);
      agentIdEl.textContent = open.id;
      agentDetailEl.textContent = `${open.kind} · ${chars} ch`;
    }

    // main static arrow: llm -> agent (raw model stream)
    ctx.arrow(LLM_OUT.x, LLM_OUT.y, AGENT.x, LLM_OUT.y, { color: COLORS.muted, width: 1.25, dash: '3 3' });

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
    const PILL_H = 26;
    let laneX = LANE.x + 10;
    const laneY = LANE.y + (LANE.h - PILL_H) / 2;
    const persisted = [];
    function appendTrajectory({ type, label }) {
      const w = Math.max(70, label.length * MONO_CH + 24);
      const p = eventPill({ x: laneX, y: laneY, type, label, w, h: PILL_H });
      const prev = persisted[persisted.length - 1];
      if (prev) {
        // bridge the whole gap: previous pill's right edge -> this pill's left edge
        ctx.arrow(prev.x + prev.w, laneY + PILL_H / 2, laneX, laneY + PILL_H / 2, { color: COLORS.line, width: 1, head: false, dash: '2 3' });
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
      const x = tabRect.x + TAB_PAD, w = tabRect.w - 2 * TAB_PAD;
      const thinkSlot = { x, y: tabRect.y + STRIP_H, w, h: BUBBLE_H };
      const contentSlot = { x, y: thinkSlot.y + BUBBLE_H + BUBBLE_GAP, w, h: BUBBLE_H };
      // Where delta chips dock: the clear strip above the thinking bubble,
      // left-aligned with the bubbles. Chips come in from the tab's left.
      const dock = { x, y: tabRect.y + STRIP_H / 2 };
      return { rect: tabRect, thinkSlot, contentSlot, dock, bubbles: {} };
    }
    const tab1 = makeTab(TAB1);
    let tab2 = null; // created on demand

    function bubbleSlot(tab, kind) { return kind === 'thinking' ? tab.thinkSlot : tab.contentSlot; }
    function pulseBubble(tab, kind, r, ms) {
      const s = bubbleSlot(tab, kind);
      return ctx.pulse(s.x + s.w / 2, s.y + s.h / 2, colorOf(kind), r, ms);
    }

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
      wrapText(handle.txt, handle.words.join(' '), handle.slot.w - 16, 11, 13, 2);
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

    // A dashed chip whose label is centered vertically and padded 10 each side.
    function chip(x, y, label, color, name = label) {
      const h = 22, w = label.length * MONO_CH + 20;
      const g = eventPill({ x, y, name, label, w, h, partial: true });
      const t = g.querySelector('text');
      t.setAttribute('y', h / 2);
      t.setAttribute('dominant-baseline', 'central');
      if (color) { g.querySelector('rect').setAttribute('stroke', color); t.setAttribute('fill', color); }
      return g;
    }

    // Fly a chip along a polyline (points are top-left corners) so that it
    // lands exactly on the last point.
    function flyPath(g, pts, ms) {
      const segs = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        segs.push({ a: pts[i - 1], b: pts[i], len });
        total += len;
      }
      return ctx.animate(ms, (t) => {
        let d = t * total;
        for (const s of segs) {
          if (d <= s.len || s === segs[segs.length - 1]) {
            const k = s.len ? Math.min(1, d / s.len) : 1;
            setPos(g, s.a.x + (s.b.x - s.a.x) * k, s.a.y + (s.b.y - s.a.y) * k);
            return;
          }
          d -= s.len;
        }
      }, ctx.ease.out);
    }

    // Fly a small dashed chip from `from` to a tab's dock strip, then fade it
    // out in place before the caller mutates any text underneath. It first
    // flies to a staging point outside the tab, level with the strip, then
    // slides straight in — so its body never passes over the bubble text.
    async function flyChip(from, tab, label, color, ms = 650) {
      const g = chip(from.x, from.y - 11, label, color);
      const y = tab.dock.y - g._h / 2;
      const stage = { x: tab.rect.x - 8 - g._w, y };
      await flyPath(g, [{ x: from.x, y: from.y - g._h / 2 }, stage, { x: tab.dock.x, y }], ms);
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
      // Orthogonal route: down from the agent's bottom center into the lane
      // between the agent and the log's first line, across to the free
      // corridor at ARROW_X (between the log and the tabs), down to the lane
      // between the band's bottom border and the trajectory box, across to
      // the pill's center, and down onto its top edge.
      const ax = AGENT.x + AGENT.w / 2, ay = AGENT.y + AGENT.h;
      const dropY = (ay + LOG_TOP - 8) / 2; // 8 = cap height of the first log line
      const jogY = (BAND.y + BAND.h + LANE.y) / 2;
      const px = pill._x + pill._w / 2;
      el('path', {
        d: `M${ax},${ay} V${dropY} H${ARROW_X} V${jogY} H${px}`,
        fill: 'none', stroke: COLORS.line, 'stroke-width': 1, 'stroke-dasharray': '2 3',
      });
      ctx.arrow(px, jogY, px, laneY, { color: COLORS.line, width: 1, dash: '2 3' });
      await Promise.all([
        ctx.pulse(px, laneY + PILL_H / 2, colorOf(kind), 20, 550),
        pulseBubble(tab1, kind, 20, 550),
        tab2 ? pulseBubble(tab2, kind, 20, 550) : Promise.resolve(),
      ]);
      solidify(tab1.bubbles[kind]);
      if (tab2 && tab2.bubbles[kind]) solidify(tab2.bubbles[kind]);
      state.openPartial = null;
      renderAgentPanel(null);
    }

    async function streamBlock(kind, label, words) {
      await openPartial(`p_${rand().toString(16).slice(2, 6)}`, kind);
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
      // It rises out of the next free slot in the lane into tab 2's (still
      // empty) dock strip.
      const batch = chip(0, 0, `batch: ${persisted.length} persisted events`, null, 'batch');
      const bx = Math.min(laneX, LANE.x + LANE.w - 10 - batch._w);
      setPos(batch, bx, laneY + (PILL_H - batch._h) / 2);
      await ctx.move(batch, tab2.dock.x, tab2.dock.y - batch._h / 2, 500);
      await ctx.fade(batch, 0, 250);
      batch.remove();

      // one materialized partial, deltas already folded in
      if (state.openPartial) {
        const { id, kind, words } = state.openPartial;
        wireLog(`Materialize ${kind}#${id} (folded, ${words.length} deltas)`, colorOf(kind));
        const h = createBubble(tab2, kind, id);
        h.idLabel.textContent = `${kind} #${id} (materialized)`;
        wrapText(h.txt, words.join(' '), h.slot.w - 16, 11, 13, 2);
        h.words = words.slice();
        await pulseBubble(tab2, kind, 18, 500);
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
        wrapText(h.txt, words.join(' '), h.slot.w - 16, 11, 13, 2);
        h.words = words.slice();
        await pulseBubble(tab1, kind, 18, 500);
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

    await ctx.beat('Now a <span class="mono">content</span> block streams the same way — same mechanism, different event kind.');
    await streamBlock('content', 'content', CONTENT_WORDS);

    await ctx.beat(
      'A second tab joins mid-stream. It gets the persisted events as one batch, plus any open partial ' +
      '<strong>materialized once</strong> — deltas already folded in — then follows the live channel in sync.'
    );
    {
      const id = `p_${rand().toString(16).slice(2, 6)}`;
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
