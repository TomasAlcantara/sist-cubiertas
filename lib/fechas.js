/**
 * Helpers de fecha. El sistema muestra y recibe fechas en formato argentino
 * (DD/MM/AAAA) y corre en Vercel, cuyo runtime está en UTC — sin fijar la zona
 * horaria una OT creada a las 22:00 se mostraría al día siguiente.
 */

const TZ = 'America/Argentina/Buenos_Aires';

/** "25/12/2026" o "25/12/26" → "2026-12-25". Devuelve la entrada si no matchea. */
function parseFecha(f) {
  if (!f) return null;
  const p = String(f).split('/');
  if (p.length !== 3) return f || null;
  const year = p[2].length === 2 ? '20' + p[2] : p[2];
  return `${year}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
}

/** Date | string | null → "25/12/2026" */
function fmtFecha(v) {
  if (!v) return '-';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '-';
  return d.toLocaleDateString('es-AR', { timeZone: TZ });
}

/**
 * Date | string | null → "25/12/2026 14:30".
 * Las OTs anteriores a la migración tienen creado_en a medianoche porque se
 * backfillearon desde `fecha`: ahí no hay hora real que mostrar, solo la fecha.
 */
function fmtFechaHora(v) {
  if (!v) return '-';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '-';
  const fecha = d.toLocaleDateString('es-AR', { timeZone: TZ });
  const hora = d.toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return hora === '00:00' ? fecha : `${fecha} ${hora}`;
}

module.exports = { TZ, parseFecha, fmtFecha, fmtFechaHora };
