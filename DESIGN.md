# Design: Inkloom 墨图

The locked system. Every Hallmark run reads this first and pages share it. Change it on purpose; the file is the rule.

## System

- Genre: modern-minimal
- Shape of the first page: app screen
- Theme: brand (vibe: "sculpted silver-stone neutral surfaces, slightly raised dark charcoal button bars with crisp white line icons, pearlescent raised active pills, compact 12px chrome")
- Axes: light/grotesk-sans/obsidian-slate · posture: restrained

## Tokens

`app/src/tokens.css` is the source of truth. The roles:

```css
:root {
  --color-paper: oklch(96.5% 0.005 255);  --color-paper-2: oklch(93.4% 0.006 255);  --color-paper-3: oklch(90.0% 0.007 255);
  --color-ink: oklch(20.0% 0.014 255);  --color-ink-2: oklch(30.0% 0.012 255);  --color-muted: oklch(44.5% 0.012 255);  --color-rule: oklch(86.5% 0.007 255);
  --color-accent: oklch(31.5% 0.014 255);  --color-accent-ink: oklch(98.8% 0.003 250);  --color-focus: oklch(34.0% 0.025 255);
  --font-display: "Manrope", system-ui, sans-serif;  --font-body: "Manrope", system-ui, sans-serif;  --font-outlier: "Cascadia Code", ui-monospace, monospace;
  --radius-card: 4px;  --radius-pill: 999px;  --rule-hair: 1px;  --shadow-card: 0 2px 8px oklch(18% 0.015 255 / 0.06);
}
```

The spacing scale (`--space-3xs` 2px to `--space-4xl` 144px), the type scale, the easings and the durations are the scaffold's and live in `app/src/tokens.css`.

## Controls

- Primary: `--color-accent` fill with `--color-accent-ink` text (`--ui-base` in dark mode) · `6px` radius (`--radius-md`) · `27px` to `28px` height · `12px` text
- Secondary: `1px solid var(--shell-line-strong)` outline on `--glass-control` with crisp `inset 0 1px 0 var(--glass-white)` highlight · `6px` radius
- Slightly Raised Dark Charcoal Button Bars (`--charcoal-bar-bg`, `--charcoal-bar-edge`, `--charcoal-bar-shadow`): the activity rail capsules (`.activity-entries`, `.activity-utilities`), header actions (`.header-actions`), vault bar actions (`.vault-bar-actions`), note context actions (`.note-context-actions`), and editor tool strips use slightly raised dark charcoal capsules with crisp white line icons (`--charcoal-bar-ink`, `fill: none`) and smoky-slate active squircles (`--charcoal-btn-active`). Rainbow icon tints are removed.
- Sidebar & tab active selection uses sculpted pearlescent-white pills (`--sculpted-pill-bg`, `--sculpted-pill-edge`, `--sculpted-pill-shadow`).
- `--glass-surface` and `--glass-control` are colors with alpha, not gradients. Keep the main stage's backing transparent so the application canvas shows through. Dialogs use locally recomputed opaque surfaces for readable text, independently of theme-pack previews. No `backdrop-filter: blur` and no Windows desktop transparency claim.
- New reading settings default to `15px` with `1.75` line height; saved user typography remains authoritative.

## Motion

- Character: brisk and state-only (`--dur-micro` 120ms, `--dur-short` 220ms on `--ease-out`); `transform`, `opacity` and colour tokens only, never `transition: all` or animated `width`/`height`; under reduced motion everything ends at once.

## Invariants for Future Extensions

1. **No literal colours or font families outside `app/src/tokens.css`** (Gate 48).
2. **Strict 4px spatial scale**: all `padding`, `margin` and `gap` values use `--space-*` tokens (Gate 24a / 24b).
3. **Hairline surface ladder**: separate regions with `1px solid var(--shell-line)` and stepped surfaces (`--ui-base` → `--shell-surface`), never glass-morphism blur (`backdrop-filter: blur`) or multi-layer nested cards (Gate 4 / 29).
4. **Unified segmented track**: view and mode switchers sit inside a single bordered `.segmented-control` track; never emit multi-colour rainbow pill bars.
5. **Viewport safety**: `html, body` use `overflow-x: clip`; dialogs and popovers use `calc(100% - var(--space-lg))`, never `100vw` (Gate 34).
6. **Application height**: `#app` owns a full-height column flex layout. The header and global navigation remain in the viewport while the active workspace scrolls. Do not replace these structural rules when updating the visual reset.
7. **Workspace versus reading measure**: research, home, graph, database and intelligence tools fill the available stage. Only reading prose keeps its configurable line length; do not apply article-width caps to tool surfaces.
8. **Persistent navigation**: the activity utility rail owns the only persistent settings button. The file menu may open the same dialog; the header and plugin pages must not duplicate it. Seven native disclosure groups open one at a time; theme packages and appearance extensions are a collapsed secondary section. Never shrink or clip groups to fit the dialog.
9. **Compact colour controls**: use 16px swatches in minimum-26px controls sized to their labels. Wrap the controls when needed; never crop labels or enlarge flat swatches into preview cards. Layout previews remain distinct from colour choices.
10. **Useful empty states**: show the current state and one relevant action. Do not fill unused workspace with feature descriptions, decorative metrics or duplicate navigation. Research rows use full-width titles in narrow containers.
11. **Minimalist surface & menu-driven disclosure (`.ux-popover-menu`)**: keep every workspace and editor toolbar to a single calm row with only primary actions visible. Secondary tools, view preset editors, graph pathfinders, flashcard deck/candidate generators, and reader layout/file utilities must be tucked inside unified `<details class="ux-popover-menu">` popovers rather than tiled flat across the screen.

## Maintenance And Checks

Maintain `app/src/tokens.css`, `app/src/base.css` and `app/src/inkloom.css` directly. The one-time migration scripts in `../hallmark-wechat-article/` are not build inputs and must not regenerate the current styles from their historical backup.

Run `tools/build-web.mjs`, then `tools/verify-phase2.mjs --ux --check "viewport shell"` for the focused layout check. Complete browser and isolated Windows UX checks before release. The check covers all seven workspace destinations, four widths, both interface modes, colour-label fit, long research titles, settings accessibility, filter recovery and unchanged note bytes after explicit fixture creation.

## Exports

`app/src/tokens.css` and `app/src/base.css` in this project.
