const createSeededRandom = (seed) => {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

// A seeded shuffle keeps the order stable across React renders, and consecutive
// Random clicks walk through it without showing a family twice.
const shuffleFamilies = (families, seed) => {
  const shuffled = (families || []).slice();
  const random = createSeededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = value;
  }
  return shuffled;
};

// Catalogue pages not fetched yet, given the last page the API returned.
const getRemainingPages = (pagination, currentPage, perPage) => {
  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / perPage));
  const pages = [];
  for (let page = Math.max(2, (pagination.page || currentPage) + 1); page <= totalPages; page += 1) pages.push(page);
  return pages;
};

export { getRemainingPages, shuffleFamilies };
