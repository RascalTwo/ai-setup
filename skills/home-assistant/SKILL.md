---
name: home-assistant
description: Calls a Home Assistant instance's REST API to find entities by name, read states and services, turn devices on or off, and call any service. Use for smart home devices, plugs, lights, sensors, automations, or "HA".
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    home-assistant: rest api
  requires:
    commands: [python3]
---

Everything goes through `scripts/ha.py` in this skill's directory, using the URL and token stored in `~/.config/home-assistant/`. If it reports that it isn't set up or the token was rejected, follow [`setup.md`](setup.md). On Windows `cmd.exe`, run it as `python %USERPROFILE%\.claude\skills\home-assistant\scripts\ha.py`.

## See what exists

- `ha.py find office lamp --domain switch` lists entities whose id, name, area, device or labels contain every word. Entity ids often differ from device names, so use this to turn a name into an id. One device usually has several entities, which is why `--domain` helps.
- `ha.py api GET /api/states/<entity_id>` reads one entity's state and attributes.
- `ha.py api GET /api/states` reads every entity, and `/api/services` lists every service with its fields. Both are large, so save them to a file and search that.

Endpoints: [REST API](https://developers.home-assistant.io/docs/api/rest/). The documented REST endpoints don't cover entity aliases or registry edits; those need the [WebSocket API](https://developers.home-assistant.io/docs/api/websocket/), which this script doesn't speak.

## Change something

1. Resolve the entity id with `find`. If several entities fit, ask which one.
2. Turn it on or off with `ha.py on <entity_id>` or `ha.py off <entity_id>`, which exits 0 only once Home Assistant reports the change. For anything else, call the service and read the state back: `ha.py api POST /api/services/climate/set_temperature '{"entity_id": "climate.office", "temperature": 70}'`.
3. Report the state you read back. If a device later flips back on its own, check its automations, and look at `context.user_id` in its state: null usually means no person made that change.

Change devices through `/api/services`. `POST /api/states/<entity_id>` only overwrites Home Assistant's record and leaves the device as it was.

## Token

The token has the full rights of the user who created it. Keep it out of chat, logs and command lines: pass it only by stdin or file redirect. Tokens come from the user creating one in their profile, and passwords only from the user typing them.
