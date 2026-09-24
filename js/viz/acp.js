// #viz-acp — "The Agent Control Plane"
//
// ACP sits on top of the Trajectory System. It knows which agents exist and
// which trajectory each runs on, creates agents, delivers messages, and
// decides when agents run by issuing activations — wake-up signals any node
// in the fleet can pick up to boot an agent with its trajectory.
//
// Every interaction collapses into the same two steps: append a message to
// the recipient's inbox, then send an activation. This figure plays the
// article's worked example — a subagent reporting back to its parent —
// twice: once while the parent is asleep, once while it's already running,
// plus a "lose the activation" variant. The wake-up is a signal, not the
// payload; the inbox is the source of truth.

import { COLORS, colorOf } from '../lib.js';

const W = 900, H = 420;

const SUB = { x: 24, y: 40, w: 214, h: 140 };
const ACP = { x: 350, y: 40, w: 200, h: 210 };
const PAR = { x: 686, y: 40, w: 200, h: 150 };

const CHAN_Y = 103; // height of the envelope channel through the middle of the cards
const BUS_Y = 300;  // horizontal "activation bus" above the fleet row

const NODE_W = 140, NODE_H = 50, NODE_Y = 340;
const NODE_XS = [180, 360, 540, 720]; // centers

const CALLS = ['SpawnAgent', 'ForkAndSendMessage', 'SendMessage', 'NotifyParents', 'StopAgent'];

const badge = (n, color) =>
  `<span style="display:inline-block;min-width:1.4em;height:1.4em;line-height:1.4em;` +
  `border-radius:50%;background:${color};color:#0b0b0d;text-align:center;` +
  `font-family:var(--mono);font-size:0.8em;font-weight:700;margin-right:10px;">${n}</span>&nbsp;`;

export default {
  width: W, height: H,
  async build(ctx) {
    const world = buildScaffold(ctx);

    // ---------- ambient life: subagent trajectory glows in sequence ----------
    ctx.spawn(async () => {
      let i = 0;
      while (ctx.alive) {
        await ctx.wait(650);
        if (!ctx.alive) return;
        const chips = world.sub.row.chips;
        if (chips.length) await flashChip(ctx, chips[i % chips.length]);
        i++;
      }
    });

    // ---------- buttons ----------
    let busy = false;
    const play = async (kind) => {
      if (busy || !ctx.alive) return;
      busy = true;
      try { await runCase(ctx, world, kind); }
      finally { busy = false; }
    };
    ctx.button('Parent asleep', () => ctx.spawn(() => play('asleep')));
    ctx.button('Parent running', () => ctx.spawn(() => play('running')));
    ctx.button('Lose the activation', () => ctx.spawn(() => play('lose')));

    // ---------- autoplay: cycle through all three cases ----------
    while (ctx.alive) {
      await play('asleep');
      await ctx.wait(1100);
      await play('running');
      await ctx.wait(1100);
      await play('lose');
      await ctx.wait(1600);
    }
  },
};

// ==================== static scaffolding ====================

