// The panel's language setting, or Photoshop's interface language on "auto"
export const getInterfaceLanguage = (state) => {
  if (state.language && state.language !== "auto") return state.language;
  try {
    return JSON.parse(window.__adobe_cep__.getHostEnvironment()).appUILocale || "";
  } catch (error) {
    return (typeof navigator !== "undefined" && navigator.language) || "";
  }
};

// The panel's layout follows its own language, never the text direction
// setting: an English panel stays left to right while it types Arabic, and an
// Arabic panel stays right to left for a left-to-right script
const RTL_LANGUAGES = ["ar", "fa", "he", "ur"];
export const getInterfaceDirection = (state) => {
  const code = String(getInterfaceLanguage(state) || "").toLowerCase().split(/[_-]/)[0];
  return RTL_LANGUAGES.includes(code) ? "rtl" : "ltr";
};
