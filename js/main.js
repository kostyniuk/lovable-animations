import { mount } from './lib.js';

const vizzes = ['hero', 'trajectory', 'context', 'streaming', 'inbox', 'acp', 'suspend', 'chats'];

for (const id of vizzes) {
  import(`./viz/${id}.js`)
    .then((m) => mount(`#viz-${id}`, m.default))
    .catch((e) => console.error(`viz ${id} failed to load`, e));
}
