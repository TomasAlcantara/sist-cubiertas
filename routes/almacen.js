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
  const { id, fuego = '', modelo = 0, medida = 0, estado = 0, orderby = 0 } = req.query;

  const almacen = await sql`SELECT * FROM almacen WHERE id = ${id}`;
  if (!almacen.length) return res.redirect('/almacen');

  const [modelos, medidas, almacenes] = await Promise.all([
    sql`SELECT * FROM marcas_ruedas WHERE activo = 1 ORDER BY marca, modelo`,
    sql`SELECT * FROM medidas ORDER BY medida`,
    sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`,
  ]);

  const ordMap = { 1: 'c.fuego ASC', 11: 'c.fuego DESC', 2: 'mr.marca ASC', 12: 'mr.marca DESC', 3: 'm.medida ASC', 13: 'm.medida DESC', 4: 'c.estado ASC', 14: 'c.estado DESC', 5: 'c.km ASC', 15: 'c.km DESC' };
  const orderExpr = ordMap[parseInt(orderby)] || 'c.fuego ASC';

  const cubiertas = await sql(
    `SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m.medida
     FROM cubiertas c
     LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
     LEFT JOIN medidas m ON c.medida_id = m.id
     WHERE c.almacen_id = $1 AND c.activo = 1
       AND ($2 = '' OR c.fuego ILIKE $3)
       AND ($4 = 0 OR c.modelo_id = $4)
       AND ($5 = 0 OR c.medida_id = $5)
       AND ($6 = 0 OR c.estado = $6)
     ORDER BY ${orderExpr}`,
    [id, fuego, '%' + fuego + '%', parseInt(modelo), parseInt(medida), parseInt(estado)]
  );

  res.render('almacen/view', {
    user: req.user, almacen: almacen[0], cubiertas, modelos, medidas, almacenes,
    currentPage: 'inicio',
    filtros: { fuego, modelo: parseInt(modelo), medida: parseInt(medida), estado: parseInt(estado), orderby: parseInt(orderby) }
  });
});

module.exports = router;
