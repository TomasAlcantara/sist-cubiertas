// Esquema de la unidad al cerrar una OT vieja, reconstruido desde el historial.
//
// Desde el 13/10/2026 cada OT guarda al cerrarse cómo quedó armada la unidad
// (ots.esquema_cierre). Las cerradas antes no lo tienen, y la pantalla solo puede
// mostrar lo que cada una cambió: un preventivo se ve con todas las posiciones
// "sin registro". Acá se reconstruye hacia atrás desde la unidad de hoy: en cada
// posición, el primer movimiento posterior al cierre dice qué había ahí (lo que
// sale); si después no hubo ninguno, lo que hay hoy.
//
// Movimientos que cuentan:
//  - cubierta_eventos (colocacion / retiro): cierres de OT y "mover a almacén".
//  - la auditoría de "colocar": la pantalla de unidades coloca una cubierta sin
//    dejar evento. La auditoría dice dónde entró y a cuál desplazó; de dónde salió
//    la que entra se deduce de su movimiento anterior.
// No cuentan los retiros de la corrección del 13/10 (origen 'correccion'): sacaron
// de la base un duplicado, no una cubierta de la unidad.
//
// Solo OTs con hora de cierre: cerrado_en (desde el 27/08), la auditoría del
// cierre (desde el 25/08) o los eventos que dejó el cierre (desde el 20/08). De las
// anteriores solo se sabe el día, y con dos movimientos el mismo día no se sabe
// cuál fue primero.
//
// Cada OT se contrasta con lo que ella misma anotó: cada cubierta que puso tiene
// que aparecer en su posición. Si no aparece, el historial de esa unidad está
// incompleto y la OT queda como estaba.
//
// Es la parte que decide, separada de la que escribe (db/reconstruir_esquemas_2026_10.js)
// para poder probarla con datos armados a mano. No toca la base.

const crypto = require('crypto');

// A la misma hora (un mismo cierre) van primero los retiros: así los escribe el
// cierre de una OT, y así una rotación no pasa por dos cubiertas en un lugar.
const cronologico = (a, b) => a.t - b.t
  || (a.tipo === b.tipo ? a.orden - b.orden : (a.tipo === 'retiro' ? -1 : 1));

const agrupar = (lista, clave) => {
  const mapa = new Map();
  for (const x of lista) {
    const k = clave(x);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(x);
  }
  return mapa;
};

/**
 * Hora de cierre de cada OT (ms), o null si de esa OT solo se sabe el día.
 *
 * @param {object[]} p.ots               { id, cerrado_en }
 * @param {object[]} p.eventos           { ot_id, origen, creado_en }
 * @param {object[]} p.cierresAuditados  { ot_id, fecha }: la entrada "cerrar" de la auditoría
 * @returns {Map<number, number|null>}
 */
function horasDeCierre({ ots, eventos = [], cierresAuditados = [] }) {
  // El cierre escribía sus eventos enseguida después de cerrar la OT.
  const primerEvento = new Map();
  for (const e of eventos) {
    if (!e.ot_id || e.origen !== 'sistema') continue;
    const t = +e.creado_en;
    if (!primerEvento.has(e.ot_id) || t < primerEvento.get(e.ot_id)) primerEvento.set(e.ot_id, t);
  }
  const auditado = new Map(cierresAuditados.map(c => [c.ot_id, +c.fecha]));
  const horas = new Map();
  for (const o of ots) {
    if (o.cerrado_en) horas.set(o.id, +o.cerrado_en);
    else if (auditado.has(o.id)) horas.set(o.id, auditado.get(o.id));
    else if (primerEvento.has(o.id)) horas.set(o.id, primerEvento.get(o.id));
    else horas.set(o.id, null);
  }
  return horas;
}

/**
 * Todos los movimientos de cubiertas: unidad → posición → lista en orden cronológico.
 * Cada uno: { t, tipo: 'colocacion'|'retiro', cubierta_id, ot_id, orden, anterior?, aMano? }.
 *
 * @param {object[]} p.eventos  cubierta_eventos de tipo colocacion/retiro:
 *        { id, cubierta_id, tipo, micro_id, posicion, ot_id, origen, fecha, creado_en }
 * @param {object[]} p.colocacionesAuditadas  auditoría "colocar": { fecha, cubierta_id, cambios }
 * @param {Map} p.horas  de horasDeCierre
 * @param {Map} p.anteriorDe  'ot_id:posicion' → la cubierta que esa OT anotó como anterior
 * @param {Map} p.microPorNombre  nombre de la unidad → micro_id
 * @returns {{ porUnidad: Map, noInterpretadas: object[] }}
 */
