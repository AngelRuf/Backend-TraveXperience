// controllers/riskController.js
const RiskAlert = require('../models/mongodb/RiskAlert');
const AppError = require('../utils/AppError');

const getNearbyRisks = async (req, res, next) => {
  try {
    const { lat, lng, radius = 50000, municipality } = req.query;
    const now = new Date();
    if ((lat === undefined) !== (lng === undefined)) {
      throw new AppError('Se deben proporcionar "lat" y "lng" juntos.', 400);
    }
    if (lat === undefined && !municipality) {
      throw new AppError('Se requieren coordenadas o el parámetro "municipality".', 400);
    }

    const filter = {
      expiresAt: { $gt: now },
    };

    if (municipality) {
      const escapedMunicipality = municipality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.municipality = new RegExp(`^${escapedMunicipality}$`, 'i');
    }

    if (lat !== undefined && lng !== undefined) {
      filter.location = {
        $near: {
          $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
          $maxDistance: Number(radius),
        },
      };
    }

    const alerts = await RiskAlert.find(filter).lean();

    const risks = alerts.map((a) => ({
      id: a._id,
      title: a.title,
      severity: a.severity,
      recommendation: a.recommendation,
      municipality: a.municipality,
      location: a.location,
      source: a.source,
      updatedAt: a.updatedAt,
      expiresAt: a.expiresAt,
    }));

    return res.json({
      success: true,
      data: { risks },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getNearbyRisks };