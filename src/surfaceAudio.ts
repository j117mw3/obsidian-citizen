export type SurfaceSound = "chargeReady" | "blaster" | "vent" | "footstep" | "jump" | "land" | "impact" | "hit" | "damage" | "pickup";

const SOUND: Record<SurfaceSound, { start: number; end: number; duration: number; gain: number; wave: OscillatorType }> = {
  chargeReady: { start: 1100, end: 1600, duration: 0.12, gain: 0.055, wave: "sine" },
  blaster: { start: 510, end: 150, duration: 0.14, gain: 0.11, wave: "sawtooth" },
  vent: { start: 920, end: 180, duration: 0.42, gain: 0.1, wave: "triangle" },
  footstep: { start: 145, end: 72, duration: 0.075, gain: 0.045, wave: "triangle" },
  jump: { start: 230, end: 430, duration: 0.12, gain: 0.07, wave: "sine" },
  land: { start: 118, end: 52, duration: 0.13, gain: 0.09, wave: "triangle" },
  impact: { start: 190, end: 68, duration: 0.09, gain: 0.08, wave: "square" },
  hit: { start: 720, end: 1080, duration: 0.08, gain: 0.065, wave: "sine" },
  damage: { start: 310, end: 110, duration: 0.18, gain: 0.1, wave: "square" },
  pickup: { start: 480, end: 860, duration: 0.18, gain: 0.075, wave: "sine" },
};

/** Small synthesized effects for surface combat, spatialized in the shared scene. */
export class SurfaceAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private charge: { oscillators: OscillatorNode[]; gain: GainNode } | null = null;
  private enabled = true;
  private volume = 0.5;
  private sources = new Set<{ panner: PannerNode; position: readonly [number, number, number]; origin: readonly [number, number, number]; center: () => readonly [number, number, number] }>();

  setOptions(enabled: boolean, volume: number): void {
    if (!enabled || volume <= 0) this.stopCharge();
    this.enabled = enabled; this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
    if (this.master && this.context) this.master.gain.setTargetAtTime(enabled ? this.volume : 0, this.context.currentTime, 0.04);
  }

  updateListener(position: readonly [number, number, number], forward: readonly [number, number, number], up: readonly [number, number, number]): void {
    if (!this.context) return;
    const listener = this.context.listener, at = this.context.currentTime;
    this.updateSources();
    listener.positionX.setValueAtTime(position[0], at); listener.positionY.setValueAtTime(position[1], at); listener.positionZ.setValueAtTime(position[2], at);
    listener.forwardX.setTargetAtTime(forward[0], at, 0.04); listener.forwardY.setTargetAtTime(forward[1], at, 0.04); listener.forwardZ.setTargetAtTime(forward[2], at, 0.04);
    listener.upX.setTargetAtTime(up[0], at, 0.04); listener.upY.setTargetAtTime(up[1], at, 0.04); listener.upZ.setTargetAtTime(up[2], at, 0.04);
  }

  play(kind: SurfaceSound, position?: readonly [number, number, number], gainScale = 1, center?: () => readonly [number, number, number]): void {
    if (!this.enabled || this.volume <= 0) return;
    const context = this.ensureContext();
    if (!context || !this.master) return;
    void context.resume().catch(() => undefined);
    const spec = SOUND[kind], now = context.currentTime, oscillator = context.createOscillator(), gain = context.createGain();
    const variation = kind === "blaster" ? 0.94 + Math.random() * 0.12 : 1;
    oscillator.type = spec.wave;
    oscillator.frequency.setValueAtTime(spec.start * variation, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, spec.end * variation), now + spec.duration);
    gain.gain.setValueAtTime(Math.max(0.0001, spec.gain * Math.max(0, Math.min(1, Number.isFinite(gainScale) ? gainScale : 1))), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);
    oscillator.connect(gain);
    if (position) {
      const panner = context.createPanner(); panner.panningModel = "HRTF"; panner.distanceModel = "inverse";
      panner.refDistance = 2; panner.maxDistance = 45; panner.rolloffFactor = 1.25;
      panner.positionX.setValueAtTime(position[0], now); panner.positionY.setValueAtTime(position[1], now); panner.positionZ.setValueAtTime(position[2], now);
      const source = center ? { panner, position, origin: [...center()] as [number, number, number], center } : null;
      if (source) this.sources.add(source);
      gain.connect(panner); panner.connect(this.master);
      window.setTimeout(() => { if (source) this.sources.delete(source); try { panner.disconnect(); } catch { /* already disconnected */ } }, Math.ceil(spec.duration * 1000) + 200);
    } else gain.connect(this.master);
    oscillator.start(now); oscillator.stop(now + spec.duration + 0.02);
    window.setTimeout(() => { try { oscillator.disconnect(); gain.disconnect(); } catch { /* already disconnected */ } }, Math.ceil(spec.duration * 1000) + 200);
  }

  /** One bounded voice per local weapon; audio-clock ramps avoid frame-rate dependent pitch. */
  startCharge(durationMs: number): void {
    this.stopCharge();
    if (!this.enabled || this.volume <= 0) return;
    const context = this.ensureContext();
    if (!context || !this.master) return;
    void context.resume().catch(() => undefined);
    const now = context.currentTime, duration = Math.max(.1, durationMs / 1000), gain = context.createGain();
    gain.gain.setValueAtTime(.0001, now); gain.gain.linearRampToValueAtTime(.035, now + .06);
    gain.gain.linearRampToValueAtTime(.065, now + duration); gain.connect(this.master);
    const oscillators = [1, 1.505].map(ratio => {
      const oscillator = context.createOscillator(); oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(160 * ratio, now);
      oscillator.frequency.exponentialRampToValueAtTime(880 * ratio, now + duration);
      oscillator.connect(gain); oscillator.start(now);
      // Safety lifetime even if rendering or input stops unexpectedly.
      oscillator.stop(now + 5.1); return oscillator;
    });
    const voice = this.charge = { oscillators, gain };
    oscillators[0].onended = () => {
      for (const oscillator of oscillators) oscillator.disconnect(); gain.disconnect();
      if (this.charge === voice) this.charge = null;
    };
  }

  stopCharge(): void {
    const voice = this.charge, context = this.context;
    this.charge = null;
    if (!voice || !context) return;
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(.0001, now, .004);
    for (const oscillator of voice.oscillators) { try { oscillator.stop(now + .02); } catch { /* already ended */ } }
  }

  updateSources(): void {
    if (!this.context) return;
    for (const source of this.sources) {
      const center = source.center(), position = source.position.map((n, i) => n + center[i] - source.origin[i]);
      source.panner.positionX.setValueAtTime(position[0], this.context.currentTime);
      source.panner.positionY.setValueAtTime(position[1], this.context.currentTime);
      source.panner.positionZ.setValueAtTime(position[2], this.context.currentTime);
    }
  }

  dispose(): void {
    this.stopCharge();
    this.sources.clear();
    const context = this.context; this.context = null; this.master = null;
    if (context) void context.close().catch(() => undefined);
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Constructor = window.AudioContext;
    if (!Constructor) return null;
    try {
      const context = this.context = new Constructor(), master = this.master = context.createGain();
      master.gain.value = this.enabled ? this.volume : 0; master.connect(context.destination);
      return context;
    } catch { this.context = null; this.master = null; return null; }
  }
}
