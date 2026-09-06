# The agent's conversational layer. Python port of agent/conversation.ts.
#
# A real assistant does not act on the first sentence -- it gathers what it
# needs first. This module owns that: it pulls whatever details it can out of
# each message, works out what is still missing, and produces the next
# question. Deliberately independent of any LLM -- the same slot state drives
# the hosted-model path and the offline path.

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

TripProfile = Dict[str, object]  # origin, destination, departureDate, returnDate, travelers, airlinePreference, hotelBudget

CITY_ALIASES = [
    {"code": "TVM", "label": "Thiruvananthapuram", "match": re.compile(r"\b(tvm|trivandrum|thiruvananthapuram)\b", re.I)},
    {"code": "DEL", "label": "Delhi", "match": re.compile(r"\b(del|delhi|new delhi)\b", re.I)},
    {"code": "BOM", "label": "Mumbai", "match": re.compile(r"\b(bom|bombay|mumbai)\b", re.I)},
]


def city_label(code: Optional[str]) -> str:
    for c in CITY_ALIASES:
        if c["code"] == code:
            return c["label"]
    return code or ""


def _city_in(text: str) -> Optional[str]:
    for c in CITY_ALIASES:
        if c["match"].search(text):
            return c["code"]
    return None


PHRASE_BOUNDARY = {
    "to", "from", "on", "for", "next", "this", "in", "at", "with", "and",
    "departing", "leaving", "returning", "flying",
}


def _first_city_after(text: str, preposition: str) -> Optional[str]:
    pattern = re.compile(rf"\b{preposition}\s+([a-z]+(?:\s+[a-z]+){{0,2}})", re.I)
    for match in pattern.finditer(text):
        if not match.group(1):
            continue
        words: List[str] = []
        for word in match.group(1).split():
            if word.lower() in PHRASE_BOUNDARY:
                break
            words.append(word)
        code = _city_in(" ".join(words))
        if code:
            return code
    return None


def _directional_cities(text: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    origin_code = _first_city_after(text, "from")
    dest_code = _first_city_after(text, "to")
    if origin_code:
        out["origin"] = origin_code
    if dest_code and dest_code != origin_code:
        out["destination"] = dest_code
    return out


MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]


def _iso_date(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def extract_date(text: str, today: Optional[datetime] = None) -> Optional[str]:
    """Understands 2026-08-15, 15 Aug, Aug 15, tomorrow, next friday."""
    today = today or datetime.now(timezone.utc)
    explicit = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if explicit:
        return explicit.group(1)

    lower = text.lower()
    if re.search(r"\btomorrow\b", lower):
        d = today + timedelta(days=1)
        return _iso_date(d)

    weekday = re.search(r"\bnext\s+(sun|mon|tue|wed|thu|fri|sat)", lower)
    if weekday:
        target = WEEKDAYS.index(weekday.group(1))
        # JS getUTCDay() is Sunday=0; Python's weekday() is Monday=0.
        js_today_day = (today.weekday() + 1) % 7
        delta = ((target - js_today_day + 7) % 7) or 7
        d = today + timedelta(days=delta)
        return _iso_date(d)

    day_first = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b", lower)
    month_first = re.search(r"\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b", lower)
    if day_first:
        day, month = int(day_first.group(1)), day_first.group(2)
    elif month_first:
        day, month = int(month_first.group(2)), month_first.group(1)
    else:
        day = month = None

    if month:
        month_index = None
        for i, m in enumerate(MONTHS):
            if month[:3] == m:
                month_index = i
                break
        if month_index is not None and 1 <= day <= 31:
            year_match = re.search(r"\b(20\d{2})\b", lower)
            year = int(year_match.group(1)) if year_match else today.year
            try:
                candidate = datetime(year, month_index + 1, day, tzinfo=timezone.utc)
            except ValueError:
                return None
            today_midnight = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
            if candidate < today_midnight:
                try:
                    candidate = candidate.replace(year=year + 1)
                except ValueError:
                    pass
            return _iso_date(candidate)
    return None


def _extract_travelers(text: str) -> Optional[int]:
    lower = text.lower()
    if re.search(r"\b(just me|solo|myself|only me|alone)\b", lower):
        return 1
    words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}
    word = re.search(r"\b(one|two|three|four|five|six)\b\s*(?:people|persons?|travell?ers?|adults?|of us|passengers?)?", lower)
    if word:
        w = word.group(1)
        if re.search(r"(people|persons?|travell?ers?|adults?|of us|passengers?)", lower) or re.match(
            rf"^\s*({w})\s*$", lower.strip()
        ):
            return words[w]
    digits = re.search(r"\b(\d{1,2})\s*(?:people|persons?|travell?ers?|adults?|guests?|passengers?|of us)\b", lower)
    if digits:
        return int(digits.group(1))
    bare = re.match(r"^(\d{1,2})$", lower.strip())
    if bare:
        return int(bare.group(1))
    return None


