import { getDb } from '../../lib/db.js';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { handleCors } from '../../lib/cors.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'developer', 'supervisor')) return;

  const sql = getDb();
  const propertyId = user.propertyId;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, username, role, created_at
      FROM users WHERE property_id = ${propertyId} ORDER BY username
    `;
    return res.status(200).json({ users: rows });
  }

  if (req.method === 'POST') {
    const { username, password, role } = req.body || {};
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'username, password, and role are required.' });
    }
    if (!['supervisor', 'technician', 'developer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    const existing = await sql`
      SELECT id FROM users
      WHERE property_id = ${propertyId} AND LOWER(username) = LOWER(${username})
    `;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username already exists for this property.' });
    }
    const hash = await bcrypt.hash(password, 12);
    const [newUser] = await sql`
      INSERT INTO users (property_id, username, password_hash, role)
      VALUES (${propertyId}, ${username}, ${hash}, ${role})
      RETURNING id, username, role
    `;
    return res.status(201).json({ user: newUser });
  }

  res.status(405).json({ error: 'Method not allowed.' });
}
