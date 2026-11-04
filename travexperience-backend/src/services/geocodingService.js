/**
 * services/geocodingService.js
 * -----------------------------------------------------------------------
 * Geocodificación con Nominatim (OpenStreetMap). Reemplaza a
 * googleMapsService.geocodeAddress con la MISMA firma de retorno:
 *   { lat, lng, formattedAddress }
 *
 * Política de uso de Nominatim (https://operations.osmfoundation.org/policies/nominatim/):
 *   - User-Agent identificable (variable OSM_USER_AGENT).
 *   - Máximo 1 petición por segundo (cola interna).
 *   - Caché de resultados para no repetir consultas.
 * Para volumen alto, apunta NOMINATIM_BASE_URL a una instancia propia.
 * -----------------------------------------------------------------------
 */

const logger = require('../utils/logger');

const NOMINATIM_BASE_URL = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
const USER_AGENT = process.env.OSM_USER_AGENT || 'TraveXperience/1.0 (contacto: configura OSM_USER_AGENT)';
const REQUEST_TIMEOUT_MS = 8000;
const MIN_INTERVAL_MS = 1100; // > 1 s entre peticiones
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

const cache = new Map(); // clave normalizada -> { value, expiresAt }
let queue = Promise.resolve();
let lastRequestAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serializa las peticiones respetando el intervalo mínimo. */
const throttled = (task) => {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return task();
  });
  queue = run.catch(() => {});
  return run;
};

const cacheKey = (address) => String(address).trim().toLowerCase().replace(/\s+/g, ' ');

const geocodeAddress = async (address) => {
  if (!address || !String(address).trim()) {
    throw new Error('Se requiere una dirección para geocodificar.');
  }

  const key = cacheKey(address);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const url = new URL('/search', NOMINATIM_BASE_URL);
  url.searchParams.set('q', String(address).trim());
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'mx');
  url.searchParams.set('accept-language', 'es');

  let results;
  try {
    results = await throttled(async () => {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`Nominatim respondió HTTP ${response.status}`);
      }
      return response.json();
    });
  } catch (error) {
    logger.error(`Error al consultar Nominatim: ${error.message}`);
    throw new Error('No se pudo contactar al servicio de geocodificación.');
  }

  if (!Array.isArray(results) || results.length === 0) {
    const notFoundError = new Error('No se encontraron coordenadas para la dirección proporcionada.');
    notFoundError.code = 'NOT_FOUND';
    throw notFoundError;
  }

  const first = results[0];
  const value = {
    lat: Number(first.lat),
    lng: Number(first.lon),
    formattedAddress: first.display_name,
  };

  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
};

module.exports = { geocodeAddress };
