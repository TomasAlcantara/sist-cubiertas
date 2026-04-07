const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /gomerias - Lista de gomerías
router.get('/', requireAuth, async (req, res) => {
  const gomerias = await sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`;
  res.render('gomerias/index', { user: req.user, gomerias, currentPage: 'inicio' });
});

// GET /gomerias/view?id=X - Ver cubiertas de una gomería
router.get('/view', requireAuth, async (req, res) => {
  const { id, fuego = '', modelo = 0, estado = 0, orderby = 0 } = req.query;

  const gomeria = await sql`SELECT * FROM gomeria WHERE id = ${id}`;
  if (!gomeria.length) return res.redirect('/gomerias');

  const modelos = await sql`SELECT * FROM marcas_ruedas WHERE activo = 1 ORDER BY marca, modelo`;
  const almacenes = await sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`;

  let orderExpr = 'c.fuego ASC';
  const ordMap = { 1: 'c.fuego ASC', 11: 'c.fuego DESC', 2: 'mr.marca ASC', 12: 'mr.marca DESC', 3: 'm.medida ASC', 13: 'm.medida DESC', 4: 'c.estado ASC', 14: 'c.estado DESC', 5: 'c.km ASC', 15: 'c.km DESC' };
  if (ordMap[orderby]) orderExpr = ordMap[orderby];

  const cubiertas = await sql`
    SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m.medida
    FROM cubiertas c
    LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
    LEFT JOIN medidas m ON c.medida_id = m.id
    WHERE c.gomeria_id = ${id} AND c.activo = 1
      AND (${fuego} = '' OR c.fuego ILIKE ${'%' + fuego + '%'})
      AND (${parseInt(modelo)} = 0 OR c.modelo_id = ${parseInt(modelo)})
      AND (${parseInt(estado)} = 0 OR c.estado = ${parseInt(estado)})
    ORDER BY ${sql.unsafe(orderExpr)}
  `;

  res.render('gomerias/view', {
    user: req.user, gomeria: gomeria[0], cubiertas, modelos, almacenes,
    currentPage: 'inicio', filtros: { fuego, modelo: parseInt(modelo), estado: parseInt(estado), orderby: parseInt(orderby) }
  });
});

module.exports = router;
