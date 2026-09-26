// "Putting it together: Chats" — the chat agent (workspace level) fans work
// out to project builders. Nothing ever goes agent-to-agent: every envelope,
// both send_message_to_project (down) and progress/results (up via
// NotifyParents), rides through the Agent Control Plane — appended to the
// recipient's inbox, then an activation wakes it — before it ever reaches a
// project card. The chat agent's own inbox works the same way: a UserMessage
// or an ExternalAgentNotification lands there first and only gets copied onto
// its trajectory when it's admitted, at run start or an iteration boundary —
// never straight onto the strip the moment it arrives.

const W = 900, H = 480;

const PROJECTS = [
  {
    key: 'marketing-site', label: 'marketing-site', abbr: 'mkt', cx: 320, ask: 'pricing page',
    message: 'add a pricing page with three tiers', files: 4, credits: '1.2', ok: true,
  },
  {
    key: 'dashboard', label: 'dashboard', abbr: 'dash', cx: 515, ask: 'dark mode',
    message: 'add a dark-mode toggle to settings; persist per user', files: 6, credits: '2.1', ok: true,
  },
  {
    key: 'mobile-app', label: 'mobile-app', abbr: 'mob', cx: 710, ask: 'login bug fix',
    message: 'fix the login bug on password reset', files: 2, credits: '0.8', ok: false,
  },
];
const PAD = 12; // inner padding of cards and the transcript window
const INBOX_R = 5; // inbox circle radius
const CHAT_X = 320, CHAT_Y = 20, CHAT_W = 560, CHAT_H = 134;
// The inbox mark lives on the bottom-center of the card's edge, so envelope
// paths never have to cross into the card interior (subtitle / trajectory
// chips) or diagonally through any project's title label.
const CHAT_INBOX = { x: CHAT_X + CHAT_W / 2, y: CHAT_Y + CHAT_H };

// The Agent Control Plane: a slim bar every message must cross, spanning the
// full width of the project row (same style as the hero: 18 tall, fully
// rounded, label vertically centered inside). The chat agent connects to its
// top edge; each project connects to its bottom edge, lined up with that
// project's own inbox x. Messages ride the bar's center line between those
// stubs — never box to box.
const BAR_X = CHAT_X, BAR_W = CHAT_W, BAR_Y = CHAT_Y + CHAT_H + 20, BAR_H = 18;
const BAR_MID = BAR_Y + BAR_H / 2;

