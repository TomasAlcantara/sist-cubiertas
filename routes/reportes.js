const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /reportes
router.get('/', requireAuth, async (req, res) => {
  res.render('reportes/index', { user: req.user, currentPage: 'reportes' });
});

// GET /reportes/recorrido - Reporte por cubierta
router.get('/recorrido', requireAuth, async (req, res) => {
  const { fuego = '' } = req.query;
  let cubiertas = [];
  if (fuego) {
    cubiertas = await sql`
      SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m.medida,
             a.nombre AS almacen_nombre, g.nombre AS gomeria_nombre, mi.unidad
      FROM cubiertas c
      LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
      LEFT JOIN medidas m ON c.medida_id = m.id
      LEFT JOIN almacen a ON c.almacen_id = a.id
      LEFT JOIN gomeria g ON c.gomeria_id = g.id
      LEFT JOIN micro mi ON c.micro_id = mi.id
      WHERE c.fuego ILIKE ${'%' + fuego + '%'} AND c.activo = 1
    `;
  }
  res.render('reportes/recorrido', { user: req.user, cubiertas, fuego, currentPage: 'reportes' });
});

// GET /reportes/estados - Reporte de estados
router.get('/estados', requireAuth, async (req, res) => {
  const resumen = await sql`
    SELECT
      COUNT(*) FILTER (WHERE estado = 1) AS nuevas,
      COUNT(*) FILTER (WHERE estado = 2) AS usadas,
      COUNT(*) FILTER (WHERE estado = 3) AS recapadas,
      COUNT(*) AS total
    FROM cubiertas WHERE activo = 1
  `;
  const porModelo = await sql`
    SELECT mr.marca, mr.modelo, c.estado, COUNT(*) AS cantidad
    FROM cubiertas c
    LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
    WHERE c.activo = 1
    GROUP BY mr.marca, mr.modelo, c.estado
    ORDER BY mr.marca, mr.modelo, c.estado
  `;
  res.render('reportes/estados', { user: req.user, resumen: resumen[0], porModelo, currentPage: 'reportes' });
});

// GET /reportes/reporte_unidad - Reporte por interno
router.get('/reporte_unidad', requireAuth, async (req, res) => {
  const { unidad = 0 } = req.query;
  const unidades = await sql`SELECT * FROM micro WHERE activo = 1 ORDER BY unidad`;
  let cubiertas = [];
  if (parseInt(unidad) > 0) {
    cubiertas = await sql`
      SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m.medida
      FROM cubiertas c
      LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
      LEFT JOIN medidas m ON c.medida_id = m.id
      WHERE c.micro_id = ${parseInt(unidad)} AND c.activo = 1
      ORDER BY c.posicion
    `;
  }
  res.render('reportes/reporte_unidad', { user: req.user, cubiertas, unidades, unidad: parseInt(unidad), currentPage: 'reportes' });
});

// GET /reportes/reporte_gomeria - Reporte por gomería
router.get('/reporte_gomeria', requireAuth, async (req, res) => {
  const { gomeria = 0 } = req.query;
  const gomerias = await sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`;
  let cubiertas = [];
  if (parseInt(gomeria) > 0) {
    cubiertas = await sql`
      SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m.medida
      FROM cubiertas c
      LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
      LEFT JOIN medidas m ON c.medida_id = m.id
      WHERE c.gomeria_id = ${parseInt(gomeria)} AND c.activo = 1
      ORDER BY c.fuego
    `;
  }
  res.render('reportes/reporte_gomeria', { user: req.user, cubiertas, gomerias, gomeria: parseInt(gomeria), currentPage: 'reportes' });
});

// GET /reportes/cubierta_proveedor - Reporte por proveedor
router.get('/cubierta_proveedor', requireAuth, async (req, res) => {
  const { proveedor = 0 } = req.query;
  const proveedores = await sql`SELECT * FROM proveedor ORDER BY proveedor`;
  let cubiertas = [];
  if (parseInt(proveedor) > 0) {
    cubiertas = await sql`
      SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m.medida,
             a.nombre AS almacen_nombre, g.nombre AS gomeria_nombre
      FROM cubiertas c
      LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
      LEFT JOIN medidas m ON c.medida_id = m.id
      LEFT JOIN almacen a ON c.almacen_id = a.id
      LEFT JOIN gomeria g ON c.gomeria_id = g.id
      WHERE c.proveedor_id = ${parseInt(proveedor)} AND c.activo = 1
      ORDER BY c.fuego
    `;
  }
  res.render('reportes/cubierta_proveedor', { user: req.user, cubiertas, proveedores, proveedor: parseInt(proveedor), currentPage: 'reportes' });
});

module.exports = router;
