// Cubiertas de una OT: qué se guarda al cargarla y qué se mueve al cerrarla.
//
// Dos reglas viven acá, porque no cumplirlas fue lo que dejó unidades con dos
// cubiertas en la misma posición:
//
//  1. La OT guarda una sola cubierta por posición: exactamente lo que se ve en
//     pantalla. Guardar reemplaza el juego entero, no lo mezcla con el anterior.
//  2. Al cerrar, lo que sale de la unidad se decide mirando qué hay montado en
//     ese momento, no la "anterior" que se anotó cuando se cargó la OT: entre
//     una cosa y la otra pueden pasar días, y otras OTs.

const { sql } = require('../db');
const { consultaEvento } = require('./cubiertaHistorial');

const NOMBRE_POSICION = {
  ddi: 'Del. Izq.', ddd: 'Del. Der.',
  tie: 'Tras. Izq. Ext.', tii: 'Tras. Izq. Int.',
  tdi: 'Tras. Der. Int.', tde: 'Tras. Der. Ext.',
  cie: 'Cen. Izq. Ext.', cii: 'Cen. Izq. Int.',
  cdi: 'Cen. Der. Int.', cde: 'Cen. Der. Ext.',
  ra: 'Auxilio', ra2: 'Auxilio 2',
};
const POSICIONES = Object.keys(NOMBRE_POSICION);

const nombrePosicion = (p) => NOMBRE_POSICION[p] || p;

// Posiciones que una OT puede dejar sin cubierta: sale la que haya y no entra
// otra. Solo los auxilios; una rueda de rodado no se vacía por un clic de más.
const POSICIONES_VACIABLES = ['ra', 'ra2'];

// Almacén al que van las cubiertas que salen de una unidad sin que nadie haya
// elegido destino. No es un depósito real: es la lista de "hay que ir a ver
// dónde quedó", para que gomería las ubique después con Mover.
const ALMACEN_A_VERIFICAR = 'A VERIFICAR';

/**
 * Error por lo que se pidió, no por una falla del servidor: el handler global
 * devuelve el mensaje con ese status en vez del 500 genérico.
 */
function errorDeUsuario(mensaje) {
  return Object.assign(new Error(mensaje), { status: 400 });
}

/**
 * `cambios_ot_json` del formulario → { posicion: cubierta_id }.
 *
 * Devuelve null si el campo no vino: quien llama no toca las cubiertas de la OT.
 * Un objeto vacío, en cambio, es una OT sin cubiertas. Lanza un 400 si lo que
 * vino no se puede guardar, en vez de ignorarlo en silencio.
 */
function normalizarCambios(json) {
  if (json === undefined || json === null || json === '') return null;

  let crudo;
  try { crudo = typeof json === 'string' ? JSON.parse(json) : json; }
  catch (_) { throw errorDeUsuario('Las cubiertas de la OT llegaron en un formato inválido'); }
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) {
    throw errorDeUsuario('Las cubiertas de la OT llegaron en un formato inválido');
  }

  const cambios = {};
  const posicionDe = new Map();   // cubierta_id → posición donde ya apareció
  for (const [posicion, valor] of Object.entries(crudo)) {
    const id = parseInt(valor) || 0;
    if (!id) continue;            // posición sin cubierta
    if (!POSICIONES.includes(posicion)) throw errorDeUsuario(`Posición desconocida: ${posicion}`);
    if (posicionDe.has(id)) {
      throw errorDeUsuario(
        `La misma cubierta está asignada en ${nombrePosicion(posicionDe.get(id))} y en ${nombrePosicion(posicion)}`);
    }
    posicionDe.set(id, posicion);
    cambios[posicion] = id;
  }
  return cambios;
}

/**
 * `vaciar_ot_json` del formulario → lista de posiciones que la OT deja vacías.
 *
 * Devuelve null si el campo no vino: quien llama no toca lo que la OT tenga
 * guardado. Lanza un 400 si piden vaciar una posición que no se puede, o una a
 * la que en el mismo guardado le están asignando una cubierta.
 *
 * @param {object|null} cambios  lo que devolvió normalizarCambios, para detectar el choque
 */
