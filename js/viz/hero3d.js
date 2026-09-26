// #viz-hero3d — the same overview as #viz-hero (chat agent -> ACP -> project
// builders -> fleet nodes -> back through ACP), rendered as a 3D "conveyor":
// the Agent Control Plane is a belt running down the middle, messages are
// cyan parcels that drop onto it and ride to their recipient, activations are
// a pulse along a rail to a fleet node, and booting a builder is a beam from
// the node to its station. Built alongside the 2D hero, not instead of it.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';

// ---------- world layout (all in "world units", independent of pixels) ----------
const BELT_LEN = 320, BELT_W = 46;
// The chat station is a source at the belt's upstream (left) end, not a
// station behind it — that's the only way to give it a corridor no fleet
// node can ever end up sitting in. Its chute/return lane meet the belt just
// inside the left roller.
const CHAT_X = -(BELT_LEN / 2 + 66);
const BELT_ENTRY_X = -BELT_LEN / 2 + 10;
const NODE_Z = -70;
const BUILD_Z = 80;
const BUILD_DEFS = [
  { key: 'marketing', label: 'marketing-site', x: -108 },
  { key: 'dashboard', label: 'dashboard', x: 0 },
  { key: 'mobile', label: 'mobile-app', x: 108 },
];
// The fleet row sits alone along the back side, evenly spaced within the
// belt's own span — nothing else is ever positioned behind the belt now that
// chat lives off the end, so there's no corridor to protect.
const NODE_XS = [-120, -60, 0, 60, 120];

// ---------- camera: orthographic isometric with a user-drivable orbit ----------
const FRUSTUM_H = 172;
const CAM_DIST = 430;
// Chat now lives off the belt's left end, so the scene's bounding box is
// wider and shifted left/less-deep than before — recentered accordingly.
const CAM_TARGET = new THREE.Vector3(-56, 12, 12);
const EL_MIN = THREE.MathUtils.degToRad(15);
const EL_MAX = THREE.MathUtils.degToRad(70);
const ZOOM_MIN = 0.55, ZOOM_MAX = 1.85;
// Matches the previous fixed look (1, 1.02, 1.18) expressed as azimuth/elevation.
const DEFAULT_AZ = Math.atan2(1, 1.18);
const DEFAULT_EL = Math.asin(1.02 / Math.sqrt(1 + 1.02 * 1.02 + 1.18 * 1.18));
const defaultOrbit = () => ({ az: DEFAULT_AZ, el: DEFAULT_EL, scale: 1 });

const BUILD_SEQ = ['iter', 'thinking', 'tool', 'content', 'iter', 'tool', 'compact'];
const IDLE_CAPTIONS = [
  'watching the belt for new activity',
  'every message drops onto the belt before ACP delivers it — sender and recipient never talk directly',
  'a free fleet node can pick up any activation and boot a builder with its trajectory',
  'a builder only admits its inbox at run start and at iteration boundaries — a mid-run message waits',
  'progress and results ride back the same way: through ACP, into the chat agent’s inbox',
];

// 'a', 'a and b', 'a, b and c'
const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export default {
  width: 900,
  height: 480,
  loop: false,
  restartOnModeChange: true,
  async build(ctx) {
    const stage = ctx.svg.parentElement;
    stage.style.position = 'relative';

    if (!webglAvailable()) {
      ctx.caption("This browser can't render WebGL, so the 3D conveyor view isn't available here — the 2D overview above shows the same system.");
      return;
    }

    let renderer;
    try {
      renderer = getRenderer(stage, ctx);
    } catch {
      ctx.caption("This browser can't render WebGL, so the 3D conveyor view isn't available here — the 2D overview above shows the same system.");
      return;
    }

    stage._overlay.innerHTML = '';
    if (stage._scene) disposeScene(stage._scene);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(ctx.COLORS.bg);
    stage._scene = scene;

    const camera = makeCamera();
    stage._camera = camera;
    if (!stage._orbit) stage._orbit = defaultOrbit();
    applyOrbitToCamera(camera, stage._orbit, stage.clientWidth || 900, stage.clientHeight || 480);
    setupResize(stage);

    addLights(scene, ctx);

    const world = buildWorld(ctx, scene, stage._overlay);

    startRenderLoop(ctx, stage, world);

    ctx.button('Send a task', () => ctx.spawn(() => runFanOut3d(ctx, scene, world)));

    if (ctx.manual) {
      await guidedTour3d(ctx, scene, world);
      return;
    }

    world.say(ctx, 'watching the whole system idle, waiting for work to arrive');
    ctx.spawn(async () => {
      let i = 0;
      while (ctx.alive) {
        await ctx.wait(1700);
        if (!ctx.alive) return;
        if (ctx.now() - world.lastSaid > 2600) {
          ctx.caption(IDLE_CAPTIONS[i % IDLE_CAPTIONS.length]);
          i++;
          world.lastSaid = ctx.now() - 2600;
        }
      }
    });

    while (ctx.alive) {
      ctx.spawn(() => runFanOut3d(ctx, scene, world));
      await ctx.wait(1300 + ctx.random() * 1100);
    }
  },
};

// ---------- WebGL / renderer plumbing ----------

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

function getRenderer(stage, ctx) {
  if (stage._renderer) return stage._renderer;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  stage.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(ctx.COLORS.bg, 1);
  stage._renderer = renderer;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
  stage.appendChild(overlay);
  stage._overlay = overlay;

  attachOrbitControls(stage, canvas);
  return renderer;
}

// A small hand-rolled orbit control (no three/addons — those import a bare
// 'three' specifier our import map doesn't provide). Camera state lives on
// the stage, outside the virtual clock, so Back/rebuild never resets it.
function attachOrbitControls(stage, canvas) {
  if (!stage._orbit) stage._orbit = defaultOrbit();
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';

  const hint = document.createElement('div');
  hint.textContent = 'drag to rotate · double-click to reset';
  hint.style.cssText = `position:absolute;right:9px;bottom:7px;
    font:500 9.5px/1.2 'JetBrains Mono',monospace;letter-spacing:.02em;
    color:#8b8b98;opacity:.5;pointer-events:none;`;
  stage.appendChild(hint);

  const clampEl = (v) => Math.min(EL_MAX, Math.max(EL_MIN, v));
  const clampZoom = (v) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));

  const pointers = new Map();
  let dragging = false, lastX = 0, lastY = 0, pinchStart = null;

  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    } else {
      pinchStart = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart == null) pinchStart = dist;
      else {
        stage._orbit.scale = clampZoom(stage._orbit.scale * (pinchStart / dist));
        pinchStart = dist;
      }
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    stage._orbit.az -= dx * 0.006;
    stage._orbit.el = clampEl(stage._orbit.el + dy * 0.005);
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) { dragging = false; canvas.style.cursor = 'grab'; }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);

  // Passive:false + preventDefault only here, so page scroll away from the
  // canvas is completely unaffected.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    stage._orbit.scale = clampZoom(stage._orbit.scale * (1 + e.deltaY * 0.0012));
  }, { passive: false });

  canvas.addEventListener('dblclick', () => { Object.assign(stage._orbit, defaultOrbit()); });
}

