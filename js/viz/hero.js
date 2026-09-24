// #viz-hero — ambient overview of the whole system: a workspace-level chat
// agent fanning work out to project builders, which boot on fleet nodes and
// report progress back, all through inboxes + activations over the ACP.
// Every agent box carries live state (status badge, activity line, inbox
// count, a git-style trajectory lane) so the figure reads as a real system
// at a glance rather than a wireframe.

const GLOW_ID = 'hero-glow';

const IDLE_CAPTIONS = [
  'the chat agent runs at the workspace level, on its own trajectory',
  'agents never call each other directly — they write to an inbox and let ACP handle the rest',
  'a wake-up is a signal, not a payload: the inbox is always the source of truth',
  'any node in the fleet can pick up an activation and boot an agent with its trajectory',
  'every delivery is two steps: append to the inbox, then ACP sends an activation',
  'a reconciler re-drives unresolved activations, so a lost wake-up is a delay, not a lost message',
  'trajectories only ever branch — forks inherit history without copying it',
];

// event type -> what shows on the activity line while that tick is "current"
const ACTIVITY = {
  user: 'UserMessage received',
  iter: 'IterationStart',
  tool: 'tool_call edit_file',
  thinking: 'thinking…',
  content: 'writing response…',
  compact: 'compacting context…',
  notify: 'ExternalAgentNotification',
  agent: 'AgentDone',
};

const CHAT_SEQ = ['user', 'iter', 'thinking', 'tool', 'content', 'notify'];
const BUILD_SEQ = ['iter', 'thinking', 'tool', 'content', 'iter', 'tool', 'compact'];

const STATUS = {
  asleep: { color: 'dim', label: 'asleep' },
  running: { color: 'tool', label: 'running' },
  suspended: { color: 'activation', label: 'suspended' },
};