function buildScaffold(ctx) {
  const { el } = ctx;

  // ---------- subagent card ----------
  ctx.box({ ...SUB, title: 'Subagent · explore', color: COLORS.agent });
  el('text', {
    x: SUB.x + 14, y: SUB.y + 20, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
    'letter-spacing': '0.06em', text: 'TRAJECTORY',
  });
  const subRow = makeRow(ctx, SUB.x + 14, SUB.y + 30, SUB.w - 28);
  renderRow(ctx, subRow, [
    { text: 'IterationStart', color: colorOf('iter') },
    { text: 'tool_call', color: colorOf('tool') },
    { text: 'IterationEnd', color: colorOf('iter') },
    { text: 'AgentDone', color: colorOf('agent') },
  ]);

  // ---------- ACP panel ----------
  ctx.box({ ...ACP, title: 'ACP' });
  el('text', {
    x: ACP.x + ACP.w / 2, y: ACP.y + 20, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
    'text-anchor': 'middle', 'letter-spacing': '0.06em', text: 'AGENT CONTROL PLANE',
  });
  const acpRows = {};
  CALLS.forEach((name, i) => {
    const y = ACP.y + 38 + i * 32;
    const g = el('g', {});
    const rect = el('rect', {
      x: ACP.x + 12, y, width: ACP.w - 24, height: 24, rx: 5,
      fill: COLORS.panel, stroke: COLORS.line, 'stroke-width': 1.1, 'stroke-opacity': 0.6,
    }, g);
    const text = el('text', {
      x: ACP.x + 22, y: y + 16, class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: name,
    }, g);
    acpRows[name] = { rect, text };
  });

  // ---------- parent card ----------
  ctx.box({ ...PAR, title: 'Parent · builder', color: COLORS.iter });
  const statusBadge = el('text', {
    x: PAR.x + 14, y: PAR.y + 22, class: 'mono', 'font-size': 11, fill: COLORS.muted,
    text: '💤 asleep',
  });

  el('text', {
    x: PAR.x + 14, y: PAR.y + 44, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
    'letter-spacing': '0.06em', text: 'INBOX',
  });
  const tray = makeTray(ctx, PAR.x + 4, PAR.y + 48, PAR.w - 8, 30);

  el('text', {
    x: PAR.x + 14, y: PAR.y + 92, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
    'letter-spacing': '0.06em', text: 'TRAJECTORY',
  });
  const parRow = makeRow(ctx, PAR.x + 14, PAR.y + 100, PAR.w - 28);
  renderRow(ctx, parRow, [
    { text: '…', color: COLORS.muted, plain: true },
    { text: 'IterationEnd', color: colorOf('iter') },
  ]);

  // ---------- envelope channels (dim, static hints) ----------
  ctx.arrow(SUB.x + SUB.w, CHAN_Y, ACP.x, CHAN_Y, { color: COLORS.line, dash: '3 4', width: 1, head: false }).setAttribute('opacity', 0.35);
  ctx.arrow(ACP.x + ACP.w, CHAN_Y, tray.x, CHAN_Y, { color: COLORS.line, dash: '3 4', width: 1, head: false }).setAttribute('opacity', 0.35);

  // ---------- activation bus ----------
  ctx.arrow(ACP.x + ACP.w / 2, ACP.y + ACP.h, ACP.x + ACP.w / 2, BUS_Y, { color: COLORS.activation, dash: '3 4', width: 1, head: false }).setAttribute('opacity', 0.3);
  ctx.arrow(NODE_XS[0], BUS_Y, NODE_XS[NODE_XS.length - 1], BUS_Y, { color: COLORS.activation, dash: '3 4', width: 1, head: false }).setAttribute('opacity', 0.3);

  // ---------- fleet ----------
  const nodes = NODE_XS.map((x, i) => {
    ctx.arrow(x, BUS_Y, x, NODE_Y, { color: COLORS.activation, dash: '3 4', width: 1, head: false }).setAttribute('opacity', 0.3);
    const g = ctx.box({ x: x - NODE_W / 2, y: NODE_Y, w: NODE_W, h: NODE_H, color: COLORS.line, title: null });
    const name = `node-${i + 1}`;
    const label = el('text', {
      x: NODE_W / 2, y: NODE_H / 2 + 4, 'text-anchor': 'middle', class: 'mono',
      'font-size': 10.5, fill: COLORS.muted, text: name,
    }, g);
    const subLabel = el('text', {
      x: NODE_W / 2, y: NODE_H / 2 + 17, 'text-anchor': 'middle', class: 'mono',
      'font-size': 8.5, fill: COLORS.muted, text: 'running parent', opacity: 0,
    }, g);
    return { x, box: g, rect: g._rect, label, subLabel, name };
  });
  el('text', {
    x: 24, y: NODE_Y - 12, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
    'letter-spacing': '0.06em', text: 'FLEET',
  });

  return {
    sub: { row: subRow },
    acp: { rows: acpRows },
    par: { statusBadge, tray, trayCard: null, row: parRow, running: false, tickStop: null },
    nodes,
    transient: [],
  };
}

