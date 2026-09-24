// "Putting it together: Chats" — the chat agent (workspace level) fans work
// out to project builders via send_message_to_project (= SendMessage: an
// ExternalAgentNotification appended to an inbox + an activation), and hears
// progress/results back over the same primitive.

const W = 900, H = 520;

const PROJECTS = [
  { key: 'marketing-site', label: 'marketing-site', abbr: 'mkt', cx: 320, ask: 'pricing page', files: 4, credits: '1.2', ok: true },
  { key: 'dashboard', label: 'dashboard', abbr: 'dash', cx: 515, ask: 'dark mode', files: 6, credits: '2.1', ok: true },
  { key: 'mobile-app', label: 'mobile-app', abbr: 'mob', cx: 710, ask: 'login bug fix', files: 2, credits: '0.8', ok: false },
];
const CARD_W = 170, CARD_Y = 200, CARD_H = 300;
const CHAT_X = 320, CHAT_Y = 20, CHAT_W = 560, CHAT_H = 160;
// The inbox mark lives on the bottom-center of the card's edge, so envelope
// paths never have to cross into the card interior (subtitle / trajectory
// chips) or diagonally through any project's title label.
const CHAT_INBOX = { x: CHAT_X + CHAT_W / 2, y: CHAT_Y + CHAT_H };

