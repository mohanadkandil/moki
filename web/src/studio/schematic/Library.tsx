import { Cpu, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fetchLibrary, type Library, type LibraryMode, type LibraryModule } from './api';
import type { BlockInfo } from './sheet';

const CATEGORY: Readonly<Record<string, string>> = { controller: 'Controllers', display: 'Displays', input: 'Inputs', sensor: 'Sensors', output: 'Outputs', passive: 'Passives' };
const CLASS_NAME = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-/g, ' ')}`;

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return [...groups];
}

/** What this board can take: modules on a carrier board, blocks on a chip board. The server does the searching. */
export function LibraryDrawer({ mode, onModule, onBlock, onClose }: { mode: LibraryMode; onModule: (module: LibraryModule) => void; onBlock: (block: BlockInfo) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Library | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    let live = true;
    const q = query.trim();
    // What's on screen stays until the next answer, so typing doesn't flash the list empty.
    const timer = window.setTimeout(() => {
      fetchLibrary(mode, q).then(
        lib => { if (live) { setFound(lib); setFailed(null); } },
        (err: unknown) => { if (live) setFailed(err instanceof Error ? err.message : String(err)); },
      );
    }, q ? 140 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [mode, query]);
  const q = query.trim();
  const modules = found?.modules ?? [];
  const blocks = found?.blocks ?? [];
  const empty = found && !modules.length && !blocks.length;
  return (
    <aside className="sc-library" aria-label="Library">
      <header className="sc-library-head">
        <h2>{mode === 'chip' ? 'Blocks' : 'Library'}</h2>
        <button type="button" className="sc-icon-button" aria-label="Close the library" onClick={onClose}><X size={16} /></button>
      </header>
      <label className="sc-library-search">
        <Search size={15} aria-hidden="true" />
        <input ref={input} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onClose(); }} placeholder={mode === 'chip' ? 'Search blocks' : 'Search parts'} aria-label={mode === 'chip' ? 'Search blocks' : 'Search parts'} />
      </label>
      <div className="sc-library-list">
        {failed && <p className="sc-library-note" role="alert">{failed}</p>}
        {!found && !failed && <p className="sc-library-note">Loading the library</p>}
        {empty && <p className="sc-library-note">{q ? `Nothing matches “${q}”.` : 'Nothing in the library yet.'}</p>}
        {groupBy(modules, m => m.category).map(([category, items]) => (
          <section key={category}>
            <h3>{CATEGORY[category] ?? CLASS_NAME(category)}</h3>
            {items.map(m => (
              <button key={m.id} type="button" className="sc-library-item" onClick={() => onModule(m)}>
                <Cpu size={15} aria-hidden="true" />
                <span><strong>{m.name}</strong><em>{m.pins} pins</em></span>
              </button>
            ))}
          </section>
        ))}
        {groupBy(blocks, b => b.class).map(([name, items]) => (
          <section key={name}>
            <h3>{CLASS_NAME(name)}</h3>
            {items.map(b => (
              <button key={`${b.id}@${b.version}`} type="button" className="sc-library-item" title={b.summary} onClick={() => onBlock(b)}>
                <Cpu size={15} aria-hidden="true" />
                <span><strong>{b.title}</strong><em>{b.parts} parts · {b.ports.length} ports{b.status === 'reviewed' ? '' : ' · not reviewed'}</em></span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}
