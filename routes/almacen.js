const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /almacen - Lista de almacenes
router.get('/', requireAuth, async (req, res) => {
  const almacenes = await sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`;
  res.render('almacen/index', { user: req.user, almacenes, currentPage: 'inicio' });
});

// GET /almacen/view?id=X - Ver cubiertas de un almacén
router.get('/view', requireAuth, async (req, res) => {
  const { id, fuego = '', modelo = 0, estado = 0, orderby = 0 } = req.query;

  const almacen = await sql`SELECT * FROM almacen WHERE id = ${id}`;
  if (!almacen.length) return res.redirect('/almacen');

  const modelos = await sql`SELECT * FROM marcas_ruedas WHERE activo = 1 ORDER BY marca, modelo`;
  const almacenes = await sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`;

  let orderCol = 'c.fuego', orderDir = 'ASC';
  const ordMap = { 1: 'c.fuego', 2: 'mr.marca', 11: 'c.fuego DESC', 12: 'mr.marca DESC', 3: 'm.medida', 13: 'm.medida DESC', 4: 'c.estado', 14: 'c.estado DESC', 5: 'c.km', 15: 'c.km DESC' };
  if (ordMap[orderby]) { orderCol = ordMap[orderby]; orderDir = ''; }

  const cubiertas = await sql`
    SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m.medida
    FROM cubiertas c
    LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
    LEFT JOIN medidas m ON c.medida_id = m.id
    WHERE c.almacen_id = ${id} AND c.activo = 1
      AND (${fuego} = '' OR c.fuego ILIKE ${'%' + fuego + '%'})
      AND (${parseInt(modelo)} = 0 OR c.modelo_id = ${parseInt(modelo)})
      AND (${parseInt(estado)} = 0 OR c.estado = ${parseInt(estado)})
    ORDER BY ${sql.unsafe(orderCol + (orderDir ? ' ' + orderDir : ''))}
  `;

  res.render('almacen/view', {
    user: req.user, almacen: almacen[0], cubiertas, modelos, almacenes,
    currentPage: 'inicio', filtros: { fuego, modelo: parseInt(modelo), estado: parseInt(estado), orderby: parseInt(orderby) }
  });
});

module.exports = router;
