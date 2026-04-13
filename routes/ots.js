const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /OTs/list
router.get('/list', requireAuth, async (req, res) => {
  const { gomeria = 0, unidad = 0, estado = -1 } = req.query;

  const [gomerias, unidades, ots] = await Promise.all([
    sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`,
    sql`SELECT * FROM micro WHERE activo = 1 ORDER BY unidad`,
    sql`
      SELECT o.*, g.nombre AS gomeria_nombre, m.unidad
      FROM ots o
      LEFT JOIN gomeria g ON o.gomeria_id = g.id
      LEFT JOIN micro m ON o.unidad_id = m.id
      WHERE (${parseInt(gomeria)} = 0 OR o.gomeria_id = ${parseInt(gomeria)})
        AND (${parseInt(unidad)} = 0 OR o.unidad_id = ${parseInt(unidad)})
        AND (${parseInt(estado)} = -1 OR o.estado = ${parseInt(estado)})
      ORDER BY o.id DESC
    `,
  ]);

  res.render('OTs/list', {
    user: req.user, ots, gomerias, unidades,
    currentPage: 'inicio', filtros: { gomeria: parseInt(gomeria), unidad: parseInt(unidad), estado: parseInt(estado) }
  });
});

// GET /OTs/nueva
router.get('/nueva', requireAuth, async (req, res) => {
  const [gomerias, unidades, almacenes, modelos, medidas] = await Promise.all([
    sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`,
    sql`SELECT * FROM micro WHERE activo = 1 ORDER BY unidad`,
    sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`,
    sql`SELECT * FROM marcas_ruedas ORDER BY marca, modelo`,
    sql`SELECT * FROM medidas ORDER BY medida`,
  ]);
  res.render('OTs/nueva', { user: req.user, gomerias, unidades, almacenes, modelos, medidas, currentPage: 'inicio' });
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
    SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m2.medida, oc.posicion
    FROM ot_cubiertas oc
    JOIN cubiertas c ON oc.cubierta_id = c.id
    LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
    LEFT JOIN medidas m2 ON c.medida_id = m2.id
    WHERE oc.ot_id = ${ot}
    ORDER BY oc.posicion
  `;

  res.render('OTs/ver', { user: req.user, ot: rows[0], cubiertas, currentPage: 'inicio' });
});

// GET /OTs/editar?ot=X
router.get('/editar', requireAuth, async (req, res) => {
  const { ot } = req.query;
  const rows = await sql`
    SELECT o.*, g.nombre AS gomeria_nombre, m.unidad
    FROM ots o
    LEFT JOIN gomeria g ON o.gomeria_id = g.id
    LEFT JOIN micro m ON o.unidad_id = m.id
    WHERE o.id = ${ot}
  `;
  if (!rows.length) return res.redirect('/OTs/list');
  if (rows[0].estado == 1) return res.redirect('/OTs/ver?ot=' + ot);

  const [gomerias, unidades, almacenes, modelos, medidas, ot_cubiertas] = await Promise.all([
    sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`,
    sql`SELECT * FROM micro WHERE activo = 1 ORDER BY unidad`,
    sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`,
    sql`SELECT * FROM marcas_ruedas ORDER BY marca, modelo`,
    sql`SELECT * FROM medidas ORDER BY medida`,
    sql`SELECT oc.posicion, oc.cubierta_id, c.fuego FROM ot_cubiertas oc JOIN cubiertas c ON oc.cubierta_id = c.id WHERE oc.ot_id = ${ot} AND oc.posicion IS NOT NULL`,
  ]);

  res.render('OTs/editar', {
    user: req.user, ot: rows[0], gomerias, unidades, almacenes, modelos, medidas, ot_cubiertas, currentPage: 'inicio'
  });
});

module.exports = router;
