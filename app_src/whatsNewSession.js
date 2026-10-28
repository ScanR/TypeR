// The What's new tour (components/modal/whatsNew.jsx) is a hands-on course:
// it opens a practice page in Photoshop, loads a practice script in a tab and
// checks each exercise from the panel state. Its progress lives here, outside
// the modal, so a window the tour opens (style editor, settings) hands back
// to it when it closes (components/modal/modal.jsx).

import config from "./config";
import { csInterface, locale } from "./utils";
import { getNode } from "./uxpMigration";

export const WHATS_NEW_MODAL = "whatsNew";

const createSession = () => ({
  active: false,
  chapter: 0,
  minimized: false,
  // Step ids already done: a step stays done once it passed
  done: {},
  // Chapter id -> index of the step the user opened by hand
  focus: {},
  pageOpened: false,
  // A style was clicked in the list (or created) during this run
  stylePicked: false,
  // The undo of bubble 4 was seen: the step now waits for it to be pasted back
  undoSeen: false,
  // Chapter on screen at the last render and whether it was done (auto-advance)
  shownChapter: null,
  practiceTabId: null,
  previousTabId: null,
  leftPracticeTab: false,
  // Where the guide was dragged or moved to uncover the ring (whatsNewGuide.js),
  // else it takes the side of getWhatsNewDock; and the target the user
  // dragged it over by hand
  guidePos: null,
  guideLockKey: null,
  // Progress saved by an earlier run, offered back when the tour reopens
  resumeOffer: null,
  // Step id -> value of a setting already there when the run began
  startValues: null,
  // Toggle steps seen off while current: turning them on passes at once
  presetOff: {},
  // Tip of the current step for the window it opens (settings, style editor)
  coach: null,
  // The current style before a role exercise (shout, narration) made its
  // copy active: { role, id }
  styleBeforeRole: null,
  // The shout exercise: styles there when it began, and the dialogue style
  shoutKnownIds: null,
  shoutBaseId: null,
  // The same for the narration exercise
  narrationKnownIds: null,
  narrationBaseId: null,
  // Counters and style read when the chapter that checks them opens
  textShapeRAppliedAtStart: null,
  textShapeRLearnedAtStart: null,
  startedAt: 0,
});

export const whatsNewSession = createSession();

// The progress outlives the guide and the panel: closing the tour, or
// Photoshop, never loses it. Counters and baselines are taken again on resume.
const PROGRESS_KEY = "typer.whatsNewProgress";
const PROGRESS_FIELDS = [
  "chapter",
  "done",
  "focus",
  "pageOpened",
  "stylePicked",
  "undoSeen",
  "practiceTabId",
  "previousTabId",
  "leftPracticeTab",
  "shoutKnownIds",
  "shoutBaseId",
  "narrationKnownIds",
  "narrationBaseId",
  "guidePos",
  "startValues",
];

const progressStorage = () => {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch (error) {
    return null;
  }
};