// ==================== case script ====================

async function runCase(ctx, world, kind) {
  const { COLORS } = ctx;
  resetVisuals(ctx, world);

  const startsAwake = kind === 'running';
  setParentStatus(ctx, world, startsAwake ? 'running' : 'asleep');
  if (startsAwake) startParentTicking(ctx, world);

  // ---- step 1: AgentDone ----
  await ctx.beat(badge(1, COLORS.agent) + 'The subagent reaches <span class="t t-agent">AgentDone</span>.');
  await pulseAgentDone(ctx, world);

  // ---- step 2: NotifyParents ----
  setACPRow(ctx, world, 'NotifyParents', true);
  await ctx.beat(badge(2, COLORS.notify) +
    'Its completion envelope calls <code>NotifyParents</code>, building an ' +
    '<span class="t t-notify">ExternalAgentNotification</span> with the result and a terminal status.');
  await travelEnvelope(ctx, world, 'leg1');
  setACPRow(ctx, world, 'NotifyParents', false);

  // ---- step 3: SendMessage — the durable write ----
  setACPRow(ctx, world, 'SendMessage', true);
  await ctx.beat(badge(3, COLORS.notify) +
    '<code>SendMessage</code> appends it to the parent&rsquo;s inbox. <strong>This write is the durable part</strong> — ' +
    'the message is safe whatever happens next.');
  await travelEnvelope(ctx, world, 'leg2');
  await showDurableStamp(ctx, world);
  setACPRow(ctx, world, 'SendMessage', false);

  // ---- step 4: the activation ----
  if (kind === 'asleep') {
    await ctx.beat(badge(4, COLORS.activation) +
      'ACP sends an activation. The parent is <strong>asleep</strong> — any free node in the fleet can pick it up.');
    const node = world.nodes[1];
    await activationTravel(ctx, world, node);
    await bootNode(ctx, world, node);
    setParentStatus(ctx, world, 'running');
    await ctx.beat('That node boots the parent with its trajectory and starts a run that finds the notification already waiting in the inbox.');
    await admitNotification(ctx, world, { boot: true });
    await ctx.wait(500);
    await cleanupNode(ctx, world, node);
  } else if (kind === 'running') {
    await ctx.beat(badge(4, COLORS.activation) +
      'ACP sends an activation too — but the parent is <strong>already running</strong>. A node tries to claim it anyway.');
    const node = world.nodes[2];
    await activationTravel(ctx, world, node);
    await rejectClaim(ctx, world, node);
    await ctx.beat('A run claims its activation, and each trajectory has a single exclusive writer — the duplicate is acknowledged and dropped.');
    await cleanupNode(ctx, world, node);
    await ctx.beat('Instead, the parent&rsquo;s own next <span class="t t-iter">IterationEnd</span> picks up the notification itself.');
    await admitNotification(ctx, world, { boot: false });
    stopParentTicking(world);
  } else {
    await ctx.beat(badge(4, COLORS.activation) + 'ACP sends an activation — but this time it never arrives.');
    await activationFizzle(ctx, world);
    await ctx.beat('Losing an activation is harmless: the message already sits safely in the inbox.');
    await pulseDurableStamp(ctx, world);
    await ctx.beat('A later re-drive sends a fresh activation, and it works exactly the same way.');
    const node = world.nodes[0];
    await activationTravel(ctx, world, node);
    await bootNode(ctx, world, node);
    setParentStatus(ctx, world, 'running');
    await admitNotification(ctx, world, { boot: true });
    await ctx.wait(500);
    await cleanupNode(ctx, world, node);
  }

  stopParentTicking(world);
  await ctx.beat('Losing or duplicating an activation is harmless — the inbox is the source of truth.', 1200);
  setParentStatus(ctx, world, 'asleep');
}

// ==================== visual helpers ====================

