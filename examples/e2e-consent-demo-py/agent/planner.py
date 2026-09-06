# Tool planning, provider-neutral. Python port of agent/gemini.ts.
#
# Gemini, OpenAI, or Anthropic when a key is configured, with a deterministic
# scripted fallback when it is not. History is always plain natural-language
# text (see describe_plan_for_history) -- no provider ever replays a raw
# function-call turn, so (unlike the travel-concierge demo) there is no
# thoughtSignature concern here.

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Protocol

import requests

REQUIRED_ARGS = {
    "search_flights": ["origin", "destination", "departureDate"],
    "book_flight": ["flightId"],
    "modify_booking": ["bookingId"],
    "search_hotels": ["city"],
    "book_hotel": ["hotelId"],
}

FUNCTION_DECLARATIONS = [
    {
        "name": "search_flights",
        "description": "Search available flights between an origin and destination city or airport code.",
        "parameters": {
            "type": "object",
            "properties": {
                "origin": {"type": "string", "description": "Origin city or airport code, for example TVM."},
                "destination": {"type": "string", "description": "Destination city or airport code, for example DEL."},
                "departureDate": {"type": "string", "description": "Travel date in YYYY-MM-DD format."},
            },
            "required": ["origin", "destination", "departureDate"],
        },
    },
    {
        "name": "book_flight",
        "description": "Book a flight selected from the latest flight search results.",
        "parameters": {"type": "object", "properties": {"flightId": {"type": "string"}}, "required": ["flightId"]},
    },
    {
        "name": "modify_booking",
        "description": "Modify an existing flight booking.",
        "parameters": {"type": "object", "properties": {"bookingId": {"type": "string"}}, "required": ["bookingId"]},
    },
    {
        "name": "search_hotels",
        "description": "Search available hotels in a city.",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "Destination city or airport code."}},
            "required": ["city"],
        },
    },
    {
        "name": "book_hotel",
        "description": "Book a hotel selected from the latest hotel search results.",
        "parameters": {"type": "object", "properties": {"hotelId": {"type": "string"}}, "required": ["hotelId"]},
    },
]


class ToolValidationError(Exception):
    """The model was understood and refused -- an unknown tool, missing
    arguments, or an id that was never offered. Distinct from the provider
    being unreachable."""


def _offered_flight_ids(context: Dict[str, Any]) -> set:
    ids = set()
    if context.get("selectedFlight"):
        ids.add(context["selectedFlight"]["flightId"])
    for option in context.get("flightOptions") or []:
        ids.add(option["flightId"])
    return ids


def _offered_hotel_ids(context: Dict[str, Any]) -> set:
    ids = set()
    if context.get("selectedHotel"):
        ids.add(context["selectedHotel"]["hotelId"])
    for option in context.get("hotelOptions") or []:
        ids.add(option["hotelId"])
    return ids


