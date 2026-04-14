// Migración: agregar columna precio a cubiertas
// Ejecutar: node db/migrate_precio.js

require('dotenv').config();
const { sql } = require('./index');

(async () => {
  try {
    await sql`ALTER TABLE cubiertas ADD COLUMN IF NOT EXISTS precio DECIMAL(10,2)`;
    console.log('OK: columna precio agregada a cubiertas');
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