function resetVisuals(ctx, world) {
  stopParentTicking(world);
  if (world.par.trayCard) { world.par.trayCard.g.remove(); world.par.trayCard = null; }
  world.acp.rows.NotifyParents.rect.setAttribute('stroke', COLORS.line);
  world.acp.rows.SendMessage.rect.setAttribute('stroke', COLORS.line);
  for (const name of CALLS) setACPRow(ctx, world, name, false);
  for (const n of world.nodes) idleNode(n);
  for (const t of world.transient) t.remove();
  world.transient = [];
  renderRow(ctx, world.par.row, [
    { text: '…', color: COLORS.muted, plain: true },
    { text: 'IterationEnd', color: colorOf('iter') },
  ]);
}

function setACPRow(ctx, world, name, on) {
  const row = world.acp.rows[name];
  const color = on ? COLORS.notify : COLORS.line;
  row.rect.setAttribute('stroke', color);
  row.rect.setAttribute('stroke-opacity', on ? 1 : 0.6);
  row.rect.setAttribute('stroke-width', on ? 1.75 : 1.1);
  row.text.setAttribute('fill', on ? COLORS.notify : COLORS.muted);
}

async function pulseAgentDone(ctx, world) {
  const chips = world.sub.row.chips;
  const chip = chips[chips.length - 1];
  if (!chip) return;
  const x = world.sub.row.x + chip._x + chip._w / 2;
  const y = world.sub.row.y + chip._y + chip._h / 2;
  await ctx.pulse(x, y, COLORS.agent, 18, 500);
}

function setParentStatus(ctx, world, state) {
  world.par.running = state === 'running';
  world.par.statusBadge.textContent = state === 'running' ? '● running' : '💤 asleep';
  world.par.statusBadge.setAttribute('fill', state === 'running' ? COLORS.tool : COLORS.muted);
}

// Plays the parent's own trajectory forward one event at a time —
// IterationStart, then tool_call, then IterationEnd — instead of jumping
// straight to IterationEnd, then keeps that last event flashing (still
// "iterating") until stopped.
function startParentTicking(ctx, world) {
  const flag = { stop: false };
  world.par.tickStop = flag;
  ctx.spawn(async () => {
    const seq = [
      { text: 'IterationStart', color: colorOf('iter') },
      { text: 'tool_call', color: colorOf('tool') },
      { text: 'IterationEnd', color: colorOf('iter') },
    ];
    for (const step of seq) {
      if (!ctx.alive || flag.stop) return;
      renderRow(ctx, world.par.row, [step]);
      const chips = world.par.row.chips;
      if (chips.length) await flashChip(ctx, chips[chips.length - 1]);
      await ctx.wait(350);
    }
    while (ctx.alive && !flag.stop) {
      await ctx.wait(650);
      if (!ctx.alive || flag.stop) return;
      const chips = world.par.row.chips;
      const last = chips[chips.length - 1];
      if (last) await flashChip(ctx, last);
    }
  });
}

function stopParentTicking(world) {
  if (world.par.tickStop) world.par.tickStop.stop = true;
  world.par.tickStop = null;
}

// Envelope always approaches the parent card from the side, entering the
// inbox tray at CHAN_Y — never crossing the status line above it, no matter
// whether the parent is asleep, running, or the activation is lost.
async function travelEnvelope(ctx, world, leg) {
  const from = leg === 'leg1'
    ? { x: SUB.x + SUB.w, y: CHAN_Y }
    : { x: ACP.x + ACP.w, y: CHAN_Y };
  const to = leg === 'leg1'
    ? { x: ACP.x, y: CHAN_Y }
    : { x: world.par.tray.x, y: CHAN_Y };
  const path = ctx.arrow(from.x, from.y, to.x, to.y, { color: colorOf('notify'), dash: '3 3', width: 1.25, head: false });
  path.setAttribute('opacity', 0.6);
  const env = envelope(ctx, colorOf('notify'));
  ctx.setPos(env, from.x, from.y);
  await ctx.along(env, path, 800);
  env.remove();
  path.remove();
  if (leg === 'leg2') {
    landTrayCard(ctx, world);
  } else {
    await ctx.pulse(to.x, to.y, colorOf('notify'), 16, 380);
  }
}

async function showDurableStamp(ctx, world) {
  const card = world.par.trayCard;
  if (!card) return;
  await ctx.fade(card.stamp, 1, 300);
}

