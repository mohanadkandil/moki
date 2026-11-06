#!/bin/sh
case "$1" in
'/home/sogo/design-skill-research/repos/moki/eda/blocks/build.ts') exec '/home/sogo/.bun/bin/bun' "$@"  --rp-native-pad-escape ;;
*) exec '/home/sogo/.bun/bin/bun' "$@" ;;
esac
