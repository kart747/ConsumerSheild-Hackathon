"""Direct Gemini API diagnostic for ConsumerShield backend.

Usage:
  /home/kart/Desktop/hackathon/.venv/bin/python test_gemini_direct.py
"""

import json
import os

from dotenv import load_dotenv
from google import genai
from google.genai import types


def main() -> int:
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("GEMINI_API_KEY missing in .env")
        return 1

    client = genai.Client(api_key=api_key)
    model = "gemini-1.5-flash"
    prompt = "In one sentence, summarize why deceptive consent banners are risky for users."

    try:
        response = client.models.generate_content(
            model=model,
            contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt)])],
            config=types.GenerateContentConfig(temperature=0.2),
        )

        text = getattr(response, "text", None)
        if not isinstance(text, str) or not text.strip():
            try:
                text = response.candidates[0].content.parts[0].text
            except Exception:
                text = None

        print("model:", model)
        print("response:", (text or "<empty response>").strip())
        return 0
    except Exception as exc:
        print("model:", model)
        print("ERROR:", str(exc))
        try:
            # Structured dump helps identify quota/permission issues quickly.
            print("ERROR_JSON:", json.dumps(getattr(exc, "args", []), ensure_ascii=False))
        except Exception:
            pass
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
