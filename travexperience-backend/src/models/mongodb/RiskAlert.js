// models/RiskAlert.js
const { mongoose } = require('../config/mongodb');

const riskAlertSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    severity: { type: String, enum: ['bajo', 'moderado', 'alto'], required: true },
    recommendation: { type: String, required: true },
    municipality: { type: String, required: true },
    source: { type: String, required: true }, // ej. "Protección Civil Puebla / CONAGUA"
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

riskAlertSchema.index({ location: '2dsphere' });
// MongoDB borra el documento automáticamente cuando pasa expiresAt
riskAlertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RiskAlert', riskAlertSchema);