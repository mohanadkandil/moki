# Engineering environments

Verified on 24 October 2026.

| Environment | Location | Allocation | Tools |
| --- | --- | --- | --- |
| `moki-mechanical` | Daytona EU | 2 vCPU, 4 GiB RAM, Linux | FreeCAD 1.0.0, build123d 0.13.0 in `~/moki/.venv` |
| `moki-electrical` | Daytona EU | 2 vCPU, 4 GiB RAM, Linux | KiCad 9.0.2 CLI, KiCad GUI, symbols and footprints |

The account currently has a 10 GiB total memory quota. Both environments fit concurrently at 8 GiB combined. They use the provider's `daytona-medium` snapshot, no GPU, a 1440×900 desktop, idle stop, auto-pause and TTL disabled. Automatic deletion is disabled. Daytona maps archive value 0 to its maximum 43,200-minute delay after a worker is stopped; running workers are not archived. Filesystems persist across stop/start.

Verified:

- Both environment APIs report `started`.
- Computer Use starts, returns the expected display geometry, and captures screenshots.
- FreeCAD reaches its main application window.
- KiCad's first-run settings were initialized and its project manager reaches the main window.
- A real SDK mouse click operated the settings dialog.
- A build123d solid-generation smoke check returns a positive volume for a 10×20×2 mm box.
- `kicad-cli version` returns 9.0.2.

The KiCad 3D component-model collection is not installed. Component envelopes must be supplied or measured explicitly before asserting enclosure fit. Live prompt/image-guided CAD runs and the local workshop are now connected. Firmware, a functional schematic/routed PCB, and populated-board fit remain unimplemented. The CAD skill uses a separate compatible Python environment (`~/moki/.cad-skill-venv`, build123d 0.11.1 / OCP 7.9); the original smoke-check environment is retained.

## Access

Open the environments in the authenticated Daytona dashboard to use VNC. Terminal access:

```sh
daytona ssh moki-mechanical
daytona ssh moki-electrical
```

From this repository:

```sh
npm run environments:status
npm run desktops:check -- --use-cli-profile
npm run desktop:action -- mechanical screenshot --use-cli-profile
npm run environments:keep-running -- --use-cli-profile
```

Screenshots and installation logs are operational data under ignored `var/` locally and `~/moki/` remotely. No service key is installed in the desktops. The optional CLI-profile adapter reads your authenticated local profile only with `--use-cli-profile`, keeps credentials in memory and pins requests to the official Daytona API.

## Service configuration

For live AI and BFL jobs, configure the ignored local `.env` with the required service keys. For a deployed application, use server-side secret management. The repo contains only `.env.example`; no real key is committed. Daytona CLI authentication already works independently of those environment variables.

## Project isolation

Each run writes under `~/moki/runs/<run-id>`. Before planning, a reset helper closes only previous Moki-generated preview documents or its recorded empty-app processes, then opens fresh empty FreeCAD and PCB editor workspaces. Per-run FreeCAD cache/temp paths avoid old recovery dialogs. Previous STEP/PCB files are retained; live reset verification confirmed their hashes remained identical. Workers are not stopped or destroyed. Do not stop them unless the user explicitly requests it.
