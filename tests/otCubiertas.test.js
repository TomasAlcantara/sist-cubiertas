/**
 * Cubiertas de una OT: qué se guarda al cargarla y qué se mueve al cerrarla.
 *
 * Cubre lib/otCubiertas.js, que existe por un problema concreto: unidades con
 * dos cubiertas activas en la misma posición. Varios casos de acá son los que
 * se encontraron en producción (unidades 5074, 267, 5033), reducidos a lo mínimo.
 */
jest.mock('../db', () => {
  const fn = jest.fn().mockResolvedValue([]);
  fn.transaction = jest.fn((consultas) => Promise.all(consultas));
  return { sql: fn };
});

const { sql } = require('../db');
const {
  POSICIONES, ALMACEN_A_VERIFICAR, almacenAVerificar,
  normalizarCambios, validarCubiertasDeOt, guardarCubiertasDeOt,
  leerEstadoParaCierre, planificarCierre, consultasDeCierre, esquemaDeOtCerrada,
} = require('../lib/otCubiertas');
const { consultaEvento, registrarEvento } = require('../lib/cubiertaHistorial');

// Texto de cada llamada a sql`...`, en una línea y con un ? donde iba cada valor.
const textoDe = (q) => (Array.isArray(q) ? q.join('?') : String(q)).replace(/\s+/g, ' ').trim();
const llamadas = () => sql.mock.calls.map(([q, ...valores]) => ({ texto: textoDe(q), valores }));

// La base contesta según el texto de la consulta: la primera regla que aparezca en él.
const baseCon = (reglas = []) => sql.mockImplementation((q) => {
  const regla = reglas.find(([clave]) => textoDe(q).includes(clave));
  return Promise.resolve(regla ? regla[1] : []);
});

beforeEach(() => {
  sql.mockReset();
  sql.mockResolvedValue([]);
  sql.transaction.mockClear();
});

const UNIDAD = 399;
const OT = { id: 592, unidad_id: UNIDAD, fecha: '2026-10-07' };

// Fila de la OT con una cubierta que hoy está libre (en un almacén o sin ubicar)…
const libre = (cubierta_id, posicion, fuego = String(cubierta_id)) => ({
  cubierta_id, posicion, fuego, activo: 1, micro_id: null, posicion_actual: null, unidad: null,
});
// …o montada en esta misma unidad, en `actual`.
const montadaAca = (cubierta_id, posicion, actual, fuego = String(cubierta_id)) => ({
  ...libre(cubierta_id, posicion, fuego), micro_id: UNIDAD, posicion_actual: actual, unidad: '5074',
});
const enUnidad = (id, posicion, fuego = String(id)) => ({ id, fuego, posicion });

const ids = (lista, campo = 'cubierta_id') => lista.map(x => x[campo]);
const eventos = (plan) => plan.eventos.map(e => `${e.tipo}:${e.cubierta_id}@${e.posicion}`);

