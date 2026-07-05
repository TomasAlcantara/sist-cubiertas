// Envío de emails vía Gmail (nodemailer)
// La configuración se lee de la tabla `config` de la DB (cargarla con: node db/set_mail_config.js)
// y como fallback de env vars: GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_PINCHADURA_TO, APP_BASE_URL.
// Si no hay credenciales en ningún lado, el envío se omite con un warn (nunca rompe al llamador).
const nodemailer = require('nodemailer');
const { sql } = require('../db');

async function getMailConfig() {
  const db = {};
  try {
    const rows = await sql`SELECT clave, valor FROM config`;
    for (const r of rows) db[r.clave] = r.valor;
  } catch (e) {
    // Tabla config inexistente o DB inaccesible: seguimos solo con env vars
  }
  return {
    user: db.gmail_user || process.env.GMAIL_USER,
    pass: db.gmail_app_password || process.env.GMAIL_APP_PASSWORD,
    to: db.mail_pinchadura_to || process.env.MAIL_PINCHADURA_TO || 'sv@masterbus.net',
    baseUrl: db.app_base_url || process.env.APP_BASE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null),
  };
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// cambios: [{ posicion, fuego, fuego_anterior }] con posicion ya en nombre legible
// para: destinatario opcional que pisa la config (usado por db/test_mail.js)
// Devuelve true si envió, false si se omitió por falta de credenciales.
async function enviarAvisoPinchadura({ otId, unidad, gomeria, fecha, trabajos, cambios, observaciones, solicitadoPor, para }) {
  const cfg = await getMailConfig();
  if (!cfg.user || !cfg.pass) {
    console.warn('[MAIL] Sin credenciales de Gmail (tabla config ni env vars); se omite aviso de pinchadura');
    return false;
  }
  const to = para || cfg.to;
  const link = cfg.baseUrl ? `${cfg.baseUrl.replace(/\/$/, '')}/OTs/ver?ot=${otId}` : null;

  const nombresTrabajos = { rotacion:'Rotación', arreglo:'Arreglo', cambio:'Cambio', alinear:'Alinear', balanceo:'Balanceo', armar:'Armar' };
  const trabajosMarcados = Object.entries(trabajos || {})
    .filter(([, v]) => v === '1' || v === true)
    .map(([k]) => nombresTrabajos[k] || k);

  const subject = `Aviso de pinchadura — OT N° ${otId} — Unidad ${unidad || 'S/D'}`;

  const lineasCambios = (cambios || []).map(c =>
    `${c.posicion}: entra ${c.fuego || 'S/D'}${c.fuego_anterior ? ` (sale ${c.fuego_anterior})` : ''}`);

  const text = [
    `Se registró una OT por PINCHADURA.`,
    ``,
    `OT N°: ${otId}`,
    `Unidad: ${unidad || 'S/D'}`,
    `Fecha: ${fecha || 'S/D'}`,
    `Gomería: ${gomeria || 'S/D'}`,
    `Solicitado por: ${solicitadoPor || 'S/D'}`,
    `Trabajos: ${trabajosMarcados.join(', ') || 'S/D'}`,
    lineasCambios.length ? `Cubiertas:\n${lineasCambios.map(l => `  - ${l}`).join('\n')}` : null,
    observaciones ? `Observaciones: ${observaciones}` : null,
    link ? `\nVer OT: ${link}` : null,
  ].filter(l => l !== null).join('\n');

  const fila = (label, valor) =>
    `<tr><td style="padding:4px 10px 4px 0; font-weight:bold; vertical-align:top;">${label}</td><td style="padding:4px 0;">${valor}</td></tr>`;
  const html = `
    <div style="font-family:Arial,sans-serif; font-size:14px; color:#222;">
      <p style="color:#c62828; font-size:16px; font-weight:bold; margin:0 0 12px;">⚠ Aviso de pinchadura</p>
      <p style="margin:0 0 12px;">Se registró una orden de trabajo por cambio/rotación de cubiertas a causa de una pinchadura.</p>
      <table style="border-collapse:collapse;">
        ${fila('OT N°', escapeHtml(otId))}
        ${fila('Unidad', escapeHtml(unidad || 'S/D'))}
        ${fila('Fecha', escapeHtml(fecha || 'S/D'))}
        ${fila('Gomería', escapeHtml(gomeria || 'S/D'))}
        ${fila('Solicitado por', escapeHtml(solicitadoPor || 'S/D'))}
        ${fila('Trabajos', escapeHtml(trabajosMarcados.join(', ') || 'S/D'))}
        ${lineasCambios.length ? fila('Cubiertas', lineasCambios.map(escapeHtml).join('<br/>')) : ''}
        ${observaciones ? fila('Observaciones', escapeHtml(observaciones)) : ''}
      </table>
      ${link ? `<p style="margin:14px 0 0;"><a href="${escapeHtml(link)}">Ver la OT en el sistema</a></p>` : ''}
    </div>`;

  // Transporter por envío (no singleton): las credenciales pueden cambiar en la tabla
  // config sin redeploy, y el evento es poco frecuente.
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
  await transporter.sendMail({
    from: `"Sistema Cubiertas" <${cfg.user}>`,
    to, subject, text, html,
  });
  return true;
}

module.exports = { enviarAvisoPinchadura };
