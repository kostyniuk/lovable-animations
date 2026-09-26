import { mount, highlight } from './lib.js';

// Same identifier chips in the prose as in the figure captions.
for (const el of document.querySelectorAll('main p, figure figcaption')) highlight(el);

const vizzes = ['hero', 'hero3d', 'trajectory', 'context', 'streaming', 'inbox', 'acp', 'suspend', 'chats'];

for (const id of vizzes) {
  import(`./viz/${id}.js`)
    .then((m) => mount(`#viz-${id}`, m.default))
    .catch((e) => console.error(`viz ${id} failed to load`, e));
}
