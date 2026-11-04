/**
 * scripts/enrichPlaces.js
 * -----------------------------------------------------------------------
 * Enriquece los Place con contenido LIBRE (sin APIs de pago):
 *   - Foto: Wikimedia Commons por coordenadas (geosearch, namespace 6,
 *     solo jpg/png). Guarda la URL en `images` y autor/licencia/enlace
 *     en `imageCredit`.
 *   - Descripción: Wikipedia en español (por coordenadas o por título)
 *     cuando el lugar no tiene descripción.
 *
 * Reglas:
 *   - NUNCA sobrescribe datos existentes: solo rellena lo que está vacío,
 *     y la escritura incluye la misma condición de "vacío" en el filtro
 *     (si un admin edita el lugar durante la corrida, no se pisa).
 *   - Máximo 1 petición por segundo, User-Agent identificable, reintentos
 *     con backoff (ver scripts/lib/httpClient.js).
 *   - Idempotente: una segunda corrida solo toca lo que siga vacío.
 *
 * Uso:
 *   node scripts/enrichPlaces.js --dry-run --limit=10
 *   node scripts/enrichPlaces.js --limit=50
 *   node scripts/enrichPlaces.js                      (todos los pendientes)
 *
 * Opciones: --radius=<metros> (por defecto 500, máx. 10000)
 * Variables: OSM_USER_AGENT="TraveXperience/1.0 (tu@correo.com)"
 * -----------------------------------------------------------------------
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Place = require('../src/models/mongodb/Place');
const { hasFlag, getIntOption } = require('./lib/cli');
const { createHttpClient } = require('./lib/httpClient');

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIPEDIA_API = 'https://es.wikipedia.org/w/api.php';
const ALLOWED_MIME = ['image/jpeg', 'image/png'];
const MIN_IMAGE_WIDTH = 600;
const THUMB_WIDTH = 1024;
const DESCRIPTION_MAX = 800;
const DESCRIPTION_SUFFIX = ' (Fuente: Wikipedia)';
const STOPWORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'a', 'san', 'santa']);

/* ----------------------------- utilidades puras ----------------------------- */

const normalize = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (text) => normalize(text).split(' ').filter((t) => t.length > 2 && !STOPWORDS.has(t));

const sharesToken = (a, b) => {
  const setB = new Set(tokens(b));
  return tokens(a).some((t) => setB.has(t));
};

const stripHtml = (html) =>
  String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
};

const truncateDescription = (text) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const limit = DESCRIPTION_MAX - DESCRIPTION_SUFFIX.length;
  if (clean.length <= limit) return clean + DESCRIPTION_SUFFIX;
  const cut = clean.slice(0, limit);
  const lastStop = cut.lastIndexOf('. ');
  const body = lastStop > 120 ? cut.slice(0, lastStop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  return body + DESCRIPTION_SUFFIX;
};

const isUsefulExtract = (extract) =>
  Boolean(extract) && extract.length >= 60 && !/puede referirse a|pueden referirse a/i.test(extract);

/**
 * Elige la mejor foto de la respuesta de Commons (función pura).
 * Criterios: solo jpg/png, ancho mínimo, licencia libre declarada y
 * relación con el lugar (comparte palabra con el nombre, o está a <=100 m).
 */
const pickCommonsCandidate = (place, apiResponse) => {
  const [lng, lat] = place.location.coordinates;
  const pages = Object.values(apiResponse?.query?.pages || {});

  const candidates = pages
    .map((page) => {
      const info = page.imageinfo?.[0];
      if (!info || !ALLOWED_MIME.includes(info.mime)) return null;
      if ((info.width || 0) < MIN_IMAGE_WIDTH) return null;

      const meta = info.extmetadata || {};
      const license = stripHtml(meta.LicenseShortName?.value);
      if (!license || /non-?free|fair use|all rights reserved/i.test(license)) return null;

      const coord = page.coordinates?.[0];
      const distance = coord ? haversineMeters(lat, lng, coord.lat, coord.lon) : Infinity;
      const title = String(page.title || '').replace(/^File:/i, '');
      const description = stripHtml(meta.ImageDescription?.value);
      const related = sharesToken(place.name, `${title} ${description}`);

      return {
        index: page.index ?? 999,
        distance,
        related,
        imageUrl: info.thumburl || info.url,
        credit: {
          author: stripHtml(meta.Artist?.value) || 'Autor desconocido',
          license,
          sourceUrl: info.descriptionurl,
        },
      };
    })
    .filter(Boolean)
    .filter((c) => c.imageUrl && c.credit.sourceUrl && (c.related || c.distance <= 100));

  candidates.sort((a, b) => Number(b.related) - Number(a.related) || a.distance - b.distance || a.index - b.index);
  return candidates[0] || null;
};

/* ----------------------------- consultas a APIs ----------------------------- */