export default {
  width: 900,
  height: 480,
  loop: false,
  async build(ctx) {
    const { COLORS } = ctx;
    ensureGlow(ctx);

    // ---------- layout ----------
    const chat = { x: 340, y: 20, w: 220, h: 110 };
    const projectDefs = [
      { key: 'marketing', label: 'marketing-site', x: 60, y: 190, w: 210, h: 110 },
      { key: 'dashboard', label: 'dashboard', x: 345, y: 190, w: 210, h: 110 },
      { key: 'mobile', label: 'mobile-app', x: 630, y: 190, w: 210, h: 110 },
    ];
    const acpY = 350;
    const fleetY = 400;
    const fleetXs = [110, 265, 420, 575, 730];
    const nodeW = 118, nodeH = 46;

    // ---------- chat panel ----------
    ctx.el('text', {
      x: chat.x + chat.w / 2, y: chat.y - 10, 'text-anchor': 'middle',
      class: 'mono', 'font-size': 11, fill: COLORS.muted, 'letter-spacing': '0.08em',
      text: 'CHAT AGENT · workspace',
    });
    const chatPanel = makePanel(ctx, { x: chat.x, y: chat.y, w: chat.w, h: chat.h, accent: COLORS.agent });
    chatPanel.isChat = true;
    // Chat wakes briefly (status -> running) whenever it handles an event —
    // sending a task or admitting a notification — then falls back asleep
    // shortly after, unless a newer wake supersedes the pending sleep.
    let wakeToken = 0;
    const chatWake = () => {
      setStatus(ctx, chatPanel, 'running');
      const token = ++wakeToken;
      ctx.spawn(async () => {
        await ctx.wait(1000);
        if (ctx.alive && token === wakeToken) {
          setStatus(ctx, chatPanel, 'asleep');
          chatPanel.activity.textContent = 'idle · waiting for a message';
        }
      });
    };
    setStatus(ctx, chatPanel, 'asleep');
    chatPanel.activity.textContent = 'idle · waiting for a message';
    prefill(ctx, chatPanel.lane, () => ctx.colorOf(CHAT_SEQ[Math.floor(Math.random() * CHAT_SEQ.length)]));

    // ---------- project panels ----------
    const projects = projectDefs.map((p) => {
      ctx.el('text', {
        x: p.x + p.w / 2, y: p.y - 10, 'text-anchor': 'middle',
        class: 'mono', 'font-size': 10.5, fill: COLORS.muted, 'letter-spacing': '0.06em',
        text: p.label.toUpperCase(),
      });
      const panel = makePanel(ctx, { x: p.x, y: p.y, w: p.w, h: p.h, accent: COLORS.iter });
      setStatus(ctx, panel, 'asleep');
      panel.activity.textContent = 'idle · waiting for a task';
      prefill(ctx, panel.lane, () => ctx.colorOf(BUILD_SEQ[Math.floor(Math.random() * BUILD_SEQ.length)]));
      return { ...p, panel, busy: false };
    });

    // ---------- ACP bar ----------
    ctx.el('rect', {
      x: 60, y: acpY, width: 780, height: 18, rx: 9,
      fill: COLORS.panel, stroke: COLORS.line, 'stroke-width': 1,
    });
    ctx.el('text', {
      x: 450, y: acpY + 12, 'text-anchor': 'middle', class: 'mono',
      'font-size': 10, fill: COLORS.muted, 'letter-spacing': '0.08em',
      text: 'AGENT CONTROL PLANE',
    });

    // ---------- fleet nodes ----------
    const nodes = fleetXs.map((x, i) => makeNode(ctx, x, fleetY, nodeW, nodeH, i));

    // ---------- connectors ----------
    projects.forEach((p) => {
      ctx.arrow(p.x + p.w / 2, p.y + p.h, p.x + p.w / 2, acpY, { color: COLORS.dim, width: 1, head: false });
    });
    fleetXs.forEach((x) => {
      ctx.arrow(x, acpY + 18, x, fleetY, { color: COLORS.dim, width: 1, head: false });
    });
    // The chat agent reaches the projects only through ACP: its link runs
    // down the gutter between the first two projects into the bar.
    const gutterX = (projectDefs[0].x + projectDefs[0].w + projectDefs[1].x) / 2;
    const chatLinkY = chat.y + chat.h / 2;
    ctx.el('path', {
      d: `M${chat.x},${chatLinkY} L${gutterX},${chatLinkY} L${gutterX},${acpY}`,
      fill: 'none', stroke: COLORS.dim, 'stroke-width': 1,
    });

    // ---------- captions ----------
    let lastSaid = 0;
    const say = (text) => { ctx.caption(text); lastSaid = performance.now(); };
    say('watching the whole system idle, waiting for work to arrive');

    let idleIdx = 0;
    ctx.spawn(async () => {
      while (ctx.alive) {
        await ctx.wait(1600);
        if (!ctx.alive) return;
        if (performance.now() - lastSaid > 2600) {
          ctx.caption(IDLE_CAPTIONS[idleIdx % IDLE_CAPTIONS.length]);
          idleIdx++;
          lastSaid = performance.now() - 2600;
        }
      }
    });

    // chat trajectory ticks forever (ambient thinking/tool chatter)
    ctx.spawn(async () => {
      let i = 0;
      while (ctx.alive) {
        await ctx.wait(900 + Math.random() * 500);
        if (!ctx.alive) return;
        chatWake(); // the chat agent only appends events while it's running
        tick(ctx, chatPanel, CHAT_SEQ[i % CHAT_SEQ.length]);
        i++;
      }
    });

    // frequent forks, branching off a real tick on a random builder's lane
    ctx.spawn(async () => {
      while (ctx.alive) {
        await ctx.wait(3600 + Math.random() * 3200);
        if (!ctx.alive) return;
        const p = projects[Math.floor(Math.random() * projects.length)];
        say(`a background fork branches off ${p.label}'s trajectory to summarize and keep going`);
        await showFork(ctx, p);
      }
    });

    const world = { chat, chatPanel, chatWake, projects, nodes, acpY, gutterX, chatLinkY, say };

    ctx.button('Send a task', () => ctx.spawn(() => runFanOut(ctx, world)));

    // ambient auto-loop: keep firing overlapping fan-outs so several things
    // are always in flight at once.
    while (ctx.alive) {
      ctx.spawn(() => runFanOut(ctx, world));
      await ctx.wait(1300 + Math.random() * 1100);
    }
  },
};

