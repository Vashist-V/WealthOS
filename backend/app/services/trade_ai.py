"""Ask a model to read trades, from screenshots of a broker's app or from a sentence.

The answer comes back as data, not prose: each service is made to fill in a fixed
shape (a forced tool call for Claude, a JSON schema for Gemini, JSON mode for Groq
and the like). It goes through the same services as the assistant, in the same
order: Claude on Bedrock first, then the free services when Claude is busy or past
the day's limit. Every one of them can read pictures.

Pictures are passed through in memory and are never written anywhere.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass

import httpx

from ..config import Settings
from . import assistant

log = logging.getLogger("wealthos.trades")

# Groq and the other OpenAI-style services take a handful of pictures per request.
COMPATIBLE_IMAGES = 5


@dataclass(frozen=True)
class Image:
    data: bytes
    media_type: str  # image/png, image/jpeg, image/webp or image/gif


class ReadError(Exception):
    """No service could read it. The message is meant for the user."""


class _Failed(Exception):
    def __init__(self, message: str, reason: str = "busy"):
        super().__init__(message)
        self.message, self.reason = message, reason


def available(settings: Settings) -> bool:
    return bool(assistant.providers(settings))


async def extract(
    settings: Settings, *, system: str, prompt: str, schema: dict, images: list[Image] | tuple[Image, ...] = (), tool: str = "record_trades"
) -> tuple[dict, str]:
    """What the model read, in the shape of `schema`, and the name of the model that read it.

    Each service, and each of a service's keys, is tried in turn until one answers.
    Raises ReadError when none could."""
    routes: list[tuple[str, Settings, tuple]] = []
    for name in assistant.providers(settings):
        field = assistant._KEY_FIELDS[name]
        for key in assistant._keys(getattr(settings, field)):
            routes.append((name, settings.model_copy(update={field: key}), ("key", name, assistant._tag(key))))
    if not routes:
        raise ReadError("Reading this needs AI, and no AI service is set up on this server.")
    now = time.time()
    routes = [route for route in routes if assistant._resting.get(route[2], 0) <= now] or routes
    problem: _Failed | None = None
    for name, own, rest in routes:
        try:
            if name == "bedrock":
                assistant._spend()  # counts against the paid model's daily limit, like a question
                return await _claude(own, system, prompt, schema, images, tool, bedrock=True)
            if name == "anthropic":
                return await _claude(own, system, prompt, schema, images, tool, bedrock=False)
            if name == "gemini":
                return await _gemini(own, system, prompt, schema, images)
            return await _compatible(own, system, prompt, schema, images)
        except _Failed as exc:
            if exc.reason in ("quota", "key"):
                assistant._resting[rest] = time.time() + assistant.REST_SECONDS
            log.info("%s could not read the trades (%s): %s", name, exc.reason, exc.message)
            problem = exc
    raise ReadError(problem.message if problem else "The AI service could not read this. Try again shortly.")


# ------------------------------------------------------------------- Claude
def _claude_request(model: str, system: str, schema: dict, content: list[dict], tool: str) -> dict:
    """One request that makes Claude fill in the shape: a single tool it must call."""
    return {
        "model": model,
        "max_tokens": 8000,
        "system": system,
        "tools": [{"name": tool, "description": "Record what was read, in this shape.", "input_schema": schema}],
        "tool_choice": {"type": "tool", "name": tool},
        "messages": [{"role": "user", "content": content}],
    }


async def _claude(settings: Settings, system: str, prompt: str, schema: dict, images, tool: str, *, bedrock: bool) -> tuple[dict, str]:
    import anthropic

    from .bedrock import _describe, _retry_elsewhere, model_label, models

    if bedrock:
        from anthropic import AsyncAnthropicBedrock

        client = AsyncAnthropicBedrock(aws_region=settings.aws_region, api_key=settings.aws_bearer_token_bedrock, max_retries=1, timeout=120.0)
        chain = models(settings)
    else:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, max_retries=1, timeout=120.0)
        chain = [settings.assistant_model]
    content: list[dict] = [
        {"type": "image", "source": {"type": "base64", "media_type": image.media_type, "data": base64.b64encode(image.data).decode()}}
        for image in images
    ]
    content.append({"type": "text", "text": prompt})
    for position, model in enumerate(chain):
        try:
            message = await client.messages.create(**_claude_request(model, system, schema, content, tool))
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
            if position < len(chain) - 1 and _retry_elsewhere(exc):
                log.info("%s could not read the trades (%s); asking %s", model, getattr(exc, "status_code", type(exc).__name__), chain[position + 1])
                continue
            if bedrock:
                text, reason = _describe(exc)
            else:
                status = getattr(exc, "status_code", 0)
                text, reason = "Claude couldn't read this right now. Try again shortly.", "quota" if status == 429 else "key" if status in (401, 403) else "busy"
            raise _Failed(text, reason) from exc
        for block in message.content:
            if block.type == "tool_use" and isinstance(block.input, dict):
                return block.input, model_label(model)
        raise _Failed("Claude didn't return the trades. Try again.", "busy")
    raise _Failed("No Claude model is configured.", "rejected")


# ------------------------------------------------------------------- Gemini
async def _gemini(settings: Settings, system: str, prompt: str, schema: dict, images) -> tuple[dict, str]:
    from google import genai
    from google.genai import errors as genai_errors
    from google.genai import types

    client = genai.Client(api_key=settings.gemini_api_key)
    parts = [types.Part.from_bytes(data=image.data, mime_type=image.media_type) for image in images]
    parts.append(types.Part(text=prompt))
    tag = assistant._tag(settings.gemini_api_key)
    models = assistant._keys(f"{settings.assistant_gemini_model} {settings.assistant_gemini_fallback}")
    # The same resting places as the chat uses, so a model out of its free allowance is passed over here too.
    now = time.time()
    plan = [model for model in models if assistant._resting.get(("step", tag, model, False), 0) <= now]
    if not plan:
        raise _Failed("The free Gemini quota is used up for now.", "quota")
    failure: Exception | None = None
    out_of_quota = False
    for model in plan:
        config = types.GenerateContentConfig(
            system_instruction=system, response_mime_type="application/json", response_json_schema=schema, max_output_tokens=8192, temperature=0,
        )
        try:
            response = await client.aio.models.generate_content(model=model, contents=[types.Content(role="user", parts=parts)], config=config)
        except genai_errors.APIError as exc:
            failure = exc
            out_of_quota = out_of_quota or exc.code == 429
            if exc.code in (404, 429, 500, 503):
                assistant._resting[("step", tag, model, False)] = time.time() + assistant._gemini_wait(exc)
                continue
            break
        try:
            data = json.loads(response.text or "")
        except ValueError:
            failure = ValueError("not JSON")
            continue
        if isinstance(data, dict):
            return data, "Gemini"
    code = getattr(failure, "code", 0)
    if code in (401, 403):
        raise _Failed("The Gemini API key was rejected.", "key")
    raise _Failed("Gemini couldn't read this right now.", "quota" if out_of_quota else "busy")


# ------------------------------------------- OpenAI-compatible services (Groq)
async def _compatible(settings: Settings, system: str, prompt: str, schema: dict, images) -> tuple[dict, str]:
    name = assistant.service_name(settings.llm_base_url)
    model = settings.llm_vision_model if images else settings.llm_model
    if not model:
        raise _Failed(f"{name} has no model set up that can read pictures.", "rejected")
    shape = f"{system}\n\nReply with a single JSON object and nothing else, in the shape this JSON schema describes:\n{json.dumps(schema)}"
    batches = [list(images[i : i + COMPATIBLE_IMAGES]) for i in range(0, len(images), COMPATIBLE_IMAGES)] or [[]]
    merged: dict = {}
    async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10)) as client:
        for number, batch in enumerate(batches):
            text = prompt
            if len(batches) > 1:
                first = number * COMPATIBLE_IMAGES + 1
                text += f"\n\nThese are screenshots {first} to {first + len(batch) - 1} of {len(images)}; number them from {first}."
            content: list[dict] | str = text
            if batch:
                content = [{"type": "text", "text": text}] + [
                    {"type": "image_url", "image_url": {"url": f"data:{image.media_type};base64,{base64.b64encode(image.data).decode()}"}}
                    for image in batch
                ]
            body: dict = {
                "model": model,
                "temperature": 0,
                "max_tokens": 4000,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": shape}, {"role": "user", "content": content}],
            }
            if "gpt-oss" in model:
                body["reasoning_effort"] = "low"
            try:
                response = await client.post(
                    f"{settings.llm_base_url.rstrip('/')}/chat/completions", headers={"Authorization": f"Bearer {settings.llm_api_key}"}, json=body
                )
            except httpx.HTTPError as exc:
                raise _Failed(f"Couldn't reach {name}.", "busy") from exc
            if response.status_code != 200:
                code = response.status_code
                log.info("%s %s refused to read: %s %s", name, model, code, response.text[:300])
                reason = "key" if code in (401, 403) else "quota" if code in (413, 429) else "busy" if code >= 500 else "rejected"
                raise _Failed(f"{name} couldn't read this right now.", reason)
            try:
                data = json.loads(response.json()["choices"][0]["message"]["content"])
            except (KeyError, IndexError, TypeError, ValueError) as exc:
                raise _Failed(f"{name} didn't return the trades.", "busy") from exc
            if not isinstance(data, dict):
                raise _Failed(f"{name} didn't return the trades.", "busy")
            for key, value in data.items():
                if isinstance(value, list):
                    merged[key] = [*merged.get(key, []), *value]
                elif isinstance(value, bool):
                    merged[key] = merged.get(key, value) and value if key.startswith("not_") else merged.get(key, False) or value
                else:
                    merged.setdefault(key, value)
    return merged, name
