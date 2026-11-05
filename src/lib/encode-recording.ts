// The encoder is loaded only when a recording is finalized.
export async function encodeRecording(blob: Blob): Promise<File> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration <= 0 || decoded.duration > 301) throw new Error("Grave um áudio de até 5 minutos.");
    const renderer = new OfflineAudioContext(1, Math.ceil(decoded.duration * 44100), 44100);
    const source = renderer.createBufferSource();
    source.buffer = decoded;
    source.connect(renderer.destination);
    source.start();
    const mono = (await renderer.startRendering()).getChannelData(0);
    return await encodeMonoMp3(mono);
  } finally { await context.close(); }
}

export async function encodeMonoMp3(mono: Float32Array): Promise<File> {
    const { Mp3Encoder } = await import("@breezystack/lamejs");
    const encoder = new Mp3Encoder(1, 44100, 96);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    for (let i = 0; i < mono.length; i += 1152) {
      const pcm = new Int16Array(Math.min(1152, mono.length - i));
      for (let j = 0; j < pcm.length; j++) {
        const n = Math.max(-1, Math.min(1, mono[i + j]));
        pcm[j] = n < 0 ? n * 32768 : n * 32767;
      }
      const bytes = encoder.encodeBuffer(pcm);
      if (bytes.length) chunks.push(new Uint8Array(bytes));
      if (i % (1152 * 100) === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const end = encoder.flush();
    if (end.length) chunks.push(new Uint8Array(end));
    return new File(chunks, "audio-" + Date.now() + ".mp3", { type: "audio/mpeg" });
}
