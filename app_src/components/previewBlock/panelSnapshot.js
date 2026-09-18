// Coalesces panel snapshot requests into one host call at a time. Every
// caller keeps its own pending flag until its callback runs, so a lost host
// callback must never leave the queue blocked.
const EMPTY_SNAPSHOT = { activeLayer: null, selection: null, layers: [] };

const createPanelSnapshotQueue = (evalScript, { timeout = 15000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) => {
  let pending = false;
  let timer = null;
  let generation = 0;
  let signature = "";
  let callbacks = [];

  const schedule = () => {
    if (pending || timer) return;
    timer = setTimer(() => {
      timer = null;
      pending = true;
      const requestGeneration = ++generation;
      const requestedSignature = signature;
      const requestedCallbacks = callbacks;
      signature = "";
      callbacks = [];
      let failsafe = null;
      const settle = () => {
        // A request released by the failsafe is answered by its retry, so a
        // late response from it is ignored
        if (requestGeneration !== generation || !pending) return false;
        pending = false;
        if (failsafe) clearTimer(failsafe);
        return true;
      };
      failsafe = setTimer(() => {
        if (!settle()) return;
        // Retry the abandoned callers with their signature unless a newer
        // request already supplied one
        callbacks = requestedCallbacks.concat(callbacks);
        if (!signature) signature = requestedSignature;
        schedule();
      }, timeout);
      evalScript(`getTypeRPanelSnapshot(${JSON.stringify({ signature: requestedSignature })})`, (result) => {
        if (!settle()) return;
        let snapshot = EMPTY_SNAPSHOT;
        try {
          snapshot = JSON.parse(result || "{}") || snapshot;
        } catch (error) {}
        requestedCallbacks.forEach((snapshotCallback) => snapshotCallback(snapshot));
        // Requests arriving while ExtendScript was busy belong to the next
        // Photoshop state; do not satisfy them with the now-stale response.
        if (callbacks.length) schedule();
      });
    }, 0);
  };

  return (nextSignature, callback) => {
    callbacks.push(callback);
    if (nextSignature) signature = nextSignature;
    schedule();
  };
};

export { createPanelSnapshotQueue };
