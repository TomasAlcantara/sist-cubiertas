/**
 * Helpers de fecha. El sistema muestra y recibe fechas en formato argentino
 * (DD/MM/AAAA) y corre en Vercel, cuyo runtime está en UTC — sin fijar la zona
 * horaria una OT creada a las 22:00 se mostraría al día siguiente.
 */

const TZ = 'America/Argentina/Buenos_Aires';

/** Date → { anio, mes, dia } en horario argentino, con dos dígitos. */
function partesAR(d) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const val = (t) => partes.find((p) => p.type === t).value;
  return { anio: val('year'), mes: val('month'), dia: val('day') };
}

/** Date → "14:30" en horario argentino. */
function horaAR(d) {
  const hora = d.toLocaleTimeString('es-AR', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return hora === '24:00' ? '00:00' : hora;   // algunos ICU devuelven 24:00 a medianoche
}

/** Cualquier cosa → Date, o null si no es una fecha válida. */
function aFecha(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : d;
}

/** "25/12/2026" o "25/12/26" → "2026-12-25". Devuelve la entrada si no matchea. */
function parseFecha(f) {
  if (!f) return null;
  const p = String(f).split('/');
  if (p.length !== 3) return f || null;
  const year = p[2].length === 2 ? '20' + p[2] : p[2];
  return `${year}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
}

/** Hoy en Argentina como "2026-12-25" (para guardar en columnas DATE). */
function hoyISO() {
  const { anio, mes, dia } = partesAR(new Date());
  return `${anio}-${mes}-${dia}`;
}

/** Hoy en Argentina como "25/12/2026" (para prellenar formularios). */
function hoyAR() {
  const { anio, mes, dia } = partesAR(new Date());
  return `${dia}/${mes}/${anio}`;
}

/**
 * Date | string | null → "25/12/2026".
 *
 * `fecha` en la base es DATE: un día del calendario, sin hora. El driver lo
 * convierte a un Date a medianoche de la zona del proceso — en Vercel, UTC. Si
 * encima se formateara en horario argentino, esa medianoche UTC retrocede a las
 * 21:00 del día anterior y toda la lista de OTs aparece un día antes. Por eso
 * acá NO se fuerza la zona: formatear en la misma zona en la que el driver armó
 * el Date devuelve el día exacto, corra donde corra.
 */
function fmtFecha(v) {
  if (!v) return '-';
  // Si ya viene como texto ISO no hay nada que convertir.
  const m = typeof v === 'string' && v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${+m[3]}/${+m[2]}/${m[1]}`;
  const d = aFecha(v);
  return d ? d.toLocaleDateString('es-AR') : '-';
}

/**
 * Date | string | null → "25/12/2026 14:30".
 * Las OTs anteriores a la migración tienen creado_en a medianoche porque se
 * backfillearon desde `fecha`: ahí no hay hora real que mostrar, solo la fecha.
 */
function fmtFechaHora(v) {
  const d = aFecha(v);
  if (!d) return '-';
  const { anio, mes, dia } = partesAR(d);
  const fecha = `${+dia}/${+mes}/${anio}`;
  const hora = horaAR(d);
  return hora === '00:00' ? fecha : `${fecha} ${hora}`;
}

/** Date | string | null → "14:30", o '-' si no hay hora real que mostrar. */
function fmtHora(v) {
  const d = aFecha(v);
  return d && tieneHora(v) ? horaAR(d) : '-';
}

/**
 * ¿El timestamp tiene una hora real? Los `creado_en` backfilleados quedaron a
 * medianoche exacta: mostrarlos como horario de ingreso, o medir cuánto duró la
 * OT desde ahí, sería inventar un dato que nunca se registró.
 */
function tieneHora(v) {
  const d = aFecha(v);
  return !!d && horaAR(d) !== '00:00';
}

/**
 * Cuánto pasó entre dos momentos → "45 min", "2 h 15 min", "3 d 4 h".
 * Devuelve null si falta alguno, si alguno no tiene hora real (dato
 * backfilleado) o si el cierre quedó antes del alta.
 */
function fmtDuracion(desde, hasta) {
  const a = aFecha(desde);
  const b = aFecha(hasta);
  if (!a || !b || !tieneHora(desde) || !tieneHora(hasta)) return null;
  const min = Math.round((b - a) / 60000);
  if (min < 0) return null;
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const resto = min % 60;
  if (horas < 24) return resto ? `${horas} h ${resto} min` : `${horas} h`;
  const dias = Math.floor(horas / 24);
  const hs = horas % 24;
  return hs ? `${dias} d ${hs} h` : `${dias} d`;
}

module.exports = {
  TZ, parseFecha, hoyISO, hoyAR,
  fmtFecha, fmtFechaHora, fmtHora, tieneHora, fmtDuracion,
};