// ─── planificarCierre ─────────────────────────────────────────
describe('planificarCierre', () => {
  test('unidad vacía: entran todas y no sale nada', () => {
    const filas = ['ddd', 'ddi', 'tie', 'tii', 'tdi', 'tde'].map((pos, i) => libre(13219 + i, pos));
    const plan = planificarCierre({ ot: OT, km: 2362, filas, montadas: [] });

    expect(plan.errores).toEqual([]);
    expect(plan.entrantes).toHaveLength(6);
    expect(plan.salientes).toEqual([]);
    expect(plan.eventos.map(e => e.tipo)).toEqual(Array(6).fill('colocacion'));
  });

  test('sale la cubierta que ocupa hoy la posición', () => {
    // No hace falta que la OT la tenga anotada como "anterior": se mira la unidad.
    const plan = planificarCierre({
      ot: OT, km: 10, filas: [libre(50, 'ddi')], montadas: [enUnidad(7, 'ddi', 'vieja')],
    });
    expect(ids(plan.salientes, 'id')).toEqual([7]);
    expect(eventos(plan)).toEqual(['retiro:7@ddi', 'colocacion:50@ddi']);
    expect(plan.anteriores).toEqual([{ cubierta_id: 50, anterior_id: 7 }]);
  });

  test('una posición que la OT no toca queda como estaba', () => {
    const plan = planificarCierre({
      ot: OT, km: 10, filas: [libre(50, 'ddi')],
      montadas: [enUnidad(7, 'ddi'), enUnidad(8, 'ddd'), enUnidad(9, 'tie')],
    });
    expect(ids(plan.salientes, 'id')).toEqual([7]);
  });

  test('delanteras atrás y dos nuevas adelante: salen solo las traseras viejas', () => {
    // Unidad 5033, OT 357. Con las filas fantasma las traseras viejas quedaron
    // montadas adelante, encima de las nuevas.
    const plan = planificarCierre({
      ot: OT, km: 10,
      filas: [
        libre(91, 'ddd', '13402'), libre(92, 'ddi', '13412'),
        montadaAca(1, 'tde', 'ddd', '12398'), montadaAca(2, 'tdi', 'ddi', '12389'),
      ],
      montadas: [
        enUnidad(1, 'ddd', '12398'), enUnidad(2, 'ddi', '12389'),
        enUnidad(3, 'tde', '12394'), enUnidad(4, 'tdi', '11516'),
      ],
    });
    expect(plan.errores).toEqual([]);
    expect(ids(plan.salientes, 'id')).toEqual([3, 4]);
    expect(ids(plan.rotadas)).toEqual([1, 2]);
    expect(ids(plan.entrantes)).toEqual([91, 92, 1, 2]);
  });

  test('intercambio A↔B: no sale ninguna, rotan las dos', () => {
    const plan = planificarCierre({
      ot: OT, km: 10,
      filas: [montadaAca(1, 'tde', 'tie'), montadaAca(2, 'tie', 'tde')],
      montadas: [enUnidad(1, 'tie'), enUnidad(2, 'tde')],
    });
    expect(plan.salientes).toEqual([]);
    expect(ids(plan.rotadas)).toEqual([1, 2]);
    expect(eventos(plan)).toEqual(['retiro:1@tie', 'retiro:2@tde', 'colocacion:1@tde', 'colocacion:2@tie']);
    // Cada una encuentra en su lugar a la otra
    expect(plan.anteriores).toEqual([{ cubierta_id: 1, anterior_id: 2 }, { cubierta_id: 2, anterior_id: 1 }]);
  });

  test('movimiento de una vía: sale la del destino y el origen queda vacío', () => {
    const plan = planificarCierre({
      ot: OT, km: 10,
      filas: [montadaAca(1, 'tde', 'tie')],
      montadas: [enUnidad(1, 'tie'), enUnidad(2, 'tde')],
    });
    expect(ids(plan.salientes, 'id')).toEqual([2]);
    expect(eventos(plan)).toEqual(['retiro:2@tde', 'retiro:1@tie', 'colocacion:1@tde']);
  });

  test('los retiros van siempre antes que las colocaciones', () => {
    // En una rotación la misma cubierta sale y entra en la misma OT: el orden de
    // los eventos es lo que define dónde se corta cada tramo de km.
    const plan = planificarCierre({
      ot: OT, km: 10,
      filas: [libre(50, 'ddi'), montadaAca(1, 'tde', 'tie'), montadaAca(2, 'tie', 'tde')],
      montadas: [enUnidad(1, 'tie'), enUnidad(2, 'tde'), enUnidad(3, 'ddi')],
    });
    const tipos = plan.eventos.map(e => e.tipo);
    expect(tipos.lastIndexOf('retiro')).toBeLessThan(tipos.indexOf('colocacion'));
  });

  test('una entrante que ya está en su posición no se mueve ni deja eventos', () => {
    const plan = planificarCierre({
      ot: OT, km: 10, filas: [montadaAca(1, 'ddi', 'ddi')], montadas: [enUnidad(1, 'ddi')],
    });
    expect(plan.entrantes).toEqual([]);
    expect(plan.salientes).toEqual([]);
    expect(plan.eventos).toEqual([]);
  });

  test('posición que ya tenía dos cubiertas: la que no es de la OT sale', () => {
    // Unidad 267, OT 593: se cargó ddi ← 13574, que ya estaba ahí junto con la
    // 7074 fantasma. Antes se tomaba por rotación y la fantasma no salía nunca.
    const plan = planificarCierre({
      ot: OT, km: 10,
      filas: [montadaAca(12671, 'ddi', 'ddi', '13574')],
      montadas: [enUnidad(6218, 'ddi', '7074'), enUnidad(12671, 'ddi', '13574')],
    });
    expect(ids(plan.salientes, 'id')).toEqual([6218]);
    expect(plan.entrantes).toEqual([]);
    expect(eventos(plan)).toEqual(['retiro:6218@ddi']);
  });

  test('si la posición tenía dos y entra una tercera, salen las dos', () => {
    const plan = planificarCierre({
      ot: OT, km: 10, filas: [libre(50, 'ddi')],
      montadas: [enUnidad(7, 'ddi'), enUnidad(8, 'ddi')],
    });
    expect(ids(plan.salientes, 'id')).toEqual([7, 8]);
  });

  test('una OT sin cubiertas no mueve nada', () => {
    const plan = planificarCierre({ ot: OT, km: 10, filas: [], montadas: [enUnidad(7, 'ddi')] });
    expect(plan).toMatchObject({ errores: [], entrantes: [], salientes: [], rotadas: [], anteriores: [], eventos: [] });
  });

  test('los eventos llevan fecha de la OT, unidad, km de cierre y número de OT', () => {
    const plan = planificarCierre({ ot: OT, km: 2362, filas: [libre(50, 'ddi')], montadas: [] });
    expect(plan.eventos[0]).toMatchObject({
      cubierta_id: 50, tipo: 'colocacion', posicion: 'ddi',
      fecha: '2026-10-07', micro_id: UNIDAD, km_unidad: 2362, ot_id: 592,
    });
  });

  describe('lo que impide cerrar', () => {
    test('dos cubiertas cargadas para la misma posición', () => {
      // Unidad 5074, OT 592: así se montaron 12 cubiertas en 6 posiciones.
      const plan = planificarCierre({
        ot: OT, filas: [libre(13340, 'ddi', '14404'), libre(13220, 'ddi', '14291')], montadas: [],
      });
      expect(plan.errores).toHaveLength(1);
      expect(plan.errores[0]).toContain('Del. Izq.');
      expect(plan.errores[0]).toContain('14404');
      expect(plan.errores[0]).toContain('14291');
    });

    test('una entrante que figura montada en otra unidad', () => {
      // Unidad 267, OT 80: se llevó puestas cuatro cubiertas de la 153.
      const deOtra = { ...libre(6218, 'ddi', '7074'), micro_id: 153, posicion_actual: 'tie', unidad: '153' };
      const plan = planificarCierre({ ot: OT, filas: [deOtra], montadas: [] });
      expect(plan.errores).toHaveLength(1);
      expect(plan.errores[0]).toContain('7074');
      expect(plan.errores[0]).toContain('unidad 153');
    });

    test('una entrante dada de baja', () => {
      const plan = planificarCierre({ ot: OT, filas: [{ ...libre(1, 'ddi', '9000'), activo: 0 }], montadas: [] });
      expect(plan.errores).toEqual([expect.stringContaining('dada de baja')]);
    });

    test('cubiertas cargadas en una OT sin unidad', () => {
      const plan = planificarCierre({ ot: { id: 1, unidad_id: null }, filas: [libre(1, 'ddi')], montadas: [] });
      expect(plan.errores).toHaveLength(1);
    });

    test('junta todos los motivos, no solo el primero', () => {
      const plan = planificarCierre({
        ot: OT, montadas: [],
        filas: [libre(1, 'ddi'), libre(2, 'ddi'), { ...libre(3, 'tie'), activo: 0 }],
      });
      expect(plan.errores).toHaveLength(2);
    });
  });

  describe('arreglo y baja', () => {
    const montadas = [enUnidad(1, 'tie'), enUnidad(2, 'tde')];

    test('el arreglo se le anota a la cubierta que sale', () => {
      const plan = planificarCierre({ ot: OT, km: 10, arreglo: true, filas: [libre(50, 'tde')], montadas });
      expect(eventos(plan)).toEqual(['retiro:2@tde', 'reparacion:2@tde', 'colocacion:50@tde']);
    });

    test('a la que rota, solo si otra entra en el lugar que deja', () => {
      const unaVia = planificarCierre({ ot: OT, km: 10, arreglo: true, filas: [montadaAca(1, 'tde', 'tie')], montadas });
      expect(eventos(unaVia).filter(e => e.startsWith('reparacion'))).toEqual(['reparacion:2@tde']);

      const swap = planificarCierre({
        ot: OT, km: 10, arreglo: true, montadas,
        filas: [montadaAca(1, 'tde', 'tie'), montadaAca(2, 'tie', 'tde')],
      });
      expect(eventos(swap).filter(e => e.startsWith('reparacion'))).toEqual(['reparacion:1@tie', 'reparacion:2@tde']);
    });

    test('sin arreglo no hay reparaciones', () => {
      const plan = planificarCierre({ ot: OT, km: 10, filas: [libre(50, 'tde')], montadas });
      expect(plan.eventos.some(e => e.tipo === 'reparacion')).toBe(false);
    });

    test('con destino CEAMSE la saliente deja retiro y baja', () => {
      const plan = planificarCierre({ ot: OT, km: 10, destinoEsCeamse: true, filas: [libre(50, 'tde')], montadas });
      expect(eventos(plan)).toEqual(['retiro:2@tde', 'baja:2@tde', 'colocacion:50@tde']);
      expect(plan.eventos[0].detalle).toContain('CEAMSE');
    });

    test('la que rota no se da de baja aunque el destino sea CEAMSE', () => {
      const plan = planificarCierre({
        ot: OT, km: 10, destinoEsCeamse: true, montadas,
        filas: [montadaAca(1, 'tde', 'tie'), montadaAca(2, 'tie', 'tde')],
      });
      expect(plan.eventos.some(e => e.tipo === 'baja')).toBe(false);
    });
  });
});

