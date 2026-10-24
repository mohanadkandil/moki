import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function cli(args: string[], timeout = 120_000): Promise<string> {
  try {
    const result = await execute('daytona', args, { timeout, maxBuffer: 4 * 1024 * 1024 });
    return result.stdout.trim();
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(`Daytona ${args[0]} failed: ${(failure.stderr || failure.stdout || failure.message).slice(-5000)}`);
  }
}

export const environments = [
  { name: 'moki-mechanical', role: 'mechanical' },
  { name: 'moki-electrical', role: 'electrical' },
] as const;

export async function listEnvironments(): Promise<Array<{ id: string; name: string; state: string; cpu?: number; memory?: number }>> {
  const data: unknown = JSON.parse(await cli(['list', '--format', 'json']));
  if (!data || typeof data !== 'object' || !('items' in data) || !Array.isArray(data.items)) {
    throw new Error('Unexpected Daytona list response');
  }
  return data.items;
}
