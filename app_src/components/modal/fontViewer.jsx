import { fetchBody } from "../../network";
import React from "react";
import {
  FiCheck,
  FiCheckCircle,
  FiArrowUp,
  FiChevronDown,
  FiChevronUp,
  FiDownload,
  FiGrid,
  FiList,
  FiPlusCircle,
  FiRefreshCw,
  FiSearch,
  FiShuffle,
  FiSliders,
  FiX,
} from "react-icons/fi";
import { getUserFonts, locale, openUrl, refreshUserFonts } from "../../utils";
import { uint8ToBase64 } from "../../updateInstaller";
import { FONT_VIEWER_API_BASE, getDownloadManifest, getFontFamilies, getFontFilters } from "../../fontViewerApi";
import { installFontFiles, isFontInstallSupported } from "../../fontInstaller";
import { shuffleFamilies } from "../../fontViewerRandom";
import FontFinderLogo from "./fontFinderLogo";

import "./fontViewer.scss";

const PER_PAGE = 200;
const RANDOM_BATCH_SIZE = 24;
const DOWNLOAD_CONCURRENCY = 3;
const VIEW_STORAGE_KEY = "typer.fontViewer.compactView";
const SCROLL_STORAGE_KEY = "typer.fontViewer.scrollTop";
const LAST_PREVIEW_STORAGE_KEY = "typer.fontViewer.lastPreview";
const CUSTOM_PREVIEW_STORAGE_KEY = "typer.fontViewer.customPreview";
const INSTALLED_STORAGE_KEY = "typer.fontViewer.installed.v1";
const FAMILIES_SNAPSHOT_KEY = "typer.fontViewer.families.v1";
const FAMILIES_SNAPSHOT_TTL = 7 * 24 * 60 * 60 * 1000;
const ALPHABET = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// One IntersectionObserver shared by every preview card instead of one
// observer per card; entries are routed back through this map.
const visibilityCallbacks = new Map();
let visibilityObserver = null;
const unobserveVisibility = (element) => {
  visibilityCallbacks.delete(element);
  if (!visibilityObserver) return;
  visibilityObserver.unobserve(element);
  if (!visibilityCallbacks.size) {
    visibilityObserver.disconnect();
    visibilityObserver = null;
  }
};
const observeVisibility = (element, callback) => {
  if (typeof window.IntersectionObserver !== "function") {
    callback();
    return () => {};
  }
  if (!visibilityObserver) {
    visibilityObserver = new window.IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const notify = visibilityCallbacks.get(entry.target);
          if (!notify) return;
          unobserveVisibility(entry.target);
          notify();
        });
      },
      { rootMargin: "240px 0px" }
    );
  }
  visibilityCallbacks.set(element, callback);
  visibilityObserver.observe(element);
  return () => unobserveVisibility(element);
};

const readCompactView = () => {
  try {
    return window.localStorage && window.localStorage.getItem(VIEW_STORAGE_KEY) === "1";
  } catch (e) {
    return false;
  }
};

const readInstalledIds = () => {
  try {
    const raw = window.localStorage && window.localStorage.getItem(INSTALLED_STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(ids)) return {};
    return ids.reduce((map, id) => {
      map[id] = true;
      return map;
    }, {});
  } catch (e) {
    return {};
  }
};

const readFamiliesSnapshot = () => {
  try {
    const raw = window.localStorage && window.localStorage.getItem(FAMILIES_SNAPSHOT_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !cached.expiresAt || cached.expiresAt <= Date.now()) return null;
    if (!Array.isArray(cached.families) || !cached.families.length || !cached.pagination) return null;
    return cached;
  } catch (e) {
    return null;
  }
};

const storeFamiliesSnapshot = (families, pagination) => {
  try {
    if (window.localStorage) {
      window.localStorage.setItem(
        FAMILIES_SNAPSHOT_KEY,
        JSON.stringify({ expiresAt: Date.now() + FAMILIES_SNAPSHOT_TTL, families, pagination })
      );
    }
  } catch (e) {
    // A full or disabled localStorage only costs the instant reopen.
  }
};

