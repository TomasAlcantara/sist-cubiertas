const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.redirect('/login');

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    req.user = user;
    next();
  } catch (e) {
    res.clearCookie('token');
    return res.redirect('/login');
  }
}

function requireMaster(req, res, next) {
  requireAuth(req, res, () => {
    if (parseInt(req.user.tipo) !== 1) return res.redirect('/');
    next();
  });
}

module.exports = { requireAuth, requireMaster };
