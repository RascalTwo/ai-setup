# Setup and gotchas

## Official Blender Lab MCP (default)

- Blender 5.1+ (`brew install --cask blender`). The add-on is an extension: `Blender --command extension install-file -r user_default mcp-<version>.zip`, from `https://projects.blender.org/lab/blender_mcp/releases`, then enable `bl_ext.user_default.mcp` in Preferences (or headless: `bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mcp")` + `bpy.ops.wm.save_userpref()`).
- **The server only starts when Blender may go online.** Launch with `open -a Blender --args --online-mode` (no preference change needed). Without it the add-on silently does nothing.
- The MCP server is the `.mcpb` bundle from the same releases page: unzip it and run `uv run --directory <unzipped> blender-mcp`. **Run `uv sync` in that directory once first**: the first start spends ~70 s installing and the client times out at 30 s.
- MCP config: `{"mcpServers":{"blender":{"command":"uv","args":["run","--directory","<unzipped>","blender-mcp"]}}}`.
- It runs agent-written Python in Blender with no sandbox; Blender's own page says to keep sensitive data off the machine.
- Port 9876, the same as the community `blender-mcp`: enable only one of the two add-ons at a time.
- Its live scene has no lights, so viewport screenshots come out black; check with `scripts/render.py` instead.

## build123d + trimesh (headless fallback)

- `uv run --with build123d --with trimesh build.py`. Model in mm with build123d solids, export through trimesh with PBR materials; alpha-masked textures on thin closed plates keep perforation watertight.
- The OCP wheels are ~145 MB; on a slow PyPI the first install takes a long time. `uv run --offline` reuses the cache afterwards.
- Render with `scripts/render.py` like any other GLB (Blender headless, no MCP needed).

## Community blender-mcp (runner-up)

`ahujasid/blender-mcp`, PyPI `mcp-for-blender`: fastest in the bakeoff, but slanted the side patch and lost on looks. If you use it: pin the version, set `DISABLE_TELEMETRY=true`, install `addon.py` under a real module name (e.g. copy to `blender_mcp.py`), and it auto-starts with Blender.
