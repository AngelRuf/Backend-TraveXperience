/**
 * config/cors.js
 * -----------------------------------------------------------------------
 * Política CORS compartida por Express y Socket.IO.
 *
 *   CORS_ORIGINS  Lista separada por comas con los orígenes permitidos,
 *                 ej. "https://travexperience.onrender.com,https://app.midominio.com"
 *   Fuera de producción también se permite http://localhost:5173 (y la
 *   misma URL con IP de red local, para probar la PWA desde el celular).
 *
 * Las peticiones SIN cabecera Origin (curl, app móvil nativa, smartwatch,
 * servidor a servidor) no están sujetas a CORS y se permiten.
 * -----------------------------------------------------------------------
 */

const logger = require('../utils/logger');

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const DEV_LAN_PATTERN = /^http:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}):5173$/;

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
// X-Client-Platform lo envía el frontend/app para el log de actividad.
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'X-Client-Platform'];

const isProduction = (env = process.env) => env.NODE_ENV === 'production';

const parseOrigins = (raw = '') =>
  String(raw)
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const getAllowedOrigins = (env = process.env) => {
  const origins = parseOrigins(env.CORS_ORIGINS);
  if (!isProduction(env)) origins.push(...DEV_ORIGINS);
  return [...new Set(origins)];
};

const isOriginAllowed = (origin, env = process.env) => {
  if (!origin) return true;
  if (getAllowedOrigins(env).includes(origin)) return true;
  return !isProduction(env) && DEV_LAN_PATTERN.test(origin);
};

if (isProduction() && parseOrigins(process.env.CORS_ORIGINS).length === 0) {
  logger.warn('⚠️  CORS_ORIGINS está vacío en producción: ningún navegador podrá llamar a la API. Define el origen del frontend.');
}

const corsOptions = {
  origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  methods: ALLOWED_METHODS,
  allowedHeaders: ALLOWED_HEADERS,
  exposedHeaders: ['ETag'],
  maxAge: 86400, // el navegador cachea el preflight 24 h
};

module.exports = { corsOptions, getAllowedOrigins, isOriginAllowed, parseOrigins };
