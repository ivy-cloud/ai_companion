"""Web search routing — no live network calls."""

import unittest
from unittest.mock import patch

from context import ResolvedClock
from zoneinfo import ZoneInfo

import web_search


class WebSearchRoutingTests(unittest.TestCase):
    def test_weather_phrases_trigger_search(self):
        for msg in (
            "what is the weather tonight",
            "what's the weather tonight",
            "how is the weather tonight",
            "how's the weather tonight",
            "weather tonight",
            "tell me the weather tonight",
            "will it rain tonight",
        ):
            with self.subTest(msg=msg):
                self.assertTrue(web_search.is_factual_question(msg), msg)
                self.assertTrue(web_search.should_search(msg), msg)

    def test_tonight_counts_as_current(self):
        self.assertTrue(web_search.asks_about_current("what about tonight"))

    def test_user_profile_skips_search(self):
        self.assertFalse(web_search.should_search("What's my age?"))
        self.assertFalse(web_search.is_factual_question("How old am I?"))

    def test_companion_feedback_skips_search(self):
        msg = "I think something is wrong why you will suck in some word?"
        self.assertFalse(web_search.is_factual_question(msg), msg)
        self.assertFalse(web_search.should_search(msg), msg)

    def test_casual_question_mark_not_auto_factual(self):
        self.assertFalse(
            web_search.is_factual_question("Want to grab coffee later?"),
        )

    def test_weather_query_uses_location_hint(self):
        clock = ResolvedClock(
            zone=ZoneInfo("America/Los_Angeles"),
            iana="America/Los_Angeles",
            from_device=True,
        )
        queries = web_search.build_search_queries(
            "what's the weather tonight",
            location_hint=web_search._location_hint_from_context(clock),
        )
        self.assertTrue(any("Los Angeles" in q for q in queries), queries)

    def test_saved_location_in_queries(self):
        import profile

        with patch.object(profile, "get_facts", return_value={"location": "Seattle"}):
            hint = web_search._location_hint_from_context()
            queries = web_search.build_search_queries("weather tonight", location_hint=hint)
        self.assertTrue(any("Seattle" in q for q in queries), queries)


if __name__ == "__main__":
    unittest.main()
