import 'dotenv/config';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';

const map = JSON.parse(readFileSync('cloudinary_places_map.json', 'utf8'));

await mongoose.connect(process.env.MONGO_URI);
// Usa el nombre exacto de tu colección en MongoDB (ej. 'places')
const collection = mongoose.connection.db.collection('places');

let updated = 0;
for (const [id, item] of Object.entries(map)) {
  if (!item.cloudinaryUrl) continue;

  const filter = mongoose.Types.ObjectId.isValid(id)
    ? { _id: new mongoose.Types.ObjectId(id) }
    : { _id: id };

  const res = await collection.updateOne(filter, {
    $set: { images: [item.cloudinaryUrl] }, // ajusta si tu campo es 'image' o 'photos'
  });

  if (res.modifiedCount > 0) updated++;
}

console.log(`✅ Documentos actualizados en MongoDB: ${updated}`);
await mongoose.disconnect();