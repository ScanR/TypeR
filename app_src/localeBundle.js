export const mergeLocaleBundle = (defaults, automatic, explicit) => Object.assign({}, defaults || {}, automatic || {}, explicit || {});
