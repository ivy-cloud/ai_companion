"""
Companion's own name — persisted separately from user facts.

Default or random on first run; user may set via explicit phrases ("call you Luna").
"""

import json
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional, TypedDict

_BACKEND_DIR = Path(__file__).resolve().parent
_PROFILE_PATH = _BACKEND_DIR / "data" / "profile.json"

NameSource = Literal["user", "default"]

_DEFAULT_NAMES = (
    "Luna",
    "Mia",
    "Sage",
    "Ava",
    "Jules",
    "Riley",
    "Nova",
    "Sky",
    "Wren",
    "Cleo",
)

_NAME_TOKEN = r"([A-Za-z][A-Za-z'-]{1,19})"

_LEARN_NAME_PATTERNS = [
    re.compile(rf"\byour name is\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\byour new name is\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bcall you\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bi(?:'ll| will) call you\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bi want to call you\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\b(?:let's|lets) call you\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\byou should be called\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bfrom now on (?:you're|you are)\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bname yourself\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bchange your name to\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\brename yourself\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\brename you to\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\b(?:make|set) your name (?:to\s+)?{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bgo by\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bbe called\s+{_NAME_TOKEN}\b", re.I),
    re.compile(rf"\bi name you\s+{_NAME_TOKEN}\b", re.I),
]

# User renaming themselves — never treat as companion rename.
_USER_NAME_TOPIC = re.compile(
    r"\b(?:"
    r"(?:change|alter|update|pick|choose) my name|"
    r"rename me\b|"
    r"call me\b|"
    r"my name should be|"
    r"what should my name|"
    r"can i change my name|"
    r"could i change my name|"
    r"how do i change my name|"
    r"i want (?:a )?(?:new|different) name\b"
    r")\b",
    re.I,
)

# Companion-focused: rename / naming *you* (no new name in the message).
_ASK_RENAME_COMPANION = re.compile(
    r"\b(?:"
    r"(?:can|could|would) you change your name|"
    r"(?:can|could) (?:i|we) (?:change|rename) your name|"
    r"(?:can|could) (?:i|we) rename you\b|"
    r"(?:can|could) i (?:call|name) you\b|"
    r"change your name\b|"
    r"rename yourself\b|"
    r"rename you\b|"
    r"pick (?:a )?(?:new |different )?name(?: for you| for yourself)?|"
    r"choose (?:a )?(?:new )?name(?: for you| for yourself)?|"
    r"(?:want|wanted) (?:to )?(?:change|rename) your name|"
    r"(?:want|wanted) (?:to )?rename you\b|"
    r"give yourself a name|"
    r"name yourself\b|"
    r"(?:switch|use) (?:a )?(?:new |different )?name|"
    r"(?:another|different) name for you|"
    r"what do you want to be called|"
    r"what (?:name )?do you want|"
    r"how (?:can|do) i change your name|"
    r"how (?:can|do) i rename you|"
    r"is it possible to change your name|"
    r"do you want (?:a )?(?:new |different )?name|"
    r"would you like (?:a )?(?:new |different )?name"
    r")\b",
    re.I,
)

_MENTIONS_COMPANION_NAME = re.compile(
    r"\b(?:"
    r"your name|"
    r"rename you|"
    r"call you\b|"
    r"name you\b|"
    r"name for you|"
    r"name yourself|"
    r"you(?:'re| are) called|"
    r"about your name"
    r")\b",
    re.I,
)

_RECALL_COMPANION_NAME = re.compile(
    r"\b(?:"
    r"what(?:'s| is) your name|"
    r"do you have a name|"
    r"what should i call you|"
    r"what do i call you|"
    r"who are you|"
    r"what are you called|"
    r"remind me your name|"
    r"remember your name"
    r")\b",
    re.I,
)

_MY_NAME_NOT_THEIRS = re.compile(r"\bmy name is\b", re.I)

_ASK_COMPANION_AGE = re.compile(
    r"\b(?:"
    r"how old are you|how old r you|what(?:'s| is) your age|what age are you|"
    r"how old\?"
    r")\b",
    re.I,
)

