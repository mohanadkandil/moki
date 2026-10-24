import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ProductConcept } from "./product-models";

const ProductScene = lazy(() => import("./ProductScene"));

/** The photo stays mounted; WebGL exists only while this visible card is hovered or focused. */
export default function GalleryPreview({ concept, image, description }: { concept: ProductConcept; image: string; description: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const button = element.closest("button");
    if (!button) return;
    let hovered = false, focused = false;
    const update = () => setActive(hovered || focused);
    const enter = () => { hovered = true; update(); };
    const leave = () => { hovered = false; update(); element.style.removeProperty("--preview-x"); element.style.removeProperty("--preview-y"); };
    const focus = () => { focused = true; update(); };
    const blur = () => { focused = false; update(); };
    const move = (event: PointerEvent) => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const bounds = element.getBoundingClientRect();
      element.style.setProperty("--preview-x", `${(event.clientX - bounds.left) / bounds.width * 4 - 2}deg`);
      element.style.setProperty("--preview-y", `${2 - (event.clientY - bounds.top) / bounds.height * 4}deg`);
    };
    button.addEventListener("pointerenter", enter); button.addEventListener("pointerleave", leave);
    button.addEventListener("focus", focus); button.addEventListener("blur", blur); button.addEventListener("pointermove", move);
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.1 }); observer.observe(element);
    return () => {
      observer.disconnect(); button.removeEventListener("pointerenter", enter); button.removeEventListener("pointerleave", leave);
      button.removeEventListener("focus", focus); button.removeEventListener("blur", blur); button.removeEventListener("pointermove", move);
    };
  }, []);
  const mounted = active && visible && !failed;
  useEffect(() => { if (!mounted) setReady(false); }, [mounted]);
  return <div ref={host} className={`gallery-preview ${ready && mounted ? "is-live" : ""}`}>
    <img src={image} alt={description} loading="lazy" width="1280" height="960" />
    {mounted && <div className="gallery-preview-scene" aria-hidden="true"><Suspense fallback={null}><ProductScene concept={concept} interactive={false} onReady={() => setReady(true)} onError={() => setFailed(true)} /></Suspense></div>}
    {ready && mounted && <span className="gallery-preview-caption">3D concept</span>}
  </div>;
}