async function pulseDurableStamp(ctx, world) {
  const card = world.par.trayCard;
  if (!card) return;
  await ctx.pulse(card.stampX + 7, card.stampY + 7, COLORS.tool, 14, 500);
}

// Copies the landed inbox card into the parent's trajectory row (as an
// ExternalAgentNotification pill), then marks the original inbox card
// "handled" once absorbed. Only the most recent trajectory item is kept
// (behind a "…" elision) before the new pill, so the row — however long the
// parent's real history is — always has room to land inside the card.
async function admitNotification(ctx, world, { boot }) {
  const card = world.par.trayCard;
  const row = world.par.row;
  if (!card) return;

  const last = row.items[row.items.length - 1];
  const finalItems = [
    ...(last ? [{ text: '…', color: COLORS.muted, plain: true }, last] : []),
    { text: 'ExternalAgentNotification', color: colorOf('notify') },
  ];
  // Figure out exactly where the new pill will land *before* it's added, so
  // the flying chip can be sent straight there instead of to a stale
  // end-of-row point that may no longer be on the same line.
  const layout = layoutItems(ctx, finalItems, row.maxW);
  const landing = layout.positions[layout.positions.length - 1];
  const destX = row.x + landing.x;
  const destY = row.y + landing.y;

  const clone = chip(ctx, undefined, card.x, card.y, 'Notif', colorOf('notify'));
  await ctx.move(clone, destX, destY, 500);
  await ctx.fade(clone, 0, 150);
  clone.remove();

  renderRow(ctx, row, finalItems);

  ctx.el('text', {
    x: card.w - 4, y: -5, 'text-anchor': 'end', class: 'mono', 'font-size': 9,
    fill: COLORS.muted, text: 'handled',
  }, card.g);
  await ctx.fade(card.g, 0.4, 300);
}

async function activationTravel(ctx, world, node) {
  const fromX = ACP.x + ACP.w / 2, fromY = ACP.y + ACP.h;
  const toX = node.x, toY = NODE_Y;
  const bolt = ctx.el('path', {
    d: `M${fromX},${fromY} L${fromX},${BUS_Y} L${toX},${BUS_Y} L${toX},${toY}`,
    fill: 'none', stroke: COLORS.activation, 'stroke-width': 2, opacity: 0.9,
  });
  await ctx.draw(bolt, 380);
  await ctx.wait(80);
  await ctx.fade(bolt, 0, 200);
  bolt.remove();
}

async function activationFizzle(ctx, world) {
  const fromX = ACP.x + ACP.w / 2, fromY = ACP.y + ACP.h;
  const midX = (fromX + NODE_XS[0]) / 2, midY = BUS_Y;
  const bolt = ctx.el('path', {
    d: `M${fromX},${fromY} L${fromX},${BUS_Y} L${midX},${BUS_Y}`,
    fill: 'none', stroke: COLORS.activation, 'stroke-width': 2, opacity: 0.9,
  });
  await ctx.draw(bolt, 300);
  await ctx.pulse(midX, midY, COLORS.revert, 18, 450);
  await ctx.fade(bolt, 0, 250);
  bolt.remove();
}

// Lights up the node, labels it as the one running the parent, and draws a
// clear connecting line from the node up to the parent card.
async function bootNode(ctx, world, node) {
  node.rect.setAttribute('stroke', COLORS.activation);
  node.rect.setAttribute('stroke-width', 2);
  node.label.setAttribute('fill', COLORS.activation);
  node.label.setAttribute('y', NODE_H / 2 - 3);
  node.subLabel.setAttribute('fill', COLORS.activation);
  node.subLabel.setAttribute('opacity', 1);
  await ctx.pulse(node.x, NODE_Y + NODE_H / 2, COLORS.activation, 22, 500);
  const line = ctx.arrow(node.x, NODE_Y, PAR.x + PAR.w / 2, PAR.y + PAR.h, {
    color: COLORS.activation, curve: -30, width: 2, head: true,
  });
  line.setAttribute('opacity', 0.95);
  world.transient.push(line);
  await ctx.draw(line, 400);
}

