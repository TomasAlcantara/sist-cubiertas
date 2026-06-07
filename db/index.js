const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql = neon(process.env.DATABASE_URL);

// Caracteres invisibles que sobreviven a .trim() (zero-width, marcas bidi, controles,
// soft-hyphen, BOM). Si quedan pegados al número de fuego rompen la regex de
// correlatividad y caen al fallback `base + i`. Hay que quitarlos antes de procesar.
const INVISIBLES = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060\\uFEFF]',
  'g'
);

function sanitizeFuego(s) {
  return String(s == null ? '' : s).replace(INVISIBLES, '').trim();
}

// Genera el fuego correlativo i posiciones después de `base` (i=0 devuelve `base`).
// `base` debe venir ya saneado con sanitizeFuego().
function nextFuego(base, i) {
  if (i === 0) return base;
  const m = base.match(/^(.*?)(\d+)$/);
  if (m) return m[1] + String(parseInt(m[2], 10) + i).padStart(m[2].length, '0');
  return base + i;
}

module.exports = { sql, sanitizeFuego, nextFuego };
