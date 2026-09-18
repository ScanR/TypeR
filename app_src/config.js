// CEP, the UXP panel and the Node test loader all evaluate this module, and the
// loader has no window at all: the flag can only be read from a panel, and the
// UXP one installs it before it requires the application.
const uxp = typeof window !== "undefined" && !!window.typerUXP;

const config = {
  // TypeR Silicon is the local UXP build: it must not offer the CEP updater,
  // whose installer would overwrite the plugin's own files with a CEP release.
  appTitle: uxp ? "TypeR Silicon" : "TypeR",
  appVersion: "3.0.0",
  appUrl: "https://typer.hayasaku.fr/",
  typerToolsUrl: "https://swirt.github.io/typertools/",
  authorName: "Sakushi & SeanR",
  authorUrl: "https://discord.gg/dsHn3xQQTC",
  authorName2: "",
  authorUrl2: "",
  exportFileName: "TypeR_Export",
  defaultPrefixColor: "#FFF3B0",
  checkUpdates: !uxp,
  languages: {
    auto: "Auto",
    en_US: "English",
    fr_FR: "Français",
    de_DE: "Deutsch",
    es_SP: "Español",
    pt_BR: "Português (Brasil)",
    ru_RU: "Русский",
    tr_TR: "Türkçe",
    uk_UA: "Українська",
    vi_VN: "Tiếng Việt",
    ar_AE: "العربية",
  },
};

export default config;
