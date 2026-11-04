/**
 * Cliente HTTP para scripts que consultan APIs públicas (Wikimedia,
 * Overpass...). Garantiza:
 *   - User-Agent identificable (variable OSM_USER_AGENT).
 *   - Máximo 1 petición por segundo (intervalo mínimo configurable).
 *   - Reintentos con backoff exponencial ante 429 / 5xx / errores de red,
 *     respetando la cabecera Retry-After.
 */

const { sleep } = require('./cli');

const DEFAULT_USER_AGENT = 'TraveXperience/1.0 (+https://backend-travexperience.onrender.com; configura OSM_USER_AGENT con tu correo)';

const createHttpClient = ({
  userAgent = process.env.OSM_USER_AGENT || DEFAULT_USER_AGENT,
  minIntervalMs = 1100,
  maxRetries = 3,
  baseBackoffMs = 2000,
  timeoutMs = 30000,
  fetchImpl = (...args) => fetch(...args),
  sleepImpl = sleep,
} = {}) => {
  let lastRequestAt = 0;

  const waitTurn = async () => {
    const wait = lastRequestAt + minIntervalMs - Date.now();
    if (wait > 0) await sleepImpl(wait);
    lastRequestAt = Date.now();
  };

  const retryDelay = (attempt, response) => {
    const retryAfter = Number(response?.headers?.get?.('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 60000);
    return baseBackoffMs * 2 ** attempt;
  };

  /** Devuelve el JSON de la respuesta o lanza un Error tras agotar reintentos. */
  const requestJson = async (url, options = {}) => {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await waitTurn();
      let response;
      try {
        response = await fetchImpl(url, {
          ...options,
          headers: { 'User-Agent': userAgent, Accept: 'application/json', ...(options.headers || {}) },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (networkError) {
        lastError = networkError;
        if (attempt < maxRetries) await sleepImpl(retryDelay(attempt));
        continue;
      }

      if (response.ok) return response.json();

      lastError = new Error(`HTTP ${response.status} en ${new URL(url).host}`);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) throw lastError;
      if (attempt < maxRetries) await sleepImpl(retryDelay(attempt, response));
    }
    throw lastError;
  };

  return { requestJson };
};

module.exports = { createHttpClient, DEFAULT_USER_AGENT };
