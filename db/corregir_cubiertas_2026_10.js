// Corrección de cubiertas duplicadas por posición (octubre de 2026).
//
// Había unidades con dos cubiertas activas en la misma posición. El código que
// las generaba ya está corregido; esto limpia lo que quedó en la base.
// Correrlo DESPUÉS de deployar ese fix: con el código viejo en producción los
// duplicados se vuelven a generar.
//
// Uso:
//   node db/corregir_cubiertas_2026_10.js
//       SIMULA. Hace todo dentro de una transacción, muestra el plan y cómo
//       quedaría la base, y la deshace (ROLLBACK). No cambia ningún dato; lo
//       único que no vuelve atrás son los contadores de id, que saltan unos números.
//
//   node db/corregir_cubiertas_2026_10.js --aplicar --huella <huella>
//       APLICA. La huella es la que muestra la simulación: identifica el plan.
//       Si la base cambió desde entonces y el plan ya no es el mismo, no aplica.
//
//   --destino <id>   almacén para lo que sale sin destino conocido
//                    (por defecto "A VERIFICAR", que se crea si no existe)
//
// Qué hace, todo en una sola transacción y con las tablas bloqueadas para escritura:
//   1. Copia cubiertas, ot_cubiertas y cubierta_eventos al schema respaldo_202610.
//   2. Dos arreglos menores: filas de OT cuya "anterior" es la misma cubierta que
//      entra, y cubiertas montadas que además figuran en un almacén.
//   3. En cada posición duplicada deja una cubierta y manda las otras a un almacén.
//      Qué queda lo decide lib/correccionCubiertas.js (reglas R1 y R2). Lo que
//      las reglas no resuelven no se toca: queda listado para revisar a mano.
//   4. Borra las filas fantasma de las OTs y la "colocación" falsa que dejaron
//      en el historial de esa cubierta. Si otra OT "cerró" después ese tramo que
//      nunca existió, borra también ese retiro.
//   5. A la cubierta que sale y queda con una colocación abierta en su historial
//      le asienta el retiro (origen 'correccion').
//   6. Deja una entrada por unidad en el log de auditoría.
//   7. Verifica el resultado y prueba si ya se podrían crear los índices únicos.
//
// Volver atrás después de aplicar: las tablas de respaldo_202610 tienen la foto
// previa de las tres tablas (además del dump y de la branch de Neon).
require('dotenv').config();
const { Client } = require('pg');
const { planificarCorreccion, huellaDe } = require('../lib/correccionCubiertas');
const { ALMACEN_A_VERIFICAR, nombrePosicion } = require('../lib/otCubiertas');
const { hoyISO } = require('../lib/fechas');

// ─── Lo que se puede ajustar antes de correr ──────────────────────────────────

// A dónde vuelve lo que sale de una unidad cuando se sabe. Todo lo demás va al
// almacén por defecto.
// 5073 y 5074: salen los juegos 14410–14415 y 14403–14408, dados de alta el 7 y
// el 8/10 en BASE ZARATE para numerar las cubiertas de fábrica y reemplazados en
// la misma OT. Sus hermanas de lote (14416 y 14409) siguen en BASE ZARATE.
const DESTINO_POR_UNIDAD = { 5073: 'BASE ZARATE', 5074: 'BASE ZARATE' };

// Posiciones resueltas a mano: 'unidad:posicion' → fuego que queda.
// Ejemplo: { '337:ddd': '13305' }. Vacío: deciden las reglas.
const DECISIONES = {};

// ─── Argumentos ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const CON_VALOR = ['--huella', '--destino'];
const valorDe = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};
const desconocidos = args.filter((a, i) => a !== '--aplicar' && !CON_VALOR.includes(a) && !CON_VALOR.includes(args[i - 1]));
if (desconocidos.length) {
  console.error(`Argumento desconocido: ${desconocidos.join(' ')}. Ver el uso al principio de este archivo.`);
  process.exit(1);
}
const APLICAR = args.includes('--aplicar');
const HUELLA = valorDe('--huella');
const DESTINO_ID = args.includes('--destino') ? parseInt(valorDe('--destino')) : null;
if (args.includes('--destino') && !DESTINO_ID) {
  console.error('--destino necesita el id numérico de un almacén.');
  process.exit(1);
}