// ---------- glow ----------

function ensureGlow(ctx) {
  if (ctx.svg.querySelector('#' + GLOW_ID)) return;
  let defs = ctx.svg.querySelector('defs');
  if (!defs) defs = ctx.el('defs', {}, ctx.svg);
  const filter = ctx.el('filter', { id: GLOW_ID, x: '-60%', y: '-60%', width: '220%', height: '220%' }, defs);
  ctx.el('feGaussianBlur', { stdDeviation: 5, in: 'SourceGraphic' }, filter);
}

// ---------- panels (chat + project boxes with live content) ----------

function makePanel(ctx, { x, y, w, h, accent }) {
  const { COLORS } = ctx;
  const glow = ctx.el('rect', {
    x: x - 10, y: y - 10, width: w + 20, height: h + 20, rx: 16,
    fill: accent, opacity: 0, filter: `url(#${GLOW_ID})`,
  });
  const box = ctx.box({ x, y, w, h, color: accent });

  const statusDot = ctx.el('circle', { cx: x + 14, cy: y + 17, r: 3.5, fill: COLORS.dim });
  const statusText = ctx.el('text', {
    x: x + 22, y: y + 20, class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: 'asleep',
  });

  const trayX = x + w - 30, trayY = y + 9;
  const tray = trayIcon(ctx, trayX, trayY, COLORS.notify);
  const countBg = ctx.el('circle', { cx: trayX + 23, cy: trayY - 3, r: 7, fill: COLORS.notify, opacity: 0 });
  const countText = ctx.el('text', {
    x: trayX + 23, y: trayY, 'text-anchor': 'middle', class: 'mono', 'font-size': 8.5,
    fill: COLORS.bg, opacity: 0, text: '',
  });

  const activity = ctx.el('text', {
    x: x + 14, y: y + 40, class: 'mono', 'font-size': 10, fill: COLORS.muted, text: '· · ·',
  });

  const lane = makeLane(ctx, x + 10, y + h - 30, w - 20);

  return {
    x, y, w, h, glow, box, statusDot, statusText, tray, countBg, countText, activity, lane,
    inboxCount: 0,
    trayPoint: { x: trayX + 11, y: trayY + 8 },
  };
}

function setStatus(ctx, panel, status) {
  const s = STATUS[status];
  const color = ctx.COLORS[s.color];
  panel.statusDot.setAttribute('fill', color);
  panel.statusText.textContent = s.label;
}

function tick(ctx, panel, type) {
  addChip(ctx, panel.lane, ctx.colorOf(type));
  // The chat agent only ever sees a builder's AgentDone as an incoming result.
  panel.activity.textContent = panel.isChat && type === 'agent'
    ? 'admitted a builder result'
    : ACTIVITY[type] || type;
}

function setInboxCount(ctx, panel, n) {
  panel.inboxCount = n;
  panel.countText.textContent = String(n);
  ctx.fade(panel.countBg, n > 0 ? 0.95 : 0, 150).catch(() => {});
  ctx.fade(panel.countText, n > 0 ? 1 : 0, 150).catch(() => {});
}

function setPanelGlow(ctx, panel, on) {
  ctx.fade(panel.glow, on ? 0.4 : 0, 300).catch(() => {});
}

function trayIcon(ctx, x, y, color) {
  const g = ctx.el('g', {});
  ctx.setPos(g, x, y);
  ctx.el('rect', { x: 0, y: 0, width: 22, height: 16, rx: 3, fill: 'none', stroke: color, 'stroke-width': 1.25, opacity: 0.7 }, g);
  ctx.el('path', { d: 'M0,0 L11,9 L22,0', fill: 'none', stroke: color, 'stroke-width': 1.25, opacity: 0.7 }, g);
  return g;
}

