// Esquema de la unidad en las OTs cerradas antes de que se guardara (octubre de 2026).
//
// Desde el 13/10 cada OT guarda al cerrarse cómo quedó armada la unidad
// (ots.esquema_cierre). Las cerradas antes no lo tienen y la pantalla solo muestra
// lo que cada una cambió: un preventivo se ve con todas las posiciones "sin
// registro". Esto lo reconstruye desde el historial de movimientos en las OTs con
// hora de cierre conocida (desde el 20/08) y lo guarda marcado como reconstruido;
// la OT lo avisa con una nota. Cómo se reconstruye: lib/reconstruccionEsquemas.js.
//
// Uso:
//   node db/reconstruir_esquemas_2026_10.js
//       SIMULA. Lee la base, arma el plan y lo muestra completo. No escribe nada.
//
//   node db/reconstruir_esquemas_2026_10.js --aplicar --huella <huella>
//       APLICA. La huella es la que muestra la simulación: identifica el plan. Si
//       la base cambió desde entonces y el plan ya no es el mismo, no aplica.
//
// Solo escribe ots.esquema_cierre en OTs cerradas que no lo tienen, y una entrada
// en la auditoría. Volver atrás:
//   UPDATE ots SET esquema_cierre = NULL WHERE esquema_cierre->>'reconstruido' = 'true';
require('dotenv').config();
const { sql } = require('./index');
const { planificarReconstruccion, huellaDe } = require('../lib/reconstruccionEsquemas');
const { POSICIONES } = require('../lib/otCubiertas');
const { fmtFecha, fmtFechaHora } = require('../lib/fechas');

const args = process.argv.slice(2);
const valorDe = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};
const desconocidos = args.filter((a, i) => a !== '--aplicar' && a !== '--huella' && args[i - 1] !== '--huella');
if (desconocidos.length) {
  console.error(`Argumento desconocido: ${desconocidos.join(' ')}. Ver el uso al principio de este archivo.`);
  process.exit(1);
}
const APLICAR = args.includes('--aplicar');
const HUELLA = valorDe('--huella');

const USUARIO_LOG = 'reconstruccion-2026-10';
const escribir = (texto = '') => console.log(texto);
const ordenPos = (a, b) => (POSICIONES.indexOf(a) + 1 || 99) - (POSICIONES.indexOf(b) + 1 || 99) || a.localeCompare(b);

// ─── Lectura ──────────────────────────────────────────────────────────────────

async function leer() {
  // Todo en una transacción de solo lectura: una sola foto de la base.
  const [ots, montadas, eventos, colocacionesAuditadas, cierresAuditados, filas, micros, cubiertas] = await sql.transaction([
    sql`SELECT o.id, o.unidad_id, m.unidad, o.fecha::text AS fecha, o.cerrado_en, o.esquema_cierre
        FROM ots o LEFT JOIN micro m ON m.id = o.unidad_id
        WHERE o.estado = 1 AND NOT o.anulada`,
    sql`SELECT id, micro_id, posicion FROM cubiertas
        WHERE activo = 1 AND micro_id IS NOT NULL AND posicion IS NOT NULL`,
    // creado_en es "timestamp" sin zona, escrito en la de la base (GMT).
    sql`SELECT id, cubierta_id, tipo, micro_id, posicion, ot_id, origen, fecha::text AS fecha,
               (creado_en AT TIME ZONE 'GMT') AS creado_en
        FROM cubierta_eventos WHERE tipo IN ('colocacion', 'retiro')`,
    sql`SELECT fecha, entidad_id AS cubierta_id, cambios FROM auditoria
        WHERE entidad = 'cubierta' AND accion = 'colocar'`,
    sql`SELECT entidad_id AS ot_id, MIN(fecha) AS fecha FROM auditoria
        WHERE entidad = 'ot' AND accion = 'cerrar' AND entidad_id IS NOT NULL
        GROUP BY entidad_id`,
    sql`SELECT ot_id, posicion, cubierta_id, cubierta_anterior_id FROM ot_cubiertas WHERE posicion IS NOT NULL`,
    sql`SELECT id, unidad FROM micro`,
    sql`SELECT id, fuego FROM cubiertas`,
  ], { readOnly: true });
  const fuegos = new Map(cubiertas.map(c => [c.id, c.fuego]));
  return { ots, montadas, eventos, colocacionesAuditadas, cierresAuditados, filas, micros, fuegos };
}

// ─── Lo que se muestra ────────────────────────────────────────────────────────

const rango = (lista, valor) => {
  const v = lista.map(valor).sort((a, b) => a - b);
  return v.length ? `${fmtFechaHora(new Date(v[0]))} a ${fmtFechaHora(new Date(v[v.length - 1]))}` : '-';
};

