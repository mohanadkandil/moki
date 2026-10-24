# Moki web app — product and interaction proposal

Design recommendation, 24 October 2026. This is a proposed product direction, not the result of customer research. Scope: premium desktop web workspace for taking a physical-product idea through concept, mechanical/electrical design, simulation, validation, showcase, and handoff.

## Recommendation

Build **Moki Workshop**: a quiet, warm workspace whose largest surface is the thing the user is making. Moki is one capable companion beside it. The engineering team works behind that relationship; users can inspect the work whenever they want.

The feeling should be a beautiful working notebook beside a physical prototype. Premium comes from consistent proportions, excellent type, believable materials, clear states, and careful transitions. Round the objects people touch; keep documents, engineering evidence, and lists precise.

The proposed character can be the bent orange arch creature with ivory hands or the earlier goggles companion. The interface should work with either. Do not draw a new mascot for each specialist agent. The product the user is making must remain visually distinct from Moki.

## Two directions

| | Moki Workshop — recommended | Moki Stage — alternative |
|---|---|---|
| Core metaphor | Inventor's desk and project notebook | Product photography studio and director's booth |
| Main surface | Warm light canvas with large interactive product | Charcoal stage, brighter object lighting, almost invisible chrome |
| Navigation | Quiet project sidebar and stable view tabs | Filmstrip of product milestones beneath the stage |
| Character | Small, friendly partner in conversation | Stagehand appearing at milestone transitions |
| Strength | Understandable, lovely daily workspace; handles actual engineering and evidence | Strong theatrical reveal and presentation mode |
| Weakness | Requires excellent object rendering to feel special | Dense engineering edits and long evidence text become harder to scan |

Use Workshop for the app. A later presentation mode can borrow Stage's fullscreen treatment without introducing another navigation model.

## Desktop composition

At 1440 × 900:

```text
┌───────────────────┬──────────────────────────────────────┬───────────────────────┐
│ Moki              │ Pip, a desk companion     Revision 04│ Moki                  │
│ New invention     │ Product  Test  Showcase  Files       │                       │
│ Search            ├──────────────────────────────────────┤ “The board fits. I'm  │
│                   │                                      │ checking the USB      │
│ Your inventions   │                                      │ opening next.”        │
│ • Pip             │      Large interactive product       │                       │
│   Kitchen timer   │                                      │ Conversation and      │
│                   │                                      │ decisions             │
│                   │                                      │                       │
│                   │ Assembled  Exploded  Inside           │                       │
│                   ├──────────────────────────────────────┤                       │
│ Settings          │ Board fit passed · 1 check pending   │ Describe a change…    │
└───────────────────┴──────────────────────────────────────┴───────────────────────┘
```

- Project navigation: 208 px, collapsible. New invention, search, a short list of projects, settings. No giant avatar organization switcher in a single-user prototype.
- Companion panel: 340 px, resizable or hideable. A narrow 44 px composer grows up to six lines; attachments and send are clear, ordinary controls.
- Central area: remaining width, min-width 560 px. Product fills roughly 55–65% of its stage height. The stage is a region, not a card inside another card.
- Header: 56 px project line plus 40 px view navigation. Project title is editable. Revision control opens history, comparison, and restore. One top-right export action.
- Product views: **Product, Test, Showcase, Files**. They expose the full experience without making it a mandatory wizard or inventing cute names for technical functions.
- Product controls: Assembled, Exploded, Inside; camera reset; dimensions toggle. Show only controls meaningful for the current artifact. Fine grid and measurements appear on request.
- Checks: one compact evidence line under the artifact. An issue opens the exact affected object and its evidence. Never cover the product with a stack of floating status cards.
- Below 1280 px, collapse project navigation. Below 1040 px, companion becomes a toggled side sheet. Preserve the canvas, not three crushed columns. A projector/fullscreen button hides the sidebar and companion.

## First-run to finished journey

### 1. Begin with an invention

Mostly empty canvas. Small Moki leans beside the input, never a giant hero character.

- Heading: **What would you like to make?**
- Example in the input: “A little desk companion that celebrates when I finish a task.”
- Supporting line: “Describe the object, who it helps, and what it should do.”
- Primary action: **Start making**.
- Optional image attachment. Three quiet example links under the input; no feature-card marketing grid, budget dashboard, or setup interview.