const USUARIO_LOG = 'correccion-2026-10';
const DETALLE_RETIRO = 'Corrección 10/2026: figuraba duplicada en esta posición. Se la retira; la fecha real del retiro no quedó registrada.';
const SCHEMA_RESPALDO = 'respaldo_202610';

const escribir = (texto = '') => console.log(texto);
const fuegos = (cubiertas) => cubiertas.map(c => c.fuego).join(' + ');

// ─── Lectura ──────────────────────────────────────────────────────────────────

async function leer(c) {
  const { rows: duplicadas } = await c.query(`
    SELECT c.micro_id, m.unidad, c.posicion, c.id, c.fuego
    FROM cubiertas c JOIN micro m ON m.id = c.micro_id
    WHERE c.activo = 1 AND c.posicion IS NOT NULL
      AND (c.micro_id, c.posicion) IN (
        SELECT micro_id, posicion FROM cubiertas
        WHERE activo = 1 AND micro_id IS NOT NULL AND posicion IS NOT NULL
        GROUP BY micro_id, posicion HAVING COUNT(*) > 1)
    ORDER BY m.unidad, c.posicion, c.id`);

  // `orden` crece con lo último que se escribió. ot_cubiertas no tiene fecha: el
  // orden sale de la transacción que escribió cada fila (xmin; a más antigüedad,
  // antes) y, dentro de la misma, de su lugar físico. Guardar una OT reescribía
  // todas sus filas vigentes, así que una fila fantasma es siempre más vieja que
  // la que la reemplazó. Se lee acá, antes de que este script toque la tabla.
  const { rows: filasOt } = await c.query(`
    SELECT oc.ot_id, o.unidad_id, o.estado, o.anulada,
           COALESCE(o.fecha, DATE '1900-01-01')::text AS fecha,
           oc.posicion, oc.cubierta_id, c.fuego,
           oc.xmin::text AS xmin, age(oc.xmin)::int AS edad, oc.ctid::text AS ctid,
           ROW_NUMBER() OVER (PARTITION BY oc.ot_id, oc.posicion ORDER BY age(oc.xmin) DESC, oc.ctid ASC)::int AS orden
    FROM ot_cubiertas oc
    JOIN ots o ON o.id = oc.ot_id
    JOIN cubiertas c ON c.id = oc.cubierta_id
    WHERE oc.posicion IS NOT NULL`);

  const { rows: almacenes } = await c.query('SELECT id, nombre, activo FROM almacen ORDER BY id');

  // Los dos arreglos menores: se leen para mostrarlos; se corrigen más abajo.
  const { rows: anteriorIgual } = await c.query(`
    SELECT oc.ot_id, oc.posicion, c.fuego
    FROM ot_cubiertas oc JOIN cubiertas c ON c.id = oc.cubierta_id
    WHERE oc.cubierta_anterior_id = oc.cubierta_id
    ORDER BY oc.ot_id, oc.posicion`);
  const { rows: montadasConAlmacen } = await c.query(`
    SELECT c.id, c.fuego, m.unidad, c.posicion, a.nombre AS almacen
    FROM cubiertas c JOIN micro m ON m.id = c.micro_id JOIN almacen a ON a.id = c.almacen_id
    WHERE c.activo = 1
    ORDER BY c.id`);

  return { duplicadas, filasOt, almacenes, anteriorIgual, montadasConAlmacen };
}

function resolverDestinos(almacenes) {
  const porNombre = (nombre) => almacenes.find(a => a.nombre.trim().toUpperCase() === nombre.toUpperCase());

  let porDefecto;
  if (DESTINO_ID) {
    porDefecto = almacenes.find(a => a.id === DESTINO_ID);
    if (!porDefecto) throw new Error(`--destino ${DESTINO_ID}: no existe un almacén con ese id.`);
    if (porDefecto.activo != 1) throw new Error(`--destino ${DESTINO_ID}: el almacén "${porDefecto.nombre}" está dado de baja.`);
  } else {
    // Si todavía no existe se crea al ejecutar, y recién ahí tiene id.
    porDefecto = porNombre(ALMACEN_A_VERIFICAR) || { id: null, nombre: ALMACEN_A_VERIFICAR, activo: 1 };
  }

  const fijos = {};
  for (const [unidad, nombre] of Object.entries(DESTINO_POR_UNIDAD)) {
    const almacen = porNombre(nombre);
    if (!almacen || almacen.activo != 1) {
      throw new Error(`El almacén "${nombre}", destino de lo que sale de la unidad ${unidad}, no existe o está dado de baja.`);
    }
    fijos[unidad] = almacen;
  }
  return { porDefecto, destinoDe: (unidad) => fijos[unidad] || porDefecto };
}

