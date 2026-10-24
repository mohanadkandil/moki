# Moki

Your idea's workshop: describe an invention, develop its mechanical and electronic design, try its behavior, and prepare its showcase and launch materials.

This repository includes a local React landing page, the agent/runtime foundation, and two isolated Daytona engineering desktops. The landing prompt captures an editable session-only brief; it does not yet launch engineering jobs. The complete invention workflow remains to be connected.

## Current stack

- TypeScript and Node 22+.
- React + Vite for the local web experience, with self-hosted Manrope typography.
- OpenAI Agents SDK (`@openai/agents`) for manager/specialist orchestration.
- Official OpenAI SDK (`openai`) for direct Responses and optional Decisions calls.
- Daytona SDK (`@daytona/sdk`) for desktop controls, processes and file access.
- FreeCAD + build123d for mechanical work; KiCad for electronics.
- BFL API planned for CAD-grounded showcase imagery. Current gallery illustrations were generated with Codex image generation.

The Codex SDK is a future option for repository-oriented coding workers. It is not the primary desktop orchestrator. See [SDK decision](docs/sdk-decision.md) and [verified environments](docs/environments.md).

## Web preview

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173/. The hero fills the viewport, with a procedural animated blue dither field, a logo-only Ink mark, and a central idea composer. The gallery supports filtering, concept detail dialogs, and using an example as a prompt. The prompt opens an editable brief for this browser session; it makes no model request and runs no engineering tools. References remain local to the session.

`npm run build` creates the static frontend in `dist/web`; `npm run preview` serves that build on port 4173. Service keys stay in the server-side runtime and are not used by the frontend. The image prompts and asset provenance are in [landing assets](docs/product/landing-assets.md).

## Engineering setup

```sh
npm ci
cp .env.example .env
npm run doctor
daytona login
npm run environments:setup
```

Put service keys in `.env` locally. The CLI setup commands can use your existing Daytona login; app-runtime SDK calls need `DAYTONA_API_KEY`. OpenAI and BFL keys are not required to provision the engineering desktops, and no model request is made by setup.

```sh
npm run environments:status
npm run environments:stop
npm run openai:check
npm run desktops:check -- --use-cli-profile
npm run typecheck
npm test
```

The setup is idempotent by environment name. Only Moki's two environments are managed. Each uses Linux, 2 vCPUs, 4 GiB RAM, no GPU, idle-stop after 20 minutes, and retains its filesystem when stopped. Setup does not place manufacturing orders or start any model run. The 4 GiB allocation lets both run within the current account's 10 GiB memory quota.

`desktops:check` starts desktop services, launches the actual design app, checks display geometry, and saves screenshots under ignored `var/`. Its optional `--use-cli-profile` explicitly reuses the authenticated local Daytona profile in memory; it never copies credentials into the repository. App-runtime access still uses a server-side `DAYTONA_API_KEY`.

`openai:check` makes small paid model requests using the local server-side key. It checks the Responses API and Moki's manager-to-validator delegation with shared product/revision context. The sample has no artifacts: the expected outcome is blocked for missing evidence. It does not run CAD or PCB validation. A sanitized timestamped result is saved under ignored `var/checks/openai.json`; raw API errors and credentials are not logged. The check follows the official [Responses quickstart](https://developers.openai.com/api/docs/quickstart) and [Agents SDK quickstart](https://developers.openai.com/api/docs/guides/agents/quickstart), using the locally installed SDK types.

## Coordination and validators

The orchestrator owns a versioned product contract. Workers publish immutable artifacts plus measured geometry, input revisions and hashes. A new PCB revision invalidates dependent enclosure/fit-check/showcase outputs. Validation results are accepted only for the artifact hashes actually tested.

The validators inspect real files and executable evidence: board rules, solid geometry, fit, compilation and simulation. An agent's explanation is not itself a passing check. See [architecture](docs/architecture.md).

## Product direction

One warm, capable Moki represents the workshop; mechanical, electrical, firmware and validation workers appear as clearly labeled roles. The invention is the centerpiece. The user selected the Ink character direction; production artwork and the proposed web-app interface remain to be implemented.

- [Web-app design proposal](docs/product/web-app.md): the calm, rounded Moki Workshop direction.
- [Character direction](docs/product/character.md): the selected Ink silhouette and an attentive workshop persona.
- [Landing-page direction](docs/product/landing.md): the implemented design and interaction scope.
- [CAD skill research](docs/research/cad-skills.md) and [electrical skill research](docs/research/electrical-skills.md): source-reviewed candidates, compatibility constraints, and proposed benchmarks. Research does not mean these skills are installed in the workers.
- [Editable pipeline diagram](docs/pipeline/invention-platform.excalidraw).
