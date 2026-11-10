// Photoshop's "Auto-Collapse Iconic Panels" (Preferences > Workspace, off by
// default) closes a panel opened from an icon dock at the next click outside
// it. With TypeR in such a dock, the panel "closed by itself" at every click
// on the document, in the Legacy panel as in the new one. The first time
// TypeR finds the option on, it turns it off and says so. Only once: a user
// who turns it back on afterwards, for other panels, keeps it.

import React from "react";
import { csInterface, locale, readStorage, writeToStorage } from "./utils";

const STORAGE_KEY = "autoCollapseTurnedOff";
// After the panel's own start, so the notice is not lost under it
const START_DELAY = 1500;

// "done" (already turned off once), "off" (nothing to do, or a host without
// the option), or "turnedOff"
const guardAutoCollapse = async ({ alreadyDone, evalHost, remember, notify }) => {
  if (alreadyDone()) return "done";
  let reply = null;
  try {
    reply = JSON.parse(await evalHost("disableAutoCollapsePanels()"));
  } catch (error) {
    reply = null;
  }
  if (!reply || reply.wasOn !== true) return "off";
  remember();
  notify();
  return "turnedOff";
};

// Checks when the panel starts and each time it is shown again (a panel in an
// icon dock is shown at every opening), until the option was turned off once
const useAutoCollapseGuard = (dispatch) => {
  React.useEffect(() => {
    let stopped = false;
    let running = false;
    const stop = () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
    const check = async () => {
      if (stopped || running || document.hidden) return;
      // Storage that could not be read: nothing can be remembered
      if (readStorage().error) return;
      running = true;
      try {
        const result = await guardAutoCollapse({
          alreadyDone: () => readStorage(STORAGE_KEY) === true,
          evalHost: (script) => new Promise((resolve) => csInterface.evalScript(script, resolve)),
          remember: () => writeToStorage({ [STORAGE_KEY]: true }),
          notify: () => dispatch({ type: "showNotice", text: locale.autoCollapseTurnedOff, kind: "warning" }),
        });
        if (result !== "off") stop();
      } finally {
        running = false;
      }
    };
    function onVisible() {
      if (!document.hidden) check();
    }
    document.addEventListener("visibilitychange", onVisible);
    const timer = setTimeout(check, START_DELAY);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);
};

export { guardAutoCollapse, useAutoCollapseGuard, STORAGE_KEY };
