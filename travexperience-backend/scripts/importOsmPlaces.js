/**
 * scripts/importOsmPlaces.js
 * -----------------------------------------------------------------------
 * Importa lugares de interés desde OpenStreetMap (Overpass API) alrededor
 * de cada municipio de la Sierra Norte y los inserta en la colección Place
 * SOLO si no existen ya. Nunca modifica ni borra lugares existentes.
 *
 * Qué consulta (siempre con `name`):
 *   tourism=viewpoint|attraction|museum, historic=*, waterway=waterfall,
 *   leisure=park, iglesias (amenity=place_of_worship + religion=christian).
 *
 * Duplicados (se omite el candidato si):
 *   - ya existe un Place con el mismo osmId, o
 *   - el nombre normalizado coincide (igual o uno contiene al otro) y el
 *     lugar existente está a < 80 m, o
 *   - el nombre normalizado es IDÉNTICO y está a < 1 km (las coordenadas
 *     del seed son aproximadas): se omite y se reporta como "posible
 *     duplicado" para revisión manual.
 *
 * Uso:
 *   node scripts/importOsmPlaces.js --dry-run
 *   node scripts/importOsmPlaces.js
 * Opciones: --only="Xicotepec"   --radius=<metros>
 * Variables: OSM_USER_AGENT, OVERPASS_URL (por defecto overpass-api.de)
 * -----------------------------------------------------------------------
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Place = require('../src/models/mongodb/Place');
const { hasFlag, getOption, getIntOption } = require('./lib/cli');
const { createHttpClient } = require('./lib/httpClient');

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const DUPLICATE_DISTANCE_M = 80;
const SAME_NAME_DISTANCE_M = 1000;

// Centros = centroide de los lugares del seed de cada municipio.
const MUNICIPALITIES = [
  { name: 'Xicotepec', lat: 20.2727, lng: -97.9618, radius: 6000 },
  { name: 'Necaxa', lat: 20.2216, lng: -97.9884, radius: 5000 },
  { name: 'Huauchinango', lat: 20.176, lng: -98.0529, radius: 7000 },
  { name: 'Tenango de las Flores', lat: 20.2519, lng: -98.1349, radius: 4000 },
];

// Elementos de historic=* que son ruido (marcadores, cruces, mojoneras).
const IGNORED_HISTORIC = new Set(['boundary_stone', 'milestone', 'wayside_cross', 'wayside_shrine', 'tomb']);

/* ----------------------------- utilidades puras ----------------------------- */

const normalizeName = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
};

const buildOverpassQuery = ({ lat, lng, radius }) => {
  const around = `(around:${radius},${lat},${lng})`;
  return `[out:json][timeout:90];
(
  nwr${around}["name"]["tourism"~"^(viewpoint|attraction|museum)$"];
  nwr${around}["name"]["historic"];
  nwr${around}["name"]["waterway"="waterfall"];
  nwr${around}["name"]["leisure"="park"];
  nwr${around}["name"]["amenity"="place_of_worship"]["religion"="christian"];
);
out center tags;`;
};

/** Mapea tags OSM a una categoría EXISTENTE de Place.CATEGORIES; null si no aplica. */
const mapCategory = (tags = {}) => {
  if (tags.waterway === 'waterfall') return 'naturaleza';
  if (tags.historic && IGNORED_HISTORIC.has(tags.historic)) return null;
  if (tags.tourism === 'museum' || tags.historic || tags.amenity === 'place_of_worship') return 'sitio_cultural';
  if (tags.tourism === 'viewpoint' || tags.leisure === 'park') return 'naturaleza';
  if (tags.tourism === 'attraction') return 'entretenimiento';
  return null;
};

const osmTagLabels = (tags) =>
  ['tourism', 'historic', 'waterway', 'leisure', 'amenity']
    .filter((key) => tags[key] && tags[key] !== 'yes')
    .map((key) => `${key}:${tags[key]}`);

const buildAddress = (tags) => {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  return street || undefined;
};

/** Convierte un elemento Overpass en un candidato de Place (o null). */
const elementToCandidate = (element, municipalities = MUNICIPALITIES) => {
  const tags = element.tags || {};
  const name = (tags['name:es'] || tags.name || '').trim();
  const category = mapCategory(tags);
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (!name || !category || typeof lat !== 'number' || typeof lng !== 'number') return null;

  const nearest = municipalities
    .map((m) => ({ m, d: haversineMeters(lat, lng, m.lat, m.lng) }))
    .sort((a, b) => a.d - b.d)[0].m;

  return {
    name,
    category,
    address: buildAddress(tags),
    municipality: nearest.name,
    location: { type: 'Point', coordinates: [lng, lat] }, // GeoJSON: [lng, lat]
    images: [],
    tags: ['osm', ...osmTagLabels(tags)],
    source: 'osm',
    osmId: `${element.type}/${element.id}`,
    isActive: true,
  };
};

