// routes/health.js — chequeo profundo PUBLICO (sin auth) para el dashboard de control.
// Verifica la base (Neon Postgres) y reporta version + uptime. Devuelve SOLO internos
// seguros: nunca credenciales, connection strings ni datos de negocio.

const express = require('express');
const router = express.Router();
const { sql } = require('../db');
const { version } = require('../package.json');

router.get('/', async (req, res) => {
  let db = 'error';
  try {
    await sql`SELECT 1`;
    db = 'ok';
  } catch (_) {
    db = 'error';
  }
  res.json({
    status: db === 'ok' ? 'ok' : 'degraded',
    version,
    db,
    uptime_s: Math.round(process.uptime()),
  });
});

module.exports = router;
