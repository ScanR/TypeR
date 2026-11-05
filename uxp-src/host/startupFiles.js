// The panel's files are read once, when the panel first asks for them (init).
// The panel asks again every second until it gets an answer: every request
// shares the reading in progress instead of starting its own. At Photoshop's
// start a reading was seen never to answer while a reload a moment later did:
// a reading that still waits after RESTART_MS is started again next to it,
// and the first one to finish answers every request.
//
// A slow reading is written to Photoshop's UXP log (console.error) with the
// step it waits on, so that the next occurrence names its cause.
const SLOW_MS = 5000;
const RESTART_MS = 15000;

function createStartupLoader({
  load, report = console.error, describe = () => "",
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  slowMs = SLOW_MS, restartMs = RESTART_MS,
}) {
  let result = null;
  let loaded = false;
  let waiting = null;
  const attempts = [];
  let requests = 0;
  let answers = 0;
  let firstRequest = null;
  let firstAnswer = null;

  const context = () => {
    let text = "";
    try {
      text = String(describe() || "");
    } catch (error) {}
    return text ? "; " + text : "";
  };

  const attemptText = (attempt) => "attempt " + attempt.number + ": " +
    attempt.steps.concat(attempt.pending ? [attempt.step + " for " + (now() - attempt.stepStarted) + " ms (waiting)"] : []).join(", ");

  function startAttempt() {
    const attempt = { number: attempts.length + 1, started: now(), step: "start", stepStarted: now(), steps: [], pending: true };
    attempts.push(attempt);
    const cycle = waiting;
    const mark = (name) => {
      const time = now();
      attempt.steps.push(attempt.step + " " + (time - attempt.stepStarted) + " ms");
      attempt.step = String(name);
      attempt.stepStarted = time;
    };
    if (attempt.number > 1) report("TypeR: panel files still not read after " + (attempt.started - attempts[attempt.number - 2].started) + " ms, reading them again (attempt " + attempt.number + ")" + context());
    const watchdog = setTimer(() => {
      if (attempt.pending) report("TypeR: panel files still not read after " + slowMs + " ms, " + attemptText(attempt) + context());
    }, slowMs);
    Promise.resolve()
      .then(() => load(mark))
      .then((value) => {
        attempt.pending = false;
        clearTimer(watchdog);
        mark("done");
        const total = now() - attempt.started;
        if (total >= slowMs || attempt.number > 1) report("TypeR: panel files read in " + total + " ms, " + attemptText(attempt) + context());
        if (loaded) return;
        loaded = true;
        result = value;
        if (waiting) waiting.resolve(value);
        waiting = null;
      }, (error) => {
        attempt.pending = false;
        clearTimer(watchdog);
        report("TypeR: panel files could not be read (" + ((error && error.message) || error) + "), " + attemptText(attempt) + context());
        // Another reading of the same request cycle may still answer
        if (loaded || waiting !== cycle || attempts.some((other) => other.pending)) return;
        waiting = null;
        cycle.reject(error);
      });
  }

  return {
    // Resolves with what load() returned, once for the whole session
    get() {
      requests++;
      if (firstRequest === null) firstRequest = now();
      if (loaded) return Promise.resolve(result);
      if (!waiting) {
        let resolve;
        let reject;
        const promise = new Promise((done, failed) => {
          resolve = done;
          reject = failed;
        });
        waiting = { promise, resolve, reject };
        startAttempt();
      } else {
        const latest = attempts[attempts.length - 1];
        if (latest && now() - latest.started >= restartMs) startAttempt();
      }
      return waiting.promise;
    },
    // The panel was given the files (its init reply was sent)
    answered() {
      answers++;
      if (firstAnswer === null && firstRequest !== null) firstAnswer = now() - firstRequest;
    },
    // One line for the log when the panel could not start
    summary() {
      const parts = ["init requests " + requests, "answers " + answers + (firstAnswer !== null ? " (first after " + firstAnswer + " ms)" : "")];
      for (const attempt of attempts.slice(-4)) parts.push(attemptText(attempt));
      return parts.join("; ") + context();
    },
  };
}

module.exports = { createStartupLoader, SLOW_MS, RESTART_MS };
