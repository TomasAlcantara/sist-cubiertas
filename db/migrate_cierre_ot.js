// Migración: hora de salida de la OT + arreglo del backfill de la hora de entrada.
//
// 1. `ots.cerrado_en` — el momento en que se cierra la OT. Con `creado_en` como
//    hora de entrada, la diferencia entre las dos es lo que tardó el trabajo.
//
// 2. Arregla el `creado_en` que dejó migrate_gomeria_v2. Ese backfill hacía
//    `creado_en = fecha::timestamptz`, y como la Neon corre con TimeZone GMT,
//    eso guardó la medianoche UTC del día de la OT. En pantalla, en horario
//    argentino, la medianoche UTC son las 21:00 del DÍA ANTERIOR: una OT del 24
//    aparecía como "23/8/2026 21:00". Acá se corren esas filas a la medianoche
//    argentina, que es lo que el backfill quiso decir desde el principio.
//
//    Con la medianoche bien puesta, lib/fechas.js las muestra como fecha sola,
//    sin hora: son OTs viejas de las que nunca se registró la hora real, y
//    tampoco se les calcula una duración inventada.
//
// Ejecutar: node db/migrate_cierre_ot.js  (idempotente, se puede repetir)
require('dotenv').config();
const { sql } = require('./index');

const TZ = 'America/Argentina/Buenos_Aires';

(async () => {
  try {
    // ── Hora de salida ───────────────────────────────────────────
    // Sin DEFAULT y nullable a propósito: las OTs ya cerradas no tienen hora de
    // cierre registrada y no hay de dónde sacarla. NULL = "sin dato", que es la
    // verdad; poner NOW() les inventaría un cierre de hoy.
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS cerrado_en TIMESTAMPTZ`;
    console.log('OK: columna ots.cerrado_en');

    // ── Corrección del backfill de creado_en ─────────────────────
    // Solo toca las filas que quedaron EXACTAMENTE en la medianoche UTC de su
    // propia fecha, que es la huella que dejó el backfill viejo. Una OT con hora
    // real no matchea, y una ya corregida (medianoche argentina) tampoco: por eso
    // volver a correr esto no mueve nada.
    const antes = await sql`
      SELECT COUNT(*) AS n FROM ots
      WHERE creado_en = (fecha::timestamp AT TIME ZONE 'UTC')`;

    const corregidas = await sql`
      UPDATE ots
         SET creado_en = (fecha::timestamp AT TIME ZONE ${TZ})
       WHERE creado_en = (fecha::timestamp AT TIME ZONE 'UTC')
      RETURNING id`;
    console.log(`OK: ${corregidas.length} de ${antes[0].n} OTs con creado_en corrido a medianoche argentina`);

    // ── Control ──────────────────────────────────────────────────
    const control = await sql`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE creado_en = (fecha::timestamp AT TIME ZONE 'UTC')) AS quedan_mal,
        COUNT(*) FILTER (WHERE creado_en = (fecha::timestamp AT TIME ZONE ${TZ})) AS sin_hora_real,
        COUNT(*) FILTER (WHERE cerrado_en IS NOT NULL) AS con_hora_de_salida
      FROM ots`;
    const c = control[0];
    console.log(`\nControl sobre ${c.total} OTs:`);
    console.log(`  · ${c.quedan_mal} con creado_en en medianoche UTC (tiene que ser 0)`);
    console.log(`  · ${c.sin_hora_real} sin hora real de entrada (backfilleadas, muestran solo la fecha)`);
    console.log(`  · ${c.con_hora_de_salida} con hora de salida registrada`);
    if (Number(c.quedan_mal) !== 0) process.exitCode = 1;
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
  process.exit();
})();
