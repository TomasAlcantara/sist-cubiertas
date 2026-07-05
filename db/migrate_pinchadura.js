// Migración: agregar columna pinchadura a ots
// Ejecutar: node db/migrate_pinchadura.js
require('dotenv').config();
const { sql } = require('./index');

(async () => {
  try {
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS pinchadura BOOLEAN DEFAULT FALSE`;
    console.log('OK: columna pinchadura agregada a ots');
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