const createEnricher = (http, { radius }) => {
  const findCommonsImage = async (place) => {
    const [lng, lat] = place.location.coordinates;
    const url = new URL(COMMONS_API);
    Object.entries({
      action: 'query',
      format: 'json',
      generator: 'geosearch',
      ggscoord: `${lat}|${lng}`,
      ggsradius: String(radius),
      ggslimit: '15',
      ggsnamespace: '6',
      prop: 'imageinfo|coordinates',
      iiprop: 'url|mime|size|extmetadata',
      iiurlwidth: String(THUMB_WIDTH),
      iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription',
    }).forEach(([k, v]) => url.searchParams.set(k, v));
    return pickCommonsCandidate(place, await http.requestJson(url));
  };

  const extractsQuery = (extra) => {
    const url = new URL(WIKIPEDIA_API);
    Object.entries({
      action: 'query',
      format: 'json',
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      exsentences: '4',
      redirects: '1',
      ...extra,
    }).forEach(([k, v]) => url.searchParams.set(k, v));
    return url;
  };

  const findWikipediaDescription = async (place) => {
    const [lng, lat] = place.location.coordinates;

    // 1) Por coordenadas; el título debe parecerse al nombre del lugar.
    const byGeo = await http.requestJson(
      extractsQuery({ generator: 'geosearch', ggscoord: `${lat}|${lng}`, ggsradius: '1000', ggslimit: '5' })
    );
    const geoPage = Object.values(byGeo?.query?.pages || {})
      .filter((p) => sharesToken(place.name, p.title) && isUsefulExtract(p.extract))
      .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))[0];
    if (geoPage) return truncateDescription(geoPage.extract);

    // 2) Por título exacto.
    const byTitle = await http.requestJson(extractsQuery({ titles: place.name }));
    const titlePage = Object.values(byTitle?.query?.pages || {}).find(
      (p) => !p.missing && isUsefulExtract(p.extract)
    );
    return titlePage ? truncateDescription(titlePage.extract) : null;
  };

  return { findCommonsImage, findWikipediaDescription };
};

/* ----------------------------------- main ----------------------------------- */

const EMPTY_IMAGES = { $or: [{ images: { $exists: false } }, { images: { $size: 0 } }] };
const EMPTY_DESCRIPTION = {
  $or: [{ description: { $exists: false } }, { description: null }, { description: '' }],
};

const run = async () => {
  const dryRun = hasFlag('dry-run');
  const limit = getIntOption('limit', null);
  const radius = Math.min(getIntOption('radius', 500) || 500, 10000);

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Conectado a MongoDB. Modo: ${dryRun ? 'DRY-RUN (no se escribe nada)' : 'APLICAR CAMBIOS'}${limit ? ` | límite: ${limit}` : ''}`);

  const filter = { isActive: true, $or: [EMPTY_IMAGES, EMPTY_DESCRIPTION] };
  let query = Place.find(filter).sort({ createdAt: 1 });
  if (limit) query = query.limit(limit);
  const places = await query.lean();
  console.log(`${places.length} lugares con imagen o descripción pendientes.\n`);

  const http = createHttpClient();
  const enricher = createEnricher(http, { radius });
  const summary = { images: 0, descriptions: 0, noImageFound: 0, noDescriptionFound: 0, errors: 0 };

  for (const place of places) {
    const needsImage = !place.images || place.images.length === 0;
    const needsDescription = !place.description || !place.description.trim();
    const set = {};
    const notes = [];

    try {
      if (needsImage) {
        const image = await enricher.findCommonsImage(place);
        if (image) {
          set.images = [image.imageUrl];
          set.imageCredit = image.credit;
          notes.push(`foto (${image.credit.license}, ${image.credit.author})`);
          summary.images += 1;
        } else {
          summary.noImageFound += 1;
        }
      }
      if (needsDescription) {
        const description = await enricher.findWikipediaDescription(place);
        if (description) {
          set.description = description;
          notes.push('descripción (Wikipedia)');
          summary.descriptions += 1;
        } else {
          summary.noDescriptionFound += 1;
        }
      }
    } catch (error) {
      summary.errors += 1;
      console.warn(`⚠️  ${place.name} (${place.municipality}): ${error.message}`);
      continue;
    }

    if (Object.keys(set).length === 0) {
      console.log(`· ${place.name} (${place.municipality}): sin resultados`);
      continue;
    }

    console.log(`${dryRun ? '[dry-run] ' : ''}✓ ${place.name} (${place.municipality}): ${notes.join(' + ')}`);
    if (dryRun) continue;

    // Guardas: solo escribe cada campo si SIGUE vacío en la base.
    const conditions = [{ _id: place._id }];
    if (set.images) conditions.push(EMPTY_IMAGES);
    if (set.description) conditions.push(EMPTY_DESCRIPTION);
    await Place.updateOne({ $and: conditions }, { $set: set });
  }

  console.log('\n===== Resumen =====');
  console.log(`Fotos asignadas:        ${summary.images}${dryRun ? ' (simulado)' : ''}`);
  console.log(`Descripciones añadidas: ${summary.descriptions}${dryRun ? ' (simulado)' : ''}`);
  console.log(`Sin foto en Commons:    ${summary.noImageFound}`);
  console.log(`Sin texto en Wikipedia: ${summary.noDescriptionFound}`);
  console.log(`Errores:                ${summary.errors}`);
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`❌ Error: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { pickCommonsCandidate, truncateDescription, stripHtml, normalize, sharesToken, createEnricher };
