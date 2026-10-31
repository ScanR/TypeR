import { useModalClose } from "../../modalClose";
import React from "react";
import { FiAlertTriangle, FiCheckCircle, FiCpu, FiDownload, FiDownloadCloud, FiInfo, FiRefreshCw, FiX, FiZap } from "react-icons/fi";

import { clearUpdateTestConfig, csInterface, flushStorageWrite, getUpdateTestConfig, locale, openUrl, writeToStorage } from "../../utils";
import { useContext } from "../../context";
import {
  UXP_RELEASE_PAGE, declinedUxpMigration, downloadUxpPackage, getNode, runUxpInstaller, snoozedUxpMigration, syncLegacyPanelName,
} from "../../uxpMigration";

const REASONS = {
  download: () => locale.uxpMigrationReason_download || "the download failed",
  package: () => locale.uxpMigrationReason_package || "the downloaded file is not a TypeR package",
  installer: () => locale.uxpMigrationReason_installer || "the plugin could not be installed",
  node: () => locale.uxpMigrationReason_node || "this panel cannot run the installer",
};

// What the new TypeR brings, shown in the offer
const BENEFITS = [
  { Icon: FiZap, text: () => locale.uxpMigrationBenefitSpeed || "Faster and more responsive" },
  { Icon: FiCpu, text: () => locale.uxpMigrationBenefitSilicon || "Native on Apple Silicon Macs" },
  { Icon: FiDownloadCloud, text: () => locale.uxpMigrationBenefitUpdates || "Installs its own updates" },
];

