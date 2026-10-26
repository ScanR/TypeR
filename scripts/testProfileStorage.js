const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "app_src", "profileStorage.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;

const extensionPath = "C:/TypeR";
const NO_ERROR = 0;
const ERR_NOT_FOUND = 3;

const loadProfileStorage = (initialFiles = {}, undeletable = []) => {
  const files = new Map(Object.entries(initialFiles));
  global.window = {
    CSInterface: function CSInterface() {
      this.getSystemPath = () => extensionPath;
    },
    SystemPath: { EXTENSION: "extension" },
    cep: {
      fs: {
        NO_ERROR,
        ERR_NOT_FOUND,
        readFile(filePath) {
          return files.has(filePath)
            ? { err: 0, data: files.get(filePath) }
            : { err: ERR_NOT_FOUND };
        },
        writeFile(filePath, data) {
          files.set(filePath, data);
          return { err: 0 };
        },
        deleteFile(filePath) {
          if (undeletable.includes(filePath)) return 1;
          if (!files.has(filePath)) return ERR_NOT_FOUND;
          files.delete(filePath);
          return NO_ERROR;
        },
      },
    },
  };
  global.SystemPath = global.window.SystemPath;

  const profileModule = { exports: {} };
  new Function("require", "module", "exports", transformed)(
    (name) => name === "./storageIO" ? require("./helpers/loadAppModule")()("app_src/storageIO.js") : require(name),
    profileModule,
    profileModule.exports
  );
  return { files, api: profileModule.exports };
};

const legacyData = {
  styles: [{ id: "legacy-style", name: "Legacy" }],
  folders: [{ id: "legacy-folder", name: "Legacy project" }],
  language: "fr_FR",
};
const legacySetup = loadProfileStorage({
  [`${extensionPath}/storage`]: JSON.stringify(legacyData),
});
const {
  DEFAULT_PROFILE_ID,
  activateProfile,
  createProfile,
  deleteProfile,
  getActiveProfileId,
  getProfileRegistry,
  readProfileStorage,
  renameProfile,
} = legacySetup.api;

const initialRegistry = getProfileRegistry();
assert.strictEqual(initialRegistry.activeProfileId, DEFAULT_PROFILE_ID);
assert.deepStrictEqual(initialRegistry.profiles, [{ id: DEFAULT_PROFILE_ID, name: "Default" }]);
assert.strictEqual(legacySetup.files.has(`${extensionPath}/storage`), true);
assert.strictEqual(legacySetup.files.has(`${extensionPath}/storage_profiles`), true);
assert.strictEqual(legacySetup.files.has(`${extensionPath}/storage_profile_default`), false);
assert.strictEqual(readProfileStorage(DEFAULT_PROFILE_ID).language, "fr_FR");
assert.strictEqual(readProfileStorage(DEFAULT_PROFILE_ID).styles[0].id, "legacy-style");

const created = createProfile("PMU", { notFirstTime: true, language: "fr_FR" });
assert.strictEqual(created.ok, true);
assert.strictEqual(readProfileStorage(created.profile.id).notFirstTime, true);
assert.strictEqual(createProfile("pmu").error, "nameExists");
assert.strictEqual(activateProfile(created.profile.id).ok, true);
assert.strictEqual(getActiveProfileId(), created.profile.id);
assert.strictEqual(renameProfile(DEFAULT_PROFILE_ID, "Main").ok, true);
assert.strictEqual(getProfileRegistry().profiles[0].name, "Main");

legacySetup.files.set(`${extensionPath}/storage_background`, "base-background");
assert.strictEqual(deleteProfile(DEFAULT_PROFILE_ID).error, "baseProfile");
assert.strictEqual(legacySetup.files.has(`${extensionPath}/storage`), true);
assert.strictEqual(legacySetup.files.has(`${extensionPath}/storage_background`), true);

assert.strictEqual(activateProfile(DEFAULT_PROFILE_ID).ok, true);
legacySetup.files.set(
  `${extensionPath}/storage_profile_${created.profile.id}_background`,
  "profile-background"
);
assert.strictEqual(deleteProfile(created.profile.id).ok, true);
assert.strictEqual(
  legacySetup.files.has(`${extensionPath}/storage_profile_${created.profile.id}`),
  false
);
assert.strictEqual(
  legacySetup.files.has(`${extensionPath}/storage_profile_${created.profile.id}_background`),
  false
);

// Recover data created by the earlier profile implementation and put it back
// in `storage`, even when an older copy of the base file is still present.
const temporaryProfileData = { language: "de_DE", styles: [{ id: "newer" }] };
const recoverySetup = loadProfileStorage({
  [`${extensionPath}/storage`]: JSON.stringify({ language: "fr_FR" }),
  [`${extensionPath}/storage_profile_default`]: JSON.stringify(temporaryProfileData),
  [`${extensionPath}/storage_profile_default_background`]: "newer-background",
  [`${extensionPath}/storage_profiles`]: JSON.stringify({
    version: 1,
    activeProfileId: "default",
    profiles: [{ id: "default", name: "Default" }],
  }),
});
recoverySetup.api.getProfileRegistry();
assert.strictEqual(recoverySetup.files.has(`${extensionPath}/storage_profile_default`), false);
assert.deepStrictEqual(
  JSON.parse(recoverySetup.files.get(`${extensionPath}/storage`)),
  temporaryProfileData
);
assert.strictEqual(
  recoverySetup.files.has(`${extensionPath}/storage_profile_default_background`),
  false
);
assert.strictEqual(
  recoverySetup.files.get(`${extensionPath}/storage_background`),
  "newer-background"
);

// If the old Default file cannot be deleted, the next launch must not copy
// it over `storage` again and wipe changes made since the migration.
const stuckPath = `${extensionPath}/storage_profile_default`;
const stuckInitial = {
  [`${extensionPath}/storage`]: JSON.stringify({ language: "fr_FR" }),
  [stuckPath]: JSON.stringify(temporaryProfileData),
  [`${extensionPath}/storage_profiles`]: JSON.stringify({
    version: 1,
    activeProfileId: "default",
    profiles: [{ id: "default", name: "Default" }],
  }),
};
const stuckSetup = loadProfileStorage(stuckInitial, [stuckPath]);
stuckSetup.api.getProfileRegistry();
assert.deepStrictEqual(JSON.parse(stuckSetup.files.get(`${extensionPath}/storage`)), temporaryProfileData);
const newerData = { language: "es_SP", styles: [{ id: "edited-after-migration" }] };
const relaunch = loadProfileStorage({
  ...Object.fromEntries(stuckSetup.files),
  [`${extensionPath}/storage`]: JSON.stringify(newerData),
}, [stuckPath]);
relaunch.api.getProfileRegistry();
assert.deepStrictEqual(JSON.parse(relaunch.files.get(`${extensionPath}/storage`)), newerData);

console.log("profile storage compatibility and management tests passed");