const namesMatch = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a)));

/**
 * Decide si un candidato ya existe. `existing` = [{ name, osmId, location }].
 * @returns {{ duplicate: boolean, reason?: string, review?: boolean }}
 */
const findDuplicate = (candidate, existing) => {
  const [lng, lat] = candidate.location.coordinates;
  const candidateName = normalizeName(candidate.name);

  for (const place of existing) {
    if (place.osmId && place.osmId === candidate.osmId) return { duplicate: true, reason: 'mismo osmId' };
    const [pLng, pLat] = place.location?.coordinates || [];
    if (typeof pLat !== 'number') continue;
    const existingName = normalizeName(place.name);
    const distance = haversineMeters(lat, lng, pLat, pLng);

    if (namesMatch(candidateName, existingName) && distance < DUPLICATE_DISTANCE_M) {
      return { duplicate: true, reason: `nombre similar a ${Math.round(distance)} m` };
    }
    if (candidateName === existingName && distance < SAME_NAME_DISTANCE_M) {
      return { duplicate: true, review: true, reason: `mismo nombre a ${Math.round(distance)} m (revisar coordenadas)` };
    }
  }
  return { duplicate: false };
};

/* ----------------------------------- main ----------------------------------- */

const fetchMunicipality = async (http, municipality) => {
  const body = new URLSearchParams({ data: buildOverpassQuery(municipality) }).toString();
  const json = await http.requestJson(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return json.elements || [];
};

const run = async () => {
  const dryRun = hasFlag('dry-run');
  const only = getOption('only');
  const radiusOverride = getIntOption('radius', null);

  const targets = MUNICIPALITIES.filter((m) => !only || normalizeName(m.name) === normalizeName(only)).map((m) => ({
    ...m,
    radius: radiusOverride || m.radius,
  }));
  if (targets.length === 0) throw new Error(`Municipio desconocido: "${only}".`);

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Conectado a MongoDB. Modo: ${dryRun ? 'DRY-RUN (no se escribe nada)' : 'INSERTAR'}\n`);

  const http = createHttpClient({ timeoutMs: 120000, minIntervalMs: 2000 });
  const candidatesByOsmId = new Map();
  for (const municipality of targets) {
    console.log(`Consultando Overpass: ${municipality.name} (radio ${municipality.radius} m)...`);
    const elements = await fetchMunicipality(http, municipality);
    elements.forEach((element) => {
      const candidate = elementToCandidate(element, MUNICIPALITIES);
      if (candidate && !candidatesByOsmId.has(candidate.osmId)) candidatesByOsmId.set(candidate.osmId, candidate);
    });
  }
  const candidates = [...candidatesByOsmId.values()];
  console.log(`\n${candidates.length} candidatos válidos (con nombre y categoría) desde OSM.`);

  // Lugares existentes dentro del área consultada (incluye inactivos).
  const areas = targets.map((m) => ({
    location: { $geoWithin: { $centerSphere: [[m.lng, m.lat], (m.radius + 1500) / 6378137] } },
  }));
  const existing = await Place.find({ $or: areas }, { name: 1, osmId: 1, location: 1 }).lean();
  console.log(`${existing.length} lugares ya existentes en el área.\n`);

  const toInsert = [];
  const skipped = [];
  const review = [];
  for (const candidate of candidates) {
    const verdict = findDuplicate(candidate, [...existing, ...toInsert]);
    if (!verdict.duplicate) {
      toInsert.push(candidate);
    } else {
      skipped.push(candidate);
      if (verdict.review) review.push(`${candidate.name} (${candidate.municipality}) — ${verdict.reason}`);
    }
  }

  toInsert.forEach((p) => console.log(`${dryRun ? '[dry-run] ' : ''}+ ${p.name} · ${p.municipality} · ${p.category} · ${p.osmId}`));

  if (!dryRun && toInsert.length > 0) {
    await Place.insertMany(toInsert, { ordered: false });
  }

  console.log('\n===== Resumen =====');
  console.log(`Candidatos OSM:        ${candidates.length}`);
  console.log(`${dryRun ? 'Se insertarían:' : 'Insertados:     '}       ${toInsert.length}`);
  console.log(`Omitidos (ya existen): ${skipped.length}`);
  if (review.length) console.log(`\nPosibles duplicados con coordenadas distintas (revisar a mano):\n  - ${review.join('\n  - ')}`);
  console.log('\nSiguiente paso sugerido: node scripts/enrichPlaces.js --dry-run --limit=10');
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`❌ Error: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { mapCategory, elementToCandidate, findDuplicate, buildOverpassQuery, normalizeName, MUNICIPALITIES };
