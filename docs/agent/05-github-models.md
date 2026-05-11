# 05 — GitHub Models usage pattern

GitHub Models is GitHub's first-party prototyping surface for inference. Reference: <https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models>.

## Where to call it from

There are two modes; pick deliberately.

### A. Server-side (preferred)

Call Models from a **GitHub Action** (or any non-browser process) using `GITHUB_TOKEN` with the `models: read` permission. The Action then either:

- writes results into a workspace snapshot artifact attached to a release / PR, or
- posts a comment / pushes a commit with the generated outline.

This is the only mode that's safe with a static-site host, because **no secret ever reaches the bundle**.

`.github/workflows/models-smoke.yml` is the smallest possible example — `workflow_dispatch` only, model + prompt as inputs, no key ever logged.

### B. Client-side (advanced — proxy required)

The repo's `onAiIterate` hook in `src/App.tsx` is provider-agnostic. To talk to GitHub Models from the SPA you **must** stand up a thin proxy that:

1. authenticates the user (its own session)
2. injects the `Authorization: Bearer <token>` header server-side
3. forwards the OpenAI-compatible chat-completions payload to `https://models.github.ai/inference/chat/completions`

Do **not** store a Models token in `VITE_*`. Vite inlines those at build time and they would ship to every browser.

## Endpoint shape (OpenAI-compatible)

```
POST https://models.github.ai/inference/chat/completions
Authorization: Bearer <GITHUB_TOKEN>
Content-Type: application/json

{
  "model": "openai/gpt-4o-mini",
  "messages": [
    { "role": "system", "content": "You are a research outline assistant." },
    { "role": "user",   "content": "<prompt>" }
  ],
  "temperature": 0.4,
  "max_tokens": 1024
}
```

Response shape matches OpenAI chat completions; pull `choices[0].message.content`.

## Model selection

GitHub Models hosts many providers (OpenAI, Meta, Mistral, Microsoft Phi, etc.). The model id is namespaced — `openai/gpt-4o-mini`, `meta/llama-3.1-70b-instruct`, etc. Confirm availability and current ids in the GitHub Models catalogue.

## Rate limits — qualitative

GitHub Models is **prototyping-tier**: per-account daily and per-minute quotas, with higher limits for paid Copilot tiers. **Treat it as best-effort and bursty.** For production traffic, swap to a paid provider via the same OpenAI-compatible interface.

If you're rate-limited the Models API returns `429`; the example script and the smoke workflow surface that as a non-fatal warning.

## Mapping `AiIterateRequest` to chat messages

```ts
function buildMessages(req: AiIterateRequest): ChatMessage[] {
  const sys = 'You expand and refine research outlines. Reply in JSON: { title?, body?, children? }.'
  if (req.kind === 'seed') {
    return [
      { role: 'system', content: sys },
      { role: 'user', content: `Seed an outline for: ${req.prompt}\nContext:\n${req.workspaceContext ?? ''}` },
    ]
  }
  return [
    { role: 'system', content: sys },
    {
      role: 'user',
      content:
        `${req.kind === 'expand' ? 'Expand' : 'Refine'} this section: ${req.section.title}\n` +
        `Path: ${req.pathTitles.join(' / ')}\nBody:\n${req.section.body}`,
    },
  ]
}
```

Then call your proxy and resolve to `AiIterateResult`.

## Curl smoke test

`scripts/gh-models-example.sh` is a standalone curl harness. Set `GITHUB_TOKEN`, optionally `GH_MODELS_MODEL`, then run it. It uses env vars only — never edit a key into the file.
