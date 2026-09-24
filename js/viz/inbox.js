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

const W = 900, H = 380;

const ACTOR_X = 20, ACTOR_W = 130;
const ACTORS = {
  user: { y: 60, h: 66, label: 'User', kind: 'UserMessage', color: 'user' },
  subagent: { y: 172, h: 66, label: 'Subagent', kind: 'ExternalAgentNotification', color: 'notify', tag: 'subagent done' },
  scheduler: { y: 284, h: 66, label: 'Scheduler', kind: 'ExternalAgentNotification', color: 'notify', tag: 'wake-up' },
};

// ACP sits between the agent actors and the inbox: every inter-agent message
// is relayed actor → ACP → inbox, in two hops, per the article.
const ACP_X = 168, ACP_W = 46, ACP_H = 28, ACP_Y = 247;

const INBOX_X = 220, INBOX_W = 240, INBOX_Y = 40, INBOX_H = 260;
const INBOX_ROW_TOP = INBOX_Y + 40;
const CARD_W = INBOX_W - 30, CARD_H = 32, CARD_GAP = 9;

const TRAJ_X = 510, TRAJ_W = 370, TRAJ_Y = 40, TRAJ_H = 300;
const TRAJ_ROW_TOP = TRAJ_Y + 66;
const BLOCK_PAD = 14;
const MAX_FLY_CHIPS = 4; // cap individual fly-in animations per admit batch

let uid = 0;
const nextId = () => `n${uid++}`;

