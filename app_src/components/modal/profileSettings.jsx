import React from "react";
import { FiCheck, FiEdit2, FiPlus, FiTrash2, FiUser } from "react-icons/fi";

import { locale, flushStorageWrite, nativeAlert, nativeConfirm } from "../../utils";
import {
  DEFAULT_PROFILE_ID,
  activateProfile,
  createProfile,
  deleteProfile,
  getProfileRegistry,
  renameProfile,
} from "../../profileStorage";

const ProfileSettings = React.memo(function ProfileSettings({ currentLanguage, hasUnsavedChanges }) {
  const [registry, setRegistry] = React.useState(getProfileRegistry);
  const [selectedId, setSelectedId] = React.useState(registry.activeProfileId);
  const [profileName, setProfileName] = React.useState("");
  const [newProfileName, setNewProfileName] = React.useState("");

  const selectedProfile = registry.profiles.find((profile) => profile.id === selectedId) || registry.profiles[0];
  const activeProfile = registry.profiles.find((profile) => profile.id === registry.activeProfileId) || registry.profiles[0];

  React.useEffect(() => {
    setProfileName(selectedProfile?.name || "");
  }, [selectedProfile?.id, selectedProfile?.name]);

  const refreshRegistry = React.useCallback((preferredId) => {
    const nextRegistry = getProfileRegistry();
    setRegistry(nextRegistry);
    setSelectedId(
      preferredId && nextRegistry.profiles.some((profile) => profile.id === preferredId)
        ? preferredId
        : nextRegistry.activeProfileId
    );
  }, []);

  const showProfileError = React.useCallback((error) => {
    const messages = {
      nameRequired: locale.profilesNameRequired,
      nameExists: locale.profilesNameExists,
      baseProfile: locale.profilesDeleteBase,
      lastProfile: locale.profilesDeleteLast,
      notFound: locale.profilesNotFound,
      storage: locale.profilesStorageError,
    };
    nativeAlert(
      messages[error] || locale.profilesStorageError,
      locale.errorTitle,
      true
    );
  }, []);

  const confirmDiscardIfNeeded = React.useCallback((action) => {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    nativeConfirm(
      locale.profilesSwitchUnsaved,
      locale.confirmTitle,
      (confirmed) => {
        if (confirmed) action();
      }
    );
  }, [hasUnsavedChanges]);

  const switchToProfile = React.useCallback((profileId) => {
    if (!profileId || profileId === registry.activeProfileId) return;
    confirmDiscardIfNeeded(() => {
      if (!flushStorageWrite(true)) { showProfileError("storage"); return; }
      const result = activateProfile(profileId);
      if (!result.ok) {
        showProfileError(result.error);
        return;
      }
      window.location.reload();
    });
  }, [confirmDiscardIfNeeded, registry.activeProfileId, showProfileError]);

  const createAndActivate = React.useCallback(() => {
    const name = newProfileName.trim();
    if (!name) {
      showProfileError("nameRequired");
      return;
    }
    confirmDiscardIfNeeded(() => {
      if (!flushStorageWrite(true)) { showProfileError("storage"); return; }
      const created = createProfile(name, {
        notFirstTime: true,
        language: currentLanguage || "auto",
      });
      if (!created.ok) {
        showProfileError(created.error);
        return;
      }
      const activated = activateProfile(created.profile.id);
      if (!activated.ok) {
        refreshRegistry(created.profile.id);
        showProfileError(activated.error);
        return;
      }
      window.location.reload();
    });
  }, [confirmDiscardIfNeeded, currentLanguage, newProfileName, refreshRegistry, showProfileError]);

  const saveProfileName = React.useCallback(() => {
    if (!selectedProfile) return;
    const result = renameProfile(selectedProfile.id, profileName);
    if (!result.ok) {
      showProfileError(result.error);
      return;
    }
    refreshRegistry(selectedProfile.id);
  }, [profileName, refreshRegistry, selectedProfile, showProfileError]);

  const removeSelectedProfile = React.useCallback(() => {
    if (!selectedProfile) return;
    const message = (locale.profilesDeleteConfirm || "")
      .replace("{name}", selectedProfile.name);
    nativeConfirm(message, locale.confirmTitle, (confirmed) => {
      if (!confirmed) return;
      if (selectedProfile.id === registry.activeProfileId && !flushStorageWrite(true)) { showProfileError("storage"); return; }
      const result = deleteProfile(selectedProfile.id);
      if (!result.ok) {
        showProfileError(result.error);
        return;
      }
      if (result.deletedActive) {
        window.location.reload();
        return;
      }
      refreshRegistry(result.activeProfileId);
    });
  }, [refreshRegistry, registry.activeProfileId, selectedProfile, showProfileError]);

  return (
    <div className="fields profile-settings">
      <div className="settings-group">
        <div className="settings-group-title">{locale.profilesTitle}</div>
        <div className="field-descr">{locale.profilesHint}</div>
        <div className="profile-active-card hostBrdContrast">
          <FiUser size={18} />
          <div>
            <div className="profile-active-label">{locale.profilesActive}</div>
            <strong>{activeProfile?.name}</strong>
          </div>
        </div>
        <div className="profile-list" role="listbox" aria-label={locale.profilesTitle}>
          {registry.profiles.map((profile) => {
            const isActive = profile.id === registry.activeProfileId;
            const isSelected = profile.id === selectedId;
            return (
              <button
                key={profile.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={"profile-list-item hostBrdContrast" + (isSelected ? " m-selected" : "")}
                onClick={() => setSelectedId(profile.id)}
              >
                <span>{profile.name}</span>
                {isActive ? <FiCheck size={15} title={locale.profilesActive} /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{locale.profilesManageTitle}</div>
        <div className="field">
          <div className="field-label">{locale.profilesRenameLabel}</div>
          <div className="profile-inline-actions">
            <input
              type="text"
              value={profileName}
              maxLength={80}
              aria-label={locale.profilesRenameLabel}
              onChange={(event) => setProfileName(event.target.value)}
              className="topcoat-text-input--large"
            />
            <button type="button" className="topcoat-button--large" onClick={saveProfileName}>
              <FiEdit2 size={15} /> {locale.profilesRename}
            </button>
          </div>
        </div>
        <div className="profile-management-actions">
          <button
            type="button"
            className="topcoat-button--large--cta"
            disabled={!selectedProfile || selectedProfile.id === registry.activeProfileId}
            onClick={() => switchToProfile(selectedProfile?.id)}
          >
            <FiCheck size={15} /> {locale.profilesActivate}
          </button>
          <button
            type="button"
            className="topcoat-button--large settings-danger-btn"
            disabled={
              registry.profiles.length <= 1 || selectedProfile?.id === DEFAULT_PROFILE_ID
            }
            onClick={removeSelectedProfile}
          >
            <FiTrash2 size={15} /> {locale.profilesDelete}
          </button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{locale.profilesCreateTitle}</div>
        <div className="field">
          <div className="profile-inline-actions">
            <input
              type="text"
              value={newProfileName}
              maxLength={80}
              placeholder={locale.profilesNamePlaceholder}
              aria-label={locale.profilesNamePlaceholder}
              onChange={(event) => setNewProfileName(event.target.value)}
              className="topcoat-text-input--large"
            />
            <button type="button" className="topcoat-button--large--cta" onClick={createAndActivate}>
              <FiPlus size={15} /> {locale.profilesCreate}
            </button>
          </div>
        </div>
        <div className="field-descr">{locale.profilesCreateHint}</div>
      </div>
    </div>
  );
});

export default ProfileSettings;
