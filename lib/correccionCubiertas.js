// Corrección de cubiertas duplicadas: qué queda y qué sale en cada posición.
//
// Es la parte que decide, separada de la que escribe (db/corregir_cubiertas_2026_10.js)
// para poder probarla con datos armados a mano. No toca la base.
//
// De dónde salen los duplicados y por qué alcanza con dos reglas:
//
//  R1. Las dos cubiertas las montó la misma OT. Guardar una OT no reemplazaba
//      sus cubiertas: al elegir otra para una posición ya cargada, la fila de la
//      primera quedaba viva y el cierre montaba las dos. Lo que el usuario quiso
//      es lo último que eligió, así que queda la fila que se escribió última.
//  R2. Una la montó una OT y la otra viene de la carga inicial de abril, que
//      volcó el esquema del sistema viejo sin desalojar lo que ya había. Queda
//      la de la OT.
//
// Lo que no encaja en ninguna de las dos no se toca: queda para revisar a mano.

const crypto = require('crypto');

const clave = (unidad, posicion) => `${unidad}:${posicion}`;

// Más reciente primero: por fecha de la OT y, a igual fecha, por número.
const porOtReciente = (a, b) => (a.fecha === b.fecha ? b.ot_id - a.ot_id : (a.fecha < b.fecha ? 1 : -1));

/**
 * Decide una posición que tiene más de una cubierta activa.
 *
 * @param {object} p.posicion  { micro_id, unidad, posicion }
 * @param {object[]} p.cubiertas  las que hoy están ahí: { id, fuego,
 *        ots: [{ ot_id, fecha, orden }] } con las OTs cerradas de esa unidad que
 *        la montaron en esa posición; `orden` crece con lo último que se escribió.
 * @param {string} [p.decision]  fuego que tiene que quedar, si se resolvió a mano.
 *
 * @returns {{ queda: object, salen: object[], regla: string, ot_id: number|null, detalle: string }
 *          | { revisar: string }}
 */
function decidirPosicion({ posicion, cubiertas, decision }) {
  const nombre = `${posicion.unidad} ${posicion.posicion}`;

  if (decision !== undefined) {
    const queda = cubiertas.find(c => String(c.fuego) === String(decision));
    if (!queda) {
      throw new Error(`Decisión manual para ${nombre}: la cubierta ${decision} no está en esa posición `
        + `(están ${cubiertas.map(c => c.fuego).join(', ')})`);
    }
    return {
      queda, salen: cubiertas.filter(c => c !== queda), regla: 'manual', ot_id: null,
      detalle: 'decisión cargada a mano',
    };
  }

  const conOt = cubiertas.filter(c => c.ots.length);

  // R2: una sola tiene una OT que la respalde.
  if (conOt.length === 1) {
    const queda = conOt[0];
    const ot = [...queda.ots].sort(porOtReciente)[0];
    return {
      queda, salen: cubiertas.filter(c => c !== queda), regla: 'R2', ot_id: null,
      detalle: `la montó la OT ${ot.ot_id}; las otras vienen de la carga inicial`,
    };
  }

  if (conOt.length === 0) return { revisar: 'ninguna tiene una OT que la respalde' };

  // R1: la OT más reciente que las tiene a TODAS juntas en esta posición.
  const compartidas = cubiertas[0].ots
    .filter(o => cubiertas.every(c => c.ots.some(x => x.ot_id === o.ot_id)))
    .sort(porOtReciente);
  if (conOt.length < cubiertas.length || !compartidas.length) {
    return { revisar: 'las montaron OTs distintas: no hay una regla que decida cuál quedó' };
  }
  const ot = compartidas[0];
  const ordenEn = (c) => c.ots.find(x => x.ot_id === ot.ot_id).orden;
  const queda = [...cubiertas].sort((a, b) => ordenEn(b) - ordenEn(a))[0];

  // Si una de las que saldrían figura en una OT posterior, la evidencia se
  // contradice: mejor que lo mire alguien.
  const posterior = cubiertas.filter(c => c !== queda)
    .find(c => c.ots.some(x => porOtReciente(x, ot) < 0));
  if (posterior) {
    return { revisar: `la ${posterior.fuego} saldría por la OT ${ot.ot_id}, pero una OT posterior la vuelve a montar acá` };
  }

  return {
    queda, salen: cubiertas.filter(c => c !== queda), regla: 'R1', ot_id: ot.ot_id,
    detalle: `fue lo último que se cargó en la OT ${ot.ot_id}`,
  };
}

/**
 * Arma el plan completo. No decide nada que no esté en los datos que recibe.
 *
 * @param {object[]} p.duplicadas  una fila por cubierta en una posición repetida:
 *        { micro_id, unidad, posicion, id, fuego }
 * @param {object[]} p.filasOt  todas las filas con posición de ot_cubiertas:
 *        { ot_id, unidad_id, estado, anulada, fecha, posicion, cubierta_id, fuego, orden }
 * @param {object} p.decisiones  { 'unidad:posicion': fuego } resueltas a mano
 * @param {function} p.destinoDe  (unidad) → { id, nombre } del almacén para lo que sale
 *
 * @returns {{ posiciones: object[], pendientes: object[], fantasmas: object[] }}
 *   posiciones: una por posición resuelta, con `queda`, `salen` y `destino`.
 *   pendientes: posiciones que no se tocan, con el motivo.
 *   fantasmas:  filas de ot_cubiertas a borrar (más de una por posición en la misma OT).
 */
