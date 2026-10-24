import { useEffect, useState } from 'react';

type Geometry = { width: number; height: number; thickness: number; holes: Array<{x: number; y: number; diameter: number}> };
export default function BoardPreview({ url }: { url: string }) {
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false; setFailed(false); setGeometry(null);
    fetch(url).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(value => {
      if (!cancelled) setGeometry(value);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);
  if (!geometry) return <div className="studio-board-preview">{failed ? 'Could not load board measurements.' : 'Loading measured board…'}</div>;
  const { width: w, height: h, holes, thickness } = geometry;
  return <div className="studio-board-preview"><svg viewBox={`-16 -16 ${w + 32} ${h + 32}`} role="img" aria-label={`Measured bare PCB ${w} by ${h} millimetres, ${holes.length} mounting holes`}>
    <rect x="0" y="0" width={w} height={h} rx="0.4" fill="#316c55" stroke="#234e3d" strokeWidth=".35"/>
    {holes.map((hole, i) => <circle key={i} cx={hole.x} cy={hole.y} r={hole.diameter / 2} fill="#fcfbf7" stroke="#d7c78b" strokeWidth=".45"/>)}
    <text x={w / 2} y={h / 2} textAnchor="middle" dominantBaseline="middle" fill="#dbeadd" fontSize="2.5">PROPOSED BOARD OUTLINE</text>
    <g fill="none" stroke="#858c83" strokeWidth=".15"><path d={`M0,-3V-9M${w},-3V-9M0,-7H${w}M-3,0H-9M-3,${h}H-9M-7,0V${h}`}/></g>
    <g fill="#697369" fontSize="2.8" textAnchor="middle"><text x={w / 2} y="-9">{w} mm</text><text transform={`translate(-9 ${h / 2}) rotate(-90)`}>{h} mm</text><text x={w / 2} y={h + 8}>{thickness} mm · {holes.length} NPTH holes · no circuit</text></g>
  </svg></div>;
}
