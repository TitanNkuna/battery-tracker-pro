import { getDb } from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { handleCors } from '../../lib/cors.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const user = requireAuth(req, res);
  if (!user) return;

  const sql = getDb();
  const propertyId = user.propertyId;

  const { batteryId, percent, dateTime, isReplacement } = req.body || {};

  if (batteryId == null || percent == null || !dateTime) {
    return res.status(400).json({ error: 'batteryId, percent, and dateTime are required.' });
  }
  if (typeof percent !== 'number' || percent < 0 || percent > 100) {
    return res.status(400).json({ error: 'percent must be a number between 0 and 100.' });
  }

  // CRITICAL: verify the battery belongs to this property — never trust the client's batteryId alone
  const [battery] = await sql`
    SELECT id FROM batteries WHERE id = ${batteryId} AND property_id = ${propertyId}
  `;
  if (!battery) {
    return res.status(404).json({ error: 'Battery not found for this property.' });
  }

  await sql`
    INSERT INTO readings (battery_id, property_id, percent, reading_time, is_replacement, technician)
    VALUES (${batteryId}, ${propertyId}, ${percent}, ${dateTime}, ${!!isReplacement}, ${user.username})
  `;

  // Update current_percent to the latest reading for this battery
  const newPercent = isReplacement ? 100 : percent;
  await sql`
    UPDATE batteries SET current_percent = ${newPercent} WHERE id = ${batteryId} AND property_id = ${propertyId}
  `;

  // If replacement, decrement stock (floor at 0)
  if (isReplacement) {
    await sql`
      UPDATE stock SET count = GREATEST(0, count - 1) WHERE property_id = ${propertyId}
    `;
  }

  return res.status(201).json({ ok: true, newPercent });
}
