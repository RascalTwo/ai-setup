#!/usr/bin/env python3
"""dream: cluster candidate moments by ROOT CAUSE using local embeddings. No LLM call.

Reads every `state/candidates/*.jsonl`, embeds each candidate's `text` with Ollama
`nomic-embed-text`, and agglomerates by cosine distance so the same underlying problem
groups together even when it surfaced in different sessions with different wording.

Why agglomerative-with-a-threshold and not k-means: we do not know how many distinct root
causes a week of transcripts contains, and the number changes every run. A distance
threshold answers "are these the same problem?" directly; k does not. Average linkage
(not single) because single linkage chains unrelated candidates through bridge points, and
chaining is exactly the failure that produces mushy, unactionable proposals.

Usage:
  cluster.py [--state DIR] [--threshold 0.34] [--linkage average] [--batch 64]
             [--model nomic-embed-text:latest] [--no-prefix] [--json]

Output: `state/clusters.json`. Embeddings are cached in `state/embeddings.jsonl` keyed by
sha256(model + text), so re-runs only embed candidates that are genuinely new.
"""
import argparse, hashlib, json, os, sys, time, urllib.error, urllib.request
from collections import Counter

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

OLLAMA_HOST = "http://localhost:11434"
# /api/embed (not the older /api/embeddings) because it accepts a LIST of inputs in one
# request. One-request-per-candidate is the difference between seconds and minutes at
# corpus scale. The two endpoints return the same vector direction — /api/embed just
# returns it pre-normalized (verified: cosine 1.00000000 between them) — so the distance
# threshold below is unaffected by the choice.
EMBED_URL = f"{OLLAMA_HOST}/api/embed"
# nomic-embed-text is prefix-conditioned and Ollama does NOT apply a prefix for you (an
# unprefixed prompt yields a measurably different, worse-separated space). Measured on the
# fixture set, "search_document: " beat "clustering: ", "classification: " and no prefix.
PREFIX = "search_document: "

# Cosine-distance merge cutoff. Measured on the fixture set: separation is clean up to
# 0.35 and falls off a cliff at 0.36, where distinct root causes merge into one mush
# cluster and unrelated candidates get dragged in. 0.34 sits inside the good window, one
# step back from the cliff. Erring LOW is the safe direction: too low over-splits one root
# cause into two similar proposals (annoying), too high fuses two root causes into one
# unactionable proposal (worthless, and the exact failure this system exists to avoid).
# Recalibrated 2026-08-16, from 0.34. The 0.34 figure was swept on a corpus with
# ZERO assistant turns; the capture rewrite made assistant moments 43% of the
# population, and assistant prose is far more homogeneous than dictated human
# speech -- same model, same register -- so at 0.34 it chains on STYLE rather
# than root cause. Measured on 1,976 real candidates: one cluster swallowed 450
# members across 49 sessions (cohesion 0.67) and the top two held 31% of the
# corpus, mixing "I over-deleted the Alarms section" with "Okay, so these are
# deterministic things. I guess I like that."
#
# Sweep: largest cluster 450 -> 58 -> 50 -> 27 at 0.34 / 0.28 / 0.24 / 0.20, and
# multi-member clusters PEAK at 0.24 (466) before falling to 265 at 0.20 --
# below 0.24 genuine groups start fragmenting. 0.24 is the peak-coverage,
# highest-cohesion point that is still above the fragmentation knee.
#
# If the role mix shifts again (a new tool's transcripts, endorsements at
# volume), re-run the sweep. This constant is population-dependent, not universal.
DEFAULT_THRESHOLD = 0.24
DEFAULT_STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "state")


def key_for(model: str, text: str, prefix: str = "") -> str:
    """Cache key covers the exact string sent to the model, prefix included — a prefix
    change produces different vectors and must not silently reuse the old ones."""
    return hashlib.sha256(f"{model}\0{prefix}\0{text}".encode()).hexdigest()[:32]