def _normalize_place(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in ("del", "delhi", "new delhi"):
        return "DEL"
    if normalized in ("bom", "bombay", "mumbai"):
        return "BOM"
    if normalized in ("tvm", "trivandrum", "thiruvananthapuram"):
        return "TVM"
    return value.strip()


def validate_planned_tool_call(name: Optional[str], raw_args: Any, context: Dict[str, Any]) -> Dict[str, Any]:
    if not name or name not in REQUIRED_ARGS:
        raise ToolValidationError(f"The planner returned an unsupported tool: {name}")
    if not isinstance(raw_args, dict):
        raise ToolValidationError(f"The planner returned invalid arguments for {name}")

    args: Dict[str, str] = {}
    for key in REQUIRED_ARGS[name]:
        value = raw_args.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ToolValidationError(f"The planner omitted required argument {key} for {name}")
        args[key] = value.strip()

    if name == "search_flights":
        args["origin"] = _normalize_place(args["origin"])
        args["destination"] = _normalize_place(args["destination"])
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", args["departureDate"]):
            raise ToolValidationError("Flight departureDate must use YYYY-MM-DD format")
    if name == "search_hotels":
        args["city"] = _normalize_place(args["city"])
    if name == "book_flight" and args["flightId"] not in _offered_flight_ids(context):
        raise ToolValidationError("The requested flight is not the flight selected from trusted search results")
    if name == "book_hotel" and args["hotelId"] not in _offered_hotel_ids(context):
        raise ToolValidationError("The requested hotel is not the hotel selected from trusted search results")

    return {"kind": "tool_call", "tool": name, "args": args}


def describe_plan_for_history(plan: Dict[str, Any]) -> str:
    """Renders a plan as a natural assistant turn for conversation history.
    Must never look like a serialized tool call -- see gemini.ts's comment
    for why (a model taught, by example, to echo JSON stops calling tools)."""
    if plan["kind"] in ("message", "ask"):
        return plan["message"]
    args = plan["args"]
    tool = plan["tool"]
    if tool == "search_flights":
        return f"I showed the available flights from {args['origin']} to {args['destination']} on {args['departureDate']}."
    if tool == "book_flight":
        return f"I booked flight {args['flightId']}."
    if tool == "modify_booking":
        return f"I modified booking {args['bookingId']}."
    if tool == "search_hotels":
        return f"I showed the available hotels in {args['city']}."
    if tool == "book_hotel":
        return f"I booked hotel {args['hotelId']}."
    return ""


def _tomorrow_iso_date() -> str:
    from datetime import timedelta

    return (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")


def _choose_offered(message: str, ids: List[str]) -> Optional[str]:
    upper = message.upper()
    for i in ids:
        if i.upper() in upper:
            return i
    ordinal = re.search(r"option\s*(\d+)", message, re.I)
    if ordinal:
        idx = int(ordinal.group(1)) - 1
        if 0 <= idx < len(ids):
            return ids[idx]
    return None


class ToolPlanner(Protocol):
    provider: str
    model: str

    def plan(self, message: str, context: Dict[str, Any], history: List[Dict[str, str]]) -> Dict[str, Any]: ...

    def phrase(self, question: str, suggestions: List[str], known: Dict[str, Any]) -> Optional[str]: ...


class DeterministicPlanner:
    provider = "deterministic"
    model = "scripted-fallback"

    def plan(self, message: str, context: Dict[str, Any], history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
        history = history or []
        prior_user_text = " ".join(e["content"] for e in history if e["role"] == "user")
        text = f"{prior_user_text} {message}".lower()
        date_match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", message)
        requested_date = date_match.group(0) if date_match else _tomorrow_iso_date()
        confirms = "yes" in text or "book" in text or "option 1" in text

        if confirms:
            wants_hotel = bool(re.search(r"hotel", message, re.I))
            wants_flight = bool(re.search(r"flight", message, re.I))
            named_flight = None if (wants_hotel and not wants_flight) else _choose_offered(
                message, list(_offered_flight_ids(context))
            )
            named_hotel = None if (wants_flight and not wants_hotel) else _choose_offered(
                message, list(_offered_hotel_ids(context))
            )
            if named_flight:
                return validate_planned_tool_call("book_flight", {"flightId": named_flight}, context)
            if named_hotel:
                return validate_planned_tool_call("book_hotel", {"hotelId": named_hotel}, context)
            if context.get("selectedHotel"):
                return validate_planned_tool_call(
                    "book_hotel", {"hotelId": context["selectedHotel"]["hotelId"]}, context
                )
            if context.get("selectedFlight"):
                return validate_planned_tool_call(
                    "book_flight", {"flightId": context["selectedFlight"]["flightId"]}, context
                )

        if "return" in text:
            itinerary = context.get("itinerary") or {}
            return validate_planned_tool_call(
                "search_flights",
                {
                    "origin": itinerary.get("destination", "DEL"),
                    "destination": itinerary.get("origin", "TVM"),
                    "departureDate": requested_date,
                },
                context,
            )
        if "hotel" in text:
            return validate_planned_tool_call("search_hotels", {"city": "DEL"}, context)
        if "flight" in text or "delhi" in text or "bombay" in text or "mumbai" in text:
            destination = "BOM" if ("bombay" in text or "mumbai" in text or "bom" in text) else "DEL"
            return validate_planned_tool_call(
                "search_flights", {"origin": "TVM", "destination": destination, "departureDate": requested_date}, context
            )
        return {"kind": "message", "message": "Ask me for a flight from TVM to Delhi, a hotel in Delhi, or a return flight."}

    def phrase(self, question: str, suggestions: List[str], known: Dict[str, Any]) -> Optional[str]:
        return None


def _system_prompt(context: Dict[str, Any]) -> str:
    return "\n".join(
        [
            "You are a concise travel-planning agent for a HelixID consent demo.",
            "Use tools for every flight or hotel search, booking, or modification.",
            "TVM means Thiruvananthapuram and DEL means Delhi.",
            'When the user confirms a booking, book the option they named. They may name it by id ("book HA733") or by position ("option 2"); resolve it against flightOptions/hotelOptions in the context.',
            "If they simply confirm without naming one, use selectedFlight/selectedHotel.",
            "Only ever book an id that appears in flightOptions, hotelOptions, selectedFlight, or selectedHotel.",
            "For a return-flight request, reverse the trusted itinerary supplied in context.",
            "Never invent a travel date. If the user did not provide the needed flight date, ask for it before calling search_flights.",
            "Never invent a flightId, hotelId, booking result, consent state, credential, or permission.",
            "To act, emit a function call. Never write text that merely describes a tool call, and never put JSON or argument lists in a text reply -- if you cannot call the tool, say plainly what you need instead.",
            f"Today is {datetime.now(timezone.utc).strftime('%Y-%m-%d')}. Resolve dates such as \"Aug 10th\" against today and return YYYY-MM-DD.",
            f"Current trusted UI context: {json.dumps(context)}",
        ]
    )


def _phrase_prompt(question: str, suggestions: List[str], known: Dict[str, Any]) -> str:
    return "\n".join(
        [
            "You are the voice of a travel-planning agent, mid-conversation.",
            "Rewrite the agent's next question so it sounds natural and acknowledges what the traveller just said.",
            "Ask for exactly the same single piece of information. Never add, drop, or merge questions.",
            "One or two short sentences, at most 25 words, ending in a single question mark.",
            "No lists, markdown, or emoji.",
            "Never invent flights, prices, dates, or availability, and never answer the question yourself.",
            f"Already known: {json.dumps(known)}",
            f"Answers the interface will offer: {json.dumps(suggestions)}",
            "Reply with the rewritten question and nothing else.",
        ]
    )


class GeminiPlanner:
    provider = "gemini"
    API_BASE = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model

    def plan(self, message: str, context: Dict[str, Any], history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
        history = history or []
        contents = [
            {"role": "model" if e["role"] == "assistant" else "user", "parts": [{"text": e["content"]}]}
            for e in history
        ]
        contents.append({"role": "user", "parts": [{"text": message}]})
        body = {
            "systemInstruction": {"parts": [{"text": _system_prompt(context)}]},
            "contents": contents,
            "tools": [{"functionDeclarations": FUNCTION_DECLARATIONS}],
            "generationConfig": {"maxOutputTokens": 256, "temperature": 0.1},
        }
        data = self._call(body)
        parts = (((data.get("candidates") or [{}])[0]).get("content") or {}).get("parts") or []
        fn_call = next((p["functionCall"] for p in parts if p.get("functionCall")), None)
        if fn_call:
            return validate_planned_tool_call(fn_call.get("name"), fn_call.get("args") or {}, context)
        text = "".join(p.get("text", "") for p in parts).strip()
        return {"kind": "message", "message": text or "How can I help with your trip?"}

    def phrase(self, question: str, suggestions: List[str], known: Dict[str, Any]) -> Optional[str]:
        body = {
            "systemInstruction": {"parts": [{"text": _phrase_prompt(question, suggestions, known)}]},
            "contents": [{"role": "user", "parts": [{"text": question}]}],
            # No thinkingConfig: gemini-flash-latest rejects an explicit
            # thinkingBudget with INVALID_ARGUMENT, and rewording one sentence
            # finishes well inside this allowance anyway.
            "generationConfig": {"maxOutputTokens": 200, "temperature": 0.6},
        }
        data = self._call(body)
        parts = (((data.get("candidates") or [{}])[0]).get("content") or {}).get("parts") or []
        return "".join(p.get("text", "") for p in parts).strip()

    def _call(self, body: Dict[str, Any]) -> Dict[str, Any]:
        res = requests.post(
            f"{self.API_BASE}/models/{self.model}:generateContent",
            headers={"content-type": "application/json", "x-goog-api-key": self.api_key},
            json=body,
            timeout=30,
        )
        if not res.ok:
            raise RuntimeError(f"Gemini API error {res.status_code}: {res.text}")
        return res.json()


class OpenAIPlanner:
    provider = "openai"

    def __init__(self, api_key: str, model: str) -> None:
        from openai import OpenAI

        self.model = model
        self.client = OpenAI(api_key=api_key)

    def plan(self, message: str, context: Dict[str, Any], history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
        history = history or []
        messages = (
            [{"role": "system", "content": _system_prompt(context)}]
            + [{"role": e["role"], "content": e["content"]} for e in history]
            + [{"role": "user", "content": message}]
        )
        response = self.client.chat.completions.create(
            model=self.model,
            temperature=0.1,
            messages=messages,
            tools=[
                {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}}
                for t in FUNCTION_DECLARATIONS
            ],
            tool_choice="auto",
        )
        choice = response.choices[0].message
        call = (choice.tool_calls or [None])[0]
        if call and call.type == "function":
            try:
                args = json.loads(call.function.arguments)
            except json.JSONDecodeError as exc:
                raise RuntimeError("OpenAI returned malformed tool arguments") from exc
            return validate_planned_tool_call(call.function.name, args, context)
        return {"kind": "message", "message": (choice.content or "").strip() or "How can I help with your trip?"}

    def phrase(self, question: str, suggestions: List[str], known: Dict[str, Any]) -> Optional[str]:
        response = self.client.chat.completions.create(
            model=self.model,
            max_tokens=200,
            temperature=0.6,
            messages=[
                {"role": "system", "content": _phrase_prompt(question, suggestions, known)},
                {"role": "user", "content": question},
            ],
        )
        return (response.choices[0].message.content or "").strip()


class AnthropicPlanner:
    provider = "anthropic"

    def __init__(self, api_key: str, model: str) -> None:
        import anthropic

        self.model = model
        self.client = anthropic.Anthropic(api_key=api_key)

    def plan(self, message: str, context: Dict[str, Any], history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
        history = history or []
        messages = [{"role": e["role"], "content": e["content"]} for e in history] + [
            {"role": "user", "content": message}
        ]
        response = self.client.messages.create(
            model=self.model,
            max_tokens=700,
            temperature=0.1,
            system=_system_prompt(context),
            messages=messages,
            tools=[
                {"name": t["name"], "description": t["description"], "input_schema": t["parameters"]}
                for t in FUNCTION_DECLARATIONS
            ],
        )
        call = next((b for b in response.content if b.type == "tool_use"), None)
        if call:
            return validate_planned_tool_call(call.name, call.input, context)
        text_block = next((b for b in response.content if b.type == "text"), None)
        return {"kind": "message", "message": (text_block.text.strip() if text_block else "How can I help with your trip?")}

    def phrase(self, question: str, suggestions: List[str], known: Dict[str, Any]) -> Optional[str]:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=200,
            temperature=0.6,
            system=_phrase_prompt(question, suggestions, known),
            messages=[{"role": "user", "content": question}],
        )
        text_block = next((b for b in response.content if b.type == "text"), None)
        return text_block.text.strip() if text_block else ""


def create_tool_planner(provider: str, api_key: str, model: str) -> ToolPlanner:
    if provider == "openai":
        return OpenAIPlanner(api_key, model)
    if provider == "anthropic":
        return AnthropicPlanner(api_key, model)
    return GeminiPlanner(api_key, model)


# -- Phrasing: reword an engine-chosen question, with a timeout + cache -----

PHRASE_TIMEOUT_SECONDS = 3.5
_phrase_cache: Dict[str, str] = {}
PHRASE_CACHE_LIMIT = 64


def acceptable_phrasing(candidate: str) -> bool:
    text = candidate.strip()
    if not text or len(text) > 240:
        return False
    if "\n" in text:
        return False
    return text.count("?") == 1


def phrase_question(planner: ToolPlanner, question: str, suggestions: List[str], known: Dict[str, Any]) -> str:
    """Rewords one engine-chosen question, falling back to the engine's own
    wording on anything unexpected or slow. Cached: the free-tier key allows
    only 20 requests/day, enough to reword each distinct question once."""
    key = f"{question} {json.dumps(known, sort_keys=True)}"
    cached = _phrase_cache.get(key)
    if cached:
        return cached

    result: Dict[str, Any] = {}

    def _run() -> None:
        try:
            result["value"] = planner.phrase(question, suggestions, known)
        except Exception as exc:  # noqa: BLE001
            result["error"] = exc

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    thread.join(timeout=PHRASE_TIMEOUT_SECONDS)

    if thread.is_alive() or "error" in result or not result.get("value"):
        return question

    reworded = result["value"]
    if not acceptable_phrasing(reworded):
        return question

    if len(_phrase_cache) >= PHRASE_CACHE_LIMIT:
        _phrase_cache.clear()
    _phrase_cache[key] = reworded.strip()
    return reworded.strip()
