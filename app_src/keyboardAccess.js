// UXP on macOS: the keyboard reader counts as Photoshop for privacy, and sees
// no letter, digit or symbol until Photoshop has Input Monitoring. No API adds
// Photoshop to that list (asking from the reader leaves it out, measured
// 2026-10-31), so TypeR detects the missing permission and opens the right
// pane. CEP reads the keyboard through ScriptUI and the web version has no
// reader: neither needs it.
import React from "react";
import { locale, nativeConfirm, readStorage, writeToStorage } from "./utils";

const macHost = () => {
  const host = typeof window !== "undefined" ? window.typerUXP : null;
  return host && host.platform === "darwin" ? host : null;
};

// "granted", "missing", or "unknown" (not applicable, or no answer yet)
export const readKeyboardAccess = () => {
  const host = macHost();
  if (!host) return Promise.resolve("unknown");
  return host.request("keyboardAccess").catch(() => "unknown");
};

export const openKeyboardAccessSettings = () => {
  const host = macHost();
  if (host) host.request("openKeyboardAccess").catch(() => {});
};

// Leaves the reader time to start and report
const PROMPT_DELAY_MS = 5000;

// Offers the settings once, when no window of the panel is open
export const useKeyboardAccessPrompt = (modalType) => {
  React.useEffect(() => {
    if (modalType || !macHost() || readStorage("keyboardAccessAsked")) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      readKeyboardAccess().then((access) => {
        if (!active || access !== "missing") return;
        writeToStorage({ keyboardAccessAsked: true });
        nativeConfirm(
          locale.settingsKeyboardAccessText + "\n\n" + locale.settingsKeyboardAccessPrompt,
          locale.confirmTitle,
          (ok) => {
            if (ok) openKeyboardAccessSettings();
          }
        );
      });
    }, PROMPT_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [modalType]);
};