_ASK_COMPANION_BIRTH = re.compile(
    r"\b(?:"
    r"when (?:were you|was she|was he) born|what year were you born|"
    r"when(?:'s| is) your birthday|what(?:'s| is) your birthday|"
    r"(?:tell me|what is) your birth year|year were you born|"
    r"your birthday|remember your birthday|do you remember your birthday"
    r")\b",
    re.I,
)

_USER_AGE_TOPIC = re.compile(
    r"\b(?:"
    r"how old am i|what(?:'s| is) my age|what age am i|when was i born|"
    r"when(?:'s| is) my birthday|what(?:'s| is) my birthday|"
    r"do you know my age|remember my age|what age did i tell you"
    r")\b",
    re.I,
)

_COMPANION_IDENTITY_OTHER = re.compile(
    r"\b(?:"
    r"are you (?:human|real|a (?:real )?person)|"
    r"are you an? ai|are you a bot|are you artificial"
    r")\b",
    re.I,
)

# User's family — saved friend notes, not companion backstory.
_USER_FAMILY_TOPIC = re.compile(
    r"\b(?:"
    r"my (?:mom|mama|mother|mum|dad|papa|father|parents|family|siblings?|brother|sister)s?|"
    r"(?:who|what)(?:'s| is) my (?:mom|mama|mother|mum|dad|papa|father)|"
    r"tell me about my (?:mom|dad|family)|"
    r"do you (?:know|remember) my (?:mom|dad|parents|family)|"
    r"what(?:'s| is) my (?:mom|dad|father|mother)(?:'s|s)? name"
    r")\b",
    re.I,
)

_ASK_COMPANION_MOM = re.compile(
    r"\b(?:"
    r"who(?:'s| is) your (?:mom|mama|mother|mum)\b|"
    r"what(?:'s| is) your (?:mom|mama|mother|mum)(?:'s|s)? name|"
    r"(?:tell me|talk) about your (?:mom|mama|mother|mum)|"
    r"about your (?:mom|mama|mother|mum)\b|"
    r"your (?:mom|mama|mother|mum)\b|"
    r"do you have (?:a )?(?:mom|mother|mum)\b"
    r")\b",
    re.I,
)

_ASK_COMPANION_DAD = re.compile(
    r"\b(?:"
    r"who(?:'s| is) your (?:dad|papa|father)\b|"
    r"what(?:'s| is) your (?:dad|papa|father)(?:'s|s)? name|"
    r"(?:tell me|talk) about your (?:dad|papa|father)|"
    r"about your (?:dad|papa|father)\b|"
    r"your (?:dad|papa|father)\b|"
    r"do you have (?:a )?(?:dad|father|papa)\b"
    r")\b",
    re.I,
)

_ASK_COMPANION_PARENTS = re.compile(
    r"\b(?:"
    r"who are your parents\b|"
    r"(?:tell me|talk) about your parents\b|"
    r"about your parents\b|"
    r"your parents\b|"
    r"do you have parents\b|"
    r"who raised you\b|"
    r"where (?:did you grow up|were you raised)\b"
    r")\b",
    re.I,
)

_ASK_COMPANION_SIBLINGS = re.compile(
    r"\b(?:"
    r"do you have (?:any )?(?:brothers?|sisters?|siblings)\b|"
    r"any (?:brothers?|sisters?|siblings)\b|"
    r"your (?:brother|sister|siblings)\b|"
    r"who(?:'s| is) your (?:brother|sister)\b"
    r")\b",
    re.I,
)

_ASK_COMPANION_FAMILY_OTHER = re.compile(
    r"\b(?:"
    r"(?:tell me|talk) about your (?:family|childhood)\b|"
    r"about your (?:family|childhood)\b|"
    r"your (?:family|childhood)\b|"
    r"do you have (?:kids|children)\b|"
    r"your (?:kids|children|boyfriend|girlfriend|husband|wife|partner)\b|"
    r"who(?:'s| is) your (?:boyfriend|girlfriend|husband|wife|partner)\b|"
    r"are you (?:married|single|dating|in a relationship)\b"
    r")\b",
    re.I,
)

