# Moki architecture diagram style

Source: `web/src/style.css` and `web/src/brand.tsx`.

| Role | Value |
| --- | --- |
| paper | `#f8f7f3` |
| paper-2, for zones | `#f0efea` |
| ink | `#252525` |
| muted text | `#5f5f58` |
| rule | `#dcdcd3` |
| accent | `#139df2` |
| accent-light, for the dotted band | `#80ccfa` |
| connector | `#6f6f69` |
| type | Manrope, embedded in the SVG and HTML |

- **Size for GitHub.** The canvas is 1200 units wide and the README shows it about 830 px wide, so readable text stays at 16 units or more. Only the quiet small-caps labels go lower, at 13.5.
- **One accent.** Blue marks the shared plan, the one idea the drawing is about. The same stepped, dotted material as the landing's field appears on the plan and in the top-right corner, and nowhere else.
- **Real pictures.** Schematic, board, case and screens are crops of real output. They bleed to the edge of their card instead of floating inside it.
- **Warm paper on any page.** The paper has rounded, transparent corners, so it sits well on GitHub's light and dark pages.
- **Quiet logos.** Simple Icons marks stay single-colour in ink, at their original proportions. The tscircuit icon is the official PNG, unmodified. ngspice has no published mark, so it gets a plain waveform that isn't presented as a logo.
- **No decoration beyond that.** No shadows, gradients or italics.
