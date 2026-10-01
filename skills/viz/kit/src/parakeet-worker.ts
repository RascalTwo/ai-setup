// parakeet-worker.js — holds Parakeet (parakeet.js 1.4.4, WebGPU) off the main thread for feedback.js.
// The model files come from the IndexedDB cache this origin already has (2.4 GB, downloaded once).

/** What this worker needs of a parakeet.js model; the library itself is untyped (a CDN import). */
interface Model { transcribe(pcm: Float32Array, rate: number): Promise<{ utterance_text?: string; text?: string }> }

let model: Model | undefined;
const ready = (async () => {
  const t0 = performance.now();
  const { fromHub } = await import("https://esm.sh/parakeet.js@1.4.4");
  model = (await fromHub("parakeet-tdt-0.6b-v3", {
    backend: "webgpu", encoderQuant: "fp32", decoderQuant: "int8", preprocessorBackend: "js",
    progress: ({ file, loaded, total }: { file: string; loaded: number; total: number }) => postMessage({ type: "progress", file, loaded, total }),
  })) as Model;
  // Warm-up on a second of silence so the first real segment isn't paying for shader compiles.
  await model.transcribe(new Float32Array(16000), 16000);
  postMessage({ type: "ready", ms: Math.round(performance.now() - t0) });
})().catch((e: unknown) => postMessage({ type: "error", message: String((e as Error | undefined)?.message ?? e) }));

onmessage = async ({ data }: MessageEvent<{ id: number; pcm: Float32Array }>) => {
  await ready;
  if (!model) return; // loading failed; the error was already posted
  const t0 = performance.now();
  const r = await model.transcribe(data.pcm, 16000);
  postMessage({ type: "text", id: data.id, text: r.utterance_text ?? r.text ?? "", ms: Math.round(performance.now() - t0), secs: data.pcm.length / 16000 });
};