// Una línea por OT: cómo quedó cada posición y, si la OT la cambió, qué salió.
function lineaDeEsquema(esquema) {
  const { antes, despues } = esquema;
  const sinRegistro = esquema.sin_registro || [];
  const posiciones = [...new Set([...Object.keys(antes), ...Object.keys(despues), ...sinRegistro])].sort(ordenPos);
  return posiciones.map(p => {
    if (sinRegistro.includes(p)) return `${p} ?`;
    const a = antes[p];
    const d = despues[p];
    const ahora = d ? (d.fuego || '#' + d.id) : 'vacía';
    const cambio = (a ? a.id : null) !== (d ? d.id : null);
    return `${p} ${ahora}` + (cambio ? ` (sale ${a ? (a.fuego || '#' + a.id) : 'nada'})` : '');
  }).join('  ');
}

function mostrar(plan, datos, huella) {
  const sinEsquema = datos.ots.filter(o => !o.esquema_cierre);
  const sinUnidad = sinEsquema.filter(o => !o.unidad_id).length;
  const conHora = [...plan.reconstruidas, ...plan.descartadas, ...plan.sinCubiertas];
  const conSinRegistro = plan.reconstruidas.filter(r => r.esquema.sin_registro);
  const filasControladas = plan.reconstruidas.reduce((n, r) => n + r.filas, 0)
    + plan.descartadas.reduce((n, d) => n + d.filas, 0);
  const filasDistintas = plan.descartadas.reduce((n, d) => n + d.distintas, 0);

  escribir(`\nOTs cerradas sin esquema guardado: ${sinEsquema.length}`);
  escribir(`  con hora de cierre (${rango(conHora, x => x.cerrada)}): ${conHora.length}`);
  escribir(`      se reconstruyen: ${plan.reconstruidas.length}` + (conSinRegistro.length ? `  (${conSinRegistro.length} con alguna posición sin registro)` : ''));
  escribir(`      quedan como están, el historial no cierra: ${plan.descartadas.length}`);
  escribir(`      quedan como están, la unidad no tenía ninguna cubierta cargada: ${plan.sinCubiertas.length}`
    + (plan.sinCubiertas.length ? `  (OTs ${plan.sinCubiertas.map(s => `${s.ot_id} · ${s.unidad}`).join(', ')})` : ''));
  const fechas = plan.soloConFecha.map(o => o.fecha).sort();
  escribir(`  solo con la fecha (${fechas.length ? `${fmtFecha(fechas[0])} a ${fmtFecha(fechas[fechas.length - 1])}` : '-'}): ${plan.soloConFecha.length}  → quedan como están`);
  if (sinUnidad) escribir(`  sin unidad: ${sinUnidad}  → no hay esquema que dibujar`);

  // ── Controles ──
  escribir('\nControles:');
  escribir(`  cubiertas que esas OTs anotaron y el historial pone en su lugar: ${filasControladas - filasDistintas} de ${filasControladas}`);

  // La hora de cierre y los eventos que escribió ese mismo cierre tienen que coincidir.
  const primerEvento = new Map();
  for (const e of datos.eventos) {
    if (e.origen !== 'sistema' || !e.ot_id) continue;
    if (!primerEvento.has(e.ot_id) || +e.creado_en < primerEvento.get(e.ot_id)) primerEvento.set(e.ot_id, +e.creado_en);
  }
  const desfasajes = datos.ots.filter(o => o.cerrado_en && primerEvento.has(o.id))
    .map(o => Math.abs(primerEvento.get(o.id) - +o.cerrado_en) / 1000);
  escribir(`  hora de cierre vs. eventos del mismo cierre (${desfasajes.length} OTs): diferencia máxima ${desfasajes.length ? Math.max(...desfasajes).toFixed(1) : '-'} s`);
  escribir(`  colocaciones a mano (auditoría) que no se pudieron interpretar: ${plan.noInterpretadas.length}`);

  // Informativo: la "sale" que va a mostrar la OT (lo que el historial dice que salió
  // al cerrarla) contra la anterior que la OT anotó cuando se cargó.
  const filasDe = new Map();
  for (const f of datos.filas) {
    if (!filasDe.has(f.ot_id)) filasDe.set(f.ot_id, []);
    filasDe.get(f.ot_id).push(f);
  }
  const saleDistinta = [];
  for (const r of plan.reconstruidas) {
    for (const f of filasDe.get(r.ot_id) || []) {
      const sale = r.esquema.antes[f.posicion];
      const saleId = sale && sale.id !== f.cubierta_id ? sale.id : null;
      if (f.cubierta_anterior_id && saleId !== f.cubierta_anterior_id) {
        saleDistinta.push(`OT ${r.ot_id} ${f.posicion}: anotada ${datos.fuegos.get(f.cubierta_anterior_id) || f.cubierta_anterior_id}, `
          + `según el historial ${saleId ? datos.fuegos.get(saleId) || saleId : 'no salió ninguna'}`);
      }
    }
  }
  escribir(`  "sale" distinta de la anterior anotada al cargar la OT: ${saleDistinta.length}`);
  saleDistinta.forEach(s => escribir('      ' + s));

  // ── Detalle ──
  if (plan.descartadas.length) {
    escribir('\nQuedan como están (el historial no alcanza):');
    plan.descartadas.forEach(d => escribir(`  OT ${d.ot_id} · ${d.unidad} · ${fmtFechaHora(new Date(d.cerrada))}: ${d.motivo}`));
  }
  if (conSinRegistro.length) {
    escribir('\nPosiciones que quedan "sin registro" dentro de un esquema reconstruido:');
    conSinRegistro.forEach(r => escribir(`  OT ${r.ot_id} · ${r.unidad}: ${r.esquema.sin_registro.join(', ')}`));
  }

  escribir(`\nSe reconstruyen (${plan.reconstruidas.length}). Cómo quedó cada posición; entre paréntesis, lo que salió en esa OT:`);
  for (const r of plan.reconstruidas) {
    const que = r.filas ? `${r.filas} cubierta(s) en la OT` : 'sin cubiertas en la OT';
    escribir(`  OT ${r.ot_id} · ${r.unidad} · ${fmtFechaHora(new Date(r.cerrada))} · ${que}` + (r.movidas ? ` · ${r.movidas} posición(es) cambiaron después` : ''));
    escribir(`      ${lineaDeEsquema(r.esquema)}`);
  }

  escribir(`\nHuella del plan: ${huella}`);
}