// ---------- trajectory lane: fixed-capacity, git-style chip row ----------
// Fills up to capacity without shifting; once full, adding a chip drops the
// oldest (left) one and smoothly slides the rest over, so the lane always
// reads as rich, dense history.
function makeLane(ctx, x, y, w) {
  const chipW = 9, chipH = 16, gap = 3, pad = 8;
  const pitch = chipW + gap;
  const h = chipH + 8;
  const capacity = Math.max(4, Math.floor((w - 2 * pad + gap) / pitch));
  const g = ctx.el('g', {});
  ctx.setPos(g, x, y);
  ctx.el('rect', { x: 0, y: 0, width: w, height: h, rx: 5, fill: ctx.COLORS.bg, stroke: ctx.COLORS.dim, 'stroke-width': 1 }, g);
  const clipId = 'clip-' + Math.random().toString(36).slice(2);
  const defs = ctx.el('clipPath', { id: clipId }, g);
  ctx.el('rect', { x: 2, y: 2, width: w - 4, height: h - 4, rx: 4 }, defs);
  const inner = ctx.el('g', { 'clip-path': `url(#${clipId})`, transform: `translate(0, ${(h - chipH) / 2})` }, g);
  return { g, inner, w, h, chipW, chipH, pad, pitch, capacity, ticks: [] };
}

function addChip(ctx, lane, color, instant = false) {
  const chip = ctx.el('rect', {
    y: 0, width: lane.chipW, height: lane.chipH, rx: 2, fill: color, opacity: instant ? 0.95 : 0,
  }, lane.inner);
  if (lane.ticks.length >= lane.capacity) {
    const old = lane.ticks.shift();
    ctx.fade(old.el, 0, 150).then(() => old.el.remove()).catch(() => {});
    lane.ticks.forEach((t, i) => {
      const fromX = parseFloat(t.el.getAttribute('x'));
      const toX = lane.pad + i * lane.pitch;
      if (fromX !== toX) ctx.animate(220, (k) => t.el.setAttribute('x', fromX + (toX - fromX) * k)).catch(() => {});
    });
  }
  chip.setAttribute('x', lane.pad + lane.ticks.length * lane.pitch);
  lane.ticks.push({ el: chip, color });
  if (!instant) ctx.fade(chip, 0.95, 180).catch(() => {});
  return chip;
}

// Fill a lane to capacity immediately so it never starts (or looks) empty.
function prefill(ctx, lane, colorPick) {
  for (let i = 0; i < lane.capacity; i++) addChip(ctx, lane, colorPick(), true);
}

// Absolute point at the rightmost (most recent) chip of a lane.
function tipPoint(ctx, lane) {
  const pos = ctx.getPos(lane.g);
  const last = lane.ticks[lane.ticks.length - 1];
  const lx = last ? parseFloat(last.el.getAttribute('x')) + lane.chipW / 2 : lane.pad;
  return { x: pos.x + lx, y: pos.y + lane.h / 2, chip: last ? last.el : null };
}

// ---------- fleet nodes ----------

function makeNode(ctx, x, fleetY, nodeW, nodeH, i) {
  const { COLORS } = ctx;
  const glow = ctx.el('rect', {
    x: x - nodeW / 2 - 8, y: fleetY - 8, width: nodeW + 16, height: nodeH + 16, rx: 14,
    fill: COLORS.activation, opacity: 0, filter: `url(#${GLOW_ID})`,
  });
  const g = ctx.box({ x: x - nodeW / 2, y: fleetY, w: nodeW, h: nodeH, color: COLORS.line });
  const name = `node-${i + 1}`;
  const label = ctx.el('text', {
    x: nodeW / 2, y: nodeH / 2 - 3, 'text-anchor': 'middle', class: 'mono',
    'font-size': 10.5, fill: COLORS.muted, text: name,
  }, g);
  const sub = ctx.el('text', {
    x: nodeW / 2, y: nodeH / 2 + 13, 'text-anchor': 'middle', class: 'mono',
    'font-size': 9, fill: COLORS.muted, opacity: 0, text: '',
  }, g);
  return { x, y: fleetY, box: g, rect: g._rect, glow, label, sub, name, active: false };
}

