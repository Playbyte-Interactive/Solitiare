export type SoundName = "deal" | "move" | "flip" | "complete" | "error" | "win" | "tap";

export class SolitaireAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private padNodes: OscillatorNode[] = [];
  enabled = true;

  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.musicGain = this.context.createGain();
      this.master.gain.value = 0.32;
      this.musicGain.gain.value = 0.0001;
      this.musicGain.connect(this.master);
      this.master.connect(this.context.destination);
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    this.startBackgroundMusic();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.master) {
      this.master.gain.setTargetAtTime(enabled ? 0.32 : 0.0001, this.context!.currentTime, 0.02);
    }
  }

  play(name: SoundName) {
    if (!this.enabled || !this.context || !this.master) {
      return;
    }

    const now = this.context.currentTime;
    if (name === "deal") {
      this.noise(now, 0.11, 680, 0.22);
      this.tone(now + 0.025, 180, 0.06, 0.05, "triangle");
      return;
    }

    if (name === "move") {
      this.tone(now, 420, 0.045, 0.07, "triangle");
      this.tone(now + 0.035, 560, 0.04, 0.045, "sine");
      return;
    }

    if (name === "flip") {
      this.noise(now, 0.055, 1100, 0.15);
      this.tone(now + 0.02, 760, 0.035, 0.04, "sine");
      return;
    }

    if (name === "complete") {
      [392, 494, 622, 784].forEach((freq, index) => {
        this.tone(now + index * 0.055, freq, 0.09, 0.07, "triangle");
      });
      return;
    }

    if (name === "win") {
      [330, 392, 494, 659, 784, 988].forEach((freq, index) => {
        this.tone(now + index * 0.07, freq, 0.13, 0.08, index % 2 ? "sine" : "triangle");
      });
      return;
    }

    if (name === "error") {
      this.tone(now, 130, 0.14, 0.08, "sawtooth");
      return;
    }

    this.tone(now, 640, 0.03, 0.04, "triangle");
  }

  private tone(start: number, frequency: number, duration: number, gainValue: number, type: OscillatorType) {
    if (!this.context || !this.master) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.86), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(start: number, duration: number, filterFrequency: number, gainValue: number) {
    if (!this.context || !this.master) {
      return;
    }

    const sampleRate = this.context.sampleRate;
    const bufferSize = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = this.context.createBuffer(1, bufferSize, sampleRate);
    const output = buffer.getChannelData(0);
    for (let index = 0; index < bufferSize; index += 1) {
      output[index] = (Math.random() * 2 - 1) * (1 - index / bufferSize);
    }

    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = filterFrequency;
    filter.Q.value = 0.9;
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private startBackgroundMusic() {
    if (!this.context || !this.musicGain || this.musicTimer !== null) {
      return;
    }

    const now = this.context.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(0.0001, now);
    this.musicGain.gain.exponentialRampToValueAtTime(0.09, now + 2.4);

    const padFrequencies = [146.83, 220, 293.66];
    this.padNodes = padFrequencies.map((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      oscillator.type = index === 1 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index === 2 ? 5 : index === 0 ? -4 : 0;
      gain.gain.setValueAtTime(0.012 + index * 0.004, now);
      oscillator.connect(gain);
      gain.connect(this.musicGain!);
      oscillator.start(now);
      return oscillator;
    });

    this.scheduleMusicPhrase();
    this.musicTimer = window.setInterval(() => this.scheduleMusicPhrase(), 9600);
  }

  private scheduleMusicPhrase() {
    if (!this.context || !this.musicGain) {
      return;
    }

    const base = this.context.currentTime + 0.08;
    const melody = [293.66, 329.63, 392, 440, 392, 329.63, 277.18, 293.66];
    melody.forEach((frequency, index) => {
      this.musicTone(base + index * 1.2, frequency, 0.9, 0.026, index % 2 ? "sine" : "triangle");
    });

    [0, 4.8].forEach((offset) => {
      this.musicTone(base + offset, 146.83, 2.2, 0.022, "sine");
      this.musicTone(base + offset, 220, 2.2, 0.018, "sine");
      this.musicTone(base + offset, 369.99, 2.2, 0.012, "triangle");
    });
  }

  private musicTone(start: number, frequency: number, duration: number, gainValue: number, type: OscillatorType) {
    if (!this.context || !this.musicGain) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1250, start);
    filter.Q.value = 0.4;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.08);
  }
}