function applyOrbitToCamera(camera, orbit, w, h) {
  const x = CAM_DIST * Math.cos(orbit.el) * Math.sin(orbit.az);
  const y = CAM_DIST * Math.sin(orbit.el);
  const z = CAM_DIST * Math.cos(orbit.el) * Math.cos(orbit.az);
  camera.position.set(CAM_TARGET.x + x, CAM_TARGET.y + y, CAM_TARGET.z + z);
  camera.lookAt(CAM_TARGET);
  const aspect = w / h;
  const eff = FRUSTUM_H * orbit.scale;
  camera.left = -eff * aspect;
  camera.right = eff * aspect;
  camera.top = eff;
  camera.bottom = -eff;
  camera.updateProjectionMatrix();
}

function setupResize(stage) {
  stage._resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    stage._renderer.setSize(w, h, false);
  };
  if (!stage._ro) {
    stage._ro = new ResizeObserver(() => stage._resize && stage._resize());
    stage._ro.observe(stage);
  }
  stage._resize();
}

function makeCamera() {
  return new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
}

function disposeScene(scene) {
  scene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

function isInViewport(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
}

function addLights(scene, ctx) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.58));
  const dir = new THREE.DirectionalLight(0xfff2e0, 1.0);
  dir.position.set(190, 260, 150);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -260; dir.shadow.camera.right = 260;
  dir.shadow.camera.top = 260; dir.shadow.camera.bottom = -260;
  dir.shadow.camera.near = 10; dir.shadow.camera.far = 700;
  dir.shadow.bias = -0.0015;
  dir.shadow.radius = 3;
  scene.add(dir);
  // Rim light: roughly opposite the camera, so silhouette edges catch a
  // cool highlight and read against the dark background.
  const rim = new THREE.DirectionalLight(0x7fa8ff, 0.4);
  rim.position.set(-200, 110, -230);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x6a7dff, 0.16);
  fill.position.set(-160, 90, 160);
  scene.add(fill);

  scene.add(makeFloor(ctx));
}

// A large, softly-fading grid rather than a hard-edged plane: at this camera
// angle a finite floor's silhouette cuts a visible diamond out of the frame,
// leaving dark triangles in the corners. Fading the texture to transparent
// well inside the plane's true (huge) extent means the edge is never seen.
function makeFloor(ctx) {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  const step = size / 16;
  for (let i = 0; i <= 16; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke();
  }
  // Radial alpha falloff, applied as a mask so the grid (and the plane) fade
  // to nothing well before its edge.
  g.globalCompositeOperation = 'destination-in';
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2600, 2600),
    new THREE.MeshStandardMaterial({ color: ctx.COLORS.panel, map: tex, transparent: true, roughness: 1, metalness: 0 }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -6;
  plane.receiveShadow = true;
  return plane;
}

// ---------- geometry helpers ----------

function makeBox(w, h, d, color, roughness = 0.7, metalness = 0.15) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive: 0x000000, emissiveIntensity: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 }),
  );
  mesh.add(edges);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Darken/desaturate a role color for a station's body, so the body still
// reads as that role's color family without being as loud as the full accent
// (which is reserved for trim, the status light, and emissive glow).
function bodyTint(hex, factor = 0.42) {
  return new THREE.Color(hex).multiplyScalar(factor);
}

// A small "machine module": a role-colored box with colored corner posts and
// trim (a cheap stand-in for a beveled/paneled housing, since true
// rounded-box geometry needs a three/addons import our import map can't
// resolve), plus a status light on top. The body itself stays color-coded by
// role (purple/blue/slate) so the scene reads at a glance like the 2D
// figure; asleep/running is layered on top via emissive brightness.
function makeStation(w, h, d, bodyColor, accent) {
  const g = new THREE.Group();
  const box = makeBox(w, h, d, bodyColor, 0.55, 0.25);
  box.material.emissive = new THREE.Color(0x000000);
  const edges = box.children[0];
  edges.material.color = new THREE.Color(accent);
  edges.material.opacity = 0.6;
  g.add(box);

  const postSize = 2.6;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(postSize, h * 0.94, postSize),
        new THREE.MeshStandardMaterial({ color: '#3a3a44', roughness: 0.6, metalness: 0.25 }),
      );
      post.position.set(sx * (w / 2), 0, sz * (d / 2));
      post.castShadow = true;
      g.add(post);
    }
  }

  const light = new THREE.Mesh(
    new THREE.CylinderGeometry(w * 0.13, w * 0.13, 3, 16),
    new THREE.MeshStandardMaterial({ color: '#20202a', emissive: 0x000000, emissiveIntensity: 0, roughness: 0.4, metalness: 0.3 }),
  );
  light.position.set(0, h / 2 + 2, 0);
  light.castShadow = true;
  g.add(light);

  return { group: g, box, light };
}

function makeRamp(from, to, width, color) {
  const len = from.distanceTo(to);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const geo = new THREE.BoxGeometry(width, 3.5, Math.max(len, 1));
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(mid);
  mesh.lookAt(to);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function makeRoller(x, color) {
  const roller = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 7, BELT_W - 4, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 }),
  );
  roller.rotation.x = Math.PI / 2;
  roller.position.set(x, 1.5, 0);
  roller.castShadow = true;
  roller.receiveShadow = true;
  return roller;
}

// Parcels are cyan (ExternalAgentNotification). A result parcel carrying an
// AgentDone gets an added purple band rather than changing its base color.
function makeParcel(color, w = 9, h = 6, d = 9, band = null) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1, emissive: color, emissiveIntensity: 0.35 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  if (band) {
    const bandMat = new THREE.MeshStandardMaterial({ color: band, roughness: 0.4, metalness: 0.15, emissive: band, emissiveIntensity: 0.55 });
    const bandMesh = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, h * 0.4, d + 1.4), bandMat);
    mesh.add(bandMesh);
  }
  return mesh;
}

