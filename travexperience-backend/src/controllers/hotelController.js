/**
 * controllers/hotelController.js
 * -----------------------------------------------------------------------
 * CRUD de hoteles para administradores (Admin/registroHotel.jsx,
 * Admin/inventario.jsx en el frontend) + búsqueda pública/geoespacial
 * para la App Móvil y la Plataforma Web.
 *
 * Sigue el mismo patrón que localTourismController.createPlace: si el
 * admin no manda lat/lng pero sí una dirección de texto, se geocodifica
 * automáticamente con Nominatim (OSM) antes de guardar.
 * -----------------------------------------------------------------------
 */

const Hotel = require('../models/mongodb/Hotel');
const Favorite = require('../models/mongodb/Favorite');
const ActivityLog = require('../models/mongodb/ActivityLog');
const geocodingService = require('../services/geocodingService');
const AppError = require('../utils/AppError');
const ApiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { toPublicUrl } = require('../utils/upload');
const { withNormalizedImages } = require('../utils/mediaUrls');

const DEFAULT_RADIUS_METERS = 10000;
const MAX_RADIUS_METERS = 50000;

/**
 * Verifica que el hotel exista y que el usuario autenticado tenga permiso
 * para modificarlo: o bien es el dueño original (mismo ownerId), o bien
 * tiene rol "administrador" (los administradores pueden gestionar
 * cualquier hotel del catálogo, no solo los que ellos mismos crearon).
 *
 * Se compara con String(...) en ambos lados porque ownerId puede venir
 * como Number en Mongo mientras que user.id (payload del JWT) puede venir
 * como Number o String según cómo se firmó el token — comparar con !==
 * a secas puede dar falsos "no es el dueño" por un simple mismatch de tipo.
 */
const findOwnedHotel = async (id, user) => {
  const hotel = await Hotel.findById(id);
  if (!hotel) {
    throw new AppError('Hotel no encontrado.', 404);
  }

  const isOwner = String(hotel.ownerId) === String(user.id);
  const isAdmin = user.role === 'administrador';

  if (!isOwner && !isAdmin) {
    throw new AppError('No tienes permiso para modificar este hotel.', 403);
  }
  return hotel;
};

/**
 * GET /hotels
 * Listado público con filtros simples y paginación (Plataforma Web / inventario admin).
 * Un administrador que pase ?mine=true solo ve los suyos (Admin/inventario.jsx).
 */
const listHotels = async (req, res, next) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Number(req.query.pageSize) || 12, 50);

    const filter = { isActive: true };
    if (req.query.municipality) filter.municipality = req.query.municipality;
    if (req.query.mine === 'true' && req.user) filter.ownerId = req.user.id;

    const [hotels, total] = await Promise.all([
      Hotel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      Hotel.countDocuments(filter),
    ]);

    return ApiResponse.success(res, 200, 'Hoteles obtenidos.', { total, page, pageSize, hotels });
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /hotels/nearby?lat=&lng=&radius=
 * Búsqueda geoespacial, análoga a GET /local/nearby pero sobre el catálogo de hoteles.
 */