// ─── El esquema que la OT guarda al cerrarse ──────────────────
// La pantalla de una OT cerrada rellenaba las posiciones que la OT no había
// tocado con lo que la unidad tiene montado HOY: una OT vieja "cambiaba" cada vez
// que cambiaba la unidad. Ahora la OT guarda cómo quedó la unidad y se dibuja con eso.
describe('planificarCierre — esquema de la unidad antes y después', () => {
  const fuegosDe = (mapa) => Object.fromEntries(Object.entries(mapa).map(([pos, c]) => [pos, c.fuego]));

  test('reemplazo: cambia esa posición y el resto de la unidad queda igual', () => {
    const plan = planificarCierre({
      ot: OT, km: 10, filas: [libre(50, 'ddi', 'NUEVA')],
      montadas: [enUnidad(7, 'ddi', 'VIEJA'), enUnidad(8, 'ddd', 'OTRA'), enUnidad(9, 'ra', 'AUX')],
    });
    expect(fuegosDe(plan.esquema.antes)).toEqual({ ddi: 'VIEJA', ddd: 'OTRA', ra: 'AUX' });
    expect(fuegosDe(plan.esquema.despues)).toEqual({ ddi: 'NUEVA', ddd: 'OTRA', ra: 'AUX' });
    expect(plan.esquema.despues.ddi).toEqual({ id: 50, fuego: 'NUEVA' });
  });

  test('una OT sin cubiertas (un preventivo) guarda la unidad tal como estaba', () => {
    const montadas = [enUnidad(7, 'ddi', 'A'), enUnidad(8, 'ddd', 'B')];
    const plan = planificarCierre({ ot: OT, km: 10, filas: [], montadas });
    expect(plan.esquema.antes).toEqual({ ddi: { id: 7, fuego: 'A' }, ddd: { id: 8, fuego: 'B' } });
    expect(plan.esquema.despues).toEqual(plan.esquema.antes);
  });

  test('intercambio A↔B: las dos cambian de lugar', () => {
    const plan = planificarCierre({
      ot: OT, km: 10,
      filas: [montadaAca(1, 'tde', 'tie', 'A'), montadaAca(2, 'tie', 'tde', 'B')],
      montadas: [enUnidad(1, 'tie', 'A'), enUnidad(2, 'tde', 'B')],
    });
    expect(fuegosDe(plan.esquema.antes)).toEqual({ tie: 'A', tde: 'B' });
    expect(fuegosDe(plan.esquema.despues)).toEqual({ tie: 'B', tde: 'A' });
  });

  test('movimiento de una vía: el origen queda vacío', () => {
    const plan = planificarCierre({
      ot: OT, km: 10,
      filas: [montadaAca(1, 'tde', 'tie', 'A')],
      montadas: [enUnidad(1, 'tie', 'A'), enUnidad(2, 'tde', 'B')],
    });
    expect(fuegosDe(plan.esquema.despues)).toEqual({ tde: 'A' });
    expect(plan.esquema.despues.tie).toBeUndefined();
  });

  test('delanteras atrás y nuevas adelante: las traseras viejas ya no están', () => {
    const plan = planificarCierre({
      ot: OT, km: 10,
      filas: [
        libre(91, 'ddd', '13402'), libre(92, 'ddi', '13412'),
        montadaAca(1, 'tde', 'ddd', '12398'), montadaAca(2, 'tdi', 'ddi', '12389'),
      ],
      montadas: [
        enUnidad(1, 'ddd', '12398'), enUnidad(2, 'ddi', '12389'),
        enUnidad(3, 'tde', '12394'), enUnidad(4, 'tdi', '11516'),
      ],
    });
    expect(fuegosDe(plan.esquema.despues)).toEqual({ ddd: '13402', ddi: '13412', tde: '12398', tdi: '12389' });
  });

  test('una entrante que ya estaba en su lugar no cambia el esquema', () => {
    const plan = planificarCierre({
      ot: OT, km: 10, filas: [montadaAca(1, 'ddi', 'ddi', 'A')], montadas: [enUnidad(1, 'ddi', 'A')],
    });
    expect(plan.esquema.despues).toEqual(plan.esquema.antes);
  });

  test('una posición que tenía dos cubiertas las anota a las dos, no elige', () => {
    const plan = planificarCierre({
      ot: OT, km: 10, filas: [],
      montadas: [enUnidad(6218, 'ddi', '7074'), enUnidad(12671, 'ddi', '13574')],
    });
    expect(plan.esquema.antes.ddi.fuego).toBe('7074 / 13574');
  });

  test('si la OT resuelve el duplicado, antes figuran las dos y después una', () => {
    const plan = planificarCierre({
      ot: OT, km: 10,
      filas: [montadaAca(12671, 'ddi', 'ddi', '13574')],
      montadas: [enUnidad(6218, 'ddi', '7074'), enUnidad(12671, 'ddi', '13574')],
    });
    expect(plan.esquema.antes.ddi.fuego).toBe('7074 / 13574');
    expect(plan.esquema.despues.ddi).toEqual({ id: 12671, fuego: '13574' });
  });
});