// ─── Mostrar el plan ──────────────────────────────────────────────────────────

function mostrarPlan(plan, huella, datos) {
  const unidades = [...new Set(plan.posiciones.map(p => p.unidad))];
  escribir(`Plan de corrección — huella ${huella}`);
  escribir(`Posiciones duplicadas: ${plan.posiciones.length + plan.pendientes.length}. `
    + `Se resuelven ${plan.posiciones.length} en ${unidades.length} unidad(es); quedan ${plan.pendientes.length} para revisar a mano.`);

  for (const unidad of unidades) {
    const suyas = plan.posiciones.filter(p => p.unidad === unidad);
    escribir(`\n  Unidad ${unidad} — lo que sale va a "${suyas[0].destino.nombre}"`);
    for (const p of suyas) {
      escribir(`    ${nombrePosicion(p.posicion).padEnd(16)} queda ${String(p.queda.fuego).padEnd(7)} sale ${fuegos(p.salen).padEnd(9)} `
        + `[${p.regla}] ${p.detalle}`);
    }
  }

  if (plan.pendientes.length) {
    escribir('\n  PARA REVISAR A MANO (no se tocan):');
    for (const p of plan.pendientes) {
      escribir(`    Unidad ${p.unidad} ${nombrePosicion(p.posicion)}: ${p.cubiertas.join(' + ')} — ${p.motivo}`);
    }
    escribir(`    Para resolver una, cargarla en DECISIONES al principio de este archivo: { '${plan.pendientes[0].unidad}:${plan.pendientes[0].posicion}': '<fuego que queda>' }`);
  }

  escribir(`\nFilas fantasma en OTs: ${plan.fantasmas.length} (se borran, junto con su "colocación" falsa en el historial y el retiro que la haya cerrado)`);
  for (const f of plan.fantasmas) {
    escribir(`    OT ${String(f.ot_id).padEnd(5)} ${nombrePosicion(f.posicion).padEnd(16)} se borra ${String(f.fuego).padEnd(7)} queda ${f.queda}`
      + (f.ot_abierta ? '   (OT ABIERTA)' : ''));
  }

  mostrarOrdenDeCarga(plan, datos.filasOt);

  escribir(`\nFilas de OT con "anterior" igual a la que entra: ${datos.anteriorIgual.length} (la anterior pasa a vacía)`);
  for (const a of datos.anteriorIgual) escribir(`    OT ${a.ot_id} ${nombrePosicion(a.posicion)}: ${a.fuego}`);

  escribir(`\nCubiertas montadas que además figuran en un almacén: ${datos.montadasConAlmacen.length} (se les quita el almacén)`);
  for (const m of datos.montadasConAlmacen) escribir(`    ${m.fuego}: unidad ${m.unidad} ${nombrePosicion(m.posicion)}, y almacén ${m.almacen}`);
}

/**
 * La evidencia detrás de "lo último que se cargó": cada OT con más de una fila en
 * la misma posición, fila por fila, para poder revisar el orden a ojo. Es lo que
 * decide qué fila fantasma se borra y, en las posiciones resueltas por R1, qué
 * cubierta queda montada. No decide nada: muestra lo que ya decidió el plan.
 */
