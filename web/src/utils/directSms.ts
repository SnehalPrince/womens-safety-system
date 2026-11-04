import { registerPlugin } from '@capacitor/core';

interface DirectSmsPluginInterface {
  send(options: { phoneNumber: string; message: string }): Promise<{ success: boolean; recipient: string }>;
}

export const DirectSms = registerPlugin<DirectSmsPluginInterface>('DirectSms');

export async function sendDirectSmsToContacts(
  contacts: { phone: string; name: string }[],
  message: string
): Promise<{ sent: string[]; failed: { phone: string; error: string }[] }> {
  const isNative =
    (window as any).Capacitor?.isNativePlatform?.() ||
    window.location.protocol === 'capacitor:';

  if (!isNative) {
    return { sent: [], failed: [] };
  }

  const sent: string[] = [];
  const failed: { phone: string; error: string }[] = [];

  for (const contact of contacts) {
    if (!contact.phone) continue;
    try {
      await DirectSms.send({ phoneNumber: contact.phone, message });
      sent.push(contact.phone);
    } catch (err: any) {
      console.warn(`DirectSms failed for ${contact.phone}:`, err);
      failed.push({ phone: contact.phone, error: err?.message || String(err) });
    }
  }

  return { sent, failed };
}
