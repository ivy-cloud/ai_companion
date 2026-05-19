import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import errors as genai_errors
from pydantic import BaseModel

app = FastAPI(title="AI Companion API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_genai_client = None


def get_genai_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="GEMINI_API_KEY environment variable is not set",
            )
        _genai_client = genai.Client(api_key=api_key)
    return _genai_client


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str


# Flash first; flash-lite has higher free-tier limits; pro last for non-quota failures.
MODELS = ("gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro")

QUOTA_HELP = (
    "Gemini API quota exceeded for this Google Cloud project. "
    "Limits are shared across all models and API keys in the project "
    "(RPM per minute and RPD per day on the free tier). "
    "Check usage at https://aistudio.google.com/rate-limit or enable billing "
    "in AI Studio to raise limits."
)


def is_quota_error(exc: Exception) -> bool:
    if isinstance(exc, genai_errors.ClientError) and exc.code == 429:
        return True
    text = str(exc).lower()
    return (
        "quota" in text
        or "rate limit" in text
        or "resource_exhausted" in text
        or "resource exhausted" in text
    )


def raise_for_api_error(exc: Exception) -> None:
    if is_quota_error(exc):
        raise HTTPException(status_code=429, detail=QUOTA_HELP) from exc
    raise HTTPException(status_code=500, detail=str(exc)) from exc


def generate_reply(client: genai.Client, message: str) -> str:
    last_error = None
    for model in MODELS:
        try:
            response = client.models.generate_content(
                model=model,
                contents=message,
            )
            reply = (response.text or "").strip()
            if reply:
                return reply
        except Exception as exc:
            last_error = exc
            # Same project quota — trying another model usually fails again.
            if is_quota_error(exc):
                break
    if last_error:
        raise last_error
    return "I don't have a reply right now. Please try again."


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest) -> ChatResponse:
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message cannot be empty")

    try:
        client = get_genai_client()
        reply = generate_reply(client, message)
        return ChatResponse(reply=reply)
    except HTTPException:
        raise
    except Exception as exc:
        raise_for_api_error(exc)
