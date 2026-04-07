const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /OTs/list
router.get('/list', requireAuth, async (req, res) => {
  const { gomeria = 0, unidad = 0, estado = -1, recapadora = 0 } = req.query;

  const gomerias = await sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`;
  const unidades = await sql`SELECT * FROM micro WHERE activo = 1 ORDER BY unidad`;
  const recapadoras = await sql`SELECT * FROM recapadora WHERE activo = 1 ORDER BY nombre`;

  const ots = await sql`
    SELECT o.*, g.nombre AS gomeria_nombre, r.nombre AS recapadora_nombre, m.unidad
    FROM ots o
    LEFT JOIN gomeria g ON o.gomeria_id = g.id
    LEFT JOIN recapadora r ON o.recapadora_id = r.id
    LEFT JOIN micro m ON o.unidad_id = m.id
    WHERE (${parseInt(gomeria)} = 0 OR o.gomeria_id = ${parseInt(gomeria)})
      AND (${parseInt(unidad)} = 0 OR o.unidad_id = ${parseInt(unidad)})
      AND (${parseInt(estado)} = -1 OR o.estado = ${parseInt(estado)})
      AND (${parseInt(recapadora)} = 0 OR o.recapadora_id = ${parseInt(recapadora)})
    ORDER BY o.id DESC
  `;

  res.render('OTs/list', {
    user: req.user, ots, gomerias, unidades, recapadoras,
    currentPage: 'inicio', filtros: { gomeria: parseInt(gomeria), unidad: parseInt(unidad), estado: parseInt(estado), recapadora: parseInt(recapadora) }
  });
});

// GET /OTs/nueva
router.get('/nueva', requireAuth, async (req, res) => {
  const gomerias = await sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`;
  const recapadoras = await sql`SELECT * FROM recapadora WHERE activo = 1 ORDER BY nombre`;
  res.render('OTs/nueva', { user: req.user, gomerias, recapadoras, currentPage: 'inicio' });
});

// GET /OTs/ver?ot=X
router.get('/ver', requireAuth, async (req, res) => {
  const { ot } = req.query;
  const rows = await sql`
    SELECT o.*, g.nombre AS gomeria_nombre, r.nombre AS recapadora_nombre, m.unidad, m.km_actual
    FROM ots o
    LEFT JOIN gomeria g ON o.gomeria_id = g.id
    LEFT JOIN recapadora r ON o.recapadora_id = r.id
    LEFT JOIN micro m ON o.unidad_id = m.id
    WHERE o.id = ${ot}
  `;
  if (!rows.length) return res.redirect('/OTs/list');

  const cubiertas = await sql`
    SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m2.medida
    FROM ot_cubiertas oc
    JOIN cubiertas c ON oc.cubierta_id = c.id
    LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
    LEFT JOIN medidas m2 ON c.medida_id = m2.id
    WHERE oc.ot_id = ${ot}
  `;

  res.render('OTs/ver', { user: req.user, ot: rows[0], cubiertas, currentPage: 'inicio' });
});

module.exports = router;
