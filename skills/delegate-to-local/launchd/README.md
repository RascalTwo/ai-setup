# Pinned Ollama for delegate-to-local

`com.rascaltwo.ollama-pinned` keeps an Ollama 0.40.16 server alive on `127.0.0.1:11435`. The launcher sends its model traffic there and falls back to the main Ollama (`11434`) with a note when it isn't answering. Why: [the ADR](../../../docs/adr/2026-11-22-serve-delegate-to-local-from-a-pinned-ollama.md).

It has its own models folder with only `qwen3.6:35b-a3b` in it, as APFS clones (`cp -c`) of the main folder's files, so it costs no extra disk. A separate folder matters: an Ollama prunes blobs it doesn't know at startup, and 0.40.16 doesn't know newer models such as Inkling 2 Mini.

## Install

Needs the 0.40.16 app (from <https://github.com/ollama/ollama/releases/tag/v0.40.16>, `Ollama-darwin.zip`) and `qwen3.6:35b-a3b` already pulled in the main Ollama.

```sh
P=~/.agents/ollama-pinned; mkdir -p $P/models ~/.agents/state/ollama-pinned
ditto <unzipped>/Ollama.app $P/Ollama-0.40.16.app
# Clone qwen3.6's manifest and blobs into the pinned models folder.
M=~/.ollama/models; MF=$M/manifests/registry.ollama.ai/library/qwen3.6/35b-a3b
mkdir -p $P/models/manifests/registry.ollama.ai/library/qwen3.6 $P/models/blobs
cp -c $MF $P/models/manifests/registry.ollama.ai/library/qwen3.6/
python3 -c 'import json,sys;m=json.load(open(sys.argv[1]));print("\n".join([m["config"]["digest"]]+[l["digest"] for l in m["layers"]]))' $MF |
  while read d; do cp -c $M/blobs/${d/:/-} $P/models/blobs/; done
# Install the job (launchd does not expand $HOME; the checked-in paths are placeholders).
sed "s|/Users/YOUR-USER|$HOME|g" com.rascaltwo.ollama-pinned.plist > ~/Library/LaunchAgents/com.rascaltwo.ollama-pinned.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rascaltwo.ollama-pinned.plist
curl -s localhost:11435/api/version   # {"version":"0.40.16"}
```

After re-pulling `qwen3.6:35b-a3b` in the main Ollama, rerun the clone lines: the pinned copy does not follow it.

## Remove (once a fixed Ollama ships)

Rerun the A/B (`~/.agents/state/delegate-to-local/runs/20261121-ollama-ab/ab.sh` pattern) on the new version. If Claude Code's `cache_read_input_tokens` is back above 0 on most turns:

```sh
launchctl bootout gui/$(id -u)/com.rascaltwo.ollama-pinned
rm ~/Library/LaunchAgents/com.rascaltwo.ollama-pinned.plist; rm -rf ~/.agents/ollama-pinned
```

then delete `PINNED` from `scripts/delegate-local.py` and this folder, and mark the ADR superseded.
