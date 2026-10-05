import { defaults, type AudioSettings } from "../game/settings";
export class GameAudio {
  settings: AudioSettings = defaults().audio;
  private ctx: AudioContext | null = null;
  private engine: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private boostGain: GainNode | null = null;
  private skidGain: GainNode | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<keyof AudioSettings, GainNode>> = {};
  private nextMusic = 0;
  private musicStep = 0;
  unlock() {
    if (!this.ctx) {
      const c = (this.ctx = new AudioContext());
      this.master = c.createGain();
      this.master.connect(c.destination);
      for (const key of ["music", "sfx", "engine", "ui"] as const) {
        const bus = c.createGain();
        bus.connect(this.master);
        this.buses[key] = bus;
      }
      this.engine = c.createOscillator();
      this.engine.type = "sawtooth";
      this.engineGain = c.createGain();
      this.engineGain.gain.value = 0;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 380;
      this.engine.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.buses.engine!);
      this.engine.start();
      // A fixed-rate noise bed: boost pitch/intensity follows activation, never world velocity.
      const noise = c.createBuffer(1, c.sampleRate, c.sampleRate),
        samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = (Math.random() * 2 - 1) * 0.5;
      const source = c.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const band = c.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 850;
      band.Q.value = 0.7;
      this.boostGain = c.createGain();
      this.boostGain.gain.value = 0;
      source.connect(band);
      band.connect(this.boostGain);
      this.boostGain.connect(this.buses.sfx!);
      source.start();
      const skidSource = c.createBufferSource();
      skidSource.buffer = noise;
      skidSource.loop = true;
      const skidFilter = c.createBiquadFilter();
      skidFilter.type = "bandpass";
      skidFilter.frequency.value = 1700;
      skidFilter.Q.value = 1.6;
      this.skidGain = c.createGain();
      this.skidGain.gain.value = 0;
      skidSource.connect(skidFilter);
      skidFilter.connect(this.skidGain);
      this.skidGain.connect(this.buses.sfx!);
      skidSource.start();
      this.apply();
    }
    void this.ctx.resume();
  }
  apply() {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(
      this.settings.master,
      this.ctx.currentTime,
      0.03,
    );
    for (const key of ["music", "sfx", "engine", "ui"] as const)
      this.buses[key]!.gain.setTargetAtTime(
        this.settings[key],
        this.ctx.currentTime,
        0.03,
      );
  }
  tone(
    frequency: number,
    duration: number,
    volume = 0.08,
    type: OscillatorType = "sine",
    channel: "sfx" | "ui" | "music" = "sfx",
  ) {
    const c = this.ctx;
    if (!c) return;
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(frequency, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(
      frequency * (channel === "music" ? 1 : 0.45),
      c.currentTime + duration,
    );
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.linearRampToValueAtTime(volume, c.currentTime + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    o.connect(g);
    g.connect(this.buses[channel]!);
    o.start();
    o.stop(c.currentTime + duration);
    let ended = false;
    o.onended = () => {
      ended = true;
      o.disconnect();
      g.disconnect();
    };
    return () => {
      if (ended) return;
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(0, c.currentTime);
      o.stop(c.currentTime);
    };
  }
  update(
    speed: number,
    boost: boolean,
    active: boolean,
    throttle = 0,
    menu = false,
    slip = 0,
  ) {
    const c = this.ctx;
    if (!c || !this.engine || !this.engineGain || !this.boostGain) return;
    this.engine.frequency.setTargetAtTime(
      34 + speed * 3 + Math.abs(throttle) * 22,
      c.currentTime,
      0.08,
    );
    this.engineGain.gain.setTargetAtTime(
      active ? 0.015 + Math.abs(throttle) * 0.015 : 0,
      c.currentTime,
      0.05,
    );
    this.boostGain.gain.setTargetAtTime(
      active && boost ? 0.18 : 0,
      c.currentTime,
      0.035,
    );
    this.skidGain?.gain.setTargetAtTime(
      active ? Math.max(0, Math.min(1, slip)) * 0.24 : 0,
      c.currentTime,
      0.025,
    );
    if (menu && this.settings.music > 0 && c.currentTime >= this.nextMusic) {
      const notes = [110, 164.81, 220, 196, 130.81, 196, 261.63, 164.81];
      this.tone(
        notes[this.musicStep++ % notes.length],
        1.6,
        0.018,
        "sine",
        "music",
      );
      this.nextMusic = c.currentTime + 0.48;
    }
  }
}
