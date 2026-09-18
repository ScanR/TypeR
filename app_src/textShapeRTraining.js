// Accepts CEP paths ("/pages/01.psd") and UXP picks ({name, path}), where the
// path is an opaque "psfile:" token and only the name carries the extension
export const normalizeTrainingFiles = (picks) => {
  const seen = new Set();
  return (Array.isArray(picks) ? picks : []).map((pick) => (
    typeof pick === "string" ? { path: pick, name: pick.split(/[\\/]/).pop() }
      : pick && typeof pick.path === "string" ? { path: pick.path, name: String(pick.name || pick.path.split(/[\\/]/).pop()) }
      : null
  )).filter((file) => {
    if (!file || !/\.psd$/i.test(file.name) || seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
};

export const makeTrainingPage = (file, data) => ({
  ...file,
  error: data.error || null,
  entries: (Array.isArray(data.entries) ? data.entries : []).map((entry, index) => {
    const text = String(entry.text || "").replace(/\r\n?/g, "\n").trim();
    const usable = !!text && !entry.error;
    return { ...entry, text, key: `${file.path}:${index}`, usable, included: usable && entry.visible !== false };
  }),
});

export const selectedTrainingEntries = (pages) => pages.reduce((entries, page) => (
  entries.concat(page.error ? [] : page.entries.filter((entry) => entry.usable && entry.included))
), []);

// Keep learning local until the caller explicitly commits the complete result.
// Yield between layers so progress, cancellation and closing the panel work.
export const trainTextShapeREntries = async (entries, currentTuning, options = {}) => {
  let tuning = currentTuning;
  let learned = 0;
  let skipped = 0;
  const cancelled = options.isCancelled || (() => false);
  const recordFeedback = options.recordFeedback;
  // With a batch retrain available, each layer only stores its evidence and
  // the ranker is fitted once over the whole import
  const retrain = options.retrainRanker;
  for (let index = 0; index < entries.length; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (cancelled()) return { cancelled: true, learned: 0, skipped: 0 };
    const entry = entries[index];
    const result = recordFeedback(entry.text, {
      limit: 12,
      allowHyphenation: true,
      profile: "balanced",
      shapeProfile: entry.bubble ? { rows: entry.bubble.rows } : null,
      width: entry.bubble ? entry.bubble.width : undefined,
      height: entry.bubble ? entry.bubble.height : undefined,
      deferRanker: !!retrain,
    }, tuning);
    if (result) {
      tuning = result.tuning;
      learned++;
    } else {
      skipped++;
    }
    if (options.onProgress) options.onProgress(index + 1, entries.length);
  }
  if (cancelled()) return { cancelled: true, learned: 0, skipped: 0 };
  if (retrain && learned) tuning = retrain(tuning);
  return { tuning, learned, skipped, cancelled: false };
};
