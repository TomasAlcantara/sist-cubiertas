const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

// Intervalos acordados con taller: alineación 2 veces al año, preventivo cada 45 días.
// Se guardan en la tabla config para poder cambiarlos sin tocar el código.
const DEFAULTS = { dias_alineacion: 180, dias_preventivo: 45 };

async function intervalos() {
  const filas = await sql`SELECT clave, valor FROM config WHERE clave IN ('dias_alineacion', 'dias_preventivo')`;
  const cfg = { ...DEFAULTS };
  for (const f of filas) {
    const n = parseInt(f.valor);
    if (n > 0) cfg[f.clave] = n;
  }
  return cfg;
}

// GET /mantenimiento
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const cfg = await intervalos();

    const unidades = await sql`
      SELECT m.id, m.unidad, m.descripcion, m.tipo_unidad, m.km_actual,
             m.ultima_alineacion, m.ultimo_preventivo,
             (m.ultima_alineacion + ${cfg.dias_alineacion} * INTERVAL '1 day')::date AS proxima_alineacion,
             (m.ultimo_preventivo + ${cfg.dias_preventivo} * INTERVAL '1 day')::date AS proximo_preventivo,
             (m.ultima_alineacion + ${cfg.dias_alineacion} * INTERVAL '1 day')::date - CURRENT_DATE AS dias_alineacion,
             (m.ultimo_preventivo + ${cfg.dias_preventivo} * INTERVAL '1 day')::date - CURRENT_DATE AS dias_preventivo
      FROM micro m
      WHERE m.activo = 1
      ORDER BY m.unidad`;

    res.render('mantenimiento/index', {
      user: req.user, unidades, cfg, currentPage: 'mantenimiento',
    });
  } catch (err) { next(err); }
});

module.exports = router;
