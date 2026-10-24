# Moki landing page

Implemented locally on 24 October 2026 from the user's visual references and iterative feedback. Uses the existing Moki repository; no separate hosted Site was created or published.

## Current design

- Full-width, full-viewport-height hero (`100dvh`), with the original vivid blue moving pixel/dither field restored at the user's request.
- Calm central composition: one compact headline, a supporting line, and a rounded composer. No eyebrow, decorative star, suggestion-chip row, mascot caption, or hand-drawn arrow.
- Ink logo alone in the header, without the Moki wordmark. Its accessible link name remains Moki home.
- One consistent self-hosted Manrope family, no italic or serif styling. The bundled Google Fonts variant is distributed under OFL via `@fontsource-variable/manrope`; it is not claimed to be the designer's latest version. Sources reviewed: [designer's specimen](https://www.sharanda.com/manrope), [Google Fonts metadata](https://github.com/google/fonts/blob/main/ofl/manrope/METADATA.pb).
- Warm paper, charcoal, electric blue, and tactile but restrained control shadows. No general dashboard grid in the hero.
- A project gallery follows below the first viewport, with three deliberately art-directed concept images. The workshop explanation follows the gallery.

## Interaction scope

The composer supports text, Shift+Enter newlines, Enter submission, and one local reference image. Empty prompts cannot submit. A reference larger than 10 MB is rejected with a message. No reference is uploaded.

Gallery filters change the visible collection. A project opens in a native dialog, with Escape support, a starting prompt, and an explicit illustrative-concept boundary. Make it your own copies that prompt into the composer.

Submission opens an editable brief in local React state. It is session-only, with no database, account, or model request. All engineering roles show Not started; no fake generation progress or validation badges are shown. The OpenAI runtime integration is separately verified by `npm run openai:check`, not connected to this frontend yet.

The background has a pause control and honors reduced motion. Its rendering is throttled and pauses progression while the document is hidden. Ink is represented by an editable SVG silhouette based on the selected character study, with no raster-generation call needed for the small interface mark.

## Validation

TypeScript, production build, and the existing artifact-revision tests pass. Browser review verified the hero's dimensions match a 1536 × 960 viewport and a same-origin 390 × 844 iframe viewport, with no horizontal overflow. Native preview resizing timed out, so the iframe was used for mobile CSS-layout verification; this is not a physical-device test.

Browser interactions checked: category filtering, project dialog opening, example-to-prompt transfer, and submission to the brief view. Native browser screenshots were inspected. The gallery's three WebP images total about 154 KB. Fonts are bundled locally. Production frontend JavaScript is about 76 KB compressed.

Run `npm run dev` and open http://127.0.0.1:5173/. The static build is `dist/web`.
