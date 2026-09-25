import { mount, highlight, playback, setManualMode } from './lib.js';

// Same identifier chips in the prose as in the figure captions.
for (const el of document.querySelectorAll('main p, figure figcaption')) highlight(el);

// Page-wide playback mode switch (Auto / Step by step).
const modeButtons = document.querySelectorAll('.mode-switch [data-mode]');
const syncModeSwitch = () => {
  for (const b of modeButtons) b.setAttribute('aria-checked', String((b.dataset.mode === 'manual') === playback.manual));
};
for (const b of modeButtons) {
  b.addEventListener('click', () => { setManualMode(b.dataset.mode === 'manual'); syncModeSwitch(); });
}
syncModeSwitch();

const vizzes = ['hero', 'trajectory', 'context', 'streaming', 'inbox', 'acp', 'suspend', 'chats'];

for (const id of vizzes) {
  import(`./viz/${id}.js`)
    .then((m) => mount(`#viz-${id}`, m.default))
    .catch((e) => console.error(`viz ${id} failed to load`, e));
}
