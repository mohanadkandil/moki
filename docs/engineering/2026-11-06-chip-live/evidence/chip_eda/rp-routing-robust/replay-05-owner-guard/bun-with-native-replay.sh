#!/bin/sh
case "$1" in
'/home/sogo/design-skill-research/repos/moki/eda/blocks/build.ts') exec '/home/sogo/.bun/bin/bun' "$@"  --rp-native-pad-escape  --lock-native-pad-nets --native-owner-guard ;;
*) exec '/home/sogo/.bun/bin/bun' "$@" ;;
esac
