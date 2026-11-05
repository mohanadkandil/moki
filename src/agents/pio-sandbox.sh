#!/bin/bash
# Runs PlatformIO for model-written firmware. Libraries are fetched first, from a list code wrote. The compile
# then runs with no network and sees only the toolchain, the shared libraries and this project, so an #include
# can't reach a key file. Model-written code is compiled here, never run.
set -euo pipefail
TOOLS=/home/sogo/.local/share/moki-tools
PIO="$TOOLS/platformio-venv/bin/pio"
SHARED="${MOKI_FIRMWARE_SHARED:-$(cd "$(dirname "$0")/../.." && pwd)/var/firmware-shared}"
export PLATFORMIO_CORE_DIR="$TOOLS/platformio-core"
export PLATFORMIO_BUILD_CACHE_DIR="$SHARED/build-cache"
export PLATFORMIO_SETTING_ENABLE_TELEMETRY=No
mkdir -p "$PLATFORMIO_BUILD_CACHE_DIR"

if [ "${1:-}" != run ]; then exec "$PIO" "$@"; fi

# moki.service sets NoNewPrivileges, and under that the kernel refuses bwrap the namespaces it needs. So the
# compile runs as its own short-lived user unit, which also bounds its time and memory. If that isn't possible,
# this fails: firmware from a model is never compiled outside the sandbox.
if grep -q '^NoNewPrivs:[[:space:]]*1' /proc/self/status; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  exec systemd-run --user --quiet --wait --pipe --collect --working-directory="$PWD" \
    -p RuntimeMaxSec=130 -p MemoryMax=1500M \
    --setenv=PATH="$PATH" --setenv=MOKI_FIRMWARE_SHARED="$SHARED" "$0" "$@"
fi

# Only platformio.ini decides what is downloaded, and code writes that file from an approved list. Each library
# set has its own folder, because installing one set removes libraries the set doesn't list.
LIBSET="$SHARED/libdeps/$(sha256sum platformio.ini | cut -c1-16)"
mkdir -p "$LIBSET"
PLATFORMIO_LIBDEPS_DIR="$LIBSET" "$PIO" pkg install -d "$PWD" >/dev/null
rm -rf .pio/libdeps
mkdir -p .pio
cp -r "$LIBSET" .pio/libdeps

# Tools and shared libraries are read-only here, so nothing in a compile can change what the next one runs.
CORE="$PLATFORMIO_CORE_DIR"
exec bwrap --unshare-all --die-with-parent --new-session \
  --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/sbin /sbin \
  --ro-bind-try /lib64 /lib64 --ro-bind-try /etc/alternatives /etc/alternatives \
  --proc /proc --dev /dev --tmpfs /tmp --dir /home/sogo \
  --ro-bind "$TOOLS/platformio-venv" "$TOOLS/platformio-venv" \
  --tmpfs "$CORE" --ro-bind "$CORE/packages" "$CORE/packages" --ro-bind "$CORE/platforms" "$CORE/platforms" \
  --bind "$PLATFORMIO_BUILD_CACHE_DIR" "$PLATFORMIO_BUILD_CACHE_DIR" \
  --bind "$PWD" "$PWD" --chdir "$PWD" \
  --setenv HOME /tmp --setenv PATH /usr/bin:/bin \
  --setenv PLATFORMIO_CORE_DIR "$CORE" \
  --setenv PLATFORMIO_BUILD_CACHE_DIR "$PLATFORMIO_BUILD_CACHE_DIR" \
  --setenv PLATFORMIO_SETTING_ENABLE_TELEMETRY No --setenv NO_COLOR 1 \
  -- "$PIO" "$@"
