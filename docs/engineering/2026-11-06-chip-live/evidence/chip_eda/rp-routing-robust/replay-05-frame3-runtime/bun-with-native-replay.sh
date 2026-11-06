#!/bin/sh
case "$1" in
'/home/sogo/design-skill-research/repos/moki/eda/blocks/build.ts') exec '/home/sogo/.bun/bin/bun' "$@"  --rp-native-pad-escape '--native-frame=3' ;;
*) exec '/home/sogo/.bun/bin/bun' "$@" ;;
esac
