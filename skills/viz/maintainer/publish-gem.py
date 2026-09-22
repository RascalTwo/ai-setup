# /// script
# requires-python = ">=3.11"
# dependencies = ["gemini_webapi==2.1.1", "browser-cookie3"]
# ///
# publish-gem.py — push .gem-dist/gem.json (from build-gem.ts) to Gemini: update in place, or create.
#
# WHY A REVERSE-ENGINEERED CLIENT: Google has no Gems API. A .gem file written to Drive is imported
# once, on the Gem's first open, and never re-read, so Drive can create a Gem but not update one.
# gemini_webapi calls the same RPC the Gem editor's Update button does, which keeps the Gem id, and
# with it every share link. It authenticates with browser session cookies, so it breaks when they
# rotate and whenever Google changes the RPC — pinned on purpose.
#
# WHY IT RUNS ON YOUR MAC, NOT IN CI: the cookies come from Chrome, which binds them to the device
# (DBSC) so they live hours, not days. A CI secret would be dead by the next run; the local Chrome
# store is always fresh. macOS asks once for "Chrome Safe Storage" keychain access.
#
#   uv run maintainer/publish-gem.py            # update package.json's gemId in place
#   uv run maintainer/publish-gem.py GEM_ID     # update another Gem
#   uv run maintainer/publish-gem.py --create   # make a new one, print its id (put it in package.json)
#
# Targets by id only, never by name: a rename or a same-named Gem must not redirect a publish.
# GEMINI_1PSID / GEMINI_1PSIDTS, when set, override the Chrome lookup (e.g. a non-default profile).
import argparse, asyncio, json, os, sys
from pathlib import Path

import browser_cookie3
from gemini_webapi import GeminiClient
from gemini_webapi.constants import GRPC
from gemini_webapi.exceptions import AuthError
from gemini_webapi.types import RPCData

SKILL_DIR = Path(__file__).resolve().parent.parent
GEM_JSON = SKILL_DIR / ".gem-dist" / "gem.json"

# The Gem editor's "Default tool". Read off LIST_BOTS: gems set to Canvas store 2 where a
# library-updated gem stores 0; the .gem file mirrors it as protobuf field 15.
DEFAULT_TOOL_CANVAS = 2

SESSION_HELP = """No live Google session. Sign in at gemini.google.com in Chrome's Default profile, as the
account that owns the Gem (the first signed-in account is the one used), then re-run.
Other profile: export GEMINI_1PSID / GEMINI_1PSIDTS from browser_cookie3.chrome(cookie_file=
"~/Library/Application Support/Google/Chrome/Profile N/Cookies", domain_name="google.com")."""


def cookies() -> tuple[str | None, str | None]:
    if os.environ.get("GEMINI_1PSID"):
        return os.environ["GEMINI_1PSID"], os.environ.get("GEMINI_1PSIDTS")
    c = {k.name: k.value for k in browser_cookie3.chrome(domain_name="google.com")}
    return c.get("__Secure-1PSID"), c.get("__Secure-1PSIDTS")


async def main() -> None:
    ap = argparse.ArgumentParser(description="Publish .gem-dist/gem.json to Gemini.")
    ap.add_argument("gem_id", nargs="?", help="Gem to update (default: package.json gemId)")
    ap.add_argument("--create", action="store_true", help="create a new Gem instead")
    opts = ap.parse_args()
    if opts.gem_id and opts.create:
        ap.error("pass GEM_ID or --create, not both")
    gem_id = None if opts.create else opts.gem_id or json.loads((SKILL_DIR / "package.json").read_text()).get("gemId")
    if not opts.create and not gem_id:
        ap.error("no GEM_ID given and package.json has no gemId")

    if not GEM_JSON.exists():
        sys.exit(f"{GEM_JSON} missing — run: bun maintainer/build-gem.ts")
    gem = json.loads(GEM_JSON.read_text())

    psid, psidts = cookies()
    if not psid:
        sys.exit(SESSION_HELP)
    client = GeminiClient(psid, psidts)
    try:
        await client.init(timeout=60, auto_refresh=False)
    except AuthError as e:
        sys.exit(f"{e}\n\n{SESSION_HELP}")
    if client.account_status.name == "UNAUTHENTICATED":  # init() accepts dead cookies; the first call would fail
        await client.close()
        sys.exit(SESSION_HELP)
    try:
        if opts.create:
            gem_id, verb = (await client.create_gem(gem["name"], gem["instructions"], gem["description"])).id, "created"
        else:
            custom = [g for g in await client.fetch_gems() if not g.predefined]
            if not any(g.id == gem_id for g in custom):
                sys.exit(f"No custom Gem {gem_id!r} on this account. Have: {[(g.name, g.id) for g in custom]}")
            verb = "updated"
        # Not client.update_gem(): it hardcodes the default tool to 0 (none). Same RPC, with Canvas.
        # The [] before it is the knowledge-file list, so a publish also detaches any hand-added files.
        body = [gem_id, [gem["name"], gem["description"], gem["instructions"], 0, 1, [], DEFAULT_TOOL_CANVAS]]
        await client._batch_execute([RPCData(rpcid=GRPC.UPDATE_BOT_METADATA, payload=json.dumps(body))])
        print(f"{verb} {gem['name']!r} ({len(gem['instructions'])} chars): https://gemini.google.com/gem/{gem_id}")
    finally:
        await client.close()


asyncio.run(main())
