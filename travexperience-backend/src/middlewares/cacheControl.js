/**
 * middlewares/cacheControl.js
 * -----------------------------------------------------------------------
 * Política de caché para la PWA / modo sin conexión.
 *
 *  - noStore: por defecto en TODA la API (sesión, pagos, perfil,
 *    itinerario, presencia...). Nada de eso debe quedar en caché.
 *  - publicCatalog: solo para GET públicos de catálogo. Express ya
 *    genera el ETag y responde 304 ante If-None-Match.
 *
 * Si la petición trae Authorization, la respuesta puede variar por
 * usuario (p. ej. /local/nearby marca isFavorite), así que se cambia a
 * "private" + Vary: Authorization para que ningún caché compartido (CDN)
 * mezcle datos de usuarios. El navegador/Service Worker sí la cachea.
 * -----------------------------------------------------------------------
 */

const CATALOG_DIRECTIVES = 'max-age=300, stale-while-revalidate=86400';

const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

const publicCatalog = (req, res, next) => {
  if (req.method !== 'GET') return next();
  res.vary('Authorization');
  res.set('Cache-Control', `${req.headers.authorization ? 'private' : 'public'}, ${CATALOG_DIRECTIVES}`);
  return next();
};

module.exports = { noStore, publicCatalog, CATALOG_DIRECTIVES };
