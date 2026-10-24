import { useEffect, useRef, useState } from 'react';
import type { InspirationSet } from '../../src/contracts/inspiration';

const requests = new Map<string, Promise<InspirationSet>>();
async function request(brief: string, projectId: string, force = false): Promise<InspirationSet> {
  const response = await fetch('/api/inspirations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief, projectId, force }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Could not create directions');
  localStorage.setItem(`moki:inspiration:${projectId}`, value.id);
  return value;
}
export function useInspiration(brief: string, projectId: string) {
  const [set, update] = useState<InspirationSet | null>(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; let cancelled = false;
    async function initial() {
      const id = localStorage.getItem(`moki:inspiration:${projectId}`);
      if (id) {
        const previous = await fetch(`/api/inspirations/${id}`).then(r => r.ok ? r.json() : null).catch(() => null);
        if (previous?.brief === brief) { if (!cancelled) update(previous); return; }
      }
      // StrictMode and rerenders share one submission, never four extra paid requests.
      if (!requests.has(projectId)) requests.set(projectId, request(brief, projectId));
      const value = await requests.get(projectId)!;
      if (!cancelled) update(value);
    }
    void initial().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not create directions'); });
    return () => { cancelled = true; mounted.current = false; };
  }, [brief, projectId]);
  useEffect(() => {
    if (!set || set.status !== 'running') return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/inspirations/${set!.id}`);
        if (!response.ok) throw new Error();
        const value = await response.json();
        if (cancelled) return;
        update(value); setError('');
        if (value.status === 'running') timer = setTimeout(poll, 1200);
      } catch { if (!cancelled) { setError('Reconnecting to image generation…'); timer = setTimeout(poll, 3000); } }
    }
    timer = setTimeout(poll, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [set?.id, set?.status]);
  async function choose(conceptId: string) {
    if (!set) return;
    try {
      const response = await fetch(`/api/inspirations/${set.id}/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conceptId }) });
      if (!response.ok) throw new Error('Could not save this direction');
      const value = await response.json(); if (mounted.current) update(value);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Could not select direction'); }
  }
  async function retry() {
    setError(''); update(null); requests.delete(projectId);
    try { const value = await request(brief, projectId, true); if (mounted.current) update(value); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Could not generate directions'); }
  }
  return { set, error, choose, retry, selected: set?.concepts.find(c => c.id === set.selectedId) };
}
