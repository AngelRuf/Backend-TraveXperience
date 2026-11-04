/**
 * src/app.js
 * -----------------------------------------------------------------------
 * Configuración principal de la aplicación Express: middlewares globales,
 * seguridad, logging HTTP, montaje de rutas y manejo de errores.
 *
 * Este archivo NO inicia el servidor ni conecta las bases de datos;
 * esa responsabilidad pertenece a index.js, para mantener app.js
 * fácilmente testeable (se puede importar en tests con supertest sin
 * levantar un puerto real).
 * -----------------------------------------------------------------------
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');

const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const logger = require('./utils/logger');
const { corsOptions } = require('./config/cors');
const { noStore } = require('./middlewares/cacheControl');

const app = express();

// Render (y cualquier PaaS) termina TLS en un proxy: sin esto req.protocol
// sería "http" y req.ip la IP del proxy. 1 = confiar solo en el primer salto.
app.set('trust proxy', 1);

// --- Seguridad y utilidades base -----------------------------------------
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(cors(corsOptions)); // Orígenes desde CORS_ORIGINS (ver src/config/cors.js)
app.use(compression()); // gzip/deflate (clave para la PWA y el wearable)

// Health check liviano (sin base de datos) para el ping de Render y monitoreo.
app.get('/health', noStore, (req, res) => res.status(200).json({ ok: true }));

// Versión desplegada: el pipeline la consulta para confirmar que Render ya
// sirve el commit liberado. RENDER_GIT_COMMIT lo define Render automáticamente.
const pkg = require('../package.json');
app.get('/version', noStore, (req, res) =>
  res.status(200).json({
    name: pkg.name,
    version: pkg.version,
    commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'unknown',
    environment: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.round(process.uptime()),
  })
);

// El webhook de Stripe necesita el body CRUDO (sin parsear) para poder
// verificar la firma con stripe.webhooks.constructEvent(). Por eso este
// middleware se monta ANTES del express.json() global y solo aplica a
// esa ruta específica; el resto de la API sigue usando JSON normal.
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '2mb' })); // Parseo de JSON en el body
app.use(express.urlencoded({ extended: true }));
// Archivos subidos (fotos de lugares/hoteles/perfiles). Los nombres llevan
// timestamp único, así que se pueden cachear 30 días. ACAO "*" permite que el
// Service Worker de la PWA los guarde para uso sin conexión.
app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', 'uploads'), {
    maxAge: '30d',
    setHeaders: (res) => {
      res.set('Cache-Control', 'public, max-age=2592000');
      res.set('Access-Control-Allow-Origin', '*');
    },
  })
);

// --- Logging HTTP ----------------------------------------------------------
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev', { stream: { write: (msg) => logger.debug(msg.trim()) } }));
} else {
  app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
}

// --- Rutas principales de la API -------------------------------------------
// Por defecto NADA de la API se cachea; los GET públicos de catálogo lo
// reactivan explícitamente con publicCatalog (ver cacheControl.js).
app.use('/api/v1', noStore, apiRoutes);

// Ruta raíz informativa
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Bienvenido a la API de TraveXperience 🌍',
    docs: '/api/v1/health',
  });
});

// --- Manejo de errores (SIEMPRE al final) -----------------------------------
app.use(notFound);
app.use(errorHandler);

module.exports = app;
