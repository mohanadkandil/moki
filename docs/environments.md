# Engineering environments

Verified on 24 October 2026.

| Environment | Location | Allocation | Tools |
| --- | --- | --- | --- |
| `moki-mechanical` | Daytona EU | 2 vCPU, 4 GiB RAM, Linux | FreeCAD 1.0.0, build123d 0.13.0 in `~/moki/.venv` |
| `moki-electrical` | Daytona EU | 2 vCPU, 4 GiB RAM, Linux | KiCad 9.0.2 CLI, KiCad GUI, symbols and footprints |

The account currently has a 10 GiB total memory quota. Both environments fit concurrently at 8 GiB combined. They use the provider's `daytona-medium` snapshot, no GPU, a 1440×900 desktop, idle stop after 20 minutes and archive after 60 minutes. Automatic deletion is disabled. Filesystems persist across stop/start.

Verified:

- Both environment APIs report `started`.
- Computer Use starts, returns the expected display geometry, and captures screenshots.
- FreeCAD reaches its main application window.
- KiCad's first-run settings were initialized and its project manager reaches the main window.
- A real SDK mouse click operated the settings dialog.
- A build123d solid-generation smoke check returns a positive volume for a 10×20×2 mm box.
- `kicad-cli version` returns 9.0.2.

The KiCad 3D component-model collection is not installed. Component envelopes must be supplied or measured explicitly before asserting enclosure fit. Firmware compilation/simulation, a live AI-driven CAD job, and the web application are not implemented or validated by this setup.

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
npm run environments:stop
```

Screenshots and installation logs are operational data under ignored `var/` locally and `~/moki/` remotely. No service key is installed in the desktops. The optional CLI-profile adapter reads your authenticated local profile only with `--use-cli-profile`, keeps credentials in memory and pins requests to the official Daytona API.

## Remaining service configuration

Before starting live AI or BFL jobs, fill the ignored local `.env` with the required service keys. For a deployed application, use server-side secret management. The repo contains only `.env.example`; no real key is committed. Daytona CLI authentication already works independently of those environment variables.
