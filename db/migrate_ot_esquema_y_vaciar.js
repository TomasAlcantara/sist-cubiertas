// Migración: la OT guarda cómo queda la unidad al cerrarse, y qué posiciones deja vacías.
// Ejecutar: node db/migrate_ot_esquema_y_vaciar.js  (idempotente, se puede repetir)
//
// Solo agrega columnas, y el código anterior no las lee: va ANTES del deploy del
// código que las usa (el cierre de una OT escribe `esquema_cierre`).
require('dotenv').config();
const { sql } = require('./index');

(async () => {
  try {
    // Las dos columnas van en una sola transacción: quedan las dos o ninguna. Con
    // lock_timeout, si la tabla está tomada la migración falla enseguida (y se
    // vuelve a correr) en vez de dejar esperando detrás suyo a todo lo que lea `ots`.
    await sql.transaction([
      sql`SET LOCAL lock_timeout = '5s'`,

      // ── Esquema de la unidad al cierre ─────────────────────────
      // La pantalla de una OT cerrada rellenaba las posiciones que la OT no había
      // tocado con lo que la unidad tiene montado hoy: una OT vieja "cambiaba" cada
      // vez que cambiaba la unidad. Ahora cada OT guarda su propia foto:
      //   { antes: { posicion: { id, fuego } }, despues: { ... } }
      // Queda en NULL para las OTs cerradas antes de esta migración: de ellas solo
      // se conoce lo que cambiaron, y no se reconstruye.
      sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS esquema_cierre JSONB`,

      // ── Posiciones que la OT deja vacías ───────────────────────
      // Una OT solo sabía decir "en esta posición entra esta cubierta". Para sacar
      // un auxilio sin poner otro hace falta anotar la posición, sin cubierta.
      sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS posiciones_vaciar TEXT[] NOT NULL DEFAULT '{}'`,
    ]);
    console.log('OK: ots.esquema_cierre');
    console.log('OK: ots.posiciones_vaciar');

    const [n] = await sql`
      SELECT COUNT(*) FILTER (WHERE estado = 1)::int AS cerradas,
             COUNT(*) FILTER (WHERE estado = 1 AND esquema_cierre IS NOT NULL)::int AS con_esquema
      FROM ots`;
    console.log(`   OTs cerradas: ${n.cerradas}; con esquema guardado: ${n.con_esquema}`);
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  }
  process.exit();
})();
