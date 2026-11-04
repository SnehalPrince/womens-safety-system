import { query } from '../db/index.js';
import { smsProvider } from './sms.js';

export async function enqueueCommand(deviceId: string, command: 'sos' | 'stop'): Promise<void> {
  await query(
    'INSERT INTO device_commands (device_id, command) VALUES ($1, $2)',
    [deviceId, command]
  );

  // If SIM fallback is active and device has SIM, send SMS
  try {
    const devRes = await query('SELECT sim_number FROM devices WHERE device_id = $1', [deviceId]);
    if (devRes.rows.length > 0 && devRes.rows[0].sim_number) {
      const sim = devRes.rows[0].sim_number;
      await smsProvider.sendSms(sim, command.toUpperCase());
    }
  } catch (err) {
    console.error('Failed to dispatch fallback SMS to device SIM:', err);
  }
}

export async function consumeNextCommand(deviceId: string): Promise<'sos' | 'stop' | 'none'> {
  // Find oldest pending command
  const pending = await query(
    `SELECT id, command FROM device_commands 
     WHERE device_id = $1 AND consumed_at IS NULL 
     ORDER BY created_at ASC, id ASC 
     LIMIT 1`,
    [deviceId]
  );

  if (pending.rows.length === 0) {
    return 'none';
  }

  const cmdId = pending.rows[0].id;
  const command = pending.rows[0].command as 'sos' | 'stop';

  // Mark as consumed
  await query(
    'UPDATE device_commands SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1',
    [cmdId]
  );

  return command;
}
