# Moki workshop editor

Implemented 24 October 2026 after the user rejected the initial beige brief-only placeholder as visually disconnected from the landing page.

## Design requirements from user feedback

- Full-viewport application, consistent with the landing's Manrope, Ink logo, warm white, charcoal, and restrained blue control accents.
- No italic serif, decorative arrows, editorial slogans, or repeated promotional headings inside the editor.
- Conversation beside a large product canvas. Main navigation is Product and Showcase. Checks, files, and details are secondary tools, not another marketing page or a status-card dashboard.
- A small collapsed making plan can disclose proposed stages. Do not claim execution or successful checks from a static plan.

## Implemented interactions

The conversation uses the actual headless `MessageScroller` from `@shadcn/react@0.3.1`, styled with Moki CSS. It keeps a constrained, independently scrolling thread, stable message IDs and user anchors, and a jump-to-latest action. There is no Next.js, Tailwind, AI Gateway, or AI SDK migration required for this primitive. More research and official references are in [AI interface components](../research/ai-interface-components.md).

Users can rename the project, add refinements to its brief, attach a local reference, collapse the conversation, choose a gallery reference, zoom the reference image, change showcase crop, edit showcase copy, and export actual Markdown brief/story notes. Files previews the same current brief, including refinements. Empty engineering folders contain no fabricated files.

The Product view clearly distinguishes a reference image from CAD; unavailable CAD mode is disabled. Gallery reference choice is explicitly independent of engineering generation. Known timer/synth/lamp prompts initially select the corresponding gallery reference; other prompts start without an image. No arbitrary object is passed off as a generated result. Image zoom is a 2D reference-image operation, not a CAD camera.

The Checks tool lists the required artifacts and Not run states. Activity states that no engineering jobs are connected. The assistant-like guidance is fixed product onboarding, not a model response. Appending a refinement updates local state; it does not schedule work or infer a design change.

## Access

Run `npm run dev`; submit an idea at http://127.0.0.1:5173/ or open http://127.0.0.1:5173/?demo=timer for the gallery-based example. All project state is session-only and resets on reload.

## Engineering boundary

Still required: authenticated server endpoints, streaming model responses, durable product/revision state and artifacts, actual CAD/PCB viewers, worker jobs, real tool traces, validator evidence, and CAD-grounded generated showcase assets. The existing OpenAI/Daytona runtime is not yet attached to these controls.

## Verification

Typecheck, production build, and the existing revision-gate tests pass. Browser checks verified full-height desktop layout, local refinement submission and input clearing, the same refinement appearing in the brief file preview, all four engineering checks remaining Not run, Product/Showcase navigation, and absence of the removed marketing headings. A same-origin 390 × 844 iframe verified the mobile conversation/product toggle and no horizontal overflow; native preview resizing remains unavailable in this session.
