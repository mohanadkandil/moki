# AI interface components for Moki

Primary-source review on 24 October 2026, prompted by the user's request to study Lovable and Vercel's AI components. The recommendation was checked by a design/research agent and against package metadata and installed types locally.

## Adopted: the headless message scroller

`@shadcn/react@0.3.1` is an MIT-licensed package with React 19 peers and no declared runtime dependencies. It exports the unstyled Message Scroller primitive at `@shadcn/react/message-scroller`. Moki now actually uses its Provider, Root, Viewport, Content, Item, and Button parts; stable user message anchors and constrained scroll regions are configured. Its behavior supports Moki's custom CSS without changing the backend SDK or installing an entire style system. [Official headless guide](https://ui.shadcn.com/docs/react/message-scroller), [published package metadata](https://registry.npmjs.org/@shadcn/react/0.3.1).

## Current AI Elements direction

The original Vercel AI Elements site announces migration into shadcn/ui and deprecation at the end of November 2026. The new documentation describes compositions of source-owned shadcn primitives rather than a single UI package. Moki adopted the small headless primitive above and used the Input Group, Plan, and Tool patterns as references; it did not install the whole registry or claim the pattern examples were backend integrations. [Original announcement](https://elements.ai-sdk.dev/), [new AI Elements](https://ui.shadcn.com/docs/ai-elements).

The older conversation registry depends on `ai`, `lucide-react`, and `use-stick-to-bottom`, plus the Button component. Its prompt-input registry is much larger and pulls command, dropdown-menu, hover-card, input-group, select, spinner and tooltip components. The old setup documentation expects React 19, Tailwind 4, and initialized shadcn. Importing everything would create unnecessary migration work for the existing Vite/custom-CSS app. [Conversation](https://elements.ai-sdk.dev/components/conversation), [Prompt Input](https://elements.ai-sdk.dev/components/prompt-input), [setup](https://elements.ai-sdk.dev/docs/setup).

Useful new compositions are [Prompt Input](https://ui.shadcn.com/docs/ai-elements/radix/prompt-input), [Plan](https://ui.shadcn.com/docs/ai-elements/base/plan), and [Tool](https://ui.shadcn.com/docs/ai-elements/base/tool). When real worker events exist, action rows should expose the action, input/output and observed state. Do not populate tool traces with invented events. Do not display hidden model chain-of-thought; use concise supplied progress summaries and observable tool results.

AI Elements' Canvas is a React Flow workflow editor, not a CAD or 3D product viewer. Artifact is a presentation container, not engineering artifact storage or geometry. Moki needs dedicated CAD-backed rendering for the eventual product view. [Canvas](https://elements.ai-sdk.dev/components/canvas), [Artifact](https://elements.ai-sdk.dev/components/artifact).

## Lovable patterns used as references

The official editor documentation describes chat beside a live preview, with project actions in the top toolbar and a collapsible chat panel. The preview guide covers navigating between views and testing sizes; the project chat guide describes the natural-language iteration loop. Moki uses that interaction hierarchy while retaining its own visual identity and physical-product stages. [Editor guide](https://docs.lovable.dev/features/projects/editor), [project chat](https://docs.lovable.dev/features/projects/chat), [preview guide](https://docs.lovable.dev/features/projects/preview).

The original draft screen failed because it placed a small beige information card in a large empty page, repeated the brief, and did not resemble either the landing or a working editor. The revised shell fills the viewport. Subsequent user feedback removed the washed-out blue text palette and editorial headings from internal views; warm white/charcoal now carry the hierarchy, with blue reserved for purposeful accents.