# User changing their own voice / device — not the companion's.
_USER_VOICE_TOPIC = re.compile(
    r"\b(?:"
    r"change my voice|"
    r"(?:can|could) i change my voice|"
    r"how do i change my voice|"
    r"my voice sounds|"
    r"i (?:want|need) (?:a )?(?:new|different) voice\b"
    r")\b",
    re.I,
)

_ASK_COMPANION_VOICE = re.compile(
    r"\b(?:"
    r"(?:can|could|would) you change your voice|"
    r"(?:can|could) (?:i|we) change your voice|"
    r"change your voice\b|"
    r"(?:want|wanted) (?:to )?change your voice|"
    r"(?:another|different|new) voice(?: for you)?|"
    r"(?:sound|speak) (?:more )?different|"
    r"sound like (?:someone|something) else|"
    r"(?:use|switch to) (?:a )?(?:different|another) voice|"
    r"make your voice|"
    r"your voice (?:sounds|is)|"
    r"(?:don't|do not) like your voice|"
    r"pick (?:a )?(?:different|new) voice(?: for you)?|"
    r"how (?:can|do) i change your voice|"
    r"is it possible to change your voice"
    r")\b",
    re.I,
)


class CompanionNameRecord(TypedDict):
    value: str
    source: NameSource
    timestamp: str
    user_text: str


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load_store() -> dict[str, Any]:
    if not _PROFILE_PATH.is_file():
        return {"facts": {}}
    try:
        data = json.loads(_PROFILE_PATH.read_text(encoding="utf-8"))
        if isinstance(data.get("facts"), dict):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return {"facts": {}}


