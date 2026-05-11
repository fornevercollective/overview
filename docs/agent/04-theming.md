# 04 — Theming & fork story

The app's visual identity is driven by **CSS custom properties** declared on `:root` in `src/index.css`. Component-specific tokens live in `src/research/research.css` and `src/presentation.css`.

## Token surface (light)

```css
:root {
  --text:           #6b6375;
  --text-h:         #08060d;
  --bg:             #fff;
  --border:         #e5e4e7;
  --code-bg:        #fafafa;
  --accent:         #aa3bff;   /* primary brand */
  --accent-bg:      rgba(170, 59, 255, 0.10);
  --accent-border:  rgba(170, 59, 255, 0.50);
  --social-bg:      rgba(250, 250, 250, 0.5);
  --muted:          #6b7280;

  --sans:    system-ui, 'Segoe UI', Roboto, sans-serif;
  --heading: system-ui, 'Segoe UI', Roboto, sans-serif;
  --ro-serif:'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  --mono:    ui-monospace, Consolas, monospace;
}
```

Dark mode is auto-derived via `@media (prefers-color-scheme: dark)`; redefine the same variables to retheme.

## Forking checklist

1. **Re-theme** by editing `src/index.css` only — every component reads variables. Avoid hard-coded colours.
2. **Pick a brand accent.** Replace `--accent` and the two derived `--accent-*` tints in both light and dark blocks.
3. **Swap fonts** by changing `--sans` / `--heading` / `--ro-serif`. Self-hosted fonts go in `public/` and are referenced with `@font-face` in `index.css`.
4. **Update favicons:** `public/favicon.svg` and `public/icons.svg`.
5. **Set the page title** in `index.html`.
6. **Update remote** in `git remote set-url origin <your-fork>`.
7. **Configure Pages base** by setting `VITE_BASE_PATH=/<repo>/` in `.github/workflows/deploy-pages.yml` (already auto-derived from the repo name).

## What **not** to fork blindly

- The `OverviewWorkspaceSnapshot` schema — keep it source-compatible so users can move snapshots between forks.
- The `#workspace-share=` payload format — share URLs become unreadable across forks if you change the encoder.

## Component theming hooks

| Surface | File | Token to start with |
|---|---|---|
| Workspace shell | `src/research/research.css` | `--accent`, `--border`, `--bg` |
| Summary page | `src/index.css` (`.overview-summary*`) | `--text-h`, `--accent`, `--muted` |
| Presentation | `src/presentation.css` | `--bg`, `--text-h`, `--accent` |
| Code blocks | `src/index.css` (`code`) + highlight.js stylesheet shipped via `rehype-highlight` | `--code-bg`, `--mono` |
