import { useEffect, useState } from "react";
import { Check, RefreshCw, ImageOff } from "lucide-react";
import type { InspirationSet } from "../../src/contracts/inspiration";
import "./inspiration-picker.css";

type Props = {
  set: InspirationSet | null;
  selectedId?: string;
  onSelect: (conceptId: string) => void;
  onRetry: () => void;
};

type Concept = InspirationSet["concepts"][number];

function DirectionCard({ concept, index, selected, onSelect, onImageStatus }: {
  concept: Concept;
  index: number;
  selected: boolean;
  onSelect: (conceptId: string) => void;
  onImageStatus: (conceptId: string, failed: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setLoaded(false); setImageFailed(false); }, [concept.imageUrl, concept.status]);
  const failed = concept.status === "failed" || imageFailed;
  const ready = concept.status === "ready" && Boolean(concept.imageUrl) && loaded && !imageFailed;
  const title = concept.title || `Direction ${index + 1}`;
  return <button
    type="button"
    className={`inspiration-card${selected ? " is-selected" : ""}${failed ? " has-error" : ""}`}
    disabled={!ready}
    aria-pressed={selected}
    aria-label={`${title}${ready ? ": choose this direction" : failed ? ": image unavailable" : ": image is being prepared"}`}
    onClick={() => onSelect(concept.id)}
  >
    <span className={`inspiration-card-image${ready ? " is-loaded" : ""}`}>
      {!failed && !ready && <span className="inspiration-skeleton" aria-hidden="true" />}
      {concept.status === "ready" && concept.imageUrl && !imageFailed && <img
        src={concept.imageUrl}
        alt={`${title}${concept.direction ? `. ${concept.direction}` : ""}`}
        loading="eager"
        decoding="async"
        onLoad={() => { setLoaded(true); onImageStatus(concept.id, false); }}
        onError={() => { setImageFailed(true); onImageStatus(concept.id, true); }}
      />}
      {failed && <span className="inspiration-card-error"><ImageOff size={21} strokeWidth={1.4} /><span>{concept.error || (imageFailed ? "The image could not be displayed." : "This direction could not be generated.")}</span></span>}
      {selected && ready && <span className="inspiration-selected-mark" aria-hidden="true"><Check size={16} strokeWidth={2.4} /></span>}
    </span>
    <span className="inspiration-card-copy"><span className="inspiration-card-number">{String(index + 1).padStart(2, "0")}</span><span className="inspiration-card-caption"><strong>{title}</strong>{concept.direction && <span>{concept.direction}</span>}</span></span>
  </button>;
}

export default function InspirationPicker({ set, selectedId, onSelect, onRetry }: Props) {
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  useEffect(() => { setImageErrors({}); }, [set?.id]);
  const activeId = selectedId ?? set?.selectedId;
  const failed = Object.values(imageErrors).some(Boolean) || set?.status === "failed" || set?.concepts.some(concept => concept.status === "failed");
  const running = !set || set.status === "running";
  const concepts: Concept[] = set?.concepts.length ? set.concepts : Array.from({ length: 4 }, (_, index) => ({
    id: `pending-${index}`, title: `Direction ${index + 1}`, direction: "", status: "pending" as const,
  }));
  return <section className="inspiration-picker" aria-labelledby="inspiration-title">
    <div className="inspiration-heading"><div><h2 id="inspiration-title">Choose a direction</h2><p>Explore the shape and feel before we work through the details.</p></div>{failed && !running && <button type="button" className="inspiration-retry" onClick={onRetry}><RefreshCw size={13} />Try again</button>}</div>
    {set?.error && <p className="inspiration-set-error" role="alert">{set.error}</p>}
    <div className="inspiration-grid" aria-busy={running}>
      {concepts.map((concept, index) => <DirectionCard key={`${set?.id ?? "pending"}:${concept.id}`} concept={concept} index={index} selected={activeId === concept.id} onSelect={onSelect} onImageStatus={(id, imageFailed) => setImageErrors(previous => ({ ...previous, [id]: imageFailed }))} />)}
    </div>
    <div className="inspiration-status" role="status" aria-live="polite">{running ? <><span className="inspiration-status-dot" />Creating four different directions…</> : failed ? "A direction didn’t come through. You can retry or choose an available image." : activeId ? "Direction selected. Ready when you are." : "Choose the one you’d like to explore."}</div>
  </section>;
}
