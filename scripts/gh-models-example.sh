#!/usr/bin/env bash
# scripts/gh-models-example.sh
#
# Minimal curl harness for GitHub Models (OpenAI-compatible chat completions).
# Reads creds from env. Never hard-code a token in this file.
#
# Usage:
#   GITHUB_TOKEN=ghp_xxx ./scripts/gh-models-example.sh "Three bullets on RAG."
#   GH_MODELS_MODEL=meta/llama-3.1-70b-instruct GITHUB_TOKEN=... ./scripts/gh-models-example.sh "..."
#
# See docs/agent/05-github-models.md for the broader pattern (server-side only).

set -euo pipefail

PROMPT="${1:-Give a 3-bullet outline for \"vector search basics\".}"
MODEL="${GH_MODELS_MODEL:-openai/gpt-4o-mini}"
ENDPOINT="${GITHUB_MODELS_ENDPOINT:-https://models.github.ai/inference}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "error: GITHUB_TOKEN must be set in the environment." >&2
  echo "  hint: export GITHUB_TOKEN=\$(gh auth token)" >&2
  exit 64
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq / apt install jq)." >&2
  exit 64
fi

payload=$(jq -n --arg model "$MODEL" --arg prompt "$PROMPT" '{
  model: $model,
  temperature: 0.4,
  max_tokens: 512,
  messages: [
    { role: "system", content: "You are a concise research outline assistant." },
    { role: "user",   content: $prompt }
  ]
}')

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

http_code=$(curl -sS -o "$tmp" -w "%{http_code}" \
  -X POST "$ENDPOINT/chat/completions" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  --data "$payload")

case "$http_code" in
  200)
    jq -r '.choices[0].message.content // .' "$tmp"
    ;;
  429)
    echo "warn: rate limited (429). GitHub Models is prototyping-tier; retry later." >&2
    jq . "$tmp" >&2 || cat "$tmp" >&2
    exit 0
    ;;
  401|403|404)
    echo "warn: HTTP $http_code — confirm the token has access to GitHub Models for this account/repo." >&2
    jq . "$tmp" >&2 || cat "$tmp" >&2
    exit 0
    ;;
  *)
    echo "error: unexpected HTTP $http_code" >&2
    jq . "$tmp" >&2 || cat "$tmp" >&2
    exit 1
    ;;
esac