function movimientosPorPosicion({ eventos = [], colocacionesAuditadas = [], horas, anteriorDe = new Map(), microPorNombre = new Map() }) {
  const porUnidad = new Map();
  const porCubierta = new Map();
  const agregar = (micro_id, posicion, m) => {
    if (!porUnidad.has(micro_id)) porUnidad.set(micro_id, new Map());
    const posiciones = porUnidad.get(micro_id);
    if (!posiciones.has(posicion)) posiciones.set(posicion, []);
    posiciones.get(posicion).push(m);
    if (!porCubierta.has(m.cubierta_id)) porCubierta.set(m.cubierta_id, []);
    porCubierta.get(m.cubierta_id).push({ ...m, micro_id, posicion });
  };

  for (const e of eventos) {
    if (e.origen === 'correccion' || !e.micro_id || !e.posicion) continue;
    let t;
    if (e.origen === 'backfill') {
      // El backfill del 19/08 escribió todo junto: cada evento vale por la OT que
      // lo originó o por su fecha. Los "anteriores al historial" (sin fecha), primero.
      const h = e.ot_id ? horas.get(e.ot_id) : null;
      if (h != null) t = h;
      else t = e.fecha ? Date.parse(String(e.fecha).slice(0, 10) + 'T23:59:59Z') : -Infinity;
    } else {
      t = +e.creado_en;
    }
    const m = { t, tipo: e.tipo, cubierta_id: e.cubierta_id, ot_id: e.ot_id || null, orden: e.id };
    if (e.tipo === 'colocacion' && e.ot_id) {
      const anterior = anteriorDe.get(e.ot_id + ':' + e.posicion);
      if (anterior && anterior !== e.cubierta_id) m.anterior = anterior;
    }
    agregar(e.micro_id, e.posicion, m);
  }

  // En orden, para que cada colocación a mano vea las anteriores.
  const noInterpretadas = [];
  const auditadas = [...colocacionesAuditadas].sort((a, b) => +a.fecha - +b.fecha);
  for (const a of auditadas) {
    const campos = {};
    for (const c of a.cambios || []) campos[c.campo] = c.despues;
    const micro_id = microPorNombre.get(String(campos['unidad']));
    const posicion = campos['posición'];
    if (!micro_id || !posicion || !a.cubierta_id) {
      noInterpretadas.push(a);
      continue;
    }
    const t = +a.fecha;
    // De dónde sale la que entra: de su última posición, si estaba montada.
    const previos = (porCubierta.get(a.cubierta_id) || []).filter(m => m.t < t).sort(cronologico);
    const ultimo = previos[previos.length - 1];
    if (ultimo && ultimo.tipo === 'colocacion') {
      agregar(ultimo.micro_id, ultimo.posicion, { t, tipo: 'retiro', cubierta_id: a.cubierta_id, ot_id: null, orden: 0 });
    }
    const desplazada = parseInt(String(campos['desplaza a'] || '').replace(/\D+/g, '')) || null;
    if (desplazada) agregar(micro_id, posicion, { t, tipo: 'retiro', cubierta_id: desplazada, ot_id: null, orden: 0 });
    agregar(micro_id, posicion, { t, tipo: 'colocacion', cubierta_id: a.cubierta_id, ot_id: null, orden: 1, aMano: true });
  }

  for (const posiciones of porUnidad.values()) {
    for (const lista of posiciones.values()) lista.sort(cronologico);
  }
  return { porUnidad, noInterpretadas };
}

/**
 * Cómo quedó la unidad al cerrar una OT, y cómo estaba antes.
 *
 * @param {object} p.ot       { id, unidad_id }
 * @param {number} p.t        hora de cierre (ms)
 * @param {Map}    p.movimientos  posición → movimientos de esa unidad (de movimientosPorPosicion)
 * @param {Map}    p.hoy      posición → cubierta montada hoy en esa unidad
 * @param {object[]} p.filas  las de la OT: { posicion, cubierta_id, cubierta_anterior_id }
 * @returns {{ antes: object, despues: object, sinRegistro: string[], movidas: number, distintas: object[] }}
 *   antes/despues: posición → id de cubierta. `distintas`: filas de la OT que el
 *   historial no reproduce (si hay alguna, la reconstrucción no sirve).
 */