function mostrarOrdenDeCarga(plan, filasOt) {
  const grupos = new Map();
  for (const f of filasOt) {
    const k = `${f.ot_id}:${f.posicion}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  const repetidos = [...grupos.values()].filter(g => g.length > 1)
    .map(g => [...g].sort((a, b) => a.orden - b.orden))
    .sort((a, b) => a[0].ot_id - b[0].ot_id || a[0].posicion.localeCompare(b[0].posicion));
  const seBorra = new Set(plan.fantasmas.map(f => `${f.ot_id}:${f.posicion}:${f.cubierta_id}`));
  const R1 = new Map(plan.posiciones.filter(p => p.regla === 'R1').map(p => [`${p.ot_id}:${p.posicion}`, p]));

  escribir(`\nOrden de carga dentro de cada OT: ${repetidos.length} posición(es) con más de una fila`);
  if (!repetidos.length) return;
  escribir('    xmin = número de la transacción que escribió la fila; edad = cuántas transacciones atrás fue (a más edad, más vieja).');
  escribir('    ctid = (página, lugar) físico de la fila: solo desempata entre filas de una misma transacción.');

  let porTransaccion = 0;
  const dudosas = [];
  for (const filas of repetidos) {
    const queda = filas.find(f => !seBorra.has(`${f.ot_id}:${f.posicion}:${f.cubierta_id}`));
    const r1 = R1.get(`${filas[0].ot_id}:${filas[0].posicion}`);
    filas.forEach((f, i) => {
      const cabeza = i === 0 ? `OT ${String(f.ot_id).padEnd(5)} ${nombrePosicion(f.posicion).padEnd(16)}` : ' '.repeat(25);
      escribir(`    ${cabeza} ${i + 1}° ${String(f.fuego).padEnd(7)} xmin ${String(f.xmin).padStart(9)}  edad ${String(f.edad).padStart(8)}  ctid ${String(f.ctid).padEnd(9)} `
        + (f === queda ? 'QUEDA' : 'se borra')
        + (i === 0 && r1 ? `   → decide la unidad ${r1.unidad}: queda montada la ${r1.queda.fuego}` : ''));
    });
    // La que queda tiene que ser de una transacción posterior a todas las que se borran.
    const flojas = filas.filter(f => f !== queda && !(queda && queda.edad < f.edad));
    const congelada = filas.some(f => f.edad >= 2147483647);
    if (!queda || flojas.length || congelada) {
      const motivo = !queda ? 'el plan no deja ninguna de estas filas'
        : congelada ? 'hay una fila sin transacción propia (congelada): su edad no dice cuándo se escribió'
        : queda.xmin === flojas[0].xmin ? 'se escribieron en la misma transacción: el orden lo da solo el lugar físico'
        : 'la que queda NO es la de la transacción más nueva: la decidió otra regla (decisión manual o posición de la unidad)';
      escribir(' '.repeat(29) + `(!) ${motivo}`);
      dudosas.push(`OT ${filas[0].ot_id} ${nombrePosicion(filas[0].posicion)}`);
    } else {
      porTransaccion++;
    }
  }
  escribir(`    Resumen: en ${porTransaccion} de ${repetidos.length} la fila que queda es de una transacción posterior a las que se borran.`
    + (dudosas.length ? ` Para mirar a mano: ${dudosas.join('; ')}.` : ''));
}

// ─── Ejecución ────────────────────────────────────────────────────────────────

/** Corre una escritura y exige que haya tocado exactamente las filas esperadas. */
async function exacto(c, esperadas, texto, valores, que) {
  const r = await c.query(texto, valores);
  if (r.rowCount !== esperadas) {
    throw new Error(`Al ${que} se esperaba tocar ${esperadas} fila(s) y fueron ${r.rowCount}: `
      + 'la base no está como cuando se armó el plan. No se aplica nada.');
  }
  return r;
}

async function respaldar(c, sello) {
  await c.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_RESPALDO}`);
  const tablas = [];
  for (const tabla of ['cubiertas', 'ot_cubiertas', 'cubierta_eventos']) {
    const copia = `${SCHEMA_RESPALDO}.${tabla}_${sello}`;
    const r = await c.query(`CREATE TABLE ${copia} AS TABLE public.${tabla}`);
    tablas.push(`${copia} (${r.rowCount} filas)`);
  }
  return tablas;
}

async function asegurarAlmacen(c, almacen) {
  if (almacen.id === null) {
    const { rows } = await c.query('INSERT INTO almacen (nombre) VALUES ($1) RETURNING id', [almacen.nombre]);
    almacen.id = rows[0].id;
    return `se crea el almacén "${almacen.nombre}"`;
  }
  if (almacen.activo != 1) {
    await exacto(c, 1, 'UPDATE almacen SET activo = 1 WHERE id = $1', [almacen.id], `reactivar el almacén "${almacen.nombre}"`);
    return `se reactiva el almacén "${almacen.nombre}"`;
  }
  return null;
}

