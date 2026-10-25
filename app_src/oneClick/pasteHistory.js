// Undo sync: every TypeR paste is one history state. When Photoshop's
// history moves back before a paste, the script line goes back to where it
// was; a redo moves it forward again. Pure bookkeeping, inspired by MD
// TYPER's pair-history.js: the hosts report history state ids.
//
// record = { documentId, before, after, lineBefore, lineAfter }
// snapshot = { documentId, current, states: [id, ...] }

const MAX_RECORDS = 64;

export const createPasteHistory = () => {
  let records = [];
  let sequence = 0;

  const register = (record) => {
    if (!record || record.before == null || record.after == null || record.before === record.after) return false;
    if (records.some((entry) => entry.documentId === record.documentId && entry.after === record.after)) return false;
    records.push({ ...record, status: "applied", sequence: ++sequence });
    if (records.length > MAX_RECORDS) records = records.slice(records.length - MAX_RECORDS);
    return true;
  };

  // The line moves implied by a new history position, newest undo first
  const observe = (snapshot) => {
    if (!snapshot || snapshot.current == null) return [];
    const states = Array.isArray(snapshot.states) ? snapshot.states : null;
    const currentIndex = states ? states.indexOf(snapshot.current) : -1;
    const changes = [];
    for (let i = 0; i < records.length; i++) {
      const entry = records[i];
      if (entry.documentId !== snapshot.documentId) continue;
      let desired = null;
      if (snapshot.current === entry.before) desired = "undone";
      else if (snapshot.current === entry.after) desired = "applied";
      else if (currentIndex >= 0 && states) {
        const beforeIndex = states.indexOf(entry.before);
        const afterIndex = states.indexOf(entry.after);
        if (beforeIndex >= 0 && afterIndex >= 0 && afterIndex > beforeIndex) {
          if (currentIndex <= beforeIndex) desired = "undone";
          else if (currentIndex >= afterIndex) desired = "applied";
        } else if (beforeIndex >= 0 && afterIndex < 0 && currentIndex >= beforeIndex) {
          // Undone, then replaced by another action: the paste is gone
          desired = "undone";
        }
      }
      if (desired && desired !== entry.status) {
        entry.status = desired;
        changes.push({ entry, direction: desired === "undone" ? "undo" : "redo" });
      }
    }
    changes.sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === "undo" ? -1 : 1;
      return a.direction === "undo" ? b.entry.sequence - a.entry.sequence : a.entry.sequence - b.entry.sequence;
    });
    return changes.map(({ entry, direction }) => ({ direction, lineBefore: entry.lineBefore, lineAfter: entry.lineAfter, documentId: entry.documentId }));
  };

  // Records whose states vanished for good (a later action replaced them)
  // are dropped once undone, so they cannot be redone by mistake
  const prune = () => {
    records = records.filter((entry) => entry.status === "applied" || entry.sequence > sequence - MAX_RECORDS);
  };

  const clear = () => {
    records = [];
  };

  return { register, observe, prune, clear, size: () => records.length };
};

// The line to show after a history move: only when the editor still shows
// the line the paste left (or, for a redo, the line it started from)
export const lineAfterHistoryMove = (change, currentLine) => {
  if (!change) return null;
  if (change.direction === "undo" && currentLine === change.lineAfter) return change.lineBefore;
  if (change.direction === "redo" && currentLine === change.lineBefore) return change.lineAfter;
  return null;
};