// Legacy panel only: installs the new TypeR, the UXP plugin, or says where it
// is once installed (app_src/uxpMigration.js)
const UxpMigrationModal = React.memo(function UxpMigrationModal() {
  const context = useContext((state) => ({ modalData: state.modalData }));
  const forced = !!(context.state.modalData && context.state.modalData.forced);
  // offer -> working -> done | error; notice: already installed
  const [phase, setPhase] = React.useState(context.state.modalData && context.state.modalData.notice ? "notice" : "offer");
  const [status, setStatus] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [method, setMethod] = React.useState("");

  const close = () => {
    if (phase === "working") return;
    context.dispatch({ type: "setModal" });
  };
  // Closing the offer without choosing asks again later
  const later = () => {
    if (!forced) writeToStorage({ uxpMigration: snoozedUxpMigration(Date.now()) });
    close();
  };
  const never = () => {
    writeToStorage({ uxpMigration: declinedUxpMigration() });
    close();
  };
  const hideNotice = () => {
    writeToStorage({ uxpInstalledNoticeHidden: true });
    close();
  };
  useModalClose(() => (phase === "offer" || phase === "error" ? later() : close()));

  const install = async () => {
    setPhase("working");
    setStatus(locale.uxpMigrationDownloading || "Downloading the new TypeR...");
    try {
      const testConfig = getUpdateTestConfig();
      const bytes = await downloadUxpPackage(testConfig && testConfig.forceUxpMigration ? testConfig : null);
      setStatus(locale.uxpMigrationInstalling || "Installing the new TypeR...");
      // The new TypeR imports these styles and settings on its first start
      flushStorageWrite(true);
      setMethod(await runUxpInstaller(getNode(), bytes, { forceManual: !!(testConfig && testConfig.forceManualPluginInstall) }));
      syncLegacyPanelName(getNode(), csInterface.getSystemPath(window.SystemPath.EXTENSION));
      writeToStorage({ uxpMigration: { installedAt: Date.now() } });
      if (forced) clearUpdateTestConfig();
      setPhase("done");
    } catch (error) {
      console.error("TypeR UXP installation failed", error);
      setReason((REASONS[error && error.code] || REASONS.installer)());
      setPhase("error");
    }
  };

  const closeLegacy = () => {
    flushStorageWrite(true);
    try {
      csInterface.closeExtension();
    } catch (error) {
      close();
    }
  };

  const header = (
    <div className="app-modal-header hostBrdBotContrast">
      <div className="app-modal-title">
        {phase === "done"
          ? (method === "manual"
            ? (locale.uxpMigrationRestartTitle || "Restart Photoshop to use TypeR")
            : (locale.uxpMigrationDoneTitle || "The new TypeR is installed"))
          : phase === "notice"
            ? (locale.uxpMigrationNoticeTitle || "The new TypeR (UXP) is installed")
            : (locale.uxpMigrationTitle || "Meet the new TypeR (UXP)")}
      </div>
      <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={phase === "done" || phase === "notice" ? close : later} disabled={phase === "working"}>
        <FiX size={18} />
      </button>
    </div>
  );

  if (phase === "notice") {
    return (
      <React.Fragment>
        {header}
        <div className="app-modal-body">
          <div className="app-modal-body-inner article-format uxp-migration">
            <FiInfo size={40} className="uxp-migration-icon" />
            <p>{locale.uxpMigrationNoticeText || "You have opened the old version of TypeR. To open the new version, TypeR (UXP), go to the Plugins > TypeR menu at the top of Photoshop."}</p>
            <p className="uxp-migration-hint">{locale.uxpMigrationDoneHint || "Use one version at a time: changes made in the Legacy version from now on are not copied to the new TypeR."}</p>
            <button type="button" className="uxp-migration-never" onClick={hideNotice}>
              {locale.uxpMigrationNoticeHide || "Don't show again"}
            </button>
          </div>
        </div>
        <div className="app-modal-footer hostBrdTopContrast uxp-migration-footer">
          <button className="topcoat-button--large" onClick={close}>{locale.uxpMigrationNoticeStay || "Continue here"}</button>
          <button className="topcoat-button--large--cta" onClick={closeLegacy}>{locale.uxpMigrationCloseLegacy || "Close the Legacy version"}</button>
        </div>
      </React.Fragment>
    );
  }

  if (phase === "done") {
    return (
      <React.Fragment>
        {header}
        <div className="app-modal-body">
          <div className="app-modal-body-inner article-format uxp-migration">
            <FiCheckCircle size={40} className="uxp-migration-icon m-done" />
            <p className={method === "manual" ? "uxp-migration-lead" : undefined}>
              {method === "manual"
                ? (locale.uxpMigrationDoneRestart || "Restart Photoshop, then open it from the Plugins > TypeR menu. Your styles, profiles and settings are copied over the first time it starts.")
                : (locale.uxpMigrationDoneText || "Open it from the Plugins > TypeR menu. Your styles, profiles and settings are copied over the first time it starts.")}
            </p>
            <p className="uxp-migration-hint">{locale.uxpMigrationDoneHint || "Use one version at a time: changes made in the Legacy version from now on are not copied to the new TypeR."}</p>
          </div>
        </div>
        <div className="app-modal-footer hostBrdTopContrast uxp-migration-footer">
          <button className="topcoat-button--large" onClick={close}>{locale.close}</button>
          <button className="topcoat-button--large--cta" onClick={closeLegacy}>{locale.uxpMigrationCloseLegacy || "Close the Legacy version"}</button>
        </div>
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      {header}
      <div className="app-modal-body">
        <div className="app-modal-body-inner article-format uxp-migration">
          <p className="uxp-migration-lead">{locale.uxpMigrationLead || "Your Photoshop can run it right now:"}</p>
          <ul className="uxp-migration-benefits">
            {BENEFITS.map(({ Icon, text }, index) => (
              <li key={index}>
                <span className="uxp-migration-benefit-icon"><Icon size={15} /></span>
                <span>{text()}</span>
              </li>
            ))}
          </ul>
          <p className="uxp-migration-hint">{locale.uxpMigrationKeepHint || "Your styles, profiles and settings are copied over automatically, and the Legacy version stays installed."}</p>
          {phase === "offer" && (
            <button type="button" className="uxp-migration-never" onClick={never}>
              {locale.uxpMigrationNever || "Don't ask again"}
            </button>
          )}
          {phase === "working" && (
            <div className="uxp-migration-status">
              <FiRefreshCw size={20} className="uxp-migration-spin" />
              <span>{status}</span>
            </div>
          )}
          {phase === "error" && (
            <div className="uxp-migration-status m-error">
              <FiAlertTriangle size={20} />
              <span>{(locale.uxpMigrationError || "The new TypeR could not be installed: {reason}").replace("{reason}", reason)}</span>
            </div>
          )}
        </div>
      </div>
      <div className="app-modal-footer hostBrdTopContrast uxp-migration-footer">
        {phase === "error" && (
          <button className="topcoat-button--large--quiet uxp-migration-left" onClick={() => openUrl(UXP_RELEASE_PAGE)}>
            <FiDownload size={14} /> {locale.uxpMigrationManual || "Download manually"}
          </button>
        )}
        <button className="topcoat-button--large" onClick={later} disabled={phase === "working"}>
          {locale.uxpMigrationLater || "Later"}
        </button>
        <button className="topcoat-button--large--cta" onClick={install} disabled={phase === "working"}>
          {phase === "error" ? (locale.uxpMigrationRetry || "Retry") : (locale.uxpMigrationInstall || "Install the new TypeR")}
        </button>
      </div>
    </React.Fragment>
  );
});

export default UxpMigrationModal;
