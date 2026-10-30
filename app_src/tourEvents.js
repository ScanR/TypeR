// Gestures the guided tours check that leave no trace in the panel state: an
// align, a style applied to a text layer, a backup written. Counted here for
// as long as the panel runs, and never stored. No imports: utils.js reports
// to it.

const counts = {};
let listener = null;

export const noteTourEvent = (name) => {
  counts[name] = (counts[name] || 0) + 1;
  if (listener) listener(name);
};

export const tourEventCount = (name) => counts[name] || 0;

// The open tour listens to check its step at once
export const setTourEventListener = (next) => {
  listener = next;
};
