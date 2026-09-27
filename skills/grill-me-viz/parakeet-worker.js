// parakeet-worker.js — holds Parakeet (parakeet.js 1.4.4, WebGPU) off the main thread for grill-voice.js.
// The model files come from the IndexedDB cache this origin already has (2.4 GB, downloaded once).
let model;
const ready = (async () => {
  const t0 = performance.now();
  const { fromHub } = await import("https://esm.sh/parakeet.js@1.4.4");
  model = await fromHub("parakeet-tdt-0.6b-v3", {
    backend: "webgpu", encoderQuant: "fp32", decoderQuant: "int8", preprocessorBackend: "js",
    progress: ({ file, loaded, total }) => postMessage({ type: "progress", file, loaded, total }),
  });
  // Warm-up on a second of silence so the first real segment isn't paying for shader compiles.
  await model.transcribe(new Float32Array(16000), 16000);
  postMessage({ type: "ready", ms: Math.round(performance.now() - t0) });
})().catch((e) => postMessage({ type: "error", message: String(e?.message ?? e) }));

onmessage = async ({ data }) => {
  await ready;
  const t0 = performance.now();
  const r = await model.transcribe(data.pcm, 16000);
  postMessage({ type: "text", id: data.id, text: r.utterance_text ?? r.text ?? "", ms: Math.round(performance.now() - t0), secs: data.pcm.length / 16000 });
};
