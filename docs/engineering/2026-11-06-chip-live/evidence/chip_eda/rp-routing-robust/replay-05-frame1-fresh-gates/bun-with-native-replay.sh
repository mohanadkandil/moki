#!/bin/sh
case "$1" in
'/home/sogo/design-skill-research/repos/moki/eda/blocks/build.ts') exec '/home/sogo/.bun/bin/bun' "$@" --native-replay '/home/sogo/design-skill-research/repos/moki/docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/frame1-native-from-71e5/manifest.json' --rp-native-pad-escape  ;;
*) exec '/home/sogo/.bun/bin/bun' "$@" ;;
esac
