/**
 * Esquema de la unidad en las OTs cerradas antes de que se guardara.
 *
 * Cubre lib/reconstruccionEsquemas.js, la lógica de db/reconstruir_esquemas_2026_10.js:
 * hacia atrás desde la unidad de hoy, el primer movimiento posterior al cierre de
 * una OT dice qué había en cada posición. El caso de partida es el del taller: la
 * OT 572, un preventivo de la unidad 264, se veía sin ningún número de fuego.
 */
const {
  horasDeCierre, movimientosPorPosicion, planificarReconstruccion, huellaDe,
} = require('../lib/reconstruccionEsquemas');

const hora = (hhmmss) => new Date(`2026-10-01T${hhmmss}Z`);

const UNIDAD = { id: 10, unidad: '264' };
const OTRA = { id: 20, unidad: '350' };
const FUEGOS = new Map([
  [101, 'A'], [102, 'B'], [103, 'C'], [90, 'VIEJA'], [150, 'AUX-VIEJO'], [200, 'AUX-NUEVO'],
  [300, 'TRAIDA'], [77, 'DESPLAZADA'], [400, 'PUESTA'], [401, 'OTRA-AUX'], [999, 'DUPLICADA'],
]);

let n = 0;
const evento = (tipo, cubierta_id, posicion, hhmmss, { ot_id = null, micro_id = UNIDAD.id, origen = 'sistema', fecha = null } = {}) =>
  ({ id: ++n, tipo, cubierta_id, micro_id, posicion, ot_id, origen, fecha, creado_en: hora(hhmmss) });
const montada = (id, posicion, micro_id = UNIDAD.id) => ({ id, micro_id, posicion });
const otCerrada = (id, hhmmss, extra = {}) => ({
  id, unidad_id: UNIDAD.id, unidad: UNIDAD.unidad, fecha: '2026-10-01',
  cerrado_en: hhmmss ? hora(hhmmss) : null, esquema_cierre: null, ...extra,
});
const fila = (ot_id, posicion, cubierta_id, cubierta_anterior_id = null) => ({ ot_id, posicion, cubierta_id, cubierta_anterior_id });
const colocacionAMano = (hhmmss, cubierta_id, unidad, posicion, desplaza = null) => ({
  fecha: hora(hhmmss), cubierta_id,
  cambios: [
    { campo: 'unidad', antes: null, despues: unidad },
    { campo: 'posición', antes: null, despues: posicion },
    ...(desplaza ? [{ campo: 'desplaza a', antes: null, despues: 'cubierta id ' + desplaza }] : []),
  ],
});

const planDe = (datos) => planificarReconstruccion({ micros: [UNIDAD, OTRA], fuegos: FUEGOS, ...datos });
const reconstruida = (plan, ot_id) => plan.reconstruidas.find(r => r.ot_id === ot_id);
const ids = (mapa) => Object.fromEntries(Object.entries(mapa).map(([p, c]) => [p, c.id]));

// La unidad hoy: A en ddi, B en ddd, C en tie.
const HOY = [montada(101, 'ddi'), montada(102, 'ddd'), montada(103, 'tie')];

// ─── horasDeCierre ────────────────────────────────────────────
describe('horasDeCierre', () => {
  test('cerrado_en; si falta, la auditoría del cierre; si falta, el primer evento que dejó el cierre', () => {
    const horas = horasDeCierre({
      ots: [otCerrada(1, '09:00:00'), otCerrada(2, null), otCerrada(3, null)],
      cierresAuditados: [{ ot_id: 1, fecha: hora('11:00:00') }, { ot_id: 2, fecha: hora('10:00:00') }],
      eventos: [evento('colocacion', 101, 'ddi', '12:00:05', { ot_id: 3 }), evento('retiro', 90, 'ddi', '12:00:01', { ot_id: 3 })],
    });
    expect(horas.get(1)).toBe(+hora('09:00:00'));
    expect(horas.get(2)).toBe(+hora('10:00:00'));
    expect(horas.get(3)).toBe(+hora('12:00:01'));
  });

  test('sin nada de eso, null: de esa OT solo se sabe el día', () => {
    const horas = horasDeCierre({
      ots: [otCerrada(4, null)],
      // Los del backfill del 19/08 se escribieron todos juntos: no dicen la hora.
      eventos: [evento('colocacion', 101, 'ddi', '12:00:00', { ot_id: 4, origen: 'backfill' })],
    });
    expect(horas.get(4)).toBeNull();
  });
});

