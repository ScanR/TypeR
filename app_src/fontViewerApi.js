import { fetchBody } from "./network";
const FONT_VIEWER_API_BASE = "https://tools.carbonscans.com/fonts/api";
const FILTER_CACHE_KEY = "typer.fontViewer.filters.v2";
const STATUS_CACHE_TTL = 60 * 1000;
const FILTER_CACHE_TTL = 24 * 60 * 60 * 1000;
const FAMILY_CACHE_TTL = 30 * 60 * 1000;

const memoryCache = new Map();
const inFlight = new Map();

const readStoredFilters = () => {
  try {
    const raw = window.localStorage && window.localStorage.getItem(FILTER_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || cached.expiresAt <= Date.now() || !cached.data) return null;
    return cached.data;
  } catch (e) {
    return null;
  }
};

const storeFilters = (data) => {
  try {
    if (window.localStorage) {
      window.localStorage.setItem(
        FILTER_CACHE_KEY,
        JSON.stringify({ expiresAt: Date.now() + FILTER_CACHE_TTL, data })
      );
    }
  } catch (e) {
    // A full or disabled localStorage must never make the viewer unusable.
  }
};

const requestJson = (url, options = {}, ttl = FAMILY_CACHE_TTL, fetchImpl = fetch) => {
  const method = (options.method || "GET").toUpperCase();
  const cacheKey = method === "GET" ? url : null;
  if (cacheKey) {
    const cached = memoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
    if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  }

  const promise = fetchBody(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  }, 'json', 20000, fetchImpl)
    .then((data) => {
      if (!data || data.success === false) throw new Error("invalidResponse");
      if (cacheKey) {
        memoryCache.delete(cacheKey);
        memoryCache.set(cacheKey, { expiresAt: Date.now() + ttl, data });
        while (memoryCache.size > 40) memoryCache.delete(memoryCache.keys().next().value);
      }
      return data;
    })
    .then(
      (data) => {
        if (cacheKey) inFlight.delete(cacheKey);
        return data;
      },
      (error) => {
        if (cacheKey) inFlight.delete(cacheKey);
        throw error;
      }
    );

  if (cacheKey) inFlight.set(cacheKey, promise);
  return promise;
};

const buildFontQuery = ({ page = 1, perPage = 48, q = "", tags = [], genres = [], styles = [], collections = [] } = {}) => {
  const params = [
    ["page", Math.max(1, Number(page) || 1)],
    ["per_page", Math.min(200, Math.max(1, Number(perPage) || 48))],
  ];
  const search = String(q || "").trim();
  if (search) params.push(["q", search]);
  [
    ["tag", tags],
    ["genre", genres],
    ["style", styles],
    ["collection", collections],
  ].forEach(([key, values]) => {
    const clean = (values || [])
      .map((value) => String(value).trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (clean.length) params.push([key, clean.join(",")]);
  });
  return params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
};

const getFontFamilies = (params, fetchImpl) =>
  requestJson(`${FONT_VIEWER_API_BASE}/fonts?${buildFontQuery(params)}`, {}, FAMILY_CACHE_TTL, fetchImpl);

const getFontViewerStatus = (fetchImpl) =>
  requestJson(`${FONT_VIEWER_API_BASE}/status`, {}, STATUS_CACHE_TTL, fetchImpl).then((data) => {
    if (typeof data.enabled !== "boolean") throw new Error("invalidResponse");
    return data;
  });

const getFontFilters = (fetchImpl) => {
  const stored = readStoredFilters();
  if (stored) return Promise.resolve(stored);
  return requestJson(`${FONT_VIEWER_API_BASE}/filters`, {}, FILTER_CACHE_TTL, fetchImpl).then((data) => {
    storeFilters(data);
    return data;
  });
};

const getDownloadManifest = (fontIds, fetchImpl) => {
  const ids = Array.from(new Set((fontIds || []).map(Number).filter((id) => Number.isFinite(id))));
  return requestJson(
    `${FONT_VIEWER_API_BASE}/download`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ font_ids: ids }),
    },
    0,
    fetchImpl
  );
};

const clearFontViewerMemoryCache = () => {
  memoryCache.clear();
  inFlight.clear();
};

export {
  FONT_VIEWER_API_BASE,
  buildFontQuery,
  clearFontViewerMemoryCache,
  getDownloadManifest,
  getFontFamilies,
  getFontFilters,
  getFontViewerStatus,
};
