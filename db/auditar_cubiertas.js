// Auditoría de consistencia de las cubiertas. SOLO LECTURA.
//
// Uso:  node db/auditar_cubiertas.js [--detalle]
//
// Corre todos los chequeos en una única transacción READ ONLY (cualquier
// escritura fallaría) y muestra, para cada uno, cuántos casos hay y los
// primeros; con --detalle, todos.
//
// Termina con código 1 si queda algún caso de los que impiden crear los índices
// únicos: una posición con más de una cubierta, o una OT con más de una fila
// para la misma posición. El resto son avisos: datos para mirar, no para frenar.
require('dotenv').config();
const { sql } = require('./index');

const DETALLE = process.argv.includes('--detalle');
const MUESTRA = 15;

// Cada chequeo: la consulta (sin ejecutar: van todas juntas en la transacción) y
// cómo se muestra una fila. `bloquea` marca los que impiden crear los índices únicos.
const CHEQUEOS = [
  {
    titulo: 'Posiciones con más de una cubierta activa',
    bloquea: true,
    consulta: sql`
      SELECT m.unidad, c.posicion, COUNT(*)::int AS n, string_agg(c.fuego, ' / ' ORDER BY c.id) AS fuegos
      FROM cubiertas c JOIN micro m ON m.id = c.micro_id
      WHERE c.activo = 1 AND c.posicion IS NOT NULL
      GROUP BY c.micro_id, m.unidad, c.posicion HAVING COUNT(*) > 1
      ORDER BY m.unidad, c.posicion`,
    linea: (r) => `unidad ${r.unidad}  ${r.posicion}:  ${r.fuegos}`,
  },
  {
    titulo: 'OTs con más de una fila para la misma posición (filas fantasma)',
    bloquea: true,
    // ot_cubiertas no tiene fecha: el orden de carga sale de la transacción que
    // escribió cada fila (xmin). La de mayor antigüedad se escribió primero.
    consulta: sql`
      SELECT oc.ot_id, m.unidad, o.fecha::text AS fecha, o.estado, oc.posicion,
             string_agg(c.fuego, ' → ' ORDER BY age(oc.xmin) DESC, oc.ctid) AS fuegos
      FROM ot_cubiertas oc
      JOIN ots o ON o.id = oc.ot_id
      JOIN cubiertas c ON c.id = oc.cubierta_id
      LEFT JOIN micro m ON m.id = o.unidad_id
      WHERE oc.posicion IS NOT NULL
      GROUP BY oc.ot_id, m.unidad, o.fecha, o.estado, oc.posicion HAVING COUNT(*) > 1
      ORDER BY oc.ot_id, oc.posicion`,
    linea: (r) => `OT ${r.ot_id} (${r.fecha}, unidad ${r.unidad}, ${r.estado == 1 ? 'cerrada' : 'ABIERTA'})  ${r.posicion}:  ${r.fuegos}`,
    nota: 'En cada una, los fuegos van en el orden en que se cargaron: el último es el que quedó elegido.',
  },
  {
    titulo: 'OTs abiertas que hoy no se podrían cerrar',
    consulta: sql`
      SELECT o.id AS ot, m.unidad, oc.posicion, c.fuego,
             CASE WHEN c.activo <> 1 THEN 'está dada de baja'
                  ELSE 'figura montada en la unidad ' || mc.unidad END AS problema
      FROM ots o
      JOIN ot_cubiertas oc ON oc.ot_id = o.id
      JOIN cubiertas c ON c.id = oc.cubierta_id
      LEFT JOIN micro m ON m.id = o.unidad_id
      LEFT JOIN micro mc ON mc.id = c.micro_id
      WHERE o.estado = 0 AND o.anulada = FALSE AND oc.posicion IS NOT NULL
        AND (c.activo <> 1 OR (c.micro_id IS NOT NULL AND c.micro_id IS DISTINCT FROM o.unidad_id))
      ORDER BY o.id, oc.posicion`,
    linea: (r) => `OT ${r.ot} (unidad ${r.unidad})  ${r.posicion} ← ${r.fuego}: ${r.problema}`,
  },
  {
    titulo: 'Filas de OT donde la "anterior" es la misma cubierta que entra',
    consulta: sql`
      SELECT oc.ot_id, m.unidad, oc.posicion, c.fuego
      FROM ot_cubiertas oc
      JOIN ots o ON o.id = oc.ot_id
      JOIN cubiertas c ON c.id = oc.cubierta_id
      LEFT JOIN micro m ON m.id = o.unidad_id
      WHERE oc.cubierta_anterior_id = oc.cubierta_id
      ORDER BY oc.ot_id, oc.posicion`,
    linea: (r) => `OT ${r.ot_id} (unidad ${r.unidad})  ${r.posicion}: ${r.fuego}`,
  },
  {
    titulo: 'Cubiertas con la ubicación mal armada',
    consulta: sql`
      SELECT c.fuego, c.id, m.unidad, c.posicion, a.nombre AS almacen, g.nombre AS gomeria,
             CASE WHEN c.activo <> 1 THEN 'dada de baja pero montada'
                  WHEN c.micro_id IS NOT NULL AND c.posicion IS NULL THEN 'montada sin posición'
                  WHEN c.micro_id IS NULL AND c.posicion IS NOT NULL THEN 'con posición pero sin unidad'
                  WHEN c.micro_id IS NOT NULL AND c.almacen_id IS NOT NULL THEN 'montada y, a la vez, en un almacén'
                  WHEN c.micro_id IS NOT NULL THEN 'montada y, a la vez, en una gomería'
                  ELSE 'en un almacén y en una gomería a la vez' END AS problema
      FROM cubiertas c
      LEFT JOIN micro m ON m.id = c.micro_id
      LEFT JOIN almacen a ON a.id = c.almacen_id
      LEFT JOIN gomeria g ON g.id = c.gomeria_id
      WHERE (c.activo <> 1 AND c.micro_id IS NOT NULL)
         OR (c.activo = 1 AND (
               (c.micro_id IS NOT NULL AND c.posicion IS NULL)
            OR (c.micro_id IS NULL AND c.posicion IS NOT NULL)
            OR (c.micro_id IS NOT NULL AND (c.almacen_id IS NOT NULL OR c.gomeria_id IS NOT NULL))
            OR (c.micro_id IS NULL AND c.almacen_id IS NOT NULL AND c.gomeria_id IS NOT NULL)))
      ORDER BY c.id`,
    linea: (r) => `${r.fuego} (id ${r.id}): ${r.problema}`
      + [r.unidad && `unidad ${r.unidad} ${r.posicion || ''}`.trim(), r.almacen && `almacén ${r.almacen}`, r.gomeria && `gomería ${r.gomeria}`]
        .filter(Boolean).map(x => ' · ' + x).join(''),
  },
  {
    titulo: 'Cubiertas en una posición que el tipo de unidad no tiene',
    consulta: sql`
      SELECT m.unidad, m.tipo_unidad, c.posicion, c.fuego
      FROM cubiertas c JOIN micro m ON m.id = c.micro_id
      WHERE c.activo = 1 AND c.posicion IS NOT NULL
        AND NOT (c.posicion = ANY(CASE m.tipo_unidad
              WHEN 1 THEN ARRAY['ddi','ddd','tie','tde','ra']
              WHEN 2 THEN ARRAY['ddi','ddd','cie','cii','cdi','cde','tie','tde','ra','ra2']
              ELSE ARRAY['ddi','ddd','tie','tii','tdi','tde','ra','ra2'] END))
      ORDER BY m.unidad, c.posicion`,
    linea: (r) => `unidad ${r.unidad} (tipo ${r.tipo_unidad})  ${r.posicion}: ${r.fuego}`,
  },
  {
    titulo: 'Cubiertas activas sin ubicación, pero con movimientos en su historial',
    consulta: sql`
      SELECT c.fuego, c.id,
             (SELECT e.tipo || ' en ' || COALESCE(mu.unidad, '?') || ' ' || COALESCE(e.posicion, '')
                     || COALESCE(' (OT ' || e.ot_id || ')', '')
              FROM cubierta_eventos e LEFT JOIN micro mu ON mu.id = e.micro_id
              WHERE e.cubierta_id = c.id AND e.tipo IN ('colocacion', 'retiro')
              ORDER BY e.fecha DESC NULLS LAST, e.id DESC LIMIT 1) AS ultimo
      FROM cubiertas c
      WHERE c.activo = 1 AND c.micro_id IS NULL AND c.almacen_id IS NULL AND c.gomeria_id IS NULL
        AND EXISTS (SELECT 1 FROM cubierta_eventos e WHERE e.cubierta_id = c.id AND e.tipo IN ('colocacion', 'retiro'))
      ORDER BY c.id`,
    linea: (r) => `${r.fuego} (id ${r.id}): último movimiento, ${r.ultimo}`,
    nota: 'Suelen ser las desplazadas desde Admin > Unidades, que no les asigna almacén ni deja evento.',
  },
  {
    titulo: 'Cubiertas donde el último movimiento del historial no coincide con dónde están',
    consulta: sql`
      WITH ultimo_mov AS (
        SELECT DISTINCT ON (cubierta_id) cubierta_id, tipo, micro_id, posicion, ot_id
        FROM cubierta_eventos
        WHERE tipo IN ('colocacion', 'retiro')
        ORDER BY cubierta_id, fecha DESC NULLS LAST, id DESC)
      SELECT c.fuego, um.tipo, mu.unidad AS unidad_historial, um.posicion AS posicion_historial, um.ot_id,
             mc.unidad AS unidad_hoy, c.posicion AS posicion_hoy
      FROM cubiertas c
      JOIN ultimo_mov um ON um.cubierta_id = c.id
      LEFT JOIN micro mu ON mu.id = um.micro_id
      LEFT JOIN micro mc ON mc.id = c.micro_id
      WHERE c.activo = 1
        AND ((um.tipo = 'colocacion' AND (um.micro_id IS DISTINCT FROM c.micro_id OR um.posicion IS DISTINCT FROM c.posicion))
          OR (um.tipo = 'retiro' AND c.micro_id IS NOT NULL))
      ORDER BY c.fuego`,
    linea: (r) => `${r.fuego}: el historial termina en ${r.tipo} (${r.unidad_historial || '?'} ${r.posicion_historial || ''}`.trimEnd()
      + `${r.ot_id ? ', OT ' + r.ot_id : ''}) y hoy está ${r.unidad_hoy ? 'en ' + r.unidad_hoy + ' ' + r.posicion_hoy : 'desmontada'}`,
    nota: 'Movimientos hechos por fuera de una OT. No es un error de datos de hoy, sino historial incompleto.',
  },
  {
    titulo: 'Colocaciones seguidas en unidades distintas, sin retiro en el medio',
    consulta: sql`
      WITH mov AS (
        SELECT e.cubierta_id, e.tipo, e.micro_id, e.posicion, e.fecha, e.ot_id,
               LAG(e.tipo) OVER w AS tipo_previo, LAG(e.micro_id) OVER w AS micro_previo
        FROM cubierta_eventos e
        WHERE e.tipo IN ('colocacion', 'retiro')
        WINDOW w AS (PARTITION BY e.cubierta_id ORDER BY e.fecha ASC NULLS FIRST, e.id ASC))
      SELECT c.fuego, mp.unidad AS desde, mo.unidad AS hacia, mov.posicion, mov.fecha::text AS fecha, mov.ot_id
      FROM mov
      JOIN cubiertas c ON c.id = mov.cubierta_id
      LEFT JOIN micro mp ON mp.id = mov.micro_previo
      LEFT JOIN micro mo ON mo.id = mov.micro_id
      WHERE mov.tipo = 'colocacion' AND mov.tipo_previo = 'colocacion' AND mov.micro_previo IS DISTINCT FROM mov.micro_id
      ORDER BY mov.fecha, c.fuego`,
    linea: (r) => `${r.fuego}: de la unidad ${r.desde} a la ${r.hacia} (${r.posicion})${r.ot_id ? ' por la OT ' + r.ot_id : ''}, ${r.fecha || 'sin fecha'}`,
  },
  {
    titulo: 'Unidades cuyo km retrocede entre dos OTs cerradas',
    consulta: sql`
      WITH k AS (
        SELECT o.id, o.unidad_id, o.fecha, o.km,
               LAG(o.km) OVER w AS km_previo, LAG(o.id) OVER w AS ot_previa
        FROM ots o
        WHERE o.estado = 1 AND o.anulada = FALSE AND o.km IS NOT NULL
        WINDOW w AS (PARTITION BY o.unidad_id ORDER BY o.fecha, o.id))
      SELECT m.unidad, k.ot_previa, k.km_previo, k.id AS ot, k.km, k.fecha::text AS fecha
      FROM k JOIN micro m ON m.id = k.unidad_id
      WHERE k.km < k.km_previo
      ORDER BY k.fecha, k.id`,
    linea: (r) => `unidad ${r.unidad}: OT ${r.ot_previa} con ${r.km_previo} km y después OT ${r.ot} (${r.fecha}) con ${r.km} km`,
  },
  {
    titulo: 'Números de fuego repetidos entre cubiertas activas',
    consulta: sql`
      SELECT trim(fuego) AS fuego, COUNT(*)::int AS n, string_agg(id::text, ', ' ORDER BY id) AS ids
      FROM cubiertas
      WHERE activo = 1 AND fuego IS NOT NULL AND trim(fuego) <> ''
      GROUP BY trim(fuego) HAVING COUNT(*) > 1
      ORDER BY 1`,
    linea: (r) => `${r.fuego}: ${r.n} cubiertas (ids ${r.ids})`,
  },
];