After submission, preserve the user's sentence at the top of the conversation. Show a short editable brief while concepts are prepared. Ask a clarification only if it blocks useful work. Label assumptions explicitly and let the user change them.

### 2. Pick a direction

Show two or three large concept images on one shared canvas. Each has a name, one sentence about the meaningful difference, and a visible **Concept image** label. Do not present AI imagery as engineering geometry.

Select a concept → central stage expands it → Moki summarizes the build: “I'll make the enclosure, board layout, interactive prototype, and launch materials.”

Primary action: **Build this concept**. Estimated spend/run scope belongs here once backed by actual metering, not an invented precision claim.

### 3. Watch it take shape

Keep the approved concept visible until real geometry exists. As artifacts arrive, replace it with the CAD-backed model and visibly label the representation change. The first completed geometry should appear promptly; do not wait for all disciplines to finish to show anything.

Moki reports concrete transitions: “The board outline is ready: 42 × 28 mm. The enclosure now uses those dimensions.” A short expandable work list contains Mechanical, Electronics, Firmware, and Checks, with idle/running/blocked/complete states.

**Watch work** opens a bottom drawer containing actual desktop streams in tabs. One stream at a time by default, real worker names, environment, and current task. Stream failures say **Connection interrupted**; no simulated cursor or fake progress. Advanced logs live behind **Details**. Users can close the drawer and retain progress context.

### 4. Revise the object

The composer stays available: “Make the ears shorter and move the charging port to the back.” The app summarizes the intended impact inline before execution when it involves a significant rebuild. Routine reversible changes need no modal approval ritual.

Keep the last completed revision visible while the next builds. Label the stage **Revision 04 · updating**. On completion offer a persistent, dismissible **Compare revisions** action. Do not change the artifact under the user's pointer during inspection; show **New revision ready** until they adopt the new view.

Comparison is aligned before/after or a geometry overlay with a concise change list. No generic success toast as the only indication of what changed.

### 5. Test and resolve

**Test** shows the interactive prototype next to a readable test list. Each test has a condition, observed result, revision, and evidence. User actions in simulation should map to actual simulated behavior. Mark visual-only interactions honestly.

A failed connector clearance highlights the port and enclosure, shows the measured gap, and offers **Ask Moki to fix**. A blocked check explains the missing input. Distinguish **Passed**, **Failed**, **Not checked**, **Blocked**, and **Outdated**. Passing a finite set of automated checks is not a claim of manufacturing readiness.

### 6. Showcase and handoff

**Showcase** becomes an editorial page: one hero image, a filmstrip of studio/lifestyle/packaging views, then editable positioning and landing-page preview. Engineering chrome recedes; the project identity takes the lead.

Generate imagery from the current artifact references. Label generated imagery and link back to the source product revision. If geometry changes, mark affected images **Outdated** instead of silently keeping them current.

**Files** uses a clean, grouped file list: Mechanical, Electronics, Firmware, Showcase. Show real files, current revision, format, and download. Export summary states what is included and which checks are unfinished. Do not imply an order was sent to a manufacturer unless that integration and submission really occurred.

## Shared contracts, visible in the interface

The user does not need to manage agent messages. They do need to understand a design's provenance when they inspect it.

Select PCB in the 3D product → companion panel switches to Details, with a clear Back to Moki control:

```text
Main board
Revision 03 · used by enclosure revision 04
Outline       42 × 28 mm
Thickness     1.6 mm
Mounts        4 × M2
Connector     USB-C, rear edge

Board fit       Passed
Port clearance  Not checked

Open source file       Ask Moki about this
```

Measurements must come from tools reading actual artifacts. Each check references file revisions/hashes internally; the ordinary UI presents the relevant revision and source link. If the electrical worker updates the board, show “Board changed. Updating enclosure fit.” Mark stale results **Outdated** immediately. Do not render a green check while waiting for its replacement.

## Visual system

These values are proposed tokens. Validate contrast in implementation and at projector scale.