const readStoredScroll = () => {
  try {
    const value = window.localStorage && Number(window.localStorage.getItem(SCROLL_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (e) {
    return 0;
  }
};

const pickRandomPreview = (rawPhrases) => {
  const phrases = String(rawPhrases || "")
    .split("|")
    .map((phrase) => phrase.trim())
    .filter(Boolean);
  if (!phrases.length) return "TypeR Font FindeR";
  let lastPhrase = "";
  try {
    if (window.localStorage) lastPhrase = window.localStorage.getItem(LAST_PREVIEW_STORAGE_KEY) || "";
  } catch (e) {}
  const choices = phrases.length > 1 ? phrases.filter((phrase) => phrase !== lastPhrase) : phrases;
  const phrase = choices[Math.floor(Math.random() * choices.length)] || phrases[0];
  try {
    if (window.localStorage) window.localStorage.setItem(LAST_PREVIEW_STORAGE_KEY, phrase);
  } catch (e) {}
  return phrase;
};

const readPreviewText = () => {
  try {
    const custom = window.localStorage && window.localStorage.getItem(CUSTOM_PREVIEW_STORAGE_KEY);
    if (custom && custom.trim()) return custom;
  } catch (e) {}
  return pickRandomPreview(locale.fontViewerPreviewDefault);
};

const getFamilyLetter = (familyName) => {
  const normalized = String(familyName || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const letter = normalized.charAt(0).toUpperCase();
  return /^[A-Z]$/.test(letter) ? letter : "#";
};

const uniqueById = (items) => {
  const seen = new Set();
  return (items || []).filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const normalizeFontName = (value) => String(value || "")
  .toLowerCase()
  .replace(/(\.(otf|ttf|ttc|woff2?))+$/i, "")
  .replace(/[^a-z0-9]/g, "");

const getInstalledFontNames = (fonts) => {
  const names = new Set();
  (fonts || []).forEach((font) => {
    [font.name, font.postScriptName, `${font.family || ""}${font.style || ""}`].forEach((name) => {
      const normalized = normalizeFontName(name);
      if (normalized) names.add(normalized);
    });
  });
  return names;
};

const isFontInstalled = (font, installedIds, installedNames) => {
  if (!font) return false;
  if (installedIds[font.id]) return true;
  return [font.name, font.file_name].some((name) => installedNames.has(normalizeFontName(name)));
};

const sortFamilies = (families, sort) => {
  const copy = (families || []).slice();
  if (sort === "recent") {
    return copy.sort((a, b) => {
      const bTime = b.newest_upload ? Date.parse(b.newest_upload) || 0 : 0;
      const aTime = a.newest_upload ? Date.parse(a.newest_upload) || 0 : 0;
      return bTime - aTime || String(a.family).localeCompare(String(b.family));
    });
  }
  return copy.sort((a, b) => String(a.family).localeCompare(String(b.family)));
};

const safeFileName = (name, fallback = "font") => {
  const clean = String(name || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return clean || fallback;
};

const makeUniqueFileNames = (fonts) => {
  const used = new Set();
  return (fonts || []).map((font) => {
    const original = safeFileName(font.file_name, `${font.name || font.id}.otf`);
    const dot = original.lastIndexOf(".");
    const stem = dot > 0 ? original.slice(0, dot) : original;
    const ext = dot > 0 ? original.slice(dot) : "";
    let name = original;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix += 1) name = `${stem}-${suffix}${ext}`;
    used.add(name.toLowerCase());
    return { ...font, saveName: name };
  });
};

const fetchWithConcurrency = async (items, worker, limit = DOWNLOAD_CONCURRENCY) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const LazyFontPreview = ({ font, text, uppercase }) => {
  const ref = React.useRef(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setReady(false);
    const element = ref.current;
    if (!element) {
      setReady(true);
      return undefined;
    }
    return observeVisibility(element, () => setReady(true));
  }, [font.id]);

  const fontFamily = `TypeRRemoteFont${font.id}`;
  const previewUrl = `${FONT_VIEWER_API_BASE}/fonts/${Number(font.id)}/file`;
  return (
    <div ref={ref} className="font-viewer-card-preview">
      {ready && (
        <style>{`@font-face{font-family:"${fontFamily}";src:url("${previewUrl}");font-display:swap;}`}</style>
      )}
      <span style={ready ? { fontFamily: `"${fontFamily}"` } : null}>
        {uppercase ? String(text).toUpperCase() : text}
      </span>
    </div>
  );
};

// Memoized so typing in the toolbar, scroll-driven letter highlighting and
// download progress updates only re-render the cards whose props changed.
const FontCard = React.memo(({ family, letter, letterStart, previewText, uppercase, selected, installed, installSupported, tagDescriptions, onToggleSelected, onDownload, onInstall }) => {
  const fallback = family.fonts.find((font) => font.id === family.default_font_id) || family.fonts[0];
  const [activeFontId, setActiveFontId] = React.useState(fallback.id);
  const activeFont = family.fonts.find((font) => font.id === activeFontId) || fallback;
  const isSelected = !!selected[activeFont.id];
  const isInstalled = !!installed[activeFont.id];
  const chips = (family.tags || [])
    .map((value) => ({ type: "tag", value, description: tagDescriptions[value] || "" }))
    .concat((family.genres || []).map((value) => ({ type: "genre", value, description: "" })))
    .slice(0, 5);

  return (
    <article
      className={`font-viewer-card${isSelected ? " m-selected" : ""}`}
      data-font-letter={letter}
      data-font-letter-start={letterStart ? letter : null}
    >
      <div className="font-viewer-card-head">
        <label className="font-viewer-select" title={locale.fontViewerSelectFont}>
          <input
            type="checkbox"
            checked={isSelected}
            aria-label={locale.fontViewerSelectFont}
            onChange={() => onToggleSelected(activeFont, family)}
          />
          <span>{isSelected ? <FiCheck size={11} /> : null}</span>
        </label>
        <div className="font-viewer-card-title">
          <strong title={family.family}>{family.family}</strong>
          <small>{(family.styles || []).join(" · ") || locale.fontViewerUncategorized}</small>
        </div>
        <button
          type="button"
          className="font-viewer-icon-button"
          title={locale.fontViewerDownloadOne}
          aria-label={locale.fontViewerDownloadOne}
          onClick={() => onDownload([activeFont])}
        >
          <FiDownload size={15} />
        </button>
        {installSupported && (
          <button
            type="button"
            className={`font-viewer-icon-button${isInstalled ? " m-installed" : ""}`}
            title={isInstalled ? locale.fontViewerInstalledBadge : locale.fontViewerInstallOne}
            aria-label={isInstalled ? locale.fontViewerInstalledBadge : locale.fontViewerInstallOne}
            onClick={() => onInstall([activeFont])}
          >
            {isInstalled ? <FiCheckCircle size={15} /> : <FiPlusCircle size={15} />}
          </button>
        )}
      </div>
      <div className="font-viewer-chips">
        {chips.map((chip) => (
          <span key={`${chip.type}-${chip.value}`} title={chip.description || null}>{chip.value}</span>
        ))}
      </div>
      <LazyFontPreview font={activeFont} text={previewText} uppercase={uppercase} />
      <div className="font-viewer-card-foot">
        {family.fonts.length > 1 ? (
          <select
            value={activeFont.id}
            onChange={(event) => setActiveFontId(Number(event.target.value))}
            className="font-viewer-variant-select"
            title={locale.fontViewerVariant}
          >
            {family.fonts.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}
          </select>
        ) : (
          <span className="font-viewer-variant-name" title={activeFont.name}>{activeFont.name}</span>
        )}
        <span>{family.fonts.length === 1
          ? locale.fontViewerOneVariant
          : locale.fontViewerVariants.replace("{count}", family.fonts.length)}</span>
      </div>
    </article>
  );
});

const FilterGroup = ({ label, values, counts, descriptions = {}, selected, onToggle }) => {
  const [open, setOpen] = React.useState(false);
  if (!values || !values.length) return null;
  return (
    <div className={`font-viewer-filter-group${open ? " m-open" : ""}`}>
      <button type="button" className="font-viewer-filter-toggle" onClick={() => setOpen((value) => !value)}>
        <span>{label}</span>
        {!!selected.length && <b>{selected.length}</b>}
        {open ? <FiChevronUp size={13} /> : <FiChevronDown size={13} />}
      </button>
      {open && (
        <div className="font-viewer-filter-options">
          {values.map((value) => (
            <button
              type="button"
              key={value}
              className={selected.includes(value) ? "m-active" : ""}
              title={descriptions[value] || null}
              onClick={() => onToggle(value)}
            >
              {value}<small>{counts && counts[value] !== undefined ? counts[value] : ""}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const FontViewer = () => {
  const [searchInput, setSearchInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [previewText, setPreviewText] = React.useState(readPreviewText);
  const [uppercase, setUppercase] = React.useState(false);
  const [compactView, setCompactView] = React.useState(readCompactView);
  const [sort, setSort] = React.useState("name");
  const [randomSeed, setRandomSeed] = React.useState(() => Date.now() >>> 0);
  const [randomOffset, setRandomOffset] = React.useState(0);
  const [randomLoading, setRandomLoading] = React.useState(false);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [filterData, setFilterData] = React.useState(null);
  const [filterError, setFilterError] = React.useState(false);
  const [selectedFilters, setSelectedFilters] = React.useState({ tags: [], genres: [], styles: [], collections: [] });
  const [hideInstalled, setHideInstalled] = React.useState(false);
  const [showOnlyInstalled, setShowOnlyInstalled] = React.useState(false);
  const [page, setPage] = React.useState(1);
  // Last default first page (no query, no filters), persisted so reopening the
  // viewer paints instantly while a fresh request revalidates in background.
  const [initialSnapshot] = React.useState(readFamiliesSnapshot);
  const [families, setFamilies] = React.useState(() => (initialSnapshot ? initialSnapshot.families : []));
  const [pagination, setPagination] = React.useState(() => (initialSnapshot ? initialSnapshot.pagination : { total: 0, has_more: false }));
  const [loading, setLoading] = React.useState(!initialSnapshot);
  const [error, setError] = React.useState("");
  const [retryToken, setRetryToken] = React.useState(0);
  const [alphabetLoading, setAlphabetLoading] = React.useState(false);
  const [pendingLetter, setPendingLetter] = React.useState(null);
  const [selected, setSelected] = React.useState({});
  const [installed, setInstalled] = React.useState(readInstalledIds);
  const [systemFonts, setSystemFonts] = React.useState(getUserFonts);
  const [currentLetter, setCurrentLetter] = React.useState(null);
  const [downloadState, setDownloadState] = React.useState({ busy: false, message: "", error: false });
  const installSupported = React.useMemo(isFontInstallSupported, []);
  const requestId = React.useRef(0);
  const mounted = React.useRef(true);
  const snapshotSilenceRef = React.useRef(!!initialSnapshot);
  const downloadBusyRef = React.useRef(false);
  const viewerRef = React.useRef(null);
  const scrollRestored = React.useRef(false);
  const rememberedScroll = React.useRef(readStoredScroll());
  const requestSignatureRef = React.useRef("");
  const randomPageKeysRef = React.useRef(new Set());

  React.useEffect(() => {
    mounted.current = true;
    const viewer = viewerRef.current;
    const scrollRoot = viewer && viewer.closest(".app-modal-body");
    const rememberPosition = () => {
      if (scrollRoot) rememberedScroll.current = Math.max(0, scrollRoot.scrollTop || 0);
    };
    if (scrollRoot) scrollRoot.addEventListener("scroll", rememberPosition, { passive: true });
    return () => {
      rememberPosition();
      try {
        if (window.localStorage) window.localStorage.setItem(SCROLL_STORAGE_KEY, String(rememberedScroll.current));
      } catch (e) {
        // Losing a remembered position must not block the viewer from closing.
      }
      if (scrollRoot) scrollRoot.removeEventListener("scroll", rememberPosition);
      mounted.current = false;
    };
  }, []);

  React.useEffect(() => {
    try {
      if (window.localStorage) window.localStorage.setItem(VIEW_STORAGE_KEY, compactView ? "1" : "0");
    } catch (e) {
      // The layout still works when CEP storage is unavailable.
    }
  }, [compactView]);

  React.useEffect(() => {
    try {
      if (window.localStorage) window.localStorage.setItem(INSTALLED_STORAGE_KEY, JSON.stringify(Object.keys(installed)));
    } catch (e) {
      // The installed badges are a convenience; losing them is harmless.
    }
  }, [installed]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setQuery(searchInput.trim());
    }, 450);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadFilters = React.useCallback(() => {
    setFilterError(false);
    getFontFilters()
      .then((data) => {
        if (mounted.current) setFilterData(data);
      })
      .catch(() => {
        if (mounted.current) setFilterError(true);
      });
  }, []);

  React.useEffect(loadFilters, [loadFilters]);

  React.useEffect(() => {
    refreshUserFonts(setSystemFonts);
  }, []);

  const requestSignature = JSON.stringify({ query, selectedFilters });
  requestSignatureRef.current = requestSignature;
  React.useEffect(() => {
    setRandomOffset(0);
  }, [requestSignature]);
  React.useEffect(() => {
    let active = true;
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    const isDefaultRequest = page === 1 && !query
      && !selectedFilters.tags.length && !selectedFilters.genres.length
      && !selectedFilters.styles.length && !selectedFilters.collections.length;
    // The first request over a restored snapshot revalidates silently: the
    // cached cards stay interactive instead of flashing skeletons.
    const silent = snapshotSilenceRef.current && isDefaultRequest;
    if (!silent) {
      snapshotSilenceRef.current = false;
      setLoading(true);
    }
    setError("");
    getFontFamilies({
      page,
      perPage: PER_PAGE,
      q: query,
      tags: selectedFilters.tags,
      genres: selectedFilters.genres,
      styles: selectedFilters.styles,
      collections: selectedFilters.collections,
    }).then((data) => {
      if (!active || requestId.current !== currentRequest) return;
      snapshotSilenceRef.current = false;
      const nextPagination = data.pagination || { total: 0, has_more: false };
      setFamilies((current) => page === 1 ? data.families : uniqueById(current.concat(data.families)));
      setPagination(nextPagination);
      setLoading(false);
      if (isDefaultRequest) storeFamiliesSnapshot(data.families, nextPagination);
    }).catch((requestError) => {
      if (!active || requestId.current !== currentRequest) return;
      snapshotSilenceRef.current = false;
      // A failed silent revalidation keeps the cached list browsable instead
      // of replacing it with the error screen.
      if (!silent) setError(requestError && requestError.message === "rateLimited" ? "rateLimited" : "requestFailed");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [page, requestSignature, retryToken]);

  const toggleFilter = (group, value) => {
    setPage(1);
    setSelectedFilters((current) => ({
      ...current,
      [group]: current[group].includes(value)
        ? current[group].filter((item) => item !== value)
        : current[group].concat([value]),
    }));
  };

  const activeFilterCount = Object.values(selectedFilters).reduce((sum, values) => sum + values.length, 0)
    + (hideInstalled ? 1 : 0)
    + (showOnlyInstalled ? 1 : 0);
  const clearFilters = () => {
    setPage(1);
    setSelectedFilters({ tags: [], genres: [], styles: [], collections: [] });
    setHideInstalled(false);
    setShowOnlyInstalled(false);
  };

  const changePreviewText = (event) => {
    const value = event.target.value;
    if (value.trim()) {
      setPreviewText(value);
      try {
        if (window.localStorage) window.localStorage.setItem(CUSTOM_PREVIEW_STORAGE_KEY, value);
      } catch (e) {}
      return;
    }
    try {
      if (window.localStorage) window.localStorage.removeItem(CUSTOM_PREVIEW_STORAGE_KEY);
    } catch (e) {}
    setPreviewText(pickRandomPreview(locale.fontViewerPreviewDefault));
  };

  const toggleSelected = React.useCallback((font, family) => {
    setSelected((current) => {
      const next = { ...current };
      if (next[font.id]) delete next[font.id];
      else next[font.id] = { ...font, family: family.family, familyFonts: family.fonts };
      return next;
    });
  }, []);

  // Shared by download and install: resolves the original files for the given
  // fonts and fetches their bytes with progress feedback.
  const fetchFontFiles = React.useCallback(async (fonts) => {
    let manifestFonts;
    if (fonts.length === 1) {
      const font = fonts[0];
      manifestFonts = [{ ...font, download_url: `${FONT_VIEWER_API_BASE}/fonts/${Number(font.id)}/file?original=1` }];
    } else {
      const manifest = await getDownloadManifest(fonts.map((font) => font.id));
      manifestFonts = manifest.fonts || [];
    }
    const namedFonts = makeUniqueFileNames(manifestFonts);
    let completed = 0;
    return fetchWithConcurrency(namedFonts, async (font) => {
      const bytes = new Uint8Array(await fetchBody(font.download_url, { headers: { Accept: "application/octet-stream" } }, "arrayBuffer", 60000));
      completed += 1;
      if (mounted.current) {
        setDownloadState({
          busy: true,
          error: false,
          message: locale.fontViewerDownloading.replace("{current}", completed).replace("{total}", namedFonts.length),
          progress: completed / namedFonts.length,
        });
      }
      return { id: font.id, name: font.saveName, displayName: font.name || font.family || font.saveName, bytes };
    });
  }, []);

  const downloadFonts = React.useCallback(async (fonts) => {
    if (!fonts.length || downloadBusyRef.current) return;
    const single = fonts.length === 1;
    const suggestedName = single ? safeFileName(fonts[0].file_name, `${fonts[0].name}.otf`) : "TypeR-fonts.zip";
    const ext = single && suggestedName.includes(".") ? suggestedName.split(".").pop() : "zip";
    const pathSelect = window.cep.fs.showSaveDialogEx(false, false, [ext], suggestedName);
    if (!pathSelect || !pathSelect.data) return;

    downloadBusyRef.current = true;
    setDownloadState({ busy: true, message: locale.fontViewerPreparing, error: false });
    try {
      const files = await fetchFontFiles(fonts);
      let output = files[0].bytes;
      if (!single) {
        const { zipSync } = await import("fflate");
        const archive = {};
        files.forEach((file) => { archive[file.name] = file.bytes; });
        output = zipSync(archive, { level: 6 });
      }
      const writeResult = window.cep.fs.writeFile(pathSelect.data, uint8ToBase64(output), window.cep.encoding.Base64);
      if (writeResult && writeResult.err) throw new Error("writeFailed");
      if (mounted.current) {
        setDownloadState({
          busy: false,
          error: false,
          message: locale.fontViewerSaved.replace("{count}", files.length),
        });
      }
    } catch (downloadError) {
      if (mounted.current) setDownloadState({ busy: false, error: true, message: locale.fontViewerDownloadError });
    } finally {
      downloadBusyRef.current = false;
    }
  }, [fetchFontFiles]);

  const installFonts = React.useCallback(async (fonts) => {
    const familyFonts = uniqueById(fonts.reduce((allFonts, font) => {
      const family = families.find((item) => (item.fonts || []).some((variant) => variant.id === font.id));
      return allFonts.concat(family ? family.fonts : (font.familyFonts || [font]));
    }, []));
    if (!familyFonts.length || downloadBusyRef.current || !installSupported) return;
    downloadBusyRef.current = true;
    setDownloadState({ busy: true, message: locale.fontViewerPreparing, error: false });
    try {
      const files = await fetchFontFiles(familyFonts);
      if (mounted.current) setDownloadState({ busy: true, error: false, message: locale.fontViewerInstalling });
      await installFontFiles(files.map((file) => ({ saveName: file.name, displayName: file.displayName, bytes: file.bytes })));
      if (mounted.current) {
        setInstalled((current) => {
          const next = { ...current };
          files.forEach((file) => { next[file.id] = true; });
          return next;
        });
        setDownloadState({ busy: false, error: false, message: locale.fontViewerInstalled.replace("{count}", files.length) });
      }
      // The files are fully registered at this point; ask Photoshop to rescan
      // its font list (app.refreshFonts) so the new fonts appear without a
      // restart, with one delayed backstop (one-shot, not a recurring
      // re-enumeration).
      window.setTimeout(() => refreshUserFonts(null, true), 1500);
      window.setTimeout(() => refreshUserFonts(null, true), 10000);
    } catch (installError) {
      if (mounted.current) setDownloadState({ busy: false, error: true, message: locale.fontViewerInstallError });
    } finally {
      downloadBusyRef.current = false;
    }
  }, [families, fetchFontFiles, installSupported]);

  const selectedFonts = Object.values(selected);
  const installedFontNames = React.useMemo(() => getInstalledFontNames(systemFonts), [systemFonts]);
  const effectiveInstalled = React.useMemo(() => {
    const next = { ...installed };
    families.forEach((family) => {
      (family.fonts || []).forEach((font) => {
        if (isFontInstalled(font, installed, installedFontNames)) next[font.id] = true;
      });
    });
    return next;
  }, [families, installed, installedFontNames]);
  const availableFamilies = React.useMemo(
    () => families
      .filter((family) => family && family.fonts && family.fonts.length)
      .map((family) => {
        if (!hideInstalled && !showOnlyInstalled) return family;
        const fonts = family.fonts.filter((font) => (
          hideInstalled ? !effectiveInstalled[font.id] : effectiveInstalled[font.id]
        ));
        if (!fonts.length) return null;
        return {
          ...family,
          fonts,
          default_font_id: fonts.some((font) => font.id === family.default_font_id)
            ? family.default_font_id
            : fonts[0].id,
        };
      })
      .filter(Boolean),
    [families, hideInstalled, showOnlyInstalled, effectiveInstalled]
  );
  const visibleFamilies = React.useMemo(() => {
    if (sort !== "random") return sortFamilies(availableFamilies, sort);
    return shuffleFamilies(availableFamilies, randomSeed).slice(randomOffset, randomOffset + RANDOM_BATCH_SIZE);
  }, [availableFamilies, sort, randomSeed, randomOffset]);
  const availableLetters = React.useMemo(
    () => new Set(visibleFamilies.map((family) => getFamilyLetter(family.family))),
    [visibleFamilies]
  );
  const allFamiliesLoaded = !!pagination.total && families.length >= pagination.total;

  React.useEffect(() => {
    if (scrollRestored.current || loading || !viewerRef.current) return;
    const scrollRoot = viewerRef.current.closest(".app-modal-body");
    if (!scrollRoot) return;
    window.requestAnimationFrame(() => {
      if (!mounted.current) return;
      scrollRoot.scrollTop = Math.min(rememberedScroll.current, Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight));
      scrollRestored.current = true;
    });
  }, [loading, visibleFamilies.length]);

  React.useEffect(() => {
    if (!pendingLetter || !viewerRef.current) return;
    const target = viewerRef.current.querySelector(`[data-font-letter="${pendingLetter}"]`);
    if (!target) return;
    window.requestAnimationFrame(() => {
      if (!mounted.current) return;
      if (target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingLetter(null);
    });
  }, [pendingLetter, visibleFamilies, sort]);

  // Highlights the letter of the section currently in view. Only the first
  // card of each letter carries the anchor attribute, so a pass touches at
  // most 27 elements per animation frame while scrolling.
  React.useEffect(() => {
    const viewer = viewerRef.current;
    const scrollRoot = viewer && viewer.closest(".app-modal-body");
    if (!scrollRoot || sort !== "name" || !visibleFamilies.length) {
      setCurrentLetter(null);
      return undefined;
    }
    let frame = null;
    const update = () => {
      frame = null;
      if (!mounted.current || !viewerRef.current) return;
      const anchors = viewerRef.current.querySelectorAll("[data-font-letter-start]");
      if (!anchors.length) return;
      const threshold = scrollRoot.getBoundingClientRect().top + 48;
      let letter = anchors[0].getAttribute("data-font-letter-start");
      anchors.forEach((anchor) => {
        if (anchor.getBoundingClientRect().top <= threshold) letter = anchor.getAttribute("data-font-letter-start");
      });
      setCurrentLetter(letter);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    scrollRoot.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollRoot.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [sort, visibleFamilies]);

  const goToLetter = async (letter) => {
    if (alphabetLoading) return;
    setSort("name");
    if (availableLetters.has(letter)) {
      setPendingLetter(letter);
      return;
    }
    if (!pagination.has_more) return;

    const signature = requestSignature;
    const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / PER_PAGE));
    const firstMissingPage = Math.max(2, (pagination.page || page) + 1);
    const pages = [];
    for (let nextPage = firstMissingPage; nextPage <= totalPages; nextPage += 1) pages.push(nextPage);
    if (!pages.length) return;

    setAlphabetLoading(true);
    try {
      const responses = await fetchWithConcurrency(
        pages,
        (nextPage) => getFontFamilies({
          page: nextPage,
          perPage: PER_PAGE,
          q: query,
          tags: selectedFilters.tags,
          genres: selectedFilters.genres,
          styles: selectedFilters.styles,
          collections: selectedFilters.collections,
        }),
        2
      );
      if (!mounted.current || requestSignatureRef.current !== signature) return;
      const combined = uniqueById(families.concat(...responses.map((response) => response.families || [])));
      setFamilies(combined);
      setPagination((current) => ({ ...current, page: totalPages, has_more: false }));
      if (combined.some((family) => getFamilyLetter(family.family) === letter)) setPendingLetter(letter);
    } catch (alphabetError) {
      if (mounted.current) {
        setError(alphabetError && alphabetError.message === "rateLimited" ? "rateLimited" : "requestFailed");
      }
    } finally {
      if (mounted.current) setAlphabetLoading(false);
    }
  };

  const scrollToTop = () => {
    const scrollRoot = viewerRef.current && viewerRef.current.closest(".app-modal-body");
    if (!scrollRoot) return;
    if (scrollRoot.scrollTo) scrollRoot.scrollTo({ top: 0, behavior: "smooth" });
    else scrollRoot.scrollTop = 0;
  };

  const getRandomPageCandidates = () => {
    const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / PER_PAGE));
    const sequentialPages = Math.max(1, Number(pagination.page) || page || 1);
    const candidates = [];
    for (let randomPage = sequentialPages + 1; randomPage <= totalPages; randomPage += 1) {
      const key = `${requestSignature}:${randomPage}`;
      if (!randomPageKeysRef.current.has(key)) candidates.push({ key, page: randomPage });
    }
    return candidates;
  };

  const shuffleLoadedFonts = async () => {
    if (randomLoading) return;
    const availableCount = availableFamilies.length;
    const nextOffset = sort === "random" ? randomOffset + RANDOM_BATCH_SIZE : 0;
    if (sort === "random" && nextOffset < availableCount) {
      setRandomOffset(nextOffset);
      scrollToTop();
      return;
    }

    setSort("random");
    setRandomOffset(0);
    setRandomSeed((current) => (current + 0x9e3779b9) >>> 0);
    scrollToTop();

    // Fetch one unseen catalogue page only when starting Random or after the
    // local reservoir has been consumed. Each page then powers several clicks.
    const candidates = getRandomPageCandidates();
    if (!candidates.length) return;

    const candidate = candidates[Math.floor(Math.random() * candidates.length)];
    randomPageKeysRef.current.add(candidate.key);
    setRandomLoading(true);
    try {
      const data = await getFontFamilies({
        page: candidate.page,
        perPage: PER_PAGE,
        q: query,
        tags: selectedFilters.tags,
        genres: selectedFilters.genres,
        styles: selectedFilters.styles,
        collections: selectedFilters.collections,
      });
      if (mounted.current && requestSignatureRef.current === requestSignature) {
        setFamilies((current) => uniqueById(current.concat(data.families || [])));
      }
    } catch (randomError) {
      // The already loaded reservoir still provides a useful Random mode.
      // Forget failed pages so a later batch can retry through the API cache.
      randomPageKeysRef.current.delete(candidate.key);
    } finally {
      if (mounted.current) setRandomLoading(false);
    }
  };

  const canLoadMore = sort === "random"
    ? randomOffset + RANDOM_BATCH_SIZE < availableFamilies.length || getRandomPageCandidates().length > 0
    : pagination.has_more;
  const loadMoreFonts = () => {
    if (sort === "random") {
      shuffleLoadedFonts();
      return;
    }
    setPage((value) => value + 1);
  };

  return (
    <div ref={viewerRef} className={`font-viewer${compactView ? " m-compact" : ""}`}>
      <div className="font-viewer-intro">
        <div>
          <h2><FontFinderLogo size={20} /> {locale.fontViewerTitle}</h2>
          <p>{locale.fontViewerIntro}</p>
        </div>
        <div className="font-viewer-credit-block">
          <button type="button" className="font-viewer-credit" onClick={() => openUrl("https://tools.carbonscans.com/fonts")}>Carbon Scans ↗</button>
          <span>{locale.fontViewerCreditBy}</span>
        </div>
      </div>

      <div className="font-viewer-toolbar">
        <label className="font-viewer-search">
          <FiSearch size={14} />
          <input
            type="search"
            aria-label={locale.fontViewerSearch}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              setPage(1);
              setQuery(searchInput.trim());
            }}
            placeholder={locale.fontViewerSearch}
          />
          {!!searchInput && <button type="button" title={locale.fontViewerClearSearch} onClick={() => setSearchInput("")}><FiX size={13} /></button>}
        </label>
        <input
          className="font-viewer-preview-input"
          aria-label={locale.fontViewerPreviewPlaceholder}
          value={previewText}
          onChange={changePreviewText}
          placeholder={locale.fontViewerPreviewPlaceholder}
        />
        <button
          type="button"
          className={`font-viewer-uppercase${uppercase ? " m-active" : ""}`}
          onClick={() => setUppercase((value) => !value)}
          title={locale.fontViewerUppercase}
        >
          AA
        </button>
      </div>

      <div className="font-viewer-controls">
        <button type="button" className={`font-viewer-filters-button${filtersOpen ? " m-active" : ""}`} onClick={() => setFiltersOpen((value) => !value)}>
          <FiSliders size={13} /> {locale.fontViewerFilters}
          {!!activeFilterCount && <b>{activeFilterCount}</b>}
        </button>
        <select value={sort} onChange={(event) => setSort(event.target.value)} title={locale.fontViewerSort}>
          <option value="name">{locale.fontViewerSortName}</option>
          <option value="recent">{locale.fontViewerSortRecent}</option>
          {sort === "random" && <option value="random">{locale.fontViewerRandom}</option>}
        </select>
        <button
          type="button"
          className={`font-viewer-random-button${sort === "random" ? " m-active" : ""}`}
          disabled={!visibleFamilies.length || loading || alphabetLoading || randomLoading}
          onClick={shuffleLoadedFonts}
          title={locale.fontViewerRandomHint}
          aria-label={locale.fontViewerRandomHint}
          aria-pressed={sort === "random"}
        >
          {randomLoading ? <i className="font-viewer-spinner" /> : <FiShuffle size={13} />} {locale.fontViewerRandom}
        </button>
        <button
          type="button"
          className="font-viewer-view-toggle"
          onClick={() => setCompactView((value) => !value)}
          title={compactView ? locale.fontViewerComfortableView : locale.fontViewerCompactView}
          aria-label={compactView ? locale.fontViewerComfortableView : locale.fontViewerCompactView}
        >
          {compactView ? <FiList size={13} /> : <FiGrid size={13} />}
          <span>{compactView ? locale.fontViewerComfortableView : locale.fontViewerCompactView}</span>
        </button>
        <span className="font-viewer-result-count">
          {locale.fontViewerResults.replace("{count}", pagination.total || 0)}
        </span>
      </div>

      {filtersOpen && (
        <div className="font-viewer-filter-panel">
          <button
            type="button"
            className={`font-viewer-availability-filter${hideInstalled ? " m-active" : ""}`}
            onClick={() => {
              setHideInstalled((value) => !value);
              setShowOnlyInstalled(false);
            }}
            aria-pressed={hideInstalled}
          >
            <span className="font-viewer-filter-check">{hideInstalled ? <FiCheck size={11} /> : null}</span>
            {locale.fontViewerHideInstalled}
          </button>
          <button
            type="button"
            className={`font-viewer-availability-filter${showOnlyInstalled ? " m-active" : ""}`}
            onClick={() => {
              setShowOnlyInstalled((value) => !value);
              setHideInstalled(false);
            }}
            aria-pressed={showOnlyInstalled}
          >
            <span className="font-viewer-filter-check">{showOnlyInstalled ? <FiCheck size={11} /> : null}</span>
            {locale.fontViewerShowOnlyInstalled}
          </button>
          {filterError ? (
            <button type="button" className="font-viewer-retry" onClick={loadFilters}><FiRefreshCw size={13} /> {locale.fontViewerRetryFilters}</button>
          ) : !filterData ? (
            <div className="font-viewer-filter-loading">{locale.fontViewerLoadingFilters}</div>
          ) : (
            <React.Fragment>
              <FilterGroup label={locale.fontViewerStyles} values={filterData.styles} counts={filterData.style_counts} selected={selectedFilters.styles} onToggle={(value) => toggleFilter("styles", value)} />
              <FilterGroup label={locale.fontViewerTags} values={filterData.tags} counts={filterData.tag_counts} descriptions={filterData.tag_descriptions} selected={selectedFilters.tags} onToggle={(value) => toggleFilter("tags", value)} />
              <FilterGroup label={locale.fontViewerGenres} values={filterData.genres} counts={filterData.genre_counts} selected={selectedFilters.genres} onToggle={(value) => toggleFilter("genres", value)} />
              <FilterGroup label={locale.fontViewerCollections} values={filterData.collections} counts={filterData.collection_counts} selected={selectedFilters.collections} onToggle={(value) => toggleFilter("collections", value)} />
            </React.Fragment>
          )}
          {!!activeFilterCount && <button type="button" className="font-viewer-clear-filters" onClick={clearFilters}><FiX size={12} /> {locale.fontViewerClearFilters}</button>}
        </div>
      )}

      {sort === "name" && !!visibleFamilies.length && (
        <nav className="font-viewer-alphabet" aria-label={locale.fontViewerAlphabetNav} aria-busy={alphabetLoading}>
          <button
            type="button"
            className="font-viewer-back-to-top"
            onClick={scrollToTop}
            title={locale.fontViewerBackToTop}
            aria-label={locale.fontViewerBackToTop}
          >
            <FiArrowUp size={12} />
          </button>
          {ALPHABET.map((letter) => (
            <button
              type="button"
              key={letter}
              className={letter === currentLetter ? "m-current" : ""}
              disabled={alphabetLoading || (allFamiliesLoaded && !availableLetters.has(letter))}
              onClick={() => goToLetter(letter)}
              title={letter === "#" ? locale.fontViewerOtherFonts : letter}
              aria-label={letter === "#" ? locale.fontViewerOtherFonts : letter}
              aria-current={letter === currentLetter ? "true" : undefined}
            >
              {letter}
            </button>
          ))}
          {alphabetLoading && <span><i className="font-viewer-spinner" /> {locale.fontViewerLoadingAlphabet}</span>}
        </nav>
      )}

      {downloadState.message && (
        <div
          className={`font-viewer-status${downloadState.error ? " m-error" : ""}${downloadState.busy ? " m-busy" : ""}`}
          role="status"
          aria-live="polite"
        >
          <div className="font-viewer-status-row">
            {downloadState.message}
            {!downloadState.busy && <button type="button" title={locale.close} onClick={() => setDownloadState({ busy: false, message: "", error: false })}><FiX size={12} /></button>}
          </div>
          {downloadState.busy && (
            <span className="font-viewer-status-track" aria-hidden="true">
              <span
                className={`font-viewer-status-bar${downloadState.progress == null ? " m-indeterminate" : ""}`}
                style={downloadState.progress == null ? null : { width: `${Math.round(downloadState.progress * 100)}%` }}
              />
            </span>
          )}
        </div>
      )}

      {error ? (
        <div className="font-viewer-empty m-error">
          <strong>{error === "rateLimited" ? locale.fontViewerRateLimited : locale.fontViewerLoadError}</strong>
          <button type="button" className="topcoat-button--large" onClick={() => { setPage(1); setRetryToken((value) => value + 1); }}>
            <FiRefreshCw size={13} /> {locale.fontViewerRetry}
          </button>
        </div>
      ) : !loading && !visibleFamilies.length ? (
        <div className="font-viewer-empty"><strong>{locale.fontViewerNoResults}</strong><span>{locale.fontViewerNoResultsHint}</span></div>
      ) : (
        <div className="font-viewer-grid">
          {visibleFamilies.map((family, index) => {
            const letter = getFamilyLetter(family.family);
            const previousLetter = index ? getFamilyLetter(visibleFamilies[index - 1].family) : null;
            return (
              <FontCard
                key={family.id}
                family={family}
                letter={letter}
                letterStart={sort === "name" && letter !== previousLetter}
                previewText={previewText}
                uppercase={uppercase}
                selected={selected}
                installed={effectiveInstalled}
                installSupported={installSupported}
                tagDescriptions={(filterData && filterData.tag_descriptions) || {}}
                onToggleSelected={toggleSelected}
                onDownload={downloadFonts}
                onInstall={installFonts}
              />
            );
          })}
          {loading && new Array(page === 1 ? 6 : 2).fill(null).map((_, index) => <div key={`skeleton-${index}`} className="font-viewer-card m-skeleton" />)}
        </div>
      )}

      {!error && !loading && !!visibleFamilies.length && canLoadMore && (
        <button
          type="button"
          className="font-viewer-load-more"
          disabled={randomLoading || alphabetLoading}
          onClick={loadMoreFonts}
        >
          {randomLoading && <i className="font-viewer-spinner" />} {locale.fontViewerLoadMore}
        </button>
      )}

      {!!selectedFonts.length && (
        <div className="font-viewer-selection-bar">
          <strong>{locale.fontViewerSelected.replace("{count}", selectedFonts.length)}</strong>
          <button type="button" className="font-viewer-text-button" onClick={() => setSelected({})}>{locale.fontViewerClearSelection}</button>
          <button
            type="button"
            className={installSupported ? "topcoat-button--large" : "topcoat-button--large--cta"}
            disabled={downloadState.busy}
            onClick={() => downloadFonts(selectedFonts)}
          >
            <FiDownload size={14} /> {locale.fontViewerDownloadSelected}
          </button>
          {installSupported && (
            <button type="button" className="topcoat-button--large--cta" disabled={downloadState.busy} onClick={() => installFonts(selectedFonts)}>
              <FiPlusCircle size={14} /> {locale.fontViewerInstallSelected}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export { safeFileName, sortFamilies };
export default FontViewer;
