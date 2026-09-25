# How Lovable's agents work together — animated

An interactive companion to Lovable's post
[Inside Chats: How Lovable's Agents Work Together](https://lovable.dev/blog/how-lovable-agents-work-together),
inspired by Ben Dicken's interactive essays on the PlanetScale blog.

Eight SVG animations, one per idea in the article:

- **Hero** — the whole system at a glance: chat agent, project builders, fleet nodes
- **01 Trajectories** — Git-like event log, one parent pointer per event, free forks
- **02 Context projection** — backward prompt walk and asynchronous compaction
- **03 Streaming** — partials and field deltas beside the trajectory
- **04 Inbox vs. trajectory** — messages admitted at iteration boundaries
- **05 Agent Control Plane** — append to inbox, then activate
- **06 Suspend and resume** — runs that survive deploys and dead sandboxes
- **07 Chats** — fan-out to project builders, progress and results back up

Each figure autoplays when scrolled into view and has Play/Pause, Back, Step, Reset and a speed slider (0.1×–2×). Every figure also has its own **Auto / Step by step** switch (remembered per figure): in step-by-step mode it never runs on its own — each **Next** (or the → key) plays exactly one beat, and **Back** (or ←) goes one beat back. Back replays the scene deterministically (seeded randomness, recorded button clicks) up to the previous beat.

## Run locally

No build step — plain HTML, CSS and ES modules:

```sh
python3 -m http.server 5178
# open http://localhost:5178
```

## Deploying

GitHub Pages caches assets for 10 minutes, so `index.html` loads every module and the stylesheet with a `?v=` version stamp. Run `scripts/stamp-version.sh` before committing asset changes (or install it as a pre-commit hook) so browsers never mix old and new files.

## Structure

- `index.html`, `styles.css` — page and design tokens
- `js/lib.js` — scene runner (play/pause/step/reset, speed-aware tweens) and SVG helpers
- `js/viz/*.js` — one module per animation

Unofficial; not affiliated with Lovable.
