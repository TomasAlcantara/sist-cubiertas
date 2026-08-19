const { calcularTramos } = require('../lib/cubiertaHistorial');

// Los eventos llegan ya ordenados cronológicamente desde la consulta.
const ev = (tipo, fecha, micro_id, posicion, km_unidad) =>
  ({ tipo, fecha, micro_id, posicion, km_unidad, unidad: micro_id ? 'U' + micro_id : null });

describe('calcularTramos', () => {
  test('un montaje cerrado suma la diferencia de km de la unidad', () => {
    const t = calcularTramos([
      ev('colocacion', '2026-01-10', 1, 'ddi', 100000),
      ev('retiro',     '2026-03-10', 1, 'ddi', 145000),
    ], null);
    expect(t).toHaveLength(1);
    expect(t[0].km).toBe(45000);
    expect(t[0].incompleto).toBe(false);
    expect(t[0].abierto).toBe(false);
  });

  test('un montaje en curso se mide contra el km de hoy de la unidad', () => {
    const t = calcularTramos([ev('colocacion', '2026-01-10', 1, 'ddi', 100000)], 130000);
    expect(t).toHaveLength(1);
    expect(t[0].abierto).toBe(true);
    expect(t[0].km).toBe(30000);
    expect(t[0].km_hasta).toBe(130000);
  });

  test('sin km en algún extremo el tramo queda incompleto y no suma', () => {
    const t = calcularTramos([
      ev('colocacion', null,         1, 'ddi', null),
      ev('retiro',     '2026-03-10', 1, 'ddi', 145000),
    ], null);
    expect(t[0].km).toBeNull();
    expect(t[0].incompleto).toBe(true);
  });

  test('una rotación corta el tramo y abre otro sin contar km dos veces', () => {
    const t = calcularTramos([
      ev('colocacion', '2026-01-10', 1, 'ddi', 100000),
      ev('retiro',     '2026-03-10', 1, 'ddi', 145000),
      ev('colocacion', '2026-03-10', 1, 'tde', 145000),
      ev('retiro',     '2026-06-10', 1, 'tde', 160000),
    ], null);
    expect(t).toHaveLength(2);
    expect(t[0].km).toBe(45000);
    expect(t[1].km).toBe(15000);
    expect(t.reduce((a, x) => a + x.km, 0)).toBe(60000);
  });

  test('un paso por dos unidades distintas acumula ambos tramos', () => {
    const t = calcularTramos([
      ev('colocacion', '2026-01-10', 1, 'ddi', 100000),
      ev('retiro',     '2026-03-10', 1, 'ddi', 145000),
      ev('colocacion', '2026-04-01', 2, 'tie', 500000),
      ev('retiro',     '2026-05-01', 2, 'tie', 512000),
    ], null);
    expect(t.map(x => x.micro_id)).toEqual([1, 2]);
    expect(t.reduce((a, x) => a + x.km, 0)).toBe(57000);
  });

  test('un km de retiro menor al de colocación no genera km negativos', () => {
    const t = calcularTramos([
      ev('colocacion', '2026-01-10', 1, 'ddi', 145000),
      ev('retiro',     '2026-03-10', 1, 'ddi', 100000),
    ], null);
    expect(t[0].km).toBeNull();
    expect(t[0].incompleto).toBe(true);
  });

  test('una colocación sin retiro previo cierra el tramo anterior como incompleto', () => {
    const t = calcularTramos([
      ev('colocacion', '2026-01-10', 1, 'ddi', 100000),
      ev('colocacion', '2026-02-10', 2, 'tie', 200000),
    ], 260000);
    expect(t).toHaveLength(2);
    expect(t[0].incompleto).toBe(true);
    expect(t[0].km).toBeNull();
    expect(t[1].km).toBe(60000);
  });

  test('un retiro huérfano no abre ningún tramo', () => {
    expect(calcularTramos([ev('retiro', '2026-03-10', 1, 'ddi', 145000)], null)).toHaveLength(0);
  });

  test('los eventos que no son montaje no afectan los tramos', () => {
    const t = calcularTramos([
      ev('alta',       '2026-01-01', null, null, null),
      ev('colocacion', '2026-01-10', 1, 'ddi', 100000),
      ev('reparacion', '2026-02-01', 1, 'ddi', 120000),
      ev('retiro',     '2026-03-10', 1, 'ddi', 145000),
    ], null);
    expect(t).toHaveLength(1);
    expect(t[0].km).toBe(45000);
  });

  test('sin eventos no hay tramos', () => {
    expect(calcularTramos([], 1000)).toEqual([]);
  });

  test('un montaje en curso sin km de la unidad queda incompleto', () => {
    const t = calcularTramos([ev('colocacion', '2026-01-10', 1, 'ddi', 100000)], null);
    expect(t[0].abierto).toBe(true);
    expect(t[0].km).toBeNull();
    expect(t[0].incompleto).toBe(true);
  });
});
