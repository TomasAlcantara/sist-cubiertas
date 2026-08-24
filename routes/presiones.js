const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requirePerm } = require('../middleware/auth');
const { leerConfigInt, MM_DEFAULTS } = require('../lib/config');

// GET /presiones — tabla de consulta para el taller
router.get('/', requirePerm('cubiertas_ver'), async (req, res, next) => {
  try {
    const [medidas, cfg] = await Promise.all([
      sql`SELECT id, medida, presion FROM medidas ORDER BY medida`,
      leerConfigInt(MM_DEFAULTS),
    ]);
    res.render('presiones/index', {
      user: req.user, medidas: medidas || [], cfg, currentPage: 'presiones',
    });
  } catch (err) { next(err); }
});

module.exports = router;
