#!/usr/bin/env python3
"""Drives session-eta.py through one turn against a fake panel and a fake Ollama. Run: python3 session-eta.test.py"""
import http.server, importlib.util, json, os, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
tmp = tempfile.mkdtemp()
posts, prompts = [], []


class Fake(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path.startswith("/progress"):
            posts.append(body), self.send_response(200), self.end_headers(), self.wfile.write(b"ok")
        else:
            prompts.append(body["prompt"])
            reply = {"stages": [{"stage": "Testing", "estimated_minutes": 4}, {"name": "Fixing", "minutes": 6}], "stage": "Testing", "minutes_left": 9}
            self.send_response(200), self.end_headers(), self.wfile.write(json.dumps({"response": json.dumps(reply)}).encode())

    def log_message(self, *a):
        pass


srv = http.server.HTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_port}"
os.makedirs(f"{tmp}/panels")
json.dump({"url": f"{base}/progress?key=k"}, open(f"{tmp}/panels/w1_p1.json", "w"))
env = {**os.environ, "SESSION_ETA_STATE": f"{tmp}/state", "APP_PANEL_SESSIONS": f"{tmp}/panels", "HERDR_PANE_ID": "w1:p1", "OLLAMA_HOST_URL": base}


def fire(**p):
    subprocess.run([sys.executable, f"{HERE}/session-eta.py"], input=json.dumps({"session_id": "s1", "cwd": "/repo", "transcript_path": "/none", **p}), env=env, text=True, check=True)


def until(cond, what):
    for _ in range(300):
        if cond():
            return
        time.sleep(0.05)
    raise AssertionError(f"timed out waiting for {what}; posts={posts}")


# command_key is the matching rule for duration history
spec = importlib.util.spec_from_file_location("eta", f"{HERE}/session-eta.py")
eta = importlib.util.module_from_spec(spec); spec.loader.exec_module(eta)
assert eta.command_key("cd /x && FOO=1 npm run build -- --x") == "npm run build"
assert eta.command_key("bun test lib.test.ts") == "bun test"
assert eta.command_key("/usr/bin/time -p bun test") == "bun test" and eta.command_key("timeout 300 npm test") == "npm test"

# A past `npm test` of 120s makes the next one start a bar at once, even 1s into the turn.
fire(hook_event_name="UserPromptSubmit", prompt="fix the flaky test")
os.makedirs(f"{tmp}/state", exist_ok=True)
open(f"{tmp}/state/durations.jsonl", "a").write(json.dumps({"key": "npm test", "cwd": "/repo", "secs": 120}) + "\n")
fire(hook_event_name="PreToolUse", tool_name="Read", tool_use_id="a", tool_input={"file_path": "x.ts"})
assert posts == [], "a short turn shows no bar"
fire(hook_event_name="PreToolUse", tool_name="Bash", tool_use_id="b", tool_input={"command": "npm test"})
until(lambda: any(p.get("eta") for p in posts), "the model's estimate")
assert posts[0]["note"] == "estimating…" and posts[-1]["eta"] == 540 and posts[-1]["stage"] == "Testing", posts
assert "past runs took ~2m00s" in prompts[-1] and "fix the flaky test" in prompts[-1], prompts[-1]

# Stop finishes the bar and logs the actual duration next to the estimate.
fire(hook_event_name="Stop")
assert posts[-1]["status"] == "done", posts[-1]
assert open(f"{tmp}/state/actuals.jsonl").read().count('"actual"') == 1
assert open(f"{tmp}/state/estimates.jsonl").read().count('"left": 540') == 1

# Claude reporting its own progress turns the hook off for that turn.
n = len(posts)
fire(hook_event_name="UserPromptSubmit", prompt="deploy")
fire(hook_event_name="PreToolUse", tool_name="mcp__app-panel__progress", tool_use_id="c", tool_input={})
fire(hook_event_name="PreToolUse", tool_name="Bash", tool_use_id="d", tool_input={"command": "npm test"})
fire(hook_event_name="Stop")
time.sleep(0.3)
assert len(posts) == n, posts[n:]
# A turn with one long silent tool call still gets a bar: the watchdog wakes on its own.
env["SESSION_ETA_SHOW_AFTER"] = "1"
fire(hook_event_name="UserPromptSubmit", prompt="refactor the parser")
fire(hook_event_name="PreToolUse", tool_name="Agent", tool_use_id="e", tool_input={"description": "big refactor"})
until(lambda: posts[-1].get("eta") and "refactor the parser" in posts[-1]["title"], "the watchdog's estimate")
assert "RUNNING NOW" in prompts[-1] and "big refactor" in prompts[-1], prompts[-1]

# A task notification starts a turn but keeps the last real request as the title.
fire(hook_event_name="UserPromptSubmit", prompt="<task-notification>done</task-notification>")
until(lambda: sum("refactor the parser" in p["title"] and p.get("note") == "estimating…" for p in posts) == 2, "the notification turn's bar")
fire(hook_event_name="Stop")
assert not os.path.exists(f"{tmp}/state/errors.jsonl"), open(f"{tmp}/state/errors.jsonl").read()
print("ok")
