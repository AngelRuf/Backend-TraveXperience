import { writeFileSync } from 'node:fs';

const API = process.env.API || 'https://backend-travexperience-1.onrender.com/api/v1';
const UA = 'TraveXperience/1.0 (angelruf87@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function commonsNear(lat, lng) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'geosearch',
    ggscoord: `${lat}|${lng}`,
    ggsradius: '1500',
    ggsnamespace: '6',
    ggslimit: '5',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '900',
  });

  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': UA },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Wikimedia HTTP ${res.status}: ${text.slice(0, 150)}`);
  const data = JSON.parse(text);

  return Object.values(data.query?.pages || {})
    .map((p) => ({ title: p.title, info: p.imageinfo?.[0] }))
    .filter((x) => x.info && /\.(jpe?g|png)$/i.test(x.info.url))
    .map((x) => ({
      url: x.info.thumburl || x.info.url,
      page: x.info.descriptionurl,
      author: (x.info.extmetadata?.Artist?.value || '').replace(/<[^>]+>/g, '').trim(),
      license: x.info.extmetadata?.LicenseShortName?.value || '',
    }));
}

console.log('1. Consultando lugares en Render...');
const res = await fetch(`${API}/local/nearby?lat=20.2822&lng=-97.9497&radius=50000&limit=50`);
const rawText = await res.text();

if (!res.ok) {
  console.error(`❌ Error HTTP ${res.status} desde Render:\n`, rawText.slice(0, 300));
  process.exit(1);
}

const raw = JSON.parse(rawText);
const places = Array.isArray(raw)
  ? raw
  : raw.data?.places || raw.places || raw.results || (Array.isArray(raw.data) ? raw.data : []);

console.log(`2. Lugares encontrados: ${places.length}`);

if (places.length === 0) {
  console.log('⚠️ Estructura recibida desde el backend:', JSON.stringify(raw, null, 2).slice(0, 500));
  process.exit(0);
}

const out = [];
for (const p of places) {
  const c = p.location?.coordinates; // [lng, lat]
  const lat = c ? c[1] : p.lat ?? p.latitude;
  const lng = c ? c[0] : p.lng ?? p.longitude;

  if (lat == null || lng == null) {
    out.push({ id: p._id || p.id, name: p.name, candidates: [], nota: 'sin coordenadas' });
    continue;
  }

  const candidates = await commonsNear(lat, lng);
  out.push({ id: p._id || p.id, name: p.name, candidates });
  console.log(`   ✔ ${p.name} → ${candidates.length} candidatos`);
  await sleep(1100);
}

writeFileSync('photos.json', JSON.stringify(out, null, 2));
console.log('✅ Listo: revisa photos.json');