// Historial de vida de una cubierta: eventos + km acumulados por tramo de montaje.
//
// Un "tramo" va desde una colocación hasta el retiro siguiente. Los km del tramo son
// la diferencia de kilometraje de la unidad entre ambos extremos. Si a alguno de los
// dos extremos le falta el km (movimientos anteriores al historial), el tramo se
// marca como incompleto y no suma al total: preferimos un total honesto y bajo antes
// que un número inventado.

const { sql } = require('../db');

const TIPOS = ['alta', 'colocacion', 'retiro', 'reparacion', 'recapado', 'baja'];

const TIPO_LABEL = {
  alta:       'Ingreso al sistema',
  colocacion: 'Colocación',
  retiro:     'Retiro',
  reparacion: 'Reparación',
  recapado:   'Recapado',
  baja:       'Baja',
};

// Registra un evento. Si la fila ya existe para (cubierta, tipo, ot) no la duplica,
// de modo que reprocesar el cierre de una OT sea inofensivo.
async function registrarEvento(ev) {
  if (!ev || !ev.cubierta_id || !TIPOS.includes(ev.tipo)) return;
  // El alta es única por cubierta y no lleva OT, así que el índice parcial no la cubre
  if (ev.tipo === 'alta') {
    const ya = await sql`SELECT 1 FROM cubierta_eventos WHERE cubierta_id = ${ev.cubierta_id} AND tipo = 'alta' LIMIT 1`;
    if (ya.length) return;
  }
  await sql`
    INSERT INTO cubierta_eventos
      (cubierta_id, tipo, fecha, micro_id, posicion, km_unidad, ot_id, detalle, origen)
    VALUES (
      ${ev.cubierta_id}, ${ev.tipo}, ${ev.fecha || null}, ${ev.micro_id || null},
      ${ev.posicion || null}, ${ev.km_unidad == null ? null : parseInt(ev.km_unidad)},
      ${ev.ot_id || null}, ${ev.detalle || null}, ${ev.origen || 'sistema'}
    )
    ON CONFLICT DO NOTHING`;
}

// Recorre los eventos en orden y arma los tramos de montaje con sus km.
// kmActualUnidad: km de la unidad donde la cubierta está montada hoy (null si no lo está).
function calcularTramos(eventos, kmActualUnidad) {
  const tramos = [];
  let abierto = null;

  for (const ev of eventos) {
    if (ev.tipo === 'colocacion') {
      // Una colocación sin retiro previo cierra el tramo anterior sin datos
      if (abierto) { abierto.incompleto = true; tramos.push(abierto); }
      abierto = {
        micro_id: ev.micro_id, unidad: ev.unidad, posicion: ev.posicion,
        desde: ev.fecha, km_desde: ev.km_unidad,
        hasta: null, km_hasta: null, km: null, incompleto: false, abierto: true,
      };
    } else if (ev.tipo === 'retiro' && abierto) {
      abierto.hasta = ev.fecha;
      abierto.km_hasta = ev.km_unidad;
      abierto.abierto = false;
      if (abierto.km_desde != null && ev.km_unidad != null && ev.km_unidad >= abierto.km_desde) {
        abierto.km = ev.km_unidad - abierto.km_desde;
      } else {
        abierto.incompleto = true;
      }
      tramos.push(abierto);
      abierto = null;
    }
  }

  if (abierto) {
    // Tramo todavía en curso: se mide contra el km de hoy de la unidad
    if (abierto.km_desde != null && kmActualUnidad != null && kmActualUnidad >= abierto.km_desde) {
      abierto.km = kmActualUnidad - abierto.km_desde;
      abierto.km_hasta = kmActualUnidad;
    } else {
      abierto.incompleto = true;
    }
    tramos.push(abierto);
  }

  return tramos;
}

// Devuelve todo lo necesario para mostrar la ficha de una cubierta.
async function fichaDeCubierta(cubiertaId) {
  const id = parseInt(cubiertaId) || 0;
  if (!id) return null;

  const [cubRows, eventos] = await Promise.all([
    sql`
      SELECT c.*, mr.marca, mr.modelo AS modelo_nombre, med.medida,
             a.nombre AS almacen_nombre, g.nombre AS gomeria_nombre,
             mi.unidad, mi.km_actual AS unidad_km_actual, p.proveedor
      FROM cubiertas c
      LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
      LEFT JOIN medidas med      ON c.medida_id = med.id
      LEFT JOIN almacen a        ON c.almacen_id = a.id
      LEFT JOIN gomeria g        ON c.gomeria_id = g.id
      LEFT JOIN micro mi         ON c.micro_id = mi.id
      LEFT JOIN proveedor p      ON c.proveedor_id = p.id
      WHERE c.id = ${id}`,
    sql`
      SELECT e.*, mi.unidad
      FROM cubierta_eventos e
      LEFT JOIN micro mi ON e.micro_id = mi.id
      WHERE e.cubierta_id = ${id}
      -- El alta encabeza siempre: es, por definición, lo primero que le pasó a la cubierta
      ORDER BY (CASE WHEN e.tipo = 'alta' THEN 0 ELSE 1 END), e.fecha ASC NULLS FIRST, e.id ASC`,
  ]);

  if (!cubRows.length) return null;
  const cubierta = cubRows[0];

  const tramos = calcularTramos(eventos, cubierta.micro_id ? cubierta.unidad_km_actual : null);
  const kmTotal = tramos.reduce((acc, t) => acc + (t.km || 0), 0);
  const hayIncompletos = tramos.some(t => t.incompleto);
  const reparaciones = eventos.filter(e => e.tipo === 'reparacion').length;
  const recapados = eventos.filter(e => e.tipo === 'recapado').length;
  const unidadesDistintas = new Set(
    eventos.filter(e => e.tipo === 'colocacion' && e.micro_id).map(e => e.micro_id)
  ).size;

  return {
    cubierta, eventos, tramos,
    resumen: { kmTotal, hayIncompletos, reparaciones, recapados, unidadesDistintas },
  };
}

module.exports = { registrarEvento, calcularTramos, fichaDeCubierta, TIPOS, TIPO_LABEL };