def _extract_airline(text: str) -> Optional[str]:
    lower = text.lower()
    if re.search(r"\b(no preference|any airline|any carrier|doesn'?t matter|no pref|any)\b", lower):
        return "any"
    if re.search(r"\bhelix\s*air\b", lower):
        return "Helix Air"
    if re.search(r"\bskyline\b", lower):
        return "Skyline"
    return None


def _extract_budget(text: str) -> Optional[int]:
    lower = text.lower()
    if re.search(r"\b(no budget|any budget|no limit|doesn'?t matter)\b", lower):
        return 0
    if re.search(r"\b(luxury|premium|best available)\b", lower):
        return 12000
    if re.search(r"\b(mid|moderate|standard|mid-range)\b", lower):
        return 8000
    if re.search(r"\b(budget|cheap|economical|affordable)\b", lower):
        return 5500
    # NOTE (inherited from conversation.ts, not a Python-only issue): both the
    # currency prefix and the "per night" suffix are optional here, so a bare
    # 4-digit run anywhere in the message -- e.g. "2026" from a "2026-09-16"
    # date -- matches too. Kept as-is for behavioral parity with the JS
    # source; harmless in practice since hotelBudget only gates the hotel
    # track, but it does show up in the trip-summary chip on flight-only
    # conversations.
    amount = re.search(r"(?:₹|rs\.?|inr)?\s*(\d[\d,]{2,})\s*(?:per night|a night|/night|nightly)?", lower)
    if amount:
        value = int(amount.group(1).replace(",", ""))
        if value >= 1000:
            return value
    return None


def extract_slots(message: str, profile: TripProfile, for_return: bool = False) -> TripProfile:
    """Folds anything the message reveals into the running profile. Later
    mentions win, so a user can correct themselves mid-conversation."""
    next_profile: TripProfile = dict(profile)
    text = message.strip()

    directional = _directional_cities(text)
    if directional.get("origin"):
        next_profile["origin"] = directional["origin"]
    if directional.get("destination"):
        next_profile["destination"] = directional["destination"]

    if not directional.get("origin") and not directional.get("destination"):
        single = _city_in(text)
        correcting = bool(re.search(r"\b(actually|instead|change (?:it )?to|make it|rather|no,)\b", text, re.I))
        if single:
            if correcting:
                next_profile["destination"] = single
            elif not next_profile.get("destination"):
                next_profile["destination"] = single
            elif not next_profile.get("origin") and single != next_profile.get("destination"):
                next_profile["origin"] = single
            else:
                next_profile["destination"] = single

    date = extract_date(text)
    if date:
        if for_return:
            next_profile["returnDate"] = date
        else:
            next_profile["departureDate"] = date

    travelers = _extract_travelers(text)
    if travelers:
        next_profile["travelers"] = travelers

    airline = _extract_airline(text)
    if airline:
        next_profile["airlinePreference"] = airline

    budget = _extract_budget(text)
    if budget is not None:
        next_profile["hotelBudget"] = budget

    return next_profile


def _next_month_day(days_ahead: int) -> str:
    d = datetime.now(timezone.utc) + timedelta(days=days_ahead)
    return _iso_date(d)


