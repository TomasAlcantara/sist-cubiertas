/**
 * Corrección de cubiertas duplicadas: qué queda y qué sale en cada posición.
 *
 * Es la lógica que decide la limpieza de datos (db/corregir_cubiertas_2026_10.js).
 * Los casos son los que había en producción al auditarla, reducidos a lo mínimo.
 */
const { decidirPosicion, planificarCorreccion, huellaDe } = require('../lib/correccionCubiertas');

const pos = (unidad, posicion, micro_id = Number(unidad)) => ({ micro_id, unidad: String(unidad), posicion });
const cub = (id, fuego, ...ots) => ({ id, fuego: String(fuego), ots });
const ot = (ot_id, fecha, orden = 1) => ({ ot_id, fecha, orden });

// ─── decidirPosicion ──────────────────────────────────────────
describe('decidirPosicion', () => {
  describe('R1 — las dos las montó la misma OT', () => {
    test('queda la última que se cargó en esa OT', () => {
      // Unidad 5074, OT 592: primero 14404, después se reemplazó por 14291.
      const r = decidirPosicion({
        posicion: pos(5074, 'ddi', 399),
        cubiertas: [cub(13220, 14291, ot(592, '2026-10-07', 2)), cub(13340, 14404, ot(592, '2026-10-07', 1))],
      });
      expect(r.regla).toBe('R1');
      expect(r.queda.fuego).toBe('14291');
      expect(r.salen.map(s => s.fuego)).toEqual(['14404']);
      expect(r.ot_id).toBe(592);
    });

    test('no depende del orden en que vengan las cubiertas', () => {
      const a = cub(13220, 14291, ot(592, '2026-10-07', 2));
      const b = cub(13340, 14404, ot(592, '2026-10-07', 1));
      expect(decidirPosicion({ posicion: pos(5074, 'ddi'), cubiertas: [b, a] }).queda.fuego).toBe('14291');
    });

    test('una OT posterior que confirma a la que queda no cambia nada', () => {
      // Unidad 267: la OT 80 cargó 7074 y después 13574; la OT 593 volvió a poner 13574.
      const r = decidirPosicion({
        posicion: pos(267, 'ddi', 140),
        cubiertas: [
          cub(6218, 7074, ot(80, '2026-05-05', 1)),
          cub(12671, 13574, ot(80, '2026-05-05', 2), ot(593, '2026-10-08', 1)),
        ],
      });
      expect(r.regla).toBe('R1');
      expect(r.queda.fuego).toBe('13574');
    });

    test('si hay más de una OT que las tiene a las dos, manda la más reciente', () => {
      const r = decidirPosicion({
        posicion: pos(1, 'ddi'),
        cubiertas: [
          cub(1, 'A', ot(10, '2026-05-01', 2), ot(20, '2026-06-01', 1)),
          cub(2, 'B', ot(10, '2026-05-01', 1), ot(20, '2026-06-01', 2)),
        ],
      });
      expect(r.queda.fuego).toBe('B');
      expect(r.ot_id).toBe(20);
    });

    test('a igual fecha, la OT de número más alto es la más reciente', () => {
      const r = decidirPosicion({
        posicion: pos(1, 'ddi'),
        cubiertas: [
          cub(1, 'A', ot(10, '2026-05-01', 2), ot(11, '2026-05-01', 1)),
          cub(2, 'B', ot(10, '2026-05-01', 1), ot(11, '2026-05-01', 2)),
        ],
      });
      expect(r.ot_id).toBe(11);
      expect(r.queda.fuego).toBe('B');
    });

    test('si la que saldría figura en una OT posterior, no decide: va a revisión', () => {
      const r = decidirPosicion({
        posicion: pos(1, 'ddi'),
        cubiertas: [
          cub(1, 'A', ot(10, '2026-05-01', 1), ot(30, '2026-07-01', 1)),
          cub(2, 'B', ot(10, '2026-05-01', 2)),
        ],
      });
      expect(r.revisar).toMatch(/OT posterior/);
      expect(r.queda).toBeUndefined();
    });

    test('con tres cubiertas de la misma OT queda la última y salen las otras dos', () => {
      const r = decidirPosicion({
        posicion: pos(1, 'ddi'),
        cubiertas: [cub(1, 'A', ot(10, '2026-05-01', 1)), cub(2, 'B', ot(10, '2026-05-01', 3)), cub(3, 'C', ot(10, '2026-05-01', 2))],
      });
      expect(r.queda.fuego).toBe('B');
      expect(r.salen.map(s => s.fuego)).toEqual(['A', 'C']);
    });
  });

  describe('R2 — una la montó una OT y la otra viene de la carga inicial', () => {
    test('queda la de la OT', () => {
      // Unidad 255: la OT 11 puso la 13307 y la carga de abril volvió a montar la 11440.
      const r = decidirPosicion({
        posicion: pos(255, 'ddd', 8),
        cubiertas: [cub(35, 13307, ot(11, '2026-04-20')), cub(10554, 11440)],
      });
      expect(r.regla).toBe('R2');
      expect(r.queda.fuego).toBe('13307');
      expect(r.salen.map(s => s.fuego)).toEqual(['11440']);
      expect(r.ot_id).toBeNull();
    });

    test('vale aunque a la que queda la respalden varias OTs', () => {
      // Unidad 357: la 13105 figura en las OTs 9 y 292.
      const r = decidirPosicion({
        posicion: pos(357, 'ddd', 6),
        cubiertas: [cub(9128, 10013), cub(48, 13105, ot(9, '2026-03-12'), ot(292, '2026-08-06'))],
      });
      expect(r.regla).toBe('R2');
      expect(r.queda.fuego).toBe('13105');
      expect(r.detalle).toContain('292');
    });
  });

  describe('lo que no decide', () => {
    test('ninguna tiene una OT que la respalde', () => {
      const r = decidirPosicion({ posicion: pos(1, 'ddi'), cubiertas: [cub(1, 'A'), cub(2, 'B')] });
      expect(r.revisar).toMatch(/ninguna/);
    });

    test('las montaron OTs distintas', () => {
      const r = decidirPosicion({
        posicion: pos(1, 'ddi'),
        cubiertas: [cub(1, 'A', ot(10, '2026-05-01')), cub(2, 'B', ot(20, '2026-06-01'))],
      });
      expect(r.revisar).toMatch(/OTs distintas/);
    });

    test('tres cubiertas, dos con OT y una sin', () => {
      const r = decidirPosicion({
        posicion: pos(1, 'ddi'),
        cubiertas: [cub(1, 'A', ot(10, '2026-05-01', 1)), cub(2, 'B', ot(10, '2026-05-01', 2)), cub(3, 'C')],
      });
      expect(r.revisar).toBeDefined();
    });
  });

  describe('decisión cargada a mano', () => {
    const cubiertas = [cub(1, 'A', ot(10, '2026-05-01', 1)), cub(2, 'B', ot(10, '2026-05-01', 2))];

    test('gana sobre las reglas', () => {
      const r = decidirPosicion({ posicion: pos(1, 'ddi'), cubiertas, decision: 'A' });
      expect(r.regla).toBe('manual');
      expect(r.queda.fuego).toBe('A');
      expect(r.salen.map(s => s.fuego)).toEqual(['B']);
    });

    test('resuelve una posición que las reglas mandaban a revisión', () => {
      const r = decidirPosicion({ posicion: pos(1, 'ddi'), cubiertas: [cub(1, 'A'), cub(2, 'B')], decision: 'B' });
      expect(r.queda.fuego).toBe('B');
    });

    test('con un fuego que no está en esa posición falla, no elige otra cosa', () => {
      expect(() => decidirPosicion({ posicion: pos(1, 'ddi'), cubiertas, decision: 'Z' })).toThrow(/Z no está en esa posición/);
    });
  });
});

