# 03 — GitHub Actions

Three workflows ship under `.github/workflows/`:

## `ci.yml` — required check

Triggers: `pull_request` and `push` to `main`.

Steps:

1. Checkout
2. Setup Node LTS + cache `~/.npm`
3. `npm ci`
4. `npm run lint`
5. `npm run build`

Keep this **green** before merging anything.

## `deploy-pages.yml` — auto-deploy to GitHub Pages

Triggers: `push` to `main` and `workflow_dispatch`.

Permissions block (required by Pages):

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

Concurrency: a single in-flight Pages deploy (`group: pages`, `cancel-in-progress: false`).

Behaviour:

1. Build with `VITE_BASE_PATH=/${{ github.event.repository.name }}/` so asset URLs work under `https://<owner>.github.io/<repo>/`.
2. `actions/configure-pages@v5`
3. `actions/upload-pages-artifact@v4` from `dist/`
4. `actions/deploy-pages@v5` to environment `github-pages`

**Enable once per repo:** Settings → Pages → Source = "GitHub Actions". Re-running the workflow then deploys.

If you serve from a custom domain (`CNAME` in `public/`), set `VITE_BASE_PATH=/`.

## `models-smoke.yml` — optional, manual

Triggers: `workflow_dispatch` only. Inputs: `model` (default `openai/gpt-4o-mini`), `prompt`.

Uses the workflow's `GITHUB_TOKEN` with the `models: read` permission (preview surface — see [GitHub Models docs](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)). The job calls the OpenAI-compatible **chat completions** endpoint at `https://models.github.ai/inference/chat/completions` and prints the response.

If the Models REST surface or the `models:` permission is unavailable in your org plan, the job falls back to `echo` with a clear message — it never fails the build silently and never hardcodes a key.

## What CI does **not** do

- No bundle uploads to third parties.
- No automatic version bumps.
- No model calls during PR builds (those would cost tokens and leak prompts in logs).
