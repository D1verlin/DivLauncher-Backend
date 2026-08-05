const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { JWT_SECRET } = require('../config');

// Middleware: check admin JWT
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = await getDb();
    const user = await db.get('SELECT is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!user || !user.is_admin) return res.status(403).json({ error: 'Forbidden' });
    req.adminId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware: check server sync token
const verifyServerToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const configuredToken = process.env.SERVER_TOKEN || 'SuperSecretSyncToken123';

  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized', errorMessage: 'Missing authorization header' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (token !== configuredToken) {
    return res.status(403).json({ error: 'Forbidden', errorMessage: 'Invalid server token' });
  }

  next();
};

module.exports = {
  requireAdmin,
  verifyServerToken
};
