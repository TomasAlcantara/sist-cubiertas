const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

const ORD_MAP = {
  1: 'c.fuego ASC', 11: 'c.fuego DESC',
  2: 'mr.marca ASC', 12: 'mr.marca DESC',
  3: 'm.medida ASC', 13: 'm.medida DESC',
  4: 'c.estado ASC', 14: 'c.estado DESC',
  5: 'c.km ASC', 15: 'c.km DESC',
};

// GET /gomerias - Lista de gomerías
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const gomerias = await sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`;
    res.render('gomerias/index', { user: req.user, gomerias, currentPage: 'inicio' });
  } catch (err) { next(err); }
});

// GET /gomerias/view?id=X - Ver cubiertas de una gomería
router.get('/view', requireAuth, async (req, res, next) => {
  try {
    const { id, fuego = '', modelo = 0, medida = 0, estado = 0, orderby = 0 } = req.query;

    const gomeria = await sql`SELECT * FROM gomeria WHERE id = ${parseInt(id) || 0}`;
    if (!gomeria.length) return res.redirect('/gomerias');

    // Gomería users can only view their own gomería
    if (parseInt(req.user.tipo) === 0 && parseInt(req.user.gomeria_id) !== parseInt(id)) {
      return res.redirect('/gomerias');
    }

    const [modelos, medidas, almacenes] = await Promise.all([
      sql`SELECT * FROM marcas_ruedas WHERE activo = 1 ORDER BY marca, modelo`,
      sql`SELECT * FROM medidas ORDER BY medida`,
      sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`,
    ]);

    const orderExpr = ORD_MAP[parseInt(orderby)] || 'c.fuego ASC';

    const cubiertas = await sql(
      `SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m.medida
       FROM cubiertas c
       LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
       LEFT JOIN medidas m ON c.medida_id = m.id
       WHERE c.gomeria_id = $1 AND c.activo = 1
         AND ($2 = '' OR c.fuego ILIKE $3)
         AND ($4 = 0 OR c.modelo_id = $4)
         AND ($5 = 0 OR c.medida_id = $5)
         AND ($6 = 0 OR c.estado = $6)
       ORDER BY ${orderExpr}`,
      [parseInt(id) || 0, fuego, '%' + fuego + '%', parseInt(modelo), parseInt(medida), parseInt(estado)]
    );

    res.render('gomerias/view', {
      user: req.user, gomeria: gomeria[0], cubiertas, modelos, medidas, almacenes,
      currentPage: 'inicio',
      filtros: { fuego, modelo: parseInt(modelo), medida: parseInt(medida), estado: parseInt(estado), orderby: parseInt(orderby) }
    });
  } catch (err) { next(err); }
});

module.exports = router;
