const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

const PER_PAGE = 25;

const ORD_MAP = {
  1: 'c.fuego ASC', 11: 'c.fuego DESC',
  2: 'mr.marca ASC', 12: 'mr.marca DESC',
  3: 'm.medida ASC', 13: 'm.medida DESC',
  4: 'c.estado ASC', 14: 'c.estado DESC',
  5: 'c.km ASC', 15: 'c.km DESC',
};

// GET /cubiertas
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { fuego = '', modelo = 0, estado = 0, proveedor = 0, orderby = 0, pagina = 1 } = req.query;
    const offset = (parseInt(pagina) - 1) * PER_PAGE;

    const [modelos, proveedores] = await Promise.all([
      sql`SELECT * FROM marcas_ruedas WHERE activo = 1 ORDER BY marca, modelo`,
      sql`SELECT * FROM proveedor ORDER BY proveedor`,
    ]);

    const orderExpr = ORD_MAP[parseInt(orderby)] || 'c.fuego ASC';

    const [cubiertas, countRows] = await Promise.all([
      sql(
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
      ),
      sql(
        `SELECT COUNT(*) AS total FROM cubiertas c
         WHERE c.activo = 1
           AND ($1 = '' OR c.fuego ILIKE $2)
           AND ($3 = 0 OR c.modelo_id = $3)
           AND ($4 = 0 OR c.estado = $4)
           AND ($5 = 0 OR c.proveedor_id = $5)`,
        [fuego, '%' + fuego + '%', parseInt(modelo), parseInt(estado), parseInt(proveedor)]
      ),
    ]);

    const total = parseInt(countRows[0].total);
    const totalPages = Math.ceil(total / PER_PAGE);

    res.render('cubiertas/index', {
      user: req.user, cubiertas, modelos, proveedores,
      currentPage: 'inicio', pagina: parseInt(pagina), totalPages,
      filtros: { fuego, modelo: parseInt(modelo), estado: parseInt(estado), proveedor: parseInt(proveedor), orderby: parseInt(orderby) }
    });
  } catch (err) { next(err); }
});

