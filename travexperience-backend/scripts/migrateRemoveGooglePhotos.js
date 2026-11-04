/**
 * scripts/migrateRemoveGooglePhotos.js
 * -----------------------------------------------------------------------
 * Quita de Place y Hotel TODA referencia a fotos de Google:
 *   - URLs en `images` (y `mainImage` en Hotel) que contengan "/maps/photo"
 *     o "maps.googleapis.com".
 *   - Los campos `photoReference` / `photo_reference`.
 *
 * NO borra nada más: ni documentos, ni imágenes propias (/uploads/...),
 * ni imágenes de otras fuentes. Es idempotente: una segunda corrida no
 * encuentra nada que modificar.
 *
 * Uso:
 *   node scripts/migrateRemoveGooglePhotos.js --dry-run   (solo reporta)
 *   node scripts/migrateRemoveGooglePhotos.js             (aplica cambios)
 *
 * Opcional:
 *   --include-placeholders  también quita las URLs de "placehold.co" que
 *                           el código anterior guardaba como imagen de
 *                           respaldo. Sin esto, esos lugares NO se
 *                           consideran "sin imagen" para enrichPlaces.js.
 * -----------------------------------------------------------------------
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Place = require('../src/models/mongodb/Place');
const Hotel = require('../src/models/mongodb/Hotel');
const { hasFlag } = require('./lib/cli');

const GOOGLE_URL_PATTERN = /\/maps\/photo|maps\.googleapis\.com/i;
const PLACEHOLDER_URL_PATTERN = /placehold\.co/i;
const GOOGLE_FIELDS = ['photoReference', 'photo_reference'];

/** `images` puede contener strings o, en datos viejos, objetos { url, secure_url }. */
const imageToUrl = (image) => {
  if (typeof image === 'string') return image;
  if (image && typeof image === 'object') return image.secure_url || image.url || '';
  return '';
};

const buildMatcher = (includePlaceholders) => (value) => {
  const url = imageToUrl(value);
  return GOOGLE_URL_PATTERN.test(url) || (includePlaceholders && PLACEHOLDER_URL_PATTERN.test(url));
};

/**
 * Calcula los cambios para UN documento (función pura, testeable).
 * @returns {{ set: object, unset: object, changed: boolean, hasImageAfter: boolean }}
 */
const computeChanges = (doc, isBadUrl) => {
  const set = {};
  const unset = {};

  const images = Array.isArray(doc.images) ? doc.images : [];
  const keptImages = images.filter((image) => !isBadUrl(image));
  if (keptImages.length !== images.length) set.images = keptImages;

  let mainImage = doc.mainImage;
  if (typeof mainImage === 'string' && mainImage && isBadUrl(mainImage)) {
    unset.mainImage = '';
    mainImage = undefined;
  }

  GOOGLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(doc, field)) unset[field] = '';
  });

  const finalImages = set.images || images;
  return {
    set,
    unset,
    changed: Object.keys(set).length > 0 || Object.keys(unset).length > 0,
    hasImageAfter: finalImages.length > 0 || Boolean(mainImage),
  };
};

const migrateCollection = async (Model, label, { dryRun, isBadUrl }) => {
  const collection = Model.collection; // acceso crudo: el esquema ya no declara photoReference
  const stats = { label, scanned: 0, modified: 0, withoutImage: 0 };
  const ops = [];

  const cursor = collection.find({});
  // eslint-disable-next-line no-await-in-loop
  for await (const doc of cursor) {
    stats.scanned += 1;
    const { set, unset, changed, hasImageAfter } = computeChanges(doc, isBadUrl);
    if (!changed) continue;

    stats.modified += 1;
    if (!hasImageAfter) stats.withoutImage += 1;

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    ops.push({ updateOne: { filter: { _id: doc._id }, update } });
  }

  if (!dryRun && ops.length > 0) {
    await collection.bulkWrite(ops, { ordered: false });
  }
  return stats;
};

const run = async () => {
  const dryRun = hasFlag('dry-run');
  const includePlaceholders = hasFlag('include-placeholders');
  const isBadUrl = buildMatcher(includePlaceholders);

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Conectado a MongoDB. Modo: ${dryRun ? 'DRY-RUN (no se escribe nada)' : 'APLICAR CAMBIOS'}`);

  const results = [];
  results.push(await migrateCollection(Place, 'Place', { dryRun, isBadUrl }));
  results.push(await migrateCollection(Hotel, 'Hotel', { dryRun, isBadUrl }));

  console.log('\n===== Resumen =====');
  results.forEach((r) => {
    console.log(
      `${r.label}: ${r.scanned} revisados | ${r.modified} ${dryRun ? 'se modificarían' : 'modificados'} | ${r.withoutImage} quedan sin imagen`
    );
  });
  const totalModified = results.reduce((sum, r) => sum + r.modified, 0);
  const totalWithout = results.reduce((sum, r) => sum + r.withoutImage, 0);
  console.log(`TOTAL: ${totalModified} documentos ${dryRun ? 'a modificar' : 'modificados'}, ${totalWithout} quedaron sin imagen.`);
  if (dryRun) console.log('Vuelve a correr sin --dry-run para aplicar.');
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`❌ Error en la migración: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { computeChanges, buildMatcher, imageToUrl };
