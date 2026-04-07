const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /CargaKm
router.get('/', requireAuth, async (req, res) => {
  const unidades = await sql`SELECT * FROM micro WHERE activo = 1 ORDER BY unidad`;
  res.render('CargaKm/index', { user: req.user, unidades, currentPage: 'inicio' });
});

// GET /CargaKm/result?id=X
router.get('/result', requireAuth, async (req, res) => {
  const { id } = req.query;
  const micro = await sql`SELECT * FROM micro WHERE id = ${id}`;
  if (!micro.length) return res.redirect('/CargaKm');
  res.render('CargaKm/result', { user: req.user, micro: micro[0], currentPage: 'inicio' });
});

module.exports = router;
