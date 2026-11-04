export interface CallParticipant {
  role: 'admin' | 'victim' | 'contact';
  phone: string;
}

export interface CallProvider {
  createBridge(participants: CallParticipant[]): Promise<{ bridgeId: string; status: string }>;
}

export class StubCallProvider implements CallProvider {
  async createBridge(participants: CallParticipant[]): Promise<{ bridgeId: string; status: string }> {
    const isEnabled = process.env.FEATURE_CALL_BRIDGE === 'true';
    if (!isEnabled) {
      throw new Error('Call bridge feature is disabled');
    }
    const bridgeId = `bridge_${Date.now()}`;
    const maskedCount = participants.length;
    console.log(`[STUB CALL BRIDGE] Conference bridge ${bridgeId} initiated with ${maskedCount} participants`);
    return {
      bridgeId,
      status: 'initiated',
    };
  }
}

export const callProvider: CallProvider = new StubCallProvider();