describe('esquemaDeOtCerrada', () => {
  const GUARDADO = { antes: { ddi: { id: 7, fuego: 'VIEJA' } }, despues: { ddi: { id: 50, fuego: 'NUEVA' } } };
  const FILAS_OT = [
    { id: 50, fuego: 'NUEVA', posicion: 'ddi', cubierta_anterior_id: 7, fuego_anterior: 'VIEJA' },
    { id: 51, fuego: 'OTRA', posicion: 'ddd', cubierta_anterior_id: null, fuego_anterior: null },
  ];

  test('con el esquema guardado devuelve la unidad completa', () => {
    expect(esquemaDeOtCerrada({ esquema_cierre: GUARDADO }, FILAS_OT)).toEqual({ completo: true, ...GUARDADO });
  });

  test('lo entiende también si llega como texto', () => {
    expect(esquemaDeOtCerrada({ esquema_cierre: JSON.stringify(GUARDADO) }, [])).toEqual({ completo: true, ...GUARDADO });
  });

  test('sin esquema guardado arma solo lo que la OT cambió', () => {
    // Las OTs cerradas antes de que existiera la columna: del resto de la unidad no hay registro.
    expect(esquemaDeOtCerrada({ esquema_cierre: null }, FILAS_OT)).toEqual({
      completo: false,
      antes: { ddi: { id: 7, fuego: 'VIEJA' } },
      despues: { ddi: { id: 50, fuego: 'NUEVA' }, ddd: { id: 51, fuego: 'OTRA' } },
    });
  });

  test('una OT vieja sin cubiertas no tiene nada que mostrar, y no inventa', () => {
    expect(esquemaDeOtCerrada({}, [])).toEqual({ completo: false, antes: {}, despues: {} });
  });

  test('un esquema guardado ilegible se trata como si no estuviera', () => {
    expect(esquemaDeOtCerrada({ esquema_cierre: '{roto' }, FILAS_OT).completo).toBe(false);
    expect(esquemaDeOtCerrada({ esquema_cierre: { otra: 'cosa' } }, FILAS_OT).completo).toBe(false);
  });

  test('ignora las filas sin posición', () => {
    expect(esquemaDeOtCerrada({}, [{ id: 1, fuego: 'X', posicion: null }]).despues).toEqual({});
  });
});

