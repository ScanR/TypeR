import React from "react";
import { getFontFamilies, getFontViewerStatus } from "./fontViewerApi";
import { isFontInstallSupported } from "./fontInstaller";
import { findFontFinderMatch, getMatchTargetKey } from "./fontFinderMatch";
import { installFontFinderFamilies, readInstalledFontIds } from "./fontFinderInstall";

// Looks up missing fonts on Font FindeR and installs the matches.
// Entry states: searching → found | none | error, then found → installing →
// installed (or back to found with failed: true).

const SEARCH_CONCURRENCY = 2;
const SEARCH_PER_PAGE = 20;

// Lookups survive the window: reopening FontScanR does not search again.
// Failed lookups are dropped so the next window retries them.
const matchCache = new Map();

const searchFamilies = (q) =>
  getFontFamilies({ q, perPage: SEARCH_PER_PAGE }).then((data) => (data && data.families) || []);

const lookupMatch = (target) => {
  const key = getMatchTargetKey(target);
  if (!matchCache.has(key)) {
    const promise = findFontFinderMatch(target, searchFamilies);
    matchCache.set(key, promise);
    promise.catch(() => matchCache.delete(key));
  }
  return matchCache.get(key);
};

const isFamilyInstalled = (family) => {
  const ids = new Set(readInstalledFontIds().map(String));
  return !!(family && family.fonts && family.fonts.length) && family.fonts.every((font) => ids.has(String(font.id)));
};

// targets: [{ key, postScriptName, fontName }], the fonts missing on this
// computer. onFonts receives the refreshed Photoshop font list after an install.
const useFontFinderMatches = (targets, onFonts) => {
  const supported = React.useMemo(isFontInstallSupported, []);
  const [available, setAvailable] = React.useState(false);
  // Font FindeR status known (or no install possible here): until then a
  // missing font is neither "found" nor "not found"
  const [checked, setChecked] = React.useState(!supported);
  const [entries, setEntries] = React.useState({});
  const [busy, setBusy] = React.useState(false);
  const mountedRef = React.useRef(true);
  const startedRef = React.useRef(new Set());
  const entriesRef = React.useRef(entries);
  const busyRef = React.useRef(false);
  const onFontsRef = React.useRef(onFonts);
  entriesRef.current = entries;
  onFontsRef.current = onFonts;
  const signature = (targets || []).map((target) => target.key).join("\n");

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!supported) return undefined;
    let active = true;
    getFontViewerStatus().then(
      (status) => {
        if (!active) return;
        setAvailable(status.enabled === true);
        setChecked(true);
      },
      () => {
        if (active) setChecked(true);
      }
    );
    return () => {
      active = false;
    };
  }, [supported]);

  React.useEffect(() => {
    if (!available) return;
    const pending = (targets || []).filter((target) => target && !startedRef.current.has(target.key));
    if (!pending.length) return;
    pending.forEach((target) => startedRef.current.add(target.key));
    setEntries((current) => {
      const next = { ...current };
      pending.forEach((target) => {
        next[target.key] = { state: "searching" };
      });
      return next;
    });
    const update = (key, entry) => {
      if (mountedRef.current) setEntries((current) => ({ ...current, [key]: entry }));
    };
    let index = 0;
    const worker = async () => {
      while (index < pending.length && mountedRef.current) {
        const target = pending[index];
        index += 1;
        try {
          const match = await lookupMatch(target);
          if (!match) update(target.key, { state: "none" });
          else update(target.key, { state: isFamilyInstalled(match.family) ? "installed" : "found", match });
        } catch (error) {
          update(target.key, { state: "error" });
        }
      }
    };
    for (let i = 0; i < Math.min(SEARCH_CONCURRENCY, pending.length); i++) worker();
  }, [available, signature]);

  // Installs the families matched for the given keys. Every other font matched
  // to one of those families is marked along with them.
  const install = (keys) => {
    if (busyRef.current) return Promise.resolve(false);
    const current = entriesRef.current;
    const families = new Map();
    (keys || []).forEach((key) => {
      const entry = current[key];
      if (entry && entry.state === "found") families.set(entry.match.family.id, entry.match.family);
    });
    if (!families.size) return Promise.resolve(false);
    const affected = Object.keys(current).filter((key) => {
      const entry = current[key];
      return entry && entry.match && entry.state === "found" && families.has(entry.match.family.id);
    });
    const mark = (state, extra) => {
      if (!mountedRef.current) return;
      setEntries((latest) => {
        const next = { ...latest };
        affected.forEach((key) => {
          if (next[key]) next[key] = { ...next[key], state, failed: false, ...(extra || {}) };
        });
        return next;
      });
    };
    busyRef.current = true;
    setBusy(true);
    mark("installing");
    const forwardFonts = (fonts) => {
      if (mountedRef.current && onFontsRef.current) onFontsRef.current(fonts);
    };
    return installFontFinderFamilies(Array.from(families.values()), null, forwardFonts).then(
      () => {
        mark("installed");
        return true;
      },
      () => {
        mark("found", { failed: true });
        return false;
      }
    ).then((result) => {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
      return result;
    });
  };

  const foundKeys = (targets || [])
    .map((target) => target.key)
    .filter((key) => entries[key] && entries[key].state === "found");
  // No Font FindeR match to offer for this key: the web search takes over
  const isUnmatched = (key) => {
    if (!checked) return false;
    if (!supported || !available) return true;
    const entry = entries[key];
    return !!entry && (entry.state === "none" || entry.state === "error");
  };

  return { available: supported && available, entries, busy, install, foundKeys, isUnmatched };
};

export default useFontFinderMatches;
