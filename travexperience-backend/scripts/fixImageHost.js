/**
 * scripts/fixImageHostFromUrl.js
 * -----------------------------------------------------------------------
 * Alternativa a fixImageHost.js para cuando el campo `photoReference` NO
 * está guardado en la base de datos (p. ej. porque no existe en el
 * schema de Place/Hotel y Mongoose lo descartó al guardar).
 *
 * En vez de leer `photoReference`, extrae el parámetro `ref=` que ya
 * viene dentro de la URL vieja guardada en `images[0]` / `mainImage`
 * (la que apunta al host viejo, p. ej. http://10.91.20.6:4000) y
 * reconstruye la URL completa usando el nuevo host (API_PUBLIC_URL).
 *
 * No vuelve a llamar a Google Places (no gasta cuota).
 *
 * Uso:
 *   API_PUBLIC_URL=https://backend-travexperience.onrender.com/api/v1 ^
 *   MONGO_URI="..." node scripts/fixImageHostFromUrl.js
 * -----------------------------------------------------------------------
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Place = require('../src/models/mongodb/Place');
const Hotel = require('../src/models/mongodb/Hotel');

const API_PUBLIC_URL = process.env.API_PUBLIC_URL || 'http://10.91.20.6:4000/api/v1';

// Ajusta esta ruta si tu endpoint de proxy no es "/maps/photo"
const PHOTO_PATH = '/maps/photo';

const extractRef = (url) => {
  if (typeof url !== 'string') return null;
  try {
    // new URL() necesita una base válida aunque la URL vieja sea http://IP-local
    const parsed = new URL(url);
    return parsed.searchParams.get('ref');
  } catch (e) {
    return null;
  }
};

const buildNewUrl = (ref) => `${API_PUBLIC_URL}${PHOTO_PATH}?ref=${encodeURIComponent(ref)}`;

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Conectado a MongoDB.');
  console.log('Host que se va a usar para reconstruir las URLs:', API_PUBLIC_URL);

  // ── Places ──────────────────────────────────────────────────────────
  const places = await Place.find({ 'images.0': { $exists: true } });
  let placesFixed = 0;
  let placesSkipped = 0;
  for (const place of places) {
    const oldUrl = place.images?.[0];
    const ref = extractRef(oldUrl);
    if (!ref) {
      placesSkipped += 1; // probablemente un placeholder SVG, no una foto real
      continue;
    }
    const newUrl = buildNewUrl(ref);
    if (oldUrl !== newUrl) {
      await Place.updateOne({ _id: place._id }, { images: [newUrl] });
      placesFixed += 1;
    }
  }
  console.log(`Places: ${placesFixed} URLs reconstruidas, ${placesSkipped} sin "ref" (placeholders, se dejaron igual).`);

  // ── Hotels ──────────────────────────────────────────────────────────
  const hotels = await Hotel.find({ mainImage: { $exists: true, $ne: null } });
  let hotelsFixed = 0;
  let hotelsSkipped = 0;
  for (const hotel of hotels) {
    const oldUrl = hotel.mainImage;
    const ref = extractRef(oldUrl);
    if (!ref) {
      hotelsSkipped += 1;
      continue;
    }
    const newUrl = buildNewUrl(ref);
    if (hotel.mainImage !== newUrl) {
      await Hotel.updateOne({ _id: hotel._id }, { mainImage: newUrl, images: [newUrl] });
      hotelsFixed += 1;
    }
  }
  console.log(`Hotels: ${hotelsFixed} URLs reconstruidas, ${hotelsSkipped} sin "ref" (placeholders, se dejaron igual).`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
