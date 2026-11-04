class AlarmSoundManager {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private isPlaying = false;
  private armed = false;
  private sweepInterval: any = null;

  arm(): boolean {
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.armed = true;
      return true;
    } catch (e) {
      console.warn('Failed to initialize AudioContext:', e);
      return false;
    }
  }

  isArmed(): boolean {
    return this.armed && this.ctx !== null && this.ctx.state === 'running';
  }

  play(): void {
    if (this.isPlaying) return;
    if (!this.ctx) {
      this.arm();
    }
    if (!this.ctx) return;

    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      this.osc = this.ctx.createOscillator();
      this.gain = this.ctx.createGain();

      this.osc.type = 'sawtooth';
      this.gain.gain.setValueAtTime(0.3, this.ctx.currentTime);

      this.osc.connect(this.gain);
      this.gain.connect(this.ctx.destination);

      // Modulate frequency to create an emergency siren sweep (700Hz - 1100Hz)
      let freq = 700;
      let direction = 1;
      this.osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      this.sweepInterval = setInterval(() => {
        if (!this.osc || !this.ctx) return;
        freq += direction * 40;
        if (freq >= 1150) direction = -1;
        if (freq <= 700) direction = 1;
        this.osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      }, 50);

      this.osc.start();
      this.isPlaying = true;
    } catch (e) {
      console.error('Audio playback error:', e);
    }
  }

  stop(): void {
    if (!this.isPlaying) return;

    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }

    if (this.osc) {
      try {
        this.osc.stop();
        this.osc.disconnect();
      } catch (e) {}
      this.osc = null;
    }

    if (this.gain) {
      try {
        this.gain.disconnect();
      } catch (e) {}
      this.gain = null;
    }

    this.isPlaying = false;
  }
}

export const alarmSound = new AlarmSoundManager();
