/**
 * Pilot mode's sound, synthesised with the Web Audio API so there are no audio files to ship.
 * Everything is quiet by default, starts only after the reader has entered Pilot mode (a user gesture,
 * which browsers require), and stops when they leave.
 */

import type { AfterburnerSoundId, EngineSoundId, LaserSoundId, PilotProfile } from "./pilotProfile";

interface Engine {
  saw: OscillatorNode; sub: OscillatorNode; lowpass: BiquadFilterNode; gain: GainNode;
  hiss: AudioBufferSourceNode; hissFilter: BiquadFilterNode; hissGain: GainNode;
  whine: OscillatorNode; whineGain: GainNode; // the high ion-engine whine over the rumble
}

interface RemoteVoice { profile: PilotProfile; engine: OscillatorNode; engineSub: OscillatorNode; engineFilter: BiquadFilterNode; engineGain: GainNode; enginePan: PannerNode; boost: OscillatorNode; boostGain: GainNode; boostPan: PannerNode }
export interface RemoteAudioState { id: string; profile: PilotProfile; position: [number, number, number]; active: boolean; speed: number; thrust: number; boosting: boolean }

const ENGINE_CHARACTER: Record<EngineSoundId, { wave: OscillatorType; sub: OscillatorType; base: number; range: number; subBase: number; subRange: number; filter: number; filterRange: number; hiss: number; whine: number }> = {
  classic: { wave: "sawtooth", sub: "square", base: 48, range: 70, subBase: 24, subRange: 35, filter: 180, filterRange: 900, hiss: 0.05, whine: 0.018 },
  ion: { wave: "triangle", sub: "sine", base: 38, range: 42, subBase: 19, subRange: 21, filter: 145, filterRange: 330, hiss: 0.014, whine: 0.001 },
  turbine: { wave: "sawtooth", sub: "triangle", base: 62, range: 82, subBase: 31, subRange: 41, filter: 230, filterRange: 720, hiss: 0.024, whine: 0.003 },
  stellar: { wave: "sawtooth", sub: "sine", base: 52, range: 58, subBase: 26, subRange: 29, filter: 205, filterRange: 460, hiss: 0.012, whine: 0.002 },
};
const AFTERBURNER_CHARACTER: Record<AfterburnerSoundId, { wave: OscillatorType; holdHz: number; peak: number }> = {
  classic: { wave: "sawtooth", holdHz: 190, peak: 0.12 },
  plasma: { wave: "triangle", holdHz: 82, peak: 0.1 },
  fusion: { wave: "square", holdHz: 56, peak: 0.11 },
  stellar: { wave: "sawtooth", holdHz: 48, peak: 0.095 },
};

