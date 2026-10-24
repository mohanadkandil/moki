# Moki

Your idea's workshop: describe an invention, develop its mechanical and electronic design, try its behavior, and prepare its showcase and launch materials.

This repository starts with the agent/runtime foundation and two isolated Daytona engineering desktops. The product UI and full invention workflow are not implemented yet.

## Current stack

- TypeScript and Node 22+.
- OpenAI Agents SDK (`@openai/agents`) for manager/specialist orchestration.
- Official OpenAI SDK (`openai`) for direct Responses and optional Decisions calls.
- Daytona SDK (`@daytona/sdk`) for desktop controls, processes and file access.
- FreeCAD + build123d for mechanical work; KiCad for electronics.
- BFL API for concept exploration and CAD-grounded showcase imagery.

The Codex SDK is a future option for repository-oriented coding workers. It is not the primary desktop orchestrator. See [SDK decision](docs/sdk-decision.md).

## Setup

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
npm run desktops:check -- --use-cli-profile
npm run typecheck
npm test
```

The setup is idempotent by environment name. Only Moki's two environments are managed. Each uses Linux, 2 vCPUs, 4 GiB RAM, no GPU, idle-stop after 20 minutes, and retains its filesystem when stopped. Setup does not place manufacturing orders or start any model run. The 4 GiB allocation lets both run within the current account's 10 GiB memory quota.

`desktops:check` starts desktop services, launches the actual design app, checks display geometry, and saves screenshots under ignored `var/`. Its optional `--use-cli-profile` explicitly reuses the authenticated local Daytona profile in memory; it never copies credentials into the repository. App-runtime access still uses a server-side `DAYTONA_API_KEY`.

## Coordination and validators

The orchestrator owns a versioned product contract. Workers publish immutable artifacts plus measured geometry, input revisions and hashes. A new PCB revision invalidates dependent enclosure/fit-check/showcase outputs. Validation results are accepted only for the artifact hashes actually tested.

The validators inspect real files and executable evidence: board rules, solid geometry, fit, compilation and simulation. An agent's explanation is not itself a passing check. See [architecture](docs/architecture.md).

## Product direction

One warm, capable Moki represents the workshop; mechanical, electrical, firmware and validation workers appear as clearly labeled roles. The invention is the centerpiece. Character and web-app proposals are recorded in `docs/product/`; visual direction remains a design proposal until selected.