async function ejecutar(c, plan, datos, porDefecto) {
  const hechos = [];

  if (plan.posiciones.some(p => p.destino === porDefecto)) {
    const nota = await asegurarAlmacen(c, porDefecto);
    if (nota) hechos.push(nota);
  }

  // Los dos arreglos menores van primero, mientras las filas siguen como se
  // leyeron: después una de esas cubiertas puede salir de su unidad, o una de
  // esas filas borrarse por fantasma, y la cuenta ya no daría.
  const anterior = await exacto(c, datos.anteriorIgual.length,
    'UPDATE ot_cubiertas SET cubierta_anterior_id = NULL WHERE cubierta_anterior_id = cubierta_id', [],
    'vaciar las "anteriores" iguales a la entrante');
  const almacen = await exacto(c, datos.montadasConAlmacen.length,
    'UPDATE cubiertas SET almacen_id = NULL WHERE activo = 1 AND micro_id IS NOT NULL AND almacen_id IS NOT NULL', [],
    'quitar el almacén a las cubiertas montadas');
  hechos.push(`${anterior.rowCount} "anterior(es)" vaciadas y ${almacen.rowCount} cubierta(s) montadas a las que se les quita el almacén`);

  // Las que salen: fuera de la unidad y al almacén. Solo si siguen donde el plan las vio.
  let salieron = 0;
  for (const p of plan.posiciones) {
    for (const s of p.salen) {
      await exacto(c, 1, `
        UPDATE cubiertas SET micro_id = NULL, posicion = NULL, almacen_id = $1, gomeria_id = NULL
        WHERE id = $2 AND micro_id = $3 AND posicion = $4 AND activo = 1`,
        [p.destino.id, s.id, p.micro_id, p.posicion], `sacar la ${s.fuego} de la unidad ${p.unidad} ${p.posicion}`);
      salieron++;
    }
  }
  hechos.push(`${salieron} cubierta(s) salen de su unidad`);

  // Filas fantasma, y la colocación que el cierre de esa OT le anotó a una
  // cubierta que nunca estuvo ahí. La colocación se conserva si, ya hechas las
  // salidas de arriba, esa cubierta sigue montada justo en esa unidad y posición:
  // entonces sí estuvo, y borrarla le dejaría el historial sin su tramo actual.
  let eventosBorrados = 0;
  const sueltos = [];
  for (const f of plan.fantasmas) {
    await exacto(c, 1, 'DELETE FROM ot_cubiertas WHERE ot_id = $1 AND cubierta_id = $2 AND posicion = $3',
      [f.ot_id, f.cubierta_id, f.posicion], `borrar la fila de la ${f.fuego} en la OT ${f.ot_id}`);
    const { rows: colocaciones } = await c.query(`
      DELETE FROM cubierta_eventos e
      WHERE e.ot_id = $1 AND e.cubierta_id = $2 AND e.posicion = $3 AND e.tipo = 'colocacion'
        AND NOT EXISTS (
          SELECT 1 FROM cubiertas cu JOIN ots o ON o.id = e.ot_id
          WHERE cu.id = e.cubierta_id AND cu.activo = 1
            AND cu.micro_id = o.unidad_id AND cu.posicion = e.posicion)
      RETURNING e.id, e.fecha::text AS fecha, e.micro_id`,
      [f.ot_id, f.cubierta_id, f.posicion]);
    eventosBorrados += colocaciones.length;

    // El tramo que abría esa colocación nunca existió. Si una OT posterior lo
    // "cerró" (anotó a esta cubierta como la anterior de esa posición, porque el
    // sistema la mostraba ahí), ese retiro tampoco pasó y quedaría suelto, sin
    // colocación que lo abra. Se borra solo el movimiento que le sigue a la
    // colocación en el historial de la cubierta (mismo orden que usa el historial:
    // fecha y, a igual fecha, id), y solo si es un retiro de esa misma unidad y posición.
    for (const col of colocaciones) {
      const { rows } = await c.query(`
        DELETE FROM cubierta_eventos r
        WHERE r.id = (
            SELECT s.id FROM cubierta_eventos s
            WHERE s.cubierta_id = $1 AND s.tipo IN ('colocacion', 'retiro')
              AND (COALESCE(s.fecha, '-infinity'::date), s.id) > (COALESCE($2::date, '-infinity'::date), $3::int)
            ORDER BY s.fecha ASC NULLS FIRST, s.id ASC LIMIT 1)
          AND r.tipo = 'retiro' AND r.micro_id = $4 AND r.posicion = $5
        RETURNING r.ot_id, r.fecha::text AS fecha, (SELECT unidad FROM micro WHERE id = r.micro_id) AS unidad`,
        [f.cubierta_id, col.fecha, col.id, col.micro_id, f.posicion]);
      for (const r of rows) {
        sueltos.push(`${f.fuego} (el del ${r.fecha || 'sin fecha'}, OT ${r.ot_id ?? '-'}, unidad ${r.unidad} ${nombrePosicion(f.posicion)})`);
      }
    }
  }
  hechos.push(`${plan.fantasmas.length} fila(s) fantasma borradas de las OTs y ${eventosBorrados} colocación(es) falsa(s) del historial`);
  hechos.push(`${sueltos.length} retiro(s) que cerraban una de esas colocaciones falsas, borrados` + (sueltos.length ? ': ' + sueltos.join('; ') : ''));

  // Si el historial de una que salió termina en una colocación, queda un tramo
  // abierto para siempre. Se cierra con un retiro fechado hoy y sin km, así el
  // tramo figura como incompleto y no suma kilómetros inventados.
  let retiros = 0;
  const hoy = hoyISO();
  for (const p of plan.posiciones) {
    for (const s of p.salen) {
      const { rows: [ultimo] } = await c.query(`
        SELECT tipo FROM cubierta_eventos
        WHERE cubierta_id = $1 AND tipo IN ('colocacion', 'retiro')
        ORDER BY fecha DESC NULLS LAST, id DESC LIMIT 1`, [s.id]);
      if (!ultimo || ultimo.tipo !== 'colocacion') continue;
      await c.query(`
        INSERT INTO cubierta_eventos (cubierta_id, tipo, fecha, micro_id, posicion, km_unidad, ot_id, detalle, origen)
        VALUES ($1, 'retiro', $2, $3, $4, NULL, NULL, $5, 'correccion')`,
        [s.id, hoy, p.micro_id, p.posicion, DETALLE_RETIRO]);
      retiros++;
    }
  }
  hechos.push(`${retiros} retiro(s) asentados en el historial`);

  // Log de auditoría: una entrada por unidad, y una por las filas de las OTs.
  for (const unidad of new Set(plan.posiciones.map(p => p.unidad))) {
    const suyas = plan.posiciones.filter(p => p.unidad === unidad);
    await c.query(`
      INSERT INTO auditoria (usuario, accion, entidad, entidad_id, descripcion, cambios)
      VALUES ($1, 'corregir', 'micro', $2, $3, $4::jsonb)`,
      [USUARIO_LOG, suyas[0].micro_id, `Corrección de cubiertas duplicadas — Interno ${unidad}`,
        JSON.stringify(suyas.map(p => ({
          campo: nombrePosicion(p.posicion),
          antes: [p.queda, ...p.salen].map(x => x.fuego).join(' + '),
          despues: `${p.queda.fuego} (sale ${fuegos(p.salen)} a ${p.destino.nombre})`,
        })))]);
  }
  if (plan.fantasmas.length) {
    await c.query(`
      INSERT INTO auditoria (usuario, accion, entidad, descripcion, cambios)
      VALUES ($1, 'corregir', 'ot', $2, $3::jsonb)`,
      [USUARIO_LOG, `Corrección: se quitaron ${plan.fantasmas.length} fila(s) de cubiertas que habían quedado duplicadas en OTs`,
        JSON.stringify(plan.fantasmas.map(f => ({
          campo: `OT ${f.ot_id} ${nombrePosicion(f.posicion)}`, antes: `${f.fuego} + ${f.queda}`, despues: f.queda,
        })))]);
  }

  return hechos;
}

