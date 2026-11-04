import type { TabId } from './Canvas';

export type ArtName = TabId | 'bench';
export type ArtState = 'idle' | 'live' | 'failed';

/** A plan view of a carrier board: outline, four holes, two footprints. The live path is the run the build is drawing. */
const BOARD = (
  <>
    <rect x="50" y="18" width="140" height="114" rx="7" />
    {[[60, 28], [180, 28], [60, 122], [180, 122]].map(([cx, cy]) => <circle key={`${cx}${cy}`} cx={cx} cy={cy} r="3" />)}
    <rect x="68" y="50" width="42" height="66" rx="2" />
    <rect x="136" y="38" width="36" height="28" rx="2" />
    <rect x="138" y="88" width="32" height="30" rx="2" />
  </>
);

const ART: Record<ArtName, { still: React.ReactNode; live: string }> = {
  bench: { still: BOARD, live: 'M0 75 H50 M110 70 H124 L136 58 M110 92 H126 L138 104' },
  pcb: { still: BOARD, live: 'M110 70 H124 L136 58 M110 92 H126 L138 104 M154 66 V88' },
  schematic: {
    still: (
      <>
        <rect x="40" y="14" width="160" height="122" rx="3" />
        <path d="M140 136 V116 H200 M140 124 H200 M170 116 V124" />
        <rect x="62" y="38" width="30" height="50" />
        <rect x="136" y="36" width="26" height="22" />
        <rect x="136" y="72" width="26" height="22" />
        <path d="M56 46 H62 M56 56 H62 M56 66 H62 M56 76 H62" />
      </>
    ),
    live: 'M92 48 H136 M92 62 H118 V80 H136',
  },
  '3d': {
    still: (
      <>
        <path d="M120 40 L204 84 L120 128 L36 84 Z" />
        <path d="M36 84 V90 L120 134 L204 90 V84 M120 128 V134" />
        <path d="M94 62 L136 84 L112 97 L70 75 Z M70 75 V60 L94 47 L136 69 V84 M94 62 V47" />
        <path d="M146 73 L168 84 L152 92 L130 81" />
      </>
    ),
    live: 'M36 87 L120 131 L204 87',
  },
  case: {
    still: (
      <>
        <path d="M120 26 L200 66 L120 106 L40 66 Z" />
        <path d="M40 66 V90 L120 130 L200 90 V66 M120 106 V130" />
        <path d="M40 76 L120 116 L200 76" />
        <path d="M128 58 L156 72 L140 80 L112 66 Z" />
      </>
    ),
    live: 'M40 76 L120 116 L200 76',
  },
  firmware: {
    still: (
      <>
        <path d="M58 22 V128" />
        <path d="M70 30 H118 M70 44 H150 M82 58 H138 M82 72 H168 M82 86 H126 M70 100 H110 M70 114 H142" />
      </>
    ),
    live: 'M46 30 V128',
  },
  code: {
    still: (
      <>
        <path d="M58 22 V128" />
        <path d="M70 30 H134 M82 44 H176 M94 58 H160 M94 72 H182 M94 86 H148 M82 100 H120 M70 114 H102" />
      </>
    ),
    live: 'M46 30 V128',
  },
};

/** Faint line art of what will land here, so an empty pane says what it's for. Failed runs its live trace in the error colour. */
export function PaneArt({ name, state }: { name: ArtName; state: ArtState }) {
  const art = ART[name];
  return (
    <svg className={`st-art is-${state}`} viewBox="0 0 240 150" aria-hidden="true" fill="none">
      <g className="st-art-still">{art.still}</g>
      <path className="st-art-trace" d={art.live} pathLength={100} />
    </svg>
  );
}
