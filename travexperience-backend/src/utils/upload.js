const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configuración de Cloudinary con variables de entorno
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const imageFileFilter = (_req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten imágenes.'));
  }
};

/**
 * Crea una instancia de multer con almacenamiento en Cloudinary dentro de
 * la carpeta `travexperience-<subfolder>`. Permite reusar el mismo filtro/límite 
 * de tamaño para distintos recursos (perfiles, lugares, hoteles) sin repetir código.
 */
const createUploader = (subfolder) => {
  const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: `travexperience-${subfolder}`,
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
    }
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter,
  });
};

// Instancias ya listas para los recursos existentes.
const upload = createUploader('profiles'); // foto de perfil / avatar
const placesUpload = createUploader('places');
const hotelsUpload = createUploader('hotels');

/**
 * En la versión de almacenamiento en disco, esta función convertía la ruta 
 * absoluta en una ruta relativa pública. 
 * Con Cloudinary, req.file.path ya es una URL pública segura (https://res...), 
 * así que simplemente retornamos la misma ruta para no romper los controladores.
 */
const toPublicUrl = (filePath) => {
  return filePath;
};

module.exports = { upload, placesUpload, hotelsUpload, createUploader, toPublicUrl }; 