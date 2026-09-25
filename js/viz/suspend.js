// #viz-suspend — "Suspend and resume: agents that survive deploys"
//
// Teaches: right after an IterationEnd, the trajectory already holds
// everything the next iteration needs. So the loop can just stop — the run
// exits SUSPENDED, no AgentDone is written, and the still-open agent block
// (AgentStart without AgentDone) is itself the signal there's work to
// continue. ACP sends a resume activation; any node picks it up, reattaches
// to the sandbox (or rebuilds it from the repo), and keeps writing to the
// same trajectory as if nothing happened.
//
// The trajectory lane is the hero of this figure: big pills, a live
// connector line running from whichever node currently owns the turn down
// to the exact pill it's about to extend, and a glowing bracket marking the
// still-open agent block. Suspend snaps the connector; resume re-attaches a
// fresh one from the new node to the very same tip.

// Seeded per run (ctx.random) so step-back replays make the same choices.
let rand = Math.random;

export default {
  width: 900,
  height: 314,
  async build(ctx) {
    rand = ctx.random;
    const { COLORS, colorOf } = ctx;

    // ---------------- static layout ----------------
    const nodeDefs = [
      { x: 20, label: 'node-1' },
      { x: 215, label: 'node-2' },
      { x: 410, label: 'node-3' },
    ];
    const headerY = 14;
    const nodeY = 22, nodeW = 175, nodeH = 72;
    const nodeBottom = nodeY + nodeH;
    const sandbox = { x: 615, y: nodeY, w: 120, h: nodeH };
    const git = { x: 760, y: nodeY, w: 120, h: nodeH };
    // Under the node row, three 10-unit lanes stack top to bottom: the
    // sandbox attachment band, the ACP spoke band, then the ACP bar itself.
    const sandboxBandY = nodeBottom + 10; // sandbox <-> owning-node attachment line
    const acpBandY = nodeBottom + 20;     // ACP <-> node activation spokes
    // The ACP bar (hero style) sits centered between node-2's and node-3's
    // centre columns, so the node->trajectory connectors drop past its ends.
    const ACP_H = 18, acpW = 170;
    const acp = { x: 400 - acpW / 2, y: nodeBottom + 30, w: acpW, h: ACP_H };
    // Trajectory: header (right-aligned, clear of every node column), then
    // the connector lane, then the pill rows. Columns match the node row.
    const trajLabelY = 172;
    const connLaneY = 182;
    const trajX0 = 20, trajRowY0 = 192, trajRowH = 46, trajMaxX = 880;
    const pillH = 32;
    const bracketGap = 7;     // bracket centre below a pill row
    const bracketW = 3;
    const rightLaneX = (trajMaxX + 900) / 2; // margin lane to reach row-2 tips

    ctx.el('text', {
      x: 20, y: headerY, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
      'letter-spacing': '0.06em', text: 'FLEET · DISPOSABLE PROCESSES',
    });
    ctx.el('text', {
      x: sandbox.x, y: headerY, class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
      'letter-spacing': '0.06em', text: 'DURABLE STATE',
    });

    const nodes = nodeDefs.map((n) => makeNode(ctx, n.x, nodeY, nodeW, nodeH, n.label));

    const sandboxBox = ctx.box({ x: sandbox.x, y: sandbox.y, w: sandbox.w, h: sandbox.h, title: null, color: COLORS.line });
    ctx.el('text', { x: sandbox.w / 2, y: TITLE_Y, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono', 'font-size': 11, fill: COLORS.text, text: 'sandbox' }, sandboxBox);
    const sandboxState = ctx.el('text', { x: sandbox.w / 2, y: sandbox.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: 'attached' }, sandboxBox);
    const sandboxAttach = ctx.el('text', { x: sandbox.w / 2, y: sandbox.h - TITLE_Y, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono', 'font-size': 10.5, fill: COLORS.text, text: '—' }, sandboxBox);

    const gitBox = ctx.box({ x: git.x, y: git.y, w: git.w, h: git.h, title: null, color: COLORS.line });
    ctx.el('text', { x: git.w / 2, y: TITLE_Y, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono', 'font-size': 11, fill: COLORS.text, text: 'git repo' }, gitBox);
    ctx.el('text', { x: git.w / 2, y: 39, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono', 'font-size': 9.5, fill: COLORS.muted, text: 'the durable' }, gitBox);
    ctx.el('text', { x: git.w / 2, y: 53, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono', 'font-size': 9.5, fill: COLORS.muted, text: 'project state' }, gitBox);

    const sgArrow = ctx.arrow(sandbox.x + sandbox.w, sandbox.y + sandbox.h / 2, git.x, git.y + git.h / 2, {
      color: COLORS.dim, width: 1, dash: '3 3',
    });

    // ---------------- ACP: the control-plane bar, wired to every node ----------------
    ctx.el('rect', {
      x: acp.x, y: acp.y, width: acp.w, height: acp.h, rx: acp.h / 2,
      fill: COLORS.panel, stroke: COLORS.line, 'stroke-width': 1,
    });
    ctx.el('text', {
      x: acp.x + acp.w / 2, y: acp.y + acp.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mono',
      'font-size': 10, fill: COLORS.muted, 'letter-spacing': '0.08em',
      text: 'AGENT CONTROL PLANE',
    });
    // permanent dim spokes from the bar's top edge (the side facing the fleet)
    // to each node's activation port, through their own band — activations travel these
    const acpSpokes = nodes.map((n) => {
      const fromX = acp.x + acp.w / 2, fromY = acp.y;
      const toX = n.portAcp, toY = nodeBottom;
      const d = `M${fromX},${fromY} L${fromX},${acpBandY} L${toX},${acpBandY} L${toX},${toY}`;
      const p = ctx.el('path', { d, fill: 'none', stroke: colorOf('activation'), 'stroke-width': 1, 'stroke-dasharray': '2 4', opacity: 0.28 });
      return p;
    });

    // ---------------- sandbox <-> current-owner connector (rewires on resume) ----------------
    let sandboxLine = null;
    // drops down the gutter between node-3 and the sandbox, then along its band
    const sandboxGutterX = (nodes[2].x + nodes[2].w + sandbox.x) / 2;
    function sandboxElbow(node) {
      const fromX = sandbox.x, fromY = sandbox.y + sandbox.h / 2;
      const toX = node.portSandbox, toY = nodeBottom;
      return `M${fromX},${fromY} L${sandboxGutterX},${fromY} L${sandboxGutterX},${sandboxBandY} L${toX},${sandboxBandY} L${toX},${toY}`;
    }
    function attachSandboxLine(node, { instant = false } = {}) {
      if (sandboxLine) sandboxLine.remove();
      sandboxLine = ctx.el('path', {
        d: sandboxElbow(node), fill: 'none', stroke: COLORS.tool, 'stroke-width': 2, opacity: 0,
      });
      if (instant) { sandboxLine.setAttribute('opacity', 0.8); return; }
      return ctx.fade(sandboxLine, 0.8, 300);
    }
    async function snapSandboxLine() {
      if (!sandboxLine) return;
      const dead = sandboxLine;
      sandboxLine = null;
      dead.setAttribute('stroke', colorOf('revert'));
      await ctx.fade(dead, 0, 260);
      dead.remove();
    }

    // ---------------- trajectory lane: the hero ----------------
    ctx.el('text', {
      x: trajMaxX, y: trajLabelY, 'text-anchor': 'end', class: 'mono', 'font-size': 10.5, fill: COLORS.muted,
      'letter-spacing': '0.06em', text: 'TRAJECTORY · append-only',
    });

    const bracketPath = ctx.el('path', { d: '', fill: 'none', stroke: colorOf('agent'), 'stroke-width': bracketW, 'stroke-linecap': 'round', opacity: 0 });

    let curX = trajX0, curY = trajRowY0;
    let bracketSegs = [];
    let bracketOpen = false;
    let lastPill = null; // { x, y, w } — the tip a node connector attaches to

    function redrawBracket() {
      const r = bracketW / 2; // round caps would overshoot the pill edges by r
      bracketPath.setAttribute('d', bracketSegs.map((s) => `M${s.x1 + r},${s.y} L${s.x2 - r},${s.y}`).join(' '));
    }
    function extendBracket(x, y, w) {
      const seg = bracketSegs[bracketSegs.length - 1];
      if (!seg || seg.y !== y) bracketSegs.push({ y, x1: x, x2: x + w });
      else seg.x2 = x + w;
      redrawBracket();
    }
    function openBracketAt() {
      bracketSegs = [];
      bracketOpen = true;
      bracketPath.setAttribute('stroke', colorOf('agent'));
      bracketPath.setAttribute('opacity', 0.9);
      ctx.spawn(async () => {
        while (ctx.alive && bracketOpen) {
          await ctx.animate(900, (t) => {
            if (!bracketOpen) return;
            bracketPath.setAttribute('opacity', 0.45 + 0.5 * Math.sin(t * Math.PI));
          }, ctx.ease.linear);
        }
      });
    }
    function closeBracket() {
      bracketOpen = false;
      if (ctx.alive) bracketPath.setAttribute('opacity', 0.85);
    }

    // node <-> trajectory-tip connector: shows *who* is physically appending
    let ownerNode = null;
    let nodeConn = null;
    // Orthogonal route: straight down from the node's bottom centre to the
    // lane above the pills, then onto the tip's top centre. A tip on a
    // wrapped row is reached around the right margin and enters its right
    // edge, so the line never crosses the row above.
    function nodeConnPath() {
      const nx = ownerNode.x + ownerNode.w / 2;
      const head = `M${nx},${nodeBottom} L${nx},${connLaneY}`;
      if (lastPill.y === trajRowY0) {
        const tx = lastPill.x + lastPill.w / 2;
        return `${head} L${tx},${connLaneY} L${tx},${lastPill.y}`;
      }
      const my = lastPill.y + pillH / 2;
      return `${head} L${rightLaneX},${connLaneY} L${rightLaneX},${my} L${lastPill.x + lastPill.w},${my}`;
    }
    function updateNodeConn() {
      if (!ownerNode || !nodeConn || !lastPill) return;
      nodeConn.setAttribute('d', nodeConnPath());
    }
    function attachNodeConn(node) {
      ownerNode = node;
      if (nodeConn) nodeConn.remove();
      nodeConn = ctx.el('path', { d: '', fill: 'none', stroke: colorOf('iter'), 'stroke-width': 2, 'stroke-linejoin': 'round', opacity: 0 });
      updateNodeConn();
      return ctx.fade(nodeConn, 0.8, 250);
    }
    async function snapNodeConn() {
      ownerNode = null;
      if (!nodeConn) return;
      const dead = nodeConn;
      nodeConn = null;
      dead.setAttribute('stroke', colorOf('revert'));
      await ctx.fade(dead, 0, 220);
      dead.remove();
    }

    // legend + counter: pinned just under the trajectory's current last row,
    // so it hugs the pills instead of leaving a gap under a short trajectory
    const legendDot = ctx.el('circle', { cx: trajX0 + 4, r: 4, fill: colorOf('agent') });
    const legendText = ctx.el('text', {
      x: trajX0 + 16, 'dominant-baseline': 'central', class: 'mono', 'font-size': 11, fill: COLORS.muted,
      text: 'open agent block = work to continue',
    });
    const lostCounter = ctx.el('text', {
      x: trajMaxX, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'mono', 'font-size': 11, fill: colorOf('tool'),
      text: 'events lost: 0',
    });
    // one shared centre line for dot, legend and counter
    function placeLegend(row) {
      const y = trajRowY0 + row * trajRowH + pillH + bracketGap + 16;
      legendDot.setAttribute('cy', y);
      legendText.setAttribute('y', y);
      lostCounter.setAttribute('y', y);
    }
    placeLegend(0);
    ctx.spawn(async () => {
      while (ctx.alive) {
        await ctx.animate(900, (t) => legendDot.setAttribute('opacity', bracketOpen ? 0.4 + 0.6 * Math.sin(t * Math.PI) : 0.9));
      }
    });

    function addPill(label, type, opts = {}) {
      const w = Math.max(72, label.length * 7.2 + 26);
      if (curX + w > trajMaxX) {
        curX = trajX0; curY += trajRowH;
        placeLegend(Math.round((curY - trajRowY0) / trajRowH));
      }
      const p = ctx.eventPill({ x: curX, y: curY, name: label, type, label, w, h: pillH, ...opts });
      const txt = p.querySelector('text');
      txt.setAttribute('font-size', 12.5);
      txt.setAttribute('y', pillH / 2);
      txt.setAttribute('dominant-baseline', 'central');
      // the block opens WITH AgentStart, so the bracket starts under it
      if (type === 'agent' && label === 'AgentStart') openBracketAt();
      extendBracket(curX, curY + pillH + bracketGap, w);
      lastPill = { x: curX, y: curY, w };
      curX += w + 10;
      updateNodeConn();
      return p;
    }

    // ---------------- node-2: a short, independent turn ----------------
    ctx.spawn(async () => {
      const n2 = nodes[1];
      await ctx.wait(700);
      if (!ctx.alive) return;
      setNodeStatus(n2, 'running', COLORS.iter);
      showChip(ctx, n2, 'run · turn 7');
      await ctx.wait(3200);
      if (!ctx.alive) return;
      hideChip(ctx, n2);
      setNodeStatus(n2, '✓ AgentDone', colorOf('agent'), COLORS.line);
      await ctx.wait(1600);
      if (!ctx.alive) return;
      setNodeStatus(n2, 'idle', COLORS.muted, COLORS.line);
    });

    // ---------------- deploy / sandbox-kill controls ----------------
    let deployRequested = false, deployConsumed = false;
    let killRequested = false;

    function announceDraining() {
      ctx.spawn(async () => {
        for (const n of nodes) {
          if (n.status === 'running') setNodeStatus(n, 'draining · in-flight run', colorOf('revert'));
          else if (n.status !== 'suspended' && n.status !== 'resuming') setNodeStatus(n, 'draining', colorOf('revert'));
        }
        await ctx.wait(1);
      });
    }
    ctx.button('Deploy v42', () => {
      if (deployConsumed || deployRequested) return;
      deployRequested = true;
      announceDraining();
    }, { title: 'Suspends the running turn at its NEXT boundary' });

    ctx.button('Kill sandbox', () => {
      if (killRequested) return;
      killRequested = true;
      ctx.spawn(async () => {
        sandboxState.setAttribute('fill', colorOf('revert'));
        sandboxState.textContent = 'kill queued';
        await ctx.pulse(sandbox.x + sandbox.w / 2, sandbox.y + sandbox.h / 2, colorOf('revert'), 20, 500);
      });
    }, { title: 'Fails the in-flight tool call on its next use' });

    ctx.spawn(async () => {
      await ctx.wait(4200);
      if (ctx.alive && !deployRequested && !deployConsumed) { deployRequested = true; announceDraining(); }
    });
    ctx.spawn(async () => {
      await ctx.wait(11500);
      if (ctx.alive && !killRequested) {
        killRequested = true;
        sandboxState.setAttribute('fill', colorOf('revert'));
        sandboxState.textContent = 'kill queued';
      }
    });

    // ---------------- main narrative ----------------
    let version = 'v41';
    let iterCount = 41; // cosmetic "turn N" counter for the chip label
    let current = nodes[0];
    setNodeStatus(current, 'running', COLORS.iter);
    showChip(ctx, current, `run · turn ${iterCount}`);
    sandboxAttach.textContent = current.label;
    attachSandboxLine(current, { instant: true });

    await ctx.beat(
      `<strong>${current.label}</strong> starts a long turn. Each <span class="t t-agent">AgentStart</span> / ` +
      `<span class="t t-agent">AgentDone</span> brackets a turn; every <span class="t t-iter">IterationStart</span> / ` +
      `<span class="t t-iter">IterationEnd</span> pair brackets one model call. Meanwhile <strong>node-2</strong> runs a short, unrelated turn.`
    );
    addPill('AgentStart', 'agent');
    await attachNodeConn(current);

    async function runIteration(i, opts = {}) {
      addPill('IterationStart', 'iter');
      await ctx.beat(
        i === 0
          ? `<span class="t t-iter">IterationStart</span> is written, the prompt is rebuilt from the trajectory, and ${current.label} calls a tool. Watch the line from ${current.label} down to the trajectory tip — that's the process physically appending.`
          : `${current.label} keeps going — <span class="t t-iter">IterationStart</span>, tool call, same trajectory.`,
        i === 0 ? 1300 : 700
      );

      await ctx.pulse(current.x + current.w / 2, current.y + current.h / 2, colorOf('tool'), 16, 400);
      let toolFails = killRequested && !opts._killConsumedFlag.done;
      if (toolFails) opts._killConsumedFlag.done = true;

      if (toolFails) {
        addPill('tool_call ✕', 'revert');
        await ctx.pulse(sandbox.x + sandbox.w / 2, sandbox.y + sandbox.h / 2, colorOf('revert'), 22, 500);
        sandboxState.setAttribute('fill', colorOf('revert'));
        sandboxState.textContent = 'DIED';
        await ctx.fade(sgArrow, 0.15, 200);
        await snapSandboxLine();
        await ctx.beat('The sandbox dies mid tool call. The failing <span class="t t-tool">ToolExecutionEnd</span> ends the iteration right here.');
      } else {
        addPill('tool_call', 'tool');
        await ctx.wait(400);
      }

      addPill('IterationEnd', 'iter');
      await ctx.beat(
        `<span class="t t-iter">IterationEnd</span> lands. The trajectory now holds everything the next iteration needs — ` +
        `the loop could simply stop here.`
      );

      let reason = null;
      if (toolFails) reason = 'sandbox';
      else if (deployRequested && !deployConsumed) { reason = 'deploy'; deployConsumed = true; }

      if (reason) {
        current = await suspendResume(reason);
      } else {
        iterCount++;
      }
    }

    const killFlag = { done: false };
    for (let i = 0; i < 3; i++) {
      await runIteration(i, { _killConsumedFlag: killFlag });
    }

    addPill('AgentDone', 'agent');
    closeBracket();
    await snapNodeConn();
    hideChip(ctx, current);
    setNodeStatus(current, 'idle', COLORS.muted, COLORS.line);
    const lc = lostCounter.getBBox();
    await ctx.pulse(lc.x + lc.width / 2, lc.y + lc.height / 2, colorOf('tool'), 16, 500);
    await ctx.beat(
      `<span class="t t-agent">AgentDone</span> closes the block. Whatever happened along the way — a deploy, a dead sandbox — ` +
      `every event made it onto one continuous trajectory. <strong>events lost: 0</strong>.`,
      1400
    );

    // -------- suspend/resume sequence, reused for both trigger reasons ----
    async function suspendResume(reason) {
      const oldNode = current; // the node whose run is about to be disposed
      await ctx.fade(oldNode._chip, 0, 300);
      oldNode._chip?.remove();
      oldNode._chip = null;
      setNodeStatus(oldNode, 'suspended', colorOf('revert'));
      await Promise.all([snapNodeConn(), snapSandboxLine()]);
      await ctx.beat(
        `Run exits <strong>SUSPENDED</strong> — no <span class="t t-agent">AgentDone</span> is written. The still-open agent ` +
        `block is itself the signal there's work to continue. Notice both connectors just snapped.`
      );

      if (reason === 'deploy') {
        // oldNode stays frozen at its old version — it's disposable and about
        // to be discarded. Every OTHER node is what actually rolls to v42.
        const upgrading = nodes.filter((n) => n !== oldNode);
        upgrading.forEach((n) => setNodeStatus(n, 'draining', colorOf('revert')));
        await ctx.wait(300);
        await Promise.all(upgrading.map((n) => ctx.fade(n.box, 0.15, 260)));
        const oldVersion = version;
        version = version === 'v41' ? 'v42' : 'v41';
        upgrading.forEach((n) => { n.verTxt.textContent = version; });
        await Promise.all(upgrading.map((n) => ctx.fade(n.box, 1, 260)));
        upgrading.forEach((n) => setNodeStatus(n, 'idle', COLORS.muted, COLORS.line));
        await ctx.beat(
          `Fresh <strong>${version}</strong> nodes roll in. ${oldNode.label} stays frozen at ${oldVersion} — suspended, ` +
          `waiting to be picked up — while in-flight turns elsewhere simply finish.`
        );
      } else {
        await ctx.beat('The sandbox is gone. Sandboxes run separately from the fleet — the box was never the durable part.');
        sandboxAttach.textContent = '—';
        sandboxState.textContent = 'rebuilding…';
        await ctx.pulse(git.x + git.w / 2, git.y + git.h / 2, colorOf('compact'), 18, 450);
        await ctx.fade(sgArrow, 0.85, 200);
        await ctx.beat('A resumed agent rebuilds its sandbox from the repo. The project\'s durable state is the repo, not the box.');
      }

      await ctx.beat('ACP sends a fresh activation with a <em>resume</em> reason — any node can pick it up, check the inbox, and run the next iteration.');
      const candidates = nodes.filter((n) => n !== oldNode);
      const target = candidates[Math.floor(rand() * candidates.length)];
      // oldNode's run is gone the moment someone else picks up the resume —
      // it goes back to plain idle (and, if this was a deploy, is already
      // caught up to the current version so it doesn't show a stale label).
      setNodeStatus(oldNode, 'idle', COLORS.muted, COLORS.line);
      oldNode.verTxt.textContent = version;
      const spoke = acpSpokes[nodes.indexOf(target)];
      await activationBolt(ctx, spoke, target, acp, nodeBottom);
      setNodeStatus(target, 'resuming', colorOf('activation'));
      showChip(ctx, target, `run · turn ${iterCount}`);
      sandboxAttach.textContent = target.label;
      sandboxState.setAttribute('fill', COLORS.muted);
      sandboxState.textContent = 'attached';
      await Promise.all([attachSandboxLine(target), attachNodeConn(target)]);
      await ctx.beat(
        `${target.label} reattaches to the sandbox and its connector locks onto the <em>same</em> trajectory tip — same run, right where it left off.`
      );
      setNodeStatus(target, 'running', COLORS.iter);
      iterCount++;
      return target;
    }
  },
};

// ---------------- helpers ----------------

// Three text rows inside every 72-high box: title, middle, status.
const TITLE_Y = 16;

// Bottom-edge ports: ACP spoke at w/4, trajectory connector at w/2,
// sandbox line at 3w/4 — so no two wires ever share a segment.
function makeNode(ctx, x, y, w, h, label) {
  const { COLORS } = ctx;
  const box = ctx.box({ x, y, w, h, title: null, color: COLORS.line });
  const pad = 12;
  ctx.el('text', { x: pad, y: TITLE_Y, 'dominant-baseline': 'central', class: 'mono', 'font-size': 11, fill: COLORS.text, text: label }, box);
  const verTxt = ctx.el('text', { x: w - pad, y: TITLE_Y, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'mono', 'font-size': 10.5, fill: COLORS.muted, text: 'v41' }, box);
  const statusTxt = ctx.el('text', { x: pad, y: h - TITLE_Y, 'dominant-baseline': 'central', class: 'mono', 'font-size': 10, fill: COLORS.muted, text: 'idle' }, box);
  return {
    x, y, w, h, box, verTxt, statusTxt, label, status: 'idle', _chip: null,
    portAcp: x + w / 4, portSandbox: x + (3 * w) / 4,
  };
}

function setNodeStatus(node, text, color, lineColor) {
  node.status = text;
  node.statusTxt.textContent = text;
  node.statusTxt.setAttribute('fill', color);
  node.box._rect.setAttribute('stroke', text === 'idle' ? lineColor : color);
}

// A glowing "run" chip inside the node, with a turn-number label.
function showChip(ctx, node, label) {
  if (node._chip) { node._chipLabel.textContent = label; return; }
  // middle row, left-aligned with the title and status (never overlaps a long status)
  const g = ctx.el('g', { opacity: 0 }, node.box);
  ctx.setPos(g, 12, node.h / 2);
  const dot = ctx.el('circle', { cx: 5, cy: 0, r: 5, fill: ctx.colorOf('iter') }, g);
  const lbl = ctx.el('text', { x: 16, y: 0, 'dominant-baseline': 'central', class: 'mono', 'font-size': 10, fill: ctx.colorOf('iter'), text: label }, g);
  node._chip = g;
  node._chipLabel = lbl;
  ctx.fade(g, 1, 250);
  ctx.spawn(async () => {
    while (ctx.alive && node._chip === g) {
      await ctx.animate(700, (t) => {
        if (node._chip !== g) return;
        dot.setAttribute('r', 4 + 1 * Math.sin(t * Math.PI));
      });
    }
  });
}
function hideChip(ctx, node) {
  if (!node._chip) return;
  const chip = node._chip;
  node._chip = null;
  ctx.fade(chip, 0, 250).then(() => chip.remove());
}

// Same activation style as the hero: a pulse where it leaves the bar, then a
// solid 2-unit bolt drawn along the spoke's exact route to the node's port.
async function activationBolt(ctx, spokePath, target, acp, nodeBottom) {
  const color = ctx.colorOf('activation');
  await ctx.pulse(acp.x + acp.w / 2, acp.y, color, 16, 380);
  const bolt = ctx.el('path', {
    d: spokePath.getAttribute('d'), fill: 'none', stroke: color, 'stroke-width': 2, opacity: 0.9,
  });
  await ctx.draw(bolt, 420);
  await ctx.pulse(target.portAcp, nodeBottom, color, 18, 450);
  await ctx.fade(bolt, 0, 180);
  bolt.remove();
}
