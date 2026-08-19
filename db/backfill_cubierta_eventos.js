// Reconstruye el historial de cubiertas a partir de los datos ya cargados.
// Es idempotente: se puede correr varias veces sin duplicar eventos.
// Ejecutar: node db/backfill_cubierta_eventos.js
require('dotenv').config();
const { sql } = require('./index');

// Los retiros se insertan ANTES que las colocaciones para que, en una rotación
// (la misma cubierta sale de una posición y entra en otra dentro de la misma OT),
// el retiro quede con id menor y el orden cronológico del tramo sea correcto.
(async () => {
  try {
    const n = (r) => (Array.isArray(r) ? r.length : 0);

    const alta = await sql`
      INSERT INTO cubierta_eventos (cubierta_id, tipo, fecha, detalle, origen)
      SELECT c.id, 'alta', c.fecha_remito,
             NULLIF(concat_ws(' ', 'Remito', c.remito), 'Remito'), 'backfill'
      FROM cubiertas c
      WHERE c.fecha_remito IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM cubierta_eventos e WHERE e.cubierta_id = c.id AND e.tipo = 'alta')
      RETURNING id`;
    console.log('altas (ingreso al sistema):', n(alta));

    const retiros = await sql`
      INSERT INTO cubierta_eventos (cubierta_id, tipo, fecha, micro_id, posicion, km_unidad, ot_id, detalle, origen)
      SELECT oc.cubierta_anterior_id, 'retiro', o.fecha, o.unidad_id, oc.posicion, o.km, o.id,
             'Sale por OT N° ' || o.id, 'backfill'
      FROM ot_cubiertas oc
      JOIN ots o ON o.id = oc.ot_id
      WHERE o.estado = 1 AND oc.cubierta_anterior_id IS NOT NULL
      ON CONFLICT DO NOTHING
      RETURNING id`;
    console.log('retiros:', n(retiros));

    const colocaciones = await sql`
      INSERT INTO cubierta_eventos (cubierta_id, tipo, fecha, micro_id, posicion, km_unidad, ot_id, detalle, origen)
      SELECT oc.cubierta_id, 'colocacion', o.fecha, o.unidad_id, oc.posicion, o.km, o.id,
             'Entra por OT N° ' || o.id, 'backfill'
      FROM ot_cubiertas oc
      JOIN ots o ON o.id = oc.ot_id
      WHERE o.estado = 1 AND oc.cubierta_id IS NOT NULL
      ON CONFLICT DO NOTHING
      RETURNING id`;
    console.log('colocaciones:', n(colocaciones));

    // El arreglo se atribuye a la cubierta que salió de la unidad: es la que se
    // desmontó para trabajarla. Las OTs con arreglo pero sin cubiertas registradas
    // no se pueden atribuir a ninguna cubierta y quedan afuera.
    const reparaciones = await sql`
      INSERT INTO cubierta_eventos (cubierta_id, tipo, fecha, micro_id, posicion, km_unidad, ot_id, detalle, origen)
      SELECT oc.cubierta_anterior_id, 'reparacion', o.fecha, o.unidad_id, oc.posicion, o.km, o.id,
             'Arreglo registrado en la OT N° ' || o.id, 'backfill'
      FROM ot_cubiertas oc
      JOIN ots o ON o.id = oc.ot_id
      WHERE o.estado = 1 AND o.arreglo = TRUE AND oc.cubierta_anterior_id IS NOT NULL
      ON CONFLICT DO NOTHING
      RETURNING id`;
    console.log('reparaciones:', n(reparaciones));

    // Cubiertas montadas hoy que nunca pasaron por una OT (vienen de la importación
    // inicial): se les registra la colocación sin fecha, para que el tramo exista.
    const sinFecha = await sql`
      INSERT INTO cubierta_eventos (cubierta_id, tipo, fecha, micro_id, posicion, origen, detalle)
      SELECT c.id, 'colocacion', NULL, c.micro_id, c.posicion, 'backfill',
             'Colocación anterior al historial (fecha y km sin registrar)'
      FROM cubiertas c
      WHERE c.micro_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM cubierta_eventos e WHERE e.cubierta_id = c.id AND e.tipo = 'colocacion')
      RETURNING id`;
    console.log('colocaciones sin fecha (previas al historial):', n(sinFecha));

    // Cubiertas cuyo primer movimiento registrado es un RETIRO: ya estaban montadas
    // antes de que existiera el historial. Se les abre el tramo con una colocación
    // sin fecha para que el retiro no quede huérfano en la línea de tiempo.
    const previas = await sql`
      WITH primer_mov AS (
        SELECT DISTINCT ON (cubierta_id) cubierta_id, tipo, micro_id, posicion
        FROM cubierta_eventos
        WHERE tipo IN ('colocacion', 'retiro')
        ORDER BY cubierta_id, fecha ASC NULLS FIRST, id ASC
      )
      INSERT INTO cubierta_eventos (cubierta_id, tipo, fecha, micro_id, posicion, origen, detalle)
      SELECT pm.cubierta_id, 'colocacion', NULL, pm.micro_id, pm.posicion, 'backfill',
             'Colocación anterior al historial (fecha y km sin registrar)'
      FROM primer_mov pm
      WHERE pm.tipo = 'retiro'
        AND NOT EXISTS (
          SELECT 1 FROM cubierta_eventos e
          WHERE e.cubierta_id = pm.cubierta_id AND e.tipo = 'colocacion' AND e.fecha IS NULL)
      RETURNING id`;
    console.log('colocaciones sin fecha (retiros previos al historial):', n(previas));

    // Control de consistencia: el último movimiento cronológico tiene que coincidir
    // con dónde está hoy la cubierta. Si no coincide, se movió por fuera del flujo de OTs.
    const desfasadas = await sql`
      WITH ultimo_mov AS (
        SELECT DISTINCT ON (cubierta_id) cubierta_id, tipo, micro_id
        FROM cubierta_eventos
        WHERE tipo IN ('colocacion', 'retiro')
        ORDER BY cubierta_id, fecha DESC NULLS LAST, id DESC
      )
      SELECT COUNT(*) AS n
      FROM cubiertas c
      JOIN ultimo_mov um ON um.cubierta_id = c.id
      WHERE (um.tipo = 'colocacion' AND um.micro_id IS DISTINCT FROM c.micro_id)
         OR (um.tipo = 'retiro' AND c.micro_id IS NOT NULL)`;
    console.log('AVISO - cubiertas movidas por fuera del flujo de OTs:', desfasadas[0].n);

    const tot = await sql`SELECT tipo, COUNT(*) AS n FROM cubierta_eventos GROUP BY tipo ORDER BY tipo`;
    console.log('--- total en cubierta_eventos ---');
    tot.forEach(r => console.log('  ' + r.tipo + ':', r.n));
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
  process.exit(0);
})();
