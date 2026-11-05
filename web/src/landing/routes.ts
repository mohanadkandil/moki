// Where the app is, from the address bar. Pure, so it can be tested, and aware the app may live under a path.
import { useSyncExternalStore } from 'react';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isProjectId = (id: string) => UUID.test(id);

export type Route =
  | { kind: 'landing' }
  /** No project: a mock or a shared ?job= link. Anything else goes back to the landing. */
  | { kind: 'studio' }
  | { kind: 'project'; projectId: string }
  | { kind: 'lab' }
  /** The older marketing page and /workshop/<id>, left as they were. */
  | { kind: 'workshop' };

export function parseRoute(pathname: string, search: string, base: string): Route {
  const root = base.endsWith('/') ? base : `${base}/`;
  const path = root !== '/' && (pathname === root.slice(0, -1) || pathname.startsWith(root)) ? `/${pathname.slice(root.length)}` : pathname;
  if (path === '/' || path === '') return { kind: 'landing' };
  if (/^\/lab\/?$/.test(path)) return { kind: 'lab' };
  if (/^\/studio\/?$/.test(path)) {
    const q = new URLSearchParams(search);
    return q.has('mock') || q.has('job') ? { kind: 'studio' } : { kind: 'landing' };
  }
  const project = /^\/studio\/([^/]+)\/?$/.exec(path);
  // A malformed id reaches the same designed "not found" page as an unknown one.
  if (project) return { kind: 'project', projectId: project[1]! };
  return { kind: 'workshop' };
}

const CHANGED = 'moki:navigate';
const subscribe = (listen: () => void) => {
  window.addEventListener('popstate', listen);
  window.addEventListener(CHANGED, listen);
  return () => { window.removeEventListener('popstate', listen); window.removeEventListener(CHANGED, listen); };
};
const snapshot = () => window.location.pathname + window.location.search;

export function useLocationKey(): string { return useSyncExternalStore(subscribe, snapshot, snapshot); }

/** A real history entry, so the browser's back button returns where it should. */
export function navigate(url: string, options: { replace?: boolean } = {}) {
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(CHANGED));
}
