/**
 * Tests de lib/fechas.js
 *
 * Corren en UTC (ver tests/globalSetup.js), igual que el runtime de Vercel: es
 * la única zona donde estos bugs se ven. En la máquina del desarrollador, en
 * horario argentino, varios de estos casos pasan aunque el código esté mal.
 */
const {
  parseFecha, hoyISO, hoyAR,
  fmtFecha, fmtFechaHora, fmtHora, tieneHora, fmtDuracion,
} = require('../lib/fechas');

// El driver de Neon parsea una columna DATE como medianoche de la zona del
// proceso — en Vercel, medianoche UTC. Así es como llega `ots.fecha` a la vista.
const columnaDate = (iso) => {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d);
};

describe('el proceso corre en UTC', () => {
  test('globalSetup fijó la zona', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
  });
});

describe('fmtFecha — el día que se abre la OT', () => {
  // Este es el bug que reportó el taller: la lista mostraba un día antes.
  test('una columna DATE se muestra en su propio día, no el anterior', () => {
    expect(fmtFecha(columnaDate('2026-08-25'))).toBe('25/8/2026');
    expect(fmtFecha(columnaDate('2026-01-01'))).toBe('1/1/2026');
    expect(fmtFecha(columnaDate('2026-12-31'))).toBe('31/12/2026');
  });

  test('un ISO en texto se muestra igual, sin convertir', () => {
    expect(fmtFecha('2026-08-25')).toBe('25/8/2026');
    expect(fmtFecha('2026-08-25T14:30:00Z')).toBe('25/8/2026');
  });

  test('sin fecha devuelve guión', () => {
    expect(fmtFecha(null)).toBe('-');
    expect(fmtFecha('')).toBe('-');
    expect(fmtFecha('cualquier cosa')).toBe('-');
  });
});

describe('fmtFechaHora — hora de entrada y de salida', () => {
  test('un timestamp real muestra fecha y hora argentina', () => {
    // 25/8/2026 11:47 UTC = 08:47 en Argentina (UTC-3)
    expect(fmtFechaHora('2026-08-25T11:47:00Z')).toBe('25/8/2026 08:47');
  });

  test('cruza el día hacia atrás cuando corresponde', () => {
    // 26/8 01:30 UTC todavía es 25/8 22:30 en Argentina
    expect(fmtFechaHora('2026-08-26T01:30:00Z')).toBe('25/8/2026 22:30');
  });

  test('una OT backfilleada (medianoche argentina) muestra solo la fecha', () => {
    // Lo que deja db/migrate_cierre_ot.js: medianoche AR = 03:00 UTC
    expect(fmtFechaHora('2026-08-25T03:00:00Z')).toBe('25/8/2026');
  });

  test('sin dato devuelve guión', () => {
    expect(fmtFechaHora(null)).toBe('-');
  });
});

describe('tieneHora — distinguir hora real de backfill', () => {
  test('un cierre real tiene hora', () => {
    expect(tieneHora('2026-08-25T11:47:00Z')).toBe(true);
  });

  test('una OT backfilleada a medianoche argentina no tiene hora', () => {
    expect(tieneHora('2026-08-25T03:00:00Z')).toBe(false);
  });

  test('sin dato no tiene hora', () => {
    expect(tieneHora(null)).toBe(false);
  });
});

describe('fmtHora', () => {
  test('devuelve la hora argentina', () => {
    expect(fmtHora('2026-08-25T11:47:00Z')).toBe('08:47');
  });

  test('un backfill no inventa una hora', () => {
    expect(fmtHora('2026-08-25T03:00:00Z')).toBe('-');
  });
});

describe('fmtDuracion — cuánto tardó el trabajo', () => {
  const ingreso = '2026-08-25T11:00:00Z';

  test('menos de una hora, en minutos', () => {
    expect(fmtDuracion(ingreso, '2026-08-25T11:45:00Z')).toBe('45 min');
  });

  test('horas exactas, sin minutos colgando', () => {
    expect(fmtDuracion(ingreso, '2026-08-25T13:00:00Z')).toBe('2 h');
  });

  test('horas con minutos', () => {
    expect(fmtDuracion(ingreso, '2026-08-25T13:15:00Z')).toBe('2 h 15 min');
  });

  test('más de un día', () => {
    expect(fmtDuracion(ingreso, '2026-08-28T15:00:00Z')).toBe('3 d 4 h');
    expect(fmtDuracion(ingreso, '2026-08-28T11:00:00Z')).toBe('3 d');
  });

  test('no calcula duración si el ingreso es un backfill sin hora real', () => {
    expect(fmtDuracion('2026-08-25T03:00:00Z', '2026-08-25T15:00:00Z')).toBeNull();
  });

  test('no calcula duración si falta alguno de los dos extremos', () => {
    expect(fmtDuracion(ingreso, null)).toBeNull();
    expect(fmtDuracion(null, ingreso)).toBeNull();
  });

  test('un cierre anterior al ingreso no devuelve una duración negativa', () => {
    expect(fmtDuracion(ingreso, '2026-08-25T09:00:00Z')).toBeNull();
  });
});

describe('parseFecha — lo que llega del datepicker', () => {
  test('DD/MM/AAAA a ISO', () => {
    expect(parseFecha('25/08/2026')).toBe('2026-08-25');
    expect(parseFecha('5/8/2026')).toBe('2026-08-05');
  });

  test('año de dos dígitos', () => {
    expect(parseFecha('25/08/26')).toBe('2026-08-25');
  });

  test('vacío devuelve null', () => {
    expect(parseFecha('')).toBeNull();
    expect(parseFecha(null)).toBeNull();
  });
});

describe('hoyISO / hoyAR — el "hoy" del taller, no el del servidor', () => {
  // A las 02:00 UTC en Argentina todavía es el día anterior. El sistema tiene
  // que guardar y prellenar el día argentino, no el del runtime.
  const real = Date.now;
  afterEach(() => { Date.now = real; });

  test('de madrugada UTC devuelve el día argentino', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T02:00:00Z'));
    expect(hoyISO()).toBe('2026-08-24');
    expect(hoyAR()).toBe('24/08/2026');
    jest.useRealTimers();
  });

  test('de tarde UTC coinciden', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T18:00:00Z'));
    expect(hoyISO()).toBe('2026-08-25');
    expect(hoyAR()).toBe('25/08/2026');
    jest.useRealTimers();
  });
});
