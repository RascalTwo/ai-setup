"""Unit tests for engine selection and the Parakeet -> Whisper converter.

No engine or model needed, so these run on any machine: python3 tests/test_convert.py
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import transcribe as t  # noqa: E402

# Shaped exactly like parakeet-mlx's --output-format json (trimmed real output).
RAW = {
    "text": " Hello, hello again. It's 10.",
    "sentences": [
        {"text": " Hello, hello again.", "start": 0.16, "end": 2.32, "duration": 2.16, "confidence": 0.99,
         "tokens": [
             {"text": " H", "start": 0.16, "end": 0.4},
             {"text": "ello", "start": 0.4, "end": 0.64},
             {"text": ",", "start": 0.64, "end": 0.72},
             {"text": " h", "start": 0.72, "end": 0.88},
             {"text": "ello", "start": 0.88, "end": 1.04},
             {"text": " again", "start": 1.6, "end": 2.2},
             {"text": ".", "start": 2.2, "end": 2.32},
         ]},
        {"text": " It's 10.", "start": 3661.5, "end": 3662.0, "confidence": 0.9,
         "tokens": [
             {"text": " It", "start": 3661.5, "end": 3661.6},
             {"text": "'s", "start": 3661.6, "end": 3661.7},
             {"text": " 10", "start": 3661.7, "end": 3661.9},
             {"text": ".", "start": 3661.9, "end": 3662.0},
         ]},
    ],
}


class ConvertTests(unittest.TestCase):
    def test_given_parakeet_tokens_when_converted_then_words_match_whisper_convention(self):
        words = t.parakeet_to_result(RAW, "en")["segments"][0]["words"]
        self.assertEqual([w["word"] for w in words], [" Hello,", " hello", " again."])
        self.assertEqual((words[0]["start"], words[0]["end"]), (0.16, 0.72))
        self.assertEqual((words[2]["start"], words[2]["end"]), (1.6, 2.32))

    def test_given_sentences_when_converted_then_segments_carry_whisper_keys(self):
        result = t.parakeet_to_result(RAW, "en")
        self.assertEqual(result["text"], " Hello, hello again. It's 10.")
        self.assertEqual(result["language"], "en")
        self.assertEqual([s["id"] for s in result["segments"]], [0, 1])
        for seg in result["segments"]:
            self.assertTrue({"id", "start", "end", "text", "words"} <= seg.keys())
            for w in seg["words"]:
                self.assertEqual(set(w), {"word", "start", "end"})
        # read-video-locally flattens exactly like this
        flat = [w for s in result["segments"] for w in s.get("words", [])]
        self.assertEqual(len(flat), 5)

    def test_given_no_language_when_converted_then_language_is_null_not_guessed(self):
        self.assertIsNone(t.parakeet_to_result(RAW, "")["language"])

    def test_given_silence_when_converted_then_empty_but_valid(self):
        result = t.parakeet_to_result({"text": "", "sentences": []}, "en")
        self.assertEqual((result["text"], result["segments"]), ("", []))

    def test_given_whisper_cpp_tokens_when_merged_then_behaviour_unchanged(self):
        tokens = [{"text": "[_BEG_]", "offsets": {"from": 0, "to": 0}},
                  {"text": " Hel", "offsets": {"from": 0, "to": 200}},
                  {"text": "lo", "offsets": {"from": 200, "to": 400}},
                  {"text": " ", "offsets": {"from": 400, "to": 400}},
                  {"text": " world", "offsets": {"from": 500, "to": 900}}]
        self.assertEqual(t.words_from_tokens(tokens),
                         [{"word": " Hello", "start": 0.0, "end": 0.4},
                          {"word": " world", "start": 0.5, "end": 0.9}])


class SplitSentencesTests(unittest.TestCase):
    def test_given_one_long_chunk_when_split_then_one_sentence_per_terminator(self):
        tokens = [{"text": x, "start": i, "end": i + 1} for i, x in
                  enumerate([" Hi", ".", " Is", " it", "?", " Yes", "!", " and", " then"])]
        got = t.split_sentences(tokens)
        self.assertEqual([s["text"] for s in got], [" Hi.", " Is it?", " Yes!", " and then"])
        self.assertEqual([(s["start"], s["end"]) for s in got], [(0, 2), (2, 5), (5, 7), (7, 9)])
        self.assertEqual(sum(len(s["tokens"]) for s in got), len(tokens))

    def test_given_no_tokens_then_no_sentences(self):
        self.assertEqual(t.split_sentences([]), [])


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        # A dotted stem: with_suffix would have cut it to "10.json".
        self.stem = "10.30 standup"
        t.write_outputs(t.parakeet_to_result(RAW, "en"), self.dir, self.stem, "all")

    def read(self, ext):
        return (self.dir / f"{self.stem}.{ext}").read_text(encoding="utf-8")

    def test_txt_is_one_stripped_segment_per_line(self):
        self.assertEqual(self.read("txt"), "Hello, hello again.\nIt's 10.\n")

    def test_srt_numbering_and_hour_rollover(self):
        self.assertEqual(self.read("srt"),
                         "1\n00:00:00,160 --> 00:00:02,320\nHello, hello again.\n\n"
                         "2\n01:01:01,500 --> 01:01:02,000\nIt's 10.\n\n")

    def test_vtt_has_header_and_dot_millis(self):
        self.assertTrue(self.read("vtt").startswith("WEBVTT\n\n00:00:00.160 --> 00:00:02.320\n"))

    def test_tsv_matches_whisper_millisecond_integers(self):
        self.assertEqual(self.read("tsv").splitlines(),
                         ["start\tend\ttext", "160\t2320\tHello, hello again.", "3661500\t3662000\tIt's 10."])

    def test_json_round_trips(self):
        self.assertEqual(json.loads(self.read("json")), t.parakeet_to_result(RAW, "en"))

    def test_single_format_writes_only_that_file(self):
        other = Path(tempfile.mkdtemp())
        t.write_outputs(t.parakeet_to_result(RAW, "en"), other, "x", "srt")
        self.assertEqual([p.name for p in other.iterdir()], ["x.srt"])

    def test_tab_in_text_does_not_break_tsv_columns(self):
        other = Path(tempfile.mkdtemp())
        raw = {"sentences": [{"text": " a\tb", "start": 0, "end": 1, "tokens": []}]}
        t.write_outputs(t.parakeet_to_result(raw, "en"), other, "x", "tsv")
        self.assertEqual((other / "x.tsv").read_text().splitlines()[1].split("\t"), ["0", "1000", "a b"])


class SelectEngineTests(unittest.TestCase):
    def select(self, installed, *args):
        with mock.patch.object(t, "probe", lambda e: Path(e) if e in installed else None):
            return t.select_engine(*args)[0]

    def test_order_is_parakeet_mlx_mlx_whisper_parakeet_whisper_cpp(self):
        order = list(t.ENGINE_ORDER)
        for i, engine in enumerate(order):
            self.assertEqual(self.select(set(order[i:]), "auto"), engine)

    def test_non_european_language_skips_parakeet(self):
        self.assertEqual(self.select({"parakeet-mlx", "mlx_whisper"}, "auto", "ko"), "mlx_whisper")
        self.assertEqual(self.select({"parakeet", "whisper.cpp"}, "auto", "ja"), "whisper.cpp")
        self.assertEqual(self.select({"parakeet-mlx", "mlx_whisper"}, "auto", "de"), "parakeet-mlx")

    def test_whisper_model_picks_whisper_engine(self):
        both = {"parakeet-mlx", "mlx_whisper"}
        self.assertEqual(self.select(both, "auto", "en", "mlx-community/whisper-large-v3-turbo"), "mlx_whisper")
        self.assertEqual(self.select({"parakeet", "whisper.cpp"}, "auto", "en", "F:/m/ggml-large-v3-turbo.bin"),
                         "whisper.cpp")
        self.assertEqual(self.select(both, "auto", "en", "mlx-community/parakeet-tdt-0.6b-v2"), "parakeet-mlx")

    def test_forced_engine_missing_or_wrong_language_fails(self):
        with mock.patch("sys.stderr"):
            with self.assertRaises(SystemExit):
                self.select({"mlx_whisper"}, "parakeet-mlx")
            with self.assertRaises(SystemExit):
                self.select({"parakeet-mlx"}, "parakeet-mlx", "zh")
            with self.assertRaises(SystemExit):
                self.select(set(), "auto")

    def test_model_tag_puts_both_parakeet_engines_in_one_folder(self):
        self.assertEqual(t.model_tag(t.DEFAULT_MODELS["parakeet-mlx"]), t.model_tag(t.DEFAULT_MODELS["parakeet"]))
        self.assertEqual(t.model_tag(t.DEFAULT_MODELS["mlx_whisper"]), "turbo")


if __name__ == "__main__":
    unittest.main()
