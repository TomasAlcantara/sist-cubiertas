// Migración: la base no admite más dos cubiertas en la misma posición.
// Ejecutar: node db/migrate_integridad_cubiertas.js  (idempotente, se puede repetir)
//
// Crea dos índices únicos:
//   - ux_cubiertas_unidad_posicion: una sola cubierta activa por posición de cada unidad.
//   - ux_ot_cubiertas_ot_posicion:  una sola fila por posición dentro de cada OT.
//
// Va DESPUÉS de db/corregir_cubiertas_2026_10.js: mientras quede una posición
// duplicada los índices no se pueden crear, y este script lo dice antes de intentarlo.
// El código ya convive con ellos: el cierre de una OT suelta las cubiertas que
// rotan antes de colocar las que entran, y si igual choca (dos cierres a la vez
// sobre la misma unidad) responde "volvé a intentarlo" en vez de duplicar.
require('dotenv').config();
const { sql } = require('./index');

const INDICES = {
  ux_cubiertas_unidad_posicion: 'cubiertas',
  ux_ot_cubiertas_ot_posicion: 'ot_cubiertas',
};

(async () => {
  try {
    // Con datos duplicados el CREATE falla con un error de Postgres que no dice
    // dónde está el problema: se mira antes, y se muestra.
    const [posiciones, filas] = await sql.transaction([
      sql`
        SELECT m.unidad, c.posicion, COUNT(*)::int AS cubiertas
        FROM cubiertas c JOIN micro m ON m.id = c.micro_id
        WHERE c.activo = 1 AND c.micro_id IS NOT NULL AND c.posicion IS NOT NULL
        GROUP BY m.unidad, c.posicion HAVING COUNT(*) > 1
        ORDER BY m.unidad, c.posicion`,
      sql`
        SELECT ot_id, posicion, COUNT(*)::int AS filas
        FROM ot_cubiertas WHERE posicion IS NOT NULL
        GROUP BY ot_id, posicion HAVING COUNT(*) > 1
        ORDER BY ot_id, posicion`,
    ], { readOnly: true });
    if (posiciones.length || filas.length) {
      console.error('No se crean los índices: todavía hay datos duplicados.');
      posiciones.forEach(p => console.error(`   unidad ${p.unidad} ${p.posicion}: ${p.cubiertas} cubiertas activas`));
      filas.forEach(f => console.error(`   OT ${f.ot_id} ${f.posicion}: ${f.filas} filas`));
      console.error('Corregirlos primero con:  node db/corregir_cubiertas_2026_10.js');
      process.exitCode = 1;
      return;
    }

    // Los dos en una sola transacción: quedan los dos o ninguno. Crear un índice
    // frena las escrituras de esa tabla mientras se arma (son tablas chicas, es un
    // instante); con lock_timeout, si la tabla está tomada falla enseguida en vez
    // de dejar a la app esperando.
    await sql.transaction([
      sql`SET LOCAL lock_timeout = '5s'`,

      // ── Una sola cubierta activa por posición de cada unidad ───
      // Las dadas de baja y las que no están montadas no entran en el índice.
      sql`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_cubiertas_unidad_posicion
        ON cubiertas (micro_id, posicion)
        WHERE activo = 1 AND micro_id IS NOT NULL AND posicion IS NOT NULL`,

      // ── Una sola fila por posición dentro de cada OT ───────────
      // Las filas sin posición (cubiertas enviadas a gomería desde la OT) no entran.
      sql`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_ot_cubiertas_ot_posicion
        ON ot_cubiertas (ot_id, posicion)
        WHERE posicion IS NOT NULL`,
    ]);

    // IF NOT EXISTS no mira la definición: si ya había un índice con ese nombre
    // pero armado distinto, lo deja como está. Se comprueba lo que quedó.
    const creados = await sql`
      SELECT c.relname AS indice, t.relname AS tabla, i.indisunique, i.indisvalid, pg_get_indexdef(i.indexrelid) AS definicion
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      WHERE c.relname = ANY(${Object.keys(INDICES)})
      ORDER BY c.relname`;
    for (const [indice, tabla] of Object.entries(INDICES)) {
      const i = creados.find(x => x.indice === indice);
      if (!i || i.tabla !== tabla || !i.indisunique || !i.indisvalid) {
        throw new Error(`el índice ${indice} no quedó como se esperaba: ${i ? JSON.stringify(i) : 'no existe'}`);
      }
      console.log(`OK: ${indice}`);
      console.log(`    ${i.definicion}`);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  }
})().finally(() => process.exit());