// ─── Verificación, todavía dentro de la transacción ───────────────────────────

async function verificar(c, plan) {
  // Cada posición resuelta quedó con una sola cubierta: la que tenía que quedar.
  for (const p of plan.posiciones) {
    const { rows } = await c.query(
      'SELECT id FROM cubiertas WHERE micro_id = $1 AND posicion = $2 AND activo = 1', [p.micro_id, p.posicion]);
    if (rows.length !== 1 || rows[0].id !== p.queda.id) {
      throw new Error(`Unidad ${p.unidad} ${p.posicion}: después de corregir tendría que quedar solo la ${p.queda.fuego} y no es así.`);
    }
    for (const s of p.salen) {
      const { rows: [cub] } = await c.query('SELECT micro_id, posicion, almacen_id, activo FROM cubiertas WHERE id = $1', [s.id]);
      if (cub.micro_id !== null || cub.posicion !== null || cub.almacen_id !== p.destino.id || cub.activo != 1) {
        throw new Error(`La ${s.fuego} tendría que haber quedado desmontada, activa y en "${p.destino.nombre}", y no es así.`);
      }
    }
  }

  const { rows: duplicadas } = await c.query(`
    SELECT c.micro_id, c.posicion FROM cubiertas c
    WHERE c.activo = 1 AND c.micro_id IS NOT NULL AND c.posicion IS NOT NULL
    GROUP BY c.micro_id, c.posicion HAVING COUNT(*) > 1`);
  if (duplicadas.length !== plan.pendientes.length) {
    throw new Error(`Quedan ${duplicadas.length} posiciones duplicadas y se esperaban ${plan.pendientes.length} (las pendientes de revisar).`);
  }
  const { rows: fantasmas } = await c.query(`
    SELECT ot_id, posicion FROM ot_cubiertas WHERE posicion IS NOT NULL
    GROUP BY ot_id, posicion HAVING COUNT(*) > 1`);
  if (fantasmas.length) throw new Error(`Quedan ${fantasmas.length} OT(s) con más de una fila por posición.`);

  // ¿Ya se podrían crear los índices únicos? Se prueba de verdad y se deshace
  // siempre (savepoint), se esté simulando o aplicando: crearlos es otro paso.
  let indices = 'se pueden crear';
  await c.query('SAVEPOINT prueba_indices');
  try {
    await c.query(`
      CREATE UNIQUE INDEX prueba_ux_cubiertas_unidad_posicion ON cubiertas (micro_id, posicion)
      WHERE activo = 1 AND micro_id IS NOT NULL AND posicion IS NOT NULL`);
    await c.query(`
      CREATE UNIQUE INDEX prueba_ux_ot_cubiertas_ot_posicion ON ot_cubiertas (ot_id, posicion)
      WHERE posicion IS NOT NULL`);
  } catch (e) {
    indices = `todavía NO se pueden crear (${e.message})`;
  }
  await c.query('ROLLBACK TO SAVEPOINT prueba_indices');

  return { duplicadas: duplicadas.length, indices };
}

