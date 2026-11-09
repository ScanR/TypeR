// A window that presents TypeR Studio, shown at startup only while the switch
// on the TypeR site turns it on (studio-promo.json, published with the site):
//   { "studioPromo": { "enabled": true, "id": 1 } }
// Off by default: a missing, unreachable or malformed file shows nothing. A
// new id starts a new announcement, shown again to those who saw the last one.
// Never shown inside TypeR Studio, which runs this same panel.

export const STUDIO_PROMO_URL = "https://typer.hayasaku.fr/studio-promo.json";
export const STUDIO_WEB_URL = "https://typer.hayasaku.fr/web/";
// "Later" brings the window back once, a week on
export const STUDIO_PROMO_REMIND_MS = 7 * 24 * 60 * 60 * 1000;
// Storage keys: the last announcement answered, and "Don't show again"
export const STUDIO_PROMO_RECORD_KEY = "studioPromo";
export const STUDIO_PROMO_OFF_KEY = "studioPromoOff";

const isPositiveInteger = (value) => typeof value === "number" && isFinite(value) && Math.floor(value) === value && value > 0;

// The announcement the site turns on, { id }, or null
export const parseStudioPromo = (data) => {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (error) {
      return null;
    }
  }
  const promo = value && typeof value === "object" ? value.studioPromo : null;
  if (!promo || typeof promo !== "object" || promo.enabled !== true) return null;
  if (!isPositiveInteger(promo.id)) return null;
  return { id: promo.id };
};

// Stored values are untrusted: anything unexpected counts as never answered
export const normalizeStudioPromoRecord = (value) => {
  if (!value || typeof value !== "object" || !isPositiveInteger(value.id)) return null;
  const remindAt = typeof value.remindAt === "number" && isFinite(value.remindAt) ? value.remindAt : null;
  return { id: value.id, remindAt };
};

export const shouldShowStudioPromo = ({ promo, record, off, now }) => {
  if (!promo || off === true) return false;
  const answered = normalizeStudioPromoRecord(record);
  if (!answered || answered.id !== promo.id) return true;
  return answered.remindAt !== null && now >= answered.remindAt;
};

// What closing the window leaves in storage. "Later" (or the close button)
// the first time asks again in a week; the second time, or opening Studio,
// ends this announcement.
export const closeStudioPromo = ({ promo, record, later, now }) => {
  const answered = normalizeStudioPromoRecord(record);
  const remindedBefore = !!answered && answered.id === promo.id;
  if (later && !remindedBefore) return { id: promo.id, remindAt: now + STUDIO_PROMO_REMIND_MS };
  return { id: promo.id, remindAt: null };
};

// TypeR Studio runs this panel in its own window
export const isInsideStudio = () => typeof window !== "undefined" && !!window.__typerWeb;
