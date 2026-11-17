import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const API = process.env.API || 'https://backend-travexperience-1.onrender.com/api/v1';
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

if (!GOOGLE_KEY) {
  console.error('❌ Falta GOOGLE_MAPS_API_KEY en el .env');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Buscar el lugar en Google Places API (New)
async function searchGooglePlace(name, lat, lng) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.photos',
    },
    body: JSON.stringify({
      textQuery: `${name}, Sierra Norte de Puebla, Mexico`,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 1500.0,
        },
      },
      maxResultCount: 1,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.places?.[0] || null;
}

// 2. Descargar la foto de Places y subirla directo a Cloudinary
async function uploadPlacePhotoToCloudinary(photoName, placeId) {
  const googlePhotoUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=900&key=${GOOGLE_KEY}`;
  const imgRes = await fetch(googlePhotoUrl);
  if (!imgRes.ok) return null;

  const arrayBuffer = await imgRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'travexperience-places',
        public_id: `place_${placeId}`,
        overwrite: true,
        resource_type: 'image',
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// Ejecución principal
const CACHE_FILE = 'cloudinary_places_map.json';
const results = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};

const res = await fetch(`${API}/local/nearby?lat=20.2822&lng=-97.9497&radius=50000&limit=100`);
const raw = await res.json();
const places = raw.data?.places || raw.places || [];

console.log(`Procesando ${places.length} lugares...`);

for (const p of places) {
  const id = String(p._id || p.id);
  if (results[id]?.cloudinaryUrl) {
    console.log(`⏭️  Saltando (ya migrado): ${p.name}`);
    continue;
  }

  const c = p.location?.coordinates;
  const lat = c ? c[1] : p.lat;
  const lng = c ? c[0] : p.lng;

  if (lat == null || lng == null) continue;

  try {
    const gPlace = await searchGooglePlace(p.name, lat, lng);
    const firstPhoto = gPlace?.photos?.[0]?.name;

    if (!firstPhoto) {
      console.log(`⚠️  Sin foto en Google: ${p.name}`);
      results[id] = { name: p.name, cloudinaryUrl: null };
      continue;
    }

    const cloudinaryUrl = await uploadPlacePhotoToCloudinary(firstPhoto, id);
    results[id] = { name: p.name, cloudinaryUrl };
    console.log(`✅ ${p.name} → ${cloudinaryUrl}`);

    // Guardar progreso en cada iteración por si se interrumpe
    writeFileSync(CACHE_FILE, JSON.stringify(results, null, 2));
    await sleep(300);
  } catch (err) {
    console.error(`❌ Error en ${p.name}:`, err.message);
  }
}

console.log(`Listo. Mapa guardado en ${CACHE_FILE}`);