function stripeTexture(a, b) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 64, 16);
  g.fillStyle = b;
  for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 8, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 1);
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

// ---------- overlay labels ----------
// Each on-screen label is one stacked block (name + status [+ inbox count])
// so name/status text never drifts apart or double-projects, and a single
// overlap-avoidance pass nudges whole blocks apart when their rects collide.

// A "badge" background: the role color mixed lightly over the panel color,
// with a thin border in the same role color, so each label reads as
// color-coded at a glance rather than a uniform dark pill. `color-mix` is a
// live CSS function — updating `el.dataset.role` and reapplying it is how a
// badge's tint changes later (e.g. a node badge turning yellow when it
// starts running).
function applyBadge(el, roleColor, panelColor) {
  el.style.background = `color-mix(in srgb, ${roleColor} 22%, ${panelColor})`;
  el.style.borderColor = `color-mix(in srgb, ${roleColor} 45%, transparent)`;
}

function makeLabel(overlay, text, opts = {}) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:absolute;left:0;top:0;transform:translate(-50%,-100%);
    font:500 10px/1.3 'JetBrains Mono',monospace;letter-spacing:.04em;color:${opts.color || '#8b8b98'};
    white-space:nowrap;pointer-events:none;opacity:${opts.opacity ?? 1};
    background:rgba(11,11,13,.6);border:1px solid transparent;padding:1px 6px;border-radius:4px;
    transition:opacity .15s,color .15s,background .2s,border-color .2s;`;
  if (opts.role) applyBadge(el, opts.role, opts.panel || '#131317');
  overlay.appendChild(el);
  return el;
}

function makeStackLabel(overlay, lines, role, panel) {
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;left:0;top:0;transform:translate(-50%,-100%);
    font:500 10px/1.35 'JetBrains Mono',monospace;letter-spacing:.04em;
    white-space:nowrap;pointer-events:none;text-align:center;
    background:rgba(11,11,13,.64);border:1px solid transparent;padding:2px 7px;border-radius:4px;
    transition:opacity .15s,background .2s,border-color .2s;`;
  if (role) applyBadge(el, role, panel || '#131317');
  const rows = lines.map((l) => {
    const row = document.createElement('div');
    row.textContent = l.text || '';
    row.style.color = l.color || '#8b8b98';
    row.style.opacity = String(l.opacity ?? 1);
    el.appendChild(row);
    return row;
  });
  overlay.appendChild(el);
  return { el, rows };
}

function project(camera, w, h, vec3) {
  const v = vec3.clone().project(camera);
  return { x: (v.x * 0.5 + 0.5) * w, y: (1 - (v.y * 0.5 + 0.5)) * h };
}

// Greedy top-to-bottom pass: if a label's projected rect would overlap an
// already-placed one (by real measured size, via offsetWidth/Height), nudge
// it further up (away from its own anchor point) until clear.
function layoutLabels(camera, w, h, items) {
  const boxes = [];
  for (const it of items) {
    if (!it.el || parseFloat(it.el.style.opacity || '1') <= 0.02) continue;
    const p = project(camera, w, h, it.point);
    boxes.push({ el: it.el, x: p.x, y: p.y, w: it.el.offsetWidth || 50, h: it.el.offsetHeight || 14 });
  }
  boxes.sort((a, b) => a.y - b.y);
  const placed = [];
  for (const b of boxes) {
    let shift = 0;
    for (const o of placed) {
      if (b.x + b.w / 2 < o.x - o.w / 2 || b.x - b.w / 2 > o.x + o.w / 2) continue;
      const bTop = b.y - b.h - shift, bBottom = b.y - shift;
      const oTop = o.y - o.h, oBottom = o.y;
      if (bBottom < oTop || bTop > oBottom) continue;
      shift = Math.max(shift, bBottom - oTop + 3);
    }
    const finalY = b.y - shift;
    b.el.style.left = b.x + 'px';
    b.el.style.top = finalY + 'px';
    placed.push({ x: b.x, y: finalY, w: b.w, h: b.h });
  }
}

function updateOverlay(camera, w, h, world) {
  const acpCallPoint = world.acpCallFollow
    ? world.acpCallFollow.position.clone().add(new THREE.Vector3(0, 22, 0))
    : world.acpCallAnchor;
  layoutLabels(camera, w, h, [
    { point: world.acpAnchor, el: world.acpDomLabel },
    { point: acpCallPoint, el: world.acpCallLabel },
    { point: world.chat.anchor, el: world.chat.nameLabel.el },
    ...world.builders.map((b) => ({ point: b.anchor, el: b.nameLabel.el })),
    ...world.nodes.map((n) => ({ point: n.anchor, el: n.nameLabel.el })),
  ]);
}

// ---------- scene construction ----------

function buildBelt(ctx, scene) {
  const { COLORS } = ctx;
  const group = new THREE.Group();
  const base = makeBox(BELT_LEN, 10, BELT_W, COLORS.panel, 0.7, 0.1);
  base.position.y = -5;
  group.add(base);

  const tex = stripeTexture('#17171d', '#26262f');
  const tread = new THREE.Mesh(
    new THREE.PlaneGeometry(BELT_LEN - 6, BELT_W - 6),
    new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.9, metalness: 0.05 }),
  );
  tread.rotation.x = -Math.PI / 2;
  tread.position.y = 0.15;
  tread.receiveShadow = true;
  group.add(tread);

  for (const side of [-1, 1]) {
    const rail = makeBox(BELT_LEN, 4, 2.4, COLORS.line, 0.6, 0.2);
    rail.position.set(0, 1, side * (BELT_W / 2 - 1));
    group.add(rail);
  }
  for (const x of [-BELT_LEN / 2, BELT_LEN / 2]) {
    group.add(makeRoller(x, COLORS.line));
  }

  scene.add(group);
  return { group, tex };
}