// ─── planificarCorreccion ─────────────────────────────────────
describe('planificarCorreccion', () => {
  const A_VERIFICAR = { id: 19, nombre: 'A VERIFICAR' };
  const ZARATE = { id: 2, nombre: 'BASE ZARATE' };
  const destinoDe = (unidad) => (unidad === '5074' ? ZARATE : A_VERIFICAR);

  // Fila de ot_cubiertas: OT cerrada salvo que se diga otra cosa.
  const fila = (ot_id, unidad_id, posicion, cubierta_id, fuego, orden, extra = {}) => ({
    ot_id, unidad_id, estado: 1, anulada: false, fecha: '2026-10-07', posicion, cubierta_id, fuego: String(fuego), orden, ...extra,
  });
  const dup = (micro_id, unidad, posicion, id, fuego) => ({ micro_id, unidad: String(unidad), posicion, id, fuego: String(fuego) });

  const DUPLICADAS_5074 = [dup(399, 5074, 'ddi', 13220, 14291), dup(399, 5074, 'ddi', 13340, 14404)];
  const FILAS_592 = [fila(592, 399, 'ddi', 13340, 14404, 1), fila(592, 399, 'ddi', 13220, 14291, 2)];

  test('unidad 5074: queda la última cargada, sale la otra a su destino y se borra su fila fantasma', () => {
    const plan = planificarCorreccion({ duplicadas: DUPLICADAS_5074, filasOt: FILAS_592, destinoDe });

    expect(plan.pendientes).toEqual([]);
    expect(plan.posiciones).toHaveLength(1);
    expect(plan.posiciones[0]).toMatchObject({ micro_id: 399, unidad: '5074', posicion: 'ddi', regla: 'R1', destino: ZARATE });
    expect(plan.posiciones[0].queda.fuego).toBe('14291');
    expect(plan.posiciones[0].salen.map(s => s.fuego)).toEqual(['14404']);
    expect(plan.fantasmas).toEqual([
      { ot_id: 592, posicion: 'ddi', cubierta_id: 13340, fuego: '14404', queda: '14291', ot_abierta: false },
    ]);
  });

  test('unidad 255: la de la carga inicial sale a "A VERIFICAR" y no hay fila fantasma que borrar', () => {
    const plan = planificarCorreccion({
      duplicadas: [dup(8, 255, 'ddd', 35, 13307), dup(8, 255, 'ddd', 10554, 11440)],
      filasOt: [fila(11, 8, 'ddd', 35, 13307, 1, { fecha: '2026-04-20' })],
      destinoDe,
    });
    expect(plan.posiciones[0]).toMatchObject({ regla: 'R2', destino: A_VERIFICAR });
    expect(plan.posiciones[0].salen.map(s => s.fuego)).toEqual(['11440']);
    expect(plan.fantasmas).toEqual([]);
  });

  test('lo que las reglas no deciden queda pendiente y no se toca', () => {
    const plan = planificarCorreccion({
      duplicadas: [dup(1, 1, 'ddi', 1, 'A'), dup(1, 1, 'ddi', 2, 'B')], filasOt: [], destinoDe,
    });
    expect(plan.posiciones).toEqual([]);
    expect(plan.pendientes).toEqual([{ micro_id: 1, unidad: '1', posicion: 'ddi', cubiertas: ['A', 'B'], motivo: expect.any(String) }]);
  });

  describe('qué OT respalda a una cubierta', () => {
    const duplicadas = [dup(8, 255, 'ddd', 35, 13307), dup(8, 255, 'ddd', 10554, 11440)];
    const reglaCon = (filasOt) => {
      const plan = planificarCorreccion({ duplicadas, filasOt, destinoDe });
      return plan.posiciones.length ? plan.posiciones[0].regla : 'pendiente';
    };

    test('una OT cerrada de esa unidad, en esa posición', () => {
      expect(reglaCon([fila(11, 8, 'ddd', 35, 13307, 1)])).toBe('R2');
    });
    test('una OT abierta no cuenta: todavía no montó nada', () => {
      expect(reglaCon([fila(11, 8, 'ddd', 35, 13307, 1, { estado: 0 })])).toBe('pendiente');
    });
    test('una OT anulada no cuenta', () => {
      expect(reglaCon([fila(11, 8, 'ddd', 35, 13307, 1, { anulada: true })])).toBe('pendiente');
    });
    test('una OT de otra unidad no cuenta', () => {
      expect(reglaCon([fila(11, 99, 'ddd', 35, 13307, 1)])).toBe('pendiente');
    });
    test('una OT que la puso en otra posición no cuenta', () => {
      expect(reglaCon([fila(11, 8, 'tie', 35, 13307, 1)])).toBe('pendiente');
    });
  });

  describe('filas fantasma', () => {
    test('en cada OT y posición queda la última fila escrita', () => {
      const plan = planificarCorreccion({
        filasOt: [fila(250, 5, 'tde', 12687, 13612, 1), fila(250, 5, 'tde', 13002, 13842, 2), fila(250, 5, 'ddd', 1, 'X', 1)],
        destinoDe,
      });
      expect(plan.fantasmas).toEqual([
        { ot_id: 250, posicion: 'tde', cubierta_id: 12687, fuego: '13612', queda: '13842', ot_abierta: false },
      ]);
    });

    test('se limpian aunque la unidad ya no tenga la posición duplicada', () => {
      // OTs 14, 196 y 250: después alguien corrigió la unidad a mano, pero la fila sigue ahí.
      const plan = planificarCorreccion({ duplicadas: [], filasOt: [fila(14, 5, 'ddd', 1, 13258, 1), fila(14, 5, 'ddd', 2, 13256, 2)], destinoDe });
      expect(plan.posiciones).toEqual([]);
      expect(plan.fantasmas.map(f => f.fuego)).toEqual(['13258']);
    });

    test('las de una OT abierta también, y quedan señaladas', () => {
      const plan = planificarCorreccion({
        filasOt: [fila(700, 5, 'ddi', 1, 'A', 1, { estado: 0 }), fila(700, 5, 'ddi', 2, 'B', 2, { estado: 0 })], destinoDe,
      });
      expect(plan.fantasmas).toEqual([expect.objectContaining({ ot_id: 700, fuego: 'A', ot_abierta: true })]);
    });

    test('una OT con una sola fila por posición no tiene nada que limpiar', () => {
      const plan = planificarCorreccion({ filasOt: [fila(1, 5, 'ddi', 1, 'A', 1), fila(1, 5, 'ddd', 2, 'B', 1)], destinoDe });
      expect(plan.fantasmas).toEqual([]);
    });

    test('si a mano se decidió que queda la primera, la fila fantasma es la otra', () => {
      const plan = planificarCorreccion({
        duplicadas: DUPLICADAS_5074, filasOt: FILAS_592, destinoDe, decisiones: { '5074:ddi': '14404' },
      });
      expect(plan.posiciones[0].queda.fuego).toBe('14404');
      expect(plan.fantasmas.map(f => f.fuego)).toEqual(['14291']);
    });
  });

  test('una decisión manual para una posición que no está duplicada es un error', () => {
    expect(() => planificarCorreccion({ duplicadas: DUPLICADAS_5074, filasOt: FILAS_592, destinoDe, decisiones: { '5074:tie': '1' } }))
      .toThrow(/5074:tie/);
  });

  test('el plan sale ordenado por unidad y posición', () => {
    const plan = planificarCorreccion({
      duplicadas: [
        dup(399, 5074, 'tie', 3, 'C'), dup(399, 5074, 'tie', 4, 'D'),
        dup(8, 255, 'ddd', 35, 13307), dup(8, 255, 'ddd', 10554, 11440),
        ...DUPLICADAS_5074,
      ],
      filasOt: [...FILAS_592, fila(592, 399, 'tie', 3, 'C', 1), fila(592, 399, 'tie', 4, 'D', 2), fila(11, 8, 'ddd', 35, 13307, 1)],
      destinoDe,
    });
    expect(plan.posiciones.map(p => `${p.unidad}:${p.posicion}`)).toEqual(['255:ddd', '5074:ddi', '5074:tie']);
  });
});