// ─── Cómo estaba la unidad al cerrar ──────────────────────────
describe('planificarReconstruccion — cómo estaba la unidad al cerrar la OT', () => {
  test('un preventivo sin movimientos posteriores: la unidad como está hoy', () => {
    // La OT 572 del taller: la 264 no tuvo movimientos desde ese día.
    const plan = planDe({ ots: [otCerrada(572, '10:45:00')], montadas: HOY });
    const r = reconstruida(plan, 572);
    expect(ids(r.esquema.despues)).toEqual({ ddi: 101, ddd: 102, tie: 103 });
    expect(r.esquema.antes).toEqual(r.esquema.despues);
    expect(r.esquema.sin_registro).toBeUndefined();
    expect(r.movidas).toBe(0);
  });

  // Después del preventivo (OT 1, 09:00), la OT 2 (12:00) cambia la VIEJA por A en ddi.
  // El cierre viejo escribía sus eventos un instante después de cerrar la OT.
  const CAMBIO = {
    ots: [otCerrada(1, '09:00:00'), otCerrada(2, '12:00:00')],
    montadas: HOY,
    eventos: [
      evento('retiro', 90, 'ddi', '12:00:01', { ot_id: 2 }),
      evento('colocacion', 101, 'ddi', '12:00:01', { ot_id: 2 }),
    ],
    filas: [fila(2, 'ddi', 101, 90)],
  };

  test('si después se cambió una cubierta, muestra la que había: la que salió después', () => {
    const r = reconstruida(planDe(CAMBIO), 1);
    expect(ids(r.esquema.despues)).toEqual({ ddi: 90, ddd: 102, tie: 103 });
    expect(r.movidas).toBe(1);
  });

  test('la OT que hizo el cambio: después la que entró, antes la que salió', () => {
    // Sus propios eventos son posteriores a cerrado_en, pero no cuentan como "después".
    const r = reconstruida(planDe(CAMBIO), 2);
    expect(ids(r.esquema.despues)).toEqual({ ddi: 101, ddd: 102, tie: 103 });
    expect(ids(r.esquema.antes)).toEqual({ ddi: 90, ddd: 102, tie: 103 });
  });

  test('una rotación posterior se deshace bien', () => {
    // A las 15:00 otra OT intercambia ddd y tie: hoy B está en tie y C en ddd.
    const plan = planDe({
      ots: [otCerrada(1, '09:00:00')],
      montadas: [montada(101, 'ddi'), montada(103, 'ddd'), montada(102, 'tie')],
      eventos: [
        evento('retiro', 103, 'tie', '15:00:00', { ot_id: 3 }), evento('retiro', 102, 'ddd', '15:00:00', { ot_id: 3 }),
        evento('colocacion', 103, 'ddd', '15:00:00', { ot_id: 3 }), evento('colocacion', 102, 'tie', '15:00:00', { ot_id: 3 }),
      ],
    });
    expect(ids(reconstruida(plan, 1).esquema.despues)).toEqual({ ddi: 101, ddd: 102, tie: 103 });
  });

  describe('entró una cubierta sin que saliera otra', () => {
    const conAuxilioPuesto = (anterior) => planDe({
      ots: [otCerrada(1, '09:00:00')],
      montadas: [...HOY, montada(200, 'ra')],
      eventos: [evento('colocacion', 200, 'ra', '16:00:00', { ot_id: 5 })],
      filas: [fila(5, 'ra', 200, anterior)],
    });

    test('lo que había lo sabe la OT que la puso, si lo anotó', () => {
      expect(ids(reconstruida(conAuxilioPuesto(150), 1).esquema.despues).ra).toBe(150);
    });

    test('si no lo anotó, esa posición queda sin registro', () => {
      const r = reconstruida(conAuxilioPuesto(null), 1);
      expect(r.esquema.sin_registro).toEqual(['ra']);
      expect(r.esquema.despues.ra).toBeUndefined();
      expect(r.esquema.antes.ra).toBeUndefined();
    });

    test('colocada a mano sin desplazar a ninguna: la posición estaba vacía', () => {
      const plan = planDe({
        ots: [otCerrada(1, '09:00:00')],
        montadas: [...HOY, montada(200, 'ra')],
        colocacionesAuditadas: [colocacionAMano('16:00:00', 200, '264', 'ra')],
      });
      const r = reconstruida(plan, 1);
      expect(r.esquema.despues.ra).toBeUndefined();
      expect(r.esquema.sin_registro).toBeUndefined();
    });
  });

  test('colocada a mano: cuentan la que desplazó y el lugar de donde vino', () => {
    // A las 10:00 alguien pasa la TRAIDA de la 350 (ddi) a la 264 (tde), donde estaba la DESPLAZADA.
    const plan = planDe({
      ots: [otCerrada(1, '09:00:00'), otCerrada(6, '09:30:00', { unidad_id: OTRA.id, unidad: OTRA.unidad })],
      montadas: [...HOY, montada(300, 'tde')],
      eventos: [evento('colocacion', 300, 'ddi', '08:00:00', { ot_id: 7, micro_id: OTRA.id })],
      colocacionesAuditadas: [colocacionAMano('10:00:00', 300, '264', 'tde', 77)],
    });
    expect(ids(reconstruida(plan, 1).esquema.despues).tde).toBe(77);
    expect(ids(reconstruida(plan, 6).esquema.despues)).toEqual({ ddi: 300 });
  });

  test('los retiros de la corrección de duplicados no cuentan: sacaron un duplicado de la base', () => {
    const plan = planDe({
      ots: [otCerrada(1, '09:00:00')],
      montadas: HOY,
      eventos: [evento('retiro', 999, 'ddi', '22:00:00', { origen: 'correccion' })],
    });
    expect(ids(reconstruida(plan, 1).esquema.despues).ddi).toBe(101);
  });

  test('lo que la OT anotó que puso manda sobre "sin registro"', () => {
    // La OT 1 puso la PUESTA en ra; después otra OT puso OTRA-AUX sin anotar qué había.
    const plan = planDe({
      ots: [otCerrada(1, '09:00:00')],
      montadas: [...HOY, montada(401, 'ra')],
      eventos: [
        evento('colocacion', 400, 'ra', '09:00:01', { ot_id: 1 }),
        evento('colocacion', 401, 'ra', '16:00:00', { ot_id: 8 }),
      ],
      filas: [fila(1, 'ra', 400), fila(8, 'ra', 401)],
    });
    const r = reconstruida(plan, 1);
    expect(ids(r.esquema.despues).ra).toBe(400);
    expect(r.esquema.sin_registro).toBeUndefined();
  });
});

