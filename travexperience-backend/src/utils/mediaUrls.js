/**
 * utils/mediaUrls.js
 * -----------------------------------------------------------------------
 * Normaliza lo que la API devuelve sobre imágenes:
 *   - `images` siempre es un array (el frontend pone la imagen de
 *     respaldo cuando está vacío). Los documentos viejos creados antes
 *     del campo, leídos con .lean(), llegarían como undefined.
 *   - En producción, cualquier URL absoluta http:// se entrega como https://.
 *   - Rutas relativas ("/uploads/...") se dejan tal cual.
 * Soporta `images` como strings o como objetos { url, secure_url }.
 * -----------------------------------------------------------------------
 */

const LOCAL_HOST_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i;

const forceHttps = (url) => {
  if (typeof url !== 'string' || process.env.NODE_ENV !== 'production') return url;
  if (LOCAL_HOST_PATTERN.test(url)) return url;
  return url.replace(/^http:\/\//i, 'https://');
};

const normalizeImage = (image) => {
  if (typeof image === 'string') return forceHttps(image);
  if (image && typeof image === 'object') {
    const next = { ...image };
    if (next.url) next.url = forceHttps(next.url);
    if (next.secure_url) next.secure_url = forceHttps(next.secure_url);
    return next;
  }
  return image;
};

/** Devuelve un objeto plano con images[] garantizado y URLs https en producción. */
const withNormalizedImages = (doc) => {
  if (!doc) return doc;
  const plain = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc };
  const result = { ...plain, images: Array.isArray(plain.images) ? plain.images.map(normalizeImage) : [] };
  if (typeof result.mainImage === 'string' && result.mainImage) result.mainImage = forceHttps(result.mainImage);
  if (result.imageCredit?.sourceUrl) {
    result.imageCredit = { ...result.imageCredit, sourceUrl: forceHttps(result.imageCredit.sourceUrl) };
  }
  return result;
};

module.exports = { forceHttps, normalizeImage, withNormalizedImages };
