// The guided tours (components/modal/tour.jsx) are hands-on courses: the
// basics walkthrough (walkthrough.jsx) and What's new in 3.0 (whatsNew.jsx).
// A tour opens a practice page in Photoshop, loads a practice script in a tab
// and checks each exercise from the panel state. Its progress lives here,
// outside the modal, so a window the tour opens (style editor, settings)
// hands back to it when it closes (components/modal/modal.jsx). One tour
// runs at a time: `course` says which.

import config from "./config";
import { csInterface, locale } from "./utils";
import { getNode } from "./uxpMigration";

export const WHATS_NEW_MODAL = "whatsNew";
export const WALKTHROUGH_MODAL = "walkthrough";

export const isTourModal = (modalType) => modalType === WHATS_NEW_MODAL || modalType === WALKTHROUGH_MODAL;

const createSession = () => ({
  active: false,
  // Modal type of the running tour: whatsNew or walkthrough
  course: WHATS_NEW_MODAL,
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
  // Step id -> ids of the styles there when the step began: a style made
  // during the step is told apart from them
  known: {},
  // Step id -> count of its tour event (tourEvents.js) when the step began
  eventStart: {},
  // The current style before a step that makes a copy of it: { stepId, id }
  styleBefore: null,
  // Counters and style read when the chapter that checks them opens
  textShapeRAppliedAtStart: null,
  textShapeRLearnedAtStart: null,
  startedAt: 0,
});

export const whatsNewSession = createSession();

// The progress outlives the guide and the panel: closing the tour, or
// Photoshop, never loses it. Counters and baselines are taken again on resume.
// Each tour keeps its own progress.
const PROGRESS_KEYS = {
  whatsNew: "typer.whatsNewProgress",
  walkthrough: "typer.walkthroughProgress",
};
const BASICS_VERSION = "basics-1";
const courseVersion = (course) => (course === WALKTHROUGH_MODAL ? BASICS_VERSION : config.whatsNewVersion);
const progressKey = (course) => PROGRESS_KEYS[course] || PROGRESS_KEYS.whatsNew;
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
  "known",
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
  const course = whatsNewSession.course;
  const progress = { version: courseVersion(course) };
  PROGRESS_FIELDS.forEach((field) => {
    progress[field] = whatsNewSession[field];
  });
  try {
    storage.setItem(progressKey(course), JSON.stringify(progress));
  } catch (error) {
    // Storage full or blocked: the tour still works, it only cannot resume
  }
};

export const clearWhatsNewProgress = (course = whatsNewSession.course) => {
  const storage = progressStorage();
  try {
    if (storage) storage.removeItem(progressKey(course));
  } catch (error) {
    // Nothing to clear
  }
};

// The saved run, if it was started and not finished (chapters: their count)
export const readWhatsNewProgress = (chapters, course = whatsNewSession.course) => {
  const storage = progressStorage();
  if (!storage) return null;
  let progress = null;
  try {
    progress = JSON.parse(storage.getItem(progressKey(course)) || "null");
  } catch (error) {
    return null;
  }
  if (!progress || typeof progress !== "object" || progress.version !== courseVersion(course)) return null;
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
  saved.known = {};
  if (progress.known && typeof progress.known === "object") {
    Object.keys(progress.known).forEach((stepId) => {
      if (Array.isArray(progress.known[stepId])) saved.known[stepId] = progress.known[stepId];
    });
  }
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

// A fresh run; one left unfinished is offered back first (resumeWhatsNewSession).
// Opening the other tour puts the running one away, progress kept.
export const startWhatsNewSession = (chapters, course = WHATS_NEW_MODAL) => {
  if (whatsNewSession.active && whatsNewSession.course === course) return;
  if (whatsNewSession.active) endWhatsNewSession();
  Object.assign(whatsNewSession, createSession(), { active: true, course, startedAt: Date.now() });
  whatsNewSession.resumeOffer = readWhatsNewProgress(chapters || 0, course);
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

// The tours float over the panel and let the user work: shortcuts and mouse
// buttons keep running while one is open
export const isBlockingModal = (modalType) => !!modalType && !isTourModal(modalType);

// What's new: one line per numbered spot of the practice page, in reading
// order; spot 7 (double bubble) takes two. The keys keep the numbering of
// earlier pages.
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

// Basics walkthrough: one line per numbered spot of its page. Line 4 starts
// with the prefix of the Shout style the user makes in the walkthrough.
export const BASICS_LINES = [
  { key: "walkthroughPracticeLine1", text: "Welcome to TypeR! Each line of the script goes into its own bubble." },
  { key: "walkthroughPracticeLine2", text: "One selection, one paste, and on to the next line." },
  { key: "walkthroughPracticeLine3", text: "Meanwhile, far away from here..." },
  { key: "walkthroughPracticeLine4", text: "WATCH OUT!", prefix: true },
];

export const basicsShoutPrefix = () => String(locale.walkthroughShoutPrefix || "SHOUT:").trim() || "SHOUT:";

const courseLines = (course) => (course === WALKTHROUGH_MODAL ? BASICS_LINES : PRACTICE_LINES);

export const practiceLineText = (number, course = whatsNewSession.course) => {
  const line = courseLines(course)[number - 1];
  const text = (line && locale[line.key]) || (line && line.text) || "";
  return line && line.prefix ? basicsShoutPrefix() + " " + text : text;
};

// The basics script also has a page marker and a translator note, which
// TypeR skips: the walkthrough shows them
export const buildPracticeScript = (course = whatsNewSession.course) => {
  const lines = courseLines(course).map((line, index) => practiceLineText(index + 1, course));
  if (course !== WALKTHROUGH_MODAL) return lines.join("\n");
  // The page marker stays in English: TypeR reads "Page N" in every language
  const page = "Page 1";
  const note = "## " + (locale.walkthroughPracticeNote || "Translator note: lines starting with ## are never pasted.");
  return [page, lines[0], lines[1], note, lines[2], lines[3]].join("\n");
};

// Index of a practice line in the parsed script of the current tab
export const findPracticeLineIndex = (lines, number, course = whatsNewSession.course) => {
  const wanted = practiceLineText(number, course).trim();
  if (!wanted || !Array.isArray(lines)) return -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && String(line.rawText || "").trim() === wanted) return i;
  }
  return -1;
};

