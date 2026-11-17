// controllers/riskController.js
const RiskAlert = require('../models/RiskAlert');

const getNearbyRisks = async (req, res, next) => {
  try {
    const { lat, lng, radius = 50000, municipality } = req.query;
    const now = new Date();

    const filter = {
      expiresAt: { $gt: now },
    };

    if (municipality) {
      filter.municipality = new RegExp(`^${municipality}$`, 'i');
    }

    if (lat && lng) {
      filter.location = {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseInt(radius, 10),
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
      location: a.location, // { type: 'Point', coordinates: [lng, lat] }
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