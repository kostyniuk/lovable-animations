// #viz-inbox — "Two logs per agent: the inbox and the agent trajectory"
// Left: actors that can only append to the inbox. Middle: the inbox, a pile
// of pending/handled message cards. Right: the agent trajectory, the one
// lane the agent itself writes — built from iteration blocks. At every
// IterationEnd (and at run start) a gate opens and whatever is still
// pending in the inbox gets copied onto the trajectory in order.
//
// Agent-to-agent traffic (Subagent, Scheduler) never lands in the inbox
// directly — it is always two ACP steps: append to the inbox, then send an
// activation. The ACP pill between the actors and the inbox is that relay;
// activations (yellow) are a separate signal ACP sends onward to the agent,
// distinct from the durable inbox append.

import { COLORS, colorOf } from '../lib.js';

const W = 900, H = 370;

const ACTOR_X = 20, ACTOR_W = 110, ACTOR_H = 66;
const ACTOR_R = ACTOR_X + ACTOR_W; // right edge: where every guide leaves
const ACTORS = {
  user: { y: 40, label: 'User', kind: 'UserMessage', color: 'user' },
  subagent: { y: 157, label: 'Subagent', kind: 'ExternalAgentNotification', color: 'notify', tag: 'subagent done' },
  scheduler: { y: 274, label: 'Scheduler', kind: 'ExternalAgentNotification', color: 'notify', tag: 'wake-up' },
};
const actorCY = (a) => a.y + ACTOR_H / 2;

const INBOX_X = 220, INBOX_W = 240, INBOX_Y = 40, INBOX_H = 300;
const INBOX_PAD = 15;
const INBOX_ROW_TOP = INBOX_Y + 40;
const CARD_W = INBOX_W - INBOX_PAD * 2, CARD_H = 32, CARD_GAP = 9;

// ACP sits between the agent actors and the inbox: every inter-agent message
// is relayed actor → ACP → inbox, in two hops, per the article. Same pill
// style as the Agent Control Plane bar in the hero. Messages enter on its
// left edge, leave on its right edge; activations leave from its bottom edge.
const ACP_W = 40, ACP_H = 18;
const ACP_X = (ACTOR_R + INBOX_X - ACP_W) / 2;
const ACP_CX = ACP_X + ACP_W / 2;
const ACP_CY = (actorCY(ACTORS.subagent) + actorCY(ACTORS.scheduler)) / 2;
const ACP_Y = ACP_CY - ACP_H / 2;
const RELAY_X = (ACTOR_R + ACP_X) / 2; // lane where the two agent guides merge

const TRAJ_X = 510, TRAJ_W = 370, TRAJ_Y = 40, TRAJ_H = 300;
const BLOCK_PAD = 15;                   // same inset as the inbox cards
const CW = TRAJ_W - BLOCK_PAD * 2;      // header pill width
const INDENT = 12;                      // chips nest under their header
const HEADER_CY = TRAJ_Y + 20;          // "pending → handled" / lock row
const ACT_Y = TRAJ_Y + 44;              // where activations land on the trajectory
const CONTENT_TOP = TRAJ_Y + 60;        // top of the first block
const TRAJ_GAP = 12;
const ITER_LABEL_Y = -16, ITER_TOP = 24; // iteration label baseline / overhang

// Activation route: down from ACP, under the inbox, up the gutter.
const GUTTER_X = (INBOX_X + INBOX_W + TRAJ_X) / 2;
const LANE_Y = (INBOX_Y + INBOX_H + H) / 2;
const ENV_W = 18; // envelope glyph width (matches the hero)

const MAX_FLY_CHIPS = 2; // cap individual fly-in animations per admit batch

