import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Daytona } from '@daytona/sdk';
import { createDaytonaClient } from '../../src/runtime/providers.js';

export async function createSetupDaytonaClient(useCliProfile: boolean): Promise<Daytona> {
  if (process.env.DAYTONA_API_KEY) return createDaytonaClient();
  if (!useCliProfile) throw new Error('Set DAYTONA_API_KEY or explicitly pass --use-cli-profile');
  const configPath = process.platform === 'darwin'
    ? join(homedir(), 'Library/Application Support/daytona/config.json')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'daytona/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const profile = config.profiles?.find((p: { id: string; name: string }) => p.id === config.activeProfile || p.name === config.activeProfile);
  if (!profile || new URL(profile.api.url).origin !== 'https://app.daytona.io') throw new Error('Expected an authenticated official Daytona profile');
  // Reuse the explicitly selected local login only in memory. Never log or persist its credentials.
  return new Daytona({ apiUrl: 'https://app.daytona.io/api', apiKey: profile.api.key || undefined,
    jwtToken: profile.api.key ? undefined : profile.api.token?.accessToken,
    organizationId: profile.activeOrganizationId, target: 'eu' });
}

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown desktop setup failure';
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer <REDACTED>').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<REDACTED>');
}
