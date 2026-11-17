// GENERATED from kit/src/parakeet-worker.ts by `bun run sync:kit` — edit that file, not this one.
// parakeet-worker.js — holds Parakeet (parakeet.js 1.4.4, WebGPU) off the main thread for feedback.js.
// The model files come from the IndexedDB cache this origin already has (2.4 GB, downloaded once).
export {}; // a module, as it is loaded (tsc emits this line anyway)
let model;
// oxlint-disable-next-line unicorn/prefer-top-level-await -- awaiting at the top would leave `onmessage` unset while the model loads, dropping early segments
const ready = (async () => {
    const t0 = performance.now();
    try {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CDN boundary: parakeet.js ships no types here
        const { fromHub } = (await import("https://esm.sh/parakeet.js@1.4.4"));
        model = await fromHub("parakeet-tdt-0.6b-v3", {
            backend: "webgpu",
            encoderQuant: "fp32",
            decoderQuant: "int8",
            preprocessorBackend: "js",
            progress: ({ file, loaded, total }) => postMessage({ type: "progress", file, loaded, total }),
        });
        // Warm-up on a second of silence so the first real segment isn't paying for shader compiles.
        await model.transcribe(new Float32Array(16000), 16000);
        postMessage({ type: "ready", ms: Math.round(performance.now() - t0) });
    }
    catch (e) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- thrown values are unknown: read the message when there is one
        postMessage({ type: "error", message: String(e?.message ?? e) });
    }
})();
/** Transcribe one segment of audio the page posted, and post the text back. */
async function transcribeSegment({ id, pcm }) {
    await ready;
    if (!model)
        return; // loading failed; the error was already posted
    const t0 = performance.now();
    const r = await model.transcribe(pcm, 16000);
    postMessage({
        type: "text",
        id,
        text: r.utterance_text ?? r.text ?? "",
        ms: Math.round(performance.now() - t0),
        secs: pcm.length / 16000,
    });
}
addEventListener("message", ({ data }) => {
    // oxlint-disable-next-line eslint/no-void -- fire and forget, as the old async onmessage was: a failure stays an unhandled rejection in the worker
    void transcribeSegment(data);
});