// ─── consultasDeCierre ────────────────────────────────────────
describe('consultasDeCierre', () => {
  const paso = ({ texto }) => {
    if (texto.startsWith('UPDATE cubiertas SET micro_id = NULL')) return 'salen';
    if (texto.startsWith('UPDATE cubiertas SET posicion = NULL')) return 'sueltan';
    if (texto.startsWith('UPDATE cubiertas SET micro_id = ?')) return 'entra';
    if (texto.startsWith('UPDATE ot_cubiertas SET cubierta_anterior_id')) return 'anterior';
    if (texto.startsWith('INSERT INTO cubierta_eventos')) return 'evento';
    return texto;
  };
  const montadas = [enUnidad(1, 'tie'), enUnidad(2, 'tde'), enUnidad(3, 'ddi')];
  const filas = [montadaAca(1, 'tde', 'tie'), montadaAca(2, 'tie', 'tde'), libre(50, 'ddi')];

  test('no ejecuta nada: devuelve las consultas para la transacción del cierre', () => {
    const plan = planificarCierre({ ot: OT, km: 10, filas, montadas });
    const lote = consultasDeCierre(plan, { ot: OT, destinoEsCeamse: false, destinoAlmacenId: 2 });
    expect(lote).toHaveLength(sql.mock.calls.length);
    expect(sql.transaction).not.toHaveBeenCalled();
  });

  test('orden: salen, sueltan su lugar las que rotan, entran, anterior real, historial', () => {
    // Soltar antes de colocar es lo que deja pasar un intercambio A↔B sin que haya,
    // ni por un instante, dos cubiertas en el mismo lugar (índice único).
    const plan = planificarCierre({ ot: OT, km: 10, filas, montadas });
    consultasDeCierre(plan, { ot: OT, destinoEsCeamse: false, destinoAlmacenId: 2 });
    expect(llamadas().map(paso)).toEqual([
      'salen', 'sueltan', 'entra', 'entra', 'entra', 'anterior', 'anterior', 'anterior',
      ...Array(plan.eventos.length).fill('evento'),
    ]);
  });

  test('las salientes van al almacén elegido, solo si siguen en esta unidad', () => {
    const plan = planificarCierre({ ot: OT, km: 10, filas, montadas });
    consultasDeCierre(plan, { ot: OT, destinoEsCeamse: false, destinoAlmacenId: 2 });
    const salen = llamadas().find(l => paso(l) === 'salen');
    expect(salen.valores).toEqual([2, [3], UNIDAD]);
    expect(salen.texto).toContain('AND micro_id = ?');
    expect(salen.texto).not.toContain('activo = 0');
  });

  test('con CEAMSE las salientes quedan dadas de baja y sin almacén', () => {
    const plan = planificarCierre({ ot: OT, km: 10, destinoEsCeamse: true, filas, montadas });
    consultasDeCierre(plan, { ot: OT, destinoEsCeamse: true, destinoAlmacenId: null });
    const salen = llamadas().find(l => paso(l) === 'salen');
    expect(salen.texto).toContain('almacen_id = NULL, activo = 0');
    expect(salen.valores).toEqual([[3], UNIDAD]);
  });

  test('cada entrante queda en su posición, fuera de todo almacén o gomería', () => {
    const plan = planificarCierre({ ot: OT, km: 10, filas: [libre(50, 'ddi')], montadas: [] });
    consultasDeCierre(plan, { ot: OT, destinoEsCeamse: false, destinoAlmacenId: 2 });
    const entra = llamadas().find(l => paso(l) === 'entra');
    expect(entra.texto).toContain('almacen_id = NULL, gomeria_id = NULL');
    expect(entra.valores).toEqual([UNIDAD, 'ddi', 50]);
  });

  test('sin salientes ni rotadas no arma esas consultas', () => {
    const plan = planificarCierre({ ot: OT, km: 10, filas: [libre(50, 'ddi')], montadas: [] });
    consultasDeCierre(plan, { ot: OT, destinoEsCeamse: false, destinoAlmacenId: 2 });
    expect(llamadas().map(paso)).toEqual(['entra', 'anterior', 'evento']);
  });

  test('una OT sin cubiertas no arma ninguna consulta', () => {
    const plan = planificarCierre({ ot: OT, km: 10, filas: [], montadas });
    expect(consultasDeCierre(plan, { ot: OT, destinoEsCeamse: false, destinoAlmacenId: 2 })).toEqual([]);
  });
});

