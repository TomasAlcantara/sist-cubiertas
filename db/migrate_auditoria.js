// Migración: log de auditoría y baja lógica de OTs.
// Ejecutar: node db/migrate_auditoria.js
require('dotenv').config();
const { sql } = require('./index');

(async () => {
  try {
    // ── Log de auditoría ─────────────────────────────────────────
    // `usuario` guarda una copia del nombre además del id: si el usuario se da
    // de baja o se renombra, el log tiene que seguir siendo legible.
    await sql`
      CREATE TABLE IF NOT EXISTS auditoria (
        id          BIGSERIAL PRIMARY KEY,
        fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        usuario_id  INTEGER,
        usuario     VARCHAR(50),
        accion      VARCHAR(40) NOT NULL,
        entidad     VARCHAR(30) NOT NULL,
        entidad_id  INTEGER,
        descripcion TEXT,
        cambios     JSONB,
        ip          VARCHAR(45)
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_aud_fecha ON auditoria (fecha DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_aud_entidad ON auditoria (entidad, entidad_id, fecha DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_aud_usuario ON auditoria (usuario, fecha DESC)`;
    console.log('OK: tabla auditoria + índices');

    // ── Baja lógica de OTs ───────────────────────────────────────
    // Anular pasa de DELETE a marcar la fila: una OT borrada no dejaba rastro
    // de que existió, ni de qué tenía adentro.
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS anulada BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS anulada_por VARCHAR(50)`;
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS anulada_en TIMESTAMPTZ`;
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ots_anulada ON ots (anulada) WHERE anulada = FALSE`;
    console.log('OK: columnas de anulación en ots');

    const [n] = await sql`SELECT COUNT(*) AS n FROM ots WHERE anulada = TRUE`;
    console.log(`   OTs marcadas como anuladas hoy: ${n.n}`);
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  }
  process.exit();
})();
