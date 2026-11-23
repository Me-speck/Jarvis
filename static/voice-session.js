const RATE = 16000;
const PRE_ROLL = 15; // 300 ms of 20 ms blocks
const END_SILENCE = 37;
const MAX_BLOCKS = 600;

function audioFile(blocks, sourceRate) {
  const samples = new Float32Array(blocks.reduce((length, block) => length + block.length, 0));
  let offset = 0;
  for (const block of blocks) {
    samples.set(block, offset);
    offset += block.length;
  }
  const ratio = sourceRate / RATE;
  const frames = Math.floor(samples.length / ratio);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  function stamp(position, label) {
    for (let i = 0; i < label.length; i++) view.setUint8(position + i, label.charCodeAt(i));
  }
  stamp(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  stamp(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  stamp(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    const start = i * ratio;
    const end = Math.min(samples.length, start + ratio);
    let sum = 0;
    for (let k = Math.floor(start); k < end; k++) {
      const weight = Math.min(end, k + 1) - Math.max(start, k);
      sum += samples[k] * weight;
    }
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sum / ratio)) * 32767, true);
  }
  return new Blob([buffer], {type: "audio/wav"});
}

export class VoiceSession {
  constructor(onAudio, onState) {
    this.onAudio = onAudio;
    this.onState = onState;
    this.window = [];
    this.state = "off";
  }

  resetCapture() {
    this.window = [];
    this.utterance = null;
    this.loud = 0;
    this.quiet = 0;
    this.noise = 0.004;
  }

  setState(state) {
    this.state = state;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = state === "listening";
    this.onState(state);
  }

  async start() {
    this.setState("starting");
    let context;
    try {
      context = new AudioContext();
      this.context = context;
      await context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.context !== context) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      stream.getAudioTracks().forEach(track => track.addEventListener("ended", () => {
        if (this.context === context) this.stop();
      }));
      await context.audioWorklet.addModule("/static/voice-capture.js");
      if (this.context !== context) return;
      this.input = context.createMediaStreamSource(stream);
      this.capture = new AudioWorkletNode(context, "jarvis-capture", { outputChannelCount: [1] });
      this.capture.port.onmessage = event => this.collect(event.data);
      this.input.connect(this.capture);
      this.capture.connect(context.destination);
      this.resume();
    } catch (error) {
      if (context && this.context !== context) return;
      if (this.state !== "off") this.stop();
      throw error;
    }
  }

  pause(state) {
    if (this.state === "off" || this.state === "starting") return;
    this.resetCapture();
    this.setState(state);
  }

  resume() {
    if (!this.context || !this.capture) return;
    this.resetCapture();
    this.setState("listening");
  }

  collect(block) {
    if (this.state !== "listening") return;
    const energy = Math.sqrt(block.reduce((sum, sample) => sum + sample * sample, 0) / block.length);
    const audible = energy > Math.max(0.012, this.noise * 3);
    if (!this.utterance) {
      this.window.push(block);
      if (this.window.length > PRE_ROLL) this.window.shift();
      if (!audible) this.noise = 0.98 * this.noise + 0.02 * energy;
      this.loud = audible ? this.loud + 1 : 0;
      if (this.loud >= 3) this.utterance = this.window.slice();
      return;
    }
    this.utterance.push(block);
    this.quiet = audible ? 0 : this.quiet + 1;
    if (this.quiet >= END_SILENCE || this.utterance.length >= MAX_BLOCKS) {
      const audio = audioFile(this.utterance, this.context.sampleRate);
      this.pause("transcribing");
      this.onAudio(audio);
    }
  }

  async play(buffer) {
    const context = this.context;
    if (!context) return;
    const decoded = await context.decodeAudioData(buffer);
    if (this.context !== context) return;
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    await new Promise(resolve => {
      source.onended = resolve;
      source.start();
      this.playback = source;
    });
    if (this.playback === source) this.playback = null;
  }

  stop() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.input?.disconnect();
    this.capture?.disconnect();
    if (this.capture) this.capture.port.onmessage = null;
    this.playback?.stop();
    this.playback = null;
    const context = this.context;
    this.stream = this.capture = this.input = this.context = null;
    context?.close().catch(() => {});
    this.resetCapture();
    this.setState("off");
  }
}
