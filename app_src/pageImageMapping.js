const getImageBaseName = (image) => {
  const source = String(image?.baseName || image?.name || image?.path || "");
  const fileName = source.split(/[\\/]/).pop() || "";
  return fileName.replace(/\.[^.]+$/, "");
};

export const getImagePageNumber = (image) => {
  if (Number.isSafeInteger(image && image.page) && image.page > 0) return image.page;
  const matches = getImageBaseName(image).match(/[0-9]+/g);
  if (!matches?.length) return null;

  const pageNumber = Number(matches[matches.length - 1]);
  return Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : null;
};

export const createPageImageLookup = (images = []) => {
  const candidates = new Map();

  images.forEach((image) => {
    const pageNumber = getImagePageNumber(image);
    if (pageNumber === null) return;

    if (!candidates.has(pageNumber)) {
      candidates.set(pageNumber, image);
      return;
    }

    // A duplicate number is ambiguous, so keep the legacy positional fallback.
    candidates.set(pageNumber, null);
  });

  return candidates;
};

export const getImageForPage = (images, pageNumber, lookup = null) => {
  const normalizedPageNumber = Number(pageNumber);
  if (!Number.isSafeInteger(normalizedPageNumber) || normalizedPageNumber <= 0) return null;

  const pageImages = Array.isArray(images) ? images : [];
  const pageLookup = lookup || createPageImageLookup(pageImages);
  return pageLookup.get(normalizedPageNumber) || pageImages[normalizedPageNumber - 1] || null;
};
