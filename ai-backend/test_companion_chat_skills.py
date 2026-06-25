"""Therapeutic chat skills — detection and turn hints."""

import unittest

import companion_chat_skills
import personality


class CompanionChatSkillsTests(unittest.TestCase):
    def test_crisis_takes_priority(self) -> None:
        msg = "I'm so stressed I want to die tonight"
        self.assertEqual(companion_chat_skills.detect_chat_skill(msg), "crisis_care")
        hint = companion_chat_skills.chat_skill_turn_hint(msg, casual=True)
        self.assertIn("988", hint)
        self.assertIn("Crisis care", hint)

    def test_coping_when_asked(self) -> None:
        msg = "I'm really anxious about tomorrow — what should I do?"
        self.assertEqual(companion_chat_skills.detect_chat_skill(msg), "coping_when_asked")
        hint = companion_chat_skills.chat_skill_turn_hint(msg, casual=True)
        self.assertIn("ONE small coping step", hint)

    def test_grounding(self) -> None:
        msg = "I'm panicking and I can't breathe"
        self.assertEqual(companion_chat_skills.detect_chat_skill(msg), "grounding")
        hint = companion_chat_skills.chat_skill_turn_hint(msg, casual=True)
        self.assertIn("body/breath", hint)

    def test_decision_support(self) -> None:
        msg = "I'm torn between staying at my job or taking the offer"
        self.assertEqual(companion_chat_skills.detect_chat_skill(msg), "decision_support")
        hint = companion_chat_skills.chat_skill_turn_hint(msg, casual=True)
        self.assertIn("fear wasn't", hint)

    def test_explore_layer_on_long_vent(self) -> None:
        msg = (
            "Work has been brutal this week. My manager keeps piling stuff on me. "
            "I barely slept and I keep replaying every conversation."
        )
        self.assertEqual(companion_chat_skills.detect_chat_skill(msg), "explore_layer")
        hint = companion_chat_skills.chat_skill_turn_hint(msg, casual=True)
        self.assertIn("what/how", hint)

    def test_reflect_listen_on_short_stress(self) -> None:
        msg = "Had a fight with my sister and I'm still upset"
        self.assertEqual(companion_chat_skills.detect_chat_skill(msg), "reflect_listen")
        hint = companion_chat_skills.chat_skill_turn_hint(msg, casual=True)
        self.assertIn("reflect listen", hint)

    def test_skips_factual(self) -> None:
        self.assertIsNone(
            companion_chat_skills.detect_chat_skill("What is my birthday?")
        )

    def test_skips_non_casual(self) -> None:
        msg = "I'm panicking and I can't breathe"
        self.assertEqual(
            companion_chat_skills.chat_skill_turn_hint(msg, casual=False), ""
        )

    def test_build_turn_hints_includes_support_skill(self) -> None:
        msg = "I'm panicking and I can't breathe"
        hint = personality.build_turn_hints(msg)
        self.assertIn("grounding buddy", hint.lower())

    def test_build_turn_hints_crisis(self) -> None:
        msg = "I don't want to be here anymore"
        hint = personality.build_turn_hints(msg)
        self.assertIn("988", hint)
        self.assertIn("Crisis care", hint)

    def test_build_turn_hints_ok_skips_support(self) -> None:
        hint = personality.build_turn_hints("OK.")
        self.assertNotIn("Support chat", hint)
        self.assertNotIn("Crisis care", hint)


if __name__ == "__main__":
    unittest.main()
