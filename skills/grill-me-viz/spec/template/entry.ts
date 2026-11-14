// One page, two modes: the spec, or its film (#{"mode":"film"}), the way pr-viz has film and review.
// Two literal imports, so the type check can follow both.
if (decodeURIComponent(location.hash).includes('"film"')) await import("./film.js");
else await import("./spec.js");
addEventListener("hashchange", () => location.reload());