function normalizarVaciar(json, cambios) {
  if (json === undefined || json === null || json === '') return null;

  let crudo;
  try { crudo = typeof json === 'string' ? JSON.parse(json) : json; }
  catch (_) { throw errorDeUsuario('Las posiciones a vaciar llegaron en un formato inválido'); }
  if (!Array.isArray(crudo)) throw errorDeUsuario('Las posiciones a vaciar llegaron en un formato inválido');

  const vaciar = [...new Set(crudo.map(String))];
  for (const posicion of vaciar) {
    if (!POSICIONES_VACIABLES.includes(posicion)) {
      throw errorDeUsuario(`${nombrePosicion(posicion)} no se puede dejar vacía desde una OT: solo los auxilios`);
    }
    if (cambios && cambios[posicion]) {
      throw errorDeUsuario(`${nombrePosicion(posicion)} figura a la vez para dejar vacía y con una cubierta asignada`);
    }
  }
  return vaciar;
}

/**
 * Revisa que las cubiertas elegidas se puedan cargar en una OT de esa unidad y
 * arma las filas a guardar. No escribe nada, así quien llama puede validar
 * antes de tocar la OT.
 *
 * Una cubierta sirve si está activa y está libre o montada en esa misma unidad
 * (rotación). Una montada en otra unidad no: cerrar la OT se la llevaría sin
 * que nadie la haya retirado de allá.
 */
async function validarCubiertasDeOt({ unidadId, cambios }) {
  const pares = Object.entries(cambios || {});
  if (!pares.length) return [];
  if (!unidadId) throw errorDeUsuario('Elegí la unidad antes de asignar cubiertas');

  const ids = pares.map(([, id]) => id);
  const posiciones = pares.map(([posicion]) => posicion);
  const [cubiertas, ocupantes] = await Promise.all([
    sql`
      SELECT c.id, c.fuego, c.activo, c.micro_id, m.unidad
      FROM cubiertas c
      LEFT JOIN micro m ON m.id = c.micro_id
      WHERE c.id = ANY(${ids})`,
    sql`
      SELECT id, posicion FROM cubiertas
      WHERE micro_id = ${unidadId} AND activo = 1 AND posicion = ANY(${posiciones})`,
  ]);
  const porId = new Map(cubiertas.map(c => [c.id, c]));

  return pares.map(([posicion, id]) => {
    const c = porId.get(id);
    if (!c || c.activo != 1) {
      throw errorDeUsuario(`La cubierta ${c ? c.fuego || '#' + id : '#' + id} no existe o está dada de baja`);
    }
    if (c.micro_id && c.micro_id !== unidadId) {
      throw errorDeUsuario(
        `La cubierta ${c.fuego || '#' + id} figura montada en la unidad ${c.unidad || c.micro_id}. `
        + 'Quitala de la OT o elegí otra.');
    }
    // Foto de lo que hay hoy en esa posición. Es informativa (la muestra la OT
    // y el aviso de pinchadura): al cerrar se vuelve a mirar la unidad.
    const ocupante = ocupantes.find(o => o.posicion === posicion && o.id !== id);
    return { posicion, cubierta_id: id, anterior_id: ocupante ? ocupante.id : null };
  });
}

/**
 * Deja en la OT exactamente las filas recibidas (las de `validarCubiertasDeOt`).
 *
 * Borra y vuelve a insertar dentro de una transacción. Antes se hacía un upsert
 * por (ot, cubierta): al elegir otra cubierta para una posición ya cargada, la
 * fila de la primera seguía viva y el cierre montaba las dos en el mismo lugar.
 */
async function guardarCubiertasDeOt({ otId, filas }) {
  await sql.transaction([
    sql`DELETE FROM ot_cubiertas WHERE ot_id = ${otId} AND posicion IS NOT NULL`,
    ...filas.map(f => sql`
      INSERT INTO ot_cubiertas (ot_id, cubierta_id, posicion, cubierta_anterior_id)
      VALUES (${otId}, ${f.cubierta_id}, ${f.posicion}, ${f.anterior_id})
      ON CONFLICT (ot_id, cubierta_id) DO UPDATE
        SET posicion = EXCLUDED.posicion, cubierta_anterior_id = EXCLUDED.cubierta_anterior_id`),
  ]);
}

/**
 * Id del almacén "A VERIFICAR". Si no existe lo crea, y si estaba dado de baja
 * lo reactiva: una cubierta en un almacén inactivo no aparece en ninguna lista.
 */