function setNodeActive(ctx, node, project) {
  const { COLORS } = ctx;
  node.active = !!project;
  // A node can be released and re-claimed within one fade; the token lets a
  // stale fade-out bail instead of wiping the new owner's label and glow.
  const token = (node.token = (node.token || 0) + 1);
  const fade = (el, to, ms) => {
    const from = parseFloat(el.getAttribute('opacity') ?? '1');
    return ctx.animate(ms, (t) => {
      if (node.token === token) el.setAttribute('opacity', from + (to - from) * t);
    }).catch(() => {});
  };
  if (project) {
    node.rect.setAttribute('stroke', COLORS.activation);
    node.rect.setAttribute('fill', '#20190c');
    node.label.setAttribute('fill', COLORS.activation);
    node.sub.textContent = project.label;
    node.sub.setAttribute('fill', COLORS.activation);
    fade(node.sub, 0.9, 200);
    fade(node.glow, 0.5, 250);
  } else {
    node.rect.setAttribute('stroke', COLORS.line);
    node.rect.setAttribute('fill', COLORS.panel);
    node.label.setAttribute('fill', COLORS.muted);
    fade(node.sub, 0, 200).then(() => { if (node.token === token) node.sub.textContent = ''; });
    fade(node.glow, 0, 300);
  }
}

// Waits for an actually-free node rather than falling back to a busy one, so
// two projects can never share (and fight over) the same fleet node.
async function pickFreeNode(ctx, nodes) {
  for (;;) {
    const free = nodes.filter((n) => !n.active);
    if (free.length) {
      // Claim before any await so concurrent deliveries can't share a node.
      const node = free[Math.floor(Math.random() * free.length)];
      node.active = true;
      return node;
    }
    await ctx.wait(150);
  }
}

// ---------- fork: a real branch off the current tip of a lane ----------

async function showFork(ctx, p) {
  if (!ctx.alive) return;
  const { COLORS } = ctx;
  const origin = tipPoint(ctx, p.panel.lane);
  if (!origin.chip) return;
  origin.chip.setAttribute('stroke', COLORS.fork);
  origin.chip.setAttribute('stroke-width', '1.5');

  const endX = origin.x + 46, endY = origin.y + 40;
  const path = ctx.el('path', {
    d: `M${origin.x},${origin.y} Q${origin.x + 8},${origin.y + 28} ${endX},${endY}`,
    fill: 'none', stroke: COLORS.fork, 'stroke-width': 1.5, opacity: 0.9,
  });
  await ctx.draw(path, 320);
  if (!ctx.alive) { path.remove(); return; }

  const forkLane = makeLane(ctx, endX, endY - 8, 74);
  const forkColors = [COLORS.fork, COLORS.thinking, COLORS.fork, COLORS.thinking];
  for (let i = 0; i < forkColors.length; i++) {
    if (!ctx.alive) break;
    addChip(ctx, forkLane, forkColors[i]);
    await ctx.wait(150);
  }
  await ctx.wait(1100);

  await Promise.all([
    ctx.fade(forkLane.g, 0, 280).catch(() => {}),
    ctx.fade(path, 0, 280).catch(() => {}),
  ]);
  forkLane.g.remove();
  path.remove();
  origin.chip.removeAttribute('stroke');
  origin.chip.removeAttribute('stroke-width');
}

// ---------- fan-out: chat -> projects -> fleet -> back to chat ----------

// Never double-books a project: only ever returns projects that are
// currently idle, even if that means fewer than `count`.
function pickProjects(projects, count) {
  const free = shuffle(projects.filter((p) => !p.busy));
  return free.slice(0, count);
}

async function runFanOut(ctx, world) {
  const { chatPanel, chatWake, say } = world;

  const count = 1 + Math.floor(Math.random() * 3);
  const chosen = pickProjects(world.projects, count);
  if (!chosen.length) return; // every project is already busy — try again next cycle
  chosen.forEach((p) => { p.busy = true; }); // claim immediately, before any await

  chatWake();
  tick(ctx, chatPanel, 'user');
  const chatCx = world.chat.x + world.chat.w / 2, chatCy = world.chat.y + world.chat.h / 2;
  await ctx.pulse(chatCx, chatCy, ctx.colorOf('user'), 26, 500);

  say(`chat agent calls send_message_to_project for ${chosen.map((p) => p.label).join(' and ')} — ACP delivers it`);

  await Promise.all(chosen.map((p) => deliverToProject(ctx, world, p)));
}

