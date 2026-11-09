// WebP is native to Photoshop 23.2 and newer; unknown CEP hosts stay conservative.
export const imageFileTypes = (version, uxp = false) => {
  const parts = String(version || "").split(".").map(Number);
  const webp = uxp || parts[0] > 23 || (parts[0] === 23 && parts[1] >= 2);
  return [".psd", ".png", ".jpg", ".jpeg"].concat(webp ? [".webp"] : []);
};
