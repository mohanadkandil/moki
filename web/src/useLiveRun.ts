import { useEffect, useRef, useState } from 'react';
import type { LiveRun } from '../../src/contracts/run';

export function useLiveRun(brief: string, inspirationId?: string, conceptId?: string, projectId?: string) {
  const [run, setRun] = useState<LiveRun | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const key = `moki:live-run:${projectId || brief}`;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const id = localStorage.getItem(key);
    let cancelled = false;
    async function restore() {
      let value: LiveRun | null = id ? await fetch(`/api/runs/${id}`).then(r => r.ok ? r.json() : null).catch(() => null) : null;
      if ((!value || value.projectId !== projectId) && projectId) value = await fetch(`/api/projects/${projectId}/latest-run`).then(r => r.ok ? r.json() : null).catch(() => null);
      if (!cancelled && value?.brief === brief && (!projectId || value.projectId === projectId)) {
        setRun(value); localStorage.setItem(key, value.id);
      }
    }
    void restore();
    return () => { cancelled = true; };
  }, [key, brief, projectId]);
  useEffect(() => {
    if (!run || run.status !== 'running') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/runs/${run!.id}`);
        if (!response.ok) throw new Error('Could not reconnect to this run');
        const value: LiveRun = await response.json();
        if (cancelled) return;
        setRun(value); setError('');
        if (value.status === 'running') timer = setTimeout(poll, 900);
      } catch {
        if (!cancelled) { setError('Connection interrupted. Reconnecting…'); timer = setTimeout(poll, 2500); }
      }
    }
    timer = setTimeout(poll, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [run?.id, run?.status]);
  async function start() {
    if (starting || run?.status === 'running') return;
    setStarting(true); setError('');
    try {
      const response = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, mode: 'design', inspirationId, conceptId, projectId }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not start the live test');
      if (mounted.current) { setRun(value); localStorage.setItem(key, value.id); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not start'); }
    finally { if (mounted.current) setStarting(false); }
  }
  return { run, error, starting, start, running: starting || run?.status === 'running' };
}