async function almacenAVerificar() {
  const existentes = await sql`
    SELECT id, activo FROM almacen
    WHERE upper(trim(nombre)) = ${ALMACEN_A_VERIFICAR}
    ORDER BY id LIMIT 1`;
  if (existentes.length) {
    if (existentes[0].activo != 1) await sql`UPDATE almacen SET activo = 1 WHERE id = ${existentes[0].id}`;
    return existentes[0].id;
  }
  const creados = await sql`INSERT INTO almacen (nombre) VALUES (${ALMACEN_A_VERIFICAR}) RETURNING id`;
  if (!creados.length) throw new Error('No se pudo crear el almacén ' + ALMACEN_A_VERIFICAR);
  return creados[0].id;
}

/** Lo que `planificarCierre` necesita saber de la base, leído en el momento. */
async function leerEstadoParaCierre(ot) {
  const [filas, montadas] = await Promise.all([
    sql`
      SELECT oc.cubierta_id, oc.posicion, c.fuego, c.activo,
             c.micro_id, c.posicion AS posicion_actual, m.unidad
      FROM ot_cubiertas oc
      JOIN cubiertas c ON c.id = oc.cubierta_id
      LEFT JOIN micro m ON m.id = c.micro_id
      WHERE oc.ot_id = ${ot.id} AND oc.posicion IS NOT NULL
      ORDER BY oc.posicion`,
    ot.unidad_id
      ? sql`
          SELECT id, fuego, posicion FROM cubiertas
          WHERE micro_id = ${ot.unidad_id} AND activo = 1 AND posicion IS NOT NULL`
      : Promise.resolve([]),
  ]);
  return { filas, montadas };
}

const etiqueta = (f) => f.fuego || '#' + (f.cubierta_id || f.id);

// posición → { id, fuego }. Si una posición tiene más de una cubierta (dato
// heredado del problema de duplicados) no se elige una: quedan los fuegos de todas.
function esquemaDe(cubiertas) {
  const mapa = {};
  for (const c of cubiertas) {
    const ya = mapa[c.posicion];
    mapa[c.posicion] = ya
      ? { id: ya.id, fuego: `${ya.fuego || '-'} / ${c.fuego || '-'}` }
      : { id: c.id, fuego: c.fuego };
  }
  return mapa;
}

/**
 * Decide qué se mueve al cerrar una OT. Función pura: no toca la base, así que
 * se prueba con datos armados a mano.
 *
 * @param {object}   p.ot        { id, unidad_id, fecha }
 * @param {object[]} p.filas     cubiertas de la OT y dónde está cada una hoy:
 *                               { cubierta_id, posicion, fuego, activo, micro_id, posicion_actual, unidad }
 * @param {object[]} p.montadas  cubiertas activas montadas hoy en la unidad: { id, fuego, posicion }
 * @param {string[]} p.vaciar    posiciones que la OT deja vacías: sale lo que haya y no entra nada
 * @param {number}   p.km        km de la unidad al cierre (queda en los eventos)
 * @param {boolean}  p.arreglo   la OT tuvo arreglo: se le anota a cada cubierta desplazada
 * @param {boolean}  p.destinoEsCeamse  las salientes se dan de baja en vez de ir a un almacén
 *
 * @returns {{ errores: string[], entrantes: object[], salientes: object[], rotadas: object[],
 *             anteriores: {cubierta_id: number, anterior_id: number|null}[], eventos: object[],
 *             esquema: { antes: object, despues: object } }}
 *   Con `errores` no vacío la OT no se puede cerrar y el resto no debe aplicarse.
 */
