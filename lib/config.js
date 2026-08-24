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

// Intervalos de mantenimiento, en días (ver routes/mantenimiento.js).
const MANTENIMIENTO_DEFAULTS = { dias_alineacion: 180, dias_preventivo: 45 };

/**
 * Únicas claves que la pantalla de configuración puede tocar.
 *
 * La tabla `config` guarda también las credenciales de Gmail (mail_user,
 * mail_pass). El endpoint de guardado no puede aceptar una clave arbitraria:
 * sería una vía para leerlas o pisarlas desde la web.
 */
const CONFIG_EDITABLE = {
  mm_min:          { label: 'Profundidad mínima (mm)',    min: 1,  max: 30,  def: 4 },
  mm_max:          { label: 'Profundidad máxima (mm)',    min: 1,  max: 40,  def: 20 },
  dias_alineacion: { label: 'Alineación cada (días)',     min: 1,  max: 1000, def: 180 },
  dias_preventivo: { label: 'Preventivo cada (días)',     min: 1,  max: 1000, def: 45 },
};

module.exports = {
  leerConfig, leerConfigInt,
  MM_DEFAULTS, MANTENIMIENTO_DEFAULTS, CONFIG_EDITABLE,
};
