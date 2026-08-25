/**
 * Tests del log de auditoría.
 *
 * Lo que se verifica acá no es que el log "funcione" sino sus dos garantías:
 * que nunca rompa la operación auditada, y que nunca guarde secretos.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => {
  const fn = jest.fn().mockResolvedValue([]);
  return { sql: fn, sanitizeFuego: (s) => String(s || '').trim(), nextFuego: (b, i) => b + i };
});

jest.mock('../lib/mailer', () => ({ enviarAvisoPinchadura: jest.fn().mockResolvedValue(undefined) }));

const { sql } = require('../db');
const auditoria = require('../lib/auditoria');
const app = require('../api/index');

const token = (permisos = 'admin,ot_anular,ot_crear,km_cargar,cubiertas_editar') =>
  jwt.sign({ id: 1, usuario: 'tester', tipo: 1, nombre: 'T', permisos },
    process.env.JWT_SECRET, { expiresIn: '1h' });

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockResolvedValue([]);
});

// ─── Garantía 1: el log no puede romper nada ──────────────────
describe('registrar() nunca lanza', () => {
  test('si el INSERT falla, resuelve igual', async () => {
    sql.mockRejectedValue(new Error('conexión caída'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      auditoria.registrar({ accion: 'crear', entidad: 'ot', entidad_id: 1 })
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('sin req (scripts) no explota', async () => {
    await expect(auditoria.registrar({ accion: 'crear', entidad: 'ot' })).resolves.toBeUndefined();
  });

  test('sin accion o entidad no inserta', async () => {
    await auditoria.registrar({ accion: 'crear' });
    await auditoria.registrar({ entidad: 'ot' });
    expect(sql).not.toHaveBeenCalled();
  });

  test('una OT se crea aunque el log falle', async () => {
    // El INSERT de la OT devuelve id; cualquier INSERT en auditoria falla
    sql.mockImplementation((q) => {
      const t = Array.isArray(q) ? q.join(' ') : String(q);
      if (t.includes('INSERT INTO auditoria')) return Promise.reject(new Error('log caído'));
      if (t.includes('INSERT INTO ots')) return Promise.resolve([{ id: 500 }]);
      return Promise.resolve([]);
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${token()}`)
      .type('form')
      .send({ fecha: '20/08/2026', unidad_id: 1, cambio: '1', pinchadura: '0', rotura: '0' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('500');
    spy.mockRestore();
  });
});

// ─── Garantía 2: nada de secretos ─────────────────────────────
describe('nunca guarda secretos', () => {
  test('diff enmascara campos sensibles', () => {
    const d = auditoria.diff(
      { password: 'vieja', token: 'abc', gmail_app_password: 'x', usuario: 'juan' },
      { password: 'nueva', token: 'def', gmail_app_password: 'y', usuario: 'pedro' }
    );
    const porCampo = Object.fromEntries(d.map(x => [x.campo, x]));
    expect(porCampo.password.despues).toBe('***');
    expect(porCampo.token.despues).toBe('***');
    expect(porCampo.gmail_app_password.despues).toBe('***');
    // Lo que no es secreto sí se guarda
    expect(porCampo.usuario.antes).toBe('juan');
    expect(porCampo.usuario.despues).toBe('pedro');
  });

  test('snapshot enmascara igual', () => {
    expect(auditoria.snapshot({ id: 1, password: 'x', fuego: '99' }))
      .toEqual({ id: 1, password: '***', fuego: '99' });
  });

  test('el hash de contraseña no llega al log al editar un usuario', async () => {
    sql.mockImplementation((q) => {
      const t = Array.isArray(q) ? q.join(' ') : String(q);
      if (t.includes('SELECT * FROM usuarios')) {
        return Promise.resolve([{ id: 7, usuario: 'juan', password: '$2a$10$hashviejo', tipo: 0, permisos: 'ot_ver' }]);
      }
      return Promise.resolve([]);
    });
    await request(app)
      .post('/ajax/save_usuario')
      .set('Cookie', `token=${token()}`)
      .type('form')
      .send({ id: 7, usuario: 'juan', password: 'nuevaclave', tipo: 0, permisos: 'ot_ver,ot_crear' });

    const ins = sql.mock.calls.find(c => String(c[0]).includes('INSERT INTO auditoria'));
    const json = JSON.stringify(ins.slice(1));
    expect(json).not.toContain('nuevaclave');
    expect(json).not.toContain('$2a$10$');
    expect(json).toContain('***');
    // Pero sí queda constancia de que cambió
    expect(json).toContain('cambiada');
  });

  test('el login fallido no registra la contraseña tecleada', async () => {
    sql.mockResolvedValue([]); // usuario inexistente
    await request(app).post('/login').type('form').send({ usr: 'atacante', pass: 'intento-secreto' });
    const ins = sql.mock.calls.find(c => String(c[0]).includes('INSERT INTO auditoria'));
    expect(JSON.stringify(ins.slice(1))).not.toContain('intento-secreto');
    expect(JSON.stringify(ins.slice(1))).toContain('atacante');
  });
});

// ─── Baja lógica de OTs ───────────────────────────────────────
describe('anular_ot — baja lógica, no DELETE', () => {
  const conOT = (ot) => sql.mockImplementation((q) => {
    const t = Array.isArray(q) ? q.join(' ') : String(q);
    if (t.includes('FROM ots')) return Promise.resolve([ot]);
    return Promise.resolve([]);
  });

  test('no ejecuta ningún DELETE', async () => {
    conOT({ id: 3, anulada: false, unidad_id: 5, fecha: '2026-08-20' });
    const res = await request(app)
      .post('/ajax/anular_ot')
      .set('Cookie', `token=${token()}`)
      .type('form')
      .send({ ot_id: 3, motivo: 'cargada en la unidad equivocada' });
    expect(res.status).toBe(200);
    const queries = sql.mock.calls.map(c => (Array.isArray(c[0]) ? c[0].join(' ') : String(c[0])));
    expect(queries.some(q => q.includes('DELETE'))).toBe(false);
    expect(queries.some(q => q.includes('UPDATE ots SET') && q.includes('anulada'))).toBe(true);
  });

  test('sin motivo → 400 y no toca la OT', async () => {
    conOT({ id: 3, anulada: false });
    const res = await request(app)
      .post('/ajax/anular_ot')
      .set('Cookie', `token=${token()}`)
      .type('form')
      .send({ ot_id: 3, motivo: '   ' });
    expect(res.status).toBe(400);
    expect(sql).not.toHaveBeenCalled();
  });

  test('OT ya anulada → 400', async () => {
    conOT({ id: 3, anulada: true });
    const res = await request(app)
      .post('/ajax/anular_ot')
      .set('Cookie', `token=${token()}`)
      .type('form')
      .send({ ot_id: 3, motivo: 'otra vez' });
    expect(res.status).toBe(400);
  });

  test('el log guarda copia de lo que tenía la OT', async () => {
    conOT({ id: 3, anulada: false, unidad_id: 5, fecha: '2026-08-20', cambio: true, observaciones: 'algo' });
    await request(app)
      .post('/ajax/anular_ot')
      .set('Cookie', `token=${token()}`)
      .type('form')
      .send({ ot_id: 3, motivo: 'duplicada' });
    const ins = sql.mock.calls.find(c => String(c[0]).includes('INSERT INTO auditoria'));
    const json = JSON.stringify(ins.slice(1));
    expect(json).toContain('copia');
    expect(json).toContain('duplicada');
  });

  test('restaurar exige que esté anulada', async () => {
    conOT({ id: 3, anulada: false });
    const res = await request(app)
      .post('/ajax/restaurar_ot')
      .set('Cookie', `token=${token()}`)
      .type('form')
      .send({ ot_id: 3 });
    expect(res.status).toBe(400);
  });
});

// ─── Atribución ───────────────────────────────────────────────
describe('atribución de usuario', () => {
  test('el movimiento queda a nombre de quien lo hizo', async () => {
    sql.mockResolvedValue([{ id: 1, unidad: '101', km_actual: 200000 }]);
    await request(app)
      .post('/ajax/cargar_km')
      .set('Cookie', `token=${token()}`)
      .type('form')
      .send({ id: 1, km: 250000 });
    const ins = sql.mock.calls.find(c => String(c[0]).includes('INSERT INTO auditoria'));
    expect(ins.slice(1)).toContain('tester');
    expect(JSON.stringify(ins.slice(1))).toContain('250000');
  });

  test('el viewer del log exige permiso de administración', async () => {
    const res = await request(app)
      .get('/admin/auditoria')
      .set('Cookie', `token=${token('ot_ver')}`);
    expect(res.status).toBe(302);
  });
});
