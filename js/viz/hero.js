import { CHAT_CYCLE, listOf } from '../story.js';

// #viz-hero — ambient overview of the whole system: a workspace-level chat
// agent fanning work out to project builders, which boot on fleet nodes and
// report progress back, all through inboxes + activations over the ACP.
// Every agent box carries live state (status badge, activity line, inbox
// count, a git-style trajectory lane) so the figure reads as a real system
// at a glance rather than a wireframe.

const GLOW_ID = 'hero-glow';
const ACP_H = 18; // control-plane bar height
const ENV_W = 18, ENV_H = 12; // envelope glyph size

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
  tool: 'tool_call',
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
  restartOnModeChange: true, // Auto and Step by step run entirely different scripts
  async build(ctx) {
    const { COLORS } = ctx;
    ensureGlow(ctx);

    // ---------- layout ----------
    const chat = { x: 340, y: 36, w: 220, h: 110 };
    const projectDefs = [
      { key: 'marketing', label: 'marketing-site', x: 60, y: 206, w: 210, h: 110 },
      { key: 'dashboard', label: 'dashboard', x: 345, y: 206, w: 210, h: 110 },
      { key: 'mobile', label: 'mobile-app', x: 630, y: 206, w: 210, h: 110 },
    ];
    const acpY = 366;
    const fleetY = 416;
    // centered on the 900-wide stage, like the projects and the bar
    const fleetXs = [130, 290, 450, 610, 770];
    const nodeW = 118, nodeH = 46;

    // ---------- chat panel ----------
    ctx.el('text', {
      x: chat.x + chat.w / 2, y: chat.y - 10, 'text-anchor': 'middle',
      class: 'mono', 'font-size': 10.5, fill: COLORS.muted, 'letter-spacing': '0.06em',
      text: 'CHAT AGENT · workspace',
    });
    const chatPanel = makePanel(ctx, { x: chat.x, y: chat.y, w: chat.w, h: chat.h, accent: COLORS.agent });
    chatPanel.isChat = true;
    // Chat wakes briefly (status -> running) whenever it handles an event —
    // sending a task or admitting a notification — then falls back asleep
    // shortly after, unless a newer wake supersedes the pending sleep.
    let wakeToken = 0;
    // The guided tour pins the chat agent's status so this timer can't
    // flip a held frame to "asleep".
    const chatState = { pinned: false };
    const chatWake = () => {
      setStatus(ctx, chatPanel, 'running');
      const token = ++wakeToken;
      ctx.spawn(async () => {
        await ctx.wait(1000);
        if (ctx.alive && token === wakeToken && !chatState.pinned) {
          setStatus(ctx, chatPanel, 'asleep');
          chatPanel.activity.textContent = 'idle · waiting for a message';
        }
      });
    };
    setStatus(ctx, chatPanel, 'asleep');
    chatPanel.activity.textContent = 'idle · waiting for a message';
    prefill(ctx, chatPanel.lane, () => ctx.colorOf(CHAT_SEQ[Math.floor(ctx.random() * CHAT_SEQ.length)]));

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
      prefill(ctx, panel.lane, () => ctx.colorOf(BUILD_SEQ[Math.floor(ctx.random() * BUILD_SEQ.length)]));
      return { ...p, panel, busy: false };
    });

    // ---------- ACP bar ----------
    ctx.el('rect', {
      x: 60, y: acpY, width: 780, height: ACP_H, rx: ACP_H / 2,
      fill: COLORS.panel, stroke: COLORS.line, 'stroke-width': 1,
    });
    // Live signals (trails, activations, boot lines) draw in this layer, under
    // an opaque plate behind the bar label, so nothing ever crosses the text.
    const signals = ctx.el('g', {});
    const plate = ctx.el('rect', { y: acpY + 1, height: ACP_H - 2, fill: COLORS.panel });
    const acpText = ctx.el('text', {
      x: 450, y: acpY + ACP_H / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono',
      'font-size': 10, fill: COLORS.muted, 'letter-spacing': '0.08em',
      text: 'AGENT CONTROL PLANE',
    });
    const tb = acpText.getBBox();
    plate.setAttribute('x', tb.x - 6);
    plate.setAttribute('width', tb.width + 12);

    // ---------- fleet nodes ----------
    const nodes = fleetXs.map((x, i) => makeNode(ctx, x, fleetY, nodeW, nodeH, i));

    // ---------- connectors ----------
    projects.forEach((p) => {
      ctx.arrow(p.x + p.w / 2, p.y + p.h, p.x + p.w / 2, acpY, { color: COLORS.dim, width: 1, head: false });
    });
    fleetXs.forEach((x) => {
      ctx.arrow(x, acpY + ACP_H, x, fleetY, { color: COLORS.dim, width: 1, head: false });
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
    const say = (text) => { ctx.caption(text); lastSaid = ctx.now(); };

    const world = { chat, chatPanel, chatWake, chatState, projects, nodes, acpY, gutterX, chatLinkY, signals, say };

    ctx.button('Send a task', () => ctx.spawn(() => runFanOut(ctx, world)));

    if (ctx.manual) {
      // Step by step: a single, deterministic pass through one task cycle —
      // same layout, visuals and helpers as Auto, just scripted and gated on
      // ctx.beat() instead of driven by random overlapping fan-outs.
      await guidedTour(ctx, world);
      return;
    }

    say('watching the whole system idle, waiting for work to arrive');

    let idleIdx = 0;
    ctx.spawn(async () => {
      while (ctx.alive) {
        await ctx.wait(1600);
        if (!ctx.alive) return;
        if (ctx.now() - lastSaid > 2600) {
          ctx.caption(IDLE_CAPTIONS[idleIdx % IDLE_CAPTIONS.length]);
          idleIdx++;
          lastSaid = ctx.now() - 2600;
        }
      }
    });

    // chat trajectory ticks forever (ambient thinking/tool chatter)
    ctx.spawn(async () => {
      let i = 0;
      while (ctx.alive) {
        await ctx.wait(900 + ctx.random() * 500);
        if (!ctx.alive) return;
        chatWake(); // the chat agent only appends events while it's running
        tick(ctx, chatPanel, CHAT_SEQ[i % CHAT_SEQ.length]);
        i++;
      }
    });

    // frequent forks, branching off a real tick on a random builder's lane
    ctx.spawn(async () => {
      while (ctx.alive) {
        await ctx.wait(3600 + ctx.random() * 3200);
        if (!ctx.alive) return;
        const p = projects[Math.floor(ctx.random() * projects.length)];
        say(`a background fork branches off ${p.label}'s last iteration boundary — it inherits that history without copying it`);
        await showFork(ctx, p, acpY);
      }
    });

    // ambient auto-loop: keep firing overlapping fan-outs so several things
    // are always in flight at once.
    while (ctx.alive) {
      ctx.spawn(() => runFanOut(ctx, world));
      await ctx.wait(1300 + ctx.random() * 1100);
    }
  },
};