// ─── Principal ────────────────────────────────────────────────────────────────

async function main() {
  // La URL de Neon dice sslmode=require, que pg hoy trata como verify-full y avisa por
  // consola que eso va a cambiar. Se pide verify-full explícito: mismo control, sin aviso.
  const url = process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]*/, '$1sslmode=verify-full');
  // Sin límite, si el puerto no abre connect() se queda esperando para siempre.
  const c = new Client({ connectionString: url, ssl: true, connectionTimeoutMillis: 15000 });
  await c.connect();
  escribir(APLICAR ? 'Modo: APLICAR (COMMIT al final, si la huella coincide)' : 'Modo: SIMULACIÓN (ROLLBACK al final, no cambia ningún dato)');
  let bloqueoDesde = null;
  const bloqueadas = () => `Las tablas estuvieron bloqueadas para escritura ${((Date.now() - bloqueoDesde) / 1000).toFixed(1)} s.`;
  let codigo = 0;
  let abierta = false;
  try {
    await c.query('BEGIN');
    abierta = true;
    // Si no consigue los bloqueos enseguida, o algo se cuelga, corta en vez de
    // dejar a la app esperando.
    await c.query("SET LOCAL lock_timeout = '5s'");
    await c.query("SET LOCAL statement_timeout = '60s'");
    // Si esta conexión se cuelga con la transacción abierta, el servidor la corta
    // a los 30 s y suelta los bloqueos: ninguna consulta de acá tarda tanto.
    await c.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    // Nadie escribe en estas tablas mientras se lee, se decide y se corrige.
    // Las lecturas de la app siguen funcionando.
    await c.query('LOCK TABLE cubiertas, ot_cubiertas, cubierta_eventos, almacen IN SHARE ROW EXCLUSIVE MODE');
    bloqueoDesde = Date.now();

    const datos = await leer(c);
    const { porDefecto, destinoDe } = resolverDestinos(datos.almacenes);
    const plan = planificarCorreccion({
      duplicadas: datos.duplicadas, filasOt: datos.filasOt, decisiones: DECISIONES, destinoDe,
    });
    const huella = huellaDe(plan);
    mostrarPlan(plan, huella, datos);

    const hayAlgo = plan.posiciones.length || plan.fantasmas.length
      || datos.anteriorIgual.length || datos.montadasConAlmacen.length;
    if (!hayAlgo) {
      escribir(plan.pendientes.length
        ? `\nNada que corregir con las reglas: quedan ${plan.pendientes.length} posición(es) para resolver a mano.`
        : '\nNada que corregir.');
    } else if (APLICAR && HUELLA !== huella) {
      escribir(HUELLA
        ? `\nNO SE APLICÓ NADA: la huella pedida (${HUELLA}) no es la del plan de hoy (${huella}). La base cambió desde la simulación.`
        : '\nNO SE APLICÓ NADA: falta --huella. Revisá el plan de arriba y pasá su huella.');
      escribir(`Si el plan de arriba es el que querés:  node db/corregir_cubiertas_2026_10.js --aplicar --huella ${huella}`);
      codigo = 1;
    } else {
      const { rows: [{ sello }] } = await c.query(
        "SELECT to_char(NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYYMMDD_HH24MI') AS sello");
      if (!/^\d{8}_\d{4}$/.test(sello)) throw new Error('No se pudo armar el nombre de las tablas de respaldo.');
      const respaldo = await respaldar(c, sello);
      const hechos = await ejecutar(c, plan, datos, porDefecto);
      const resultado = await verificar(c, plan);

      escribir('\nResultado:');
      escribir(`    respaldo: ${respaldo.join(', ')}`);
      hechos.forEach(h => escribir('    ' + h));
      escribir(`    posiciones duplicadas que quedan: ${resultado.duplicadas}`);
      escribir(`    índices únicos: ${resultado.indices}`);

      if (APLICAR) {
        // Si el COMMIT falla a mitad de camino no se puede saber desde acá si llegó a aplicarse.
        desenlace = 'incierto';
        await c.query('COMMIT');
        desenlace = 'aplicado';
        abierta = false;
        escribir(`\nAPLICADO. ${bloqueadas()} Verificar con:  node db/auditar_cubiertas.js`);
      } else {
        await c.query('ROLLBACK');
        abierta = false;
        escribir(`\nSIMULACIÓN: se deshizo todo (ROLLBACK). La base quedó como estaba. ${bloqueadas()}`);
        escribir(`Para aplicar exactamente este plan:  node db/corregir_cubiertas_2026_10.js --aplicar --huella ${huella}`);
      }
    }
  } finally {
    if (abierta && desenlace === 'sin cambios') await c.query('ROLLBACK').catch(() => {});
    await c.end().catch(() => {});
  }
  return codigo;
}

// Qué pasó con la base, para no decir "no se aplicó nada" si el error llegó después del COMMIT.
let desenlace = 'sin cambios';

main().then(
  (codigo) => process.exit(codigo),
  (e) => {
    console.error('\nError: ' + e.message);
    console.error({
      'sin cambios': 'No se aplicó ningún cambio: la transacción se deshizo.',
      aplicado: 'Los cambios SÍ quedaron aplicados: el error fue posterior al COMMIT.',
      incierto: 'El error fue durante el COMMIT: no se sabe si los cambios se aplicaron. Verificar con  node db/auditar_cubiertas.js',
    }[desenlace]);
    process.exit(2);
  });
