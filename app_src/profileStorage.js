import { readJsonStorage, writeJsonStorage } from "./storageIO";
const PROFILE_REGISTRY_VERSION = 1;
const DEFAULT_PROFILE_ID = "default";
const DEFAULT_PROFILE_NAME = "Default";
const PROFILE_NAME_MAX_LENGTH = 80;
const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

let registryCache = null;
let extensionPathCache = null;

const getExtensionPath = () => {
  if (extensionPathCache) return extensionPathCache;
  const csInterface = new window.CSInterface();
  extensionPathCache = csInterface.getSystemPath(window.SystemPath.EXTENSION);
  return extensionPathCache;
};

const getRegistryPath = () => `${getExtensionPath()}/storage_profiles`;
const getBaseStoragePath = () => `${getExtensionPath()}/storage`;
// Used only to recover installations that briefly used a dedicated file for
// Default before the base profile returned to the legacy-compatible path.
const getPreviousDefaultStoragePath = () =>
  `${getExtensionPath()}/storage_profile_${DEFAULT_PROFILE_ID}`;

const isValidProfileId = (id) => PROFILE_ID_PATTERN.test(String(id || ""));

const getProfileStoragePath = (profileId) => {
  const safeId = isValidProfileId(profileId) ? String(profileId) : DEFAULT_PROFILE_ID;
  if (safeId === DEFAULT_PROFILE_ID) return getBaseStoragePath();
  return `${getExtensionPath()}/storage_profile_${safeId}`;
};

const getProfileAssetPath = (profileId, assetName) => {
  const safeId = isValidProfileId(profileId) ? String(profileId) : DEFAULT_PROFILE_ID;
  const safeAsset = String(assetName || "asset").replace(/[^a-z0-9_-]/gi, "_");
  if (safeId === DEFAULT_PROFILE_ID) {
    return `${getExtensionPath()}/storage_${safeAsset}`;
  }
  return `${getExtensionPath()}/storage_profile_${safeId}_${safeAsset}`;
};

const readJsonFile = (filePath) => readJsonStorage(filePath);
const writeJsonFile = (filePath, data) => writeJsonStorage(filePath, data || {});

const deleteFile = (filePath) => {
  const result = window.cep.fs.deleteFile(filePath);
  if (typeof result === "number") {
    return result === window.cep.fs.NO_ERROR || result === window.cep.fs.ERR_NOT_FOUND;
  }
  return !result || !result.err || result.err === window.cep.fs.ERR_NOT_FOUND;
};

const migrateFile = (sourcePath, destinationPath) => {
  const source = window.cep.fs.readFile(sourcePath);
  if (!source || source.err) return false;
  if (destinationPath.indexOf("background") === -1) {
    try { if (!writeJsonFile(destinationPath, JSON.parse(source.data))) return false; }
    catch (error) { return false; }
  } else {
    const written = window.cep.fs.writeFile(destinationPath, source.data);
    if (written && written.err) return false;
  }
  deleteFile(sourcePath);
  return true;
};

const normalizeProfileName = (name) =>
  String(name || "").trim().slice(0, PROFILE_NAME_MAX_LENGTH);

const normalizeRegistry = (raw) => {
  const sourceProfiles = Array.isArray(raw?.profiles) ? raw.profiles : [];
  const seen = new Set();
  const profiles = [];

  sourceProfiles.forEach((profile) => {
    const id = String(profile?.id || "");
    const name = normalizeProfileName(profile?.name);
    if (!isValidProfileId(id) || !name || seen.has(id)) return;
    seen.add(id);
    profiles.push({ id, name });
  });

  if (!profiles.length) {
    profiles.push({ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME });
  }

  const requestedActiveId = String(raw?.activeProfileId || "");
  const activeProfileId = profiles.some((profile) => profile.id === requestedActiveId)
    ? requestedActiveId
    : profiles[0].id;

  return {
    version: PROFILE_REGISTRY_VERSION,
    activeProfileId,
    profiles,
  };
};

const writeRegistry = (registry) => {
  const normalized = normalizeRegistry(registry);
  if (!writeJsonFile(getRegistryPath(), normalized)) return false;
  registryCache = normalized;
  return true;
};

const ensureProfileRegistry = () => {
  if (registryCache) return registryCache;

  const storedRegistry = readJsonFile(getRegistryPath());
  if (storedRegistry.exists) {
    registryCache = normalizeRegistry(storedRegistry.data);
    if (storedRegistry.error) return registryCache;
    writeJsonFile(getRegistryPath(), registryCache);

    // Migrate back from the short-lived storage_profile_default layout. The
    // dedicated file is preferred because it may contain changes made after
    // the profile feature was installed; once copied, older TypeR versions
    // can read the same Default data from their traditional `storage` file.
    migrateFile(getPreviousDefaultStoragePath(), getBaseStoragePath());
    migrateFile(
      `${getPreviousDefaultStoragePath()}_background`,
      getProfileAssetPath(DEFAULT_PROFILE_ID, "background")
    );

    const activePath = getProfileStoragePath(registryCache.activeProfileId);
    const activeStorage = readJsonFile(activePath);
    if (!activeStorage.exists) {
      writeJsonFile(activePath, {});
    }
    return registryCache;
  }

  const registry = normalizeRegistry({
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME }],
  });
  const baseStorage = readJsonFile(getBaseStoragePath());
  if (!baseStorage.exists) writeJsonFile(getBaseStoragePath(), {});
  writeJsonFile(getRegistryPath(), registry);

  registryCache = registry;
  return registryCache;
};