async function deliverToProject(ctx, world, p) {
  const { colorOf } = ctx;
  const { chat, nodes, say } = world;

  const trayPoint = p.panel.trayPoint;
  await viaAcp(ctx, world, p, 'down', 'SendMessage');
  if (!ctx.alive) return;

  say(`ACP appends an ExternalAgentNotification to ${p.label}'s inbox — the durable part is done`);
  setInboxCount(ctx, p.panel, p.panel.inboxCount + 1);
  await ctx.pulse(trayPoint.x, trayPoint.y, colorOf('notify'), 16, 400);

  // activation: wakes a fleet node (guaranteed free — never shared)
  let node = await pickFreeNode(ctx, nodes);
  say(`ACP publishes an activation for ${p.label} — ${node.name} picks it up and boots it`);
  await activationBolt(ctx, world, p, node);
  if (!ctx.alive) return;

  setNodeActive(ctx, node, p);
  setStatus(ctx, p.panel, 'running');
  setInboxCount(ctx, p.panel, 0);
  say(`${p.label} resumes its trajectory exactly where it left off on ${node.name}`);

  const totalTicks = 5 + Math.floor(Math.random() * 3);
  const suspendAt = Math.random() < 0.4 ? 2 + Math.floor(Math.random() * Math.max(1, totalTicks - 3)) : -1;

  for (let i = 0; i < totalTicks; i++) {
    if (!ctx.alive) return;
    tick(ctx, p.panel, BUILD_SEQ[i % BUILD_SEQ.length]);
    await ctx.wait(360 + Math.random() * 240);

    if (i === Math.floor(totalTicks / 2)) {
      say(`${p.label} posts a progress update — ACP's NotifyParents appends it to the chat agent's inbox`);
      ctx.spawn(() => sendBack(ctx, world, p, 'notify'));
    }

    if (i === suspendAt && ctx.alive) {
      setStatus(ctx, p.panel, 'suspended');
      p.panel.activity.textContent = 'suspended at iteration boundary';
      setNodeActive(ctx, node, null);
      say(`${p.label} suspends at an iteration boundary — it will resume on a fresh node`);
      await ctx.wait(700 + Math.random() * 500);
      if (!ctx.alive) return;
      node = await pickFreeNode(ctx, nodes);
      say(`ACP sends a resume activation — ${node.name} picks it up and continues ${p.label}`);
      await activationBolt(ctx, world, p, node);
      if (!ctx.alive) return;
      setNodeActive(ctx, node, p);
      setStatus(ctx, p.panel, 'running');
      // keep the activity line in lockstep with status until the next real
      // tick lands, so no box ever shows a stale mismatched combination.
      p.panel.activity.textContent = 'resuming…';
    }
  }

  if (!ctx.alive) return;
  tick(ctx, p.panel, 'agent');
  say(`${p.label} finishes: AgentDone closes the turn, one more notification carries the result upstream`);
  setNodeActive(ctx, node, null);
  setStatus(ctx, p.panel, 'asleep');
  p.panel.activity.textContent = 'idle · waiting for a task';
  await sendBack(ctx, world, p, 'agent');
  p.busy = false;
}

async function sendBack(ctx, world, p, kind) {
  if (!ctx.alive) return;
  const { chatPanel, chatWake } = world;
  const trayPoint = chatPanel.trayPoint;
  const color = ctx.colorOf('notify');
  await viaAcp(ctx, world, p, 'up', 'NotifyParents', kind === 'agent' ? ctx.COLORS.agent : color);
  if (!ctx.alive) return;
  chatWake();
  tick(ctx, chatPanel, kind === 'agent' ? 'agent' : 'notify');
  setInboxCount(ctx, chatPanel, chatPanel.inboxCount + 1);
  await ctx.pulse(trayPoint.x, trayPoint.y, color, 14, 380);
  await ctx.wait(500);
  if (ctx.alive) setInboxCount(ctx, chatPanel, Math.max(0, chatPanel.inboxCount - 1));
}