function planificarCierre({ ot, filas = [], montadas = [], vaciar = [], km = null, arreglo = false, destinoEsCeamse = false }) {
  const unidadId = ot.unidad_id || null;
  const errores = [];

  if (filas.length && !unidadId) errores.push('La OT tiene cubiertas cargadas pero no tiene unidad');

  const porPosicion = new Map();
  for (const f of filas) {
    if (!porPosicion.has(f.posicion)) porPosicion.set(f.posicion, []);
    porPosicion.get(f.posicion).push(f);
  }
  for (const [posicion, lista] of porPosicion) {
    if (lista.length > 1) {
      errores.push(`${nombrePosicion(posicion)} tiene ${lista.length} cubiertas cargadas en la OT `
        + `(${lista.map(etiqueta).join(', ')}): tiene que quedar una sola`);
    }
  }
  for (const posicion of vaciar) {
    if (porPosicion.has(posicion)) {
      errores.push(`${nombrePosicion(posicion)} figura a la vez para dejar vacía y con una cubierta que entra `
        + `(${porPosicion.get(posicion).map(etiqueta).join(', ')})`);
    }
  }
  for (const f of filas) {
    if (f.activo != 1) {
      errores.push(`La cubierta ${etiqueta(f)} está dada de baja`);
    } else if (unidadId && f.micro_id && f.micro_id !== unidadId) {
      errores.push(`La cubierta ${etiqueta(f)} figura montada en la unidad ${f.unidad || f.micro_id}: `
        + 'hay que retirarla de ahí o quitarla de esta OT');
    }
  }

  const idsEntrantes = new Set(filas.map(f => f.cubierta_id));
  // Las posiciones que la OT toca: donde entra una cubierta y las que deja vacías.
  const posicionesOt = new Set([...filas.map(f => f.posicion), ...vaciar]);

  // Sale todo lo que hoy ocupa una posición de la OT y no es una de las
  // entrantes. Si la posición tenía más de una cubierta (dato heredado del
  // problema de duplicados), salen todas. En una posición a vaciar no entra
  // nada, así que lo que haya ahí simplemente sale.
  const salientes = montadas.filter(m => posicionesOt.has(m.posicion) && !idsEntrantes.has(m.id));

  // Una entrante que ya está en su posición no se mueve ni deja evento.
  const entrantes = filas.filter(f => !(f.micro_id === unidadId && f.posicion_actual === f.posicion));
  // Las que hoy están en otra posición de esta misma unidad: rotan.
  const rotadas = entrantes.filter(f => f.micro_id === unidadId && f.posicion_actual);

  // La cubierta que cada entrante encuentra en su lugar: la que sale, o la que
  // rota hacia otra posición. Reemplaza en la OT a la foto tomada al cargarla.
  const anteriores = filas.map(f => {
    const ocupante = montadas.find(m => m.posicion === f.posicion && m.id !== f.cubierta_id);
    return { cubierta_id: f.cubierta_id, anterior_id: ocupante ? ocupante.id : null };
  });

  // Cómo está armada la unidad antes y después de esta OT. La OT lo guarda al
  // cerrarse: así se muestra siempre igual, y no según lo que la unidad tenga
  // montado el día que alguien la abra.
  const idsSalientes = new Set(salientes.map(s => s.id));
  const esquema = {
    antes: esquemaDe(montadas),
    despues: esquemaDe([
      ...montadas.filter(m => !idsSalientes.has(m.id) && !idsEntrantes.has(m.id)),
      ...filas.map(f => ({ id: f.cubierta_id, fuego: f.fuego, posicion: f.posicion })),
    ]),
  };

  const comun = { fecha: ot.fecha || null, micro_id: unidadId, km_unidad: km, ot_id: ot.id };
  const reparacion = (cubierta_id, posicion) => ({
    ...comun, cubierta_id, tipo: 'reparacion', posicion, detalle: 'Arreglo registrado en la OT N° ' + ot.id,
  });

  // Primero los retiros y después las colocaciones: en una rotación la misma
  // cubierta sale de una posición y entra en otra dentro de la misma OT, y el
  // orden de los eventos es lo que define dónde se corta cada tramo de km.
  const eventos = [];
  for (const s of salientes) {
    eventos.push({
      ...comun, cubierta_id: s.id, tipo: 'retiro', posicion: s.posicion,
      detalle: destinoEsCeamse ? 'Sale de la unidad — baja por CEAMSE' : 'Sale de la unidad al almacén',
    });
    if (arreglo) eventos.push(reparacion(s.id, s.posicion));
    if (destinoEsCeamse) {
      eventos.push({ ...comun, cubierta_id: s.id, tipo: 'baja', posicion: s.posicion, detalle: 'Baja por CEAMSE' });
    }
  }
  for (const r of rotadas) {
    eventos.push({
      ...comun, cubierta_id: r.cubierta_id, tipo: 'retiro', posicion: r.posicion_actual,
      detalle: 'Cambia de posición dentro de la unidad (rotación)',
    });
    // El arreglo se le anota a la cubierta desplazada: a la que rota, solo si
    // otra entra en el lugar que deja (no si ese lugar queda vacío).
    if (arreglo && porPosicion.has(r.posicion_actual)) eventos.push(reparacion(r.cubierta_id, r.posicion_actual));
  }
  for (const e of entrantes) {
    eventos.push({
      ...comun, cubierta_id: e.cubierta_id, tipo: 'colocacion', posicion: e.posicion,
      detalle: 'Entra por OT N° ' + ot.id,
    });
  }

  return { errores, entrantes, salientes, rotadas, anteriores, eventos, esquema };
}