async function rejectClaim(ctx, world, node) {
  node.rect.setAttribute('stroke', COLORS.revert);
  node.label.setAttribute('fill', COLORS.revert);
  const bubble = ctx.el('text', {
    x: node.x, y: NODE_Y - 10, 'text-anchor': 'middle', class: 'mono',
    'font-size': 10.5, fill: COLORS.revert, text: 'already claimed',
  });
  world.transient.push(bubble);
  bubble.setAttribute('opacity', 0);
  await ctx.fade(bubble, 1, 200);
  await ctx.wait(500);
  bubble.textContent = 'ack & drop';
  await ctx.wait(500);
  await ctx.fade(bubble, 0, 250);
  bubble.remove();
  world.transient = world.transient.filter((t) => t !== bubble);
}

function idleNode(node) {
  node.rect.setAttribute('stroke', COLORS.line);
  node.rect.setAttribute('stroke-width', 1.25);
  node.label.setAttribute('fill', COLORS.muted);
  node.label.setAttribute('y', NODE_H / 2 + 4);
  node.label.textContent = node.name;
  node.subLabel.setAttribute('fill', COLORS.muted);
  node.subLabel.setAttribute('opacity', 0);
}

async function cleanupNode(ctx, world, node) {
  idleNode(node);
  const lines = world.transient.filter((t) => t.tagName === 'path');
  for (const l of lines) {
    await ctx.fade(l, 0, 250);
    l.remove();
  }
  world.transient = world.transient.filter((t) => !lines.includes(t));
}

// ==================== small building blocks ====================

function envelope(ctx, color) {
  const g = ctx.el('g', {});
  ctx.el('rect', { x: -9, y: -6, width: 18, height: 12, rx: 2, fill: COLORS.panel, stroke: color, 'stroke-width': 1.4 }, g);
  ctx.el('path', { d: 'M-9,-6 L0,1 L9,-6', fill: 'none', stroke: color, 'stroke-width': 1.4 }, g);
  return g;
}

// A dashed tray box that sits inside the parent card; the landed
// notification card is drawn on top of it at a known absolute position.
function makeTray(ctx, x, y, w, h) {
  const g = ctx.el('g', {});
  ctx.setPos(g, x, y);
  ctx.el('rect', {
    x: 0, y: 0, width: w, height: h, rx: 6, fill: COLORS.bg,
    stroke: COLORS.dim, 'stroke-width': 1, 'stroke-dasharray': '3 3',
  }, g);
  return { g, x, y, w, h };
}

// Builds the rendered "Notif · Completed" card inside the tray, with a
// durable-stamp badge attached to its own corner (not near the status line).
function landTrayCard(ctx, world) {
  const tray = world.par.tray;
  const w = tray.w - 8, h = tray.h - 10;
  const x = tray.x + 4, y = tray.y + 5;
  const g = ctx.el('g', {});
  ctx.setPos(g, x, y);
  ctx.el('rect', { width: w, height: h, rx: 4, fill: COLORS.panel, stroke: colorOf('notify'), 'stroke-width': 1.25 }, g);
  ctx.el('rect', { width: 3, height: h, rx: 1.5, fill: colorOf('notify') }, g);
  ctx.el('text', { x: 9, y: h / 2 + 3.5, class: 'mono', 'font-size': 10.5, fill: COLORS.text, text: 'Notif · Completed' }, g);

  const stampX = x + w - 8, stampY = y + h / 2 - 7;
  const stamp = ctx.el('g', {});
  ctx.setPos(stamp, stampX, stampY);
  ctx.el('circle', { cx: 7, cy: 7, r: 7, fill: COLORS.bg, stroke: colorOf('tool'), 'stroke-width': 1.3 }, stamp);
  ctx.el('path', { d: 'M3,7.5 l2.5,3 l5.5,-6.5', fill: 'none', stroke: colorOf('tool'), 'stroke-width': 1.5 }, stamp);
  stamp.setAttribute('opacity', 0);

  world.par.trayCard = { g, stamp, stampX, stampY, x, y, w, h };
  return world.par.trayCard;
}