// ─── huellaDe ─────────────────────────────────────────────────
describe('huellaDe', () => {
  const destinoDe = () => ({ id: 19, nombre: 'A VERIFICAR' });
  const fila = (ot_id, cubierta_id, fuego, orden) => ({
    ot_id, unidad_id: 399, estado: 1, anulada: false, fecha: '2026-10-07', posicion: 'ddi', cubierta_id, fuego, orden,
  });
  const duplicadas = [
    { micro_id: 399, unidad: '5074', posicion: 'ddi', id: 13220, fuego: '14291' },
    { micro_id: 399, unidad: '5074', posicion: 'ddi', id: 13340, fuego: '14404' },
  ];
  const filasOt = [fila(592, 13340, '14404', 1), fila(592, 13220, '14291', 2)];
  const plan = (extra = {}) => planificarCorreccion({ duplicadas, filasOt, destinoDe, ...extra });

  test('el mismo plan da siempre la misma huella', () => {
    expect(huellaDe(plan())).toBe(huellaDe(plan()));
    expect(huellaDe(plan())).toMatch(/^[0-9a-f]{12}$/);
  });

  test('cambia si cambia cuál queda', () => {
    expect(huellaDe(plan({ decisiones: { '5074:ddi': '14404' } }))).not.toBe(huellaDe(plan()));
  });

  test('cambia si cambia el destino', () => {
    expect(huellaDe(plan({ destinoDe: () => ({ id: 2, nombre: 'BASE ZARATE' }) }))).not.toBe(huellaDe(plan()));
  });

  test('cambia si aparece otra fila fantasma', () => {
    const conOtra = planificarCorreccion({
      duplicadas, destinoDe,
      filasOt: [...filasOt, { ...fila(600, 1, 'X', 1), posicion: 'tie' }, { ...fila(600, 2, 'Y', 2), posicion: 'tie' }],
    });
    expect(huellaDe(conOtra)).not.toBe(huellaDe(plan()));
  });

  test('no depende del id del almacén de destino, que la simulación crea y deshace', () => {
    const conOtroId = plan({ destinoDe: () => ({ id: null, nombre: 'A VERIFICAR' }) });
    expect(huellaDe(conOtroId)).toBe(huellaDe(plan()));
  });
});