// ─── Escritura ────────────────────────────────────────────────────────────────

async function aplicar(plan) {
  const lote = plan.reconstruidas.map(r => ({ id: r.ot_id, esquema: r.esquema }));
  const ids = lote.map(x => x.id);
  const [hechas] = await sql.transaction([
    // Solo donde sigue faltando: un esquema guardado por un cierre nunca se pisa.
    sql`
      UPDATE ots o SET esquema_cierre = r.esquema
      FROM jsonb_to_recordset(${JSON.stringify(lote)}::jsonb) AS r(id int, esquema jsonb)
      WHERE o.id = r.id AND o.estado = 1 AND NOT o.anulada AND o.esquema_cierre IS NULL
      RETURNING o.id`,
    sql`
      INSERT INTO auditoria (usuario, accion, entidad, descripcion, cambios)
      VALUES (${USUARIO_LOG}, 'reconstruir', 'ot',
        ${`Esquema al cerrar reconstruido desde el historial en ${lote.length} OTs cerradas antes de que se guardara`},
        ${JSON.stringify([{ campo: 'esquema al cerrar', antes: 'sin guardar', despues: 'reconstruido en las OTs ' + ids.join(', ') }])}::jsonb)`,
  ]);
  return hechas.length;
}

// ─── Principal ────────────────────────────────────────────────────────────────

async function main() {
  escribir(APLICAR ? 'Modo: APLICAR (si la huella coincide)' : 'Modo: SIMULACIÓN (no escribe nada)');
  const datos = await leer();
  const plan = planificarReconstruccion(datos);
  const huella = huellaDe(plan);
  mostrar(plan, datos, huella);

  if (!plan.reconstruidas.length) {
    escribir('\nNada que reconstruir.');
    return 0;
  }
  if (!APLICAR) {
    escribir('\nSIMULACIÓN: no se escribió nada.');
    escribir(`Para aplicar exactamente este plan:  node db/reconstruir_esquemas_2026_10.js --aplicar --huella ${huella}`);
    return 0;
  }
  if (HUELLA !== huella) {
    escribir(HUELLA
      ? `\nNO SE APLICÓ NADA: la huella pedida (${HUELLA}) no es la del plan de hoy (${huella}). La base cambió desde la simulación.`
      : '\nNO SE APLICÓ NADA: falta --huella. Revisá el plan de arriba y pasá su huella.');
    escribir(`Si el plan de arriba es el que querés:  node db/reconstruir_esquemas_2026_10.js --aplicar --huella ${huella}`);
    return 1;
  }

  const n = await aplicar(plan);
  const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM ots WHERE esquema_cierre->>'reconstruido' = 'true'`;
  escribir(`\nAPLICADO: ${n} de ${plan.reconstruidas.length} OTs con el esquema reconstruido (en la base hay ${total} marcadas así).`);
  if (n !== plan.reconstruidas.length) {
    escribir('Algunas OTs ya tenían esquema cuando se aplicó: quedaron con el que tenían.');
  }
  return 0;
}

main().then(
  (codigo) => process.exit(codigo),
  (e) => {
    console.error('\nError: ' + e.message);
    console.error('Las escrituras van en una sola transacción: si el error fue al aplicar, no quedó nada a medias.');
    process.exit(2);
  });
