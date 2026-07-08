import { getDb } from '../../lib/db.js';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { handleCors } from '../../lib/cors.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const sql = getDb();
  const propertyId = user.propertyId;

  if (req.method === 'GET') {
    const [row] = await sql`SELECT count FROM stock WHERE property_id = ${propertyId}`;
    return res.status(200).json({ count: row ? row.count : 0 });
  }

  if (req.method === 'POST') {
    if (!requireRole(user, res, 'supervisor', 'developer')) return;
    const { count } = req.body || {};
    if (typeof count !== 'number' || count < 0) {
      return res.status(400).json({ error: 'count must be a non-negative number.' });
    }
    await sql`
      INSERT INTO stock (property_id, count) VALUES (${propertyId}, ${count})
      ON CONFLICT (property_id) DO UPDATE SET count = EXCLUDED.count
    `;
    return res.status(200).json({ ok: true, count });
  }

  res.status(405).json({ error: 'Method not allowed.' });
}