const getNearbyHotels = async (req, res, next) => {
  try {
    const { lat, lng, radius, limit } = req.query;

    if (lat === undefined || lng === undefined) {
      throw new AppError('Se requieren los parámetros "lat" y "lng".', 400);
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    const maxDistance = Math.min(Number(radius) || DEFAULT_RADIUS_METERS, MAX_RADIUS_METERS);
    const resultLimit = Math.min(Number(limit) || 20, 50);

    const hotels = await Hotel.find({
      isActive: true,
      location: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
          $maxDistance: maxDistance,
        },
      },
    }).limit(resultLimit);

    // Log de actividad (no bloqueante) — mismo patrón que localTourismController,
    // necesario para que los mecanismos de ML sobre activitylogs tengan
    // datos simétricos de places y hotels.
    ActivityLog.create({
      userId: req.user?.id,
      eventType: 'search',
      entityType: 'hotel',
      source: req.headers['x-client-platform'] || 'mobile',
      metadata: { lat: latitude, lng: longitude, resultsCount: hotels.length },
    }).catch(() => {});

    return ApiResponse.success(res, 200, 'Hoteles cercanos obtenidos.', {
      count: hotels.length,
      radiusMeters: maxDistance,
      hotels: hotels.map(withNormalizedImages),
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /hotels/:id
 */
const getHotelById = async (req, res, next) => {
  try {
    const hotel = await Hotel.findById(req.params.id).lean();
    if (!hotel || !hotel.isActive) {
      throw new AppError('Hotel no encontrado.', 404);
    }

    ActivityLog.create({
      userId: req.user?.id,
      eventType: 'view_hotel',
      entityType: 'hotel',
      entityId: hotel._id,
      source: req.headers['x-client-platform'] || 'mobile',
      metadata: { hotelName: hotel.name },
    }).catch(() => {});

    if (req.user?.id) {
      const favorite = await Favorite.findOne({
        userId: req.user.id,
        entityType: 'hotel',
        entityId: hotel._id,
      }).lean();
      hotel.isFavorite = !!favorite;
      hotel.favoriteId = favorite?._id || null;
    }

    return ApiResponse.success(res, 200, 'Detalle del hotel obtenido.', { hotel: withNormalizedImages(hotel) });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /hotels
 * Solo administradores. Si no se envían lat/lng pero sí address, geocodifica con Nominatim (OSM).
 */
const createHotel = async (req, res, next) => {
  try {
    const {
      name, category, description, address, municipality,
      mainImage, images, amenities, rooms,
    } = req.body;
    let { lat, lng } = req.body;

    if (lat === undefined || lng === undefined) {
      if (!address) {
        throw new AppError('Se requieren coordenadas ("lat"/"lng") o una "address" para geocodificar.', 422);
      }
      try {
        const geocoded = await geocodingService.geocodeAddress(address);
        lat = geocoded.lat;
        lng = geocoded.lng;
      } catch (geoError) {
        if (geoError.code === 'NOT_FOUND') {
          throw new AppError('No se pudo geocodificar la dirección proporcionada.', 422);
        }
        throw new AppError('El servicio de geocodificación no está disponible en este momento.', 503);
      }
    }

    // Sin imágenes => images: [] (el frontend muestra una imagen de respaldo).
    const finalMainImage = mainImage || undefined;
    const finalImages = Array.isArray(images) ? images : [];

    const hotel = await Hotel.create({
      name,
      category,
      description,
      address,
      municipality,
      location: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
      mainImage: finalMainImage,
      images: finalImages,
      source: 'manual',
      amenities,
      rooms,
      ownerId: req.user.id,
    });

    return ApiResponse.success(res, 201, 'Hotel registrado.', { hotel });
  } catch (error) {
    return next(error);
  }
};

/**
 * PUT /hotels/:id
 * El administrador dueño del hotel, o cualquier usuario con rol
 * "administrador", puede editarlo (ver findOwnedHotel).
 */
const updateHotel = async (req, res, next) => {
  try {
    const hotel = await findOwnedHotel(req.params.id, req.user);

    const editableFields = [
      'name', 'category', 'description', 'address', 'municipality',
      'mainImage', 'images', 'amenities', 'rooms', 'isActive',
    ];
    editableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        hotel[field] = req.body[field];
      }
    });

    if (req.body.lat !== undefined && req.body.lng !== undefined) {
      hotel.location = { type: 'Point', coordinates: [Number(req.body.lng), Number(req.body.lat)] };
    }

    await hotel.save();

    return ApiResponse.success(res, 200, 'Hotel actualizado.', { hotel });
  } catch (error) {
    return next(error);
  }
};

/**
 * DELETE /hotels/:id
 */
const deleteHotel = async (req, res, next) => {
  try {
    const hotel = await findOwnedHotel(req.params.id, req.user);
    await hotel.deleteOne();
    return ApiResponse.success(res, 200, 'Hotel eliminado.');
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /hotels/:id/images
 * El administrador dueño del hotel, o cualquier usuario con rol
 * "administrador" (ver findOwnedHotel). Multipart/form-data: campo
 * "images" (hasta 10, se agregan al arreglo `images`) y opcionalmente
 * "mainImage" (un solo archivo, reemplaza la portada). Responde con el
 * mismo formato que updateHotel.
 */
const addHotelImages = async (req, res, next) => {
  try {
    const hotel = await findOwnedHotel(req.params.id, req.user);

    const imageFiles = (req.files && req.files.images) || [];
    const mainImageFile = req.files && req.files.mainImage && req.files.mainImage[0];

    if (imageFiles.length === 0 && !mainImageFile) {
      throw new AppError(
        'Se requiere al menos un archivo en el campo "images" o "mainImage".',
        400
      );
    }

    if (imageFiles.length > 0) {
      const uploadedUrls = imageFiles.map((file) => toPublicUrl(file.path));
      hotel.images = [...(hotel.images || []), ...uploadedUrls];
    }

    if (mainImageFile) {
      hotel.mainImage = toPublicUrl(mainImageFile.path);
    }

    await hotel.save();

    return ApiResponse.success(res, 200, 'Imágenes del hotel actualizadas.', { hotel });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listHotels,
  getNearbyHotels,
  getHotelById,
  createHotel,
  updateHotel,
  deleteHotel,
  addHotelImages,
};
