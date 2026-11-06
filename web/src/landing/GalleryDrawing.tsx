// A project's real schematic on its card, while it has no build to photograph. Loaded only when a card needs one.
import { useMemo, type ReactNode } from 'react';
import { SheetDrawing } from '../studio/schematic/SheetDrawing';
import { drawingLayout } from './galleryDrawingLayout';
import '../studio/schematic/schematic.css';

const SHOW = { pins: true, labels: true, marks: false, small: false };

export default function GalleryDrawing({ sheet, fallback }: { sheet: { title: string; parts: unknown[]; nets: unknown[] }; fallback: ReactNode }) {
  const layout = useMemo(() => drawingLayout(sheet), [sheet]);
  if (!layout) return <>{fallback}</>;
  return (
    <div className="sc-canvas recent-drawing">
      <svg viewBox={`0 0 ${layout.w} ${layout.h}`} preserveAspectRatio="xMidYMin slice" aria-hidden="true">
        <SheetDrawing layout={layout} show={SHOW} part={null} net={null} title={[{ k: 'Title', v: sheet.title }]} />
      </svg>
    </div>
  );
}
