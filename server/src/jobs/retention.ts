import { query } from '../db/index.js';

export async function runRetentionCleanup(): Promise<{ deletedIncidents: number; deletedLocations: number }> {
  const retentionDays = Number.parseInt(process.env.RETENTION_DAYS || '30', 10);
  if (Number.isNaN(retentionDays) || retentionDays < 0) {
    return { deletedIncidents: 0, deletedLocations: 0 };
  }

  // Delete locations belonging to resolved or cancelled incidents older than retention window
  const locationsRes = await query(
    `DELETE FROM locations 
     WHERE incident_id IN (
       SELECT id FROM incidents 
       WHERE status IN ('resolved', 'cancelled') 
       AND started_at < NOW() - ($1 || ' days')::INTERVAL
     )`,
    [retentionDays]
  );

  // Delete messages belonging to resolved or cancelled incidents older than retention window
  await query(
    `DELETE FROM messages 
     WHERE incident_id IN (
       SELECT id FROM incidents 
       WHERE status IN ('resolved', 'cancelled') 
       AND started_at < NOW() - ($1 || ' days')::INTERVAL
     )`,
    [retentionDays]
  );

  // Delete the old incidents themselves
  const incidentsRes = await query(
    `DELETE FROM incidents 
     WHERE status IN ('resolved', 'cancelled') 
     AND started_at < NOW() - ($1 || ' days')::INTERVAL`,
    [retentionDays]
  );

  return {
    deletedIncidents: incidentsRes.rowCount,
    deletedLocations: locationsRes.rowCount,
  };
}

let retentionInterval: NodeJS.Timeout | null = null;

export function startRetentionJob(intervalMs: number = 24 * 60 * 60 * 1000): void {
  // Run once on start
  runRetentionCleanup().catch((err) => {
    console.error('Initial retention cleanup error:', err);
  });

  // Schedule recurring
  retentionInterval = setInterval(() => {
    runRetentionCleanup().catch((err) => {
      console.error('Periodic retention cleanup error:', err);
    });
  }, intervalMs);
}

export function stopRetentionJob(): void {
  if (retentionInterval) {
    clearInterval(retentionInterval);
    retentionInterval = null;
  }
}