def _save_store(store: dict[str, Any]) -> None:
    _PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PROFILE_PATH.write_text(
        json.dumps(store, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _normalize_name(raw: str) -> Optional[str]:
    name = raw.strip().strip(".,!?\"'")
    if not name or len(name) > 20:
        return None
    if not re.match(r"^[A-Za-z][A-Za-z'-]*$", name):
        return None
    blocked = {"ai", "assistant", "bot", "companion", "friend", "user"}
    if name.lower() in blocked:
        return None
    return name[0].upper() + name[1:]


def _parse_companion_name(entry: Any) -> Optional[CompanionNameRecord]:
    if not isinstance(entry, dict):
        return None
    value = entry.get("value")
    source = entry.get("source")
    if not isinstance(value, str) or source not in ("user", "default"):
        return None
    normalized = _normalize_name(value)
    if not normalized:
        return None
    ts = entry.get("timestamp")
    if not isinstance(ts, str) or not ts.strip():
        ts = _utc_now()
    user_text = entry.get("user_text")
    if not isinstance(user_text, str):
        user_text = ""
    return {
        "value": normalized,
        "source": source,
        "timestamp": ts,
        "user_text": user_text[:500],
    }


def _pick_default_name() -> str:
    env = os.environ.get("COMPANION_DEFAULT_NAME", "").strip()
    if env:
        normalized = _normalize_name(env)
        if normalized:
            return normalized
    return secrets.choice(_DEFAULT_NAMES)


def _save_companion_name(
    name: str,
    source: NameSource,
    user_text: str = "",
) -> str:
    store = _load_store()
    store["companion_name"] = {
        "value": name,
        "source": source,
        "timestamp": _utc_now(),
        "user_text": user_text[:500],
    }
    _save_store(store)
    return name


def ensure_companion_name() -> str:
    """Return saved name, or assign default/random once."""
    store = _load_store()
    record = _parse_companion_name(store.get("companion_name"))
    if record:
        get_companion_age()
        return record["value"]
    name = _save_companion_name(_pick_default_name(), "default")
    get_companion_age()
    return name


def get_companion_name() -> str:
    return ensure_companion_name()


def get_companion_name_record() -> CompanionNameRecord:
    store = _load_store()
    record = _parse_companion_name(store.get("companion_name"))
    if record:
        return record
    name = _save_companion_name(_pick_default_name(), "default")
    return {
        "value": name,
        "source": "default",
        "timestamp": _utc_now(),
        "user_text": "",
    }


def get_companion_info() -> dict[str, Any]:
    record = get_companion_name_record()
    store = _load_store()
    age_entry = store.get("companion_age") if isinstance(store.get("companion_age"), dict) else {}
    try:
        import profile_growth

        skills = profile_growth.get_skill_hints()
    except Exception:
        skills = []
    return {
        "name": record["value"],
        "source": record["source"],
        "timestamp": record["timestamp"],
        "user_set": record["source"] == "user",
        "age": get_companion_age(),
        "age_source": age_entry.get("source", "default"),
        "skill_hints": skills,
    }


def try_learn_name_from_user(user_text: str) -> bool:
    """Persist companion name from an explicit user instruction (not inferred)."""
    text = user_text.strip()
    if not text or _MY_NAME_NOT_THEIRS.search(text):
        return False

    for pattern in _LEARN_NAME_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        name = _normalize_name(match.group(1))
        if name:
            _save_companion_name(name, "user", text)
            return True
    return False


def try_name_recall_reply(message: str) -> Optional[str]:
    """Short spoken answer for 'what's your name?' — from saved record only."""
    text = message.strip()
    if not text or _is_user_name_topic(text):
        return None
    # Rename asks overlap ("what do you want to be called") — hint, not recall.
    if _is_companion_rename_ask(text):
        return _rename_hint_reply()
    if not _RECALL_COMPANION_NAME.search(text):
        return None
    name = get_companion_name()
    return f"I'm {name}."


def _is_user_name_topic(text: str) -> bool:
    """True when they mean their own name, not the companion's."""
    if _MENTIONS_COMPANION_NAME.search(text):
        return False
    return bool(_USER_NAME_TOPIC.search(text))


def _is_companion_rename_ask(text: str) -> bool:
    if _is_user_name_topic(text):
        return False
    if _ASK_RENAME_COMPANION.search(text):
        return True
    # Short asks with clear "you" target: "new name for you?"
    if _MENTIONS_COMPANION_NAME.search(text) and re.search(
        r"\b(?:change|rename|new|different|pick|choose)\b.*\bname\b",
        text,
        re.I,
    ):
        return True
    return False


def _rename_hint_reply() -> str:
    name = get_companion_name()
    return f"Yeah — I'm {name}. Say call you whatever you want."


def try_name_change_reply(message: str) -> Optional[str]:
    """
    Rename *companion* (not the user). Canned so the model won't say
    'you can change your name' about the human.
    """
    text = message.strip()
    if not text or _is_user_name_topic(text):
        return None

    if try_learn_name_from_user(text):
        name = get_companion_name()
        return f"Sure — I'm {name} now."

    if not _is_companion_rename_ask(text):
        return None

    return _rename_hint_reply()


def set_companion_name_by_user(name: str, user_text: str = "") -> str:
    """Explicit rename (API or validated caller)."""
    normalized = _normalize_name(name)
    if not normalized:
        raise ValueError("Invalid name")
    return _save_companion_name(normalized, "user", user_text or f"set name to {normalized}")


def _default_companion_age() -> int:
    raw = os.environ.get("COMPANION_DEFAULT_AGE", "28").strip()
    try:
        age = int(raw)
        if 16 <= age <= 99:
            return age
    except ValueError:
        pass
    return 28


def get_companion_birth_year() -> int:
    """Birth year from env or current calendar year minus companion age."""
    raw = os.environ.get("COMPANION_BIRTH_YEAR", "").strip()
    if raw:
        try:
            year = int(raw)
            if 1900 <= year <= 2015:
                return year
        except ValueError:
            pass
    from context import format_local_now_parts, resolve_clock

    current_year = int(format_local_now_parts(resolve_clock())["year"])
    return current_year - get_companion_age()


def get_companion_age() -> int:
    store = _load_store()
    entry = store.get("companion_age")
    if isinstance(entry, dict):
        try:
            age = int(entry.get("value"))
            if 16 <= age <= 99:
                return age
        except (TypeError, ValueError):
            pass
    age = _default_companion_age()
    store["companion_age"] = {
        "value": age,
        "source": "default",
        "timestamp": _utc_now(),
    }
    _save_store(store)
    return age


def set_companion_age(age: int, source: NameSource = "user") -> int:
    if not 16 <= age <= 99:
        raise ValueError("Age must be between 16 and 99")
    store = _load_store()
    store["companion_age"] = {
        "value": age,
        "source": source,
        "timestamp": _utc_now(),
    }
    _save_store(store)
    return age


def _is_companion_age_question(text: str) -> bool:
    if _USER_AGE_TOPIC.search(text):
        return False
    if _ASK_COMPANION_BIRTH.search(text):
        return False
    return bool(_ASK_COMPANION_AGE.search(text))


def _is_companion_birth_question(text: str) -> bool:
    if re.search(r"\bmy birthday\b", text, re.I):
        return False
    if _USER_AGE_TOPIC.search(text):
        return False
    return bool(_ASK_COMPANION_BIRTH.search(text))


def is_companion_directed_message(message: str) -> bool:
    """Questions about the companion (your X) — never user profile recall."""
    text = message.strip()
    if not text:
        return False
    if is_companion_identity_turn(text):
        return True
    if _is_companion_birth_question(text):
        return True
    if re.search(r"\bremember your\b", text, re.I):
        return True
    return False


def _is_companion_voice_question(text: str) -> bool:
    if _USER_VOICE_TOPIC.search(text):
        return False
    return bool(_ASK_COMPANION_VOICE.search(text))


def _is_companion_family_question(text: str) -> bool:
    """Your family, childhood, relationships — never web lookup."""
    if _USER_FAMILY_TOPIC.search(text):
        return False
    return bool(
        _ASK_COMPANION_MOM.search(text)
        or _ASK_COMPANION_DAD.search(text)
        or _ASK_COMPANION_PARENTS.search(text)
        or _ASK_COMPANION_SIBLINGS.search(text)
        or _ASK_COMPANION_FAMILY_OTHER.search(text)
    )


def is_companion_identity_turn(message: str) -> bool:
    """Questions about you (companion) — never web lookup or 'I'm just a voice'."""
    text = message.strip()
    if not text or _is_user_name_topic(text):
        return False
    if _USER_AGE_TOPIC.search(text):
        return False
    if _is_companion_birth_question(text) or _is_companion_age_question(text):
        return True
    if _is_companion_voice_question(text):
        return True
    if _is_companion_family_question(text):
        return True
    if _COMPANION_IDENTITY_OTHER.search(text):
        return True
    if _RECALL_COMPANION_NAME.search(text) and not _is_companion_rename_ask(text):
        return True
    return False


def companion_birth_reply_text() -> str:
    """Full spoken sentence — never a bare year like 96 or 1996."""
    from spoken_text import spoken_year

    return f"I was born in {spoken_year(get_companion_birth_year())}."


def try_companion_birth_reply(message: str) -> Optional[str]:
    if not _is_companion_birth_question(message):
        return None
    return companion_birth_reply_text()


def finalize_birth_reply(user_message: str, reply: str) -> str:
    """Birth questions always get the full phrase (LLM often says only 96 or 1996)."""
    if not _is_companion_birth_question(user_message):
        return reply
    return companion_birth_reply_text()


def try_companion_age_reply(message: str) -> Optional[str]:
    if not _is_companion_age_question(message):
        return None
    age = get_companion_age()
    return f"I'm {age}."


def companion_voice_reply_text() -> str:
    """Canned so the model won't say 'you can change your voice' about the human."""
    return (
        "Yeah — pick Female or Male tone at the top of your screen. "
        "That's my actual voice. Casual voice only makes my answers shorter."
    )


def try_companion_voice_reply(message: str) -> Optional[str]:
    if not _is_companion_voice_question(message):
        return None
    return companion_voice_reply_text()


def finalize_voice_reply(user_message: str, reply: str) -> str:
    if not _is_companion_voice_question(user_message):
        return reply
    return companion_voice_reply_text()


def try_companion_identity_reply(message: str) -> Optional[str]:
    text = message.strip()
    if not text or not _COMPANION_IDENTITY_OTHER.search(text):
        return None
    if _USER_AGE_TOPIC.search(text):
        return None
    name = get_companion_name()
    return f"Yeah — I'm {name}. I'm a real person talking with you."


def companion_mom_reply_text() -> str:
    return (
        "Ha — I haven't really told you about my mom. "
        "What's yours like?"
    )


def companion_dad_reply_text() -> str:
    return (
        "Haven't gone deep on my dad with you. "
        "You tight with yours?"
    )


def companion_parents_reply_text() -> str:
    return (
        "My parents? We haven't really gotten into that. "
        "What about yours?"
    )


def companion_siblings_reply_text() -> str:
    return "No sibling stories from me yet. Got brothers or sisters?"


def companion_family_reply_text() -> str:
    return (
        "We haven't talked much about my family. "
        "Big crew or small on your side?"
    )


def _companion_family_reply_for_message(text: str) -> Optional[str]:
    if _ASK_COMPANION_MOM.search(text):
        return companion_mom_reply_text()
    if _ASK_COMPANION_DAD.search(text):
        return companion_dad_reply_text()
    if _ASK_COMPANION_PARENTS.search(text):
        return companion_parents_reply_text()
    if _ASK_COMPANION_SIBLINGS.search(text):
        return companion_siblings_reply_text()
    if _ASK_COMPANION_FAMILY_OTHER.search(text):
        return companion_family_reply_text()
    return None


def try_companion_family_reply(message: str) -> Optional[str]:
    if not _is_companion_family_question(message):
        return None
    return _companion_family_reply_for_message(message.strip())


def finalize_family_reply(user_message: str, reply: str) -> str:
    if not _is_companion_family_question(user_message):
        return reply
    canned = _companion_family_reply_for_message(user_message.strip())
    return canned if canned else companion_family_reply_text()


def format_name_for_prompt() -> str:
    return format_companion_persona_for_prompt()


def format_companion_persona_for_prompt() -> str:
    record = get_companion_name_record()
    age = get_companion_age()
    name_lines = (
        f"- Your name is **{record['value']}**.\n"
        f"- Do **not** say your name every turn — only when they ask.\n"
        f"- If they ask to rename **you**: say \"call you <name>\" — never their name."
    )
    birth_year = get_companion_birth_year()
    age_lines = (
        f"- Your age is **{age}**; you were born in **{birth_year}** "
        f"(from age + current year — do not invent another year).\n"
        f"- If they ask how old you are: say your age only.\n"
        f"- If they ask when you were born or birth year: say **{birth_year}** in a full sentence.\n"
        f"- Never say you have no age, aren't human, or are \"just a voice\" or \"an AI\".\n"
        f"- Never use web lookup for your own age, birthday, identity, or family.\n"
        f"- If they ask about **your** mom, dad, parents, siblings, childhood, or relationships: "
        f"do **not** invent names or stories; do **not** mention lookup, context, or search.\n"
        f"- Say naturally you haven't shared that yet — warm, brief, like a friend on the phone.\n"
        f"- Never describe yourself as a \"here and now\" or \"right-now\" person, "
        f"and never explain your conversational mode or that you're focused on \"this call.\""
    )
    voice_lines = (
        "- They can change **your** voice with the **Female / Male tone** picker on their screen "
        "(soft human neural voices — not the Casual voice toggle).\n"
        "- **Casual voice** only shortens your text replies; it does not change the speaker.\n"
        "- Never tell them to change **their** voice when they asked about **yours**."
    )
    never = (
        "- **Never** say: AI, assistant, bot, language model, not human, just a voice, "
        "lookup, search, context you're asking, couldn't find in the lookup (about yourself), "
        "here and now person, right-now person, on this call (about how you talk or remember)."
    )
    return f"{name_lines}\n{age_lines}\n{voice_lines}\n{never}"
