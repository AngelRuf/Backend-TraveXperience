/**
 * controllers/weatherController.js
 * -----------------------------------------------------------------------
 * Módulo Clima. Consulta OpenWeatherMap por coordenadas, o por el nombre
 * de un destino (en cuyo caso primero se geocodifica con Google Maps).
 * -----------------------------------------------------------------------
 */

const weatherService = require('../services/weatherService');
const geocodingService = require('../services/geocodingService');
const AppError = require('../utils/AppError');
const ApiResponse = require('../utils/apiResponse');

/**
 * GET /weather?lat=&lng=
 * GET /weather?destination=Xicotepec+de+Juárez
 */
const getWeather = async (req, res, next) => {
  try {
    let { lat, lng } = req.query;
    const { destination } = req.query;

    if ((lat === undefined || lng === undefined) && !destination) {
      throw new AppError('Se requieren los parámetros "lat" y "lng", o bien "destination".', 400);
    }

    if ((lat === undefined || lng === undefined) && destination) {
      try {
        const geocoded = await geocodingService.geocodeAddress(destination);
        lat = geocoded.lat;
        lng = geocoded.lng;
      } catch (geoError) {
        if (geoError.code === 'NOT_FOUND') {
          throw new AppError('No se pudo ubicar el destino indicado.', 422);
        }
        throw new AppError('El servicio de geocodificación no está disponible en este momento.', 503);
      }
    }

    let weather;
    try {
      weather = await weatherService.getWeatherByCoords(lat, lng);
    } catch (weatherError) {
      throw new AppError('El servicio de clima no está disponible en este momento.', 503);
    }

    return ApiResponse.success(res, 200, 'Clima obtenido.', { weather });
  } catch (error) {
    return next(error);
  }
};
// controllers/weatherController.js
const getForecast = async (req, res, next) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ success: false, message: 'lat y lng son requeridos' });
    }

    // Usando Open-Meteo (gratuito, sin API key y con datos diarios confiables para Sierra Norte)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FMexico_City`;
    const response = await fetch(url);
    const raw = await response.json();

    const weatherDescriptions = {
      0: 'Despejado', 1: 'Mayormente despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
      45: 'Neblina', 48: 'Neblina densa', 51: 'Llovizna ligera', 61: 'Lluvia ligera',
      63: 'Lluvia moderada', 65: 'Lluvia fuerte', 80: 'Chubascos', 95: 'Tormenta eléctrica',
    };

    const forecast = (raw.daily?.time || []).map((date, i) => ({
      date,
      tempMin: raw.daily.temperature_2m_min[i],
      tempMax: raw.daily.temperature_2m_max[i],
      description: weatherDescriptions[raw.daily.weathercode[i]] || 'Condición variable',
      rainProbability: raw.daily.precipitation_probability_max[i] ?? 0,
    }));

    return res.json({
      success: true,
      data: { forecast },
    });
  } catch (error) {
    next(error);
  }
};
module.exports = { getWeather };
