import { getDb } from '../../lib/db.js';
import { requireAuth, requireRole } from '../../lib/auth.js';
import { handleCors } from '../../lib/cors.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const user = requireAuth(req, res);
  if (!user) return;
  if (!requireRole(user, res, 'supervisor', 'developer')) return;

  const sql = getDb();
  const propertyId = user.propertyId;

  const { rows } = req.body || {};
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array is required.' });
  }

  let imported = 0;
  let created = 0;
  let skipped = 0;
  let replacements = 0;

  for (const row of rows) {
    const { name, percent, dateTime, isReplacement, technician } = row;
    if (!name || typeof percent !== 'number' || !dateTime) { skipped++; continue; }

    // Find or create battery scoped to this property
    let [battery] = await sql`
      SELECT id FROM batteries WHERE property_id = ${propertyId} AND LOWER(name) = LOWER(${name})
    `;
    if (!battery) {
      [battery] = await sql`
        INSERT INTO batteries (property_id, name, current_percent)
        VALUES (${propertyId}, ${name}, ${percent})
        RETURNING id
      `;
      created++;
    }

    // Skip exact duplicate readings
    const dup = await sql`
      SELECT id FROM readings
      WHERE battery_id = ${battery.id}
        AND property_id = ${propertyId}
        AND reading_time = ${dateTime}
        AND percent = ${percent}
        AND is_replacement = ${!!isReplacement}
    `;
    if (dup.length > 0) { skipped++; continue; }

    await sql`
      INSERT INTO readings (battery_id, property_id, percent, reading_time, is_replacement, technician)
      VALUES (${battery.id}, ${propertyId}, ${percent}, ${dateTime}, ${!!isReplacement}, ${technician || user.username})
    `;
    imported++;
    if (isReplacement) replacements++;
  }

  // Recompute current_percent from the latest reading for all batteries in this property
  await sql`
    UPDATE batteries b
    SET current_percent = (
      SELECT percent FROM readings r
      WHERE r.battery_id = b.id
      ORDER BY reading_time DESC
      LIMIT 1
    )
    WHERE b.property_id = ${propertyId}
      AND EXISTS (SELECT 1 FROM readings WHERE battery_id = b.id)
  `;

  // Decrement stock for net-new replacement readings
  if (replacements > 0) {
    await sql`
      UPDATE stock SET count = GREATEST(0, count - ${replacements}) WHERE property_id = ${propertyId}
    `;
  }

  return res.status(200).json({ imported, created, skipped, replacements });
}
