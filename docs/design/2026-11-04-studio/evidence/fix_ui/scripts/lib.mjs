import { createRequire } from 'node:module';
const require = createRequire('/home/sogo/design-skill-research/repos/moki/docs/design/2026-11-04-studio/stageshow/');
const { chromium } = require('playwright-core');
export const launch = () => chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'], env: { ...process.env, LD_LIBRARY_PATH: '/home/sogo/.local/share/sogo-diagrams/lib' } });
export const ORIGIN = 'http://127.0.0.1:5173';
export const EV = '/home/sogo/design-skill-research/repos/moki/docs/design/2026-11-04-studio/evidence/fix_ui';
