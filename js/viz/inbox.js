// #viz-inbox — "Two logs per agent: the inbox and the agent trajectory"
// Left: actors that can only append to the inbox. Middle: the inbox, a pile
// of pending/handled message cards. Right: the agent trajectory, the one
// lane the agent itself writes — built from iteration blocks. At every
// IterationEnd (and at run start) a gate opens and whatever is still
// pending in the inbox gets copied onto the trajectory in order.

import { COLORS, colorOf } from '../lib.js';

const W = 900, H = 460;

const ACTOR_X = 20, ACTOR_W = 130;
const ACTORS = {
  user: { y: 60, h: 66, label: 'User', kind: 'UserMessage', color: 'user' },
  subagent: { y: 172, h: 66, label: 'Subagent', kind: 'ExternalAgentNotification', color: 'notify', tag: 'subagent done' },
  scheduler: { y: 284, h: 66, label: 'Scheduler', kind: 'ExternalAgentNotification', color: 'notify', tag: 'wake-up' },
};

const INBOX_X = 220, INBOX_W = 240, INBOX_Y = 40, INBOX_H = 380;
const INBOX_ROW_TOP = INBOX_Y + 40;
const CARD_W = INBOX_W - 30, CARD_H = 32, CARD_GAP = 9;

const TRAJ_X = 510, TRAJ_W = 370, TRAJ_Y = 40, TRAJ_H = 380;
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
      // faint guide toward the inbox — actors only ever write here.
      ctx.arrow(ACTOR_X + ACTOR_W, a.y + a.h / 2, INBOX_X, INBOX_Y + 16, {
        color: COLORS.line, dash: '2 4', width: 1, curve: 0, head: false,
      }).setAttribute('opacity', 0.35);
    }

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
    const state = { inbox: [], traj: [] };
    // Serializes every inbox mutation (sends + admits) so simultaneous
    // button clicks can't race each other's reflow animations.
    let inboxLock = Promise.resolve();
    function withInboxLock(fn) {
      const p = inboxLock.then(fn, fn);
      inboxLock = p.then(() => {}, () => {});
      return p;
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
        const label = labelOverride || (a.tag ? `Notif: ${a.tag}` : a.kind);
        const startX = ACTOR_X + ACTOR_W + 6;
        const startY = a.y + a.h / 2 - CARD_H / 2;
        const card = ctx.eventPill({ x: startX, y: startY, name: a.kind, label, w: CARD_W, h: CARD_H });
        const statusEl = ctx.el('text', {
          x: CARD_W - 8, y: CARD_H / 2 + 4, class: 'mono', 'font-size': 9.5,
          'text-anchor': 'end', fill: colorOf(a.color), text: '● pending',
        }, card);
        const entry = { node: card, statusEl, handled: false, kind: a.kind };
        state.inbox.push(entry);
        await reflowInbox();
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
          const to = block.nextChipPos();
          const path = ctx.el('path', {
            d: `M${x1},${y1} Q${(x1 + to.x) / 2 + 40},${(y1 + to.y) / 2 - 30} ${to.x},${to.y}`,
            fill: 'none', stroke: 'none',
          }, root);
          const clone = ctx.eventPill({
            x: x1, y: y1, name: card.kind, label: card.node.querySelector('text').textContent, w: 160, h: 20,
          });
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
          // absolute page position where the next chip should land
          const p = ctx.getPos(g);
          return { x: p.x + (TRAJ_W - BLOCK_PAD * 2) / 2, y: p.y + this.contentY + 10 };
        },
        absorbChip(clone) {
          // clone currently lives in root at absolute coords; reparent into
          // this block, keeping the same on-screen position.
          const abs = ctx.getPos(clone);
          const origin = ctx.getPos(g);
          g.appendChild(clone);
          ctx.setPos(clone, abs.x - origin.x - 80, abs.y - origin.y - 10);
          this.contentY += 26;
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
      'Now it\'s an interactive sandbox: use the buttons any time. If the agent is idle when a ' +
      'message lands, a fresh <span class="t t-agent">AgentStart</span> picks it up right away.'
    );

    // ================= autonomous sandbox loop =================
    let idleStreak = 0;
    let running = true;
    while (ctx.alive) {
      if (!running) {
        ctx.caption('Agent idle (AgentDone). Waiting for a new message to arrive in the inbox…');
        while (ctx.alive && !state.inbox.some((c) => !c.handled)) await ctx.wait(200);
        if (!ctx.alive) break;
        run = await appendAgentPill('AgentStart');
        ctx.caption('A message arrived — a new run starts and admits it immediately.');
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
