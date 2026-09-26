// The chat-cycle walkthrough: one deterministic task cycle, told the same
// way by both #viz-hero (2D) and #viz-hero3d (3D). Each entry is a beat —
// an ordered `{ id, caption }` pair. `caption` is a function of the beat's
// live parameters (which project, which fleet node) so both figures produce
// byte-identical narration; only the *visual* action per id differs, and
// that action lives in each figure's own guided-tour function, keyed by id.
//
// Params passed to every caption(): { project, node }. `node` is filled in
// once the 'activation' beat has actually picked a free fleet node — every
// caption after that point sees the same name.

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// 'a', 'a and b', 'a, b and c' — shared so ambient narration in both figures
// lists concurrent fan-out targets the same way.
export const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// The chat agent is "responsible for writing a self-contained message …
// the builder only ever sees the message it was sent" — shown as a small
// preview near the chat agent (2D) / following the envelope (3D) from the
// moment it's written through delivery.
export const MESSAGE_PREVIEW = (project) => `${project}: "add a dark-mode toggle to settings; persist per user"`;

export const CHAT_CYCLE = [
  {
    id: 'user-to-inbox',
    caption: () => "the user sends a message — it lands in the chat agent's inbox (inbox · 1)",
  },
  {
    id: 'user-activation',
    caption: () => 'ACP publishes an activation — it wakes the chat agent to handle its inbox',
  },
  {
    id: 'user-admit',
    caption: () => 'at run start the chat agent admits it onto its trajectory (inbox · 0) and starts its turn',
  },
  {
    id: 'propose',
    caption: () => 'the chat agent iterates on it and replies with a plan — "Add a dark-mode toggle to dashboard? Confirm to build" — then its turn ends (AgentDone) and it waits',
  },
  {
    id: 'confirm-inbox',
    caption: () => "the user confirms — the confirmation lands in the chat agent's inbox (inbox · 1), and an activation wakes it",
  },
  {
    id: 'confirm-admit',
    caption: (p) => `at run start it admits the confirmation (inbox · 0) and writes a self-contained message for ${p.project} — the builder will only ever see this message`,
  },
  {
    id: 'send-message',
    caption: (p) => `the chat agent calls send_message_to_project for ${p.project} — the envelope travels to the Agent Control Plane bar and drops there: that's SendMessage`,
  },
  {
    id: 'inbox-append',
    caption: (p) => `ACP appends an ExternalAgentNotification to ${p.project}'s inbox — the inbox badge goes to 1: the durable step`,
  },
  {
    id: 'activation',
    caption: () => "ACP publishes an activation — the yellow signal leaves the bar's bottom edge for a fleet node",
  },
  {
    id: 'boot',
    caption: (p) => `${p.node} picks it up and lights up; it boots ${p.project} with its trajectory — the builder goes to running`,
  },
  {
    id: 'iterate',
    caption: () => 'the builder iterates: IterationStart, tool_call, IterationEnd',
  },
  {
    id: 'interject',
    caption: (p) => `while ${p.project} is mid-iteration, two more messages arrive via ACP — they wait in its inbox (inbox · 2)`,
  },
  {
    id: 'batch-admit',
    caption: (p) => `IterationEnd — at the boundary, ${p.project} admits everything pending at once: both land on its trajectory together; inbox · 0`,
  },
  {
    id: 'progress-drop',
    caption: () => 'the builder posts a progress update — NotifyParents drops an ExternalAgentNotification into ACP',
  },
  {
    id: 'progress-inbox',
    caption: () => "ACP appends it to the chat agent's inbox and sends an activation (inbox · 1)",
  },
  {
    id: 'chat-progress-turn',
    caption: (p) => `the chat agent wakes: at run start it admits the update onto its trajectory (inbox · 0) and iterates on it — relaying the progress to the user. ${cap(p.project)} keeps working meanwhile`,
  },
  {
    id: 'chat-progress-done',
    caption: () => 'its turn ends — AgentDone, and the chat agent goes idle again',
  },
  {
    id: 'result-drop',
    caption: () => 'the builder finishes: AgentDone — the node goes dim, the builder goes to asleep, and NotifyParents drops the result into ACP',
  },
  {
    id: 'result-inbox',
    caption: () => "ACP appends the result to the chat agent's inbox and sends an activation (inbox · 1)",
  },
  {
    id: 'chat-result-turn',
    caption: () => 'the chat agent wakes, admits the result at run start (inbox · 0), and iterates — summarizing the result for the user',
  },
  {
    id: 'chat-result-done',
    caption: () => 'AgentDone — the chat agent goes idle; the cycle is complete',
  },
];
