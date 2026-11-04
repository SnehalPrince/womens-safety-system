export interface SmsProvider {
  sendSms(to: string, message: string): Promise<boolean>;
}

export class StubSmsProvider implements SmsProvider {
  async sendSms(to: string, message: string): Promise<boolean> {
    const isEnabled = process.env.FEATURE_SMS_FALLBACK === 'true';
    if (!isEnabled) {
      return false;
    }
    // Mask phone number for security in logs
    const maskedPhone = to.length > 4 ? `***${to.slice(-4)}` : '***';
    console.log(`[STUB SMS PROVIDER] Fallback SMS to ${maskedPhone}: "${message}"`);
    return true;
  }
}

export const smsProvider: SmsProvider = new StubSmsProvider();
