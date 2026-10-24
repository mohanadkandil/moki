# Moki architecture diagram style

Source: existing `web/src/style.css`, `web/src/brand.tsx`, and the user's explicit request to match Moki. The diagram-design skill's generic serif/coral defaults are overridden by Moki's existing brand. No shared plugin profile is changed.

| Role | Value |
| --- | --- |
| paper | `#f8f7f3` |
| paper-2 | `#f0efea` |
| ink | `#252525` |
| muted / small text | `#66665f` |
| rule | `#deded6` |
| accent | `#139df2` |
| accent-tint | `#eaf5fd` |
| link / connector | `#777771` |
| title / names / labels | Manrope, matching the app's Manrope Variable family |

40px title, 16px node names, 12px descriptions. Smaller metadata remains secondary. One blue focal node, restrained dither detail, opaque cards, no shadows or italic typography. Brand marks retain their original proportions and colors.

The self-contained HTML embeds all logo geometry; its only external dependency is the exact Manrope Google Fonts stylesheet. The browser verified the loaded family and font availability. See `assets/sources.json` for logo source URLs.
