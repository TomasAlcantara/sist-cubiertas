const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requirePerm } = require('../middleware/auth');
const { leerConfigInt, MM_DEFAULTS } = require('../lib/config');
const { parseFecha } = require('../lib/fechas');

// GET /OTs/list
router.get('/list', requirePerm('ot_ver'), async (req, res, next) => {
  try {
    const { gomeria = 0, unidad = 0, estado = -1, numero = '', desde = '', hasta = '' } = req.query;

    // Las fechas llegan del datepicker en DD/MM/AAAA; si vienen vacías o mal
    // formadas quedan en '' y el filtro se desactiva solo.
    const desdeISO = /^\d{2}\/\d{2}\/\d{2,4}$/.test(desde) ? parseFecha(desde) : '';
    const hastaISO = /^\d{2}\/\d{2}\/\d{2,4}$/.test(hasta) ? parseFecha(hasta) : '';
    const nro = String(numero).trim();

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
          -- La lista muestra el numero o, si no tiene, el id: buscar por numero
          -- tiene que encontrar tambien las OTs sin numero cargado, que son mayoria.
          AND (${nro} = '' OR o.numero ILIKE ${'%' + nro + '%'} OR CAST(o.id AS TEXT) = ${nro})
          AND (${desdeISO} = '' OR o.fecha >= ${desdeISO || null}::date)
          AND (${hastaISO} = '' OR o.fecha <= ${hastaISO || null}::date)
        ORDER BY o.fecha DESC, o.id DESC
      `,
    ]);

    res.render('OTs/list', {
      user: req.user, ots, gomerias, unidades, currentPage: 'inicio',
      filtros: {
        gomeria: parseInt(gomeria), unidad: parseInt(unidad), estado: parseInt(estado),
        numero: nro, desde: String(desde).trim(), hasta: String(hasta).trim(),
      },
    });
  } catch (err) { next(err); }
});

// GET /OTs/nueva
router.get('/nueva', requirePerm('ot_crear'), async (req, res, next) => {
  try {
    const [gomerias, unidades, almacenes, modelos, medidas, cfg] = await Promise.all([
      sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`,
      sql`SELECT * FROM micro WHERE activo = 1 ORDER BY unidad`,
      sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`,
      sql`SELECT * FROM marcas_ruedas ORDER BY marca, modelo`,
      sql`SELECT * FROM medidas ORDER BY medida`,
      leerConfigInt(MM_DEFAULTS),
    ]);
    res.render('OTs/nueva', { user: req.user, gomerias, unidades, almacenes, modelos, medidas, cfg, currentPage: 'inicio' });
  } catch (err) { next(err); }
});

// GET /OTs/ver?ot=X
router.get('/ver', requirePerm('ot_ver'), async (req, res, next) => {
  try {
    const { ot } = req.query;
    const rows = await sql`
      SELECT o.*, g.nombre AS gomeria_nombre, r.nombre AS recapadora_nombre, m.unidad, m.km_actual, m.tipo_unidad
      FROM ots o
      LEFT JOIN gomeria g ON o.gomeria_id = g.id
      LEFT JOIN recapadora r ON o.recapadora_id = r.id
      LEFT JOIN micro m ON o.unidad_id = m.id
      WHERE o.id = ${parseInt(ot) || 0}
    `;
    if (!rows.length) return res.redirect('/OTs/list');

    const [cubiertas, unitTires, mediciones, cfg] = await Promise.all([
      sql`
        SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, m2.medida, m2.presion, oc.posicion
        FROM ot_cubiertas oc
        JOIN cubiertas c ON oc.cubierta_id = c.id
        LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
        LEFT JOIN medidas m2 ON c.medida_id = m2.id
        WHERE oc.ot_id = ${parseInt(ot) || 0}
        ORDER BY oc.posicion
      `,
      rows[0].unidad_id
        ? sql`SELECT c.id, c.fuego, c.posicion, c.estado FROM cubiertas c WHERE c.micro_id = ${rows[0].unidad_id} AND c.activo = 1 AND c.posicion IS NOT NULL`
        : Promise.resolve([]),
      sql`
        SELECT om.posicion, om.mm_ext, om.mm_int, c.fuego
        FROM ot_mediciones om
        LEFT JOIN cubiertas c ON om.cubierta_id = c.id
        WHERE om.ot_id = ${parseInt(ot) || 0}
        ORDER BY om.posicion
      `,
      leerConfigInt(MM_DEFAULTS),
    ]);

    res.render('OTs/ver', {
      user: req.user, ot: rows[0], cubiertas, unitTires,
      mediciones: mediciones || [], cfg, currentPage: 'inicio',
    });
  } catch (err) { next(err); }
});

// GET /OTs/cargar?ot=X — Vista dedicada para asignar cubiertas al diagrama
router.get('/cargar', requirePerm('ot_editar'), async (req, res, next) => {
  try {
    const { ot } = req.query;
    const rows = await sql`
      SELECT o.*, g.nombre AS gomeria_nombre, m.unidad, m.tipo_unidad
      FROM ots o
      LEFT JOIN gomeria g ON o.gomeria_id = g.id
      LEFT JOIN micro m ON o.unidad_id = m.id
      WHERE o.id = ${parseInt(ot) || 0}
    `;
    if (!rows.length) return res.redirect('/OTs/list');
    if (rows[0].estado == 1) return res.redirect('/OTs/ver?ot=' + parseInt(ot));

    const [almacenes, modelos, medidas, ot_cubiertas, unitTires] = await Promise.all([
      sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`,
      sql`SELECT * FROM marcas_ruedas ORDER BY marca, modelo`,
      sql`SELECT * FROM medidas ORDER BY medida`,
      sql`SELECT oc.posicion, oc.cubierta_id, c.fuego FROM ot_cubiertas oc JOIN cubiertas c ON oc.cubierta_id = c.id WHERE oc.ot_id = ${parseInt(ot) || 0} AND oc.posicion IS NOT NULL`,
      rows[0].unidad_id
        ? sql`SELECT c.id, c.fuego, c.posicion FROM cubiertas c WHERE c.micro_id = ${rows[0].unidad_id} AND c.activo = 1 AND c.posicion IS NOT NULL`
        : Promise.resolve([]),
    ]);

    res.render('OTs/cargar', {
      user: req.user, ot: rows[0], almacenes, modelos, medidas, ot_cubiertas, unitTires, currentPage: 'inicio'
    });
  } catch (err) { next(err); }
});