def next_flight_question(profile: TripProfile) -> Optional[dict]:
    if not profile.get("destination"):
        return {
            "field": "destination",
            "question": "Happy to help you plan this trip. Where would you like to fly to?",
            "suggestions": ["Delhi", "Mumbai"],
        }
    if not profile.get("origin"):
        return {
            "field": "origin",
            "question": f"Great — {city_label(profile.get('destination'))} it is. Which city are you flying from?",
            "suggestions": ["Thiruvananthapuram"],
        }
    if not profile.get("departureDate"):
        return {
            "field": "departureDate",
            "question": "What date would you like to travel?",
            "suggestions": [_next_month_day(14), _next_month_day(21)],
        }
    if not profile.get("travelers"):
        return {
            "field": "travelers",
            "question": "How many travellers are going?",
            "suggestions": ["Just me", "2 travellers", "3 travellers"],
        }
    if not profile.get("airlinePreference"):
        return {
            "field": "airlinePreference",
            "question": "Do you have an airline preference? We fly Helix Air and Skyline on this route.",
            "suggestions": ["Helix Air", "Skyline", "No preference"],
        }
    return None


def next_hotel_question(profile: TripProfile) -> Optional[dict]:
    if not profile.get("destination"):
        return {
            "field": "destination",
            "question": "Which city should I look for hotels in?",
            "suggestions": ["Delhi", "Mumbai"],
        }
    if profile.get("hotelBudget") is None:
        return {
            "field": "hotelBudget",
            "question": f"What is your nightly budget for {city_label(profile.get('destination'))}?",
            "suggestions": ["Under ₹5,500", "Around ₹8,000", "No limit"],
        }
    return None


def next_return_question(profile: TripProfile) -> Optional[dict]:
    if not profile.get("origin") or not profile.get("destination"):
        return next_flight_question(profile)
    if not profile.get("returnDate"):
        base_str = profile.get("departureDate")
        base = datetime.strptime(base_str, "%Y-%m-%d").replace(tzinfo=timezone.utc) if base_str else datetime.now(timezone.utc)
        base = base + timedelta(days=5)
        return {
            "field": "returnDate",
            "question": f"When would you like to fly back to {city_label(profile.get('origin'))}?",
            "suggestions": [_iso_date(base)],
        }
    return None


def summarise_profile(profile: TripProfile) -> str:
    bits: List[str] = []
    origin, destination = profile.get("origin"), profile.get("destination")
    if origin and destination:
        bits.append(f"{city_label(origin)} → {city_label(destination)}")
    elif destination:
        bits.append(f"to {city_label(destination)}")
    if profile.get("departureDate"):
        bits.append(str(profile["departureDate"]))
    travelers = profile.get("travelers")
    if travelers:
        bits.append(f"{travelers} traveller{'s' if travelers > 1 else ''}")
    airline = profile.get("airlinePreference")
    if airline and airline != "any":
        bits.append(str(airline))
    budget = profile.get("hotelBudget")
    if budget:
        bits.append(f"≤ ₹{budget:,}/night")
    return " · ".join(bits)


def mentions_hotel(message: str) -> bool:
    return bool(re.search(r"\b(hotel|stay|accommodation|room|lodging)\b", message, re.I))


def mentions_flight(message: str) -> bool:
    return bool(re.search(r"\b(flight|fly|flights|airline|air)\b", message, re.I))


def mentions_trip_planning(message: str) -> bool:
    return bool(re.search(r"\b(trip|travel|travelling|traveling|journey|vacation|holiday|getaway|plan)\b", message, re.I))


def mentions_return(message: str) -> bool:
    return bool(re.search(r"\b(return|back home|coming back|way back)\b", message, re.I))


def resolve_track(message: str, answering: bool, track: Optional[str] = None) -> str:
    if mentions_hotel(message):
        return "hotel"
    if mentions_return(message):
        return "return"
    if answering and track:
        return track
    return "flight"


def mentions_booking_confirmation(message: str) -> bool:
    if not re.search(r"\b(book|reserve|confirm|select|take)\b", message, re.I):
        return False
    return bool(
        re.search(r"\b[A-Z]{2}\d{3}\b", message)
        or re.search(r"\bHS-[A-Z]+-\d+\b", message, re.I)
        or re.search(r"\boption\s*\d+\b", message, re.I)
    )
