require('dotenv').config();
const { sql } = require('../db');

async function run() {
  await sql`ALTER TABLE almacen    ADD COLUMN IF NOT EXISTS direccion     VARCHAR(200)`;
  await sql`ALTER TABLE almacen    ADD COLUMN IF NOT EXISTS localidad     VARCHAR(100)`;
  await sql`ALTER TABLE almacen    ADD COLUMN IF NOT EXISTS telefono      VARCHAR(50)`;
  await sql`ALTER TABLE almacen    ADD COLUMN IF NOT EXISTS cargar_id     BOOLEAN DEFAULT FALSE`;
  await sql`ALTER TABLE almacen    ADD COLUMN IF NOT EXISTS cargar_remito BOOLEAN DEFAULT FALSE`;

  await sql`ALTER TABLE gomeria    ADD COLUMN IF NOT EXISTS direccion     VARCHAR(200)`;
  await sql`ALTER TABLE gomeria    ADD COLUMN IF NOT EXISTS localidad     VARCHAR(100)`;
  await sql`ALTER TABLE gomeria    ADD COLUMN IF NOT EXISTS telefono      VARCHAR(50)`;

  await sql`ALTER TABLE recapadora ADD COLUMN IF NOT EXISTS direccion     VARCHAR(200)`;
  await sql`ALTER TABLE recapadora ADD COLUMN IF NOT EXISTS localidad     VARCHAR(100)`;
  await sql`ALTER TABLE recapadora ADD COLUMN IF NOT EXISTS telefono      VARCHAR(50)`;
  await sql`ALTER TABLE recapadora ADD COLUMN IF NOT EXISTS tipo_trabajo  VARCHAR(50)`;

  console.log('Migración completada.');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
