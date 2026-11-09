// The panel asks the plugin host for its init payload (its files, locales and
// host environment) until the host answers.
//
// The host may attach its listener after this page started, so the request is
// sent again while no answer came. Every request stays open: the answer to any
// of them starts the panel. At Photoshop's start an answer (about 1 MB) was
// seen to take more than a second to reach the page, and a page that only
// listened to its latest request threw every answer away as it came late,
// 60 times, while the host had answered each one within 50 ms ("the plugin
// host does not answer", which Reload TypeR fixed once Photoshop was idle).
// Each request makes the host send the whole payload again: the requests are
// spaced out after the first seconds so as not to pile copies of it up.
export const INIT_DEADLINE_MS = 60000;

export function initRetryDelay(attempt) {
  return attempt <= 5 ? 1000 : 5000;
}

export function requestInit({ request, notify, setTimer = setTimeout, clearTimer = clearTimeout, deadlineMs = INIT_DEADLINE_MS, retryDelay = initRetryDelay }) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;
    let waited = 0;
    let attempt = 0;
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimer(timer);
      settle(value);
    };
    const ask = () => {
      timer = null;
      if (done) return;
      if (waited >= deadlineMs) {
        // The host reloads the panel once on this reason (uxp-src/host/main.js)
        const error = new Error("the plugin host does not answer");
        error.reason = "init-timeout";
        error.attempts = attempt;
        finish(reject, error);
        return;
      }
      attempt++;
      notify("ready");
      let pending;
      try {
        pending = Promise.resolve(request("init"));
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then((result) => finish(resolve, result), (error) => finish(reject, error));
      const wait = Math.max(1, Math.min(retryDelay(attempt), deadlineMs - waited));
      waited += wait;
      timer = setTimer(ask, wait);
    };
    ask();
  });
}
