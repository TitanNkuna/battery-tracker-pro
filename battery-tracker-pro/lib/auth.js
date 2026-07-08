import jwt from 'jsonwebtoken';

const TOKEN_EXPIRY = '12h';

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET environment variable is not set.');
  return s;
}

export function signToken(payload) {
  // payload: { userId, username, role, propertyId, propertyName }
  return jwt.sign(payload, getSecret(), { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token) {
  // Returns decoded payload or throws
  return jwt.verify(token, getSecret());
}

export function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// Use in every protected route handler:
// const user = requireAuth(req, res);
// if (!user) return; // response already sent
export function requireAuth(req, res) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token.' });
    return null;
  }
  try {
    return verifyToken(token);
    // Returns: { userId, username, role, propertyId, propertyName }
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
    return null;
  }
}

export function requireRole(user, res, ...roles) {
  if (!roles.includes(user.role)) {
    res.status(403).json({ error: `This action requires one of: ${roles.join(', ')}` });
    return false;
  }
  return true;
}