// ---------- guided tour: one deterministic task cycle, beat by beat ----------

// Captions and beat order live in js/story.js (CHAT_CYCLE), shared verbatim
// with hero3d.js's guidedTour3d — this function only supplies the 2D visual
// action per beat id.
async function guidedTour(ctx, world) {
  const { chat, chatPanel, chatState, projects, nodes } = world;
  chatState.pinned = true;
  const p = projects.find((pr) => pr.key === 'dashboard');
  p.busy = true;
  const chatCx = chat.x + chat.w / 2, chatCy = chat.y + chat.h / 2;
  const trayPoint = chatPanel.trayPoint;

  const chatTurn = async (doing, builderKeepsGoing) => {
    setInboxCount(ctx, chatPanel, 0);
    setStatus(ctx, chatPanel, 'running');
    tick(ctx, chatPanel, 'notify'); // the admitted notification lands on its trajectory
    chatPanel.activity.textContent = 'AgentStart · admitted its inbox';
    await ctx.wait(420);
    tick(ctx, chatPanel, 'iter');
    if (builderKeepsGoing) tick(ctx, p.panel, 'tool');
    await ctx.wait(420);
    tick(ctx, chatPanel, 'content');
    await ctx.wait(420);
    tick(ctx, chatPanel, 'iter');
    if (builderKeepsGoing) tick(ctx, p.panel, 'iter');
    chatPanel.activity.textContent = doing; // what the turn is doing, shown while held
  };
  const chatIdle = () => {
    addChip(ctx, chatPanel.lane, ctx.colorOf('agent'));
    setStatus(ctx, chatPanel, 'asleep');
    chatPanel.activity.textContent = 'idle · waiting for a message';
  };

  const params = { project: p.label, node: '' };
  let node = null;
  let sendState = null, progressState = null, resultState = null;

  for (const beat of CHAT_CYCLE) {
    await ctx.beat(beat.caption(params), beat.id === 'chat-result-done' ? 1400 : undefined);
    switch (beat.id) {
      case 'user-to-inbox':
        setInboxCount(ctx, chatPanel, 1);
        await ctx.pulse(trayPoint.x, trayPoint.y, ctx.colorOf('user'), 16, 350);
        break;
      case 'user-activation':
        await ctx.pulse(trayPoint.x, trayPoint.y, ctx.COLORS.activation, 18, 300);
        // Woken: the run has started, the message is still pending in the inbox.
        setStatus(ctx, chatPanel, 'running');
        chatPanel.activity.textContent = 'AgentStart · reading its inbox';
        break;
      case 'user-admit':
        setInboxCount(ctx, chatPanel, 0);
        setStatus(ctx, chatPanel, 'running');
        tick(ctx, chatPanel, 'user');
        await ctx.pulse(chatCx, chatCy, ctx.colorOf('user'), 20, 350);
        break;
      case 'send-message':
        tick(ctx, chatPanel, 'tool');
        // Ends with the envelope resting in ACP — not yet in dashboard's inbox.
        sendState = await dropIntoAcp(ctx, world, p, 'down', 'SendMessage');
        break;
      case 'inbox-append':
        // Its turn done, the chat agent sleeps until a notification arrives.
        setStatus(ctx, chatPanel, 'asleep');
        chatPanel.activity.textContent = 'idle · waiting for a message';
        await carryFromAcp(ctx, world, sendState);
        setInboxCount(ctx, p.panel, p.panel.inboxCount + 1);
        await ctx.pulse(p.panel.trayPoint.x, p.panel.trayPoint.y, ctx.colorOf('notify'), 16, 400);
        break;
      case 'activation':
        node = await pickFreeNode(ctx, nodes);
        params.node = node.name;
        await sendActivation(ctx, world, p, node);
        break;
      case 'boot':
        await bootNode(ctx, world, p, node);
        setStatus(ctx, p.panel, 'running');
        setInboxCount(ctx, p.panel, 0);
        p.panel.activity.textContent = 'AgentStart · admitted its inbox';
        break;
      case 'iterate':
        tick(ctx, p.panel, 'iter');
        await ctx.wait(360);
        tick(ctx, p.panel, 'tool');
        await ctx.wait(360);
        tick(ctx, p.panel, 'iter');
        break;
      case 'interject':
        // Two follow-up messages arrive via ACP while dashboard keeps
        // iterating — same two-hop delivery, just piling up in the inbox
        // instead of being admitted.
        await viaAcp(ctx, world, p, 'down', 'SendMessage');
        setInboxCount(ctx, p.panel, p.panel.inboxCount + 1);
        await ctx.pulse(p.panel.trayPoint.x, p.panel.trayPoint.y, ctx.colorOf('notify'), 16, 400);
        await viaAcp(ctx, world, p, 'down', 'SendMessage');
        setInboxCount(ctx, p.panel, p.panel.inboxCount + 1);
        await ctx.pulse(p.panel.trayPoint.x, p.panel.trayPoint.y, ctx.colorOf('notify'), 16, 400);
        break;
      case 'batch-admit':
        tick(ctx, p.panel, 'iter');
        // Both pending messages land on the trajectory together, as two
        // chips at once.
        addChip(ctx, p.panel.lane, ctx.colorOf('notify'));
        addChip(ctx, p.panel.lane, ctx.colorOf('notify'));
        setInboxCount(ctx, p.panel, 0);
        break;
      case 'progress-drop':
        progressState = await dropIntoAcp(ctx, world, p, 'up', 'NotifyParents', ctx.COLORS.notify);
        break;
      case 'progress-inbox':
        await carryFromAcp(ctx, world, progressState);
        setInboxCount(ctx, chatPanel, chatPanel.inboxCount + 1);
        await ctx.pulse(trayPoint.x, trayPoint.y, ctx.colorOf('notify'), 14, 380);
        await ctx.pulse(trayPoint.x, trayPoint.y, ctx.COLORS.activation, 18, 420);
        break;
      case 'chat-progress-turn':
        await chatTurn('relaying progress to the user', true);
        break;
      case 'chat-progress-done':
        chatIdle();
        break;
      case 'result-drop':
        tick(ctx, p.panel, 'agent');
        setNodeActive(ctx, node, null);
        setStatus(ctx, p.panel, 'asleep');
        p.panel.activity.textContent = 'idle · waiting for a task';
        resultState = await dropIntoAcp(ctx, world, p, 'up', 'NotifyParents', ctx.COLORS.agent);
        break;
      case 'result-inbox':
        await carryFromAcp(ctx, world, resultState);
        setInboxCount(ctx, chatPanel, chatPanel.inboxCount + 1);
        await ctx.pulse(trayPoint.x, trayPoint.y, ctx.colorOf('notify'), 14, 380);
        await ctx.pulse(trayPoint.x, trayPoint.y, ctx.COLORS.activation, 18, 420);
        break;
      case 'chat-result-turn':
        await chatTurn('summarizing the result for the user', false);
        break;
      case 'chat-result-done':
        chatIdle();
        break;
    }
  }
  p.busy = false;
}

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

  // status row: dot, label and inbox tray share one centerline
  const rowY = y + 17;
  const statusDot = ctx.el('circle', { cx: x + 14, cy: rowY, r: 3.5, fill: COLORS.dim });
  const statusText = ctx.el('text', {
    x: x + 22, y: rowY, 'dominant-baseline': 'central', class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: 'asleep',
  });

  const trayX = x + w - 30, trayY = rowY - 8;
  const tray = trayIcon(ctx, trayX, trayY, COLORS.notify);
  const countBg = ctx.el('circle', { cx: trayX + 23, cy: trayY - 3, r: 7, fill: COLORS.notify, opacity: 0 });
  const countText = ctx.el('text', {
    x: trayX + 23, y: trayY - 3, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono', 'font-size': 9.5,
    fill: COLORS.bg, opacity: 0, text: '',
  });

  const activity = ctx.el('text', {
    x: x + 14, y: y + 40, class: 'mono', 'font-size': 10, fill: COLORS.muted, text: '· · ·',
  });

  const lane = makeLane(ctx, x + 10, y + h - 34, w - 20); // 10 in from the sides and bottom

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
  panel.activity.textContent = activityFor(panel, type);
}

