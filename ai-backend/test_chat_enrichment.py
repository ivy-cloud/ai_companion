"""Chat display vs speech split — links and polish_for_display."""

import unittest

from human_speech import polish_for_display, polish_for_speech
import web_search


class ChatEnrichmentTests(unittest.TestCase):
    def test_polish_for_display_keeps_https_urls(self):
        raw = "Check this out https://example.com/page for details."
        display = polish_for_display(raw)
        self.assertIn("https://example.com/page", display)

    def test_polish_for_display_expands_markdown_links(self):
        raw = "See [Example](https://example.com) for more."
        display = polish_for_display(raw)
        self.assertIn("https://example.com", display)
        self.assertNotIn("[Example]", display)

    def test_polish_for_display_keeps_short_lists(self):
        raw = "Try this:\n- Step one\n- Step two"
        display = polish_for_display(raw)
        self.assertIn("• Step one", display)
        self.assertIn("• Step two", display)

    def test_polish_for_speech_unchanged_for_plain_urls(self):
        raw = "See https://example.com/long/path for more."
        speech = polish_for_speech(raw)
        self.assertIn("example.com", speech)

    def test_user_wants_link_share(self):
        self.assertTrue(web_search.user_wants_link_share("send me a link"))
        self.assertTrue(web_search.user_wants_link_share("how do I fix this?"))
        self.assertFalse(web_search.user_wants_link_share("how are you?"))

    def test_links_for_display_filters_https(self):
        hits = [
            {"title": "Summary", "snippet": "x", "url": ""},
            {"title": "Good", "snippet": "y", "url": "https://example.com/a"},
            {"title": "Bad", "snippet": "z", "url": "http://insecure.com"},
        ]
        links = web_search.links_for_display(hits)
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0]["url"], "https://example.com/a")

    def test_enrich_display_with_links_on_search_turn(self):
        hits = [{"title": "Weather", "snippet": "sunny", "url": "https://weather.example/"}]
        display = web_search.enrich_display_with_links(
            "Looks sunny today.",
            hits,
            "what's the weather tonight",
        )
        self.assertIn("https://weather.example/", display)

    def test_enrich_skips_duplicate_urls(self):
        hits = [{"title": "Site", "snippet": "x", "url": "https://example.com/"}]
        display = web_search.enrich_display_with_links(
            "See https://example.com/ for more.",
            hits,
            "send me a link",
        )
        self.assertEqual(display.count("https://example.com/"), 1)


if __name__ == "__main__":
    unittest.main()
