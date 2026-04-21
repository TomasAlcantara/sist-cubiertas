/**
 * Scraper del sistema viejo (mundoratio.com/MasterBus)
 * Extrae qué cubierta (fuego) tiene cada unidad en cada posición.
 *
 * Uso:
 *   node db/scraper_esquemas.js USUARIO CONTRASEÑA
 *
 * Genera: db/esquemas_scraped.csv
 * Formato: unidad_numero,posicion,fuego
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const HOST   = 'mundoratio.com';
const PREFIX = '/MasterBus';

const POS_MAP = { di:'ddi', dd:'ddd', tie:'tie', tii:'tii', tdi:'tdi', tde:'tde',
                  cie:'cie', cii:'cii', cdi:'cdi', cde:'cde', ra:'ra', ra2:'ra2' };

// ── HTTP ─────────────────────────────────────────────────────────────────────
function req(options, postData) {
  return new Promise((resolve, reject) => {
    const r = https.request(options, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (postData) r.write(postData);
    r.end();
  });
}

// Extrae todas las cookies Set-Cookie y devuelve string "k=v; k2=v2"
function extractCookies(headers) {
  return (headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
}

// Combina dos strings de cookies (segunda tiene precedencia)
function mergeCookies(a, b) {
  const map = {};
  for (const pair of (a + '; ' + b).split(';')) {
    const [k, ...vs] = pair.trim().split('=');
    if (k) map[k.trim()] = vs.join('=').trim();
  }
  return Object.entries(map).filter(([k]) => k).map(([k,v]) => `${k}=${v}`).join('; ');
}

async function get(urlPath, cookie) {
  const r = await req({ hostname: HOST, path: urlPath, method: 'GET',
    headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' } });
  return r;
}

async function post(urlPath, data, cookie) {
  const body = new URLSearchParams(data).toString();
  return req({
    hostname: HOST, path: urlPath, method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded',
               'Content-Length': Buffer.byteLength(body), 'User-Agent': 'Mozilla/5.0' }
  }, body);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Login ────────────────────────────────────────────────────────────────────
async function login(usuario, password) {
  // 1. GET para obtener PHPSESSID inicial
  const r1 = await get(PREFIX + '/login.php', '');
  let cookie = extractCookies(r1.headers);

  // 2. POST credenciales
  const r2 = await post(PREFIX + '/login.php', { usuario, password }, cookie);
  cookie = mergeCookies(cookie, extractCookies(r2.headers));

  // 3. Si hubo redirect, seguirlo
  if (r2.status === 302 && r2.headers.location) {
    const loc = r2.headers.location.startsWith('http')
      ? new URL(r2.headers.location).pathname
      : r2.headers.location;
    const r3 = await get(loc, cookie);
    cookie = mergeCookies(cookie, extractCookies(r3.headers));
    if (r3.body.includes('Cerrar') || r3.body.includes('Salir') || r3.body.includes('admin')) {
      console.log('✓ Login OK (redirect seguido)');
      return cookie;
    }
  }

  // Verificar login en la respuesta directa
  if (r2.body.includes('Cerrar') || r2.body.includes('Salir') || r2.body.includes('index.php')) {
    console.log('✓ Login OK');
    return cookie;
  }

  // Intentar acceder a una página protegida para validar sesión
  const r4 = await get(PREFIX + '/admin/micros/', cookie);
  if (r4.body.includes('Salir') || r4.body.includes('Cerrar sesión') || r4.body.includes('admin/micros')) {
    console.log('✓ Login OK (sesión activa)');
    return cookie;
  }

  console.error('⚠ Login posiblemente fallido. Continuando de todas formas...');
  return cookie;
}

// ── Obtener mapa vid→numero desde el SELECT de la lista ──────────────────────
async function getUnitMap(cookie) {
  const r = await get(PREFIX + '/admin/micros/', cookie);
  const map = {}; // vid → unidad_numero

  // <option value="VID">NUMERO</option>
  const re = /<option value="(\d+)">(\d+)<\/option>/gi;
  let m;
  while ((m = re.exec(r.body)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

// ── Parsear diagrama de una unidad ───────────────────────────────────────────
function parseDiagrama(html, unidadNumero) {
  const filas = [];
  // Captura: show_rlist('ruta', 'POSICION') ... <div id="div_r">FUEGO</div>
  const re = /show_rlist\('[^']*',\s*'([^']+)'\)[\s\S]*?<div id="div_r">([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const posViejo = m[1].trim();
    const fuego    = m[2].trim();
    if (!fuego) continue;
    const posNuevo = POS_MAP[posViejo] || posViejo;
    filas.push({ unidad: unidadNumero, posicion: posNuevo, fuego });
  }
  return filas;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const [,, usuario, password] = process.argv;
  if (!usuario || !password) {
    console.log('Uso: node db/scraper_esquemas.js USUARIO CONTRASEÑA');
    process.exit(1);
  }

  const cookie = await login(usuario, password);

  console.log('\nObteniendo mapa de unidades...');
  const unitMap = await getUnitMap(cookie);
  const vids = Object.keys(unitMap);
  console.log(`Total unidades: ${vids.length}\n`);

  if (vids.length === 0) {
    console.error('No se encontraron unidades. Puede que el login haya fallado o la estructura de la página cambió.');
    process.exit(1);
  }

  const rows = [];
  let i = 0;
  for (const vid of vids) {
    i++;
    const numero = unitMap[vid];
    await sleep(250);
    const r = await get(`${PREFIX}/admin/ruedas_micro/modelo.php?v=${vid}`, cookie);
    if (r.status !== 200) {
      console.log(`  [${i}/${vids.length}] Unidad ${numero} (v=${vid}) → HTTP ${r.status}, skip`);
      continue;
    }
    const filas = parseDiagrama(r.body, numero);
    rows.push(...filas);
    console.log(`  [${i}/${vids.length}] Unidad ${numero}: ${filas.length} posiciones`);
  }

  const out = path.join(__dirname, 'esquemas_scraped.csv');
  const csv = 'unidad_numero,posicion,fuego\n' +
    rows.map(r => `${r.unidad},${r.posicion},${r.fuego}`).join('\n');
  fs.writeFileSync(out, csv, 'utf8');
  console.log(`\n✓ CSV generado: ${out}`);
  console.log(`  Total filas: ${rows.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