// The chat agent doesn't build: its tool call hands work to a project, and
// it only ever sees a builder's AgentDone as an incoming result.
function activityFor(panel, type) {
  if (panel.isChat && type === 'tool') return 'tool_call send_message_to_project';
  if (panel.isChat && type === 'agent') return 'builder result arrived';
  return ACTIVITY[type] || type;
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
let laneSeq = 0;
function makeLane(ctx, x, y, w) {
  const chipW = 9, chipH = 16, gap = 3, pad = 8;
  const pitch = chipW + gap;
  const h = chipH + 8;
  const capacity = Math.max(4, Math.floor((w - 2 * pad + gap) / pitch));
  // center the chip run so the left and right insets match
  const inset = (w - (capacity * pitch - gap)) / 2;
  const g = ctx.el('g', {});
  ctx.setPos(g, x, y);
  ctx.el('rect', { x: 0, y: 0, width: w, height: h, rx: 5, fill: ctx.COLORS.bg, stroke: ctx.COLORS.dim, 'stroke-width': 1 }, g);
  const clipId = 'hero-lane-clip-' + ++laneSeq;
  const defs = ctx.el('clipPath', { id: clipId }, g);
  ctx.el('rect', { x: 2, y: 2, width: w - 4, height: h - 4, rx: 4 }, defs);
  const inner = ctx.el('g', { 'clip-path': `url(#${clipId})`, transform: `translate(0, ${(h - chipH) / 2})` }, g);
  return { g, inner, w, h, chipW, chipH, pad: inset, pitch, capacity, ticks: [] };
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

// Absolute point at the most recent fork-able boundary chip (IterationEnd /
// AgentDone) — the only places a new head may start.
function boundaryPoint(ctx, lane) {
  const pos = ctx.getPos(lane.g);
  const boundary = [ctx.colorOf('iter'), ctx.colorOf('agent')];
  const last = [...lane.ticks].reverse().find((t) => boundary.includes(t.color));
  if (!last) return { chip: null };
  const lx = parseFloat(last.el.getAttribute('x')) + lane.chipW / 2;
  return { x: pos.x + lx, y: pos.y + lane.h / 2, chip: last.el };
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
  // Idle: the name sits on the box's centerline. Active: it lifts to make
  // room for the project sub-label, and the pair is centered together.
  const label = ctx.el('text', {
    x: nodeW / 2, y: nodeH / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono',
    'font-size': 10.5, fill: COLORS.muted, text: name,
  }, g);
  const sub = ctx.el('text', {
    x: nodeW / 2, y: nodeH / 2 + 8, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono',
    'font-size': 9.5, fill: COLORS.muted, opacity: 0, text: '',
  }, g);
  return { x, y: fleetY, box: g, rect: g._rect, glow, label, sub, name, active: false, labelY: { idle: nodeH / 2, active: nodeH / 2 - 7 } };
}

function setNodeActive(ctx, node, project) {
  const { COLORS } = ctx;
  node.active = !!project;
  // A node can be released and re-claimed within one fade; the token lets a
  // stale fade-out bail instead of wiping the new owner's label and glow.
  const token = (node.token = (node.token || 0) + 1);
  const tween = (el, attr, to, ms) => {
    const from = parseFloat(el.getAttribute(attr) ?? '1');
    return ctx.animate(ms, (t) => {
      if (node.token === token) el.setAttribute(attr, from + (to - from) * t);
    }).catch(() => {});
  };
  const fade = (el, to, ms) => tween(el, 'opacity', to, ms);
  if (project) {
    node.rect.setAttribute('stroke', COLORS.activation);
    node.rect.setAttribute('fill', '#20190c');
    node.label.setAttribute('fill', COLORS.activation);
    node.sub.textContent = project.label;
    node.sub.setAttribute('fill', COLORS.activation);
    tween(node.label, 'y', node.labelY.active, 200);
    fade(node.sub, 0.9, 200);
    fade(node.glow, 0.5, 250);
  } else {
    node.rect.setAttribute('stroke', COLORS.line);
    node.rect.setAttribute('fill', COLORS.panel);
    node.label.setAttribute('fill', COLORS.muted);
    fade(node.sub, 0, 200).then(() => {
      if (node.token !== token) return;
      node.sub.textContent = '';
      tween(node.label, 'y', node.labelY.idle, 200);
    });
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
      const node = free[Math.floor(ctx.random() * free.length)];
      node.active = true;
      return node;
    }
    await ctx.wait(150);
  }
}

// ---------- fork: a real branch off the current tip of a lane ----------

// The fork's mini-lane sits in the band between the project box and the ACP
// bar, on whichever side of the project's ACP connector the origin chip is,
// so it never overlaps that connector or leaves the box's footprint.
async function showFork(ctx, p, acpY) {
  if (!ctx.alive) return;
  const { COLORS } = ctx;
  const lane = p.panel.lane;
  const origin = boundaryPoint(ctx, lane);
  if (!origin.chip) return;
  origin.chip.setAttribute('stroke', COLORS.fork);
  origin.chip.setAttribute('stroke-width', '1.5');

  const forkW = 74, forkH = lane.h, inset = 10, clear = 10;
  const px = p.x + p.w / 2, boxBottom = p.y + p.h;
  const forkY = boxBottom + (acpY - boxBottom - forkH) / 2;
  const [lo, hi] = origin.x >= px
    ? [px + clear, p.x + p.w - inset - forkW]
    : [p.x + inset, px - clear - forkW];
  const forkX = Math.min(hi, Math.max(lo, origin.x - forkW / 2));
  const forkLane = makeLane(ctx, forkX, forkY, forkW);
  forkLane.g.setAttribute('opacity', 0);
  // The branch leaves the origin chip's bottom edge and lands on top of the
  // mini-lane's first chip.
  const sx = origin.x, sy = origin.y + lane.chipH / 2;
  const ex = forkX + forkLane.pad + forkLane.chipW / 2, ey = forkY;
  const my = (sy + ey) / 2;
  const path = ctx.el('path', {
    d: `M${sx},${sy} C${sx},${my} ${ex},${my} ${ex},${ey}`,
    fill: 'none', stroke: COLORS.fork, 'stroke-width': 1.5, opacity: 0.9,
  });
  await ctx.draw(path, 320);
  if (!ctx.alive) { path.remove(); forkLane.g.remove(); return; }
  forkLane.g.setAttribute('opacity', 1);

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
function pickProjects(ctx, projects, count) {
  const free = shuffle(ctx, projects.filter((p) => !p.busy));
  return free.slice(0, count);
}

async function runFanOut(ctx, world) {
  const { chatPanel, chatWake, say } = world;

  const count = 1 + Math.floor(ctx.random() * 3);
  const chosen = pickProjects(ctx, world.projects, count);
  if (!chosen.length) return; // every project is already busy — try again next cycle
  chosen.forEach((p) => { p.busy = true; }); // claim immediately, before any await

  // The user's message lands in the inbox, wakes the chat agent via its own
  // activation, and is only then admitted onto the trajectory at run start —
  // same three-step opening as the guided tour, not a direct trajectory tick.
  const trayPoint = chatPanel.trayPoint;
  setInboxCount(ctx, chatPanel, chatPanel.inboxCount + 1);
  await ctx.pulse(trayPoint.x, trayPoint.y, ctx.colorOf('user'), 16, 350);
  await ctx.pulse(trayPoint.x, trayPoint.y, ctx.COLORS.activation, 18, 300);
  chatWake();
  setInboxCount(ctx, chatPanel, 0);
  tick(ctx, chatPanel, 'user');

  say(`chat agent calls send_message_to_project for ${listOf(chosen.map((p) => p.label))} — ACP delivers it`);

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

  const totalTicks = 5 + Math.floor(ctx.random() * 3);
  const suspendAt = ctx.random() < 0.4 ? 2 + Math.floor(ctx.random() * Math.max(1, totalTicks - 3)) : -1;

  for (let i = 0; i < totalTicks; i++) {
    if (!ctx.alive) return;
    tick(ctx, p.panel, BUILD_SEQ[i % BUILD_SEQ.length]);
    await ctx.wait(360 + ctx.random() * 240);

    if (i === Math.floor(totalTicks / 2)) {
      say(`${p.label} posts a progress update — NotifyParents drops it into ACP, which appends it to the chat agent's inbox`);
      ctx.spawn(() => sendBack(ctx, world, p, 'notify'));
    }

    if (i === suspendAt && ctx.alive) {
      setStatus(ctx, p.panel, 'suspended');
      p.panel.activity.textContent = 'suspended at iteration boundary';
      setNodeActive(ctx, node, null);
      say(`${p.label} suspends at an iteration boundary — it will resume on a fresh node`);
      await ctx.wait(700 + ctx.random() * 500);
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

// Every message goes through the control plane in two hops: the sender calls
// ACP (SendMessage / NotifyParents) and the envelope drops into ACP; then ACP,
// as a separate step, appends it to the recipient's inbox. Agents never
// message each other directly.
//
// Split into two steps, mirroring hero3d.js's sendToBelt/carryToBin, so a
// guided-tour beat can hold with the envelope resting in ACP before the next
// beat delivers it: dropIntoAcp ends with the envelope sitting in the bar;
// carryFromAcp finishes the delivery.

async function dropIntoAcp(ctx, world, p, dir, call, accent) {
  const { COLORS } = ctx;
  const { chat, acpY, gutterX, chatLinkY, signals } = world;
  const px = p.x + p.w / 2, boxBottom = p.y + p.h, barY = acpY + ACP_H / 2;
  // The envelope leaves from and lands against the box edge, resting just
  // outside it rather than straddling the border.
  const chatSide = [[chat.x - ENV_W / 2, chatLinkY], [gutterX, chatLinkY], [gutterX, barY]];
  const projectSide = [[px, boxBottom + ENV_H / 2], [px, barY]];
  const [inbound, outbound] = dir === 'down'
    ? [chatSide, [...projectSide].reverse()]
    : [projectSide, [...chatSide].reverse()];
  // ACP carries it along the bar from where it was dropped to the recipient's link.
  const outboundLeg = [inbound[inbound.length - 1], ...outbound];

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
  world.acpInFlight++;
  const env = envelope(ctx, COLORS.notify, accent);
  const leg = async (pts, ms) => {
    const path = ctx.el('path', {
      d: 'M' + pts.map(([x, y]) => `${x},${y}`).join(' L'),
      fill: 'none', stroke: COLORS.notify, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.5,
    }, signals);
    ctx.setPos(env, pts[0][0], pts[0][1]);
    await ctx.along(env, path, ms, ctx.ease.inOut);
    path.remove();
  };
  // Hop 1: the sender hands the message to ACP; it drops into the bar.
  await leg(inbound, 900);
  label.textContent = `ACP · ${call}`;
  label.setAttribute('opacity', 1);
  const [dx, dy] = inbound[inbound.length - 1];
  await ctx.pulse(dx, dy, COLORS.notify, 14, 320);
  return { env, outboundLeg, label, leg };
}

async function carryFromAcp(ctx, world, state, ms = 650) {
  const { env, outboundLeg, label, leg } = state;
  try {
    // Hop 2: ACP sends it on to the recipient's inbox — a separate, quicker step.
    await leg(outboundLeg, ms);
    await ctx.fade(env, 0, 160);
  } finally {
    env.remove();
    if (--world.acpInFlight === 0) label.setAttribute('opacity', 0);
  }
}

async function viaAcp(ctx, world, p, dir, call, accent) {
  const state = await dropIntoAcp(ctx, world, p, dir, call, accent);
  await carryFromAcp(ctx, world, state);
}

function envelope(ctx, color, accent) {
  const g = ctx.el('g', {});
  ctx.el('rect', { x: -ENV_W / 2, y: -ENV_H / 2, width: ENV_W, height: ENV_H, rx: 2, fill: ctx.COLORS.panel, stroke: accent || color, 'stroke-width': 1.4 }, g);
  ctx.el('path', { d: 'M-9,-6 L0,1 L9,-6', fill: 'none', stroke: accent || color, 'stroke-width': 1.4 }, g);
  return g;
}

// ACP — not the recipient — issues the activation right after the inbox
// append: it's published from the control plane, a free node picks it up,
// and only then does that node boot the agent with its trajectory.
async function activationBolt(ctx, world, p, node) {
  await sendActivation(ctx, world, p, node);
  if (!ctx.alive) return;
  await bootNode(ctx, world, p, node);
}

// A short comet — a fixed-length dash that travels once along `path` — rather
// than a classic "draw-in" that leaves the whole path lit until it fades.
// Several activations/boots can be in flight at once, all riding the same
// shared bar edges; a full-length reveal from each one overlaps the others
// and reads as one long merged line, so only a short traveling segment is
// ever actually visible at a time.
async function sweep(ctx, path, { ms = 380, dashLen = 34 } = {}) {
  const L = path.getTotalLength();
  const margin = dashLen;
  path.setAttribute('stroke-dasharray', `${dashLen} ${L + dashLen * 2}`);
  const from = dashLen + margin, to = -(L + margin);
  await ctx.animate(ms, (t) => {
    path.setAttribute('stroke-dashoffset', from + (to - from) * t);
  }, ctx.ease.linear);
}

// ACP publishes the activation from the bar's bottom edge (the side facing
// the fleet); a free node picks it up.
async function sendActivation(ctx, world, p, node) {
  const { COLORS } = ctx;
  const px = p.x + p.w / 2;
  // Ride exactly on the bar's bottom edge, so the signal never crosses the
  // "AGENT CONTROL PLANE" label.
  const barY = world.acpY + ACP_H;
  const toX = node.x, toY = node.y;

  await layerPulse(ctx, world.signals, px, barY, COLORS.activation, 16, 380);
  const bolt = ctx.el('path', {
    d: `M${px},${barY} L${toX},${barY} L${toX},${toY}`,
    fill: 'none', stroke: COLORS.activation, 'stroke-width': 2, opacity: 0.9,
  }, world.signals);
  await sweep(ctx, bolt, { ms: 340, dashLen: 34 });
  bolt.remove();
}

// The node boots the agent: its run attaches to the agent's trajectory.
async function bootNode(ctx, world, p, node) {
  const { COLORS } = ctx;
  const px = p.x + p.w / 2;
  const toX = node.x, toY = node.y;
  if (!ctx.alive) return;
  setNodeActive(ctx, node, p); // the node has picked up the activation

  const boot = ctx.el('path', {
    // Rides the bar's top edge (the side facing the agents).
    d: `M${toX},${toY} L${toX},${world.acpY} L${px},${world.acpY} L${px},${p.y + p.h}`,
    fill: 'none', stroke: COLORS.iter, 'stroke-width': 2, opacity: 1,
  }, world.signals);
  await sweep(ctx, boot, { ms: 380, dashLen: 30 });
  boot.remove();
}

// ctx.pulse, but drawn into a given layer (under the ACP label plate).
async function layerPulse(ctx, layer, x, y, color, r, ms) {
  const c = ctx.el('circle', { cx: x, cy: y, r: 2, fill: 'none', stroke: color, 'stroke-width': 2 }, layer);
  try {
    await ctx.animate(ms, (t) => {
      c.setAttribute('r', 2 + r * ctx.ease.out(t));
      c.setAttribute('opacity', 1 - t);
    }, (t) => t);
  } finally {
    c.remove();
  }
}

function shuffle(ctx, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