function buildChat(ctx, scene, overlay) {
  const { COLORS } = ctx;
  const w = 50, h = 30, d = 36;
  const { group, box, light } = makeStation(w, h, d, bodyTint(COLORS.agent), COLORS.agent);
  group.position.set(CHAT_X, h / 2, 0);
  scene.add(group);

  // A source at the head of the conveyor: two lanes side by side along the
  // belt's own axis — an outgoing chute onto the belt, and a separate return
  // lane so results visibly arrive a different way than they left, both
  // meeting the belt just inside its left roller.
  const frontX = CHAT_X + w / 2;
  const sendPoint = new THREE.Vector3(frontX, h * 0.5, -13);
  const returnPoint = new THREE.Vector3(frontX, h * 0.5, 13);
  scene.add(makeRamp(sendPoint, new THREE.Vector3(BELT_ENTRY_X, 0.5, -13), 13, COLORS.dim));
  scene.add(makeRamp(new THREE.Vector3(BELT_ENTRY_X, 0.5, 13), returnPoint, 13, COLORS.dim));

  // A small inbox tray on the return side, so progress/result notifications
  // visibly land somewhere before they're admitted — same idea as a
  // builder's bin.
  const binPoint = new THREE.Vector3(frontX + 9, 8, 13);
  const bin = makeBox(15, 11, 13, COLORS.notify, 0.5, 0.1);
  bin.position.copy(binPoint);
  bin.position.y = 5.5;
  scene.add(bin);

  // A short trajectory lane of its own, behind the station (away from the
  // belt) — the chat agent gets its own short "turn" per notification (wake,
  // admit, iterate, AgentDone) just like a builder, so it needs somewhere to
  // show that trajectory.
  const trackLen = 40;
  const trackX = CHAT_X - w / 2 - 12 - trackLen / 2;
  const track = makeBox(trackLen, 3, 11, COLORS.dim, 0.85, 0.05);
  track.position.set(trackX, 1.5, 0);
  scene.add(track);

  const label = makeStackLabel(overlay, [
    { text: 'CHAT AGENT · WORKSPACE', opacity: 0.85 },
    { text: 'asleep' },
    { text: '', opacity: 0 },
  ], COLORS.agent, COLORS.panel);

  return {
    box, light, mat: box.material,
    x: CHAT_X, sendPoint, returnPoint, binPoint,
    inboxPile: [], chips: [],
    trackFrontX: trackX - trackLen / 2 + 6, trackY: 4.5, trackZ: 0,
    anchor: new THREE.Vector3(CHAT_X, h + 34, 0),
    nameLabel: label,
    status: 'asleep', inboxCount: 0,
  };
}

function buildBuilder(ctx, scene, overlay, def) {
  const { COLORS } = ctx;
  const w = 46, h = 27, d = 34;
  const { group, box, light } = makeStation(w, h, d, bodyTint(COLORS.iter), COLORS.iter);
  group.position.set(def.x, h / 2, BUILD_Z);
  scene.add(group);

  const binPoint = new THREE.Vector3(def.x, 8, BUILD_Z - d / 2 - 12);
  const bin = makeBox(15, 11, 13, COLORS.notify, 0.5, 0.1);
  bin.position.copy(binPoint);
  bin.position.y = 5.5;
  scene.add(bin);

  // A short feeder belt: parcels visibly leave the main belt and drop into
  // this builder's inbox bin, rather than teleporting there.
  scene.add(makeRamp(
    new THREE.Vector3(def.x, 1, BELT_W / 2),
    new THREE.Vector3(def.x, 4.5, binPoint.z + 6),
    10, COLORS.dim,
  ));

  const trackLen = 48;
  const trackZ = BUILD_Z + d / 2 + 12;
  const track = makeBox(trackLen, 3, 11, COLORS.dim, 0.85, 0.05);
  track.position.set(def.x, 1.5, trackZ);
  scene.add(track);

  const label = makeStackLabel(overlay, [
    { text: def.label.toUpperCase(), opacity: 0.85 },
    { text: 'asleep' },
    { text: '', opacity: 0 },
  ], COLORS.iter, COLORS.panel);

  return {
    key: def.key, label: def.label, x: def.x, box, light, mat: box.material,
    chips: [], inboxPile: [], busy: false,
    anchor: new THREE.Vector3(def.x, h + 24, BUILD_Z),
    binPoint,
    trackFrontX: def.x - trackLen / 2 + 6,
    trackY: 4.5, trackZ,
    nameLabel: label,
    status: 'asleep', inboxCount: 0,
  };
}

function buildNode(ctx, scene, overlay, i, x) {
  const { COLORS } = ctx;
  const w = 22, h = 16, d = 18;
  // Neutral steel body (not tied to the activation-yellow accent), so idle
  // nodes read as distinct hardware rather than another colored block.
  const { group, box, light } = makeStation(w, h, d, '#3a4250', COLORS.line);
  group.position.set(x, h / 2, NODE_Z);
  scene.add(group);

  const railFrom = new THREE.Vector3(x, 0.6, NODE_Z);
  const railTo = new THREE.Vector3(x, 0.6, -BELT_W / 2);
  scene.add(makeRamp(railFrom, railTo, 5, COLORS.dim));

  const name = `node-${i + 1}`;
  const label = makeStackLabel(overlay, [
    { text: name, opacity: 0.85 },
    { text: '', opacity: 0 },
  ], COLORS.line, COLORS.panel);

  return {
    name, x, box, light, mat: box.material, active: false,
    anchor: new THREE.Vector3(x, h + 16, NODE_Z),
    railPoint: railTo.clone().setY(h / 2),
    nameLabel: label,
  };
}

function buildWorld(ctx, scene, overlay) {
  const belt = buildBelt(ctx, scene);
  const chat = buildChat(ctx, scene, overlay);
  const builders = BUILD_DEFS.map((d) => buildBuilder(ctx, scene, overlay, d));
  const nodes = NODE_XS.map((x, i) => buildNode(ctx, scene, overlay, i, x));

  const acpDomLabel = makeLabel(overlay, 'AGENT CONTROL PLANE', { opacity: 0.8 });
  acpDomLabel.style.fontSize = '9px';
  acpDomLabel.style.letterSpacing = '.09em';
  const acpCallLabel = makeLabel(overlay, '', { color: ctx.COLORS.notify, opacity: 0, role: ctx.COLORS.notify, panel: ctx.COLORS.panel });

  return {
    belt, chat, builders, nodes,
    acpAnchor: new THREE.Vector3(BELT_LEN / 2 - 24, 7, 14),
    acpCallAnchor: new THREE.Vector3(0, 30, 0),
    acpDomLabel, acpCallLabel, acpInFlight: 0, acpCallFollow: null,
    lastSaid: 0,
    say(ctx2, text) { ctx2.caption(text); this.lastSaid = ctx2.now(); },
  };
}