// Same, from the raw script of a tab that is not loaded yet (one parsed line
// per raw line, so the raw index is the line index)
export const findPracticeLineInText = (text, number, course = whatsNewSession.course) => {
  const wanted = practiceLineText(number, course).trim();
  if (!wanted || typeof text !== "string") return -1;
  const rawLines = text.split("\n");
  for (let i = 0; i < rawLines.length; i++) if (rawLines[i].trim() === wanted) return i;
  return -1;
};

// The styles of the current style's folder, where smart paste looks for the
// style marked for a bubble kind
export const currentFolderStyles = (state) => {
  const styles = state.styles || [];
  const current = styles.find((style) => style.id === state.currentStyleId);
  return current ? styles.filter((style) => (style.folder || null) === (current.folder || null)) : styles;
};

// Styles the tags of a script line are read from: the current style's
// folder, or every style when tags are not limited to it (context.jsx)
const tagScopeStyles = (state) => (state.currentFolderTagPriority !== false ? currentFolderStyles(state) : state.styles || []);

// A style whose tag picks it for walkthrough line 4
export const hasBasicsShoutTag = (style) => {
  const raw = practiceLineText(4, WALKTHROUGH_MODAL);
  return !!style && !style.prefixesDisabled && (style.prefixes || []).some((prefix) => prefix && raw.startsWith(prefix));
};

// The style the tag of walkthrough line 4 picks, the one a paste of that line
// uses: made in the walkthrough or before it. With two styles carrying the
// tag, the first in the list wins, as when the script is read.
export const basicsShoutStyle = (state) => tagScopeStyles(state).find(hasBasicsShoutTag) || null;

// The tours offer a style the user already has before asking for a new one.
// A style is recognized by a word of its name, in the languages of TypeR
// (any language: a name does not follow the panel language).
const STYLE_NAME_WORDS = {
  shout: ["shout", "scream", "yell", "cri", "grito", "schrei", "крик", "bağırış", "bağırma", "hét", "صراخ"],
  narration: [
    "narration", "narrator", "narrateur", "narración", "narração", "narrador", "erzählung", "erzähler",
    "повествование", "оповідь", "anlatım", "dẫn truyện", "سرد",
  ],
};

const nameWords = (name) => String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .split(/[\s_\-/.,;:()[\]{}|•+*!?'"«»“”‘’„]+/).filter(Boolean);

// 0: not named so, 1: a word of the name (plural too), 2: the whole name
const nameMatch = (style, kind) => {
  const words = nameWords(style && style.name);
  let best = 0;
  (STYLE_NAME_WORDS[kind] || []).forEach((keyword) => {
    const wanted = nameWords(keyword);
    for (let i = 0; i + wanted.length <= words.length; i++) {
      const found = wanted.every((word, j) => words[i + j] === word ||
        (j === wanted.length - 1 && words[i + j] === word + "s"));
      if (found) best = Math.max(best, words.length === wanted.length ? 2 : 1);
    }
  });
  return best;
};

// The style named for a kind of text (shout, narration) among
// `styles`: `preferId` when it is one, else a style named just so, else the
// first one with the word in its name
export const findNamedStyle = (styles, kind, preferId) => {
  const named = (styles || []).filter((style) => nameMatch(style, kind) > 0);
  return named.find((style) => style.id === preferId) ||
    named.find((style) => nameMatch(style, kind) === 2) || named[0] || null;
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

export const PRACTICE_PAGES = {
  whatsNew: "typer-practice-page.png",
  walkthrough: "typer-basics-page.png",
};

// Native path of a copy of the practice page in the temporary folder (the
// bundled file itself when the copy fails), so Photoshop never saves over it
export const getPracticePagePath = async (course = whatsNewSession.course) => {
  const PRACTICE_PAGE = PRACTICE_PAGES[course] || PRACTICE_PAGES.whatsNew;
  if (typeof window !== "undefined" && window.typerUXP) {
    return window.typerUXP.request("practicePagePath", PRACTICE_PAGE);
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
