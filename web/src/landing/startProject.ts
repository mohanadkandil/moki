// Starting a project from the landing. The studio's shell appears the moment a brief is sent, and the project is
// created behind it, so there is no screen in between. A failure goes back to the landing with the words intact.
import { useSyncExternalStore } from 'react';
import { titleFromBrief } from '../../../src/agents/project-title';
import { atBase } from '../board/base';
import { projectsApi } from './projectsApi';
import { navigate } from './routes';

export interface ProjectHint { title?: string; brief?: string }
let starting: ProjectHint | null = null;
let failed: { brief: string; error: string } | null = null;
const hints = new Map<string, ProjectHint>();
const listeners = new Set<() => void>();
const changed = () => { for (const listen of listeners) listen(); };

export function useStarting(): ProjectHint | null {
  return useSyncExternalStore(listen => { listeners.add(listen); return () => listeners.delete(listen); }, () => starting, () => starting);
}

/** What the page already knows about a project, shown until the server's copy arrives. */
export const hintFor = (id: string): ProjectHint => hints.get(id) ?? {};
export const rememberHint = (id: string, hint: ProjectHint) => { hints.set(id, hint); };

/** Why the last start failed, once, so the landing can put the words back. */
export function takeFailure() { const value = failed; failed = null; return value; }

export async function beginProject(brief: string) {
  if (starting) return;
  starting = { brief, title: titleFromBrief(brief) };
  failed = null;
  changed();
  try {
    const { currentEffort } = await import('../studio/agentChat');
    const { projectId } = await projectsApi.create(brief, currentEffort());
    hints.set(projectId, starting);
    navigate(atBase(`/studio/${projectId}`));
  } catch (error) {
    failed = { brief, error: error instanceof Error ? error.message : 'Your project could not be started.' };
  }
  starting = null;
  changed();
}
