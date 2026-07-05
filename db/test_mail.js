// Envía un mail de PRUEBA del aviso de pinchadura usando la config guardada
// (tabla config de la DB, o env vars como fallback).
// Ejecutar: node db/test_mail.js [destinatario]
//   Sin argumento envía al destinatario configurado (mail_pinchadura_to).
require('dotenv').config();
const { enviarAvisoPinchadura } = require('../lib/mailer');

(async () => {
  const para = process.argv[2] || undefined;
  try {
    const enviado = await enviarAvisoPinchadura({
      otId: 'PRUEBA',
      unidad: 'UNIDAD DE PRUEBA',
      gomeria: 'Gomería de prueba',
      fecha: new Date().toLocaleDateString('es-AR'),
      trabajos: { cambio: '1' },
      cambios: [{ posicion: 'Del. Izq.', fuego: 'TEST-001', fuego_anterior: 'TEST-000' }],
      observaciones: 'Este es un mail de PRUEBA del sistema de cubiertas. Ignorar.',
      solicitadoPor: 'test_mail.js',
      para,
    });
    if (!enviado) {
      console.error('No hay credenciales configuradas. Corré primero: node db/set_mail_config.js');
      process.exit(1);
    }
    console.log(`OK: mail de prueba enviado${para ? ` a ${para}` : ' al destinatario configurado'}. Revisá la casilla (y spam).`);
  } catch (e) {
    if (e.code === 'EAUTH') {
      console.error('ERROR de autenticación: la cuenta o la contraseña de aplicación son incorrectas.');
      console.error('Regenerala en https://myaccount.google.com/apppasswords y volvé a correr node db/set_mail_config.js');
    } else {
      console.error('ERROR:', e.message);
    }
    process.exit(1);
  }
  process.exit(0);
})();