def load_candidates(cand_dir: str) -> list[dict]:
    """Every candidate line across every session file, deduped on (session_id, uuid, seq).

    `seq` is load-bearing: one dictated 300-word turn holds 6-10 separate decisions and the
    capture layer now emits each as its own moment under the SAME message uuid. Deduping on
    uuid alone silently throws all but one of them away.
    """
    out, seen = [], set()
    if not os.path.isdir(cand_dir):
        return out
    for name in sorted(os.listdir(cand_dir)):
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(cand_dir, name), encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    c = json.loads(line)
                except json.JSONDecodeError:
                    print(f"warn: {name}:{lineno} not JSON, skipped", file=sys.stderr)
                    continue
                text = (c.get("text") or "").strip()
                if not text:
                    continue
                # Fall back to the file stem when the capture layer omits session_id.
                c.setdefault("session_id", name[: -len(".jsonl")])
                ident = (c["session_id"], c.get("uuid") or f"{name}:{lineno}", c.get("seq", 0))
                if ident in seen:
                    continue
                seen.add(ident)
                c["text"] = text
                out.append(c)
    return out


def load_cache(path: str, model: str) -> dict[str, list[float]]:
    cache = {}
    if not os.path.exists(path):
        return cache
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("model") == model and rec.get("key") and rec.get("embedding"):
                cache[rec["key"]] = rec["embedding"]
    return cache


class OllamaUnavailable(RuntimeError):
    """Ollama is not usable right now. Raised early so we fail in seconds, not minutes."""


def preflight(model: str, timeout: int = 10) -> None:
    """Confirm Ollama is up and the model exists BEFORE doing any work.

    Without this, a stopped Ollama or a typo'd model name is only discovered after the
    whole corpus has been queued, and the run burns minutes to reach a failure that was
    knowable in one request.
    """
    try:
        with urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=timeout) as r:
            names = {m.get("name") for m in json.loads(r.read()).get("models", [])}
    except Exception as e:
        raise OllamaUnavailable(
            f"cannot reach Ollama at {OLLAMA_HOST} ({e}). Is `ollama serve` running?") from e
    if model not in names and f"{model}:latest" not in names:
        raise OllamaUnavailable(
            f"model {model!r} is not installed. Have: {', '.join(sorted(names)) or '(none)'}. "
            f"Install with `ollama pull {model}`.")

    # A model can be *listed* but still unloadable when another model is hogging memory —
    # Ollama then stalls the request rather than erroring. One tiny probe with a short
    # timeout turns that silent hang into an immediate, explanatory failure.
    try:
        embed_batch(model, ["preflight"], timeout=90)
    except TimeoutError as e:
        raise OllamaUnavailable(
            f"{model} is installed but did not return an embedding within 90s. Ollama "
            f"stalls like this when another model still occupies memory. Check "
            f"`curl -s {OLLAMA_HOST}/api/ps` and free it (POST /api/generate with "
            f'{{"model":"<name>","keep_alive":0}}).') from e


