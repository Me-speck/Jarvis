class JarvisCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate * 0.02);
    this.buffer = new Float32Array(this.size);
    this.used = 0;
  }

  process(inputs, outputs) {
    const audio = inputs[0]?.[0];
    // Keep the node connected so the browser processes it without monitoring the mic.
    for (const channel of outputs[0]) channel.fill(0);
    if (audio) {
      for (const sample of audio) {
        this.buffer[this.used++] = sample;
        if (this.used === this.size) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(this.size);
          this.used = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("jarvis-capture", JarvisCapture);