// ─── Las que quedan como están ────────────────────────────────
describe('planificarReconstruccion — las OTs que quedan como están', () => {
  test('si el historial no pone en su lugar lo que la OT puso, no se toca', () => {
    // La OT dice que puso la VIEJA en ddi, pero ahí hay A desde antes y nada la movió.
    const plan = planDe({ ots: [otCerrada(1, '09:00:00')], montadas: HOY, filas: [fila(1, 'ddi', 90)] });
    expect(plan.reconstruidas).toHaveLength(0);
    expect(plan.descartadas).toEqual([expect.objectContaining({ ot_id: 1, filas: 1, distintas: 1 })]);
    expect(plan.descartadas[0].motivo).toContain('ddi puso VIEJA, el historial da A');
  });

  test('si el historial deja una cubierta en dos posiciones, no se toca', () => {
    // A está hoy en ddi sin movimientos, y un retiro posterior dice que estaba en ddd.
    const plan = planDe({
      ots: [otCerrada(1, '09:00:00')],
      montadas: HOY,
      eventos: [evento('retiro', 101, 'ddd', '10:00:00', { ot_id: 9 })],
    });
    expect(plan.reconstruidas).toHaveLength(0);
    expect(plan.descartadas[0].motivo).toContain('dos posiciones: A');
  });

  test('no pisa un esquema guardado por el cierre', () => {
    const plan = planDe({ ots: [otCerrada(1, '09:00:00', { esquema_cierre: { antes: {}, despues: {} } })], montadas: HOY });
    expect(plan.reconstruidas).toHaveLength(0);
    expect(plan.descartadas).toHaveLength(0);
  });

  test('sin hora de cierre queda como está: con dos movimientos el mismo día no se sabe el orden', () => {
    const plan = planDe({ ots: [otCerrada(1, null, { fecha: '2026-08-10' })], montadas: HOY });
    expect(plan.reconstruidas).toHaveLength(0);
    expect(plan.soloConFecha).toEqual([{ ot_id: 1, unidad: '264', fecha: '2026-08-10' }]);
  });

  test('una unidad sin ninguna cubierta cargada sigue "sin registro", no toda vacía', () => {
    const plan = planDe({ ots: [otCerrada(1, '09:00:00', { unidad_id: OTRA.id, unidad: OTRA.unidad })], montadas: HOY });
    expect(plan.reconstruidas).toHaveLength(0);
    expect(plan.sinCubiertas).toEqual([expect.objectContaining({ ot_id: 1, unidad: '350' })]);
  });

  test('una OT sin unidad no tiene esquema que dibujar', () => {
    const plan = planDe({ ots: [otCerrada(1, '09:00:00', { unidad_id: null })], montadas: HOY });
    expect([...plan.reconstruidas, ...plan.descartadas, ...plan.sinCubiertas, ...plan.soloConFecha]).toHaveLength(0);
  });
});

