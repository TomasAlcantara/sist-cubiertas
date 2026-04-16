const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { sql } = require('../db');
const { requireMaster } = require('../middleware/auth');

const PER_PAGE = 25;

// GET /admin
router.get('/', requireMaster, (req, res) => {
  res.render('admin/index', { user: req.user, currentPage: 'admin' });
});

// ─── USUARIOS ───────────────────────────────────────────────
router.get('/usuarios', requireMaster, async (req, res, next) => {
  try {
    const soloActivos = req.query.todos !== '1';
    const usuarios = soloActivos
      ? await sql`SELECT u.*, g.nombre AS gomeria_nombre FROM usuarios u LEFT JOIN gomeria g ON u.gomeria_id = g.id WHERE u.activo = 1 ORDER BY u.usuario`
      : await sql`SELECT u.*, g.nombre AS gomeria_nombre FROM usuarios u LEFT JOIN gomeria g ON u.gomeria_id = g.id ORDER BY u.usuario`;
    const gomerias = await sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`;
    res.render('admin/usuarios/index', { user: req.user, usuarios, gomerias, soloActivos, currentPage: 'admin' });
  } catch (err) { next(err); }
});

router.get('/usuarios/nuevo', requireMaster, async (req, res, next) => {
  try {
    const gomerias = await sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`;
    res.render('admin/usuarios/nuevo', { user: req.user, gomerias, currentPage: 'admin' });
  } catch (err) { next(err); }
});