export default {
  width: W, height: H,
  async build(ctx) {
    const root = ctx.root;

    // ================= static scaffolding =================
    for (const key of ['user', 'subagent', 'scheduler']) {
      const a = ACTORS[key];
      ctx.box({ x: ACTOR_X, y: a.y, w: ACTOR_W, h: a.h, title: a.label, color: colorOf(a.color) });
      ctx.el('text', {
        x: ACTOR_X + ACTOR_W / 2, y: a.y + a.h / 2 + 4, class: 'mono', 'font-size': 11,
        'text-anchor': 'middle', fill: COLORS.text, text: a.label,
      });
      if (a.kind === 'ExternalAgentNotification') {
        // agent-to-agent traffic only ever reaches ACP directly.
        ctx.arrow(ACTOR_X + ACTOR_W, a.y + a.h / 2, ACP_X, ACP_Y + ACP_H / 2, {
          color: COLORS.line, dash: '2 4', width: 1, curve: 0, head: false,
        }).setAttribute('opacity', 0.35);
      } else {
        // the user's messages land in the inbox directly.
        ctx.arrow(ACTOR_X + ACTOR_W, a.y + a.h / 2, INBOX_X, INBOX_Y + 16, {
          color: COLORS.line, dash: '2 4', width: 1, curve: 0, head: false,
        }).setAttribute('opacity', 0.35);
      }
    }

    // ACP: the orchestration layer. Every agent-to-agent message is relayed
    // through it — append to the recipient's inbox, then send an activation.
    ctx.box({ x: ACP_X, y: ACP_Y, w: ACP_W, h: ACP_H, title: '', color: colorOf('notify') });
    ctx.el('text', {
      x: ACP_X + ACP_W / 2, y: ACP_Y + ACP_H / 2 + 4, class: 'mono', 'font-size': 10.5,
      'text-anchor': 'middle', fill: COLORS.text, text: 'ACP',
    });
    ctx.arrow(ACP_X + ACP_W, ACP_Y + ACP_H / 2, INBOX_X, INBOX_Y + INBOX_H / 2, {
      color: COLORS.line, dash: '2 4', width: 1, curve: 0, head: false,
    }).setAttribute('opacity', 0.35);

    const inboxBox = ctx.box({ x: INBOX_X, y: INBOX_Y, w: INBOX_W, h: INBOX_H, title: 'Inbox' });
    ctx.el('text', {
      x: INBOX_X + 15, y: INBOX_Y + 24, class: 'mono', 'font-size': 10, fill: COLORS.muted,
      text: 'pending → handled',
    });

    const trajBox = ctx.box({ x: TRAJ_X, y: TRAJ_Y, w: TRAJ_W, h: TRAJ_H, title: 'Agent trajectory' });
    // lock marker: single writer.
    const lockG = ctx.el('g', {});
    ctx.setPos(lockG, TRAJ_X + 15, TRAJ_Y + 12);
    ctx.el('rect', { x: 0, y: 6, width: 12, height: 9, rx: 2, fill: 'none', stroke: COLORS.muted, 'stroke-width': 1.3 }, lockG);
    ctx.el('path', { d: 'M2,6 v-3 a4,4 0 0 1 8,0 v3', fill: 'none', stroke: COLORS.muted, 'stroke-width': 1.3 }, lockG);
    ctx.el('text', {
      x: 20, y: 14, class: 'mono', 'font-size': 10, fill: COLORS.muted,
      text: 'single writer: agent',
    }, lockG);
    // dashed boundary channel between the two columns.
    ctx.arrow(INBOX_X + INBOX_W, INBOX_Y + INBOX_H / 2, TRAJ_X, TRAJ_Y + INBOX_H / 2, {
      color: COLORS.iter, dash: '3 4', width: 1, head: false,
    }).setAttribute('opacity', 0.3);

    // ================= state =================
    // agentActive: true between AgentStart and AgentDone. Drives whether an
    // activation actually starts a run or is just acknowledged and dropped.
    const state = { inbox: [], traj: [], agentActive: false };
    // Serializes every inbox mutation (sends + admits) so simultaneous
    // button clicks can't race each other's reflow animations.
    let inboxLock = Promise.resolve();
    function withInboxLock(fn) {
      const p = inboxLock.then(fn, fn);
      inboxLock = p.then(() => {}, () => {});
      return p;
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

    // ACP sending an activation onward to the agent, after the durable
    // inbox append. If the agent is idle this is what actually starts a new
    // run; if it's already running, the activation is just acknowledged and
    // dropped — the running agent will pick the message up at its next
    // iteration boundary regardless.
    async function activateAgent() {
      const from = { x: ACP_X + ACP_W / 2, y: ACP_Y + ACP_H / 2 };
      // Land below the "single writer" lock marker so the ack label never
      // overlaps it.
      const to = { x: TRAJ_X - 6, y: TRAJ_Y + 46 };
      const arcY = Math.min(from.y, INBOX_Y) - 26;
      const path = ctx.el('path', {
        d: `M${from.x},${from.y} Q${(from.x + to.x) / 2},${arcY} ${to.x},${to.y}`,
        fill: 'none', stroke: 'none',
      }, root);
      const dot = ctx.el('circle', { r: 4, fill: COLORS.activation }, root);
      await ctx.along(dot, path, 420);
      path.remove();
      if (state.agentActive) {
        const ack = ctx.el('text', {
          x: to.x + 8, y: to.y + 4, class: 'mono', 'font-size': 9, fill: COLORS.muted,
          text: 'already running · ack',
        }, root);
        await ctx.pulse(to.x, to.y, COLORS.activation, 14, 320);
        await ctx.wait(260);
        await ctx.fade(ack, 0, 300);
        ack.remove();
      } else {
        await ctx.pulse(to.x, to.y, COLORS.activation, 20, 420);
      }
      dot.remove();
    }

    // ---------- inbox helpers ----------
    function inboxSlotY(i) { return INBOX_ROW_TOP + i * (CARD_H + CARD_GAP); }

    async function reflowInbox() {
      const bottomLimit = INBOX_Y + INBOX_H - 12;
      // trim from the front (prefer already-handled cards) if we'd overflow.
      while (state.inbox.length && inboxSlotY(state.inbox.length - 1) + CARD_H > bottomLimit) {
        let idx = state.inbox.findIndex((c) => c.handled);
        if (idx === -1) idx = 0;
        const [removed] = state.inbox.splice(idx, 1);
        await ctx.fade(removed.node, 0, 220);
        removed.node.remove();
      }
      await Promise.all(state.inbox.map((c, i) => ctx.move(c.node, INBOX_X + 15, inboxSlotY(i), 420)));
    }

    function markHandled(card) {
      card.handled = true;
      const rect = card.node.querySelector('rect:nth-of-type(2)') || card.node.querySelector('rect');
      card.node.querySelectorAll('rect').forEach((r) => r.setAttribute('stroke-opacity', 0.25));
      card.node.setAttribute('opacity', 0.5);
      card.statusEl.textContent = '✓ handled';
      card.statusEl.setAttribute('fill', COLORS.muted);
    }

    // Send a message from an actor into the inbox (pending). Safe to call
    // from a spawned button handler or inline from the scripted sequence.
    function sendMessage(actorKey, labelOverride) {
      return withInboxLock(async () => {
        const a = ACTORS[actorKey];
        const startX = ACTOR_X + ACTOR_W + 6;
        const startY = a.y + a.h / 2 - CARD_H / 2;
        let card;
        if (a.kind === 'ExternalAgentNotification') {
          // Agents don't write to each other's inboxes directly: the message
          // is relayed through ACP in two hops. The gap between the actor
          // column and the inbox is too narrow for a full-size card, so it
          // travels as a small token: actor → ACP (a brief pause while ACP
          // takes receipt), then ACP → inbox, where it becomes the real card.
          const token = ctx.el('circle', { r: 5, fill: colorOf(a.color) }, root);
          ctx.setPos(token, startX, a.y + a.h / 2);
          const acpX = ACP_X + ACP_W / 2, acpY = ACP_Y + ACP_H / 2;
          await ctx.move(token, acpX, acpY, 260);
          await ctx.pulse(acpX, acpY, colorOf(a.color), 14, 320);
          await ctx.wait(300);
          await ctx.move(token, INBOX_X + 15 + CARD_W / 2, INBOX_ROW_TOP + CARD_H / 2, 200);
          token.remove();
          card = renderEventCard({
            x: INBOX_X + 15, y: INBOX_ROW_TOP, w: CARD_W, h: CARD_H, kind: a.kind, tag: a.tag, label: labelOverride,
          });
        } else {
          card = renderEventCard({
            x: startX, y: startY, w: CARD_W, h: CARD_H, kind: a.kind, tag: a.tag, label: labelOverride,
          });
        }
        // On the 2-line notify cards the payload sub-label sits below
        // center — level the status tag with it so the two never collide.
        const statusY = a.kind === 'ExternalAgentNotification' ? CARD_H / 2 + 9 : CARD_H / 2 + 4;
        const statusEl = ctx.el('text', {
          x: CARD_W - 8, y: statusY, class: 'mono', 'font-size': 9.5,
          'text-anchor': 'end', fill: colorOf(a.color), text: '● pending',
        }, card);
        const entry = { node: card, statusEl, handled: false, kind: a.kind, tag: a.tag };
        state.inbox.push(entry);
        await reflowInbox();
        // The append is the durable step; ACP also sends an activation. If
        // the agent is already running it's just acknowledged and dropped —
        // the idle-wake case is driven explicitly by the sandbox loop below.
        if (state.agentActive) ctx.spawn(() => activateAgent());
        return entry;
      });
    }

    // Copy every still-pending inbox card onto the current trajectory block.
    // Returns the number admitted.
    function admitPending(block) {
      return withInboxLock(async () => {
        const pending = state.inbox.filter((c) => !c.handled);
        if (!pending.length) return 0;
        const flyCount = Math.min(pending.length, MAX_FLY_CHIPS);
        for (let i = 0; i < flyCount; i++) {
          const card = pending[i];
          const from = ctx.getPos(card.node);
          const x1 = from.x + CARD_W, y1 = from.y + CARD_H / 2;
          // Notify events get a full-width single-line chip (room to read
          // "ExternalAgentNotification · <payload>" at normal size); other
          // kinds stay compact.
          const wide = card.kind === 'ExternalAgentNotification';
          const cw = wide ? TRAJ_W - BLOCK_PAD * 2 - 20 : 160;
          const ch = wide ? 24 : 20;
          const to = block.nextChipPos(); // reserved top-left slot, claimed below
          // Drop to the slot's height while still left of (outside) the
          // trajectory box, then move straight in from the left edge — so
          // the flight only ever crosses the empty target row, never the
          // rows already sitting above it.
          const path = ctx.el('path', {
            d: `M${x1},${y1} C${x1 + 40},${y1} ${TRAJ_X - 16},${to.y + ch / 2} ${to.x},${to.y}`,
            fill: 'none', stroke: 'none',
          }, root);
          const clone = renderEventCard({ x: x1, y: y1, w: cw, h: ch, kind: card.kind, tag: card.tag });
          clone.setAttribute('opacity', 0.9);
          await ctx.along(clone, path, 560);
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
        await reflowInbox();
        await trimTraj();
        return pending.length;
      });
    }

    // ---------- trajectory helpers ----------
    function recomputeTop() {
      let y = TRAJ_ROW_TOP;
      for (const b of state.traj) y += b.height + 12;
      return y;
    }

    async function reflowTraj() {
      let y = TRAJ_ROW_TOP;
      const moves = [];
      for (const b of state.traj) {
        moves.push(ctx.move(b.g, TRAJ_X + BLOCK_PAD, y, 400));
        y += b.height + 12;
      }
      await Promise.all(moves);
    }

    async function trimTraj() {
      const bottomLimit = TRAJ_Y + TRAJ_H - 10;
      while (state.traj.length > 1 && recomputeTop() > bottomLimit) {
        const old = state.traj.shift();
        await ctx.fade(old.g, 0, 220);
        old.g.remove();
        await reflowTraj();
      }
    }

    // Shared block shape: a header (agent pill, or iteration header) plus
    // room to grow as work chips / admitted copies are appended below it.
    function makeBlock(g, startContentY, bg) {
      const block = {
        g, bg, contentY: startContentY,
        nextChipPos() {
          // absolute page position of the next chip's top-left resting
          // spot — reserved the moment it's asked for, since the caller
          // claims it (via absorbChip) before starting the next one.
          const p = ctx.getPos(g);
          return { x: p.x + 8, y: p.y + this.contentY };
        },
        absorbChip(clone) {
          // clone currently lives in root at absolute coords, already at
          // its final resting (top-left) position; reparent into this
          // block, keeping that same on-screen position.
          const abs = ctx.getPos(clone);
          const origin = ctx.getPos(g);
          g.appendChild(clone);
          ctx.setPos(clone, abs.x - origin.x, abs.y - origin.y);
          this.contentY += (clone._h || 20) + 6;
          if (this.bg) this.bg.setAttribute('height', this.contentY + 8);
        },
        addWork(label, type) {
          const chip = ctx.eventPill({ x: 8, y: this.contentY, name: type, label, w: TRAJ_W - BLOCK_PAD * 2 - 40, h: 18 }, g);
          chip.setAttribute('opacity', 0.85);
          this.contentY += 24;
          if (this.bg) this.bg.setAttribute('height', this.contentY + 8);
          return chip;
        },
        get height() { return this.contentY + 14; },
      };
      return block;
    }

    // A simple wide pill row (AgentStart / AgentDone) that can still absorb
    // messages admitted right at run start.
    async function appendAgentPill(name) {
      state.agentActive = name === 'AgentStart';
      const y = recomputeTop();
      const g = ctx.el('g', {});
      ctx.setPos(g, TRAJ_X + BLOCK_PAD, y);
      const pill = ctx.eventPill({ x: 0, y: 0, name, w: TRAJ_W - BLOCK_PAD * 2, h: 26 }, g);
      pill.setAttribute('opacity', 0);
      const block = makeBlock(g, 34, null);
      state.traj.push(block);
      await ctx.fade(pill, 1, 300);
      await trimTraj();
      return block;
    }

    // An iteration block: header, then chips appended as they happen.
    function beginIterationBlock(n) {
      const y = recomputeTop();
      const g = ctx.el('g', {});
      ctx.setPos(g, TRAJ_X + BLOCK_PAD, y);
      const bg = ctx.el('rect', {
        x: -6, y: -6, width: TRAJ_W - BLOCK_PAD * 2 + 12, height: 34, rx: 8,
        fill: 'none', stroke: COLORS.dim, 'stroke-width': 1,
      }, g);
      ctx.el('text', {
        x: 0, y: -12, class: 'mono', 'font-size': 9.5, fill: COLORS.muted,
        text: `ITERATION ${n}`,
      }, g);
      ctx.eventPill({ x: 0, y: 0, name: 'IterationStart', w: TRAJ_W - BLOCK_PAD * 2 - 20, h: 24 }, g);
      const block = makeBlock(g, 34, bg);
      state.traj.push(block);
      return block;
    }

    async function endIterationBlock(block) {
      const g = block.g;
      const gate = ctx.el('g', {}, g);
      ctx.setPos(gate, 0, block.contentY);
      ctx.eventPill({ x: 0, y: 0, name: 'IterationEnd', w: TRAJ_W - BLOCK_PAD * 2 - 20, h: 24 }, gate);
      block.contentY += 30;
      block.bg.setAttribute('height', block.contentY + 8);
      const origin = ctx.getPos(g);
      await ctx.pulse(origin.x + (TRAJ_W - BLOCK_PAD * 2) / 2, origin.y + block.contentY - 12, COLORS.iter, 20, 550);
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

    await sendMessage('user');
    await ctx.beat('The user\'s <span class="t t-user">UserMessage</span> always lands in the inbox first — never straight onto the trajectory.');

    let run = await appendAgentPill('AgentStart');
    await ctx.beat('A run starts. At run start the agent scans the inbox and copies whatever is unhandled onto its trajectory.');
    await admitPending(run);

    iterN += 1;
    let block = beginIterationBlock(iterN);
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
    block = beginIterationBlock(iterN);
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
      'Now it\'s an interactive sandbox: use the buttons any time. The agent doesn\'t watch its own ' +
      'inbox — ACP does. If it\'s idle, ACP sends an activation and a fresh ' +
      '<span class="t t-agent">AgentStart</span> picks the message up.'
    );

    // ================= autonomous sandbox loop =================
    let idleStreak = 0;
    let running = false;
    while (ctx.alive) {
      if (!running) {
        ctx.caption('Agent idle (AgentDone) — nothing runs until ACP sends an activation.');
        while (ctx.alive && !state.inbox.some((c) => !c.handled)) await ctx.wait(200);
        if (!ctx.alive) break;
        await activateAgent();
        run = await appendAgentPill('AgentStart');
        ctx.caption('ACP sends an activation — a new run starts and admits the message at run start.');
        await admitPending(run);
        running = true;
        idleStreak = 0;
      }

      iterN += 1;
      block = beginIterationBlock(iterN);
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