function planificarCorreccion({ duplicadas = [], filasOt = [], decisiones = {}, destinoDe }) {
  // ── Posiciones con más de una cubierta ────────────────────────
  const grupos = new Map();
  for (const d of duplicadas) {
    const k = clave(d.micro_id, d.posicion);
    if (!grupos.has(k)) grupos.set(k, { posicion: { micro_id: d.micro_id, unidad: d.unidad, posicion: d.posicion }, cubiertas: [] });
    grupos.get(k).cubiertas.push({
      id: d.id, fuego: d.fuego,
      // Solo cuentan las OTs cerradas de esa misma unidad que la pusieron en esa posición.
      ots: filasOt
        .filter(f => f.cubierta_id === d.id && f.unidad_id === d.micro_id && f.posicion === d.posicion
          && Number(f.estado) === 1 && !f.anulada)
        .map(f => ({ ot_id: f.ot_id, fecha: f.fecha, orden: Number(f.orden) })),
    });
  }

  const usadas = new Set();
  const posiciones = [];
  const pendientes = [];
  for (const g of grupos.values()) {
    const k = clave(g.posicion.unidad, g.posicion.posicion);
    const decision = decisiones[k];
    if (decision !== undefined) usadas.add(k);
    const r = decidirPosicion({ ...g, decision });
    if (r.revisar) pendientes.push({ ...g.posicion, cubiertas: g.cubiertas.map(c => c.fuego), motivo: r.revisar });
    else posiciones.push({ ...g.posicion, ...r, destino: destinoDe(g.posicion.unidad) });
  }
  const sobrantes = Object.keys(decisiones).filter(k => !usadas.has(k));
  if (sobrantes.length) {
    throw new Error(`Hay decisiones manuales para posiciones que no están duplicadas: ${sobrantes.join(', ')}`);
  }

  // ── Filas fantasma: más de una por posición dentro de la misma OT ──
  // Queda la última que se escribió, que es la que muestra la pantalla de la OT.
  const porOtYPosicion = new Map();
  for (const f of filasOt) {
    const k = clave(f.ot_id, f.posicion);
    if (!porOtYPosicion.has(k)) porOtYPosicion.set(k, []);
    porOtYPosicion.get(k).push(f);
  }
  const fantasmas = [];
  for (const filas of porOtYPosicion.values()) {
    if (filas.length < 2) continue;
    const ordenadas = [...filas].sort((a, b) => Number(a.orden) - Number(b.orden));
    let queda = ordenadas[ordenadas.length - 1];
    // Si esa posición también está duplicada en la unidad y ahí se decidió otra
    // cosa (a mano), la fila que queda es la de la cubierta que queda montada.
    const resuelta = posiciones.find(p => p.micro_id === queda.unidad_id && p.posicion === queda.posicion
      && filas.some(f => f.cubierta_id === p.queda.id));
    if (resuelta) queda = filas.find(f => f.cubierta_id === resuelta.queda.id);
    for (const f of ordenadas) {
      if (f === queda) continue;
      fantasmas.push({
        ot_id: f.ot_id, posicion: f.posicion, cubierta_id: f.cubierta_id, fuego: f.fuego,
        queda: queda.fuego, ot_abierta: Number(f.estado) !== 1,
      });
    }
  }

  const orden = (a, b) => String(a.unidad).localeCompare(String(b.unidad), 'es', { numeric: true })
    || a.posicion.localeCompare(b.posicion);
  posiciones.sort(orden);
  pendientes.sort(orden);
  fantasmas.sort((a, b) => a.ot_id - b.ot_id || a.posicion.localeCompare(b.posicion) || a.cubierta_id - b.cubierta_id);
  return { posiciones, pendientes, fantasmas };
}

/**
 * Huella del plan: cambia si cambia cualquier cosa que el plan vaya a escribir.
 * La simulación la muestra y `--aplicar` la exige, así lo que se aplica es
 * exactamente lo que se revisó y no lo que haya cambiado en la base después.
 */
function huellaDe(plan) {
  const resumen = {
    // El destino va por nombre: si el almacén "A VERIFICAR" todavía no existe, la
    // simulación lo crea y lo deshace, y al aplicar tendría otro id.
    posiciones: plan.posiciones.map(p => [p.micro_id, p.posicion, p.queda.id, p.salen.map(s => s.id).sort((a, b) => a - b), p.destino.nombre]),
    fantasmas: plan.fantasmas.map(f => [f.ot_id, f.posicion, f.cubierta_id]),
  };
  return crypto.createHash('sha256').update(JSON.stringify(resumen)).digest('hex').slice(0, 12);
}

module.exports = { decidirPosicion, planificarCorreccion, huellaDe };
