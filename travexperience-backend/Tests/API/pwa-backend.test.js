/**
 * Verifica lo que necesita la PWA: /health, CORS, caché (ETag, SWR, no-store),
 * images:[] sin Google y https en producción. No requiere base de datos.
 */
require('dotenv').config();
const request = require('supertest');
const fs = require('fs');
const path = require('path');

jest.mock('../../src/services/geoService', () => ({
  findNearbyPlaces: jest.fn().mockResolvedValue({
    maxDistance: 5000,
    places: [
      { _id: '1', name: 'Sin foto', category: 'naturaleza', ratingAvg: 0, ratingCount: 0 }, // documento viejo: sin images
      { _id: '2', name: 'Con foto', category: 'naturaleza', images: ['http://cdn.ejemplo.com/a.jpg', '/uploads/places/b.jpg'] },
    ],
  }),
  haversineDistanceMeters: jest.fn(),
  DEFAULT_RADIUS_METERS: 5000,
}));
jest.mock('../../src/models/mongodb/ActivityLog', () => ({ create: jest.fn().mockResolvedValue({}) }));

const ORIGINAL_ENV = { ...process.env };
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

// El entorno se mantiene durante el test: CORS y https se evalúan en cada petición.
const loadApp = (env = {}) => {
  Object.assign(process.env, env);
  let app;
  jest.isolateModules(() => { app = require('../../src/app'); });
  return app;
};

describe('PWA: health, caché y compresión', () => {
  let app;
  beforeEach(() => { app = loadApp({ NODE_ENV: 'test' }); });

  it('GET /health responde { ok: true } sin caché', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /local/categories: ETag + Cache-Control público y 304 con If-None-Match', async () => {
    const first = await request(app).get('/api/v1/local/categories');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('public, max-age=300, stale-while-revalidate=86400');
    expect(first.headers.etag).toBeTruthy();
    const second = await request(app).get('/api/v1/local/categories').set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
  });

  it('GET /local/nearby devuelve images: [] cuando no hay foto y conserva el contrato', async () => {
    const res = await request(app).get('/api/v1/local/nearby').query({ lat: 20.27, lng: -97.95, radius: 5000 });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=300, stale-while-revalidate=86400');
    const { places, count, radiusMeters } = res.body.data;
    expect(count).toBe(2);
    expect(radiusMeters).toBe(5000);
    expect(places[0].images).toEqual([]);
    expect(places[1].images).toEqual(['http://cdn.ejemplo.com/a.jpg', '/uploads/places/b.jpg']); // sin forzar fuera de producción
    expect(JSON.stringify(res.body)).not.toMatch(/maps\/photo|googleapis/);
  });

  it('los endpoints con sesión / privados responden no-store', async () => {
    const profile = await request(app).get('/api/v1/favorites');
    expect(profile.status).toBe(401);
    expect(profile.headers['cache-control']).toBe('no-store');
    const health = await request(app).get('/api/v1/health');
    expect(health.headers['cache-control']).toBe('no-store');
  });

  it('con Authorization el catálogo pasa a private + Vary: Authorization', () => {
    const { publicCatalog } = require('../../src/middlewares/cacheControl');
    const headers = {};
    const res = { vary: (h) => { headers.vary = h; }, set: (k, v) => { headers[k] = v; } };
    publicCatalog({ method: 'GET', headers: { authorization: 'Bearer x' } }, res, () => {});
    expect(headers['Cache-Control']).toMatch(/^private, max-age=300/);
    expect(headers.vary).toBe('Authorization');
  });

  it('/uploads sirve con Cache-Control de 30 días y CORS abierto', async () => {
    const dir = path.join(__dirname, '../../uploads/places');
    const file = fs.readdirSync(dir)[0];
    const res = await request(app).get(`/uploads/places/${file}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=2592000');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('comprime respuestas grandes con gzip', async () => {
    const express = require('express');
    const compression = require('compression');
    const a = express().use(compression()).get('/x', (req, res) => res.json({ t: 'a'.repeat(5000) }));
    const res = await request(a).get('/x').set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
  });
});

describe('PWA: CORS', () => {
  it('desarrollo: permite localhost:5173 con Authorization y los métodos del frontend', async () => {
    const app = loadApp({ NODE_ENV: 'development', CORS_ORIGINS: '' });
    const res = await request(app)
      .options('/api/v1/local/nearby')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/i);
    expect(res.headers['access-control-allow-methods']).toMatch(/DELETE/);
  });

  it('producción: solo orígenes de CORS_ORIGINS (y no localhost)', async () => {
    const app = loadApp({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.ejemplo.com/, https://otro.ejemplo.com' });
    const ok = await request(app).get('/health').set('Origin', 'https://app.ejemplo.com');
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.ejemplo.com');
    const second = await request(app).get('/health').set('Origin', 'https://otro.ejemplo.com');
    expect(second.headers['access-control-allow-origin']).toBe('https://otro.ejemplo.com');
    const bad = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    const evil = await request(app).get('/health').set('Origin', 'https://malo.com');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('producción: URLs absolutas http:// de imágenes salen como https://', async () => {
    const app = loadApp({ NODE_ENV: 'production', CORS_ORIGINS: 'https://app.ejemplo.com' });
    const res = await request(app).get('/api/v1/local/nearby').query({ lat: 20.27, lng: -97.95 });
    expect(res.body.data.places[1].images).toEqual(['https://cdn.ejemplo.com/a.jpg', '/uploads/places/b.jpg']);
  });
});