function reconstruirOt({ ot, t, movimientos = new Map(), hoy = new Map(), filas = [] }) {
  const posiciones = new Set([...hoy.keys(), ...movimientos.keys(), ...filas.map(f => f.posicion)]);
  const despues = {};
  const sinRegistro = [];
  let movidas = 0;
  for (const p of posiciones) {
    const posteriores = (movimientos.get(p) || []).filter(m => m.t > t && m.ot_id !== ot.id);
    if (!posteriores.length) {
      if (hoy.has(p)) despues[p] = hoy.get(p);
      continue;
    }
    movidas++;
    const primero = posteriores[0];
    if (primero.tipo === 'retiro') despues[p] = primero.cubierta_id;
    // Entró una cubierta sin que saliera otra: lo que había lo sabe la OT que la
    // puso, si lo anotó. Colocada a mano sin desplazar a nadie: estaba vacía.
    else if (primero.anterior) despues[p] = primero.anterior;
    else if (!primero.aMano) sinRegistro.push(p);
  }

  // Lo que la OT puso tiene que estar donde lo puso.
  const distintas = [];
  for (const f of filas) {
    const i = sinRegistro.indexOf(f.posicion);
    if (i >= 0) {
      sinRegistro.splice(i, 1);
      despues[f.posicion] = f.cubierta_id;
    } else if (despues[f.posicion] !== f.cubierta_id) {
      distintas.push({ posicion: f.posicion, puso: f.cubierta_id, historial: despues[f.posicion] || null });
    }
  }

  // Antes: se deshace lo que hizo la propia OT, de atrás para adelante.
  const antes = { ...despues };
  const propios = [];
  for (const [p, lista] of movimientos) {
    for (const m of lista) if (m.ot_id === ot.id) propios.push({ ...m, posicion: p });
  }
  propios.sort(cronologico).reverse();
  for (const m of propios) {
    if (m.tipo === 'retiro') antes[m.posicion] = m.cubierta_id;
    else if (antes[m.posicion] === m.cubierta_id) delete antes[m.posicion];
  }
  // Una fila sin retiro propio en su posición: la que la OT anotó como anterior.
  for (const f of filas) {
    const conRetiro = propios.some(m => m.tipo === 'retiro' && m.posicion === f.posicion);
    if (!conRetiro && antes[f.posicion] == null && f.cubierta_anterior_id && f.cubierta_anterior_id !== f.cubierta_id) {
      antes[f.posicion] = f.cubierta_anterior_id;
    }
  }

  return { antes, despues, sinRegistro: sinRegistro.sort(), movidas, distintas };
}

// Una misma cubierta en dos posiciones a la vez: el historial no cierra.
const repetidas = (mapa) => {
  const vistas = new Set();
  const repes = new Set();
  for (const id of Object.values(mapa)) (vistas.has(id) ? repes : vistas).add(id);
  return [...repes];
};

/**
 * Arma el plan: qué esquema se guarda en cada OT y cuáles quedan como están.
 *
 * @param {object[]} p.ots  OTs cerradas y no anuladas: { id, unidad_id, unidad, fecha, cerrado_en, esquema_cierre }
 * @param {object[]} p.montadas  hoy: { id, micro_id, posicion }
 * @param {object[]} p.eventos, p.colocacionesAuditadas, p.cierresAuditados  ver arriba
 * @param {object[]} p.filas  ot_cubiertas con posición: { ot_id, posicion, cubierta_id, cubierta_anterior_id }
 * @param {object[]} p.micros  { id, unidad }
 * @param {Map}      p.fuegos  id de cubierta → fuego (también las dadas de baja)
 *
 * @returns {{ reconstruidas: object[], descartadas: object[], sinCubiertas: object[],
 *             soloConFecha: object[], noInterpretadas: object[] }}
 *   reconstruidas: { ot_id, unidad, cerrada, filas, movidas, esquema } con el
 *   esquema tal como se guarda: { antes, despues, sin_registro?, reconstruido: true }.
 *   Las demás quedan como están: descartadas (el historial no cierra),
 *   sinCubiertas (la unidad no tenía ninguna cargada) y soloConFecha (sin hora de cierre).
 */