// ─── normalizarCambios ────────────────────────────────────────
describe('normalizarCambios', () => {
  const rechazo = (json) => {
    try { normalizarCambios(json); } catch (e) { return e; }
    return null;
  };

  test.each([undefined, null, ''])('%p → null: el formulario no mandó cubiertas', (valor) => {
    expect(normalizarCambios(valor)).toBeNull();
  });

  test('{} → objeto vacío: la OT quedó sin cubiertas, que no es lo mismo', () => {
    expect(normalizarCambios('{}')).toEqual({});
  });

  test('pasa los ids a número y descarta las posiciones sin cubierta', () => {
    expect(normalizarCambios('{"ddi":"12","ddd":null,"tie":0,"tde":7}')).toEqual({ ddi: 12, tde: 7 });
  });

  test('acepta las doce posiciones del sistema', () => {
    const todas = Object.fromEntries(POSICIONES.map((p, i) => [p, i + 1]));
    expect(Object.keys(normalizarCambios(JSON.stringify(todas)))).toEqual(POSICIONES);
    expect(POSICIONES).toHaveLength(12);
  });

  test('la misma cubierta en dos posiciones → 400 que nombra las dos', () => {
    const e = rechazo('{"ddi":5,"tie":5}');
    expect(e.status).toBe(400);
    expect(e.message).toContain('Del. Izq.');
    expect(e.message).toContain('Tras. Izq. Ext.');
  });

  test.each([
    ['una posición que no existe', '{"xyz":5}'],
    ['JSON roto', '{no es json'],
    ['un array', '[1,2]'],
    ['un número', '5'],
  ])('%s → 400, ya no se ignora en silencio', (_caso, json) => {
    expect(rechazo(json)).toMatchObject({ status: 400 });
  });
});

