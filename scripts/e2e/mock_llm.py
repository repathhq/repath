"""
An OpenAI-compatible model provider for the end-to-end test.

It plays two parts, the same two a real provider plays in production:

* The model behind a rollout. A version whose system prompt pushes it to
  answer "confidently, even when unsure" gets a fluent, wrong answer; anything
  else gets the right one. That is the regression worth testing: same model,
  worse prompt, and an answer that sails through every cheap check — it is
  not empty, not an error and not a refusal (refusals are caught by the
  programmatic evaluator before the judge is ever called) — so only the judge
  can catch it.
* The judge. The evaluator calls it with its judging prompt; it scores the
  wrong answer 1/5 and the right one 5/5, with a reason, in the JSON the
  evaluator parses.

Deterministic on purpose: the test asserts on what the controller decides, so
the evidence it decides from must not vary between runs.
"""

import json
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

GOOD = "The capital of France is Paris."
BAD = "The capital of France is Lyon, which has been the seat of government since 1958."


def completion(model: str, text: str, prompt_tokens: int) -> dict:
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": max(1, len(text) // 4),
            "total_tokens": prompt_tokens + max(1, len(text) // 4),
        },
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet: the driver prints what matters
        pass

    def _send(self, status: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/health"):
            return self._send(200, {"ok": True})
        return self._send(404, {"error": {"message": "not found"}})

    def do_POST(self):
        if not self.path.rstrip("/").endswith("/chat/completions"):
            return self._send(404, {"error": {"message": f"unknown path {self.path}"}})
        length = int(self.headers.get("content-length") or 0)
        try:
            req = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": {"message": "invalid JSON"}})

        model = req.get("model", "mock")
        messages = req.get("messages") or []
        system = " ".join(
            str(m.get("content", "")) for m in messages if m.get("role") == "system"
        )
        prompt_tokens = max(1, sum(len(str(m.get("content", ""))) for m in messages) // 4)

        # The judge.
        if "quality evaluator" in system:
            user = " ".join(str(m.get("content", "")) for m in messages if m.get("role") == "user")
            answer = user.split("--- AI RESPONSE ---")[-1]
            if BAD in answer:
                verdict = {"score": 1, "reason": "States the wrong capital: it is Paris, not Lyon."}
            else:
                verdict = {"score": 5, "reason": "Answers the question directly and correctly."}
            return self._send(200, completion(model, json.dumps(verdict), prompt_tokens))

        # The model behind a rollout.
        text = BAD if "confidently" in system.lower() else GOOD
        return self._send(200, completion(model, text, prompt_tokens))


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 9999), Handler).serve_forever()