| Role | Value / behavior |
|---|---|
| App ground | Warm off-white `#F7F6F2` |
| Sidebar | Slightly deeper paper `#EFEEE9` |
| Main product stage | `#FAF9F6`, with a soft physically plausible grounding shadow |
| Surface / overlays | `#FFFFFF` |
| Main text | Warm ink `#242321` |
| Secondary text | `#68665F`; never reduce opacity on text to fake hierarchy |
| Fine border | `#DEDCD5`; actual stroke boundaries where needed |
| Brand accent | Vermilion `#D64B2D`; reserve for primary action, selected control, and Moki |
| Accent text | Dark rust `#A9361F` on light ground |
| Success | `#3D7055`, paired with text/icon |
| Caution | `#996510`, paired with text/icon |
| Failure | `#B33B36`, paired with text/icon |
| Primary font | Geist Sans or a locally hosted similarly restrained humanist/grotesk sans; use one UI family |
| Technical numbers | Geist Mono, tabular figures, only for dimensions/file identifiers/logs |
| Type sizes | 12 metadata, 14 controls, 15 body, 20 pane heading, 28 project/first-run heading; line-height 1.45–1.55 for prose |
| Weights | 400 body, 500 controls, 600 key headings; avoid bold everywhere |
| Spacing | 4 px base; commonly 8 / 12 / 16 / 24 / 32 / 48 |
| Radii | 6 row hover, 10 input/button, 16 drawer/popover, 20 large concept image; full capsule only for a control that earns that shape |
| Shadows | One low-opacity neutral elevation on overlays; none on every panel |
| Icons | One consistent 18 px line set, 1.5–1.75 px stroke; always label ambiguous actions |
| Focus | Visible 2 px focus outline; large enough hit targets; keyboard path through every view |

Avoid blueprint blue and construction-yellow branding. The product should feel comfortable for a non-engineer without disguising technical work.

## Character placement and motion

- Moki exists at the top of the companion panel as a 40–48 px presence; 72–96 px for first-run and a brief meaningful completion moment.
- A focused look or subtle hand movement acknowledges a real task transition. No constant bobbing, typing pantomime, petting loop, or floating character following the cursor.
- Same identity everywhere. The specialists appear as named roles in work details, not a collection of competing avatars.
- Voice: curious, capable, candid. “The USB opening is too narrow. I'm widening it by 0.8 mm.” Never “Our autonomous mechanical optimization agent is leveraging…”.
- Hover/focus: 120–160 ms. Panels: 180–220 ms. Camera framing: 300–450 ms. Character milestone gesture: <600 ms, once. Respect reduced motion and never animate numerical evidence to suggest precision.
- Primary buttons should feel firm: subtle color/depth response, no jelly bounce. Preserve scroll and camera position during updates.

## Anti-patterns to reject during review

- Purple/blue AI gradients, glass everywhere, sparkle icons, giant chat hero, ambient particle fields.
- Six equal cards advertising Mechanical / Electrical / Firmware / Marketing, each with a glowing agent avatar.
- Pipeline node graphs as the default workspace. Keep them in the technical inspector if needed.
- Oversized pill tabs, rounded nested containers, and gray-on-gray tiny labels.
- Endless assistant paragraphs repeating actions already visible on screen.
- Fake percentages, invented progress events, generic “thinking” text for long periods, and placeholder geometry presented as final CAD.
- Unchecked artifacts appearing verified; generated concept images appearing manufacturable; old revision evidence appearing current.
- Character animation competing with the user's object or interrupting an error explanation.
- Auto-opening a desktop stream or logs after every agent event.

## Hackathon implementation order

1. Product workspace shell, actual large artifact, Moki composer, revision identity.
2. First-run → concept selection → first build transition.
3. One natural-language change with revision comparison.
4. Real evidence drawer and one visible failing/fixed check.
5. Showcase view that uses the exact current product, plus downloadable files.
6. Optional live-worker drawer; refine the character once the core journey reads clearly.

The demo should show one invention becoming coherent across all these surfaces. Number of agent cards is not a product outcome.

## Reference and provenance

The user's request is the primary brief: rounded, premium, warm, Notion-like clarity, matched to the Moki character, and no generic AI aesthetic. Notion's own guidance supports treating the sidebar as a stable navigation map, keeping top-level organization limited, and allowing it to collapse for focus. These are interaction principles, not permission to copy Notion's visual identity. [Notion sidebar](https://www.notion.com/help/navigate-with-the-sidebar), [Notion organization guidance](https://www.notion.com/help/guides/the-best-way-to-set-up-your-teams-sidebar-for-clear-organization).

Interface copy is informed by the local UX-writing skill: purpose-led labels, useful next actions, minimal filler, and clear technical terms when precision matters. All layout, token, and character-placement recommendations above are this proposal's design judgments.
