const jwt = require('jsonwebtoken');
const { permisosDe, tienePermiso } = require('../lib/permisos');

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.redirect('/login');

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    req.user = user;
    req.permisos = permisosDe(user);
    next();
  } catch (e) {
    res.clearCookie('token');
    return res.redirect('/login');
  }
}

/**
 * Una request AJAX necesita un 403 legible, no un 302 a la home: el $.ajax
 * sigue el redirect y termina metiendo el HTML del login dentro del modal.
 */
function esAjax(req) {
  if (req.xhr) return true;
  if (req.get('X-Requested-With') === 'XMLHttpRequest') return true;
  const accept = req.get('Accept') || '';
  return req.method !== 'GET' && !accept.includes('text/html');
}

function denegar(req, res) {
  if (esAjax(req)) return res.status(403).send('No tenés permiso para esta acción');
  return res.redirect('/');
}

/** Middleware: pasa si el usuario tiene ALGUNO de los permisos indicados. */
function requirePerm(...slugs) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!tienePermiso(req.user, slugs)) return denegar(req, res);
      next();
    });
  };
}

// Alias histórico: "master" es ahora simplemente quien puede administrar.
const requireMaster = requirePerm('admin');

module.exports = { requireAuth, requirePerm, requireMaster, denegar };