def _embed_once(model: str, texts: list[str], timeout: int) -> list[list[float]]:
    """keep_alive is deliberately short: a big model left resident starves this one and
    makes Ollama stall, so nothing in this pipeline pins a model longer than it is using it."""
    body = json.dumps({"model": model, "input": texts, "keep_alive": "5m"}).encode()
    req = urllib.request.Request(EMBED_URL, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        embs = json.loads(r.read()).get("embeddings")
    if not embs or len(embs) != len(texts):
        raise ValueError(f"expected {len(texts)} embeddings, got {len(embs) if embs else 0}")
    return embs


def embed_batch(model: str, texts: list[str], timeout: int = 180,
                attempts: int = 3) -> list[list[float]]:
    """Embed a list in one request, waiting out transient stalls.

    Ollama is a SHARED resource: interactive sessions and other jobs load their own models
    into the same memory, and while a large one is resident, embedding requests queue
    instead of failing. The fix is patience, not parallelism — splitting the batch would
    only put MORE requests behind the same blocked queue. So back off and retry the same
    request, and let a genuinely dead Ollama surface after the last attempt.
    """
    for attempt in range(attempts):
        try:
            return _embed_once(model, texts, timeout)
        except (TimeoutError, urllib.error.URLError, ValueError) as e:
            if attempt == attempts - 1:
                raise OllamaUnavailable(
                    f"{model} failed {attempts}x on a batch of {len(texts)} (last: {e}). "
                    f"Another model is probably holding memory — check "
                    f"`curl -s {OLLAMA_HOST}/api/ps`.") from e
            wait = 10 * (attempt + 1)
            print(f"  embed stalled ({e}); retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError("unreachable")


def embed_all(cands, model, prefix, cache_path, batch_size) -> np.ndarray:
    """L2-normalized embedding matrix, one row per candidate. Cache-first, append-on-miss."""
    cache = load_cache(cache_path, model)
    keys = [key_for(model, c["text"], prefix) for c in cands]
    by_key = {}
    for k, c in zip(keys, cands):
        by_key.setdefault(k, c["text"])
    missing = sorted({k for k in keys if k not in cache})

    if not missing:
        print(f"embedded 0 new ({len(keys)} cached, 100% hit)", file=sys.stderr)
    else:
        t0 = time.time()
        os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
        done = 0
        # Append each batch as it lands. A crash or Ctrl-C mid-run then costs only the
        # current batch; the next run picks up from the cache instead of starting over.
        with open(cache_path, "a", encoding="utf-8") as fh:
            for i in range(0, len(missing), batch_size):
                chunk = missing[i:i + batch_size]
                embs = embed_batch(model, [prefix + by_key[k] for k in chunk])
                for k, e in zip(chunk, embs):
                    cache[k] = e
                    fh.write(json.dumps({"key": k, "model": model, "dim": len(e),
                                         "embedding": e}) + "\n")
                fh.flush()
                done += len(chunk)
                if len(missing) > batch_size:
                    print(f"  embedded {done}/{len(missing)} "
                          f"({time.time() - t0:.1f}s)", file=sys.stderr)
        hit = 100.0 * (len(keys) - len(missing)) / max(len(keys), 1)
        print(f"embedded {len(missing)} new ({len(keys) - len(missing)} cached, "
              f"{hit:.0f}% hit) in {time.time() - t0:.1f}s", file=sys.stderr)

    m = np.array([cache[k] for k in keys], dtype=np.float64)
    return m / np.clip(np.linalg.norm(m, axis=1, keepdims=True), 1e-12, None)


def cluster_labels(m: np.ndarray, threshold: float, method: str) -> np.ndarray:
    if len(m) == 1:
        return np.array([1])
    # Normalized rows => cosine distance is 1 - dot. Build it directly; it is exact and
    # avoids scipy's pdist recomputing norms for every pair.
    d = np.clip(1.0 - m @ m.T, 0.0, 2.0)
    np.fill_diagonal(d, 0.0)
    return fcluster(linkage(squareform(d, checks=False), method=method),
                    t=threshold, criterion="distance")


def occurrences(members: list[dict]) -> int:
    """How many independent times this happened -- the number `rank` multiplies.

    One parent session routinely fans out to 6 subagents (mean 6.2, max 155
    measured over 659 parents), and they are given the same brief, hit the same
    environment and make the same mistake. Counting each as its own occurrence
    would let a single event outrank a problem that genuinely recurred across
    six weeks of work. So all subagent moments sharing a parent session collapse
    to one.

    The SAME hazard arrives from segmentation, and it is the larger one. Stage 1
    splits a dictated turn into ~15-word segments, so one turn now yields many
    moments -- measured 2026-08-16: 35% of source turns produce more than one
    kept candidate, 63% of all candidates belong to such a turn, and the worst
    single turn produced 14. Counting those as 14 independent occurrences would
    re-create, in the RANKING, exactly the verbosity bias the capture rewrite
    removed: whoever talks longest scores highest. Segments of one message are
    one event, so they collapse on (session_id, uuid).

    A turn whose separate objections land in DIFFERENT clusters still counts once
    in each -- correct, they are different findings.
    """
    seen = set()
    for mem in members:
        if mem.get("agent_id"):
            # subagent fan-out: the parent session is the event
            key = ("parent", mem.get("session_id") or "")
        else:
            # segmentation fan-out: the source message is the event
            key = ("msg", mem.get("session_id") or "", mem.get("uuid") or "")
        seen.add(key)
    return len(seen)


def build_clusters(cands, m, labels) -> list[dict]:
    groups: dict[int, list[int]] = {}
    for i, lab in enumerate(labels):
        groups.setdefault(int(lab), []).append(i)

    clusters = []
    for idxs in groups.values():
        sub = m[idxs]
        # Medoid = member closest to the group centroid. It is the least-weird phrasing of
        # the shared problem, so it is what the synthesis prompt leads with.
        centroid = sub.mean(axis=0)
        centroid /= max(float(np.linalg.norm(centroid)), 1e-12)
        order = list(np.argsort(-(sub @ centroid)))
        idxs = [idxs[j] for j in order]

        members = [{k: cands[i].get(k) for k in
                    ("session_id", "uuid", "ts", "project", "tool", "kind", "text",
                     "context", "source", "agent_id")} for i in idxs]
        sessions = sorted({mem["session_id"] for mem in members if mem["session_id"]})
        pair = sub @ sub.T
        n = len(idxs)
        cohesion = ((pair.sum() - n) / (n * n - n)) if n > 1 else 1.0
        clusters.append({
            "occurrences": occurrences(members),
            "sessions": sessions,
            "session_count": len(sessions),
            "projects": sorted({mem["project"] for mem in members if mem.get("project")}),
            "kinds": dict(Counter(mem["kind"] for mem in members if mem.get("kind"))),
            "cohesion": round(float(cohesion), 4),
            "exemplar": members[0]["text"],
            "members": members,
        })

    # Rank by how much evidence there is, then how widely it spread. Cross-session
    # repetition is the strongest signal that something is a real root cause.
    clusters.sort(key=lambda c: (-c["occurrences"], -c["session_count"]))
    for i, c in enumerate(clusters, 1):
        c["cluster_id"] = f"c{i:03d}"
        # Stable across runs given the same membership: lets synthesize.py skip work it
        # has already done without re-reading every proposal envelope.
        c["cluster_key"] = hashlib.sha256(
            "\n".join(sorted(f"{mem['session_id']}:{mem['uuid']}" for mem in c["members"]))
            .encode()).hexdigest()[:16]
    return clusters


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state", default=DEFAULT_STATE, help="dream state directory")
    ap.add_argument("--model", default="nomic-embed-text:latest")
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                    help="cosine-distance merge cutoff; lower = tighter clusters")
    ap.add_argument("--linkage", default="average",
                    choices=["average", "complete", "single", "weighted"])
    ap.add_argument("--batch", type=int, default=64,
                    help="candidates per /api/embed request")
    ap.add_argument("--no-prefix", action="store_true",
                    help=f"skip the nomic {PREFIX!r} task prefix (measurably worse)")
    ap.add_argument("--json", action="store_true", help="also print clusters.json to stdout")
    a = ap.parse_args()

    state = os.path.abspath(a.state)
    cands = load_candidates(os.path.join(state, "candidates"))
    if not cands:
        print("no candidates found; nothing to cluster", file=sys.stderr)
        # Still write an empty file so downstream steps have something well-formed to read.
        cands = []

    t0 = time.time()
    clusters = []
    if cands:
        # Fail in seconds on an unusable Ollama rather than after embedding the corpus.
        preflight(a.model)
        m = embed_all(cands, a.model, "" if a.no_prefix else PREFIX,
                      os.path.join(state, "embeddings.jsonl"), a.batch)
        clusters = build_clusters(cands, m, cluster_labels(m, a.threshold, a.linkage))

    doc = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": a.model,
        "threshold": a.threshold,
        "linkage": a.linkage,
        "prefix": "" if a.no_prefix else PREFIX,
        "candidate_count": len(cands),
        "cluster_count": len(clusters),
        "elapsed_sec": round(time.time() - t0, 2),
        "clusters": clusters,
    }
    os.makedirs(state, exist_ok=True)
    out = os.path.join(state, "clusters.json")
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, out)

    multi = [c for c in clusters if c["occurrences"] > 1]
    print(f"{len(cands)} candidates -> {len(clusters)} clusters "
          f"({len(multi)} with >1 member) in {doc['elapsed_sec']}s -> {out}",
          file=sys.stderr)
    if a.json:
        json.dump(doc, sys.stdout, indent=2, ensure_ascii=False)
        print()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except OllamaUnavailable as e:
        # Loud, single-line, actionable — this lands in the nightly log where nobody is
        # watching, so it has to explain itself without a traceback to read.
        print(f"FATAL cluster.py: {e}", file=sys.stderr)
        sys.exit(2)
    except KeyboardInterrupt:
        print("interrupted; embeddings computed so far are cached", file=sys.stderr)
        sys.exit(130)