// ─── El esquema que se guarda ─────────────────────────────────
describe('el esquema que se guarda', () => {
  test('con los fuegos, en el formato del cierre y marcado como reconstruido', () => {
    const r = reconstruida(planDe({ ots: [otCerrada(572, '10:45:00')], montadas: HOY }), 572);
    const unidad = { ddd: { id: 102, fuego: 'B' }, ddi: { id: 101, fuego: 'A' }, tie: { id: 103, fuego: 'C' } };
    expect(r.esquema).toEqual({ antes: unidad, despues: unidad, reconstruido: true });
  });

  test('una cubierta sin fuego conocido va con fuego null: no se inventa', () => {
    const r = reconstruida(planDe({ ots: [otCerrada(1, '09:00:00')], montadas: [montada(12345, 'ddi')] }), 1);
    expect(r.esquema.despues.ddi).toEqual({ id: 12345, fuego: null });
  });
});

// ─── movimientosPorPosicion ───────────────────────────────────
describe('movimientosPorPosicion', () => {
  test('el backfill vale por la hora de su OT; el "anterior al historial", antes que todo', () => {
    const { porUnidad } = movimientosPorPosicion({
      horas: new Map([[3, +hora('12:00:00')]]),
      eventos: [
        evento('colocacion', 101, 'ddi', '23:00:00', { ot_id: 3, origen: 'backfill' }),
        evento('colocacion', 90, 'ddi', '23:00:00', { origen: 'backfill' }),
      ],
    });
    const lista = porUnidad.get(UNIDAD.id).get('ddi');
    expect(lista.map(m => [m.cubierta_id, m.t])).toEqual([[90, -Infinity], [101, +hora('12:00:00')]]);
  });

  test('una colocación a mano en una unidad que no existe queda sin interpretar, y se informa', () => {
    const { noInterpretadas } = movimientosPorPosicion({
      horas: new Map(),
      microPorNombre: new Map([['264', UNIDAD.id]]),
      colocacionesAuditadas: [colocacionAMano('10:00:00', 300, 'NO EXISTE', 'ddi')],
    });
    expect(noInterpretadas).toHaveLength(1);
  });
});

// ─── huellaDe ─────────────────────────────────────────────────
describe('huellaDe', () => {
  test('es la misma para el mismo plan y cambia si cambia cualquier esquema', () => {
    const datos = { ots: [otCerrada(1, '09:00:00')], montadas: HOY };
    const huella = huellaDe(planDe(datos));
    expect(huellaDe(planDe(datos))).toBe(huella);
    expect(huellaDe(planDe({ ...datos, montadas: [montada(101, 'ddi')] }))).not.toBe(huella);
  });
});
