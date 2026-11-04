import { useEffect, useState } from 'react';
import type { Artifact } from '../board/types';
import { readBoard, type BoardModel } from './pcbModel';

// The PCB, the schematic and the part card all read one file, and it can be a megabyte. Only recent builds stay parsed.
const cache = new Map<string, Promise<BoardModel | null>>();

function load(artifact: Artifact) {
  const known = cache.get(artifact.sha256);
  if (known) return known;
  const next = fetch(artifact.url, { cache: 'no-store' }).then(async res => {
    if (!res.ok) throw new Error(`HTTP ${res.status} for circuit.json`);
    return readBoard(await res.json());
  });
  next.catch(() => cache.delete(artifact.sha256));
  cache.set(artifact.sha256, next);
  if (cache.size > 3) cache.delete(cache.keys().next().value!);
  return next;
}

export type BoardLoad = { state: 'loading' } | { state: 'ready'; model: BoardModel | null } | { state: 'error'; message: string };

export function useBoardModel(artifact: Artifact | undefined, enabled = true): BoardLoad {
  const [loaded, setLoaded] = useState<BoardLoad>({ state: 'loading' });
  const key = enabled ? artifact?.sha256 : undefined;
  useEffect(() => {
    if (!key || !artifact) { setLoaded({ state: 'loading' }); return; }
    let live = true;
    setLoaded({ state: 'loading' });
    load(artifact).then(
      model => { if (live) setLoaded({ state: 'ready', model }); },
      (err: unknown) => { if (live) setLoaded({ state: 'error', message: err instanceof Error ? err.message : String(err) }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return loaded;
}