// GET /OTs/editar?ot=X
router.get('/editar', requirePerm('ot_editar'), async (req, res, next) => {
  try {
    const { ot } = req.query;
    const rows = await sql`
      SELECT o.*, g.nombre AS gomeria_nombre, m.unidad
      FROM ots o
      LEFT JOIN gomeria g ON o.gomeria_id = g.id
      LEFT JOIN micro m ON o.unidad_id = m.id
      WHERE o.id = ${parseInt(ot) || 0}
    `;
    if (!rows.length) return res.redirect('/OTs/list');
    if (rows[0].estado == 1) return res.redirect('/OTs/ver?ot=' + parseInt(ot));

    const [gomerias, unidades, almacenes, modelos, medidas, ot_cubiertas] = await Promise.all([
      sql`SELECT * FROM gomeria WHERE activo = 1 ORDER BY nombre`,
      sql`SELECT * FROM micro WHERE activo = 1 ORDER BY unidad`,
      sql`SELECT * FROM almacen WHERE activo = 1 ORDER BY nombre`,
      sql`SELECT * FROM marcas_ruedas ORDER BY marca, modelo`,
      sql`SELECT * FROM medidas ORDER BY medida`,
      sql`SELECT oc.posicion, oc.cubierta_id, c.fuego FROM ot_cubiertas oc JOIN cubiertas c ON oc.cubierta_id = c.id WHERE oc.ot_id = ${parseInt(ot) || 0} AND oc.posicion IS NOT NULL`,
    ]);

    res.render('OTs/editar', {
      user: req.user, ot: rows[0], gomerias, unidades, almacenes, modelos, medidas, ot_cubiertas, currentPage: 'inicio'
    });
  } catch (err) { next(err); }
});

module.exports = router;
