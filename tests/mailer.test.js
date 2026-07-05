/**
 * Tests del módulo de mail (lib/mailer.js)
 *
 * Verifica que la config se lea de la tabla `config` de la DB con fallback
 * a env vars, y que sin credenciales el envío se omita sin romper.
 */
jest.mock('../db', () => {
  const fn = jest.fn().mockResolvedValue([]);
  return { sql: fn };
});

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const nodemailer = require('nodemailer');
const { sql } = require('../db');
const { enviarAvisoPinchadura } = require('../lib/mailer');

const ENV_KEYS = ['GMAIL_USER', 'GMAIL_APP_PASSWORD', 'MAIL_PINCHADURA_TO', 'APP_BASE_URL', 'VERCEL_URL'];
let envBackup;

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockResolvedValue([]);
  envBackup = {};
  for (const k of ENV_KEYS) { envBackup[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

test('sin credenciales (ni DB ni env) → no envía y no explota', async () => {
  await enviarAvisoPinchadura({ otId: 1 });
  expect(nodemailer.createTransport).not.toHaveBeenCalled();
});

test('con credenciales en la tabla config → envía al destinatario configurado', async () => {
  sql.mockResolvedValue([
    { clave: 'gmail_user', valor: 'envia@gmail.com' },
    { clave: 'gmail_app_password', valor: 'abcdefghijklmnop' },
    { clave: 'mail_pinchadura_to', valor: 'sv@masterbus.net' },
    { clave: 'app_base_url', valor: 'https://sist-cubiertas.vercel.app' },
  ]);
  const sendMail = jest.fn().mockResolvedValue({});
  nodemailer.createTransport.mockReturnValue({ sendMail });

  await enviarAvisoPinchadura({ otId: 7, unidad: '123', trabajos: { cambio: '1' } });

  expect(sendMail).toHaveBeenCalledTimes(1);
  const msg = sendMail.mock.calls[0][0];
  expect(msg.to).toBe('sv@masterbus.net');
  expect(msg.from).toContain('envia@gmail.com');
  expect(msg.subject).toContain('OT N° 7');
  expect(msg.subject).toContain('123');
  expect(msg.text).toContain('https://sist-cubiertas.vercel.app/OTs/ver?ot=7');
});

test('si la tabla config no existe → cae a env vars', async () => {
  sql.mockRejectedValue(new Error('relation "config" does not exist'));
  process.env.GMAIL_USER = 'env@gmail.com';
  process.env.GMAIL_APP_PASSWORD = 'pass';
  const sendMail = jest.fn().mockResolvedValue({});
  nodemailer.createTransport.mockReturnValue({ sendMail });

  await enviarAvisoPinchadura({ otId: 9 });

  expect(sendMail).toHaveBeenCalledTimes(1);
  expect(sendMail.mock.calls[0][0].from).toContain('env@gmail.com');
  expect(sendMail.mock.calls[0][0].to).toBe('sv@masterbus.net'); // default
});

test('el parámetro para pisa al destinatario configurado (test_mail.js)', async () => {
  sql.mockResolvedValue([
    { clave: 'gmail_user', valor: 'envia@gmail.com' },
    { clave: 'gmail_app_password', valor: 'abcdefghijklmnop' },
    { clave: 'mail_pinchadura_to', valor: 'sv@masterbus.net' },
  ]);
  const sendMail = jest.fn().mockResolvedValue({});
  nodemailer.createTransport.mockReturnValue({ sendMail });

  await enviarAvisoPinchadura({ otId: 1, para: 'prueba@gmail.com' });

  expect(sendMail.mock.calls[0][0].to).toBe('prueba@gmail.com');
});

test('las observaciones se escapan en el HTML', async () => {
  sql.mockResolvedValue([
    { clave: 'gmail_user', valor: 'envia@gmail.com' },
    { clave: 'gmail_app_password', valor: 'abcdefghijklmnop' },
  ]);
  const sendMail = jest.fn().mockResolvedValue({});
  nodemailer.createTransport.mockReturnValue({ sendMail });

  await enviarAvisoPinchadura({ otId: 1, observaciones: '<script>alert(1)</script>' });

  const html = sendMail.mock.calls[0][0].html;
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
});
