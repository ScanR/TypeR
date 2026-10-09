// Outline and bubble scans run on Photoshop's main thread, and their cost grows
// with page size and layer count. A slower Photoshop also makes the next scan
// queue behind more work, so the lag compounds over a long session. The pacer
// measures how long scans really take and keeps them to a small share of the
// wall-clock time: a fast host sees no change, a struggling one scans less.
const MIN_SETTLE_MS = 350;
const MAX_GAP_MS = 8000;
// After a scan of N ms, leave about GAP_FACTOR * N ms before the next one
const GAP_FACTOR = 4;
const AVERAGE_WEIGHT = 0.4;

const createScanPacer = (clock = Date.now) => {
  let averageMs = 0;
  let nextAllowedAt = 0;
  return {
    // How long to wait before the next scan may start, never below the settle
    // time that lets a mouse drag finish
    getDelay() {
      return Math.max(MIN_SETTLE_MS, nextAllowedAt - clock());
    },
    recordScan(durationMs) {
      const duration = Math.max(0, Number(durationMs) || 0);
      averageMs = averageMs ? averageMs * (1 - AVERAGE_WEIGHT) + duration * AVERAGE_WEIGHT : duration;
      nextAllowedAt = clock() + Math.min(MAX_GAP_MS, averageMs * GAP_FACTOR);
    },
  };
};

export { createScanPacer, MIN_SETTLE_MS, MAX_GAP_MS };