/**
 * Lo que una OT cerrada tiene para mostrar de la unidad, sin mirar la unidad de hoy.
 *
 * Con `esquema_cierre` (las OTs cerradas desde que existe esa columna) es la
 * unidad completa, antes y después. Sin él solo se sabe lo que la OT cambió: qué
 * entró en cada posición y, si quedó anotada, qué cubierta había. Del resto de
 * la unidad no hay registro, y no se inventa.
 *
 * @param {object}   ot     la fila de `ots`
 * @param {object[]} filas  cubiertas de la OT: { id, fuego, posicion, cubierta_anterior_id, fuego_anterior }
 * @returns {{ completo: boolean, antes: object, despues: object }}  posición → { id, fuego }
 */
function esquemaDeOtCerrada(ot, filas = []) {
  let guardado = ot.esquema_cierre;
  if (typeof guardado === 'string') {
    try { guardado = JSON.parse(guardado); } catch (_) { guardado = null; }
  }
  if (guardado && guardado.antes && guardado.despues) {
    return { completo: true, antes: guardado.antes, despues: guardado.despues };
  }

  const antes = {};
  const despues = {};
  for (const f of filas) {
    if (!f.posicion) continue;
    despues[f.posicion] = { id: f.id, fuego: f.fuego };
    if (f.fuego_anterior) antes[f.posicion] = { id: f.cubierta_anterior_id || null, fuego: f.fuego_anterior };
  }
  return { completo: false, antes, despues };
}

/**
 * Las consultas que aplican un plan de cierre, en el orden en que tienen que
 * correr. No las ejecuta: van dentro de la transacción del cierre junto con el
 * UPDATE de la OT, para que no pueda quedar una OT cerrada con las cubiertas a
 * medio mover.
 */
function consultasDeCierre(plan, { ot, destinoEsCeamse, destinoAlmacenId }) {
  const unidadId = ot.unidad_id;
  const consultas = [];

  const idsSalientes = plan.salientes.map(s => s.id);
  if (idsSalientes.length) {
    consultas.push(destinoEsCeamse
      ? sql`
          UPDATE cubiertas SET micro_id = NULL, posicion = NULL, almacen_id = NULL, activo = 0
          WHERE id = ANY(${idsSalientes}) AND micro_id = ${unidadId}`
      : sql`
          UPDATE cubiertas SET micro_id = NULL, posicion = NULL, almacen_id = ${destinoAlmacenId}
          WHERE id = ANY(${idsSalientes}) AND micro_id = ${unidadId}`);
  }

  // Las que rotan sueltan primero su posición: así un intercambio A↔B no pasa
  // por un instante con dos cubiertas en el mismo lugar.
  const idsRotadas = plan.rotadas.map(r => r.cubierta_id);
  if (idsRotadas.length) {
    consultas.push(sql`
      UPDATE cubiertas SET posicion = NULL
      WHERE id = ANY(${idsRotadas}) AND micro_id = ${unidadId}`);
  }

  for (const e of plan.entrantes) {
    consultas.push(sql`
      UPDATE cubiertas SET micro_id = ${unidadId}, posicion = ${e.posicion}, almacen_id = NULL, gomeria_id = NULL
      WHERE id = ${e.cubierta_id}`);
  }

  for (const a of plan.anteriores) {
    consultas.push(sql`
      UPDATE ot_cubiertas SET cubierta_anterior_id = ${a.anterior_id}
      WHERE ot_id = ${ot.id} AND cubierta_id = ${a.cubierta_id}`);
  }

  for (const ev of plan.eventos) {
    const consulta = consultaEvento(ev);
    if (consulta) consultas.push(consulta);
  }

  return consultas;
}

module.exports = {
  POSICIONES, POSICIONES_VACIABLES, nombrePosicion, ALMACEN_A_VERIFICAR, almacenAVerificar,
  normalizarCambios, normalizarVaciar, validarCubiertasDeOt, guardarCubiertasDeOt,
  leerEstadoParaCierre, planificarCierre, consultasDeCierre, esquemaDeOtCerrada,
};
