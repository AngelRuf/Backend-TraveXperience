const express = require('express');
const { query } = require('express-validator');
const router = express.Router();
const { getNearbyRisks } = require('../controllers/riskController');
const validateRequest = require('../middlewares/validateRequest');

// GET /api/v1/risks/nearby?lat=&lng=&radius=&municipality=
router.get(
  '/nearby',
  [
    query('lat').optional().isFloat({ min: -90, max: 90 }).withMessage('Latitud inválida.'),
    query('lng').optional().isFloat({ min: -180, max: 180 }).withMessage('Longitud inválida.'),
    query('radius').optional().isInt({ min: 100, max: 50000 }).withMessage('Radio inválido.'),
    query('municipality').optional().trim().isLength({ min: 1, max: 100 }),
  ],
  validateRequest,
  getNearbyRisks
);

module.exports = router;