// Migración: la cubierta deja de tener "estado" (Nueva/Usada/Recapada) y la
// tabla de presiones, los intervalos de mantenimiento y las mediciones de
// profundidad salen del sistema.
//
// NO dropea ninguna columna: `cubiertas.estado`, `medidas.presion`,
// `micro.ultima_alineacion/ultimo_preventivo` y la tabla `ot_mediciones` quedan
// en la base, huérfanas, por si algún día hacen falta. El código ya no las lee.
//
// Lo único que sí hace falta migrar es el recapado: era la única información
// del viejo `estado` que no se puede deducir de otro lado, y ahora vive como un
// hito del historial de la cubierta.
//
// Ejecutar: node db/migrate_quitar_estado.js  (idempotente, se puede repetir)
require('dotenv').config();
const { sql } = require('./index');

(async () => {
  try {
    // ── Recapadas → evento en el historial ───────────────────────
    // fecha NULL = sin dato: no sabemos cuándo se recapó, solo que se recapó.
    // origen 'backfill' la distingue de las que asiente el sistema de acá en más.
    const recapadas = await sql`
      SELECT c.id
      FROM cubiertas c
      WHERE c.estado = 3
        AND NOT EXISTS (
          SELECT 1 FROM cubierta_eventos e
          WHERE e.cubierta_id = c.id AND e.tipo = 'recapado'
        )`;

    for (const c of recapadas) {
      await sql`
        INSERT INTO cubierta_eventos (cubierta_id, tipo, fecha, detalle, origen)
        VALUES (${c.id}, 'recapado', NULL, 'Recapada según el estado anterior del sistema', 'backfill')`;
    }
    console.log(`OK: ${recapadas.length} recapado(s) asentados en el historial`);

    // ── Claves de config que ya nadie lee ────────────────────────
    // Solo estas cuatro: la tabla `config` guarda también las credenciales de
    // Gmail del aviso de pinchadura, que siguen en uso.
    const borradas = await sql`
      DELETE FROM config
      WHERE clave IN ('mm_min', 'mm_max', 'dias_alineacion', 'dias_preventivo')
      RETURNING clave`;
    console.log(`OK: ${borradas.length} clave(s) de config borradas`
      + (borradas.length ? ` (${borradas.map(b => b.clave).join(', ')})` : ''));

    console.log('\nListo. Las columnas viejas quedan en la base sin uso:');
    console.log('  · cubiertas.estado');
    console.log('  · medidas.presion');
    console.log('  · micro.ultima_alineacion / micro.ultimo_preventivo');
    console.log('  · tabla ot_mediciones');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
  process.exit(0);
})();