const getProfileRegistry = () => {
  const registry = ensureProfileRegistry();
  return {
    version: registry.version,
    activeProfileId: registry.activeProfileId,
    profiles: registry.profiles.map((profile) => ({ ...profile })),
  };
};

const getActiveProfileId = () => ensureProfileRegistry().activeProfileId;

const getActiveProfileStoragePath = () => getProfileStoragePath(getActiveProfileId());
const getActiveProfileAssetPath = (assetName) => getProfileAssetPath(getActiveProfileId(), assetName);

const readProfileStorage = (profileId) => {
  const registry = ensureProfileRegistry();
  if (!registry.profiles.some((profile) => profile.id === profileId)) return {};
  return readJsonFile(getProfileStoragePath(profileId)).data;
};

const profileNameExists = (profiles, name, excludedId = null) => {
  const normalizedName = normalizeProfileName(name).toLocaleLowerCase();
  return profiles.some(
    (profile) => profile.id !== excludedId && profile.name.toLocaleLowerCase() === normalizedName
  );
};

const createProfileId = () =>
  `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const createProfile = (name, seedData = {}) => {
  const registry = ensureProfileRegistry();
  const normalizedName = normalizeProfileName(name);
  if (!normalizedName) return { ok: false, error: "nameRequired" };
  if (profileNameExists(registry.profiles, normalizedName)) {
    return { ok: false, error: "nameExists" };
  }

  let id = createProfileId();
  while (registry.profiles.some((profile) => profile.id === id)) id = createProfileId();
  const profile = { id, name: normalizedName };

  if (!writeJsonFile(getProfileStoragePath(id), seedData)) {
    return { ok: false, error: "storage" };
  }

  const nextRegistry = {
    ...registry,
    profiles: registry.profiles.concat(profile),
  };
  if (!writeRegistry(nextRegistry)) {
    deleteFile(getProfileStoragePath(id));
    return { ok: false, error: "storage" };
  }
  return { ok: true, profile };
};

const renameProfile = (profileId, name) => {
  const registry = ensureProfileRegistry();
  const normalizedName = normalizeProfileName(name);
  if (!normalizedName) return { ok: false, error: "nameRequired" };
  if (!registry.profiles.some((profile) => profile.id === profileId)) {
    return { ok: false, error: "notFound" };
  }
  if (profileNameExists(registry.profiles, normalizedName, profileId)) {
    return { ok: false, error: "nameExists" };
  }
  const profiles = registry.profiles.map((profile) =>
    profile.id === profileId ? { ...profile, name: normalizedName } : profile
  );
  if (!writeRegistry({ ...registry, profiles })) {
    return { ok: false, error: "storage" };
  }
  return { ok: true, profile: profiles.find((profile) => profile.id === profileId) };
};

const activateProfile = (profileId) => {
  const registry = ensureProfileRegistry();
  if (!registry.profiles.some((profile) => profile.id === profileId)) {
    return { ok: false, error: "notFound" };
  }
  if (registry.activeProfileId === profileId) return { ok: true };
  if (!writeRegistry({ ...registry, activeProfileId: profileId })) {
    return { ok: false, error: "storage" };
  }
  return { ok: true };
};

const deleteProfileAssets = (profileId) => {
  deleteFile(getProfileAssetPath(profileId, "background"));
};

const deleteProfile = (profileId) => {
  const registry = ensureProfileRegistry();
  if (profileId === DEFAULT_PROFILE_ID) return { ok: false, error: "baseProfile" };
  if (registry.profiles.length <= 1) return { ok: false, error: "lastProfile" };
  if (!registry.profiles.some((profile) => profile.id === profileId)) {
    return { ok: false, error: "notFound" };
  }

  const profiles = registry.profiles.filter((profile) => profile.id !== profileId);
  const activeProfileId = registry.activeProfileId === profileId
    ? profiles[0].id
    : registry.activeProfileId;
  if (!writeRegistry({ ...registry, profiles, activeProfileId })) {
    return { ok: false, error: "storage" };
  }

  deleteFile(getProfileStoragePath(profileId));
  deleteProfileAssets(profileId);
  return { ok: true, activeProfileId, deletedActive: registry.activeProfileId === profileId };
};

export {
  DEFAULT_PROFILE_ID,
  getProfileRegistry,
  getActiveProfileId,
  getActiveProfileStoragePath,
  getActiveProfileAssetPath,
  readProfileStorage,
  createProfile,
  renameProfile,
  activateProfile,
  deleteProfile,
  deleteProfileAssets,
};