const RESUMEN = sql`
  SELECT (SELECT COUNT(*)::int FROM cubiertas WHERE activo = 1) AS activas,
         (SELECT COUNT(*)::int FROM cubiertas WHERE activo = 1 AND micro_id IS NOT NULL) AS montadas,
         (SELECT COUNT(*)::int FROM cubiertas WHERE activo = 1 AND micro_id IS NULL AND almacen_id IS NOT NULL) AS en_almacen,
         (SELECT COUNT(*)::int FROM cubiertas WHERE activo = 1 AND micro_id IS NULL AND almacen_id IS NULL AND gomeria_id IS NULL) AS sin_ubicar,
         (SELECT COUNT(*)::int FROM ots WHERE estado = 0 AND anulada = FALSE) AS ots_abiertas,
         current_setting('transaction_read_only') AS solo_lectura,
         to_char(NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') AS ahora`;

(async () => {
  // REPEATABLE READ: todos los chequeos miran la misma foto de la base.
  const [resumen, ...resultados] = await sql.transaction(
    [RESUMEN, ...CHEQUEOS.map(c => c.consulta)],
    { readOnly: true, isolationLevel: 'RepeatableRead' });

  const r = resumen[0];
  console.log(`Auditoría de cubiertas — ${r.ahora} (transacción de solo lectura: ${r.solo_lectura})`);
  console.log(`${r.activas} cubiertas activas: ${r.montadas} montadas, ${r.en_almacen} en almacén, ${r.sin_ubicar} sin ubicar. `
    + `${r.ots_abiertas} OT(s) abierta(s).\n`);

  let bloqueantes = 0;
  CHEQUEOS.forEach((chequeo, i) => {
    const filas = resultados[i];
    const marca = !filas.length ? '  ok ' : (chequeo.bloquea ? ' FALTA' : ' aviso');
    console.log(`${marca}  ${chequeo.titulo}: ${filas.length}`);
    if (!filas.length) return;
    if (chequeo.bloquea) bloqueantes += filas.length;
    const visibles = DETALLE ? filas : filas.slice(0, MUESTRA);
    visibles.forEach(f => console.log('          ' + chequeo.linea(f)));
    if (visibles.length < filas.length) console.log(`          … y ${filas.length - visibles.length} más (--detalle para verlas todas)`);
    if (chequeo.nota) console.log('          (' + chequeo.nota + ')');
  });

  console.log(bloqueantes
    ? `\nQuedan ${bloqueantes} caso(s) que impiden crear los índices únicos.`
    : '\nSin posiciones duplicadas ni filas fantasma: los índices únicos se pueden crear.');
  process.exit(bloqueantes ? 1 : 0);
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(2);
});