// ---------- render loop ----------

function startRenderLoop(ctx, stage, world) {
  const frame = () => {
    if (!ctx.alive) return;
    // Purely decorative: the belt hums along on real (wall-clock) time, not
    // the virtual clock, so it visibly signals "the system is alive" even
    // while paused or held in step mode. Parcels — actual simulation state —
    // still move only on ctx.now(), so determinism/Back are unaffected.
    world.belt.tex.offset.x = (performance.now() * 0.00004) % 1;
    const renderer = stage._renderer, camera = stage._camera, scene = stage._scene;
    if (renderer && camera && scene) {
      const rect = stage.getBoundingClientRect();
      if (rect.width && rect.height) {
        // Orbit state is a view setting, not scene state: recomputed every
        // frame so drag/zoom/reset work even while paused or held.
        applyOrbitToCamera(camera, stage._orbit, rect.width, rect.height);
        if (isInViewport(ctx.svg)) {
          updateOverlay(camera, rect.width, rect.height, world);
          renderer.render(scene, camera);
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------- small tween/animation helpers ----------

function tweenTo(ctx, from, to, ms, onUpdate) {
  return ctx.animate(ms, (t) => onUpdate(from + (to - from) * t)).catch(() => {});
}

async function travelPath(ctx, obj, points, ms, easing) {
  const legs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dist = points[i].distanceTo(points[i + 1]);
    legs.push(dist);
    total += dist;
  }
  obj.position.copy(points[0]);
  for (let i = 0; i < legs.length; i++) {
    if (!ctx.alive) return;
    const from = points[i], to = points[i + 1];
    const legMs = total > 0 ? Math.max(60, Math.round(ms * (legs[i] / total))) : Math.round(ms / legs.length);
    await ctx.animate(legMs, (t) => obj.position.lerpVectors(from, to, t), easing || ctx.ease.inOut);
  }
}

async function pulse3d(ctx, scene, center, color, r, ms) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.5, 24), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(center);
  scene.add(ring);
  try {
    await ctx.animate(ms, (t) => {
      const k = ctx.ease.out(t);
      const scale = 1 + (r / 0.5) * k;
      ring.scale.set(scale, scale, scale);
      mat.opacity = 0.9 * (1 - t);
    });
  } finally {
    scene.remove(ring);
    mat.dispose();
    ring.geometry.dispose();
  }
}

// ---------- status setters (status light on top, not a whole-cube tint) ----------

function litColor(ctx, status, runningColor) {
  return status === 'running' ? runningColor : status === 'suspended' ? ctx.COLORS.activation : 0x000000;
}

// Drives both the top light and the body's own emissive glow, so asleep vs.
// running reads as "dimmer body" vs. "brighter, lit body" on top of each
// role's base color — not just a light bulb floating over a flat block.
function setStationGlow(ctx, station, status, accentColor) {
  const litIntensity = status === 'running' ? 1 : status === 'suspended' ? 0.6 : 0.08;
  const bodyIntensity = status === 'running' ? 0.6 : status === 'suspended' ? 0.32 : 0.04;
  const color = litColor(ctx, status, accentColor);
  station.light.material.emissive = new THREE.Color(color);
  tweenTo(ctx, station.light.material.emissiveIntensity, litIntensity, 260, (v) => { station.light.material.emissiveIntensity = v; });
  station.box.material.emissive = new THREE.Color(status === 'asleep' ? 0x000000 : accentColor);
  tweenTo(ctx, station.box.material.emissiveIntensity, bodyIntensity, 260, (v) => { station.box.material.emissiveIntensity = v; });
}

function setChatStatus(ctx, chat, status) {
  chat.status = status;
  setStationGlow(ctx, chat, status, ctx.COLORS.agent);
  chat.nameLabel.rows[1].textContent = status === 'running' ? 'running' : 'asleep · waiting for a message';
  chat.nameLabel.rows[1].style.color = status === 'running' ? ctx.COLORS.agent : '#8b8b98';
}

function setBuilderStatus(ctx, builder, status) {
  builder.status = status;
  setStationGlow(ctx, builder, status, ctx.COLORS.iter);
  builder.nameLabel.rows[1].textContent = status;
  builder.nameLabel.rows[1].style.color = status === 'running' ? ctx.COLORS.iter : status === 'suspended' ? ctx.COLORS.activation : '#8b8b98';
}

function updateInboxLabel(builder) {
  const row = builder.nameLabel.rows[2];
  const n = builder.inboxPile.length;
  row.textContent = n ? `inbox · ${n}` : '';
  row.style.color = '#22d3ee';
  row.style.opacity = n ? '1' : '0';
}

function setNodeActive(ctx, node, builder) {
  node.active = !!builder;
  setStationGlow(ctx, node, builder ? 'running' : 'asleep', ctx.COLORS.activation);
  node.nameLabel.rows[1].textContent = builder ? `· ${builder.label}` : '';
  node.nameLabel.rows[1].style.color = builder ? ctx.COLORS.activation : '#8b8b98';
  node.nameLabel.rows[1].style.opacity = builder ? '1' : '0';
  // Slate badge while idle, warm yellow tint while a node is actually running.
  applyBadge(node.nameLabel.el, builder ? ctx.COLORS.activation : ctx.COLORS.line, ctx.COLORS.panel);
}

function showAcpLabel(world, text, followObj) {
  world.acpInFlight++;
  world.acpCallLabel.textContent = text;
  world.acpCallLabel.style.opacity = '1';
  world.acpCallFollow = followObj || null;
}
function hideAcpLabel(world) {
  world.acpInFlight = Math.max(0, world.acpInFlight - 1);
  if (world.acpInFlight === 0) {
    world.acpCallLabel.style.opacity = '0';
    world.acpCallFollow = null;
  }
}

// ---------- inbox: pending pile + batch admission at boundaries ----------
// "Whenever the agent runs, it looks at the inbox and copies whatever hasn't
// been handled yet onto its own trajectory. This happens at the start of a
// run and again at every iteration boundary" — so arrivals only ever pile up
// in the bin; admission is a separate, explicit, batched step.

function pileOffset(i) {
  return { x: i % 2 ? 5 : -5, y: Math.floor(i / 2) * 6 };
}

function queueInboxMessage(ctx, scene, builder, kind = 'notify') {
  const { x, y } = pileOffset(builder.inboxPile.length);
  const item = makeParcel(ctx.COLORS.notify, 7, 5, 7, kind === 'agent' ? ctx.COLORS.agent : null);
  item.material.transparent = true;
  item.material.opacity = 0;
  item.userData.kind = kind;
  item.position.set(builder.binPoint.x + x, 5.5 + 3 + y, builder.binPoint.z);
  scene.add(item);
  ctx.animate(160, (t) => { item.material.opacity = 0.95 * t; }).catch(() => {});
  builder.inboxPile.push(item);
  updateInboxLabel(builder);
}

// Moves everything pending onto the trajectory track at once (batched, not
// staggered), and clears the pile/count together as one visible beat.
async function admitPending(ctx, scene, builder) {
  const pile = builder.inboxPile;
  if (!pile.length) return;
  const kinds = pile.map((it) => it.userData.kind || 'notify');
  builder.inboxPile = [];
  updateInboxLabel(builder);
  const target = new THREE.Vector3(builder.trackFrontX, builder.trackY, builder.trackZ);
  await Promise.all(pile.map((item) => {
    const from = item.position.clone();
    return ctx.animate(260, (t) => {
      item.position.lerpVectors(from, target, t);
      item.material.opacity = 0.95 * (1 - t);
    });
  }));
  for (const item of pile) scene.remove(item);
  for (const kind of kinds) tickBuilder(ctx, scene, builder, kind);
}

// The chat agent has its own short trajectory lane (see buildChat), so it
// reuses the same generic admitPending() a builder uses — admitting a
// notification lands it there as an event chip, same batching helper, just
// for a pile that's never allowed to grow past one (see chatWakeAndRun).

// ---------- message hops: sender -> ACP (drop) -> recipient, two separate hops ----------
// Split into two steps so a guided-tour beat can hold exactly between them:
// sendToBelt ends with the parcel resting on the belt (SendMessage/"drops
// there"); carryToBin finishes the delivery into the recipient's bin.

async function sendToBelt(ctx, scene, world, fromAnchor) {
  showAcpLabel(world, 'ACP · SendMessage');
  const parcel = makeParcel(ctx.COLORS.notify);
  world.acpCallFollow = parcel;
  scene.add(parcel);
  const entry = new THREE.Vector3(BELT_ENTRY_X, 6, fromAnchor.z);
  await travelPath(ctx, parcel, [fromAnchor, entry], 480);
  if (ctx.alive) await pulse3d(ctx, scene, entry, ctx.COLORS.notify, 9, 260);
  return parcel; // left resting on the belt; ACP label stays lit until carryToBin
}

async function carryToBin(ctx, scene, world, parcel, builder, kind = 'notify') {
  try {
    if (!ctx.alive) return;
    const onBelt = new THREE.Vector3(BELT_ENTRY_X, 6, 0);
    const carry = new THREE.Vector3(builder.x, 6, 0);
    await travelPath(ctx, parcel, [parcel.position.clone(), onBelt, carry, builder.binPoint], 680);
    if (!ctx.alive) return;
    queueInboxMessage(ctx, scene, builder, kind);
    await pulse3d(ctx, scene, builder.binPoint, ctx.COLORS.notify, 9, 300);
  } finally {
    scene.remove(parcel);
    hideAcpLabel(world);
  }
}

async function hopToBuilder(ctx, scene, world, fromAnchor, builder, kind = 'notify') {
  const parcel = await sendToBelt(ctx, scene, world, fromAnchor);
  await carryToBin(ctx, scene, world, parcel, builder, kind);
}

// Arrival just lands the notification in the chat agent's own inbox — the
// caller is responsible for an explicit, visible chatWakeAndRun() afterwards,
// so a notification never vanishes from the badge before its own beat says
// it's been admitted.
//
// Split into two steps, mirroring the downward sendToBelt/carryToBin split,
// so a guided-tour beat can hold with the envelope resting in ACP before the
// next beat delivers it: sendToBeltFromBuilder ends with the parcel resting
// on the belt at the builder's position; carryToChat finishes the delivery
// into the chat agent's inbox.

async function sendToBeltFromBuilder(ctx, scene, world, builder, kind) {
  showAcpLabel(world, 'ACP · NotifyParents');
  const color = ctx.COLORS.notify;
  const parcel = makeParcel(color, 9, 6, 9, kind === 'agent' ? ctx.COLORS.agent : null);
  world.acpCallFollow = parcel;
  scene.add(parcel);
  const drop = new THREE.Vector3(builder.x, 6, 0);
  await travelPath(ctx, parcel, [builder.binPoint, drop], 480);
  if (ctx.alive) await pulse3d(ctx, scene, drop, color, 9, 260);
  return parcel; // left resting on the belt; ACP label stays lit until carryToChat
}

async function carryToChat(ctx, scene, world, parcel, kind) {
  try {
    if (!ctx.alive) return;
    // ACP carries it back down the belt to its upstream end, then out the
    // return lane — a different route than the way it came in.
    const onBelt = new THREE.Vector3(BELT_ENTRY_X, 6, 0);
    const exit = new THREE.Vector3(BELT_ENTRY_X, 6, 13);
    await travelPath(ctx, parcel, [parcel.position.clone(), onBelt, exit, world.chat.returnPoint], 680);
    if (!ctx.alive) return;
    // Arrival is quiet: it just lands in the bin. Waking up to admit and run
    // on it is its own separate, explicit step (chatWakeAndRun) — the chat
    // agent gets its own short turn per notification, just like a builder.
    queueInboxMessage(ctx, scene, world.chat, kind);
    await pulse3d(ctx, scene, world.chat.returnPoint, kind === 'agent' ? ctx.COLORS.agent : ctx.COLORS.notify, 9, 300);
  } finally {
    scene.remove(parcel);
    hideAcpLabel(world);
  }
}

async function hopToChat(ctx, scene, world, builder, kind) {
  const parcel = await sendToBeltFromBuilder(ctx, scene, world, builder, kind);
  await carryToChat(ctx, scene, world, parcel, kind);
}

// ---------- the chat agent's own short turn per notification ----------
// A notification arriving doesn't wake the chat agent by itself (see
// carryToChat) — waking, admitting at run start, and iterating is its own
// explicit run, exactly like a builder's: one turn per notification, never
// batched. `alsoTickBuilder` lets a beat show a builder still iterating
// independently while chat handles its own update.

async function chatWakeAndRun(ctx, scene, world, alsoTickBuilder) {
  const chat = world.chat;
  setChatStatus(ctx, chat, 'running');
  await admitPending(ctx, scene, chat);
  if (alsoTickBuilder) tickBuilder(ctx, scene, alsoTickBuilder, 'tool');
  tickBuilder(ctx, scene, chat, 'iter');
  await ctx.wait(300);
  tickBuilder(ctx, scene, chat, 'content');
  await ctx.wait(300);
  tickBuilder(ctx, scene, chat, 'iter');
}

async function chatFinishTurn(ctx, scene, world) {
  tickBuilder(ctx, scene, world.chat, 'agent');
  setChatStatus(ctx, world.chat, 'asleep');
}

// ---------- activation + boot ----------

async function activationToNode(ctx, scene, builder, node) {
  const belt3 = new THREE.Vector3(builder.x, 3, -BELT_W / 2 + 1);
  await pulse3d(ctx, scene, belt3, ctx.COLORS.activation, 8, 300);
  if (!ctx.alive) return;
  const dot = makeParcel(ctx.COLORS.activation, 6, 5, 6);
  scene.add(dot);
  try {
    const nodeTop = node.anchor.clone();
    nodeTop.y = node.box.parent.position.y;
    await travelPath(ctx, dot, [belt3, node.railPoint, nodeTop], 400);
  } finally {
    scene.remove(dot);
  }
}

async function bootBeam3d(ctx, scene, node, builder) {
  const from = node.anchor.clone();
  from.y = node.box.parent.position.y;
  // Direct offsets rather than getWorldPosition(): matrixWorld is only
  // refreshed by the render loop, so it can be stale on the very first frame.
  const to = builder.box.parent.position.clone();
  to.y += builder.light.position.y;
  const pivot = new THREE.Object3D();
  pivot.position.copy(from);
  pivot.lookAt(to);
  const dist = Math.max(from.distanceTo(to), 1);
  const mat = new THREE.MeshStandardMaterial({
    color: ctx.COLORS.iter, emissive: ctx.COLORS.iter, emissiveIntensity: 0.9,
    transparent: true, opacity: 0.95,
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.5, dist), mat);
  beam.position.set(0, 0, dist / 2);
  pivot.add(beam);
  scene.add(pivot);
  beam.scale.z = 0.001;
  try {
    await ctx.animate(320, (t) => { beam.scale.z = Math.max(t, 0.001); });
    if (!ctx.alive) return;
    await ctx.wait(90);
    await ctx.animate(240, (t) => { mat.opacity = 0.95 * (1 - t); });
  } finally {
    scene.remove(pivot);
    mat.dispose();
    beam.geometry.dispose();
  }
}

// ---------- builder trajectory ticks (output track = trimmed queue) ----------

function tickBuilder(ctx, scene, builder, type) {
  const color = ctx.colorOf(type);
  const capacity = 5, pitch = 9;
  if (builder.chips.length >= capacity) {
    const old = builder.chips.pop();
    ctx.animate(150, (t) => { old.material.opacity = 0.95 * (1 - t); })
      .then(() => scene.remove(old)).catch(() => {});
  }
  builder.chips.forEach((c, i) => {
    const fromX = c.position.x;
    const targetX = builder.trackFrontX + (i + 1) * pitch;
    ctx.animate(220, (t) => { c.position.x = fromX + (targetX - fromX) * t; }).catch(() => {});
  });
  const chip = makeParcel(color, 7, 5, 7);
  chip.material.transparent = true;
  chip.material.opacity = 0;
  chip.position.set(builder.trackFrontX, builder.trackY, builder.trackZ);
  scene.add(chip);
  ctx.animate(180, (t) => { chip.material.opacity = 0.95 * t; }).catch(() => {});
  builder.chips.unshift(chip);
}

// ---------- fleet allocation ----------

async function pickFreeNode(ctx, nodes) {
  for (;;) {
    const free = nodes.filter((n) => !n.active);
    if (free.length) {
      const node = free[Math.floor(ctx.random() * free.length)];
      node.active = true;
      return node;
    }
    await ctx.wait(150);
  }
}

function pickIdleBuilders(ctx, builders, count) {
  const free = shuffle(ctx, builders.filter((b) => !b.busy));
  return free.slice(0, count);
}

function shuffle(ctx, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- guided tour: one deterministic task cycle, beat by beat ----------
// 16 beats. Beats 1, 3-6, 8 keep hero.js's guidedTour captions verbatim.
// Beats 7-8 dramatize the article's batching rule ("this happens at the
// start of a run and again at every iteration boundary"). Every downward
// (SendMessage) and upward (NotifyParents) delivery is its own two-beat
// hop — one beat ends with the envelope resting on the belt in ACP, the
// next ends with it admitted into the recipient's inbox — so a held frame
// never shows a later beat's state early. The chat agent never batches: a
// notification just sits in its inbox until a dedicated pair of beats has
// it wake, admit at run start, iterate, and AgentDone — its own short turn,
// same shape as a builder's, once for the progress update and once for the
// final result.

async function guidedTour3d(ctx, scene, world) {
  const p = world.builders.find((b) => b.key === 'dashboard');
  p.busy = true;
  const chat = world.chat;

  await ctx.beat('the user sends a message; it reaches the chat agent');
  setChatStatus(ctx, chat, 'running');
  await pulse3d(ctx, scene, chat.anchor, ctx.colorOf('user'), 14, 500);

  await ctx.beat("the chat agent calls send_message_to_project for dashboard — the envelope travels to the Agent Control Plane bar and drops there: that's SendMessage");
  // Ends with the envelope resting on the belt — not yet in dashboard's inbox.
  const dashboardEnvelope = await sendToBelt(ctx, scene, world, chat.sendPoint);

  await ctx.beat("ACP appends an ExternalAgentNotification to dashboard's inbox — the inbox badge goes to 1: the durable step");
  // Its turn done, the chat agent sleeps until a notification arrives.
  setChatStatus(ctx, chat, 'asleep');
  await carryToBin(ctx, scene, world, dashboardEnvelope, p, 'notify');

  await ctx.beat("ACP publishes an activation — the yellow signal leaves the bar's bottom edge for a fleet node");
  const node = await pickFreeNode(ctx, world.nodes);
  await activationToNode(ctx, scene, p, node);

  await ctx.beat(`${node.name} picks it up and lights up; it boots dashboard with its trajectory — the builder goes to running`);
  setNodeActive(ctx, node, p);
  await bootBeam3d(ctx, scene, node, p);
  setBuilderStatus(ctx, p, 'running');
  await admitPending(ctx, scene, p); // run start: whatever was pending is admitted

  await ctx.beat('the builder iterates: IterationStart, tool_call, IterationEnd');
  tickBuilder(ctx, scene, p, 'iter');
  await ctx.wait(360);
  tickBuilder(ctx, scene, p, 'tool');
  await ctx.wait(360);
  tickBuilder(ctx, scene, p, 'iter');
  await admitPending(ctx, scene, p); // no-op here — nothing arrived yet

  await ctx.beat('while dashboard is mid-iteration, two more messages arrive via ACP — they wait in its inbox (inbox · 2)');
  await hopToBuilder(ctx, scene, world, chat.sendPoint, p);
  await hopToBuilder(ctx, scene, world, chat.sendPoint, p);

  await ctx.beat("IterationEnd — at the boundary, dashboard admits everything pending at once: both land on its trajectory together; inbox · 0");
  tickBuilder(ctx, scene, p, 'iter');
  await admitPending(ctx, scene, p);

  await ctx.beat('the builder posts a progress update — NotifyParents drops an ExternalAgentNotification into ACP');
  // Ends with the progress envelope resting on the belt — not yet in chat's inbox.
  const progressEnvelope = await sendToBeltFromBuilder(ctx, scene, world, p, 'notify');

  await ctx.beat('ACP appends it to the chat agent’s inbox and sends an activation (inbox · 1)');
  // Ends with the notification sitting in chat's bin — chat is still asleep.
  await carryToChat(ctx, scene, world, progressEnvelope, 'notify');

  await ctx.beat('the chat agent wakes: at run start it admits the update onto its trajectory (inbox · 0) and iterates on it — relaying the progress to the user');
  // The builder keeps iterating meanwhile, so it's clear the two run independently.
  await chatWakeAndRun(ctx, scene, world, p);

  await ctx.beat('its turn ends — AgentDone, and the chat agent goes idle again');
  await chatFinishTurn(ctx, scene, world);

  await ctx.beat('the builder finishes: AgentDone — the node goes dim, the builder goes to asleep, and NotifyParents drops the result into ACP');
  tickBuilder(ctx, scene, p, 'agent');
  setNodeActive(ctx, node, null);
  setBuilderStatus(ctx, p, 'asleep');
  // Ends with the result envelope resting on the belt — chat's inbox still 0.
  const resultEnvelope = await sendToBeltFromBuilder(ctx, scene, world, p, 'agent');

  await ctx.beat('ACP appends the result to the chat agent’s inbox and sends an activation (inbox · 1)');
  await carryToChat(ctx, scene, world, resultEnvelope, 'agent');

  await ctx.beat('the chat agent wakes, admits the result at run start (inbox · 0), and iterates — summarizing the result for the user');
  await chatWakeAndRun(ctx, scene, world);

  await ctx.beat('AgentDone — the chat agent goes idle; the cycle is complete', 1400);
  await chatFinishTurn(ctx, scene, world);
  p.busy = false;
}

// ---------- ambient: overlapping random fan-outs ----------

async function runFanOut3d(ctx, scene, world) {
  const count = 1 + Math.floor(ctx.random() * 3);
  const chosen = pickIdleBuilders(ctx, world.builders, count);
  if (!chosen.length) return;
  chosen.forEach((b) => { b.busy = true; });

  setChatStatus(ctx, world.chat, 'running');
  await pulse3d(ctx, scene, world.chat.anchor, ctx.colorOf('user'), 14, 450);
  world.say(ctx, `chat agent calls send_message_to_project for ${listOf(chosen.map((b) => b.label))} — ACP delivers it`);

  await Promise.all(chosen.map((b) => deliverToBuilder3d(ctx, scene, world, b)));

  if (ctx.alive && !world.builders.some((b) => b.busy)) setChatStatus(ctx, world.chat, 'asleep');
}

async function deliverToBuilder3d(ctx, scene, world, b) {
  await hopToBuilder(ctx, scene, world, world.chat.sendPoint, b);
  if (!ctx.alive) return;
  world.say(ctx, `ACP appends an ExternalAgentNotification to ${b.label}'s inbox — inbox · ${b.inboxPile.length}`);

  const node = await pickFreeNode(ctx, world.nodes);
  world.say(ctx, `ACP publishes an activation for ${b.label} — ${node.name} picks it up and boots it`);
  await activationToNode(ctx, scene, b, node);
  if (!ctx.alive) return;
  setNodeActive(ctx, node, b);
  await bootBeam3d(ctx, scene, node, b);
  setBuilderStatus(ctx, b, 'running');
  await admitPending(ctx, scene, b);
  world.say(ctx, `${b.label} resumes its trajectory on ${node.name}, admitting whatever was pending`);

  const totalTicks = 5 + Math.floor(ctx.random() * 3);
  for (let i = 0; i < totalTicks; i++) {
    if (!ctx.alive) return;
    const type = BUILD_SEQ[i % BUILD_SEQ.length];
    tickBuilder(ctx, scene, b, type);
    await ctx.wait(360 + ctx.random() * 240);

    if (type !== 'iter' && i > 0 && b.inboxPile.length < 3 && ctx.random() < 0.3) {
      ctx.spawn(() => hopToBuilder(ctx, scene, world, world.chat.sendPoint, b));
    }
    if (type === 'iter' && b.inboxPile.length) {
      world.say(ctx, `${b.label} hits an iteration boundary and admits everything pending at once`);
      await admitPending(ctx, scene, b);
    }
  }
  if (!ctx.alive) return;
  tickBuilder(ctx, scene, b, 'agent');
  setNodeActive(ctx, node, null);
  setBuilderStatus(ctx, b, 'asleep');
  world.say(ctx, `${b.label} finishes: AgentDone closes the turn, one more notification carries the result upstream`);
  await hopToChat(ctx, scene, world, b, 'agent');
  // The chat agent gets its own short turn per notification: wake, admit at
  // run start, iterate briefly, AgentDone, idle again — same as ambient
  // builders, never batched.
  await chatWakeAndRun(ctx, scene, world);
  await chatFinishTurn(ctx, scene, world);
  b.busy = false;
}
