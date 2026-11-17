const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const AppError = require('../utils/AppError');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => {
    const extension = file.originalname.split('.').pop().toLowerCase();
    if (
      !allowedMimeTypes.has(file.mimetype) ||
      !['jpg', 'jpeg', 'png', 'webp'].includes(extension)
    ) {
      return callback(new AppError('Solo se permiten imágenes jpg, jpeg, png o webp.', 400));
    }
    return callback(null, true);
  },
});

const uploadToCloudinary = (file) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'travexperience-places',
        transformation: [{ width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result || !result.secure_url) {
          return reject(new Error('Cloudinary no devolvió una URL segura para la imagen.'));
        }
        return resolve(result.secure_url);
      }
    );
    stream.end(file.buffer);
  });

const uploadPlacePhotos = (req, res, next) => {
  upload.array('images', 5)(req, res, async (multerError) => {
    if (multerError) {
      if (multerError.code === 'LIMIT_FILE_SIZE') multerError.statusCode = 413;
      else if (multerError.code === 'LIMIT_FILE_COUNT') multerError.statusCode = 400;
      return next(multerError);
    }

    try {
      const files = req.files || [];
      req.uploadedImageUrls = files.length
        ? await Promise.all(files.map(uploadToCloudinary))
        : [];
      return next();
    } catch (error) {
      return next(error);
    }
  });
};

module.exports = uploadPlacePhotos;