// ─── validarCubiertasDeOt ─────────────────────────────────────
describe('validarCubiertasDeOt', () => {
  const ELEGIDAS = 'c.activo, c.micro_id, m.unidad';
  const OCUPANTES = 'SELECT id, posicion FROM cubiertas';
  const cub = (id, fuego, extra = {}) => ({ id, fuego, activo: 1, micro_id: null, unidad: null, ...extra });

  test('sin cubiertas no consulta la base', async () => {
    await expect(validarCubiertasDeOt({ unidadId: UNIDAD, cambios: {} })).resolves.toEqual([]);
    expect(sql).not.toHaveBeenCalled();
  });

  test('arma una fila por posición con la que hoy ocupa ese lugar', async () => {
    baseCon([[ELEGIDAS, [cub(10, '14291'), cub(11, '14290')]], [OCUPANTES, [{ id: 77, posicion: 'ddi' }]]]);
    const filas = await validarCubiertasDeOt({ unidadId: UNIDAD, cambios: { ddi: 10, ddd: 11 } });
    expect(filas).toEqual([
      { posicion: 'ddi', cubierta_id: 10, anterior_id: 77 },
      { posicion: 'ddd', cubierta_id: 11, anterior_id: null },
    ]);
  });

  test('una cubierta no es "anterior" de sí misma', async () => {
    // OT 593: quedó anotado anterior = entrante y el cierre lo tomó por rotación.
    baseCon([[ELEGIDAS, [cub(10, '13574', { micro_id: UNIDAD })]], [OCUPANTES, [{ id: 10, posicion: 'ddi' }]]]);
    const filas = await validarCubiertasDeOt({ unidadId: UNIDAD, cambios: { ddi: 10 } });
    expect(filas[0].anterior_id).toBeNull();
  });

  test('acepta una cubierta montada en esta misma unidad (rotación)', async () => {
    baseCon([[ELEGIDAS, [cub(10, '14292', { micro_id: UNIDAD, unidad: '5074' })]]]);
    await expect(validarCubiertasDeOt({ unidadId: UNIDAD, cambios: { tde: 10 } })).resolves.toHaveLength(1);
  });

  test('rechaza una cubierta montada en otra unidad y dice en cuál', async () => {
    baseCon([[ELEGIDAS, [cub(10, '7074', { micro_id: 153, unidad: '153' })]]]);
    await expect(validarCubiertasDeOt({ unidadId: UNIDAD, cambios: { ddi: 10 } }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/7074.*unidad 153/) });
  });

  test('rechaza una cubierta dada de baja', async () => {
    baseCon([[ELEGIDAS, [cub(10, '9000', { activo: 0 })]]]);
    await expect(validarCubiertasDeOt({ unidadId: UNIDAD, cambios: { ddi: 10 } }))
      .rejects.toMatchObject({ status: 400 });
  });

  test('rechaza una cubierta que no existe', async () => {
    baseCon([[ELEGIDAS, []]]);
    await expect(validarCubiertasDeOt({ unidadId: UNIDAD, cambios: { ddi: 999 } }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('#999') });
  });

  test('con cubiertas pero sin unidad → 400', async () => {
    await expect(validarCubiertasDeOt({ unidadId: null, cambios: { ddi: 10 } }))
      .rejects.toMatchObject({ status: 400 });
    expect(sql).not.toHaveBeenCalled();
  });

  test('no escribe nada: solo lee', async () => {
    baseCon([[ELEGIDAS, [cub(10, '14291')]]]);
    await validarCubiertasDeOt({ unidadId: UNIDAD, cambios: { ddi: 10 } });
    expect(llamadas().every(l => l.texto.startsWith('SELECT'))).toBe(true);
    expect(sql.transaction).not.toHaveBeenCalled();
  });
});

// ─── guardarCubiertasDeOt ─────────────────────────────────────
describe('guardarCubiertasDeOt', () => {
  const filas = [
    { posicion: 'ddi', cubierta_id: 10, anterior_id: 77 },
    { posicion: 'ddd', cubierta_id: 11, anterior_id: null },
  ];

  test('reemplaza el juego en una sola transacción: primero borra, después inserta', async () => {
    await guardarCubiertasDeOt({ otId: 592, filas });

    expect(sql.transaction).toHaveBeenCalledTimes(1);
    expect(sql.transaction.mock.calls[0][0]).toHaveLength(3);
    expect(llamadas().map(l => l.texto.split(' ').slice(0, 3).join(' '))).toEqual([
      'DELETE FROM ot_cubiertas', 'INSERT INTO ot_cubiertas', 'INSERT INTO ot_cubiertas',
    ]);
    expect(llamadas()[1].valores).toEqual([592, 10, 'ddi', 77]);
    expect(llamadas()[2].valores).toEqual([592, 11, 'ddd', null]);
  });

  test('el borrado es de esa OT y respeta las filas sin posición', async () => {
    await guardarCubiertasDeOt({ otId: 592, filas });
    expect(llamadas()[0]).toEqual({
      texto: 'DELETE FROM ot_cubiertas WHERE ot_id = ? AND posicion IS NOT NULL', valores: [592],
    });
  });

  test('sin filas igual borra: la OT quedó sin cubiertas', async () => {
    await guardarCubiertasDeOt({ otId: 592, filas: [] });
    expect(llamadas().map(l => l.texto.split(' ')[0])).toEqual(['DELETE']);
  });

  test('si la transacción falla, el error llega a quien llama', async () => {
    sql.transaction.mockRejectedValueOnce(new Error('se cayó la conexión'));
    await expect(guardarCubiertasDeOt({ otId: 592, filas })).rejects.toThrow('se cayó la conexión');
  });
});