// Every message rides the wiring through the control plane: the sender calls
// ACP (SendMessage / NotifyParents) and ACP appends to the recipient's inbox.
// Agents never message each other directly.
async function viaAcp(ctx, world, p, dir, call, accent) {
  const { COLORS } = ctx;
  const { chat, acpY, gutterX, chatLinkY } = world;
  const px = p.x + p.w / 2, boxBottom = p.y + p.h, laneY = acpY - 6;
  const pts = [
    [chat.x, chatLinkY], [gutterX, chatLinkY], [gutterX, laneY], [px, laneY], [px, boxBottom],
  ];
  if (dir === 'up') pts.reverse();
  const path = ctx.el('path', {
    d: 'M' + pts.map(([x, y]) => `${x},${y}`).join(' L'),
    fill: 'none', stroke: COLORS.notify, 'stroke-width': 1.1, 'stroke-dasharray': '3 3', opacity: 0.5,
  });
  // One shared label shows the latest ACP call, so concurrent messages
  // don't stack their labels on top of each other.
  if (!world.acpLabel) {
    world.acpLabel = ctx.el('text', {
      x: gutterX - 8, y: chatLinkY + 45, 'text-anchor': 'end', class: 'mono',
      'font-size': 10, fill: COLORS.notify, opacity: 0,
    });
    world.acpInFlight = 0;
  }
  const label = world.acpLabel;
  label.textContent = `ACP · ${call}`;
  label.setAttribute('opacity', 1);
  world.acpInFlight++;
  const env = envelope(ctx, COLORS.notify, accent);
  ctx.setPos(env, pts[0][0], pts[0][1]);
  try {
    await ctx.along(env, path, 1500, ctx.ease.inOut);
    await ctx.fade(env, 0, 160);
  } finally {
    env.remove();
    path.remove();
    if (--world.acpInFlight === 0) label.setAttribute('opacity', 0);
  }
}

function envelope(ctx, color, accent) {
  const g = ctx.el('g', {});
  ctx.el('rect', { x: -9, y: -6, width: 18, height: 12, rx: 2, fill: ctx.COLORS.panel, stroke: accent || color, 'stroke-width': 1.4 }, g);
  ctx.el('path', { d: 'M-9,-6 L0,1 L9,-6', fill: 'none', stroke: accent || color, 'stroke-width': 1.4 }, g);
  return g;
}

// ACP — not the recipient — issues the activation right after the inbox
// append: it's published from the control plane, a free node picks it up,
// and only then does that node boot the agent with its trajectory.
async function activationBolt(ctx, world, p, node) {
  const { COLORS } = ctx;
  const px = p.x + p.w / 2;
  // Route along the lower edge of the bar, below the "AGENT CONTROL PLANE"
  // label, so the signal never draws over the text.
  const barY = world.acpY + 14;
  const toX = node.x, toY = node.y;

  await ctx.pulse(px, barY, COLORS.activation, 16, 380);
  const bolt = ctx.el('path', {
    d: `M${px},${barY} L${toX},${barY} L${toX},${toY}`,
    fill: 'none', stroke: COLORS.activation, 'stroke-width': 2, opacity: 0.9,
  });
  await ctx.draw(bolt, 340);
  await ctx.fade(bolt, 0, 180);
  bolt.remove();
  if (!ctx.alive) return;
  setNodeActive(ctx, node, p); // the node has picked up the activation

  // The node boots the agent: its run attaches to the agent's trajectory.
  const boot = ctx.el('path', {
    d: `M${toX},${toY} L${toX},${world.acpY - 4} L${px},${world.acpY - 4} L${px},${p.y + p.h}`,
    fill: 'none', stroke: COLORS.iter, 'stroke-width': 2, 'stroke-dasharray': '4 3', opacity: 1,
  });
  await ctx.draw(boot, 380);
  await ctx.fade(boot, 0, 200);
  boot.remove();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
