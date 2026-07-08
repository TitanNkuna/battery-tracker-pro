import { getDb, initSchema } from '../../lib/db.js';
import { signToken } from '../../lib/auth.js';
import { handleCors } from '../../lib/cors.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const sql = getDb();
  await initSchema();

  const { propertyCode, username, password } = req.body || {};
  if (!propertyCode || !username || !password) {
    return res.status(400).json({ error: 'propertyCode, username, and password are required.' });
  }

  // Look up property
  const [property] = await sql`
    SELECT id, name FROM properties WHERE code = ${propertyCode.toLowerCase().trim()}
  `;
  if (!property) {
    return res.status(401).json({ error: 'Property not found. Check the property code.' });
  }

  // Look up user within that property
  const [user] = await sql`
    SELECT id, username, password_hash, role
    FROM users
    WHERE property_id = ${property.id}
      AND LOWER(username) = LOWER(${username.trim()})
  `;
  if (!user) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  // Sign JWT — property_id comes from DB, never from the client request
  const token = signToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    propertyId: property.id,
    propertyName: property.name
  });

  return res.status(200).json({
    token,
    user: {
      username: user.username,
      role: user.role,
      propertyName: property.name
    }
  });
}
