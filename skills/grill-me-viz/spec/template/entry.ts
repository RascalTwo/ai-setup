// One page, two modes: the spec, or its film (#{"mode":"film"}).
// Two literal imports, so the type check can follow both.
if (decodeURIComponent(location.hash).includes('"film"')) await import("./film.js");
else await import("./spec.js");
addEventListener("hashchange", () => location.reload());
