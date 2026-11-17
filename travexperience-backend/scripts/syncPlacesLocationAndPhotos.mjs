import 'dotenv/config';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
const MONGO_URI = process.env.MONGO_URI;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

if (!GOOGLE_KEY || !MONGO_URI) {
  console.error('❌ Faltan GOOGLE_MAPS_API_KEY o MONGO_URI en el .env');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CACHE_FILE = 'places_enriched_cache.json';
const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};

async function fetchGooglePlaceDetails(name, lat, lng, municipality = '') {
  const query = `${name}, ${municipality || 'Sierra Norte de Puebla'}, Puebla, Mexico`;
  const body = {
    textQuery: query,
    maxResultCount: 1,
  };

  // Si ya tenemos coordenadas aproximadas, sesgamos la búsqueda en un radio de 5 km
  if (lat != null && lng != null) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 5000.0,
      },
    };
  }

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Places HTTP ${res.status}: ${errText.slice(0, 150)}`);
  }

  const data = await res.json();
  return data.places?.[0] || null;
}

async function uploadPhotoToCloudinary(photoName, placeId) {
  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=900&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const buffer = Buffer.from(await res.arrayBuffer());
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'travexperience-places',
        public_id: `place_${placeId}`,
        overwrite: true,
        resource_type: 'image',
      },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    stream.end(buffer);
  });
}

await mongoose.connect(MONGO_URI);
// Ajusta el nombre de la colección si en tu BD se llama distinto a 'places'
const collection = mongoose.connection.db.collection('places');
const places = await collection.find({}).toArray();

console.log(`Total de lugares en MongoDB: ${places.length}`);

let updatedCount = 0;

for (const p of places) {
  const id = String(p._id);

  // Si ya fue procesado en cache, saltar
  if (cache[id]?.done) {
    console.log(`⏭️  Saltando (ya sincronizado): ${p.name}`);
    continue;
  }

  const coords = p.location?.coordinates; // [lng, lat]
  const approxLat = coords ? coords[1] : p.lat;
  const approxLng = coords ? coords[0] : p.lng;

  try {
    const gPlace = await fetchGooglePlaceDetails(p.name, approxLat, approxLng, p.municipality);

    if (!gPlace || !gPlace.location) {
      console.log(`⚠️  Sin coincidencia exacta en Google: ${p.name}`);
      cache[id] = { done: true, found: false, name: p.name };
      writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
      await sleep(250);
      continue;
    }

    const exactLat = gPlace.location.latitude;
    const exactLng = gPlace.location.longitude;
    const formattedAddress = gPlace.formattedAddress || p.address || '';

    const updateFields = {
      location: {
        type: 'Point',
        coordinates: [exactLng, exactLat], // GeoJSON siempre es [longitud, latitud]
      },
      address: formattedAddress,
    };

    // Si aún no tenía imagen en Cloudinary, aprovechar para subirla ahora
    const hasImage = Array.isArray(p.images) && p.images.length > 0;
    if (!hasImage && gPlace.photos?.[0]?.name) {
      const cloudUrl = await uploadPhotoToCloudinary(gPlace.photos[0].name, id);
      if (cloudUrl) {
        updateFields.images = [cloudUrl];
      }
    }

    await collection.updateOne({ _id: p._id }, { $set: updateFields });

    cache[id] = {
      done: true,
      found: true,
      name: p.name,
      coordinates: [exactLng, exactLat],
      address: formattedAddress,
      imageAdded: Boolean(updateFields.images),
    };
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

    updatedCount++;
    console.log(`✅ ${p.name} → [${exactLng}, ${exactLat}] | ${formattedAddress}`);
    await sleep(300);
  } catch (err) {
    console.error(`❌ Error en ${p.name}:`, err.message);
  }
}

console.log(`\n🎉 Sincronización terminada. Documentos actualizados: ${updatedCount}`);
await mongoose.disconnect();