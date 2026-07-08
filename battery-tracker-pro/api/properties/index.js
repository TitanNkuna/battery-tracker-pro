import { getDb, initSchema } from '../../lib/db.js';
import { handleCors } from '../../lib/cors.js';
import { requireAuth, requireRole } from '../../lib/auth.js';
import bcrypt from 'bcryptjs';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const sql = getDb();
  await initSchema();

  // GET — list all properties (public, just names/codes for the login dropdown)
  if (req.method === 'GET') {
    const rows = await sql`SELECT id, name, code FROM properties ORDER BY name`;
    return res.status(200).json({ properties: rows });
  }

  // POST — create a new property (developer only)
  if (req.method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!requireRole(user, res, 'developer')) return;

    const { name, code, adminPassword } = req.body || {};
    if (!name || !code || !adminPassword) {
      return res.status(400).json({ error: 'name, code, and adminPassword are required.' });
    }
    const clean = code.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const existing = await sql`SELECT id FROM properties WHERE code = ${clean}`;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'A property with that code already exists.' });
    }

    const [property] = await sql`
      INSERT INTO properties (name, code) VALUES (${name}, ${clean}) RETURNING id, name, code
    `;
    // Create default supervisor and technician users for the new property
    const hash = await bcrypt.hash(adminPassword, 12);
    await sql`
      INSERT INTO users (property_id, username, password_hash, role)
      VALUES (${property.id}, 'supervisor', ${hash}, 'supervisor')
    `;
    const techHash = await bcrypt.hash('Technician123', 12);
    await sql`
      INSERT INTO users (property_id, username, password_hash, role)
      VALUES (${property.id}, 'technician', ${techHash}, 'technician')
    `;
    await sql`
      INSERT INTO stock (property_id, count) VALUES (${property.id}, 0)
    `;

    return res.status(201).json({ property });
  }

  res.status(405).json({ error: 'Method not allowed.' });
}