function planificarReconstruccion({
  ots = [], montadas = [], eventos = [], colocacionesAuditadas = [], cierresAuditados = [],
  filas = [], micros = [], fuegos = new Map(),
}) {
  const horas = horasDeCierre({ ots, eventos, cierresAuditados });
  const anteriorDe = new Map(filas.map(f => [f.ot_id + ':' + f.posicion, f.cubierta_anterior_id]));
  const microPorNombre = new Map(micros.map(m => [String(m.unidad), m.id]));
  const { porUnidad, noInterpretadas } = movimientosPorPosicion({
    eventos, colocacionesAuditadas, horas, anteriorDe, microPorNombre,
  });
  const hoyPorUnidad = new Map();
  for (const c of montadas) {
    if (!hoyPorUnidad.has(c.micro_id)) hoyPorUnidad.set(c.micro_id, new Map());
    hoyPorUnidad.get(c.micro_id).set(c.posicion, c.id);
  }
  const filasDe = agrupar(filas, f => f.ot_id);
  const conFuego = (mapa) => Object.fromEntries(Object.keys(mapa).sort()
    .map(p => [p, { id: mapa[p], fuego: fuegos.has(mapa[p]) ? fuegos.get(mapa[p]) : null }]));

  const reconstruidas = [];
  const descartadas = [];
  const soloConFecha = [];
  const sinCubiertas = [];
  for (const ot of ots) {
    if (ot.esquema_cierre || !ot.unidad_id) continue;
    const t = horas.get(ot.id);
    if (t == null) {
      soloConFecha.push({ ot_id: ot.id, unidad: ot.unidad, fecha: ot.fecha });
      continue;
    }
    const suyas = filasDe.get(ot.id) || [];
    const r = reconstruirOt({
      ot, t, movimientos: porUnidad.get(ot.unidad_id) || new Map(), hoy: hoyPorUnidad.get(ot.unidad_id) || new Map(), filas: suyas,
    });

    let motivo = null;
    if (r.distintas.length) {
      motivo = 'lo que la OT anotó no coincide con el historial: ' + r.distintas
        .map(d => `${d.posicion} puso ${fuegos.get(d.puso) || d.puso}, el historial da ${d.historial ? fuegos.get(d.historial) || d.historial : 'vacía'}`)
        .join('; ');
    } else if (repetidas(r.despues).length || repetidas(r.antes).length) {
      const ids = [...new Set([...repetidas(r.despues), ...repetidas(r.antes)])];
      motivo = 'el historial deja una cubierta en dos posiciones: ' + ids.map(id => fuegos.get(id) || id).join(', ');
    }
    if (motivo) {
      descartadas.push({ ot_id: ot.id, unidad: ot.unidad, cerrada: t, filas: suyas.length, distintas: r.distintas.length, motivo });
      continue;
    }
    // Una unidad sin ninguna cubierta cargada en el sistema dibujaría todas sus
    // ruedas vacías: "sin registro" dice mejor lo que se sabe de ella.
    if (!Object.keys(r.antes).length && !Object.keys(r.despues).length && !r.sinRegistro.length) {
      sinCubiertas.push({ ot_id: ot.id, unidad: ot.unidad, cerrada: t });
      continue;
    }

    reconstruidas.push({
      ot_id: ot.id, unidad: ot.unidad, cerrada: t, filas: suyas.length, movidas: r.movidas,
      esquema: {
        antes: conFuego(r.antes),
        despues: conFuego(r.despues),
        ...(r.sinRegistro.length ? { sin_registro: r.sinRegistro } : {}),
        reconstruido: true,
      },
    });
  }

  const porCierre = (a, b) => a.cerrada - b.cerrada || a.ot_id - b.ot_id;
  reconstruidas.sort(porCierre);
  descartadas.sort(porCierre);
  sinCubiertas.sort(porCierre);
  return { reconstruidas, descartadas, sinCubiertas, soloConFecha, noInterpretadas };
}

/**
 * Huella del plan: cambia si cambia cualquier esquema que se vaya a guardar. La
 * simulación la muestra y `--aplicar` la exige, así se guarda lo que se revisó.
 */
function huellaDe(plan) {
  const resumen = plan.reconstruidas.map(r => [r.ot_id, r.esquema]);
  return crypto.createHash('sha256').update(JSON.stringify(resumen)).digest('hex').slice(0, 12);
}

module.exports = { horasDeCierre, movimientosPorPosicion, reconstruirOt, planificarReconstruccion, huellaDe };