export class PilotAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private afterburnerBus: GainNode | null = null;
  private laserBus: GainNode | null = null;
  private remoteEngineBus: GainNode | null = null;
  private remoteAfterburnerBus: GainNode | null = null;
  private remoteLaserBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: Engine | null = null;
  private enabled = true;
  private volume = 0.5;
  private engineMuted = false;
  private afterburnerMuted = false;
  private nearbyAudio = true;
  private remoteAudioActive = false;
  private remoteGainScale = 1;
  private remoteOnly = false;
  private engineSound: EngineSoundId = "classic";
  private afterburnerSound: AfterburnerSoundId = "classic";
  private laserSound: LaserSoundId = "classic";
  private remoteVoices = new Map<string, RemoteVoice>();
  private playedShots = new Set<string>();
  private lastTick = 0;
  private lastUpdate = 0;
  private watchdog = 0;

  setOptions(enabled: boolean, volume: number): void {
    this.enabled = enabled; this.volume = volume;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(enabled ? volume : 0, this.ctx.currentTime, 0.05);
    if (!enabled) { this.stopEngine(); this.setRemoteAudioActive(false); } else if (this.ctx && !this.engine && !this.remoteOnly) this.startEngine();
  }

  setEngineMuted(muted: boolean): void {
    this.engineMuted = muted;
    if (this.engineBus && this.ctx) this.engineBus.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.04);
  }

  setAfterburnerMuted(muted: boolean): void {
    this.afterburnerMuted = muted;
    if (this.afterburnerBus && this.ctx) this.afterburnerBus.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.04);
  }

  setProfile(profile: PilotProfile): void {
    this.engineSound = profile.engine; this.afterburnerSound = profile.afterburner; this.laserSound = profile.laser;
  }

  setNearbyAudio(enabled: boolean): void {
    if (this.nearbyAudio === enabled) return;
    this.nearbyAudio = enabled;
    const t = this.ctx?.currentTime ?? 0;
    for (const bus of [this.remoteEngineBus, this.remoteAfterburnerBus, this.remoteLaserBus]) bus?.gain.setTargetAtTime(enabled ? this.remoteGainScale : 0, t, 0.05);
    if (!enabled) this.clearRemoteVoices();
  }

  setRemoteGainScale(value: number): void {
    this.remoteGainScale = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
    const t = this.ctx?.currentTime ?? 0;
    for (const bus of [this.remoteEngineBus, this.remoteAfterburnerBus, this.remoteLaserBus]) bus?.gain.setTargetAtTime(this.nearbyAudio ? this.remoteGainScale : 0, t, 0.05);
  }

  /** Initialize only the shared remote buses from a surface-mode user gesture, without starting a local ship engine. */
  prepareRemoteAudio(): void {
    if (!this.enabled || !this.initialize()) return;
    this.remoteOnly = true;
    void this.ctx?.resume().catch(() => undefined);
    this.setRemoteAudioActive(true);
  }

  /** Call from a user gesture (entering Pilot mode). */
  start(): void {
    if (!this.enabled) return;
    try {
      this.remoteOnly = false;
      if (!this.initialize()) return;
      void this.ctx!.resume();
      this.startEngine();
      this.sweep(220, 640, 0.32, "sine", 0.16);
    } catch { /* no audio available: Pilot mode works without it */ }
  }

  private initialize(): boolean {
    if (this.ctx) return true;
    try {
      const Ctor: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor(); this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
      this.engineBus = this.ctx.createGain(); this.engineBus.gain.value = this.engineMuted ? 0 : 1; this.engineBus.connect(this.master);
      this.afterburnerBus = this.ctx.createGain(); this.afterburnerBus.gain.value = this.afterburnerMuted ? 0 : 1; this.afterburnerBus.connect(this.master);
      this.laserBus = this.ctx.createGain(); this.laserBus.gain.value = 1; this.laserBus.connect(this.master);
      this.remoteEngineBus = this.ctx.createGain(); this.remoteEngineBus.gain.value = this.nearbyAudio ? this.remoteGainScale : 0; this.remoteEngineBus.connect(this.engineBus);
      this.remoteAfterburnerBus = this.ctx.createGain(); this.remoteAfterburnerBus.gain.value = this.nearbyAudio ? this.remoteGainScale : 0; this.remoteAfterburnerBus.connect(this.afterburnerBus);
      this.remoteLaserBus = this.ctx.createGain(); this.remoteLaserBus.gain.value = this.nearbyAudio ? this.remoteGainScale : 0; this.remoteLaserBus.connect(this.laserBus);
      const len = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf; return true;
    } catch { return false; }
  }

  stop(): void {
    if (!this.ctx) return;
    this.sweep(640, 160, 0.3, "sine", 0.14);
    this.stopEngine();
    this.setRemoteAudioActive(false);
  }

  destroy(): void {
    this.stopEngine();
    this.setRemoteAudioActive(false); this.playedShots.clear();
    window.clearInterval(this.watchdog);
    const c = this.ctx; this.ctx = null; this.master = null; this.engineBus = null; this.afterburnerBus = null; this.laserBus = null;
    this.remoteEngineBus = null; this.remoteAfterburnerBus = null; this.remoteLaserBus = null; this.noise = null;
    if (c) void c.close().catch(() => undefined);
  }

  // ----------------------------------------------------------------- engine

  private startEngine(): void {
    const c = this.ctx, m = this.master; if (!c || !m || this.engine || !this.enabled) return;
    const saw = c.createOscillator(); saw.type = "sawtooth"; saw.frequency.value = 52;
    const sub = c.createOscillator(); sub.type = "square"; sub.frequency.value = 26;
    const lowpass = c.createBiquadFilter(); lowpass.type = "lowpass"; lowpass.frequency.value = 220; lowpass.Q.value = 2;
    const gain = c.createGain(); gain.gain.value = 0;
    const bus = this.engineBus ?? m;
    saw.connect(lowpass); sub.connect(lowpass); lowpass.connect(gain); gain.connect(bus);
    const hiss = c.createBufferSource(); hiss.buffer = this.noise; hiss.loop = true;
    const hissFilter = c.createBiquadFilter(); hissFilter.type = "bandpass"; hissFilter.frequency.value = 600; hissFilter.Q.value = 0.8;
    const hissGain = c.createGain(); hissGain.gain.value = 0;
    hiss.connect(hissFilter); hissFilter.connect(hissGain); hissGain.connect(bus);
    const whine = c.createOscillator(); whine.type = "sine"; whine.frequency.value = 900;
    const whineGain = c.createGain(); whineGain.gain.value = 0;
    whine.connect(whineGain); whineGain.connect(bus);
    saw.start(); sub.start(); hiss.start(); whine.start();
    this.engine = { saw, sub, lowpass, gain, hiss, hissFilter, hissGain, whine, whineGain };
    // If the flight loop stops feeding the engine (tab hidden, view closed, window in the background) it must go quiet, never hold its last note.
    this.lastUpdate = performance.now();
    window.clearInterval(this.watchdog);
    this.watchdog = window.setInterval(() => { if (performance.now() - this.lastUpdate > 300) this.silence(); }, 200);
  }

  private stopEngine(): void {
    window.clearInterval(this.watchdog);
    const e = this.engine, c = this.ctx; if (!e || !c) { this.engine = null; return; }
    this.engine = null;
    const t = c.currentTime;
    e.gain.gain.setTargetAtTime(0, t, 0.08); e.hissGain.gain.setTargetAtTime(0, t, 0.08); e.whineGain.gain.setTargetAtTime(0, t, 0.08);
    window.setTimeout(() => {
      for (const n of [e.saw, e.sub, e.hiss, e.whine]) { try { n.stop(); n.disconnect(); } catch { /* already stopped */ } }
      e.gain.disconnect(); e.hissGain.disconnect(); e.whineGain.disconnect();
    }, 500);
  }

  /** `speed` 0..1 of top speed, `boost` while Shift is down, `thrust` while any movement key is held. */
  update(speed: number, boost: boolean, thrust: boolean): void {
    const e = this.engine, c = this.ctx; if (!e || !c) return;
    this.lastUpdate = performance.now();
    const t = c.currentTime;
    const character = ENGINE_CHARACTER[this.engineSound];
    e.saw.type = character.wave; e.sub.type = character.sub;
    e.saw.frequency.setTargetAtTime(character.base + speed * character.range + (boost ? 12 : 0), t, 0.1);
    e.sub.frequency.setTargetAtTime(character.subBase + speed * character.subRange, t, 0.1);
    e.lowpass.frequency.setTargetAtTime(character.filter + speed * character.filterRange + (boost ? 260 : 0), t, 0.12);
    e.gain.gain.setTargetAtTime(0.025 + speed * 0.09 + (thrust ? 0.015 : 0), t, 0.12);
    e.hissFilter.frequency.setTargetAtTime(500 + speed * 2500, t, 0.15);
    e.hissGain.gain.setTargetAtTime(speed * character.hiss + (boost ? character.hiss * 0.55 : 0), t, 0.12);
    e.whine.frequency.setTargetAtTime(210 + speed * 250 + (boost ? 60 : 0), t, 0.15);
    e.whineGain.gain.setTargetAtTime(character.whine * (0.35 + speed * 0.65), t, 0.15);
  }

  /** Fade the engine to nothing right now (it comes back the next time the flight loop updates it). */
  silence(): void {
    const e = this.engine, c = this.ctx; if (!e || !c) return;
    const t = c.currentTime;
    e.gain.gain.setTargetAtTime(0, t, 0.05); e.hissGain.gain.setTargetAtTime(0, t, 0.05); e.whineGain.gain.setTargetAtTime(0, t, 0.05);
  }

  /** Called when the page is hidden or loses focus: stop all sound at once. */
  mute(on: boolean): void {
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(on || !this.enabled ? 0 : this.volume, this.ctx.currentTime, 0.03);
  }

  // ----------------------------------------------------------------- one-shots

  private env(gain: GainNode, t: number, peak: number, dur: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private sweep(from: number, to: number, dur: number, type: OscillatorType, peak: number, delay = 0, destination?: AudioNode | null): void {
    const c = this.ctx, m = this.master; if (!c || !m || !this.enabled) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    this.env(g, t, peak, dur);
    o.connect(g); g.connect(destination ?? m); o.start(t); o.stop(t + dur + 0.05);
  }

  private burst(dur: number, from: number, to: number, peak: number, delay = 0, destination?: AudioNode | null): void {
    const c = this.ctx, m = this.master; if (!c || !m || !this.noise || !this.enabled) return;
    const t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = "bandpass"; f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    this.env(g, t, peak, dur);
    s.connect(f); f.connect(g); g.connect(destination ?? m); s.start(t); s.stop(t + dur + 0.05);
  }

  /** A blaster bolt: a fast downward chirp with a crack of noise at the start. `i` varies the pitch a little from gun to gun. */
  /** The afterburner lighting: a rising whoosh. */
  afterburner(destination: AudioNode | null = this.afterburnerBus): void {
    if (this.afterburnerSound === "classic") {
      this.burst(0.6, 250, 3000, 0.13, 0, destination); this.sweep(90, 220, 0.5, "sawtooth", 0.07, 0, destination);
    } else if (this.afterburnerSound === "plasma") {
      this.burst(0.42, 380, 115, 0.065, 0, destination); this.sweep(74, 42, 0.48, "sine", 0.09, 0, destination);
      this.sweep(128, 76, 0.4, "triangle", 0.065, 0.015, destination);
    } else if (this.afterburnerSound === "fusion") {
      this.burst(0.5, 260, 90, 0.075, 0, destination); this.sweep(62, 38, 0.55, "square", 0.085, 0, destination);
      this.sweep(108, 64, 0.46, "triangle", 0.052, 0.025, destination);
    } else {
      // Low, layered propulsion with only a short filtered exhaust transient; no sustained high whine.
      this.burst(0.42, 170, 58, 0.035, 0, destination);
      this.sweep(48, 34, 0.52, "sawtooth", 0.075, 0, destination);
      this.sweep(76, 44, 0.46, "triangle", 0.045, 0.015, destination);
    }
  }

  laser(i = 0, sound: LaserSoundId = this.laserSound, destination: AudioNode | null = this.laserBus): void {
    const k = 1 + (i % 4) * 0.06;
    if (sound === "classic") {
      this.sweep(2600 * k, 260 * k, 0.2, "sawtooth", 0.1, 0, destination);
      this.sweep(1300 * k, 130 * k, 0.16, "square", 0.045, 0, destination);
      this.burst(0.05, 5000, 1500, 0.06, 0, destination);
    } else if (sound === "pulse") {
      this.sweep(1500 * k, 320 * k, 0.12, "triangle", 0.085, 0, destination);
      this.sweep(220 * k, 90 * k, 0.18, "sine", 0.05, 0, destination);
    } else if (sound === "arc") {
      this.burst(0.07, 4200, 500, 0.072, 0, destination);
      this.sweep(1850 * k, 260 * k, 0.15, "sawtooth", 0.075, 0, destination);
      this.sweep(620 * k, 110 * k, 0.22, "sine", 0.055, 0, destination);
    } else {
      this.burst(0.055, 2900, 760, 0.055, 0, destination);
      this.sweep(2250 * k, 185 * k, 0.18, "sawtooth", 0.085, 0, destination);
      this.sweep(540 * k, 82 * k, 0.23, "triangle", 0.05, 0, destination);
    }
  }

  /** Deeper, slower cannon report, routed with local or nearby blaster audio. */
  cannon(destination: AudioNode | null = this.laserBus): void {
    this.sweep(780, 115, 0.24, "sawtooth", 0.12, 0, destination);
    this.sweep(160, 48, 0.3, "sine", 0.09, 0, destination);
    this.burst(0.035, 1200, 220, 0.035, 0, destination);
  }

  preview(kind: "engine" | "afterburner" | "laser"): void {
    if (!this.enabled || !this.initialize()) return;
    void this.ctx!.resume();
    if (kind === "engine") {
      const character = ENGINE_CHARACTER[this.engineSound];
      this.sweep(character.base * 2.3, character.base * 0.85, 0.42, character.wave, 0.1, 0, this.engineBus);
      this.sweep(character.subBase * 2, character.subBase, 0.38, character.sub, 0.07, 0, this.engineBus);
      this.burst(0.32, 360, 100, character.hiss * 0.55, 0, this.engineBus);
    } else if (kind === "afterburner") this.afterburner(this.afterburnerBus);
    else this.laser(0);
  }

  updateRemoteAudio(listener: { position: [number, number, number]; forward: [number, number, number]; up: [number, number, number] }, players: RemoteAudioState[], active: boolean): void {
    const ctx = this.ctx;
    const shouldPlay = !!ctx && this.nearbyAudio && active && this.enabled;
    this.setRemoteAudioActive(shouldPlay);
    if (!shouldPlay || !ctx) return;
    const l = ctx.listener;
    l.setPosition(...listener.position); l.setOrientation(...listener.forward, ...listener.up);
    const live = new Set<string>();
    for (const player of players) {
      if (!player.active) continue;
      live.add(player.id);
      let voice: RemoteVoice | null = this.remoteVoices.get(player.id) ?? null;
      if (!voice) { voice = this.createRemoteVoice(player); if (!voice) continue; this.remoteVoices.set(player.id, voice); }
      voice.profile = player.profile;
      const engine = ENGINE_CHARACTER[player.profile.engine], boost = AFTERBURNER_CHARACTER[player.profile.afterburner], speed = Math.min(1, player.speed / 300);
      voice.engine.type = engine.wave; voice.engineSub.type = engine.sub;
      voice.engine.frequency.setTargetAtTime(engine.base + speed * engine.range, ctx.currentTime, 0.14);
      voice.engineSub.frequency.setTargetAtTime(engine.subBase + speed * engine.subRange, ctx.currentTime, 0.14);
      voice.engineFilter.frequency.setTargetAtTime(engine.filter + speed * engine.filterRange, ctx.currentTime, 0.14);
      voice.boost.type = boost.wave;
      voice.boost.frequency.setTargetAtTime(boost.holdHz, ctx.currentTime, 0.06);
      this.place(voice.enginePan, player.position); this.place(voice.boostPan, player.position);
      const distance = Math.hypot(player.position[0] - listener.position[0], player.position[1] - listener.position[1], player.position[2] - listener.position[2]);
      const fade = Math.max(0, Math.min(1, (800 - distance) / 760));
      voice.engineGain.gain.setTargetAtTime(player.thrust ? (0.012 + Math.min(1, player.speed / 300) * 0.025) * fade : 0, ctx.currentTime, 0.08);
      voice.boostGain.gain.setTargetAtTime(player.boosting ? boost.peak * 0.22 * fade : 0, ctx.currentTime, 0.04);
    }
    for (const id of this.remoteVoices.keys()) if (!live.has(id)) this.removeRemoteVoice(id);
  }

  remoteLaser(id: string, shotId: string, sound: LaserSoundId, position: [number, number, number], startedAt: number): void {
    const ctx = this.ctx, bus = this.remoteLaserBus;
    if (!ctx || !bus || !this.remoteAudioActive || !this.nearbyAudio || !this.enabled || !id || this.playedShots.has(shotId) || Date.now() - startedAt > 500 || startedAt > Date.now() + 1000) return;
    this.playedShots.add(shotId); if (this.playedShots.size > 512) this.playedShots.delete(this.playedShots.values().next().value!);
    const pan = ctx.createPanner(); pan.panningModel = "HRTF"; pan.distanceModel = "inverse"; pan.refDistance = 40; pan.maxDistance = 800; pan.rolloffFactor = 1.2;
    this.place(pan, position); pan.connect(bus); this.laser(0, sound, pan); window.setTimeout(() => { try { pan.disconnect(); } catch { /* already disconnected */ } }, 700);
  }

  remoteShot(id: string, shotId: string, sound: LaserSoundId, weapon: 0 | 1, position: [number, number, number], startedAt: number): void {
    const ctx = this.ctx, bus = this.remoteLaserBus;
    if (!ctx || !bus || !this.remoteAudioActive || !this.nearbyAudio || !this.enabled || !id || this.playedShots.has(shotId) || Date.now() - startedAt > 500 || startedAt > Date.now() + 1000) return;
    this.playedShots.add(shotId); if (this.playedShots.size > 512) this.playedShots.delete(this.playedShots.values().next().value!);
    const pan = ctx.createPanner(); pan.panningModel = "HRTF"; pan.distanceModel = "inverse"; pan.refDistance = 40; pan.maxDistance = 800; pan.rolloffFactor = 1.2;
    this.place(pan, position); pan.connect(bus);
    if (weapon === 1) this.cannon(pan); else this.laser(0, sound, pan);
    window.setTimeout(() => { try { pan.disconnect(); } catch { /* already disconnected */ } }, 800);
  }

  weaponSwitch(weapon: 0 | 1): void {
    if (!this.enabled || !this.initialize()) return;
    void this.ctx!.resume();
    this.sweep(weapon === 1 ? 460 : 720, weapon === 1 ? 220 : 360, 0.08, "triangle", 0.045, 0, this.laserBus);
  }

  private place(panner: PannerNode, p: [number, number, number]): void { panner.setPosition(p[0], p[1], p[2]); }
  private createRemoteVoice(player: RemoteAudioState): RemoteVoice | null {
    const ctx = this.ctx, engineBus = this.remoteEngineBus, boostBus = this.remoteAfterburnerBus; if (!ctx || !engineBus || !boostBus) return null;
    const engine = ctx.createOscillator(), engineSub = ctx.createOscillator(), engineFilter = ctx.createBiquadFilter(), engineGain = ctx.createGain(), enginePan = ctx.createPanner();
    const character = ENGINE_CHARACTER[player.profile.engine];
    engine.type = character.wave; engine.frequency.value = character.base; engineSub.type = character.sub; engineSub.frequency.value = character.subBase;
    engineFilter.type = "lowpass"; engineFilter.frequency.value = 300; engineGain.gain.value = 0;
    enginePan.panningModel = "HRTF"; enginePan.distanceModel = "inverse"; enginePan.refDistance = 40; enginePan.maxDistance = 800; enginePan.rolloffFactor = 1.2;
    engine.connect(engineFilter); engineSub.connect(engineFilter); engineFilter.connect(engineGain); engineGain.connect(enginePan); enginePan.connect(engineBus); engine.start(); engineSub.start();
    const boost = ctx.createOscillator(), boostGain = ctx.createGain(), boostPan = ctx.createPanner();
    const boostCharacter = AFTERBURNER_CHARACTER[player.profile.afterburner];
    boost.type = boostCharacter.wave; boost.frequency.value = boostCharacter.holdHz; boostGain.gain.value = 0;
    boostPan.panningModel = "HRTF"; boostPan.distanceModel = "inverse"; boostPan.refDistance = 40; boostPan.maxDistance = 800; boostPan.rolloffFactor = 1.2;
    boost.connect(boostGain); boostGain.connect(boostPan); boostPan.connect(boostBus); boost.start();
    return { profile: player.profile, engine, engineSub, engineFilter, engineGain, enginePan, boost, boostGain, boostPan };
  }
  private removeRemoteVoice(id: string): void {
    const voice = this.remoteVoices.get(id); if (!voice) return; this.remoteVoices.delete(id);
    try { voice.engine.stop(); voice.engineSub.stop(); voice.boost.stop(); } catch { /* already stopped */ }
    for (const node of [voice.engine, voice.engineSub, voice.engineFilter, voice.engineGain, voice.enginePan, voice.boost, voice.boostGain, voice.boostPan]) try { node.disconnect(); } catch { /* already disconnected */ }
  }
  private clearRemoteVoices(): void { for (const id of this.remoteVoices.keys()) this.removeRemoteVoice(id); }
  setRemoteAudioActive(active: boolean): void {
    this.remoteAudioActive = active && this.nearbyAudio && this.enabled;
    if (!this.remoteAudioActive) this.clearRemoteVoices();
  }
  /** The ship hitting a note: a heavy thud and a crunch, louder for a harder hit. */
  bump(power: number): void {
    const p = 0.35 + 0.65 * power;
    this.sweep(120, 32, 0.32, "sine", 0.32 * p);
    this.burst(0.2, 900, 90, 0.16 * p);
    this.sweep(300, 70, 0.12, "square", 0.06 * p);
  }

  /** A bolt landing on a note: a small thump and a bright ping. */
  hit(): void {
    this.sweep(140, 40, 0.28, "sine", 0.22);
    this.burst(0.22, 1800, 160, 0.12);
    this.sweep(760, 1180, 0.1, "sine", 0.09, 0.02);
  }
  open(): void { [660, 880, 1320].forEach((f, i) => this.sweep(f, f * 1.02, 0.16, "triangle", 0.14, i * 0.07)); }
  lock(on: boolean): void { this.sweep(on ? 700 : 520, on ? 1050 : 340, 0.09, "sine", 0.12); }
  warp(ms: number): void {
    const d = ms / 1000;
    this.burst(d, 200, 3200, 0.16);
    this.sweep(140, 55, d, "sine", 0.12);
    this.sweep(300, 2400, d * 0.85, "triangle", 0.05); // the whine climbs, then the ship drops out of the jump with a thump
    this.sweep(110, 35, 0.4, "sine", 0.24, d * 0.92);
    this.burst(0.3, 1500, 120, 0.1, d * 0.92);
  }
  /** A faint tick when the crosshair moves onto a note; limited so sweeping across a dense cluster stays calm. */
  tick(): void {
    const c = this.ctx; if (!c) return;
    const now = c.currentTime; if (now - this.lastTick < 0.09) return;
    this.lastTick = now;
    this.sweep(2100, 1900, 0.025, "sine", 0.035);
  }
}
