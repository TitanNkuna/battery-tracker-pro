import { getDb } from '../../lib/db.js';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { handleCors } from '../../lib/cors.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const user = requireAuth(req, res);
  if (!user) return;

  const sql = getDb();
  const propertyId = user.propertyId; // from JWT — client cannot override this

  // GET — fetch all batteries with their full reading history
  if (req.method === 'GET') {
    const batteries = await sql`
      SELECT id, name, current_percent FROM batteries
      WHERE property_id = ${propertyId}
      ORDER BY name
    `;

    const readings = batteries.length > 0
      ? await sql`
          SELECT battery_id, percent, reading_time, is_replacement, technician
          FROM readings
          WHERE property_id = ${propertyId}
          ORDER BY reading_time ASC
        `
      : [];

    // Attach history to each battery
    const historyByBattery = {};
    readings.forEach(r => {
      if (!historyByBattery[r.battery_id]) historyByBattery[r.battery_id] = [];
      historyByBattery[r.battery_id].push({
        percent: r.percent,
        dateTime: r.reading_time,
        isReplacement: r.is_replacement,
        technician: r.technician
      });
    });

    const result = batteries.map(b => ({
      id: b.id,
      name: b.name,
      percent: b.current_percent,
      history: historyByBattery[b.id] || []
    }));

    return res.status(200).json({ batteries: result });
  }

  // POST — add a new battery (supervisor/developer only)
  if (req.method === 'POST') {
    if (!requireRole(user, res, 'supervisor', 'developer')) return;

    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Battery name is required.' });
    }

    const existing = await sql`
      SELECT id FROM batteries WHERE property_id = ${propertyId} AND LOWER(name) = LOWER(${name.trim()})
    `;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'A battery with that name already exists.' });
    }

    const [battery] = await sql`
      INSERT INTO batteries (property_id, name, current_percent)
      VALUES (${propertyId}, ${name.trim()}, 100)
      RETURNING id, name, current_percent
    `;
    return res.status(201).json({
      battery: { id: battery.id, name: battery.name, percent: battery.current_percent, history: [] }
    });
  }

  res.status(405).json({ error: 'Method not allowed.' });
}
