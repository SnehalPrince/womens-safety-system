class WakeLockManager {
  private sentinel: any = null;

  async request(): Promise<boolean> {
    if (!('wakeLock' in navigator)) {
      console.warn('Wake Lock API not supported on this browser');
      return false;
    }

    try {
      this.sentinel = await (navigator as any).wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
      return true;
    } catch (err) {
      console.warn('Could not acquire wake lock:', err);
      return false;
    }
  }

  release(): void {
    if (this.sentinel) {
      this.sentinel.release().catch(() => {});
      this.sentinel = null;
    }
  }
}

export const wakeLock = new WakeLockManager();
