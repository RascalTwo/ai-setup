"""python3 -m unittest discover -s skills/delegate-to-local/scripts"""
import importlib.util, os, sys, tempfile, time, unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("dl", os.path.join(os.path.dirname(__file__), "delegate-local.py"))
dl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dl)


class ChildEnv(unittest.TestCase):
    def test_parent_session_vars_dropped_and_local_endpoint_set(self):
        parent = {"PATH": "/bin", "CLAUDE_CODE_SESSION_ID": "x", "CLAUDE_CODE_MESSAGING_SOCKET": "/s",
                  "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet", "ANTHROPIC_API_KEY": "real-key"}
        with mock.patch.dict(os.environ, parent, clear=True):
            env = dl.child_env("m:1")
        self.assertEqual(env["PATH"], "/bin")
        self.assertNotIn("CLAUDE_CODE_SESSION_ID", env)
        self.assertNotIn("CLAUDE_CODE_MESSAGING_SOCKET", env)
        self.assertEqual(env["ANTHROPIC_API_KEY"], "")
        self.assertEqual(env["ANTHROPIC_BASE_URL"], "http://localhost:11434")
        self.assertEqual(env["CLAUDE_CODE_SUBAGENT_MODEL"], "m:1")
        self.assertTrue(env["CLAUDE_CONFIG_DIR"].endswith("delegate-to-local/claudehome"))


class Preflight(unittest.TestCase):
    def fake(self, tags, ps):
        return lambda path: {"/api/version": {}, "/api/tags": {"models": tags}, "/api/ps": {"models": ps}}[path]

    def test_missing_model_refused(self):
        with mock.patch.object(dl, "ollama", self.fake([], [])), self.assertRaises(SystemExit) as e:
            dl.preflight("qwen3.6:35b-a3b", "/nonexistent.lock")
        self.assertEqual(e.exception.code, 2)

    def test_other_big_model_refused_small_one_allowed(self):
        tags = [{"name": "q:1"}]
        with mock.patch.object(dl, "ollama", self.fake(tags, [{"name": "gemma4:12b", "size": 8 * 1024**3}])), \
                self.assertRaises(SystemExit):
            dl.preflight("q:1", "/nonexistent.lock")
        with mock.patch.object(dl, "ollama", self.fake(tags, [{"name": "phonon", "size": 177 * 1024**2},
                                                              {"name": "q:1", "size": 30 * 1024**3}])):
            dl.preflight("q:1", "/nonexistent.lock")  # no SystemExit

    def test_model_reporting_small_after_load_is_judged_by_its_weights(self):
        tags = [{"name": "q:1"}, {"name": "gemma4:12b", "size": 7600 * 1024**2}]
        with mock.patch.object(dl, "ollama", self.fake(tags, [{"name": "gemma4:12b", "size": 1100 * 1024**2}])), \
                self.assertRaises(SystemExit):
            dl.preflight("q:1", "/nonexistent.lock")

    def test_hook_helper_models_are_returned_for_unloading_not_refused(self):
        ps = [{"name": "qwen3.5:9b", "size": 11 * 1024**3}]
        with mock.patch.object(dl, "ollama", self.fake([{"name": "q:1"}], ps)):
            self.assertEqual(dl.preflight("q:1", "/nonexistent.lock"), ["qwen3.5:9b"])


class TimeLimit(unittest.TestCase):
    def test_overrun_kills_the_whole_tree_and_reports_timed_out(self):
        tmp = tempfile.mkdtemp()
        # A fake claude that starts a grandchild and never finishes.
        open(f"{tmp}/claude", "w").write(f"#!/bin/sh\nsleep 300 & echo $! > {tmp}/child.pid\nwait\n")
        os.chmod(f"{tmp}/claude", 0o755)
        argv = ["delegate-local.py", "--minutes", "0.03", "-C", tmp, "go"]
        with mock.patch.object(dl, "STATE", tmp), mock.patch.object(dl, "preflight", lambda m, l: []), \
                mock.patch.dict(os.environ, {"PATH": f"{tmp}:{os.environ['PATH']}"}), \
                mock.patch.object(sys, "argv", argv), self.assertRaises(SystemExit) as e:
            dl.main()
        self.assertEqual(e.exception.code, 124)
        run = os.path.join(tmp, "runs", os.listdir(f"{tmp}/runs")[0])
        self.assertIn("timed out after 0.03 min", open(f"{run}/result.md").read())
        self.assertTrue(open(f"{run}/session_id").read())  # resumable even after a timeout
        self.assertFalse(os.path.exists(f"{tmp}/run.lock"))
        pid = int(open(f"{tmp}/child.pid").read())
        time.sleep(0.2)  # let launchd reap the orphan
        self.assertFalse(dl.alive(pid), "the grandchild outlived the time limit")

    def test_stopping_the_launcher_stops_the_local_run(self):
        # Cancelling the launcher (a background task stopped) must not leave Qwen holding the model.
        import signal, subprocess
        tmp = tempfile.mkdtemp()
        open(f"{tmp}/claude", "w").write(f"#!/bin/sh\nsleep 300 & echo $! > {tmp}/child.pid\nwait\n")
        os.chmod(f"{tmp}/claude", 0o755)
        here = os.path.dirname(os.path.abspath(__file__))
        code = (f"import importlib.util,sys; s=importlib.util.spec_from_file_location('dl','{here}/delegate-local.py');"
                f"dl=importlib.util.module_from_spec(s); s.loader.exec_module(dl); dl.STATE='{tmp}';"
                f"dl.preflight=lambda m,l: []; sys.argv=['x','-C','{tmp}','go']; dl.main()")
        p = subprocess.Popen([sys.executable, "-c", code], env={**os.environ, "PATH": f"{tmp}:{os.environ['PATH']}"})
        for _ in range(100):
            if os.path.exists(f"{tmp}/child.pid") and open(f"{tmp}/child.pid").read().strip():
                break
            time.sleep(0.05)
        p.send_signal(signal.SIGTERM)
        p.wait(timeout=20)
        pid = int(open(f"{tmp}/child.pid").read())
        time.sleep(0.2)
        self.assertFalse(dl.alive(pid), "the local run outlived its launcher")
        self.assertFalse(os.path.exists(f"{tmp}/run.lock"))


if __name__ == "__main__":
    unittest.main()
