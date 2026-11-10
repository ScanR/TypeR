export const mergeLocaleBundle = (defaults, automatic, explicit) => Object.assign({}, defaults || {}, automatic || {}, explicit || {});

// The folder to read for an interface language that has none of its own: one
// of the same language. Photoshop's Spanish is "es_ES" or "es_MX" and the
// folder is "es_SP", which an exact match never finds. Null when the language
// has its folder, or when no folder is in that language (English is the
// default file, not a folder).
export const findLocaleFallback = (uiLocale, folders) => {
  const wanted = String(uiLocale || "");
  const language = wanted.slice(0, 2).toLowerCase();
  if (!language || language === "en" || folders.includes(wanted)) return null;
  return folders.find((folder) => folder.slice(0, 2).toLowerCase() === language) || null;
};
