// The panel's language setting, or Photoshop's interface language on "auto"
export const getInterfaceLanguage = (state) => {
  if (state.language && state.language !== "auto") return state.language;
  try {
    return JSON.parse(window.__adobe_cep__.getHostEnvironment()).appUILocale || "";
  } catch (error) {
    return (typeof navigator !== "undefined" && navigator.language) || "";
  }
};
