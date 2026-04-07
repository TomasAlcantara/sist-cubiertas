const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

const PER_PAGE = 25;

// GET /cubiertas
router.get('/', requireAuth, async (req, res) => {
  const { fuego = '', modelo = 0, estado = 0, proveedor = 0, orderby = 0, pagina = 1 } = req.query;
  const offset = (parseInt(pagina) - 1) * PER_PAGE;

  const modelos = await sql`SELECT * FROM marcas_ruedas WHERE activo = 1 ORDER BY marca, modelo`;
  const proveedores = await sql`SELECT * FROM proveedor ORDER BY proveedor`;

  const ordMap = { 1: 'c.fuego ASC', 11: 'c.fuego DESC', 2: 'mr.marca ASC', 12: 'mr.marca DESC', 3: 'm.medida ASC', 13: 'm.medida DESC', 4: 'c.estado ASC', 14: 'c.estado DESC', 5: 'c.km ASC', 15: 'c.km DESC' };
  const orderExpr = ordMap[parseInt(orderby)] || 'c.fuego ASC';

  const cubiertas = await sql(
    `SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m.medida,
            p.proveedor AS proveedor_nombre,
            a.nombre AS almacen_nombre, g.nombre AS gomeria_nombre, mi.unidad
     FROM cubiertas c
     LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
     LEFT JOIN medidas m ON c.medida_id = m.id
     LEFT JOIN proveedor p ON c.proveedor_id = p.id
     LEFT JOIN almacen a ON c.almacen_id = a.id
     LEFT JOIN gomeria g ON c.gomeria_id = g.id
     LEFT JOIN micro mi ON c.micro_id = mi.id
     WHERE c.activo = 1
       AND ($1 = '' OR c.fuego ILIKE $2)
       AND ($3 = 0 OR c.modelo_id = $3)
       AND ($4 = 0 OR c.estado = $4)
       AND ($5 = 0 OR c.proveedor_id = $5)
     ORDER BY ${orderExpr}
     LIMIT $6 OFFSET $7`,
    [fuego, '%' + fuego + '%', parseInt(modelo), parseInt(estado), parseInt(proveedor), PER_PAGE, offset]
  );

  const countRows = await sql(
    `SELECT COUNT(*) AS total FROM cubiertas c
     WHERE c.activo = 1
       AND ($1 = '' OR c.fuego ILIKE $2)
       AND ($3 = 0 OR c.modelo_id = $3)
       AND ($4 = 0 OR c.estado = $4)
       AND ($5 = 0 OR c.proveedor_id = $5)`,
    [fuego, '%' + fuego + '%', parseInt(modelo), parseInt(estado), parseInt(proveedor)]
  );
  const total = parseInt(countRows[0].total);
  const totalPages = Math.ceil(total / PER_PAGE);

  res.render('cubiertas/index', {
    user: req.user, cubiertas, modelos, proveedores,
    currentPage: 'inicio', pagina: parseInt(pagina), totalPages,
    filtros: { fuego, modelo: parseInt(modelo), estado: parseInt(estado), proveedor: parseInt(proveedor), orderby: parseInt(orderby) }
  });
});

module.exports = router;
