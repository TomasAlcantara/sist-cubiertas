const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /recapadoras
router.get('/', requireAuth, async (req, res) => {
  const { recapadora = 0, estado = -1 } = req.query;
  const recapadoras = await sql`SELECT * FROM recapadora WHERE activo = 1 ORDER BY nombre`;

  const ots = await sql`
    SELECT o.*, r.nombre AS recapadora_nombre
    FROM ots o
    LEFT JOIN recapadora r ON o.recapadora_id = r.id
    WHERE (${parseInt(recapadora)} = 0 OR o.recapadora_id = ${parseInt(recapadora)})
      AND (${parseInt(estado)} = -1 OR o.estado = ${parseInt(estado)})
    ORDER BY o.id DESC
  `;

  res.render('recapadoras/index', {
    user: req.user, ots, recapadoras,
    currentPage: 'inicio', filtros: { recapadora: parseInt(recapadora), estado: parseInt(estado) }
  });
});

module.exports = router;
