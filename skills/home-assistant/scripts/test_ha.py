"""Runs ha.py as a shell would, against a fake Home Assistant. Run: python3 -m unittest test_ha.py"""
import json, os, stat, subprocess, sys, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

GOOD = "good.jwt.token"
SCRIPT = Path(__file__).with_name("ha.py")


class FakeHA(BaseHTTPRequestHandler):
    """Honours the REST contract: bearer auth, states that services change, 404 for unknown entities."""

    def log_message(self, *args):
        pass

    def reply(self, code, body):
        self.send_response(code)
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def handle_request(self):
        if self.headers["Authorization"] != f"Bearer {GOOD}":
            return self.reply(401, {})
        ha = self.server
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length)) if length else {}
        if self.path == "/api/":
            return self.reply(200, {"message": "API running."})
        if self.path == "/api/template":
            return self.reply(200, ha.registry)
        if self.path.startswith("/api/states/"):
            entity_id = self.path.rsplit("/", 1)[1]
            if entity_id not in ha.states:
                return self.reply(404, {})
            return self.reply(200, {"entity_id": entity_id, "state": ha.states[entity_id]})
        if self.path.startswith("/api/services/"):
            service = self.path.rsplit("/", 1)[1]
            ha.calls.append((self.path, body))
            if body["entity_id"] not in ha.stuck:
                ha.states[body["entity_id"]] = {"turn_on": "on", "turn_off": "off"}[service]
            return self.reply(200, [])
        self.reply(404, {})

    do_GET = do_POST = handle_request


