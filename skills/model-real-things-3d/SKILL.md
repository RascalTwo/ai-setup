---
name: model-real-things-3d
description: Builds a lifelike 3D model (GLB/glTF) of a real physical object (a PC case, a router, a UPS, furniture) at its true size, and changes it later on request. Use for "make a 3D model of my X", "model this device", "lifelike/photoreal model", "fix the model", or any job that needs Blender driven from an agent.
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    blender: 3D modelling and rendering, driven through the official Blender Lab MCP
    build123d: headless CAD fallback, exported through trimesh
  requires:
    commands: [uv]
    manual: [Blender, Blender Lab MCP, build123d]
---

# Model real things in 3D

A model here is a **script, not a mesh**: one re-runnable build script makes the GLB, so every later fix is a change request against the script. That is what won the 2026-10-16 bakeoff (NAS case): code-built models took change requests in ~8 minutes, while an AI-generated mesh couldn't take them at all.

**Tool:** Blender through the **official Blender Lab MCP** (the winner). **Fallback:** build123d + trimesh, headless, when no Blender window can be open (CI, remote, overnight). Setup and gotchas for both: [`setup.md`](setup.md).

## Steps

1. **Pin the facts.** The real size in mm (width × height × depth) from a spec sheet or a dimension diagram, with its source. Reference photos: product photos for shape, and **the owner's own photos win** wherever they disagree. Ask the owner what photos can't show: which way it faces, where the buttons and ports really are, what's removable. *Done when* the size has a source and you've asked about what's hidden.
2. **Write the build script** (`build.py`) that builds the whole object and exports `<name>.glb`, run inside Blender through the MCP's code tool. glTF conventions: Y up, metres, front facing +Z, centred on the origin. Any part something will move (a side panel, a door, a lid) is its **own named node** with its origin at its own centre. Fine detail (mesh, grilles, perforation) is textures with alpha, not geometry. *Done when* the script runs from scratch to a GLB.
3. **Check it like the judge.** Render with the shared camera and lights, plus close-ups of whatever the owner cares about, and look at the PNGs:
   `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/render.py -- <glb> <png>`
   Score it: `uv run scripts/score.py <glb> <w_mm> <h_mm> <d_mm> [required node ...]`. *Done when* `within_1pct` is true, `missing_nodes` is empty, it's under budget (default 50k triangles, 5 MB), and the renders match the photos.
4. **Hand it to the owner** with the render and the score, and ask what's wrong. Their eye is the real check: in the bakeoff every model passed the scorer and still had the buttons on the wrong side.
5. **Change requests edit the script**, then rerun step 3. Keep each change's what and why in a `NOTES.md` beside the script.

## Picking a tool again

Re-run a bakeoff only for a new kind of object or a new tool. Give every contender the same brief, photos, scorer and renderer, run each as a fresh `claude -p` session, record time, tokens and list-price cost from its JSON, and let the owner judge looks. Include a change-request round: it measures what matters long-term.
