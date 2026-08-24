const { sql } = require('../db');

/**
 * Lee claves de la tabla `config` con fallback a defaults.
 * Solo devuelve las claves pedidas: la tabla guarda también credenciales de
 * mail y nada que las necesite tiene que verlas de rebote.
 */
async function leerConfig(defaults) {
  const claves = Object.keys(defaults);
  const filas = await sql`SELECT clave, valor FROM config WHERE clave = ANY(${claves})`;
  const cfg = { ...defaults };
  for (const f of filas || []) {
    if (f.valor != null && String(f.valor).trim() !== '') cfg[f.clave] = f.valor;
  }
  return cfg;
}

/** Igual que leerConfig pero convierte a entero, descartando valores no válidos. */
async function leerConfigInt(defaults) {
  const cfg = await leerConfig(defaults);
  const out = {};
  for (const [k, def] of Object.entries(defaults)) {
    const n = parseInt(cfg[k]);
    out[k] = Number.isFinite(n) && n > 0 ? n : def;
  }
  return out;
}

// Umbrales de profundidad de dibujo, en mm. El mínimo del taller es 4 mm.
const MM_DEFAULTS = { mm_min: 4, mm_max: 20 };

module.exports = { leerConfig, leerConfigInt, MM_DEFAULTS };
