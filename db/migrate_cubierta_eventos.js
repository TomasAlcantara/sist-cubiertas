// Migración: historial de vida de cada cubierta (eventos) + fechas de mantenimiento por unidad
// Ejecutar: node db/migrate_cubierta_eventos.js
require('dotenv').config();
const { sql } = require('./index');

(async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS cubierta_eventos (
        id SERIAL PRIMARY KEY,
        cubierta_id INTEGER NOT NULL REFERENCES cubiertas(id) ON DELETE CASCADE,
        tipo VARCHAR(20) NOT NULL,   -- alta | colocacion | retiro | reparacion | recapado | baja
        fecha DATE,                  -- NULL = sin dato (movimientos previos al historial)
        micro_id INTEGER REFERENCES micro(id),
        posicion VARCHAR(10),
        km_unidad INTEGER,           -- km de la unidad al momento del evento
        ot_id INTEGER REFERENCES ots(id) ON DELETE SET NULL,
        detalle TEXT,
        origen VARCHAR(10) DEFAULT 'sistema',  -- sistema | backfill
        creado_en TIMESTAMP DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cub_ev_cubierta ON cubierta_eventos (cubierta_id, fecha, id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cub_ev_ot ON cubierta_eventos (ot_id)`;
    // Evita duplicar eventos al re-ejecutar el backfill de una misma OT
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_cub_ev_unico
              ON cubierta_eventos (cubierta_id, tipo, ot_id)
              WHERE ot_id IS NOT NULL`;
    console.log('OK: tabla cubierta_eventos creada');

    await sql`ALTER TABLE micro ADD COLUMN IF NOT EXISTS ultima_alineacion DATE`;
    await sql`ALTER TABLE micro ADD COLUMN IF NOT EXISTS ultimo_preventivo DATE`;
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS preventivo BOOLEAN DEFAULT FALSE`;
    console.log('OK: columnas ultima_alineacion / ultimo_preventivo agregadas a micro');
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
  process.exit(0);
})();
