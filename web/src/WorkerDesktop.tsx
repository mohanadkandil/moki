import { useEffect, useId, useRef, useState } from 'react';
import { CircuitBoard, Cuboid, LoaderCircle, Maximize2, RefreshCw, X } from 'lucide-react';
import './worker-desktop.css';

type Role = 'mechanical' | 'electrical';
type Props = { role: Role; onClose: () => void };

export default function WorkerDesktop({ role, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  const descriptionId = useId();
  const [image, setImage] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const name = role === 'electrical' ? 'Electrical' : 'Mechanical';
  const Icon = role === 'electrical' ? CircuitBoard : Cuboid;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let currentUrl: string | null = null;
    let lastReceivedAt = 0;
    const controller = new AbortController();
    const staleCheck = setInterval(() => {
      if (!stopped && lastReceivedAt && Date.now() - lastReceivedAt > 8000) {
        setConnected(false);
        setError('Connection delayed. Waiting for a fresh desktop frame…');
      }
    }, 1000);
    setImage(null);
    setCapturedAt(null);
    setConnected(false);
    setError(null);
    const endpoint = `/api/desktops/${role}`;
    const unavailable = 'The desktop connection paused. Reconnecting…';
    async function capture() {
      if (stopped) return;
      if (document.visibilityState === 'hidden') {
        setConnected(false);
        timer = setTimeout(capture, 1500);
        return;
      }
      try {
        const response = await fetch(`${endpoint}/frame?t=${Date.now()}`, {
          cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/png')) {
          throw new Error('Desktop unavailable');
        }
        const blob = await response.blob();
        const nextUrl = URL.createObjectURL(blob);
        const frame = new Image();
        frame.src = nextUrl;
        try { await frame.decode(); }
        catch { URL.revokeObjectURL(nextUrl); throw new Error('Invalid frame'); }
        if (stopped) { URL.revokeObjectURL(nextUrl); return; }
        const oldUrl = currentUrl;
        currentUrl = nextUrl;
        lastReceivedAt = Date.now();
        setImage(nextUrl);
        setCapturedAt(response.headers.get('X-Moki-Captured-At') || new Date().toISOString());
        setConnected(true);
        setError(null);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
      } catch {
        if (stopped) return;
        setConnected(false);
        setError(unavailable);
      }
      if (!stopped) timer = setTimeout(capture, 1500);
    }
    async function connect() {
      try {
        const response = await fetch(endpoint, {
          cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) throw new Error('Desktop unavailable');
        if (!stopped) void capture();
      } catch {
        if (!stopped) {
          setError('The live desktop is unavailable. Check the worker, then reconnect.');
          setConnected(false);
        }
      }
    }
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(staleCheck);
      controller.abort();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [role, retry]);

  return (
    <dialog
      ref={dialog}
      className="worker-desktop"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); close.current(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close.current(); }}
    >
      <div className="worker-desktop-shell">
        <header className="worker-desktop-header">
          <div className="worker-desktop-identity">
            <span className="worker-desktop-icon"><Icon size={19} strokeWidth={1.65} /></span>
            <div><h2 id={titleId}>{name} workshop</h2><p id={descriptionId}>Live desktop · Daytona</p></div>
          </div>
          <div className="worker-desktop-actions">
            <span className={`worker-desktop-connection ${connected ? 'is-live' : ''}`}>
              <span />{connected ? 'Live' : error ? 'Reconnecting' : 'Connecting'}
            </span>
            <button className="worker-desktop-close" type="button" onClick={onClose} aria-label="Close live desktop"><X size={20} /></button>
          </div>
        </header>
        <div ref={screen} className={`worker-desktop-screen ${!connected && image ? 'is-paused' : ''}`}>
          {image ? <img src={image} alt={`Live ${name.toLowerCase()} Daytona desktop`} /> : (
            <div className="worker-desktop-empty" role="status">
              {!error && <LoaderCircle className="worker-desktop-spinner" size={25} />}
              <span>{error || `Connecting to the ${name.toLowerCase()} desktop…`}</span>
              {error && <button type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={14} /> Reconnect</button>}
            </div>
          )}
          {image && error && <div className="worker-desktop-reconnecting" role="status">{error}</div>}
        </div>
        <footer className="worker-desktop-footer">
          <span>{capturedAt ? `Last capture ${new Date(capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Waiting for the first frame'}<span className="worker-desktop-separator">·</span>Read-only view</span>
          <div>
            <button type="button" onClick={() => setRetry((value) => value + 1)} aria-label="Reconnect live desktop"><RefreshCw size={14} /><span>Reconnect</span></button>
            <button type="button" onClick={() => { void screen.current?.requestFullscreen?.().catch(() => {}); }} aria-label="Expand desktop"><Maximize2 size={14} /></button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