class HaCli(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeHA)
        self.server.states = {"switch.plug_a": "off", "switch.dead": "unavailable"}
        self.server.stuck = {"switch.dead"}
        self.server.calls = []
        self.server.registry = [
            {"entity_id": "switch.plug_a", "name": "Lamp", "state": "off", "area": "Office", "device": "Lamp", "labels": ["candles"]},
            {"entity_id": "sensor.plug_a_power", "name": "Lamp Power", "state": "3", "area": "Office", "device": "Lamp", "labels": []},
            {"entity_id": "switch.plug_c", "name": "Fan", "state": "off", "area": "Office", "device": "Fan", "labels": ["candles"]},
            {"entity_id": "sun.sun", "name": "Sun", "state": "above_horizon", "area": None, "device": None, "labels": []},
        ]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        home = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        self.token_file = Path(home.name) / ".config" / "home-assistant" / "token"
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.env = {**os.environ, "HOME": home.name, "USERPROFILE": home.name, "HA_CONFIRM_SECONDS": "0.2"}

    def ha(self, *args, stdin=""):
        return subprocess.run([sys.executable, str(SCRIPT), *args], input=stdin, env=self.env, capture_output=True, text=True)

    def set_up(self):
        self.assertEqual(self.ha("setup", self.url, stdin=GOOD + "\n").returncode, 0)

    def test_setup_stores_a_working_token_privately_without_printing_it(self):
        # GIVEN no saved token
        # WHEN a working token is piped to setup
        result = self.ha("setup", self.url, stdin=GOOD + "\n")
        # THEN it is saved
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.token_file.read_text().strip(), GOOD)
        # THEN it never appears in the output
        self.assertNotIn(GOOD, result.stdout + result.stderr)
        # THEN only the owner can read the file
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(self.token_file.stat().st_mode), 0o600)

    def test_rejected_token_leaves_the_saved_one_alone(self):
        # GIVEN a saved working token
        self.set_up()
        # WHEN a bad token is piped to setup
        result = self.ha("setup", self.url, stdin="bad.jwt.token\n")
        # THEN the command fails
        self.assertNotEqual(result.returncode, 0)
        # THEN the working token is still saved
        self.assertEqual(self.token_file.read_text().strip(), GOOD)
        # THEN the bad token is not echoed
        self.assertNotIn("bad.jwt.token", result.stdout + result.stderr)

    def test_missing_setup_points_at_the_guide(self):
        # GIVEN no saved token
        # WHEN searching
        result = self.ha("find", "lamp")
        # THEN the command fails and names the fix
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("setup.md", result.stderr)

    def test_find_turns_a_device_name_into_its_entity_id(self):
        # GIVEN entities whose ids differ from their device names
        self.set_up()
        # WHEN finding by area and name within a domain
        result = self.ha("find", "office", "LAMP", "--domain", "switch")
        # THEN only the Lamp switch is listed
        self.assertEqual(len(result.stdout.splitlines()), 1)
        self.assertTrue(result.stdout.startswith("switch.plug_a = off"))

    def test_find_matches_a_spoken_candle_name_through_the_label(self):
        # GIVEN plugs labelled candles
        self.set_up()
        # WHEN searching for a spoken-style name
        result = self.ha("find", "fan", "candle")
        # THEN the labelled plug is listed
        self.assertTrue(result.stdout.startswith("switch.plug_c"), result.stdout)

    def test_find_with_no_match_fails(self):
        # GIVEN a saved token
        self.set_up()
        # WHEN nothing matches
        result = self.ha("find", "garage")
        # THEN the command fails
        self.assertNotEqual(result.returncode, 0)

    def test_on_changes_the_device_and_confirms_it(self):
        # GIVEN a plug that is off
        self.set_up()
        # WHEN turning it on
        result = self.ha("on", "switch.plug_a")
        # THEN the command reports the confirmed state
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "switch.plug_a = on (confirmed)")
        # THEN Home Assistant's state changed
        self.assertEqual(self.server.states["switch.plug_a"], "on")

    def test_off_changes_the_device_and_confirms_it(self):
        # GIVEN a plug that is on
        self.set_up()
        self.server.states["switch.plug_a"] = "on"
        # WHEN turning it off
        result = self.ha("off", "switch.plug_a")
        # THEN Home Assistant's state changed
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.server.states["switch.plug_a"], "off")

    def test_device_that_never_changes_is_reported_as_failed(self):
        # GIVEN a device that stays unavailable
        self.set_up()
        # WHEN turning it on
        result = self.ha("on", "switch.dead")
        # THEN the command fails and says so
        self.assertEqual(result.returncode, 1)
        self.assertIn("NOT confirmed", result.stdout)

    def test_only_real_entity_ids_reach_a_service_call(self):
        # GIVEN a saved token
        self.set_up()
        # WHEN the target is a name, or HA's special target "all"
        results = [self.ha("on", target) for target in ("Lamp", "all", "switch.a/../b")]
        # THEN every command fails
        self.assertTrue(all(r.returncode != 0 for r in results))
        # THEN no service was called
        self.assertEqual(self.server.calls, [])

    def test_api_reads_any_endpoint_and_prints_the_response(self):
        # GIVEN a plug that is off
        self.set_up()
        # WHEN reading it through the raw API
        result = self.ha("api", "GET", "/api/states/switch.plug_a")
        # THEN the response is printed
        self.assertEqual(json.loads(result.stdout)["state"], "off")

    def test_api_calls_a_service_with_the_given_body(self):
        # GIVEN a plug that is off
        self.set_up()
        # WHEN calling a service through the raw API
        result = self.ha("api", "POST", "/api/services/switch/turn_on", '{"entity_id": "switch.plug_a"}')
        # THEN the device changes
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.server.states["switch.plug_a"], "on")

    def test_api_error_fails_and_shows_the_status(self):
        # GIVEN a saved token
        self.set_up()
        # WHEN reading an entity that does not exist
        result = self.ha("api", "GET", "/api/states/switch.nope")
        # THEN the command fails with the status
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("404", result.stderr)

    def test_api_keeps_the_token_on_the_configured_host(self):
        # GIVEN a saved token
        self.set_up()
        # WHEN the path would turn the URL into another host
        result = self.ha("api", "GET", "@attacker.example/api/")
        # THEN the command refuses before sending anything
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must start with /api/", result.stderr)

    def test_setup_refuses_a_url_that_is_not_one(self):
        # GIVEN a working token
        # WHEN the URL has no scheme
        result = self.ha("setup", "homeassistant.local:8123", stdin=GOOD + "\n")
        # THEN the command says what a URL should look like
        self.assertIn("should look like", result.stderr)
        # THEN nothing is saved
        self.assertFalse(self.token_file.exists())


if __name__ == "__main__":
    unittest.main()