export default {
  width: W, height: H,
  async build(ctx) {
    const root = ctx.root;
    const guide = (d) => ctx.el('path', {
      d, fill: 'none', stroke: COLORS.line, 'stroke-width': 1, 'stroke-dasharray': '2 4', opacity: 0.35,
    });

    // ================= static scaffolding =================
    for (const key of ['user', 'subagent', 'scheduler']) {
      const a = ACTORS[key];
      const cy = actorCY(a);
      ctx.box({ x: ACTOR_X, y: a.y, w: ACTOR_W, h: ACTOR_H, title: a.label, color: colorOf(a.color) });
      ctx.el('text', {
        x: ACTOR_X + ACTOR_W / 2, y: cy, class: 'mono', 'font-size': 11,
        'text-anchor': 'middle', 'dominant-baseline': 'central', fill: COLORS.text, text: a.label,
      });
      if (a.kind === 'ExternalAgentNotification') {
        // agent-to-agent traffic only ever reaches ACP: both guides merge
        // on one lane into ACP's left-edge midpoint.
        guide(`M${ACTOR_R},${cy} H${RELAY_X} V${ACP_CY}` + (key === 'subagent' ? ` H${ACP_X}` : ''));
      } else {
        // the user's messages land in the inbox directly.
        guide(`M${ACTOR_R},${cy} H${INBOX_X}`);
      }
    }

    // ACP: the orchestration layer. Every agent-to-agent message is relayed
    // through it — append to the recipient's inbox, then send an activation.
    ctx.el('rect', {
      x: ACP_X, y: ACP_Y, width: ACP_W, height: ACP_H, rx: ACP_H / 2,
      fill: COLORS.panel, stroke: COLORS.line, 'stroke-width': 1,
    });
    // ACP "taking receipt" / "firing": its outline flashes in the signal's
    // color. (An expanding ring would swallow the tiny pill's label.)
    async function flashAcp(color, ms = 360) {
      const ring = ctx.el('rect', {
        x: ACP_X, y: ACP_Y, width: ACP_W, height: ACP_H, rx: ACP_H / 2,
        fill: 'none', stroke: color, 'stroke-width': 2,
      }, root);
      try { await ctx.fade(ring, 0, ms); } finally { ring.remove(); }
    }
    ctx.el('text', {
      x: ACP_CX, y: ACP_CY, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono',
      'font-size': 10, fill: COLORS.muted, 'letter-spacing': '0.08em', text: 'ACP',
    });
    guide(`M${ACP_X + ACP_W},${ACP_CY} H${INBOX_X}`);

    ctx.box({ x: INBOX_X, y: INBOX_Y, w: INBOX_W, h: INBOX_H, title: 'Inbox' });
    ctx.el('text', {
      x: INBOX_X + INBOX_PAD, y: HEADER_CY, class: 'mono', 'font-size': 10, fill: COLORS.muted,
      'dominant-baseline': 'central', text: 'pending → handled',
    });

    ctx.box({ x: TRAJ_X, y: TRAJ_Y, w: TRAJ_W, h: TRAJ_H, title: 'Agent trajectory' });
    // lock marker: single writer. Icon is 16 tall (shackle top -1 … body
    // bottom 15); its middle (7) sits on the header row's center line.
    const lockG = ctx.el('g', {});
    ctx.setPos(lockG, TRAJ_X + BLOCK_PAD, HEADER_CY - 7);
    ctx.el('rect', { x: 0, y: 6, width: 12, height: 9, rx: 2, fill: 'none', stroke: COLORS.muted, 'stroke-width': 1.25 }, lockG);
    ctx.el('path', { d: 'M2.5,6 V3 a3.5,3.5 0 0 1 7,0 V6', fill: 'none', stroke: COLORS.muted, 'stroke-width': 1.25 }, lockG);
    ctx.el('text', {
      x: 20, y: 7, class: 'mono', 'font-size': 10, fill: COLORS.muted,
      'dominant-baseline': 'central', text: 'single writer: agent',
    }, lockG);
    // dashed boundary channel between the two columns.
    const channel = guide(`M${INBOX_X + INBOX_W},${INBOX_Y + INBOX_H / 2} H${TRAJ_X}`);
    channel.setAttribute('stroke', COLORS.iter);
    channel.setAttribute('stroke-dasharray', '3 4');
    channel.setAttribute('opacity', 0.3);

    // ================= state =================
    // agentActive: true between AgentStart and AgentDone. Drives whether an
    // activation actually starts a run or is just acknowledged and dropped.
    // waking: true from the instant an idle-wake activation is claimed until
    // its AgentStart pill is appended and pending messages are admitted —
    // covers agentActive's own startup window so nothing else (e.g. the
    // sandbox loop below) can act on the new run before it's actually there,
    // and so a second activation arriving in that window sees the agent as
    // busy rather than racing to start its own run.
    const state = { inbox: [], traj: [], agentActive: false, waking: false };
    // Serializes every inbox mutation (sends + admits) so simultaneous
    // button clicks can't race each other's reflow animations; the
    // trajectory gets its own lock for trims/reflows.
    const makeLock = () => {
      let tail = Promise.resolve();
      const run = (fn) => {
        const p = tail.then(fn, fn);
        tail = p.then(() => {}, () => {});
        return p;
      };
      run.idle = () => tail;
      return run;
    };
    const withInboxLock = makeLock();
    const withTrajLock = makeLock();

    // Move a node along an orthogonal polyline (its origin rides the line).
    async function travel(node, pts, ms) {
      const path = ctx.el('path', {
        d: 'M' + pts.map(([x, y]) => `${x},${y}`).join(' L'), fill: 'none', stroke: 'none',
      }, root);
      ctx.setPos(node, pts[0][0], pts[0][1]);
      try { await ctx.along(node, path, ms); } finally { path.remove(); }
    }

    // Same envelope glyph as the hero, centered on its origin.
    function envelope(accent) {
      const g = ctx.el('g', {}, root);
      ctx.el('rect', { x: -ENV_W / 2, y: -6, width: ENV_W, height: 12, rx: 2, fill: COLORS.panel, stroke: accent, 'stroke-width': 1.4 }, g);
      ctx.el('path', { d: `M${-ENV_W / 2},-6 L0,1 L${ENV_W / 2},-6`, fill: 'none', stroke: accent, 'stroke-width': 1.4 }, g);
      return g;
    }

    // Draws either a plain event pill, or — for ExternalAgentNotification —
    // one that keeps the real event type readable as its own line/label:
    // wide pills (trajectory) get one line "Type · payload" at the default
    // (11px) size; narrow pills (inbox cards) stack type/payload on two
    // lines, sized well above the 10 / 9.5px legibility floor.
    function renderEventCard({ x, y, w, h, kind, tag, label, parent }) {
      if (kind === 'ExternalAgentNotification' && !label && tag) {
        if (w >= 260) {
          return ctx.eventPill({ x, y, w, h, name: kind, label: `${kind} · ${tag}` }, parent);
        }
        const g = ctx.eventPill({ x, y, w, h, name: kind, label: '' }, parent);
        const textEl = g.querySelector('text');
        textEl.textContent = '';
        ctx.el('tspan', {
          x: 12, y: h / 2 - 4, 'font-size': 10, fill: COLORS.text, text: kind,
        }, textEl);
        ctx.el('tspan', {
          x: 12, dy: 13, 'font-size': 9.5, fill: COLORS.muted, text: tag,
        }, textEl);
        return g;
      }
      return ctx.eventPill({ x, y, w, h, name: kind, label: label || kind }, parent);
    }

    // ACP sending an activation onward to the agent. Every send that goes
    // through ACP fires this in the same beat as the inbox append — nobody
    // waits for a later tick to notice the message and decide to activate.
    // If the agent is idle this is what actually starts a new run — the run
    // then admits whatever is pending at run start; if it's already
    // running, the activation is just acknowledged and dropped — the
    // running agent will pick the message up at its next iteration boundary
    // regardless. Like the hero: it leaves from ACP's bottom edge and is
    // drawn as a yellow orthogonal bolt — down, under the inbox, up the
    // gutter, into the trajectory's left edge just below the lock row, so it
    // never crosses a card or label.
    async function activateAgent() {
      // Claim the wake synchronously, before any animation frame runs, so a
      // second activation arriving in the same instant — or arriving while
      // this one's AgentStart/admit is still in flight — sees the agent as
      // already (about to be) running rather than racing to start its own.
      const waking = !state.agentActive && !state.waking;
      if (waking) state.waking = true;
      const sx = ACP_CX, sy = ACP_Y + ACP_H;
      await flashAcp(COLORS.activation, 380);
      const bolt = ctx.el('path', {
        d: `M${sx},${sy} V${LANE_Y} H${GUTTER_X} V${ACT_Y} H${TRAJ_X}`,
        fill: 'none', stroke: COLORS.activation, 'stroke-width': 2, opacity: 0.9,
      }, root);
      try {
        await ctx.draw(bolt, 560);
        if (!waking) {
          const ack = ctx.el('text', {
            x: TRAJ_X + 24, y: ACT_Y, class: 'mono', 'font-size': 9.5, fill: COLORS.muted,
            'dominant-baseline': 'central', text: 'already running · ack',
          }, root);
          await Promise.all([ctx.pulse(TRAJ_X, ACT_Y, COLORS.activation, 14, 320), ctx.fade(bolt, 0, 240)]);
          await ctx.wait(260);
          await ctx.fade(ack, 0, 300);
          ack.remove();
        } else {
          await Promise.all([ctx.pulse(TRAJ_X, ACT_Y, COLORS.activation, 16, 420), ctx.fade(bolt, 0, 300)]);
          // The activation woke an idle agent: a fresh run starts right now
          // and admits whatever is pending at run start. `waking` stays true
          // until this is fully done, so nothing downstream (the sandbox
          // loop) can act on the new run before it actually exists.
          const woken = await appendAgentPill('AgentStart');
          await admitPending(woken);
          state.waking = false;
        }
      } finally {
        bolt.remove();
      }
    }

    // ---------- inbox helpers ----------
    const INBOX_LIMIT = INBOX_Y + INBOX_H - INBOX_PAD;
    function inboxSlotY(i) { return INBOX_ROW_TOP + i * (CARD_H + CARD_GAP); }

    // Drop cards from the front (prefer already-handled ones) until one more
    // card fits, then slide the rest into their slots.
    async function makeInboxRoom() {
      while (state.inbox.length && inboxSlotY(state.inbox.length) + CARD_H > INBOX_LIMIT) {
        let idx = state.inbox.findIndex((c) => c.handled);
        if (idx === -1) idx = 0;
        const [removed] = state.inbox.splice(idx, 1);
        await ctx.fade(removed.node, 0, 220);
        removed.node.remove();
      }
      await Promise.all(state.inbox.map((c, i) => ctx.move(c.node, INBOX_X + INBOX_PAD, inboxSlotY(i), 420)));
    }

    function markHandled(card) {
      card.handled = true;
      card.node.querySelectorAll('rect').forEach((r) => r.setAttribute('stroke-opacity', 0.25));
      card.node.setAttribute('opacity', 0.5);
      card.statusEl.textContent = '✓ handled';
      card.statusEl.setAttribute('fill', COLORS.muted);
    }

    // Send a message from an actor into the inbox (pending). Safe to call
    // from a spawned button handler or inline from the scripted sequence.
    // Only the append itself holds the inbox lock, so several envelopes can
    // be in flight at once (like the hero) without queueing behind each other.
    // `autoActivate: false` is only for the scripted intro's very first
    // message, where the following beats stage the run start by hand.
    async function sendMessage(actorKey, labelOverride, { autoActivate = true } = {}) {
      const a = ACTORS[actorKey];
      const color = colorOf(a.color);
      const cy = actorCY(a);
      // The message travels as an envelope along its guide and becomes a
      // card once it reaches the inbox edge.
      {
        const env = envelope(color);
        try {
          if (a.kind === 'ExternalAgentNotification') {
            // Agents don't write to each other's inboxes directly: the
            // message is relayed through ACP in two hops. Hop 1 ends with
            // the envelope touching ACP's left edge; ACP takes receipt.
            await travel(env, [[ACTOR_R, cy], [RELAY_X, cy], [RELAY_X, ACP_CY], [ACP_X - ENV_W / 2, ACP_CY]], 460);
            await Promise.all([ctx.fade(env, 0, 160), flashAcp(color, 320)]);
            await ctx.wait(200);
            // Hop 2: ACP sends it on, out of its right edge, to the inbox.
            ctx.setPos(env, ACP_X + ACP_W, ACP_CY);
            await Promise.all([
              travel(env, [[ACP_X + ACP_W, ACP_CY], [INBOX_X, ACP_CY]], 260),
              ctx.fade(env, 1, 120),
            ]);
          } else {
            await travel(env, [[ACTOR_R, cy], [INBOX_X, cy]], 420);
          }
          await ctx.fade(env, 0, 140);
        } finally {
          env.remove();
        }
      }
      return withInboxLock(async () => {
        await makeInboxRoom();
        const card = renderEventCard({
          x: INBOX_X + INBOX_PAD, y: inboxSlotY(state.inbox.length), w: CARD_W, h: CARD_H,
          kind: a.kind, tag: a.tag, label: labelOverride,
        });
        card.setAttribute('opacity', 0);
        // On the 2-line notify cards the payload sub-label sits below
        // center — level the status tag with it so the two never collide.
        const statusY = a.kind === 'ExternalAgentNotification' ? CARD_H / 2 + 9 : CARD_H / 2 + 4;
        const statusEl = ctx.el('text', {
          x: CARD_W - 8, y: statusY, class: 'mono', 'font-size': 9.5,
          'text-anchor': 'end', fill: color, text: '● pending',
        }, card);
        const entry = { node: card, statusEl, handled: false, kind: a.kind, tag: a.tag };
        state.inbox.push(entry);
        await ctx.fade(card, 1, 240);
        // The append is the durable step; every send is followed by an
        // activation (always drawn from the ACP pill, even for UserMessages,
        // which land in the inbox without an ACP hop). It wakes an idle agent,
        // or is acked and dropped against a running one.
        if (autoActivate) ctx.spawn(() => activateAgent());
        return entry;
      });
    }

    // Copy every still-pending inbox card onto the current trajectory block.
    // Returns the number admitted.
    function admitPending(block) {
      return withInboxLock(async () => {
        const pending = state.inbox.filter((c) => !c.handled);
        if (!pending.length) return 0;
        await withTrajLock.idle(); // don't aim at a block that's mid-reflow
        const flyCount = Math.min(pending.length, MAX_FLY_CHIPS);
        for (let i = 0; i < flyCount; i++) {
          const card = pending[i];
          const from = ctx.getPos(card.node);
          // Notify events get a full-width single-line chip (room to read
          // "ExternalAgentNotification · <payload>" at normal size); other
          // kinds stay compact.
          const wide = card.kind === 'ExternalAgentNotification';
          const cw = wide ? CW - INDENT : 160;
          const ch = wide ? 24 : 20;
          const to = block.nextChipPos();
          // The copy lifts off its source card (left-aligned, vertically
          // centered on it), levels out to the slot's height before the
          // trajectory edge, and lands exactly on the reserved slot.
          const x0 = from.x, y0 = from.y + (CARD_H - ch) / 2;
          const path = ctx.el('path', {
            d: `M${x0},${y0} C${x0 + 80},${y0} ${TRAJ_X - 80},${to.y} ${to.x},${to.y}`,
            fill: 'none', stroke: 'none',
          }, root);
          const clone = renderEventCard({ x: x0, y: y0, w: cw, h: ch, kind: card.kind, tag: card.tag });
          clone.setAttribute('opacity', 0);
          await Promise.all([ctx.along(clone, path, 620), ctx.fade(clone, 0.9, 160)]);
          path.remove();
          markHandled(card);
          block.absorbChip(clone);
        }
        // Bulk-admit the rest without an individual flight, so a spam of
        // arrivals can't blow the trajectory block past the stage.
        const rest = pending.length - flyCount;
        if (rest > 0) {
          for (let i = flyCount; i < pending.length; i++) markHandled(pending[i]);
          block.addWork(`+${rest} more admitted`, 'content');
        }
        await trimTraj();
        return pending.length;
      });
    }

    // ---------- trajectory helpers ----------
    // Blocks stack from CONTENT_TOP with TRAJ_GAP between one block's
    // bottom and the next block's top (iteration labels overhang upward).
    function trajLayout() {
      let y = CONTENT_TOP;
      const ys = [];
      for (const b of state.traj) {
        y += b.top;
        ys.push(y);
        y += b.bottom + TRAJ_GAP;
      }
      return { ys, next: y };
    }

    async function reflowTraj() {
      const { ys } = trajLayout();
      await Promise.all(state.traj.map((b, i) => ctx.move(b.g, TRAJ_X + BLOCK_PAD, ys[i], 400)));
    }

    // Drop the oldest blocks until everything fits in the trajectory box —
    // or, with `reserve`, until a new block of that height fits below.
    function trimTraj(reserve = 0) {
      return withTrajLock(async () => {
        const limit = TRAJ_Y + TRAJ_H - 8;
        const overflows = () => {
          const n = state.traj.length;
          const { ys, next } = trajLayout();
          if (reserve) return n > 0 && next + reserve > limit;
          return n > 1 && ys[n - 1] + state.traj[n - 1].bottom > limit;
        };
        while (overflows()) {
          const old = state.traj.shift();
          await ctx.fade(old.g, 0, 220);
          old.g.remove();
          await reflowTraj();
        }
      });
    }

    // Shared block shape: a header (agent pill, or iteration header) plus
    // room to grow as work chips / admitted copies are appended below it.
    function makeBlock(g, { top, startContentY, bg }) {
      const grow = (dy) => {
        block.contentY += dy;
        if (bg) bg.setAttribute('height', block.contentY + 10);
      };
      const block = {
        g, bg, top, contentY: startContentY,
        // bottom edge relative to the block origin: the frame for
        // iterations, the last chip for agent pills.
        get bottom() { return bg ? this.contentY + 2 : this.contentY - 6; },
        nextChipPos() {
          // absolute page position of the next chip's top-left resting spot.
          const p = ctx.getPos(g);
          return { x: p.x + INDENT, y: p.y + this.contentY };
        },
        absorbChip(clone) {
          // reparent the landed clone into this block, at its slot.
          g.appendChild(clone);
          ctx.setPos(clone, INDENT, this.contentY);
          grow((clone._h || 20) + 6);
        },
        addWork(label, type) {
          const chip = ctx.eventPill({ x: INDENT, y: this.contentY, name: type, label, w: CW - INDENT, h: 18 }, g);
          chip.setAttribute('opacity', 0.85);
          grow(24);
          ctx.spawn(() => trimTraj());
          return chip;
        },
        grow,
      };
      return block;
    }

    // A simple wide pill row (AgentStart / AgentDone) that can still absorb
    // messages admitted right at run start.
    async function appendAgentPill(name) {
      state.agentActive = name === 'AgentStart';
      await trimTraj(name === 'AgentStart' ? 58 : 26);
      const g = ctx.el('g', {});
      ctx.setPos(g, TRAJ_X + BLOCK_PAD, trajLayout().next);
      const pill = ctx.eventPill({ x: 0, y: 0, name, w: CW, h: 26 }, g);
      pill.setAttribute('opacity', 0);
      const block = makeBlock(g, { top: 0, startContentY: 32, bg: null });
      state.traj.push(block);
      await ctx.fade(pill, 1, 300);
      return block;
    }

    // An iteration block: header, then chips appended as they happen,
    // inside a frame with 8 units of padding on every side.
    async function beginIterationBlock(n) {
      await trimTraj(ITER_TOP + 112);
      const g = ctx.el('g', {});
      ctx.setPos(g, TRAJ_X + BLOCK_PAD, trajLayout().next + ITER_TOP);
      const bg = ctx.el('rect', {
        x: -8, y: -8, width: CW + 16, height: 40, rx: 8,
        fill: 'none', stroke: COLORS.dim, 'stroke-width': 1,
      }, g);
      ctx.el('text', {
        x: 0, y: ITER_LABEL_Y, class: 'mono', 'font-size': 10, fill: COLORS.muted,
        'letter-spacing': '0.06em', text: `ITERATION ${n}`,
      }, g);
      ctx.eventPill({ x: 0, y: 0, name: 'IterationStart', w: CW, h: 24 }, g);
      const block = makeBlock(g, { top: ITER_TOP, startContentY: 30, bg });
      state.traj.push(block);
      return block;
    }

    async function endIterationBlock(block) {
      const gateY = block.contentY;
      ctx.eventPill({ x: 0, y: gateY, name: 'IterationEnd', w: CW, h: 24 }, block.g);
      block.grow(30);
      const origin = ctx.getPos(block.g);
      await ctx.pulse(origin.x + CW / 2, origin.y + gateY + 12, COLORS.iter, 20, 550);
      await trimTraj();
    }

    // ================= buttons =================
    ctx.button('Send UserMessage', () => ctx.spawn(() => sendMessage('user')));
    ctx.button('Subagent finishes', () => ctx.spawn(() => sendMessage('subagent')));
    ctx.button('Scheduled wake-up', () => ctx.spawn(() => sendMessage('scheduler')));

    // ================= scripted intro =================
    let iterN = 0;
    await ctx.beat(
      'Every agent keeps two logs. The <b>inbox</b> is where anything sent to it lands. ' +
      'The <b>trajectory</b> is what it actually thought, said and did.'
    );

    // Suppress the automatic idle-wake activation here: the next two beats
    // stage that exact run start by hand, with their own captions.
    await sendMessage('user', undefined, { autoActivate: false });
    await ctx.beat('The user\'s <span class="t t-user">UserMessage</span> always lands in the inbox first — never straight onto the trajectory.');

    let run = await appendAgentPill('AgentStart');
    await ctx.beat('A run starts. At run start the agent scans the inbox and copies whatever is unhandled onto its trajectory.');
    await admitPending(run);

    iterN += 1;
    let block = await beginIterationBlock(iterN);
    await ctx.beat('The agent begins iterating on what it just admitted.');
    block.addWork('thinking…', 'thinking');
    await ctx.wait(500);

    await sendMessage('subagent');
    await ctx.beat(
      'Mid-iteration, the subagent\'s <span class="t t-notify">ExternalAgentNotification</span> arrives. ' +
      'It just waits, pending — the current iteration doesn\'t stop for it.'
    );
    block.addWork('tool_call', 'tool');
    await ctx.wait(450);

    await endIterationBlock(block);
    await ctx.beat('IterationEnd: the gate opens and the agent scans the inbox again.');
    await admitPending(block);
    await ctx.beat('Picked up as an interjection — not after the whole response finished.');

    iterN += 1;
    block = await beginIterationBlock(iterN);
    await ctx.beat('While this next iteration runs, more messages arrive at once: a follow-up and a scheduled wake-up.');
    block.addWork('thinking…', 'thinking');
    await sendMessage('user', 'UserMessage');
    await ctx.wait(300);
    await sendMessage('scheduler');
    await ctx.wait(400);
    await endIterationBlock(block);
    await ctx.beat('They pile up in the inbox, and the next boundary admits all of them together, in order.');
    await admitPending(block);

    await appendAgentPill('AgentDone');
    await ctx.beat(
      'Now it\'s an interactive sandbox: use the buttons any time. Nobody polls: every send is an ' +
      'append plus an activation, together, at send time. If the agent is idle that activation wakes ' +
      'it — a fresh <span class="t t-agent">AgentStart</span> admits the message at run start. If ' +
      'it\'s already running, the activation is just acked, and the message waits for the next ' +
      'iteration boundary.'
    );

    // ================= autonomous sandbox loop =================
    let idleStreak = 0;
    let running = false;
    while (ctx.alive) {
      if (!running) {
        ctx.caption('Agent idle (AgentDone) — nothing runs until an activation wakes it.');
        // The append + activation already happened inside sendMessage →
        // activateAgent, at send time — this only waits for that wake to
        // fully land (AgentStart appended, pending admitted — state.waking
        // back to false) before animating the run it just started.
        while (ctx.alive && !(state.agentActive && !state.waking)) await ctx.wait(150);
        if (!ctx.alive) break;
        ctx.caption('An activation arrived while idle: a new run starts and admits the message at run start.');
        await ctx.wait(500);
        running = true;
        idleStreak = 0;
      }

      iterN += 1;
      block = await beginIterationBlock(iterN);
      ctx.caption(`Iteration ${iterN}: thinking, maybe a tool call…`);
      block.addWork('thinking…', 'thinking');
      await ctx.wait(900);
      if (state.inbox.some((c) => !c.handled)) block.addWork('tool_call', 'tool');
      await ctx.wait(500);
      await endIterationBlock(block);
      const admitted = await admitPending(block);
      idleStreak = admitted > 0 ? 0 : idleStreak + 1;
      if (admitted > 0) {
        ctx.caption(`Boundary admitted ${admitted} pending message${admitted > 1 ? 's' : ''} onto the trajectory.`);
        await ctx.wait(500);
      }
      if (idleStreak >= 2) {
        await appendAgentPill('AgentDone');
        running = false;
      }
    }
  },
};