export const saveWhatsNewProgress = () => {
  const storage = progressStorage();
  // A pending offer keeps the saved run until the user picks
  if (!storage || !whatsNewSession.active || whatsNewSession.resumeOffer) return;
  const progress = { version: config.whatsNewVersion };
  PROGRESS_FIELDS.forEach((field) => {
    progress[field] = whatsNewSession[field];
  });
  try {
    storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (error) {
    // Storage full or blocked: the tour still works, it only cannot resume
  }
};

export const clearWhatsNewProgress = () => {
  const storage = progressStorage();
  try {
    if (storage) storage.removeItem(PROGRESS_KEY);
  } catch (error) {
    // Nothing to clear
  }
};

// The saved run, if it was started and not finished (chapters: their count)
export const readWhatsNewProgress = (chapters) => {
  const storage = progressStorage();
  if (!storage) return null;
  let progress = null;
  try {
    progress = JSON.parse(storage.getItem(PROGRESS_KEY) || "null");
  } catch (error) {
    return null;
  }
  if (!progress || typeof progress !== "object" || progress.version !== config.whatsNewVersion) return null;
  const chapter = Number(progress.chapter);
  if (!(chapter >= 1 && chapter <= chapters)) return null;
  const saved = { chapter };
  saved.done = progress.done && typeof progress.done === "object" ? progress.done : {};
  saved.focus = progress.focus && typeof progress.focus === "object" ? progress.focus : {};
  saved.pageOpened = progress.pageOpened === true;
  saved.stylePicked = progress.stylePicked === true;
  saved.undoSeen = progress.undoSeen === true;
  saved.leftPracticeTab = progress.leftPracticeTab === true;
  ["practiceTabId", "previousTabId", "shoutBaseId", "narrationBaseId"].forEach((field) => {
    saved[field] = progress[field] === undefined ? null : progress[field];
  });
  saved.shoutKnownIds = Array.isArray(progress.shoutKnownIds) ? progress.shoutKnownIds : null;
  saved.narrationKnownIds = Array.isArray(progress.narrationKnownIds) ? progress.narrationKnownIds : null;
  saved.startValues = progress.startValues && typeof progress.startValues === "object" ? progress.startValues : null;
  const position = progress.guidePos;
  saved.guidePos = position && (position.anchor === "top" || position.anchor === "bottom") &&
    isFinite(position.left) && isFinite(position.offset) ? position : null;
  return saved;
};

// The TextShapeR chapter teaches the star (Learn) on the practice page: that
// lesson must not stay in the user's learning. The learning is copied when
// the chapter opens and given back when the guide leaves the chapter or
// closes, or at the next panel start if Photoshop quit in between.
const TUNING_BACKUP_KEY = "typer.whatsNewTuningBackup";
let tuningBackup = null;

export const backupTourTuning = (state) => {
  if (tuningBackup) return;
  tuningBackup = { tuning: state.textShapeRTuning || null, learnUsed: state.textShapeRLearnUsed === true };
  const storage = progressStorage();
  try {
    if (storage && storage.getItem(TUNING_BACKUP_KEY) === null) storage.setItem(TUNING_BACKUP_KEY, JSON.stringify(tuningBackup));
  } catch (error) {
    // Storage full or blocked: the copy in memory still covers this session
  }
};

export const restoreTourTuning = (dispatch) => {
  const storage = progressStorage();
  let backup = tuningBackup;
  try {
    if (!backup && storage) backup = JSON.parse(storage.getItem(TUNING_BACKUP_KEY) || "null");
    if (storage) storage.removeItem(TUNING_BACKUP_KEY);
  } catch (error) {
    // A broken copy cannot be given back
  }
  tuningBackup = null;
  if (!backup || typeof backup !== "object") return;
  dispatch({ type: "restoreTextShapeRTuning", value: backup.tuning || null, learnUsed: backup.learnUsed === true });
};

// A fresh run; one left unfinished is offered back first (resumeWhatsNewSession)
export const startWhatsNewSession = (chapters) => {
  if (whatsNewSession.active) return;
  Object.assign(whatsNewSession, createSession(), { active: true, startedAt: Date.now() });
  whatsNewSession.resumeOffer = readWhatsNewProgress(chapters || 0);
};

export const resumeWhatsNewSession = (resume) => {
  const saved = whatsNewSession.resumeOffer;
  whatsNewSession.resumeOffer = null;
  if (resume && saved) Object.assign(whatsNewSession, saved);
  else clearWhatsNewProgress();
};

export const endWhatsNewSession = () => {
  saveWhatsNewProgress();
  whatsNewSession.active = false;
};

// The tour floats over the panel and lets the user work: shortcuts and mouse
// buttons keep running while it is open
export const isBlockingModal = (modalType) => !!modalType && modalType !== WHATS_NEW_MODAL;

// One line per numbered spot of the practice page, in reading order; spot 7
// (double bubble) takes two. The keys keep the numbering of earlier pages.
export const PRACTICE_LINES = [
  { key: "whatsNewPracticeLine1", text: "Welcome to TypeR 3.0! This text follows the round shape of the bubble instead of filling a rectangle." },
  { key: "whatsNewPracticeLine2", text: "I am a tiny bubble, so this text has to shrink a little to fit." },
  { key: "whatsNewPracticeLine3", text: "One click..." },
  { key: "whatsNewPracticeLine4", text: "...and the next line is already pasted!" },
  { key: "whatsNewPracticeLine10", text: "No bubble here: a rectangle is enough." },
  { key: "whatsNewPracticeLine5", text: "In a black bubble, the text turns white." },
  { key: "whatsNewPracticeLine6", text: "A double bubble?" },
  { key: "whatsNewPracticeLine7", text: "The next line goes into the other part!" },
  { key: "whatsNewPracticeLine9", text: "The original lettering is hidden under this text." },
  { key: "whatsNewPracticeLine8", text: "AAAAAAH!" },
  { key: "whatsNewPracticeLine11", text: "Meanwhile, on the other side of town..." },
];

export const practiceLineText = (number) => {
  const line = PRACTICE_LINES[number - 1];
  return (line && locale[line.key]) || (line && line.text) || "";
};

export const buildPracticeScript = () => PRACTICE_LINES.map((line, index) => practiceLineText(index + 1)).join("\n");

// Index of a practice line in the parsed script of the current tab
export const findPracticeLineIndex = (lines, number) => {
  const wanted = practiceLineText(number).trim();
  if (!wanted || !Array.isArray(lines)) return -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && String(line.rawText || "").trim() === wanted) return i;
  }
  return -1;
};

// Same, from the raw script of a tab that is not loaded yet (one parsed line
// per raw line, so the raw index is the line index)
export const findPracticeLineInText = (text, number) => {
  const wanted = practiceLineText(number).trim();
  if (!wanted || typeof text !== "string") return -1;
  const rawLines = text.split("\n");
  for (let i = 0; i < rawLines.length; i++) if (rawLines[i].trim() === wanted) return i;
  return -1;
};

// Until it is moved, the tour floats on the side of the panel away from the
// script, so the current line stays in sight
export const getWhatsNewDock = (uiLayout) => {
  const layout = uiLayout || {};
  const visible = layout.visible || {};
  const order = (layout.order || ["preview", "text", "styles"]).filter((section) => visible[section] !== false);
  const textIndex = order.indexOf("text");
  return textIndex >= 0 && textIndex === order.length - 1 ? "top" : "bottom";
};

const PRACTICE_PAGE = "typer-practice-page.png";

// Native path of a copy of the practice page in the temporary folder (the
// bundled file itself when the copy fails), so Photoshop never saves over it
export const getPracticePagePath = async () => {
  if (typeof window !== "undefined" && window.typerUXP) {
    return window.typerUXP.request("practicePagePath");
  }
  const source = csInterface.getSystemPath(window.SystemPath.EXTENSION) + "/app/assets/" + PRACTICE_PAGE;
  try {
    const node = getNode();
    if (!node) return source;
    const target = node.path.join(node.os.tmpdir(), PRACTICE_PAGE);
    node.fs.writeFileSync(target, node.fs.readFileSync(source));
    return target;
  } catch (error) {
    return source;
  }
};