// ---------- readable event-pill rows (replaces the old thin tick strips) ----------

function measureText(ctx, text, fontSize = 10.5) {
  const t = ctx.el('text', { x: -9999, y: -9999, class: 'mono', 'font-size': fontSize, text });
  const w = t.getBBox().width;
  t.remove();
  return w;
}

// A compact, readable event pill: colored left stripe + border + mono label.
function chip(ctx, parent, x, y, text, color, h = 18) {
  const w = measureText(ctx, text) + 18;
  const g = ctx.el('g', {}, parent);
  ctx.setPos(g, x, y);
  ctx.el('rect', { width: w, height: h, rx: 4, fill: COLORS.panel, stroke: color, 'stroke-width': 1, 'stroke-opacity': 0.6 }, g);
  ctx.el('rect', { width: 3, height: h, rx: 1.5, fill: color }, g);
  ctx.el('text', { x: 9, y: h / 2 + 3.5, class: 'mono', 'font-size': 10.5, fill: COLORS.text, text }, g);
  g._w = w; g._h = h;
  return g;
}

// A wrapping row of event pills at a fixed absolute (x, y), joined by "·"
// separators. Plain (non-boxed) items — like the "…" history placeholder —
// render as bare mono text instead of a pill.
function makeRow(ctx, x, y, maxW) {
  const g = ctx.el('g', {});
  ctx.setPos(g, x, y);
  return { g, x, y, maxW, items: [], chips: [], height: 18, endX: 0, endY: 0 };
}

// Pure layout pass: figures out where each item (and separator dot) lands,
// without drawing anything. Shared by renderRow (which draws it) and by
// callers that need to know where an item *will* land before it's added
// (e.g. flying a chip to its future resting place).
function layoutItems(ctx, items, maxW) {
  const H = 18, LGAP = 6;
  let cx = 0, cy = 0, firstInLine = true;
  const positions = [];
  items.forEach((it, i) => {
    const w = it.plain ? measureText(ctx, it.text) : measureText(ctx, it.text) + 18;
    const needsDot = i > 0 && !firstInLine;
    const dotW = needsDot ? 12 : 0;
    if (!firstInLine && cx + dotW + w > maxW) {
      cx = 0; cy += H + LGAP; firstInLine = true;
    }
    let dot = false;
    if (i > 0 && !firstInLine) {
      dot = true;
      cx += 12;
    }
    positions.push({ item: it, x: cx, y: cy, w, h: H, dot });
    cx += w + 6;
    firstInLine = false;
  });
  return { positions, height: cy + H, endX: cx, endY: cy };
}

function renderRow(ctx, row, items) {
  row.g.innerHTML = '';
  row.items = items;
  const layout = layoutItems(ctx, items, row.maxW);
  const chips = [];
  layout.positions.forEach((pos) => {
    if (pos.dot) {
      ctx.el('text', { x: pos.x - 9, y: pos.y + pos.h / 2 + 3.5, class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: '·' }, row.g);
    }
    let node;
    if (pos.item.plain) {
      node = ctx.el('text', { x: pos.x, y: pos.y + pos.h / 2 + 3.5, class: 'mono', 'font-size': 10.5, fill: pos.item.color || COLORS.muted, text: pos.item.text }, row.g);
      node._x = pos.x; node._y = pos.y; node._w = pos.w; node._h = pos.h;
    } else {
      node = chip(ctx, row.g, pos.x, pos.y, pos.item.text, pos.item.color, pos.h);
    }
    chips.push(node);
  });
  row.chips = chips;
  row.height = layout.height;
  row.endX = layout.endX;
  row.endY = layout.endY;
  return row;
}

async function flashChip(ctx, chipG) {
  const rect = chipG.querySelector('rect');
  if (!rect || !rect.hasAttribute('stroke-opacity')) return;
  rect.setAttribute('stroke-opacity', '1');
  await ctx.wait(300);
  rect.setAttribute('stroke-opacity', '0.6');
}