// Project cards sit far enough below the bar for the "already running · ack"
// tag to fit between the bar and the card titles. CARD_H is sized to the
// longest trajectory any project reaches (mobile-app: 3 pills from its busy
// fold-in + 4 more from its own run = 7): the strip (CARD_H - 56) fits exactly
// 7 pills, and the cards end level with the transcript window.
const CARD_W = 170, CARD_Y = BAR_Y + BAR_H + 36, CARD_H = 232;
// A project's inbox sits on its card's top edge, toward the right: the card
// title is left-aligned above the card, so the stub into the bar stays clear
// of even the longest project name.
const INBOX_INSET = 15;
const inboxX = (p) => p.cx + CARD_W - INBOX_INSET;
const ENV_HALF_W = 9; // the envelope glyph is 18 wide
// The bar label is centered in the stretch of bar left of every route (up
// to the envelope's edge at the leftmost project stub), so no envelope ever
// travels across it.
const BAR_LABEL_X = (BAR_X + inboxX(PROJECTS[0]) - ENV_HALF_W) / 2;

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
    // Same outer margin (20) on all four sides of the figure.
    const WIN_X = 20, WIN_Y = 20, WIN_W = 280, WIN_H = H - 40;
    ctx.box({ x: WIN_X, y: WIN_Y, w: WIN_W, h: WIN_H, title: 'Chats' });
    const clip = el('clipPath', { id: 'chats-clip' }, ctx.svg.querySelector('defs') || el('defs', {}, ctx.svg));
    el('rect', { x: WIN_X, y: WIN_Y, width: WIN_W, height: WIN_H, rx: 10 }, clip);
    const feed = el('g', { 'clip-path': 'url(#chats-clip)' });
    ctx.root.appendChild(feed);
    const feedInner = el('g', {}, feed);
    const FEED_X = WIN_X + PAD, FEED_W = WIN_W - 2 * PAD, FEED_BOTTOM = WIN_Y + WIN_H - PAD;
    const FEED_GAP = 10;
    let feedY = WIN_Y + PAD;

    // Scrolls so the newest item's bottom edge sits PAD above the window's.
    // Moves to an absolute target, so concurrent rows never compound.
    let feedShift = 0;
    async function scrollIfNeeded(bottom) {
      const overflow = bottom - feedShift - FEED_BOTTOM;
      if (overflow > 0) {
        feedShift += overflow;
        await ctx.move(feedInner, 0, -feedShift, 380);
      }
    }

    // A chat bubble (user = orange-tinted right-ish, assistant = panel card).
    async function addBubble(text, { user = false } = {}) {
      const lines = wrap(text, 34);
      const lh = 15, padY = 9, h = lines.length * lh + padY * 2;
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
          x: PAD, y: padY + lh / 2 + i * lh, 'dominant-baseline': 'central',
          'font-size': 12, fill: COLORS.text, text: ln,
        }, g);
      });
      g.setAttribute('opacity', 0);
      const bottom = feedY + h;
      feedY = bottom + FEED_GAP;
      await scrollIfNeeded(bottom);
      await ctx.fade(g, 1, 220);
      return g;
    }

    // A slim status/progress row with a colored dot + mono text (wraps if long).
    async function addRow(text, color) {
      const lines = wrap(text, 36);
      const lh = 14, rowH = 10; // one line of 10.5 mono, dot centered on it
      const g = el('g', {}, feedInner);
      ctx.setPos(g, FEED_X, feedY);
      el('circle', { cx: 4, cy: rowH / 2, r: 4, fill: color }, g);
      lines.forEach((ln, i) => {
        el('text', {
          x: 14, y: rowH / 2 + i * lh, 'dominant-baseline': 'central',
          class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: ln,
        }, g);
      });
      g.setAttribute('opacity', 0);
      const bottom = feedY + rowH + (lines.length - 1) * lh;
      feedY = bottom + FEED_GAP;
      await scrollIfNeeded(bottom);
      await ctx.fade(g, 1, 220);
      return g;
    }

    // ================= right-top: chat agent card =================
    // Inner layout: 16 in from the left, with the trajectory strip 16 above
    // the bottom edge.
    const CHAT_PAD = 16;
    ctx.box({ x: CHAT_X, y: CHAT_Y, w: CHAT_W, h: CHAT_H, title: 'chat agent · workspace' });
    el('text', {
      x: CHAT_X + CHAT_PAD, y: CHAT_Y + 20, 'dominant-baseline': 'central', 'font-size': 11, fill: COLORS.muted,
      text: 'own trajectory · sees every project',
    }, ctx.root);
    // Running / idle readout, right-aligned on the same line as the subtitle.
    const chatStatusText = el('text', {
      x: CHAT_X + CHAT_W - CHAT_PAD, y: CHAT_Y + 20, 'text-anchor': 'end', 'dominant-baseline': 'central',
      class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: 'asleep',
    }, ctx.root);

    // inbox mark — sits on the card's bottom edge; its label sits beside it,
    // centered in the gap between the card and the bar (clear of the strip
    // and of envelopes riding the stub). The count is truthful: it only ever
    // shows what hasn't yet been admitted onto the trajectory.
    const chatInboxDot = el('circle', { cx: CHAT_INBOX.x, cy: CHAT_INBOX.y, r: INBOX_R, fill: COLORS.panel, stroke: COLORS.notify, 'stroke-width': 1.5 }, ctx.root);
    const chatInboxLabel = el('text', {
      x: CHAT_INBOX.x + ENV_HALF_W + 6, y: (CHAT_INBOX.y + BAR_Y) / 2, 'dominant-baseline': 'central',
      class: 'mono', 'font-size': 10, fill: COLORS.notify, text: 'inbox',
    }, ctx.root);
    function setChatInboxCount(n) {
      chatInboxLabel.textContent = n > 0 ? `inbox · ${n}` : 'inbox';
    }

    // the empty band between the subtitle and the trajectory strip: each
    // project's send_message_to_project(...) call, together with the
    // SELF-CONTAINED message the chat agent wrote for it — the builder will
    // only ever see this one line, never the chat thread it was derived from.
    const callLines = {};
    PROJECTS.forEach((p, i) => {
      const rowY = CHAT_Y + 38 + i * 15;
      const line = el('text', {
        x: CHAT_X + CHAT_PAD, y: rowY, 'dominant-baseline': 'central', class: 'mono', 'font-size': 9.5,
      }, ctx.root);
      el('tspan', { fill: COLORS.tool, text: `→ ${p.label}: ` }, line);
      el('tspan', { fill: COLORS.muted, text: `"${p.message}"` }, line);
      line.setAttribute('opacity', 0);
      callLines[p.key] = line;
    });

    // horizontal trajectory strip (scrolling window)
    const stripDefs = ctx.svg.querySelector('defs') || el('defs', {}, ctx.svg);
    const stripClip = el('clipPath', { id: 'chat-strip-clip' }, stripDefs);
    const STRIP_H = 20;
    const STRIP_X = CHAT_X + CHAT_PAD, STRIP_Y = CHAT_Y + CHAT_H - CHAT_PAD - STRIP_H, STRIP_W = CHAT_W - 2 * CHAT_PAD;
    el('rect', { x: STRIP_X, y: STRIP_Y - 2, width: STRIP_W, height: STRIP_H + 4 }, stripClip);
    const stripG = el('g', { 'clip-path': 'url(#chat-strip-clip)' }, ctx.root);
    const stripInner = el('g', {}, stripG);
    ctx.setPos(stripInner, STRIP_X, STRIP_Y);
    el('text', {
      x: STRIP_X, y: STRIP_Y - 10, 'dominant-baseline': 'central', class: 'mono', 'font-size': 10,
      fill: COLORS.muted, 'letter-spacing': '0.06em', text: 'TRAJECTORY',
    }, ctx.root);

    function makeStrip(inner, w, pillW = 62, pillH = 20, gap = 6) {
      let cursor = 0, shift = 0;
      const { x: x0, y: y0 } = ctx.getPos(inner);
      return {
        async push(label, type) {
          const p = ctx.eventPill({ x: cursor, y: 0, name: type, type, label, w: pillW, h: pillH }, inner);
          p.setAttribute('opacity', 0);
          cursor += pillW + gap;
          const overflow = cursor - gap - shift - w;
          const promises = [ctx.fade(p, 1, 180)];
          if (overflow > 0) {
            // absolute target, so concurrent pushes never compound
            shift += overflow;
            promises.push(ctx.move(inner, x0 - shift, y0, 320));
          }
          await Promise.all(promises);
          return p;
        },
      };
    }
    const chatStrip = makeStrip(stripInner, STRIP_W, 112, STRIP_H, 6);

    // ================= the Agent Control Plane =================
    // A slim bar spanning the full project row. The chat agent connects to
    // its top edge (aligned with its own inbox); each project connects to
    // its bottom edge (aligned with its own inbox). The label sits
    // vertically centered in the bar, in the stretch no route crosses —
    // muted at rest, naming the call in flight while a message rides through.
    el('rect', {
      x: BAR_X, y: BAR_Y, width: BAR_W, height: BAR_H, rx: BAR_H / 2,
      fill: COLORS.panel, stroke: COLORS.line, 'stroke-width': 1,
    }, ctx.root);
    const BAR_TITLE = 'AGENT CONTROL PLANE';
    const barTitle = el('text', {
      x: BAR_LABEL_X, y: BAR_MID, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      class: 'mono', 'font-size': 10, fill: COLORS.muted, 'letter-spacing': '0.08em', text: BAR_TITLE,
    }, ctx.root);

    // Faint, permanent wiring (solid, low-opacity — the physical connection)
    // from the inbox circle's edge to the bar's outer edge. The animated
    // dashed line that actually shows a message riding a leg is drawn
    // separately, on top, only while that leg is traveling.
    el('path', {
      d: `M${CHAT_INBOX.x},${CHAT_INBOX.y + INBOX_R} L${CHAT_INBOX.x},${BAR_Y}`,
      fill: 'none', stroke: COLORS.notify, 'stroke-width': 1, 'stroke-opacity': 0.16,
    }, ctx.root);

    // A single shared label riding the bar: shows which ACP call currently
    // holds a message. Under concurrent traffic, the newest drop simply
    // pre-empts whichever label is showing (a token check, rather than a
    // queue), so the label never lags behind the message it's meant to
    // describe and never stacks two calls on top of each other.
    let labelToken = 0;
    async function showBarLabel(text, color) {
      const token = ++labelToken;
      await ctx.fade(barTitle, 0, 80);
      if (token !== labelToken) return;
      barTitle.textContent = text;
      barTitle.setAttribute('fill', color);
      barTitle.setAttribute('letter-spacing', '0');
      await ctx.fade(barTitle, 1, 120);
      await ctx.wait(260);
      if (token !== labelToken) return;
      await ctx.fade(barTitle, 0, 140);
      if (token !== labelToken) return;
      barTitle.textContent = BAR_TITLE;
      barTitle.setAttribute('fill', COLORS.muted);
      barTitle.setAttribute('letter-spacing', '0.08em');
      await ctx.fade(barTitle, 1, 140);
    }

    // ================= right-bottom: project cards =================
    const projState = {};
    for (const p of PROJECTS) {
      const cardX = p.cx;
      const anchorX = inboxX(p);
      ctx.box({ x: cardX, y: CARD_Y, w: CARD_W, h: CARD_H, title: p.label });
      // Inner layout: status row, TRAJECTORY header, then the pill strip,
      // PAD in from the sides and bottom.
      const statusText = el('text', {
        x: cardX + PAD, y: CARD_Y + 18, 'dominant-baseline': 'central',
        class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: 'idle',
      }, ctx.root);

      const pDefs = ctx.svg.querySelector('defs') || el('defs', {}, ctx.svg);
      const pClip = el('clipPath', { id: `strip-clip-${p.key}` }, pDefs);
      const SX = cardX + PAD, SY = CARD_Y + 44, SW = CARD_W - 2 * PAD, SH = CARD_H - 44 - PAD;
      el('rect', { x: SX - 2, y: SY - 1, width: SW + 4, height: SH + 2 }, pClip);
      const sg = el('g', { 'clip-path': `url(#strip-clip-${p.key})` }, ctx.root);
      const sinner = el('g', {}, sg);
      ctx.setPos(sinner, SX, SY);
      el('text', {
        x: SX, y: SY - 10, 'dominant-baseline': 'central', class: 'mono', 'font-size': 10,
        fill: COLORS.muted, 'letter-spacing': '0.06em', text: 'TRAJECTORY',
      }, ctx.root);

      // vertical strip variant
      let cursor = 0, shift = 0;
      const vStrip = {
        async push(label, type) {
          const pillW = SW, pillH = 20;
          const pill = ctx.eventPill({ x: 0, y: cursor, name: type, type, label, w: pillW, h: pillH }, sinner);
          pill.setAttribute('opacity', 0);
          cursor += pillH + 6;
          // Compare the pill's actual bottom edge (cursor minus the trailing
          // gap it just added) against the available height — not cursor
          // itself, which overcounts by one gap and was triggering a scroll
          // one pill early, tucking the first pill under the TRAJECTORY
          // label once a card reached its max content.
          const overflow = (cursor - 6) - shift - SH;
          const jobs = [ctx.fade(pill, 1, 180)];
          if (overflow > 0) {
            shift += overflow;
            jobs.push(ctx.move(sinner, SX, SY - shift, 320));
          }
          await Promise.all(jobs);
        },
      };

      projState[p.key] = {
        ...p, cardX, statusText, vStrip,
        anchorTop: { x: anchorX, y: CARD_Y },
      };

      // the project's own stub into the bar — same x as its inbox, so the
      // envelope drops straight down with no diagonal (faint, permanent,
      // from the bar's outer bottom edge to the inbox circle's edge).
      el('path', {
        d: `M${anchorX},${BAR_Y + BAR_H} L${anchorX},${CARD_Y - INBOX_R}`,
        fill: 'none', stroke: COLORS.notify, 'stroke-width': 1, 'stroke-opacity': 0.16,
      }, ctx.root);
      const inboxDot = el('circle', {
        cx: anchorX, cy: CARD_Y, r: INBOX_R, fill: COLORS.panel, stroke: COLORS.notify, 'stroke-width': 1.5,
      }, ctx.root);
      projState[p.key].inboxDot = inboxDot;
    }

    // ================= envelope routes, in two legs through the bar =================
    // A message never travels sender -> recipient in one continuous flight.
    // It goes sender -> bar (leg 1), drops there and pauses, then ACP sends
    // it on, bar -> recipient's inbox (leg 2, a separate and faster hop).
    function acpPoints(key, direction) {
      const ax = projState[key].anchorTop.x;
      return direction === 'down'
        ? {
          p0: { x: CHAT_INBOX.x, y: CHAT_INBOX.y },
          pMid: { x: CHAT_INBOX.x, y: BAR_MID },
          pDrop: { x: ax, y: BAR_MID },
          p3: { x: ax, y: CARD_Y },
        }
        : {
          p0: { x: ax, y: CARD_Y },
          pMid: { x: ax, y: BAR_MID },
          pDrop: { x: CHAT_INBOX.x, y: BAR_MID },
          p3: { x: CHAT_INBOX.x, y: CHAT_INBOX.y },
        };
    }

    // The envelope glyph, identical to the hero's.
    function envelope() {
      const g = el('g', {}, ctx.root);
      el('rect', { x: -ENV_HALF_W, y: -6, width: 2 * ENV_HALF_W, height: 12, rx: 2, fill: COLORS.panel, stroke: COLORS.notify, 'stroke-width': 1.4 }, g);
      el('path', { d: `M${-ENV_HALF_W},-6 L0,1 L${ENV_HALF_W},-6`, fill: 'none', stroke: COLORS.notify, 'stroke-width': 1.4 }, g);
      return g;
    }

    // Flies the envelope along `d`. The dashed path itself is only drawn
    // while this one leg is traveling.
    async function flyLeg(env, d, ms = 700) {
      const guide = el('path', {
        d, fill: 'none', stroke: COLORS.notify, 'stroke-width': 1.1,
        'stroke-dasharray': '3 3', opacity: 0,
      }, ctx.root);
      env.parentNode.appendChild(env); // keep the envelope above its guide
      try {
        await ctx.fade(guide, 0.5, 100);
        await ctx.along(env, guide, ms, ctx.ease.inOut);
        await ctx.fade(guide, 0, 140);
      } finally {
        guide.remove();
      }
    }

    // The full two-leg carry: sender -> bar (drop, pulse, shared label) ->
    // recipient's inbox (faster leg). Returns once the message has landed.
    // For 'down' deliveries this also pulses the project's inbox dot (the
    // append is the whole story there). For 'up' deliveries into the chat
    // agent's inbox, the caller drives the append/activation itself, since
    // that's the one that has to decide "already running" vs "asleep" and
    // keep the inbox count honest.
    async function carryEnvelope(direction, key, callName, ms = 900) {
      const { p0, pMid, pDrop, p3 } = acpPoints(key, direction);
      const leg1 = `M${p0.x},${p0.y} L${pMid.x},${pMid.y} L${pDrop.x},${pDrop.y}`;
      const leg2 = `M${pDrop.x},${pDrop.y} L${p3.x},${p3.y}`;
      const labelColor = direction === 'down' ? COLORS.tool : COLORS.notify;
      const env = envelope();
      ctx.setPos(env, p0.x, p0.y);
      try {
        await flyLeg(env, leg1, ms);

        // dropped on the bar: brief pulse + the shared label naming the call
        showBarLabel(callName, labelColor);
        await ctx.pulse(pDrop.x, pDrop.y, COLORS.notify, BAR_H / 2, 300);
        await ctx.wait(90);

        // ACP sends it on — a separate, faster hop to the recipient's inbox
        await flyLeg(env, leg2, Math.round(ms * 0.7));
        await ctx.fade(env, 0, 120);
      } finally {
        env.remove();
      }

      if (direction === 'down') await pulseInbox(projState[key].inboxDot);
    }

    // the inbox pulse: a message was appended (durable step) — cyan, not
    // yet an activation.
    async function pulseInbox(dot) {
      const pos = { x: +dot.getAttribute('cx'), y: +dot.getAttribute('cy') };
      await ctx.pulse(pos.x, pos.y, COLORS.notify, 14, 450);
      dot.setAttribute('fill', COLORS.notify);
      await ctx.wait(160);
      dot.setAttribute('fill', COLORS.panel);
    }

    // a short yellow bolt that visibly travels from the bar itself down (or
    // up) into the recipient, so the activation reads as coming from ACP —
    // never appearing out of nowhere at the inbox.
    async function barBolt(x, yFrom, yTo) {
      const p = el('path', {
        d: `M${x},${yFrom} L${x},${yTo}`, fill: 'none', stroke: COLORS.activation,
        'stroke-width': 2, opacity: 0.9,
      }, ctx.root);
      await ctx.draw(p, 240);
      await ctx.wait(60);
      await ctx.fade(p, 0, 200);
      p.remove();
    }

    // wakes an idle builder: bolt from the bar's bottom edge to its inbox
    // circle's edge, then the activation pulse.
    async function wakeActivation(st) {
      await barBolt(st.anchorTop.x, BAR_Y + BAR_H, st.anchorTop.y - INBOX_R);
      await ctx.pulse(st.anchorTop.x, st.anchorTop.y, COLORS.activation, 16, 500);
    }

    // a builder that's already running: ACP still sends the activation
    // (bolt reaches it), but it's acknowledged and dropped — the queued
    // message folds in at the next IterationEnd instead.
    async function ackDropped(st) {
      await barBolt(st.anchorTop.x, BAR_Y + BAR_H, st.anchorTop.y - INBOX_R);
      // Right-aligned just left of the stub the bolt rode, in the band
      // between the bar and the card title.
      const tag = el('text', {
        x: st.anchorTop.x - 8, y: BAR_Y + BAR_H + 10, 'text-anchor': 'end', 'dominant-baseline': 'central',
        class: 'mono', 'font-size': 10, fill: COLORS.activation, text: 'already running · ack',
      }, ctx.root);
      tag.setAttribute('opacity', 0);
      await ctx.fade(tag, 1, 160);
      await ctx.wait(650);
      await ctx.fade(tag, 0, 250);
      tag.remove();
    }

    // wakes the chat agent: bolt from the bar's top edge up into its inbox.
    async function chatWake() {
      await barBolt(CHAT_INBOX.x, BAR_Y, CHAT_INBOX.y + INBOX_R);
      await ctx.pulse(CHAT_INBOX.x, CHAT_INBOX.y, COLORS.activation, 14, 500);
    }

    // the chat agent is already running its own turn: the activation still
    // arrives (bolt reaches it), but it's acknowledged and dropped — the
    // message stays in the inbox for the next iteration boundary.
    async function chatAckDropped() {
      await barBolt(CHAT_INBOX.x, BAR_Y, CHAT_INBOX.y + INBOX_R);
      const tag = el('text', {
        x: CHAT_INBOX.x - (ENV_HALF_W + 6), y: (CHAT_INBOX.y + BAR_Y) / 2, 'text-anchor': 'end', 'dominant-baseline': 'central',
        class: 'mono', 'font-size': 10, fill: COLORS.activation, text: 'already running · ack',
      }, ctx.root);
      tag.setAttribute('opacity', 0);
      await ctx.fade(tag, 1, 160);
      await ctx.wait(650);
      await ctx.fade(tag, 0, 250);
      tag.remove();
    }

    // ================= the chat agent's own inbox → trajectory gate =================
    // Every message into the chat agent — down the road a progress update or
    // a result, always up via NotifyParents — is the same two steps: append
    // to its inbox (durable, counted truthfully on the card), then an
    // activation. If the chat agent is already running, the activation is
    // just acknowledged; the item waits for the next iteration boundary. If
    // it's asleep, the activation wakes it, and everything currently queued
    // is admitted at run start. `processFn` is only ever invoked once its
    // item has actually been admitted onto the trajectory — never on arrival.
    let chatRunning = false;
    let chatPending = [];
    async function chatArrival(processFn, [chipLabel, chipType] = ['Notif', 'notify']) {
      chatPending.push({ process: processFn, chipLabel, chipType });
      setChatInboxCount(chatPending.length);
      await pulseInbox(chatInboxDot);
      if (chatRunning) {
        await chatAckDropped();
        return; // picked up at this run's next iteration boundary
      }
      chatRunning = true;
      chatStatusText.textContent = 'running';
      chatStatusText.setAttribute('fill', COLORS.iter);
      await chatWake();
      while (chatPending.length) {
        const batch = chatPending;
        chatPending = [];
        // Admission copies the inbox events onto the trajectory first; the
        // iteration that acts on them starts after that copy.
        setChatInboxCount(0);
        for (const item of batch) await chatStrip.push(item.chipLabel, item.chipType);
        await chatStrip.push('IterationStart', 'iter');
        for (const item of batch) await item.process();
        await chatStrip.push('IterationEnd', 'iter');
      }
      await chatStrip.push('AgentDone', 'agent');
      chatRunning = false;
      chatStatusText.textContent = 'idle';
      chatStatusText.setAttribute('fill', COLORS.muted);
    }

    // A progress update, admitted: one trajectory row, one transcript line.
    async function onProgress(st, text) {
      await addRow(text || `${st.label}: ${st.ask}`, COLORS.notify);
    }

    // Resolved the moment the first result has actually been admitted and
    // written — lets the main flow hold its "running in parallel" caption
    // until a result has really landed, instead of racing a fixed timer.
    let resolveFirstResultAdmitted, resolveAllResultsAdmitted;
    const firstResultAdmitted = new Promise((r) => { resolveFirstResultAdmitted = r; });
    const allResultsAdmitted = new Promise((r) => { resolveAllResultsAdmitted = r; });
    let resultsSeen = 0;

    // A terminal result, admitted: one trajectory row, one transcript line.
    // Once every project has reported in, the chat agent writes its summary
    // reply in that same admitted turn — the transcript only ever shows
    // things it actually wrote, after admitting what it's summarizing.
    async function onResult(st) {
      const check = st.ok ? '✓' : '✗';
      await addRow(`${st.label} ${check} ${st.files} files · ${st.credits}cr`, st.ok ? COLORS.tool : COLORS.revert);
      resultsSeen++;
      if (resultsSeen === 1) resolveFirstResultAdmitted();
      if (resultsSeen === PROJECTS.length) {
        await chatStrip.push('reply', 'content');
        await addBubble(
          `Done — pricing page live, dark mode shipped. ${projState['mobile-app'].ok ? '' : "mobile-app's fix needs another pass: the build failed on tests."}`.trim(),
        );
        resolveAllResultsAdmitted();
      }
    }

    ctx.button('Send another task', () => ctx.spawn(() => followUp()));

    // Wakes a builder and admits its message onto its own trajectory — the
    // same run-start step every agent does, just drawn on the project card.
    async function wakeAndAdmit(st) {
      st.statusText.textContent = 'waking…';
      await wakeActivation(st);
      st.statusText.textContent = 'running';
      st.statusText.setAttribute('fill', COLORS.iter);
      await st.vStrip.push('Notif·chat', 'notify'); // admitted at run start
      await st.vStrip.push('IterationStart', 'iter');
      await st.vStrip.push('tool_call', 'tool');
    }

    async function runBuilder(key, { resumed = false, skipProgress = false, tailOnly = false } = {}) {
      const st = projState[key];
      if (!tailOnly) {
        if (!resumed) {
          st.statusText.textContent = 'waking…';
          await wakeActivation(st);
        }
        st.statusText.textContent = 'running';
        st.statusText.setAttribute('fill', COLORS.iter);
        if (!resumed) await st.vStrip.push('Notif·chat', 'notify'); // admitted at run start
        await st.vStrip.push('IterationStart', 'iter');
        await ctx.wait(1000);
        await st.vStrip.push('tool_call', 'tool');
        await ctx.wait(900);

        // mid-turn progress notification, carried back up through the ACP
        if (!skipProgress) {
          await carryEnvelope('up', key, `NotifyParents ← ${st.abbr}`, 1100);
          await chatArrival(() => onProgress(st), [`Notif·${st.abbr}`, 'notify']);
        }
      }

      await ctx.wait(1000);
      await st.vStrip.push('IterationEnd', 'iter');
      await ctx.wait(700);
      await st.vStrip.push('AgentDone', 'agent');

      st.statusText.textContent = st.ok ? 'done' : 'failed';
      st.statusText.setAttribute('fill', st.ok ? COLORS.tool : COLORS.revert);

      // terminal notification, carried back up through the ACP
      await carryEnvelope('up', key, `NotifyParents ← ${st.abbr}`, 1100);
      await chatArrival(() => onResult(st), [`Notif·${st.abbr}`, 'notify']);
      return st;
    }

    // ================= main script =================
    await ctx.beat(
      'The user asks the <b>chat agent</b> — running at the <b>workspace</b> level, on its own trajectory — for three things at once. The message lands in its <b>inbox</b> first — it hasn\'t touched the trajectory yet.',
    );
    await addBubble(
      'Add a pricing page to marketing-site, dark mode to dashboard, and fix the login bug in mobile-app',
      { user: true },
    );
    setChatInboxCount(1);
    await pulseInbox(chatInboxDot);

    await ctx.beat('An activation wakes the chat agent. At <b>run start</b> it admits the inbox message onto its trajectory — the inbox count goes back to 0.');
    await chatWake();
    chatStatusText.textContent = 'running';
    chatStatusText.setAttribute('fill', COLORS.iter);
    setChatInboxCount(0);
    await chatStrip.push('UserMsg', 'user');
    await chatStrip.push('IterationStart', 'iter');

    await ctx.beat('It thinks, then proposes a plan and asks the user to confirm before it touches any project.');
    await chatStrip.push('thinking', 'thinking');
    await chatStrip.push('content', 'content');
    await addBubble("Here's the plan: pricing page on marketing-site, dark mode on dashboard, fix the login bug on mobile-app. Confirm to build?");
    await chatStrip.push('IterationEnd', 'iter');
    await chatStrip.push('AgentDone', 'agent');
    chatStatusText.textContent = 'idle';
    chatStatusText.setAttribute('fill', COLORS.muted);

    await ctx.beat('The user confirms. That confirmation lands in the inbox the same way — appended, then an activation — and wakes the chat agent, asleep since its last turn.');
    await addBubble('✓ Confirm build', { user: true });
    setChatInboxCount(1);
    await pulseInbox(chatInboxDot);
    await chatWake();
    chatStatusText.textContent = 'running';
    chatStatusText.setAttribute('fill', COLORS.iter);
    setChatInboxCount(0);
    await chatStrip.push('UserMsg', 'user');
    await chatStrip.push('IterationStart', 'iter');

    await ctx.beat('It composes one <b>self-contained message</b> per project — the builder only ever sees the message it\'s sent, never the chat thread it was written from — then calls <code>send_message_to_project</code> three times in one turn.');
    await chatStrip.push('thinking', 'thinking');
    await addBubble('On it — sending instructions to all three projects.');
    // the self-contained messages, composed and ready — each is exactly
    // what its project's builder will see, and nothing else.
    await Promise.all(PROJECTS.map((p) => ctx.fade(callLines[p.key], 1, 260)));
    // mark mobile-app as already mid-iteration (busy) before the message arrives
    projState['mobile-app'].statusText.textContent = 'busy (mid-turn)';
    projState['mobile-app'].statusText.setAttribute('fill', COLORS.iter);
    await projState['mobile-app'].vStrip.push('IterationStart', 'iter');
    await projState['mobile-app'].vStrip.push('tool_call', 'tool');

    await ctx.beat('Three <code>SendMessage</code> calls travel through the <b>Agent Control Plane</b> — never agent to agent. Each appends an <code>ExternalAgentNotification</code>, carrying that project\'s self-contained message, to its inbox — the durable step.');
    await Promise.all(
      PROJECTS.map(async (p, i) => {
        await ctx.wait(i * 180);
        await chatStrip.push(`→ ${p.abbr}`, 'tool');
        await carryEnvelope('down', p.key, `SendMessage → ${p.abbr}`, 900);
        if (p.key === 'mobile-app') await ackDropped(projState[p.key]);
      }),
    );
    await addRow('marketing-site — notified', COLORS.notify);
    await addRow('dashboard — notified', COLORS.notify);
    await addRow('mobile-app — queued (busy)', COLORS.activation);

    await ctx.beat('<b>marketing-site</b>\'s activation reaches it — it wakes, and at run start admits the message onto its own trajectory. Only now can it report anything back.');
    await wakeAndAdmit(projState['marketing-site']);

    await ctx.beat(
      '<b>marketing-site</b> posts an early progress update while the chat agent is still finishing this very turn. Its activation finds the chat agent already running — <b>acknowledged and dropped</b>; the update waits in the inbox for the next iteration boundary.',
    );
    await carryEnvelope('up', 'marketing-site', 'NotifyParents ← mkt', 1100);
    setChatInboxCount(1); // appended — chatRunning is still true, so no wake yet
    await pulseInbox(chatInboxDot);
    await chatAckDropped();

    await ctx.beat('At its <b>next iteration boundary</b> the chat agent admits that queued update — inbox back to 0 — writes it to its trajectory, then finishes this turn and goes idle.');
    await chatStrip.push('IterationEnd', 'iter'); // closes the send-messages iteration
    setChatInboxCount(0);
    await chatStrip.push('Notif·mkt', 'notify'); // admitted at the boundary
    await chatStrip.push('IterationStart', 'iter'); // the iteration that acts on it
    await addRow('marketing-site: started — reading project state', COLORS.notify);
    await chatStrip.push('IterationEnd', 'iter');
    await chatStrip.push('AgentDone', 'agent');
    chatStatusText.textContent = 'idle';
    chatStatusText.setAttribute('fill', COLORS.muted);

    await ctx.beat(
      '<b>mobile-app</b> was already mid-iteration when its message arrived, so its activation was acknowledged and dropped — it folds the message in now, at its own next <code>IterationEnd</code>. <b>dashboard</b> is still asleep; it wakes below.',
    );
    // mobile-app finishes its in-flight iteration, THEN admits the queued message
    await projState['mobile-app'].vStrip.push('IterationEnd', 'iter');
    await ctx.wait(200);
    await projState['mobile-app'].vStrip.push('Notif·chat', 'notify'); // folded in at the boundary
    projState['mobile-app'].statusText.textContent = 'admits queued msg';
    await ctx.pulse(projState['mobile-app'].anchorTop.x, projState['mobile-app'].anchorTop.y, COLORS.notify, 14, 500);

    await ctx.beat('All three builders now run in parallel, at their own pace. Progress and results travel back the same way — appended to the chat agent\'s inbox, then an activation — but the chat agent is asleep again, so each one wakes it in turn.');
    const runPromise = Promise.all([
      runBuilder('marketing-site', { tailOnly: true }),
      (async () => { await ctx.wait(900); return runBuilder('dashboard'); })(),
      (async () => { await ctx.wait(1800); return runBuilder('mobile-app', { resumed: true }); })(),
    ]);

    // Hold the "running in parallel" caption until a result actually starts
    // arriving, rather than switching on a fixed timer that can race ahead
    // of (or lag behind) the animation.
    await firstResultAdmitted;
    await ctx.beat('Each <code>AgentDone</code> triggers one more notification — terminal status and a result summary: credits, files changed, build status. The chat agent only writes its own summary reply once every result has been admitted.');
    await runPromise;
    await allResultsAdmitted;

    await ctx.beat('Every message — down or up — rides the Agent Control Plane the same way: appended to an inbox, then an activation. Already running? Acknowledged and dropped, picked up at the next boundary. Asleep? The activation wakes it, admitted at run start. Try "Send another task", or Reset to replay.', 1400);

    async function followUp() {
      if (!ctx.alive) return;
      const target = projState['dashboard'];
      await addBubble('Also bump the font size on the dashboard settings page', { user: true });
      await chatArrival(async () => {
        await chatStrip.push('thinking', 'thinking');
        await chatStrip.push(`→ ${target.abbr}`, 'tool');
        await carryEnvelope('down', 'dashboard', `SendMessage → ${target.abbr}`, 800);
        await addRow('dashboard — notified', COLORS.notify);
        target.statusText.textContent = 'waking…';
        target.statusText.setAttribute('fill', COLORS.muted);
        await wakeActivation(target);
        target.statusText.textContent = 'running';
        target.statusText.setAttribute('fill', COLORS.iter);
        await target.vStrip.push('Notif·chat', 'notify'); // admitted at run start
        await target.vStrip.push('IterationStart', 'iter');
        await ctx.wait(500);
        await target.vStrip.push('tool_call', 'tool');
        await ctx.wait(500);
        await target.vStrip.push('AgentDone', 'agent');
        target.statusText.textContent = 'done';
        target.statusText.setAttribute('fill', COLORS.tool);
        await carryEnvelope('up', 'dashboard', `NotifyParents ← ${target.abbr}`, 800);
        await chatArrival(async () => {
          await addRow('dashboard ✓ 1 file · 0.3cr', COLORS.tool);
          await chatStrip.push('reply', 'content');
          await addBubble('Done — bumped the font size on dashboard settings.');
        }, [`Notif·${target.abbr}`, 'notify']);
      }, ['UserMsg', 'user']);
    }
  },
};
