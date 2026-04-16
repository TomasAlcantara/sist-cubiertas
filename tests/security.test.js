/**
 * Tests de seguridad HTTP
 *
 * Verifica que los headers de seguridad estén presentes,
 * que el rate limiting funcione y que el error handler no filtre info.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => {
  const fn = jest.fn().mockResolvedValue([]);
  return { sql: fn };
});

const app = require('../api/index');

function makeToken(payload = {}) {
  return jwt.sign(
    { id: 1, usuario: 'test', tipo: 1, nombre: 'Test', ...payload },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ─── Headers de seguridad (helmet) ──────────────────────────
describe('Headers de seguridad HTTP', () => {
  test('X-Frame-Options presente', async () => {
    const res = await request(app).get('/login');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-frame-options'].toUpperCase()).toBe('DENY');
  });

  test('X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/login');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('Content-Security-Policy presente', async () => {
    const res = await request(app).get('/login');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  test('X-Powered-By eliminado (no expone Express)', async () => {
    const res = await request(app).get('/login');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

// ─── Error handler ────────────────────────────────────────────
describe('Error handler global', () => {
  test('ruta inexistente devuelve 404', async () => {
    const res = await request(app).get('/ruta-que-no-existe-xxxx');
    expect(res.status).toBe(404);
  });

  test('404 no expone stack trace', async () => {
    const res = await request(app).get('/ruta-que-no-existe-xxxx');
    expect(res.text).not.toMatch(/Error: .* at /); // no stack trace
    expect(res.text).not.toContain('node_modules');
  });
});

// ─── DB falla → error controlado ─────────────────────────────
describe('Cuando la DB falla', () => {
  const { sql } = require('../db');

  test('GET /cubiertas con DB caída → 500 sin stack trace', async () => {
    sql.mockRejectedValueOnce(new Error('Connection refused'));
    const res = await request(app)
      .get('/cubiertas')
      .set('Cookie', `token=${makeToken()}`);
    // Debe devolver 500 o redirigir (no quedar colgado ni exponer stack)
    expect([500, 302]).toContain(res.status);
    if (res.status === 500) {
      expect(res.text).not.toContain('Connection refused');
      expect(res.text).not.toContain('node_modules');
    }
  });

  test('POST /login con DB caída → error amigable, no 500 con stack', async () => {
    sql.mockRejectedValueOnce(new Error('DB timeout'));
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ usr: 'admin', pass: '123' });
    // Auth tiene try/catch propio que renderiza 'Error del servidor'
    expect(res.status).toBeLessThanOrEqual(500);
    expect(res.text).not.toContain('DB timeout');
  });
});

// ─── AJAX: whitelist de tablas ────────────────────────────────
describe('POST /ajax/inactive — whitelist de tabla', () => {
  const { sql } = require('../db');

  test('tabla no permitida → 400', async () => {
    const res = await request(app)
      .post('/ajax/inactive')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ id: 1, active: 0, table: 'ots' }); // ots no está en whitelist
    expect(res.status).toBe(400);
  });

  test('tabla no permitida con SQL injection → 400', async () => {
    const res = await request(app)
      .post('/ajax/inactive')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ id: 1, active: 0, table: "usuarios; DROP TABLE cubiertas;--" });
    expect(res.status).toBe(400);
  });

  test('tabla permitida (cubiertas) → llama a DB y responde ok', async () => {
    sql.mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/ajax/inactive')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ id: 1, active: 0, table: 'cubiertas' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  test('sin sesión → redirige a /login', async () => {
    const res = await request(app)
      .post('/ajax/inactive')
      .type('form')
      .send({ id: 1, active: 0, table: 'cubiertas' });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });
});

// ─── AJAX: anular OT solo para Master ─────────────────────────
describe('POST /ajax/anular_ot — solo tipo Master', () => {
  test('usuario tipo Gomería → redirige (sin acceso)', async () => {
    const tokenGomeria = makeToken({ tipo: 0 });
    const res = await request(app)
      .post('/ajax/anular_ot')
      .set('Cookie', `token=${tokenGomeria}`)
      .type('form')
      .send({ ot_id: 1 });
    expect(res.status).toBe(302);
  });
});

// ─── express-validator: save_usuario ──────────────────────────
describe('POST /ajax/save_usuario — validación de inputs', () => {
  test('usuario vacío → 400', async () => {
    const res = await request(app)
      .post('/ajax/save_usuario')
      .set('Cookie', `token=${makeToken({ tipo: 1 })}`)
      .type('form')
      .send({ usuario: '', tipo: '1', nombre: 'Test' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/requerido/i);
  });

  test('tipo fuera de rango (9) → 400', async () => {
    const res = await request(app)
      .post('/ajax/save_usuario')
      .set('Cookie', `token=${makeToken({ tipo: 1 })}`)
      .type('form')
      .send({ usuario: 'testuser', tipo: '9', nombre: 'Test' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/tipo/i);
  });

  test('mail con formato inválido → 400', async () => {
    const res = await request(app)
      .post('/ajax/save_usuario')
      .set('Cookie', `token=${makeToken({ tipo: 1 })}`)
      .type('form')
      .send({ usuario: 'testuser', tipo: '1', mail: 'no-es-un-email' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/email/i);
  });

  test('usuario con caracteres inválidos → 400', async () => {
    const res = await request(app)
      .post('/ajax/save_usuario')
      .set('Cookie', `token=${makeToken({ tipo: 1 })}`)
      .type('form')
      .send({ usuario: '<script>alert(1)</script>', tipo: '1' });
    expect(res.status).toBe(400);
  });
});

// ─── express-validator: nueva cubierta ────────────────────────
describe('POST /cubiertas/nuevo — validación de inputs', () => {
  test('fuego vacío → redirige con error', async () => {
    const res = await request(app)
      .post('/cubiertas/nuevo')
      .set('Cookie', `token=${makeToken({ tipo: 1 })}`)
      .type('form')
      .send({ fuego: '', estado: '1', km: '0', cantidad: '1' });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toMatch(/error=/);
  });

  test('estado inválido (99) → redirige con error', async () => {
    const res = await request(app)
      .post('/cubiertas/nuevo')
      .set('Cookie', `token=${makeToken({ tipo: 1 })}`)
      .type('form')
      .send({ fuego: 'TEST001', estado: '99', km: '0', cantidad: '1' });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toMatch(/error=/);
  });

  test('cantidad fuera de rango (999) → redirige con error', async () => {
    const res = await request(app)
      .post('/cubiertas/nuevo')
      .set('Cookie', `token=${makeToken({ tipo: 1 })}`)
      .type('form')
      .send({ fuego: 'TEST001', estado: '1', km: '0', cantidad: '999' });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toMatch(/error=/);
  });
});