router.get('/usuarios/editar', requireMaster, async (req, res, next) => {
  try {
    const { usuario } = req.query;
    if (!usuario || isNaN(parseInt(usuario))) return res.redirect('/admin/usuarios');
    const rows = await sql`SELECT * FROM usuarios WHERE id = ${parseInt(usuario)}`;
    if (!rows.length) return res.redirect('/admin/usuarios');
    const gomerias = await sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`;
    res.render('admin/usuarios/editar', { user: req.user, usuario: rows[0], gomerias, currentPage: 'admin' });
  } catch (err) { next(err); }
});

// ─── ALMACEN ────────────────────────────────────────────────
router.get('/almacen', requireMaster, async (req, res, next) => {
  try {
    const almacenes = await sql`SELECT * FROM almacen ORDER BY nombre`;
    res.render('admin/almacen/index', { user: req.user, almacenes, currentPage: 'admin' });
  } catch (err) { next(err); }
});

router.get('/almacen/nuevo', requireMaster, (req, res) => {
  res.render('admin/almacen/nuevo', { user: req.user, currentPage: 'admin' });
});

router.get('/almacen/editar', requireMaster, async (req, res, next) => {
  try {
    const rows = await sql`SELECT * FROM almacen WHERE id = ${parseInt(req.query.id) || 0}`;
    if (!rows.length) return res.redirect('/admin/almacen');
    res.render('admin/almacen/editar', { user: req.user, almacen: rows[0], currentPage: 'admin' });
  } catch (err) { next(err); }
});

// ─── GOMERIA ────────────────────────────────────────────────
router.get('/gomeria', requireMaster, async (req, res, next) => {
  try {
    const gomerias = await sql`SELECT * FROM gomeria ORDER BY nombre`;
    res.render('admin/gomeria/index', { user: req.user, gomerias, currentPage: 'admin' });
  } catch (err) { next(err); }
});

router.get('/gomeria/nuevo', requireMaster, (req, res) => {
  res.render('admin/gomeria/nuevo', { user: req.user, currentPage: 'admin' });
});

router.get('/gomeria/editar', requireMaster, async (req, res, next) => {
  try {
    const rows = await sql`SELECT * FROM gomeria WHERE id = ${parseInt(req.query.id) || 0}`;
    if (!rows.length) return res.redirect('/admin/gomeria');
    res.render('admin/gomeria/editar', { user: req.user, gomeria: rows[0], currentPage: 'admin' });
  } catch (err) { next(err); }
});

// ─── RECAPADORA ─────────────────────────────────────────────
router.get('/recapadora', requireMaster, async (req, res, next) => {
  try {
    const recapadoras = await sql`SELECT * FROM recapadora ORDER BY nombre`;
    res.render('admin/recapadora/index', { user: req.user, recapadoras, currentPage: 'admin' });
  } catch (err) { next(err); }
});

router.get('/recapadora/nuevo', requireMaster, (req, res) => {
  res.render('admin/recapadora/nuevo', { user: req.user, currentPage: 'admin' });
});

router.get('/recapadora/editar', requireMaster, async (req, res, next) => {
  try {
    const rows = await sql`SELECT * FROM recapadora WHERE id = ${parseInt(req.query.id) || 0}`;
    if (!rows.length) return res.redirect('/admin/recapadora');
    res.render('admin/recapadora/editar', { user: req.user, recapadora: rows[0], currentPage: 'admin' });
  } catch (err) { next(err); }
});

// ─── MODELO CUBIERTA ────────────────────────────────────────
router.get('/modelo_cubierta', requireMaster, async (req, res, next) => {
  try {
    const { marca = '', modelo = '', pagina = 1 } = req.query;
    const offset = (parseInt(pagina) - 1) * PER_PAGE;
    const modelos = await sql`
      SELECT * FROM marcas_ruedas
      WHERE (${marca} = '' OR marca ILIKE ${'%' + marca + '%'})
        AND (${modelo} = '' OR modelo ILIKE ${'%' + modelo + '%'})
        AND activo = 1
      ORDER BY marca, modelo
      LIMIT ${PER_PAGE} OFFSET ${offset}
    `;
    const count = await sql`SELECT COUNT(*) AS total FROM marcas_ruedas WHERE (${marca} = '' OR marca ILIKE ${'%' + marca + '%'}) AND activo = 1`;
    const totalPages = Math.ceil(parseInt(count[0].total) / PER_PAGE);
    res.render('admin/modelo_cubierta/index', { user: req.user, modelos, currentPage: 'admin', pagina: parseInt(pagina), totalPages, filtros: { marca, modelo } });
  } catch (err) { next(err); }
});

router.get('/modelo_cubierta/nuevo', requireMaster, (req, res) => {
  res.render('admin/modelo_cubierta/nuevo', { user: req.user, currentPage: 'admin' });
});

router.get('/modelo_cubierta/editar', requireMaster, async (req, res, next) => {
  try {
    const rows = await sql`SELECT * FROM marcas_ruedas WHERE id = ${parseInt(req.query.modelo) || 0}`;
    if (!rows.length) return res.redirect('/admin/modelo_cubierta');
    res.render('admin/modelo_cubierta/editar', { user: req.user, modelo: rows[0], currentPage: 'admin' });
  } catch (err) { next(err); }
});

// ─── MICROS (UNIDADES) ──────────────────────────────────────
router.get('/micros', requireMaster, async (req, res, next) => {
  try {
    const { id = '', pagina = 1 } = req.query;
    const offset = (parseInt(pagina) - 1) * PER_PAGE;
    const micros = await sql`
      SELECT * FROM micro
      WHERE activo = 1 AND (${id} = '' OR id = ${id === '' ? null : parseInt(id)})
      ORDER BY unidad
      LIMIT ${PER_PAGE} OFFSET ${offset}
    `;
    const allMicros = await sql`SELECT id, unidad FROM micro WHERE activo = 1 ORDER BY unidad`;
    const count = await sql`SELECT COUNT(*) AS total FROM micro WHERE activo = 1`;
    const totalPages = Math.ceil(parseInt(count[0].total) / PER_PAGE);
    res.render('admin/micros/index', { user: req.user, micros, allMicros, currentPage: 'admin', pagina: parseInt(pagina), totalPages });
  } catch (err) { next(err); }
});

router.get('/micros/nuevo', requireMaster, (req, res) => {
  res.render('admin/micros/nuevo', { user: req.user, currentPage: 'admin' });
});

router.get('/micros/editar', requireMaster, async (req, res, next) => {
  try {
    const rows = await sql`SELECT * FROM micro WHERE id = ${parseInt(req.query.rueda) || 0}`;
    if (!rows.length) return res.redirect('/admin/micros');
    res.render('admin/micros/editar', { user: req.user, micro: rows[0], currentPage: 'admin' });
  } catch (err) { next(err); }
});

// ─── MEDIDAS ────────────────────────────────────────────────
router.get('/medidas', requireMaster, async (req, res, next) => {
  try {
    const medidas = await sql`SELECT * FROM medidas ORDER BY medida`;
    res.render('admin/medidas/index', { user: req.user, medidas, currentPage: 'admin' });
  } catch (err) { next(err); }
});

router.get('/medidas/nuevo', requireMaster, (req, res) => {
  res.render('admin/medidas/nuevo', { user: req.user, currentPage: 'admin' });
});

router.get('/medidas/editar', requireMaster, async (req, res, next) => {
  try {
    const rows = await sql`SELECT * FROM medidas WHERE id = ${parseInt(req.query.medida) || 0}`;
    if (!rows.length) return res.redirect('/admin/medidas');
    res.render('admin/medidas/editar', { user: req.user, medida: rows[0], currentPage: 'admin' });
  } catch (err) { next(err); }
});

// ─── PROVEEDOR ──────────────────────────────────────────────
router.get('/proveedor', requireMaster, async (req, res, next) => {
  try {
    const { pagina = 1 } = req.query;
    const offset = (parseInt(pagina) - 1) * PER_PAGE;
    const proveedores = await sql`SELECT * FROM proveedor ORDER BY proveedor LIMIT ${PER_PAGE} OFFSET ${offset}`;
    const count = await sql`SELECT COUNT(*) AS total FROM proveedor`;
    const totalPages = Math.ceil(parseInt(count[0].total) / PER_PAGE);
    res.render('admin/proveedor/index', { user: req.user, proveedores, currentPage: 'admin', pagina: parseInt(pagina), totalPages });
  } catch (err) { next(err); }
});

router.get('/proveedor/nuevo', requireMaster, (req, res) => {
  res.render('admin/proveedor/nuevo', { user: req.user, currentPage: 'admin' });
});

router.get('/proveedor/editar', requireMaster, async (req, res, next) => {
  try {
    const rows = await sql`SELECT * FROM proveedor WHERE id = ${parseInt(req.query.proveedor) || 0}`;
    if (!rows.length) return res.redirect('/admin/proveedor');
    res.render('admin/proveedor/editar', { user: req.user, proveedor: rows[0], currentPage: 'admin' });
  } catch (err) { next(err); }
});

// ─── RUEDAS POR MICRO ───────────────────────────────────────
router.get('/ruedas_micro/modelo', requireMaster, async (req, res, next) => {
  try {
    const { v } = req.query;
    const micro = await sql`SELECT * FROM micro WHERE id = ${parseInt(v) || 0}`;
    if (!micro.length) return res.redirect('/admin/micros');

    const [ruedas, almacenes, modelos] = await Promise.all([
      sql`
        SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m.medida
        FROM cubiertas c
        LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
        LEFT JOIN medidas m ON c.medida_id = m.id
        WHERE c.micro_id = ${parseInt(v) || 0} AND c.activo = 1
      `,
      sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`,
      sql`SELECT * FROM marcas_ruedas WHERE activo = 1 ORDER BY marca, modelo`,
    ]);

    res.render('admin/micros/modelo', { user: req.user, micro: micro[0], ruedas, almacenes, modelos, currentPage: 'admin' });
  } catch (err) { next(err); }
});

// ─── ANULAR OT ──────────────────────────────────────────────
router.get('/anulaOT', requireMaster, async (req, res, next) => {
  try {
    const ots = await sql`
      SELECT o.*, r.nombre AS recapadora_nombre FROM ots o
      LEFT JOIN recapadora r ON o.recapadora_id = r.id
      WHERE o.estado = 0 ORDER BY o.id DESC
    `;
    res.render('admin/anulaOT/index', { user: req.user, ots, currentPage: 'admin' });
  } catch (err) { next(err); }
});

module.exports = router;
