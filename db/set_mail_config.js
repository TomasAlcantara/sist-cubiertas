// Guarda la configuración del aviso de pinchadura por email en la tabla `config` de la DB.
// Así producción la lee de la base y no hacen falta variables de entorno en Vercel.
// Ejecutar: node db/set_mail_config.js
// Los valores se piden por consola: no quedan en el código, en git ni en el historial del shell.
require('dotenv').config();
const readline = require('readline');
const { sql } = require('./index');

// En modo interactivo pregunta por readline; con entrada por pipe (tests/automatización)
// lee todo el stdin de una vez y responde las preguntas en orden.
async function crearPreguntador() {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return {
      preguntar: (texto) => new Promise((res) => rl.question(texto, (a) => res(a.trim()))),
      cerrar: () => rl.close(),
    };
  }
  const chunks = [];
  for await (const ch of process.stdin) chunks.push(ch);
  const lineas = Buffer.concat(chunks).toString('utf8').split('\n');
  let i = 0;
  return {
    preguntar: (texto) => {
      const resp = (lineas[i++] || '').trim();
      process.stdout.write(texto + resp + '\n');
      return Promise.resolve(resp);
    },
    cerrar: () => {},
  };
}

(async () => {
  try {
    await sql`CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT)`;

    const actual = {};
    for (const r of await sql`SELECT clave, valor FROM config`) actual[r.clave] = r.valor;
    const hint = (v) => (v ? ` [Enter = mantener "${v}"]` : '');
    const hintSecreto = actual.gmail_app_password ? ' [Enter = mantener la guardada]' : '';

    console.log('── Configuración del aviso de pinchadura por email ──');
    console.log('La contraseña de aplicación se genera en https://myaccount.google.com/apppasswords\n');

    const { preguntar, cerrar } = await crearPreguntador();
    const user = (await preguntar(`Cuenta Gmail que envía${hint(actual.gmail_user)}: `)) || actual.gmail_user || '';
    const passIn = await preguntar(`Contraseña de aplicación (16 letras)${hintSecreto}: `);
    const pass = passIn ? passIn.replace(/\s+/g, '') : (actual.gmail_app_password || '');
    const to = (await preguntar(`Destinatario del aviso${hint(actual.mail_pinchadura_to || 'sv@masterbus.net')}: `))
      || actual.mail_pinchadura_to || 'sv@masterbus.net';
    const base = (await preguntar(`URL del sistema para el link del mail${hint(actual.app_base_url || 'https://sist-cubiertas.vercel.app')}: `))
      || actual.app_base_url || 'https://sist-cubiertas.vercel.app';
    cerrar();

    if (!user || !pass) {
      console.error('\nERROR: faltan la cuenta Gmail o la contraseña de aplicación. No se guardó nada.');
      process.exit(1);
    }
    if (pass.length !== 16) {
      console.warn(`\nOJO: la contraseña quedó de ${pass.length} caracteres (las de aplicación de Google tienen 16). Se guarda igual.`);
    }

    const upsert = (clave, valor) => sql`
      INSERT INTO config (clave, valor) VALUES (${clave}, ${valor})
      ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor
    `;
    await upsert('gmail_user', user);
    await upsert('gmail_app_password', pass);
    await upsert('mail_pinchadura_to', to);
    await upsert('app_base_url', base);

    console.log('\nOK: configuración guardada en la base.');
    console.log(`  gmail_user         = ${user}`);
    console.log(`  gmail_app_password = ${'*'.repeat(pass.length)}`);
    console.log(`  mail_pinchadura_to = ${to}`);
    console.log(`  app_base_url       = ${base}`);
    console.log('\nProbá el envío con: node db/test_mail.js tu@mail.com');
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