// ---------- small text-wrap helper (plain SVG <text>/<tspan>, no foreignObject) ----------
function wrap(str, maxChars) {
  const words = str.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export default {
  width: W, height: H,
  loop: false,
  async build(ctx) {
    const { COLORS, colorOf, el } = ctx;

    // ================= left: Chats transcript window =================
    ctx.box({ x: 20, y: 20, w: 280, h: 470, title: 'Chats' });
    const clip = el('clipPath', { id: 'chats-clip' }, ctx.svg.querySelector('defs') || el('defs', {}, ctx.svg));
    el('rect', { x: 20, y: 20, width: 280, height: 470, rx: 10 }, clip);
    const feed = el('g', { 'clip-path': 'url(#chats-clip)' });
    ctx.root.appendChild(feed);
    const feedInner = el('g', {}, feed);
    let feedY = 34;
    const FEED_X = 32, FEED_W = 256, FEED_BOTTOM = 480;

    async function scrollIfNeeded(nextY) {
      const overflow = nextY - FEED_BOTTOM;
      if (overflow > 0) {
        const p = ctx.getPos(feedInner);
        await ctx.move(feedInner, p.x, p.y - overflow, 380);
      }
    }

    // A chat bubble (user = orange-tinted right-ish, assistant = panel card).
    async function addBubble(text, { user = false } = {}) {
      const lines = wrap(text, 34);
      const lh = 15, padY = 10, h = lines.length * lh + padY * 2 - 3;
      const w = FEED_W;
      const g = el('g', {}, feedInner);
      ctx.setPos(g, FEED_X, feedY);
      el('rect', {
        width: w, height: h, rx: 9,
        fill: user ? 'rgba(255,138,61,0.12)' : COLORS.panel,
        stroke: user ? COLORS.user : COLORS.line,
        'stroke-width': 1.1, 'stroke-opacity': user ? 0.65 : 0.5,
      }, g);
      lines.forEach((ln, i) => {
        el('text', {
          x: 12, y: padY + 4 + i * lh, 'font-size': 12, fill: COLORS.text, text: ln,
        }, g);
      });
      g.setAttribute('opacity', 0);
      feedY += h + 10;
      await scrollIfNeeded(feedY);
      await ctx.fade(g, 1, 220);
      return g;
    }

    // A slim status/progress row with a colored dot + mono text (wraps if long).
    async function addRow(text, color) {
      const lines = wrap(text, 36);
      const lh = 14;
      const g = el('g', {}, feedInner);
      ctx.setPos(g, FEED_X, feedY);
      el('circle', { cx: 4, cy: 5, r: 4, fill: color }, g);
      lines.forEach((ln, i) => {
        el('text', { x: 14, y: 9 + i * lh, class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: ln }, g);
      });
      g.setAttribute('opacity', 0);
      feedY += 8 + lines.length * lh;
      await scrollIfNeeded(feedY);
      await ctx.fade(g, 1, 220);
      return g;
    }

    // ================= right-top: chat agent card =================
    ctx.box({ x: CHAT_X, y: CHAT_Y, w: CHAT_W, h: CHAT_H, title: 'chat agent · workspace' });
    el('text', {
      x: CHAT_X + 16, y: CHAT_Y + 30, 'font-size': 11, fill: COLORS.muted,
      text: 'own trajectory · sees every project',
    }, ctx.root);

    // inbox mark — sits on the card's bottom edge
    const chatInboxDot = el('circle', { cx: CHAT_INBOX.x, cy: CHAT_INBOX.y, r: 5, fill: COLORS.panel, stroke: COLORS.notify, 'stroke-width': 1.5 }, ctx.root);
    const chatInboxCount = el('text', {
      x: CHAT_INBOX.x, y: CHAT_INBOX.y - 12, class: 'mono', 'font-size': 10.5, fill: COLORS.notify,
      'text-anchor': 'middle', text: 'inbox',
    }, ctx.root);

    // the empty band between the subtitle and the trajectory strip: show the
    // three send_message_to_project(...) tool calls as they're emitted.
    const callLines = {};
    PROJECTS.forEach((p, i) => {
      const t = el('text', {
        x: CHAT_X + 16, y: CHAT_Y + 54 + i * 14, class: 'mono', 'font-size': 10.5, fill: COLORS.tool,
        text: `send_message_to_project(${p.label})`,
      }, ctx.root);
      t.setAttribute('opacity', 0);
      callLines[p.key] = t;
    });

    // horizontal trajectory strip (scrolling window)
    const stripDefs = ctx.svg.querySelector('defs') || el('defs', {}, ctx.svg);
    const stripClip = el('clipPath', { id: 'chat-strip-clip' }, stripDefs);
    const STRIP_X = CHAT_X + 20, STRIP_Y = CHAT_Y + 110, STRIP_W = CHAT_W - 40;
    el('rect', { x: STRIP_X, y: STRIP_Y - 2, width: STRIP_W, height: 24 }, stripClip);
    const stripG = el('g', { 'clip-path': 'url(#chat-strip-clip)' }, ctx.root);
    const stripInner = el('g', {}, stripG);
    ctx.setPos(stripInner, STRIP_X, STRIP_Y);
    el('text', { x: STRIP_X, y: STRIP_Y - 10, class: 'mono', 'font-size': 10, fill: COLORS.muted, text: 'TRAJECTORY' }, ctx.root);

    function makeStrip(inner, w, pillW = 62, pillH = 20, gap =6) {
      let cursor = 0, shift = 0;
      return {
        async push(label, type) {
          const p = ctx.eventPill({ x: cursor, y: 0, name: type, type, label, w: pillW, h: pillH }, inner);
          p.setAttribute('opacity', 0);
          cursor += pillW + gap;
          const overflow = cursor - shift - w;
          const promises = [ctx.fade(p, 1, 180)];
          if (overflow > 0) {
            shift += overflow;
            const pos = ctx.getPos(inner);
            promises.push(ctx.move(inner, pos.x - overflow, pos.y, 320));
          }
          await Promise.all(promises);
          return p;
        },
      };
    }
    const chatStrip = makeStrip(stripInner, STRIP_W, 92, 20, 6);

    // ================= right-bottom: project cards =================
    const projState = {};
    for (const p of PROJECTS) {
      const cardX = p.cx;
      // Anchor the guide line toward the right edge of the card: the box
      // title is left-aligned, so this keeps the line clear of the label
      // text (even for the longest project name) with room to spare.
      const anchorX = cardX + CARD_W - 20;
      ctx.box({ x: cardX, y: CARD_Y, w: CARD_W, h: CARD_H, title: p.label });
      const statusText = el('text', {
        x: cardX + 12, y: CARD_Y + 26, class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: 'idle',
      }, ctx.root);
      const inboxDot = el('circle', {
        cx: anchorX, cy: CARD_Y, r: 5, fill: COLORS.panel, stroke: COLORS.notify, 'stroke-width': 1.5,
      }, ctx.root);

      const pDefs = ctx.svg.querySelector('defs') || el('defs', {}, ctx.svg);
      const pClip = el('clipPath', { id: `strip-clip-${p.key}` }, pDefs);
      const SX = cardX + 12, SY = CARD_Y + 44, SW = CARD_W - 24, SH = CARD_H - 60;
      el('rect', { x: SX - 2, y: SY, width: SW + 4, height: SH }, pClip);
      const sg = el('g', { 'clip-path': `url(#strip-clip-${p.key})` }, ctx.root);
      const sinner = el('g', {}, sg);
      ctx.setPos(sinner, SX, SY);
      el('text', { x: SX, y: SY - 8, class: 'mono', 'font-size': 10, fill: COLORS.muted, text: 'TRAJECTORY' }, ctx.root);

      // vertical strip variant
      let cursor = 0, shift = 0;
      const vStrip = {
        async push(label, type) {
          const pillW = SW, pillH = 20;
          const pill = ctx.eventPill({ x: 0, y: cursor, name: type, type, label, w: pillW, h: pillH }, sinner);
          pill.setAttribute('opacity', 0);
          cursor += pillH + 6;
          const overflow = cursor - shift - SH;
          const jobs = [ctx.fade(pill, 1, 180)];
          if (overflow > 0) {
            shift += overflow;
            const pos = ctx.getPos(sinner);
            jobs.push(ctx.move(sinner, pos.x, pos.y - overflow, 320));
          }
          await Promise.all(jobs);
        },
      };

      projState[p.key] = {
        ...p, cardX, statusText, inboxDot, vStrip,
        anchorTop: { x: anchorX, y: CARD_Y },
        anchorBottom: { x: anchorX, y: CHAT_Y + CHAT_H },
      };
    }

    // ================= guide paths between chat agent and projects =================
    // Each project gets one straight vertical guide from the chat card's
    // bottom edge down to its own anchor. A shared horizontal "bus" runs
    // along that same bottom edge to the chat agent's inbox (bottom-center),
    // so envelopes travel down the vertical line, then sideways along the
    // edge — never crossing a label.
    const BUS_Y = CHAT_Y + CHAT_H;
    const busXs = PROJECTS.map((p) => p.cx + CARD_W - 20);
    el('path', {
      d: `M${Math.min(...busXs)},${BUS_Y} L${Math.max(...busXs)},${BUS_Y}`,
      fill: 'none', stroke: COLORS.notify, 'stroke-width': 1, 'stroke-opacity': 0.22, 'stroke-dasharray': '3 4',
    }, ctx.root);

    const guides = {};
    for (const key in projState) {
      const p = projState[key];
      const ax = p.anchorTop.x;
      const down = el('path', {
        d: `M${ax},${BUS_Y} L${ax},${CARD_Y}`, fill: 'none',
        stroke: COLORS.notify, 'stroke-width': 1, 'stroke-opacity': 0.28, 'stroke-dasharray': '3 4',
      }, ctx.root);
      // Up path shares the same visible vertical line, then rides the bus
      // sideways into the inbox — drawn invisibly since the visible guides
      // (vertical line + bus) already trace this exact route.
      const up = el('path', {
        d: `M${ax},${CARD_Y} L${ax},${BUS_Y} L${CHAT_INBOX.x},${BUS_Y}`,
        fill: 'none', stroke: 'none',
      }, ctx.root);
      guides[key] = { down, up };
    }

    // envelope: small notify-colored capsule that flies along a guide path
    async function flyEnvelope(path, ms = 900) {
      const g = el('g', {}, ctx.root);
      el('rect', { x: -8, y: -5, width: 16, height: 10, rx: 2, fill: COLORS.notify, opacity: 0.9 }, g);
      el('path', { d: 'M-8,-5 L0,1 L8,-5', fill: 'none', stroke: COLORS.bg, 'stroke-width': 1 }, g);
      await ctx.along(g, path, ms, ctx.ease.inOut);
      g.remove();
    }

    async function pulseInbox(dot, textEl) {
      const pos = { x: +dot.getAttribute('cx'), y: +dot.getAttribute('cy') };
      await Promise.all([
        ctx.pulse(pos.x, pos.y, COLORS.activation, 16, 500),
        (async () => {
          dot.setAttribute('fill', COLORS.notify);
          await ctx.wait(160);
          if (textEl) { /* no-op, count kept simple */ }
        })(),
      ]);
      dot.setAttribute('fill', COLORS.panel);
    }

    async function activation(x, y) {
      await ctx.pulse(x, y, COLORS.activation, 22, 650);
    }

    ctx.button('Send another task', () => ctx.spawn(() => followUp()));

    // Resolved the moment the first terminal (AgentDone) result notification
    // lands — lets the main flow hold its "running in parallel" caption
    // until a result has actually started arriving, instead of on a fixed
    // timer that can race ahead of (or lag behind) the animation.
    let resolveFirstResult;
    const firstResult = new Promise((res) => { resolveFirstResult = res; });

    async function runBuilder(key) {
      const st = projState[key];
      st.statusText.textContent = 'waking…';
      await activation(st.anchorTop.x, st.anchorTop.y - 20);
      st.statusText.textContent = 'running';
      st.statusText.setAttribute('fill', COLORS.iter);
      await st.vStrip.push('IterationStart', 'iter');
      await ctx.wait(1000);
      await st.vStrip.push('tool_call', 'tool');
      await ctx.wait(900);

      // mid-turn progress notification, flies back up
      await flyEnvelope(guides[key].up, 1100);
      await pulseInbox(chatInboxDot);
      await chatStrip.push(`Notif·${st.abbr}`, 'notify');
      await addRow(`${st.label}: ${st.ask}`, COLORS.notify);

      await ctx.wait(1000);
      await st.vStrip.push('IterationEnd', 'iter');
      await ctx.wait(700);
      await st.vStrip.push('AgentDone', 'agent');

      st.statusText.textContent = st.ok ? 'done' : 'failed';
      st.statusText.setAttribute('fill', st.ok ? COLORS.tool : COLORS.revert);

      // terminal notification, flies back up
      await flyEnvelope(guides[key].up, 1100);
      await pulseInbox(chatInboxDot);
      await chatStrip.push(`Notif·${st.abbr}`, 'notify');
      const check = st.ok ? '✓' : '✗';
      await addRow(
        `${st.label} ${check} ${st.files} files · ${st.credits}cr`,
        st.ok ? COLORS.tool : COLORS.revert,
      );
      resolveFirstResult();
      return st;
    }

    // ================= main script =================
    await ctx.beat(
      'The user asks the <b>chat agent</b> — running at the <b>workspace</b> level, on its own trajectory — for three things at once.',
    );
    await addBubble(
      'Add a pricing page to marketing-site, dark mode to dashboard, and fix the login bug in mobile-app',
      { user: true },
    );
    await chatStrip.push('UserMsg', 'user');
    await ctx.wait(300);

    await ctx.beat('It thinks, then calls <code>send_message_to_project</code> three times in one turn — one per project, in parallel.');
    await chatStrip.push('thinking', 'thinking');
    await addBubble('On it — sending instructions to all three projects.');

    // mark mobile-app as already mid-iteration (busy) before the message arrives
    projState['mobile-app'].statusText.textContent = 'busy (mid-turn)';
    projState['mobile-app'].statusText.setAttribute('fill', COLORS.iter);
    await projState['mobile-app'].vStrip.push('IterationStart', 'iter');
    await projState['mobile-app'].vStrip.push('tool_call', 'tool');

    await ctx.beat('Three <code>ExternalAgentNotification</code>s fly down, one per project inbox — the durable step. An activation follows each.');
    await Promise.all(
      PROJECTS.map(async (p, i) => {
        await ctx.wait(i * 180);
        await Promise.all([ctx.fade(callLines[p.key], 1, 220), chatStrip.push(`→ ${p.abbr}`, 'tool')]);
        await flyEnvelope(guides[p.key].down, 900);
        await pulseInbox(projState[p.key].inboxDot);
      }),
    );

    await addRow('marketing-site — notified', COLORS.notify);
    await addRow('dashboard — notified', COLORS.notify);
    await addRow('mobile-app — queued (busy)', COLORS.activation);

    await ctx.beat(
      '<b>marketing-site</b> and <b>dashboard</b> were asleep — they wake and start. <b>mobile-app</b> was already mid-iteration, so its message waits and folds in at the next <code>IterationEnd</code>.',
    );

    // mobile-app finishes its in-flight iteration, THEN admits the queued message
    await projState['mobile-app'].vStrip.push('IterationEnd', 'iter');
    await ctx.wait(200);
    projState['mobile-app'].statusText.textContent = 'admits queued msg';
    await ctx.pulse(projState['mobile-app'].anchorTop.x, projState['mobile-app'].anchorTop.y, COLORS.notify, 14, 500);

    await ctx.beat('All three builders run in parallel, at their own pace, picking up their trajectory exactly where each left off. Progress reports flow back up the same way.');

    const runPromise = Promise.all([
      runBuilder('marketing-site'),
      (async () => { await ctx.wait(900); return runBuilder('dashboard'); })(),
      (async () => { await ctx.wait(1800); return runBuilder('mobile-app'); })(),
    ]);

    // Hold the "running in parallel" caption until a result actually starts
    // arriving, rather than switching on a fixed timer that can race ahead
    // of (or lag behind) the animation.
    await firstResult;
    await ctx.beat('Each <code>AgentDone</code> triggers one more notification — terminal status and a result summary: credits, files changed, build status.');
    const [a, b, c] = await runPromise;
    await chatStrip.push('reply', 'content');
    await addBubble(
      `Done — pricing page live, dark mode shipped. ${c.ok ? '' : "mobile-app's fix needs another pass: the build failed on tests."}`.trim(),
    );

    await ctx.beat('Instructions down, progress and results up — all as notifications landing in inboxes. Try "Send another task", or Reset to replay.', 1400);

    async function followUp() {
      if (!ctx.alive) return;
      const target = projState['dashboard'];
      await addBubble('Also bump the font size on the dashboard settings page', { user: true });
      target.statusText.textContent = 'waking…';
      target.statusText.setAttribute('fill', COLORS.muted);
      await chatStrip.push(`→ ${target.abbr}`, 'tool');
      await flyEnvelope(guides['dashboard'].down, 800);
      await pulseInbox(target.inboxDot);
      await addRow('dashboard — notified', COLORS.notify);
      await activation(target.anchorTop.x, target.anchorTop.y - 20);
      target.statusText.textContent = 'running';
      target.statusText.setAttribute('fill', COLORS.iter);
      await target.vStrip.push('IterationStart', 'iter');
      await ctx.wait(500);
      await target.vStrip.push('tool_call', 'tool');
      await ctx.wait(500);
      await target.vStrip.push('AgentDone', 'agent');
      target.statusText.textContent = 'done';
      target.statusText.setAttribute('fill', COLORS.tool);
      await flyEnvelope(guides['dashboard'].up, 800);
      await pulseInbox(chatInboxDot);
      await chatStrip.push(`Notif·${target.abbr}`, 'notify');
      await addRow('dashboard ✓ 1 file · 0.3cr', COLORS.tool);
      await chatStrip.push('reply', 'content');
      await addBubble('Done — bumped the font size on dashboard settings.');
    }
  },
};