// ─── leerEstadoParaCierre ─────────────────────────────────────
describe('leerEstadoParaCierre', () => {
  test('lee las filas de la OT y lo montado hoy en la unidad', async () => {
    baseCon([['posicion_actual', [libre(50, 'ddi')]], ['SELECT id, fuego, posicion FROM cubiertas', [enUnidad(7, 'ddi')]]]);
    const estado = await leerEstadoParaCierre(OT);
    expect(estado).toEqual({ filas: [libre(50, 'ddi')], montadas: [enUnidad(7, 'ddi')] });
    expect(llamadas().map(l => l.valores)).toEqual([[592], [UNIDAD]]);
  });

  test('solo mira cubiertas activas y con posición', async () => {
    await leerEstadoParaCierre(OT);
    expect(llamadas()[1].texto).toContain('activo = 1 AND posicion IS NOT NULL');
  });

  test('una OT sin unidad no tiene nada montado que mirar', async () => {
    const estado = await leerEstadoParaCierre({ id: 1, unidad_id: null });
    expect(estado.montadas).toEqual([]);
    expect(sql).toHaveBeenCalledTimes(1);
  });
});

// ─── almacenAVerificar ────────────────────────────────────────
describe('almacenAVerificar', () => {
  const BUSCA = 'SELECT id, activo FROM almacen';

  test('se llama "A VERIFICAR"', () => {
    expect(ALMACEN_A_VERIFICAR).toBe('A VERIFICAR');
  });

  test('si existe y está activo devuelve su id sin escribir nada', async () => {
    baseCon([[BUSCA, [{ id: 19, activo: 1 }]]]);
    await expect(almacenAVerificar()).resolves.toBe(19);
    expect(llamadas()).toHaveLength(1);
    expect(llamadas()[0].valores).toEqual(['A VERIFICAR']);
  });

  test('lo encuentra aunque el nombre esté en minúsculas o con espacios', async () => {
    await almacenAVerificar().catch(() => {});
    expect(llamadas()[0].texto).toContain('upper(trim(nombre)) = ?');
  });

  test('si no existe lo crea', async () => {
    baseCon([[BUSCA, []], ['INSERT INTO almacen', [{ id: 20 }]]]);
    await expect(almacenAVerificar()).resolves.toBe(20);
    expect(llamadas()[1]).toEqual({ texto: 'INSERT INTO almacen (nombre) VALUES (?) RETURNING id', valores: ['A VERIFICAR'] });
  });

  test('si estaba dado de baja lo reactiva', async () => {
    baseCon([[BUSCA, [{ id: 19, activo: 0 }]]]);
    await expect(almacenAVerificar()).resolves.toBe(19);
    expect(llamadas()[1]).toEqual({ texto: 'UPDATE almacen SET activo = 1 WHERE id = ?', valores: [19] });
  });

  test('si no se pudo crear falla, en vez de mandar las cubiertas a ningún lado', async () => {
    baseCon([[BUSCA, []], ['INSERT INTO almacen', []]]);
    await expect(almacenAVerificar()).rejects.toThrow('A VERIFICAR');
  });
});

// ─── consultaEvento / registrarEvento ─────────────────────────
describe('consultaEvento', () => {
  const evento = { cubierta_id: 50, tipo: 'colocacion', fecha: '2026-10-07', micro_id: UNIDAD, posicion: 'ddi', km_unidad: '2362', ot_id: 592, detalle: 'Entra por OT N° 592' };

  test('arma el INSERT del evento, que no se duplica si se reprocesa la OT', () => {
    consultaEvento(evento);
    const [insert] = llamadas();
    expect(insert.texto).toMatch(/^INSERT INTO cubierta_eventos .* ON CONFLICT DO NOTHING$/);
    expect(insert.valores).toEqual([50, 'colocacion', '2026-10-07', UNIDAD, 'ddi', 2362, 592, 'Entra por OT N° 592', 'sistema']);
  });

  test.each([
    ['sin evento', null],
    ['sin cubierta', { tipo: 'retiro' }],
    ['con un tipo que no existe', { cubierta_id: 1, tipo: 'paseo' }],
  ])('%s → null y no arma nada', (_caso, ev) => {
    expect(consultaEvento(ev)).toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });

  test('registrarEvento sigue insertando un evento suelto', async () => {
    await registrarEvento(evento);
    expect(llamadas().map(l => l.texto.split(' ')[0])).toEqual(['INSERT']);
  });

  test('registrarEvento no repite el alta de una cubierta', async () => {
    baseCon([["tipo = 'alta'", [{ '?column?': 1 }]]]);
    await registrarEvento({ cubierta_id: 50, tipo: 'alta' });
    expect(llamadas().map(l => l.texto.split(' ')[0])).toEqual(['SELECT']);
  });
});