// GET /cubiertas/nuevo
router.get('/nuevo', requireAuth, async (req, res, next) => {
  try {
    const { error = '' } = req.query;
    const [modelos, medidas, almacenes, proveedores] = await Promise.all([
      sql`SELECT * FROM marcas_ruedas WHERE activo = 1 ORDER BY marca, modelo`,
      sql`SELECT * FROM medidas ORDER BY medida`,
      sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`,
      sql`SELECT * FROM proveedor ORDER BY proveedor`,
    ]);
    res.render('cubiertas/nuevo', { user: req.user, modelos, medidas, almacenes, proveedores, currentPage: 'inicio', error });
  } catch (err) { next(err); }
});

// POST /cubiertas/nuevo
const nuevaCubiertaValidators = [
  body('fuego')
    .trim()
    .notEmpty().withMessage('El número de fuego es requerido')
    .isLength({ max: 50 }).withMessage('Fuego demasiado largo'),
  body('estado')
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 3 }).withMessage('Estado inválido'),
  body('km')
    .optional({ checkFalsy: true })
    .isInt({ min: 0 }).withMessage('KM debe ser un número no negativo'),
  body('cantidad')
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 200 }).withMessage('Cantidad debe ser entre 1 y 200'),
];

router.post('/nuevo', requireAuth, nuevaCubiertaValidators, async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const msg = errors.array().map(e => e.msg).join(' | ');
    return res.redirect('/cubiertas/nuevo?error=' + encodeURIComponent(msg));
  }
  try {
    const { fuego, modelo_id, medida_id, estado, almacen_id, km, proveedor_id, id_interno, remito, precio, fecha_remito, cantidad } = req.body;

    const parseFecha = (f) => {
      if (!f) return null;
      const p = f.split('/');
      if (p.length !== 3) return f || null;
      const year = p[2].length === 2 ? '20' + p[2] : p[2];
      return `${year}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    };

    const nextFuego = (base, i) => {
      if (i === 0) return base;
      const m = base.match(/^(.*?)(\d+)$/);
      if (m) return m[1] + String(parseInt(m[2]) + i).padStart(m[2].length, '0');
      return base + i;
    };

    const qty = Math.max(1, Math.min(parseInt(cantidad) || 1, 200));
    const fechaParsed = parseFecha(fecha_remito);
    const mId = parseInt(modelo_id) || null;
    const medId = parseInt(medida_id) || null;
    const est = parseInt(estado) || 1;
    const almId = parseInt(almacen_id) || null;
    const kmVal = parseInt(km) || 0;
    const provId = parseInt(proveedor_id) || null;
    const precioVal = parseFloat(precio) || null;
    const fuegoBase = fuego.trim();

    const fuegosNuevos = Array.from({ length: qty }, (_, i) => nextFuego(fuegoBase, i));
    const existentes = await sql`SELECT fuego FROM cubiertas WHERE fuego = ANY(${fuegosNuevos}) AND activo = 1`;
    if (existentes.length) {
      const dup = existentes.map(r => r.fuego).join(', ');
      return res.redirect('/cubiertas/nuevo?error=' + encodeURIComponent('Fuego ya existe: ' + dup));
    }

    for (let i = 0; i < qty; i++) {
      const f = nextFuego(fuegoBase, i);
      await sql`
        INSERT INTO cubiertas (fuego, modelo_id, medida_id, estado, almacen_id, km, proveedor_id, id_interno, remito, precio, fecha_remito, activo)
        VALUES (${f}, ${mId}, ${medId}, ${est}, ${almId}, ${kmVal}, ${provId},
                ${id_interno?.trim() || null}, ${remito?.trim() || null}, ${precioVal}, ${fechaParsed}, 1)
      `;
    }
    res.redirect('/cubiertas');
  } catch (err) { next(err); }
});

// GET /cubiertas/editar?id=X
router.get('/editar', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.query;
    if (!id) return res.redirect('/cubiertas');

    const rows = await sql`SELECT * FROM cubiertas WHERE id = ${parseInt(id) || 0} AND activo = 1`;
    if (!rows.length) return res.redirect('/cubiertas');

    const [modelos, medidas, almacenes, proveedores] = await Promise.all([
      sql`SELECT * FROM marcas_ruedas WHERE activo = 1 ORDER BY marca, modelo`,
      sql`SELECT * FROM medidas ORDER BY medida`,
      sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`,
      sql`SELECT * FROM proveedor ORDER BY proveedor`,
    ]);

    res.render('cubiertas/editar', { user: req.user, cubierta: rows[0], modelos, medidas, almacenes, proveedores, currentPage: 'inicio' });
  } catch (err) { next(err); }
});

// POST /cubiertas/editar
router.post('/editar', requireAuth, async (req, res, next) => {
  try {
    const { id, fuego, modelo_id, medida_id, estado, almacen_id, km, proveedor_id, id_interno, remito, precio, fecha_remito } = req.body;
    if (!id || !fuego) return res.redirect('/cubiertas');

    const parseFecha = (f) => {
      if (!f) return null;
      const p = f.split('/');
      if (p.length !== 3) return f || null;
      const year = p[2].length === 2 ? '20' + p[2] : p[2];
      return `${year}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    };

    await sql`
      UPDATE cubiertas SET
        fuego = ${fuego.trim()},
        modelo_id = ${parseInt(modelo_id) || null},
        medida_id = ${parseInt(medida_id) || null},
        estado = ${parseInt(estado) || 1},
        almacen_id = ${parseInt(almacen_id) || null},
        km = ${parseInt(km) || 0},
        proveedor_id = ${parseInt(proveedor_id) || null},
        id_interno = ${id_interno?.trim() || null},
        remito = ${remito?.trim() || null},
        precio = ${parseFloat(precio) || null},
        fecha_remito = ${parseFecha(fecha_remito)}
      WHERE id = ${parseInt(id) || 0}
    `;
    res.redirect('/cubiertas');
  } catch (err) { next(err); }
});

module.exports = router;
