export type UiCue =
  | "hover"
  | "click"
  | "back"
  | "confirm"
  | "error"
  | "navigate";
/** Original precomputed waveforms, built once per audio context; no files/decoding. */
export function uiSoundSamples(cue: UiCue, sampleRate: number) {
  const settings = {
    hover: [0.028, 1100, 750, 0.018],
    click: [0.052, 820, 390, 0.065],
    back: [0.085, 470, 220, 0.055],
    confirm: [0.135, 520, 1040, 0.075],
    error: [0.105, 180, 120, 0.055],
    navigate: [0.035, 980, 700, 0.035],
  }[cue];
  const [seconds, start, end, volume] = settings;
  const data = new Float32Array(Math.ceil(sampleRate * seconds));
  let phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length,
      attack = Math.min(1, i / (sampleRate * 0.003));
    phase += (2 * Math.PI * (start + (end - start) * t)) / sampleRate;
    data[i] =
      (Math.sin(phase) + 0.16 * Math.sin(phase * 2)) *
      attack *
      (1 - t) ** 2 *
      volume;
  }
  return data;
}
export class UiAudio {
  private buffers = new Map<UiCue, AudioBuffer>();
  private voices: {
    gain: GainNode;
    source: AudioBufferSourceNode | null;
    until: number;
  }[] = [];
  private last = new Map<UiCue, number>();
  constructor(
    private context: AudioContext,
    output: AudioNode,
  ) {
    for (const cue of [
      "hover",
      "click",
      "back",
      "confirm",
      "error",
      "navigate",
    ] as const) {
      const samples = uiSoundSamples(cue, context.sampleRate),
        buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.buffers.set(cue, buffer);
    }
    for (let i = 0; i < 8; i++) {
      const gain = context.createGain();
      gain.connect(output);
      this.voices.push({ gain, source: null, until: 0 });
    }
  }
  play(cue: UiCue) {
    const now = this.context.currentTime;
    if (
      now - (this.last.get(cue) ?? -Infinity) <
      (cue === "hover" ? 0.09 : 0.028)
    )
      return;
    const voice = this.voices.find((v) => v.until <= now);
    // Drop a quiet cue when the pool is full, rather than cutting a waveform mid-cycle.
    if (!voice) return;
    this.last.set(cue, now);
    const source = this.context.createBufferSource();
    source.buffer = this.buffers.get(cue)!;
    source.connect(voice.gain);
    voice.source = source;
    voice.until = now + source.buffer.duration;
    source.onended = () => {
      source.disconnect();
      if (voice.source === source) voice.source = null;
    };
    source.start();
  }
}
