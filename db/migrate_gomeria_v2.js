// Migración: motivo rotura, hora de creación de OT, permisos por usuario,
// presión por medida y mediciones de profundidad por rueda.
// Ejecutar: node db/migrate_gomeria_v2.js
require('dotenv').config();
const { sql } = require('./index');

// Presiones del cartel del taller (PSI). La clave es la medida normalizada.
const PRESIONES = {
  '195/75/16':   62,
  '235/65/16':   45,
  '215/75/17.5': 90,
  '275/80/22.5': 110,
  '295/80/22.5': 115,
  '385/65/22.5': 115,
};

// "295/80R22.5", "295-80-22.5" y "295/80/22.5" son la misma medida escrita
// distinto. Nos quedamos solo con los números y los unimos con "/".
function normalizarMedida(m) {
  const partes = String(m == null ? '' : m).match(/\d+(?:[.,]\d+)?/g);
  return partes ? partes.map(p => p.replace(',', '.')).join('/') : '';
}

(async () => {
  try {
    // ── Columnas nuevas ──────────────────────────────────────────
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS rotura BOOLEAN DEFAULT FALSE`;
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ`;
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS descripcion_cierre TEXT`;
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS cerrado_por VARCHAR(100)`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos TEXT`;
    await sql`ALTER TABLE medidas ADD COLUMN IF NOT EXISTS presion INTEGER`;
    console.log('OK: columnas agregadas');

    // ── Mediciones de profundidad por posición ───────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS ot_mediciones (
        ot_id       INTEGER NOT NULL REFERENCES ots(id) ON DELETE CASCADE,
        posicion    VARCHAR(10) NOT NULL,
        cubierta_id INTEGER REFERENCES cubiertas(id),
        mm_ext      NUMERIC(4,1),
        mm_int      NUMERIC(4,1),
        PRIMARY KEY (ot_id, posicion)
      )`;
    console.log('OK: tabla ot_mediciones');

    // ── Backfill de creado_en ────────────────────────────────────
    // La columna se agrega sin DEFAULT a propósito: si tuviera NOW() todas las
    // OTs históricas quedarían con la fecha de esta migración. Se rellenan con
    // su propia fecha (a medianoche) y recién ahí se activa el default.
    // La medianoche es la ARGENTINA: `fecha::timestamptz` la tomaba como UTC y
    // en pantalla eso son las 21:00 del día anterior (ver migrate_cierre_ot.js).
    const back = await sql`
      UPDATE ots
         SET creado_en = (fecha::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
       WHERE creado_en IS NULL`;
    await sql`ALTER TABLE ots ALTER COLUMN creado_en SET DEFAULT NOW()`;
    console.log(`OK: creado_en backfilleado (${back.length ?? 0} filas) y default activado`);

    // ── Config de milímetros ─────────────────────────────────────
    await sql`INSERT INTO config (clave, valor) VALUES ('mm_min', '4')  ON CONFLICT (clave) DO NOTHING`;
    await sql`INSERT INTO config (clave, valor) VALUES ('mm_max', '20') ON CONFLICT (clave) DO NOTHING`;
    console.log('OK: config mm_min=4 / mm_max=20 (no pisa valores existentes)');

    // ── Presiones por medida ─────────────────────────────────────
    const medidas = await sql`SELECT id, medida, presion FROM medidas ORDER BY medida`;
    const sinPresion = [];
    let cargadas = 0;
    let respetadas = 0;
    for (const m of medidas) {
      const psi = PRESIONES[normalizarMedida(m.medida)];
      if (!psi) {
        if (m.presion == null) sinPresion.push(m.medida);
        continue;
      }
      // Solo se completa lo que está vacío: si alguien ya ajustó la presión a
      // mano, volver a correr esta migración no se la pisa.
      if (m.presion != null) {
        if (m.presion !== psi) respetadas++;
        continue;
      }
      await sql`UPDATE medidas SET presion = ${psi} WHERE id = ${m.id} AND presion IS NULL`;
      cargadas++;
    }
    console.log(`OK: presión cargada en ${cargadas} de ${medidas.length} medidas`);
    if (respetadas) console.log(`   (${respetadas} ya tenían una presión distinta cargada a mano: se respetaron)`);
    if (sinPresion.length) {
      console.log('\nMedidas SIN presión — cargarlas a mano en Admin > Medidas:');
      sinPresion.forEach(m => console.log('  · ' + m));
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  }
  process.exit();
})();
