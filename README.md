# Moki

Describe a physical product, choose a visual direction, and develop a first-pass CAD study in a saved workshop.

## Run locally

```sh
npm ci
cp .env.example .env
# Configure server-side OpenAI and BFL keys, then authenticate Daytona.
daytona login
npm run dev
```

Open http://127.0.0.1:5173/. Every submitted prompt creates a new saved workshop. The landing page lists real saved projects, including running jobs, so you can return later. Example cards supply a prompt; they do not stand in for generated project results.

The workshop generates four BFL visual directions first. After selection, Continue starts model-guided board-envelope planning and mechanical CAD generation on two Daytona desktops. Product displays the generated GLB, selected reference, or measured board outline. Click an engineering stage to watch fresh desktop frames. Showcase plays a saved ten-second BFL concept film.

**Current engineering limit:** electronics are a proposed PCB outline and mounting holes only. No schematic, populated/routed circuit, firmware, ERC, or DRC is generated. Mechanical STEP geometry is independently reopened and measured, but real component envelopes and assembly fit remain unverified. The concept film follows the selected image, not the exported CAD. A completed computation means a design study was generated; manufacturing release remains blocked.

Projects, inspiration images, job events, reports and artifacts persist under ignored local `var/`. Reopening a project restores its latest saved run without starting a new model job. An interrupted server process is reported as interrupted, not silently restarted. This is local JSON/file persistence, not a hosted database; retain `var/` to retain projects. Credentials stay server-side in ignored `.env` or the local authenticated Daytona profile.

`npm run build` creates `dist/web`. `npm run preview` serves only that static frontend; the API bridge runs with `npm run dev` and is required for live workshops.

## Runtime

- React + Vite, Manrope, Three.js and headless shadcn conversation components.
- Official OpenAI SDK Responses calls for the live planning/CAD path. The OpenAI Agents SDK manager/specialist foundation is available separately; the live path is a server-coordinated sequence with measured file handoffs.
- Daytona SDK for isolated Linux desktops, commands, files and read-only live views.
- KiCad 9 and FreeCAD 1, with a separate compatible build123d CAD-skill environment.
- BFL for four inspiration images and a ten-second concept showcase.

The server records artifact hashes and actual stage events. Engineering claims require file-based checker evidence; model descriptions do not count as passing checks. See [workshop scope](docs/product/workshop.md), [environments](docs/environments.md), [architecture](docs/architecture.md), and [SDK decision](docs/sdk-decision.md).

## Engineering setup and checks

```sh
npm run doctor
npm run environments:setup -- --use-cli-profile
npm run environments:keep-running -- --use-cli-profile
npm run environments:status
npm run desktops:check -- --use-cli-profile
npm run typecheck
npm test
npm run build
```

The two workers each use 2 vCPUs and 4 GiB RAM. Idle stop, auto-pause and TTL are disabled; automatic deletion is disabled. New design runs open fresh empty Moki-owned documents while retaining all previous run files. Workers remain running until explicitly stopped. See [environment details](docs/environments.md) for provider archive behavior.

`npm run openai:check` makes small paid API calls to verify Responses and manager/validator delegation. `npm run infra:check -- --use-cli-profile` runs an explicit fixed-geometry diagnostic, separate from the website's prompt-driven pipeline. These commands do not establish circuit functionality.

## Product and research

- [Character](docs/product/character.md): selected Ink mascot.
- [Landing](docs/product/landing.md): full-viewport animated blue field, logo-only navigation, compact composer.
- [CAD research](docs/research/cad-skills.md), [electrical research](docs/research/electrical-skills.md), [3D previews](docs/research/threejs-preview.md).
- [Editable pipeline diagram](docs/pipeline/invention-platform.excalidraw).
