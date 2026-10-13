/**
 * `request(app)` para los tests: el de supertest, con la app escuchando en 127.0.0.1.
 *
 * supertest solo abre un server por pedido con `listen(0)`, sin host: escucha en
 * todas las direcciones y el sistema le reparte un puerto libre. En macOS "libre"
 * no cuenta los puertos que otro programa tiene tomados solo en 127.0.0.1 (un IDE
 * abre decenas), así que cada tanto le toca uno de esos, y como el pedido del test
 * va a 127.0.0.1 lo contesta ese programa. Se veía como un test cualquiera fallando
 * una corrida de cada ocho, con "socket hang up" o con respuestas que esta app no
 * emite ("Invalid CSRF token", "Client sent an HTTP request to an HTTPS server").
 *
 * Atado a 127.0.0.1 el sistema nunca reparte un puerto que ahí esté ocupado. De
 * paso queda un solo server por archivo de tests en vez de uno por pedido.
 */
const http = require('http');
const supertest = require('supertest');
const app = require('../api/index');

const servidor = http.createServer(app);

// listen() con host resuelve la dirección en el siguiente tick, así que hay que
// esperarlo: si supertest recibe un server que todavía no escucha lo abre él, con
// listen(0) sin host, que es justo lo que se quiere evitar.
beforeAll((listo) => { servidor.listen(0, '127.0.0.1', listo); });
afterAll((listo) => { servidor.close(listo); });

module.exports = (pedida) => {
  if (pedida !== app) throw new Error('tests/pedido.js sirve la app de api/index, no otra');
  if (servidor.address().address !== '127.0.0.1') throw new Error('el server de los tests no quedó atado a 127.0.0.1');
  return supertest(servidor);
};
