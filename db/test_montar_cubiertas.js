/**
 * Script de PRUEBA: monta cubiertas de almacén en las posiciones de una unidad.
 * Uso: node db/test_montar_cubiertas.js [ot_id]
 * Si no se pasa ot_id, usa la OT más reciente.
 */
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const otId = parseInt(process.argv[2]) || null;

  // 1. Obtener la OT y su unidad
  const otQuery = otId
    ? await sql`SELECT id, unidad_id FROM ots WHERE id = ${otId}`
    : await sql`SELECT id, unidad_id FROM ots ORDER BY id DESC LIMIT 1`;

  if (!otQuery.length || !otQuery[0].unidad_id) {
    console.log('No se encontró la OT o no tiene unidad asignada.');
    process.exit(1);
  }
  const ot = otQuery[0];
  console.log(`OT #${ot.id} → unidad_id: ${ot.unidad_id}`);

  // 2. Verificar si ya tiene cubiertas montadas
  const yaMonted = await sql`
    SELECT posicion FROM cubiertas WHERE micro_id = ${ot.unidad_id} AND activo = 1 AND posicion IS NOT NULL
  `;
  if (yaMonted.length > 0) {
    console.log('La unidad ya tiene cubiertas montadas:');
    yaMonted.forEach(c => console.log('  posicion:', c.posicion));
    process.exit(0);
  }

  // 3. Tomar cubiertas del almacén (sin unidad asignada)
  const posiciones = ['ddi', 'ddd', 'tie', 'tde'];
  const disponibles = await sql`
    SELECT id, fuego FROM cubiertas
    WHERE activo = 1 AND micro_id IS NULL AND posicion IS NULL
    ORDER BY id
    LIMIT ${posiciones.length}
  `;
  if (disponibles.length < posiciones.length) {
    console.log(`Solo hay ${disponibles.length} cubiertas disponibles, se necesitan ${posiciones.length}.`);
    process.exit(1);
  }

  // 4. Asignar cada cubierta a su posición en la unidad
  for (let i = 0; i < posiciones.length; i++) {
    const c = disponibles[i];
    const pos = posiciones[i];
    await sql`
      UPDATE cubiertas
      SET micro_id = ${ot.unidad_id}, posicion = ${pos}, almacen_id = NULL
      WHERE id = ${c.id}
    `;
    console.log(`  Fuego ${c.fuego} → ${pos}`);
  }

  console.log('\n✓ Listo. Ahora abrí la OT y hacé clic en una posición — vas a ver la sección de Rotación.');
}

main().catch(err => { console.error(err); process.exit(1); });
