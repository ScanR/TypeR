// TypeR-UXP.ccx runs on every system, because clients up to 3.0.0 install it on
// any of them (updateLogic.js). It has no keyboard reader on Windows, where the
// reader is the native addon of UXP-Windows.ccx: there, it replaces itself with
// that package of the same version as soon as its panel runs. An installation
// through Creative Cloud swaps the plugin at once; otherwise Photoshop must
// restart. A failure is tried again at the next start.
import React from "react";
import config from "./config";
import { windowsPackageUrl } from "./updateLogic";
import { downloadAndInstallUpdate, getUpdateTestConfig, locale, nativeAlert } from "./utils";

export const useUxpPlatformPackage = () => {
  React.useEffect(() => {
    const host = typeof window !== "undefined" ? window.typerUXP : null;
    if (!host) return;
    const testConfig = getUpdateTestConfig();
    const testUrl = testConfig && testConfig.platformPackageUrl;
    (testUrl ? Promise.resolve(true) : host.request("needsPlatformPackage").catch(() => false)).then((needed) => {
      if (!needed) return;
      downloadAndInstallUpdate(
        testUrl || windowsPackageUrl(config.appVersion),
        null,
        ({ reloading }) => {
          if (reloading) return;
          nativeAlert(locale.updateAutoInstalled.replace("{version}", config.appVersion), locale.successTitle, false);
        },
        (error) => {
          console.error("TypeR: Windows package", error);
          nativeAlert(locale.uxpWindowsPackageFailed, locale.errorTitle, true);
        },
        { expectedVersion: config.appVersion }
      );
    });
  }, []);
};
