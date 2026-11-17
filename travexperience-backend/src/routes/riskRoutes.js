const express = require('express');
const router = express.Router();
const { getNearbyRisks } = require('../controllers/riskController');
// Si tienes middlewares de auth/roles para crear alertas desde el panel admin:
// const { protect, authorize } = require('../middlewares/auth');

// GET /api/v1/risks/nearby?lat=&lng=&radius=&municipality=
router.get('/nearby', getNearbyRisks);

// Opcional: endpoint protegido para registrar o actualizar avisos oficiales
// router.post('/', protect, authorize('admin'), createRiskAlert);

module.exports = router;