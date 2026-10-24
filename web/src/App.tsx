import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Plus,
  X,
  Pause,
  Play,
  MoveUpRight,
  Box,
  CircuitBoard,
  ScanLine,
  Image as ImageIcon,
  FileText,
} from "lucide-react";

type Project = {
  name: string;
  category: "Everyday objects" | "Electronics";
  image: string;
  description: string;
  prompt: string;
  color: string;
  number: string;
};
const projects: Project[] = [
  {
    name: "A little more focus.",
    category: "Electronics",
    image: "/images/pebble.webp",
    description:
      "A tactile desk timer that makes room for one thing at a time.",
    prompt:
      "Make a small desk focus timer with an e-ink display, a satisfying orange dial, and a warm yellow enclosure. Power it over USB-C.",
    color: "#f6e5aa",
    number: "01",
  },
  {
    name: "Good things make noise.",
    category: "Electronics",
    image: "/images/pocket-synth.webp",
    description:
      "A pocket-sized synthesizer for happy accidents and tiny concerts.",
    prompt:
      "Design a playful pocket synthesizer with six soft keys, two orange knobs, a built-in speaker, and a blue enclosure.",
    color: "#bccdeb",
    number: "02",
  },
  {
    name: "Your own little sun.",
    category: "Everyday objects",
    image: "/images/little-sun.webp",
    description:
      "A warm, adjustable desk light with a quietly cheerful personality.",
    prompt:
      "Create a compact coral desk lamp with an adjustable aluminum neck, warm dimmable light, and a single tactile button.",
    color: "#e7bcb1",
    number: "03",
  },
];

function Ink({
  className = "",
  mood = "curious",
}: {
  className?: string;
  mood?: string;
}) {
  return (
    <svg
      className={`ink ${className} ink-${mood}`}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <path
        className="ink-body"
        d="M76 6C43-6 8 15 5 49 1 83 25 99 54 97c28-1 45-17 44-41-1-18-9-21-16-24C66 26 72 15 76 6Z"
      />
      <g className="ink-eyes">
        <ellipse
          cx="56"
          cy="54"
          rx="5.7"
          ry="9.5"
          transform="rotate(-18 56 54)"
        />
        <ellipse
          cx="76"
          cy="45"
          rx="5.1"
          ry="8.8"
          transform="rotate(-18 76 45)"
        />
      </g>
    </svg>
  );
}

function LivingField({ paused }: { paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d", { alpha: true });
    if (!el || !ctx) return;
    let width = 0,
      height = 0,
      frame = 0,
      last = 0;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new ResizeObserver(() => {
      width = el.clientWidth;
      height = el.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw(phase.current);
    });
    function draw(time: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const step = width < 600 ? 10 : 12;
      const t = time * 0.000065;
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const nx = (x - width / 2) / (width * 0.51);
          const ny = (y - height * 0.46) / (height * 0.51);
          const wave =
            Math.sin(x * 0.009 + Math.sin(y * 0.008 + t) * 1.8 + t) * 0.14 +
            Math.cos(y * 0.013 - x * 0.004 - t * 0.7) * 0.12 +
            Math.sin(x * 0.025 + y * 0.018 + t * 0.5) * 0.045;
          const field = nx * nx * 0.91 + ny * ny * 0.88 + wave;
          const protectX = Math.max(
            0,
            Math.abs(x - width / 2) - Math.min(width * 0.32, 410),
          );
          const protectY = Math.max(0, Math.abs(y - height * 0.47) - 210);
          if (protectX < 10 && protectY < 10) continue;
          if (field > 0.93) {
            ctx.fillStyle = "#119df3";
            ctx.fillRect(x, y, step, step);
          } else if (field > 0.76) {
            ctx.fillStyle = "#80ccfa";
            ctx.fillRect(x, y, step, step);
            ctx.fillStyle = "#149df3";
            for (let dy = 0; dy < step; dy += 3)
              for (let dx = 0; dx < step; dx += 3)
                if ((dx + dy) % 2) ctx.fillRect(x + dx, y + dy, 1, 1);
          } else if (field > 0.67) {
            ctx.fillStyle = "#89cefa";
            for (let dy = 0; dy < step; dy += 3)
              for (let dx = 0; dx < step; dx += 3)
                ctx.fillRect(x + dx, y + dy, 1, 1);
          }
        }
      }
    }
    function animate(time: number) {
      if (document.hidden) last = time;
      if (time - last > 80) {
        phase.current += last ? Math.min(time - last, 150) : 0;
        draw(phase.current);
        last = time;
      }
      frame = requestAnimationFrame(animate);
    }
    observer.observe(el);
    if (!paused && !media.matches) frame = requestAnimationFrame(animate);
    const onMotionChange = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (!paused && !media.matches) frame = requestAnimationFrame(animate);
      else draw(phase.current);
    };
    media.addEventListener("change", onMotionChange);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      media.removeEventListener("change", onMotionChange);
    };
  }, [paused]);
  return <canvas ref={canvas} className="living-field" aria-hidden="true" />;
}

export default function App() {
  const [idea, setIdea] = useState("");
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("All ideas");
  const [selected, setSelected] = useState<Project | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selected]);
  useEffect(() => {
    document.title =
      draft !== null
        ? "Your new idea — Moki"
        : "Moki — little ideas, real things.";
  }, [draft]);

  function focusComposer() {
    document
      .getElementById("make")
      ?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "center",
      });
    input.current?.focus({ preventScroll: true });
  }
  function useProject(project: Project) {
    setIdea(project.prompt);
    setSelected(null);
    requestAnimationFrame(focusComposer);
  }
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!idea.trim()) return;
    setDraft(idea.trim());
    window.scrollTo(0, 0);
  }

  if (draft !== null)
    return (
      <div className="draft-page">
        <header className="draft-header">
          <button className="wordmark" onClick={() => setDraft(null)}>
            <Ink />
            moki
          </button>
          <span className="draft-tag">Your workshop / New idea</span>
          <button className="back-button" onClick={() => setDraft(null)}>
            <ArrowLeft size={15} />
            Back to ideas
          </button>
        </header>
        <main className="draft-layout">
          <aside className="draft-brief">
            <span className="eyebrow">EVERY GOOD THING STARTS HERE</span>
            <h1>
              An idea.
              <br />
              <span>With possibilities.</span>
            </h1>
            <label htmlFor="draft-idea">Your starting point</label>
            <textarea
              id="draft-idea"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setIdea(e.target.value);
              }}
            />
            {reference && (
              <p className="reference-note">Reference: {reference.name}</p>
            )}
            <p className="draft-note">
              This brief lives in this session. Your engineering workspace is
              the next step.
            </p>
            <button className="text-button" onClick={() => setDraft(null)}>
              <ArrowLeft size={15} /> Keep exploring
            </button>
          </aside>
          <section
            className="draft-stage"
            aria-label="Project workspace preview"
          >
            <div className="stage-toolbar">
              <span>
                <Box size={16} /> Product
              </span>
              <span className="draft-status">Brief only</span>
            </div>
            <div className="empty-stage">
              <Ink />
              <h2>Let’s give it some shape.</h2>
              <p>
                Your idea is captured. CAD, electronics, and checks haven’t run
                yet.
              </p>
            </div>
            <div className="stage-roles">
              {[
                { icon: Box, name: "Mechanical" },
                { icon: CircuitBoard, name: "Electronics" },
                { icon: ScanLine, name: "Checks" },
                { icon: ImageIcon, name: "Showcase" },
              ].map(({ icon: Icon, name }) => (
                <div key={name}>
                  <Icon size={18} />
                  <span>{name}</span>
                  <small>Not started</small>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    );

  return (
    <>
      <a className="skip-link" href="#make">
        Skip to your idea
      </a>
      <div className="hero-wrap">
        <LivingField paused={paused} />
        <header className="site-header">
          <a className="wordmark logo-only" href="#" aria-label="Moki home">
            <Ink />
          </a>
          <nav aria-label="Main navigation">
            <a href="#ideas">The possibilities</a>
            <a href="#workshop">Meet the workshop</a>
          </nav>
          <button className="header-cta" onClick={focusComposer}>
            Let’s make something <ArrowUpRight size={17} />
          </button>
        </header>
        <main className="hero" id="main">
          <h1>What will you make?</h1>
          <p className="hero-description">
            Give your idea a life outside your head.
          </p>
          <form className="composer" id="make" onSubmit={submit}>
            <label className="sr-only" htmlFor="idea">
              What would you like to make?
            </label>
            <textarea
              id="idea"
              ref={input}
              value={idea}
              maxLength={3000}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="A little desk companion that helps me focus…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {reference && (
              <div className="reference-chip">
                <FileText size={13} />
                <span>{reference.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setReference(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                  aria-label="Remove reference"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <div className="composer-toolbar">
              <div className="composer-tools">
                <button
                  className="attach-button"
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  aria-label="Add a reference image"
                  title="Add a reference image"
                >
                  <Plus size={19} />
                </button>
                <span className="tools-divider" />
                <Ink className="composer-ink" />
                <span className="composer-hint">
                  Your little invention workshop
                </span>
              </div>
              <button
                className="send-button"
                type="submit"
                disabled={!idea.trim()}
                aria-label="Start your project"
              >
                <ArrowUp size={21} />
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && file.size > 10 * 1024 * 1024) {
                  setFileError("Choose an image smaller than 10 MB.");
                  e.target.value = "";
                  return;
                }
                setFileError("");
                setReference(file || null);
              }}
            />
          </form>
          {fileError && (
            <p className="file-error" role="alert">
              {fileError}
            </p>
          )}
        </main>
        <div className="hero-footnote">
          <a href="#ideas">A few ideas to get you started</a>
          <button
            onClick={() => setPaused(!paused)}
            aria-pressed={paused}
            aria-label={
              paused ? "Play background motion" : "Pause background motion"
            }
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </button>
        </div>
      </div>

      <section
        className="ideas-section"
        id="ideas"
        aria-labelledby="ideas-heading"
      >
        <div className="section-topline">
          <span className="eyebrow">
            <span className="tiny-square" /> THE POSSIBILITY SHELF
          </span>
          <span className="shelf-note">Small sparks. Real possibilities.</span>
        </div>
        <div className="ideas-heading-row">
          <h2 id="ideas-heading">
            It starts with
            <br />
            <span>a little “what if.”</span>
          </h2>
          <p>
            A few things to get your wheels turning.
            <br />
            Take an idea somewhere only you would.
          </p>
        </div>
        <div className="gallery-controls">
          <div className="segmented" aria-label="Filter project ideas">
            {["All ideas", "Everyday objects", "Electronics"].map((item) => (
              <button
                key={item}
                aria-pressed={filter === item}
                className={filter === item ? "active" : ""}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <span className="gallery-caption">
            EXPLORATIONS, NOT FINISHED PRODUCTS <ArrowDownSmall />
          </span>
        </div>
        <div className="project-grid">
          {projects
            .filter((p) => filter === "All ideas" || p.category === filter)
            .map((p) => (
              <button
                key={p.number}
                className="project-card"
                onClick={() => setSelected(p)}
                aria-label={`Explore ${p.name}`}
              >
                <div className="project-image" style={{ background: p.color }}>
                  <img
                    src={p.image}
                    alt={p.description}
                    loading="lazy"
                    width="1280"
                    height="960"
                  />
                  <span className="project-label">CONCEPT {p.number}</span>
                  <span className="project-open">
                    <ArrowUpRight size={19} />
                  </span>
                </div>
                <div className="project-title">
                  <h3>{p.name}</h3>
                  <span>{p.category}</span>
                </div>
                <p>{p.description}</p>
              </button>
            ))}
        </div>
        <div className="shelf-bottom">
          <span>Imagined with Moki. Illustrated with generated imagery.</span>
          <button className="text-button" onClick={focusComposer}>
            What’s your “what if”? <ArrowUpRight size={16} />
          </button>
        </div>
      </section>

      <section
        className="workshop-section"
        id="workshop"
        aria-labelledby="workshop-heading"
      >
        <div className="workshop-intro">
          <span className="eyebrow">SAY HELLO TO YOUR LITTLE WORKSHOP</span>
          <h2 id="workshop-heading">
            Big ideas need
            <br />
            <span>a few good hands.</span>
          </h2>
          <p>
            Moki brings the pieces of product creation into one place—from the
            first shape to its first hello.
          </p>
          <button className="dark-button" onClick={focusComposer}>
            Bring your idea <ArrowUpRight size={17} />
          </button>
          <div className="workshop-moki">
            <Ink />
            <span>
              I’ve got a good feeling
              <br />
              about this one.
            </span>
          </div>
        </div>
        <div className="workshop-steps">
          {[
            [
              "01",
              "Give it a shape.",
              "Explore the form, the feel, and how all the pieces fit together.",
              Box,
            ],
            [
              "02",
              "Make the connections.",
              "Bring the mechanical and electronic details into the same conversation.",
              CircuitBoard,
            ],
            [
              "03",
              "Check the little things.",
              "Keep track of what’s checked, what changed, and what still needs work.",
              ScanLine,
            ],
            [
              "04",
              "Let it meet the world.",
              "Put together the imagery and story for your invention’s debut.",
              MoveUpRight,
            ],
          ].map(([num, title, description, Icon]) => {
            const StepIcon = Icon as typeof Box;
            return (
              <div className="workshop-step" key={String(num)}>
                <span className="step-number">{String(num)}</span>
                <div>
                  <h3>{String(title)}</h3>
                  <p>{String(description)}</p>
                </div>
                <StepIcon size={23} strokeWidth={1.3} />
              </div>
            );
          })}
          <span className="workshop-status">
            <span />
            The workshop is taking shape. You’re here early.
          </span>
        </div>
      </section>
      <footer className="site-footer">
        <a className="wordmark" href="#">
          <Ink />
          moki
        </a>
        <span>A little idea goes a long way.</span>
        <a href="#make" onClick={() => input.current?.focus()}>
          Go on, make something. <ArrowUpRight size={15} />
        </a>
        <span className="footer-small">MADE FOR THE WHAT-IF PEOPLE.</span>
      </footer>

      <dialog
        ref={dialog}
        className="project-dialog"
        onCancel={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
        aria-labelledby="project-dialog-title"
      >
        {selected && (
          <>
            <button
              className="dialog-close"
              onClick={() => setSelected(null)}
              aria-label="Close project"
            >
              <X size={20} />
            </button>
            <img src={selected.image} alt={selected.description} />
            <div className="dialog-body">
              <span className="eyebrow">
                CONCEPT STUDY {selected.number} /{" "}
                {selected.category.toUpperCase()}
              </span>
              <h2 id="project-dialog-title">{selected.name}</h2>
              <p>{selected.description}</p>
              <div className="example-prompt">
                <span>THE STARTING POINT</span>
                <p>“{selected.prompt}”</p>
              </div>
              <p className="concept-note">
                Illustrative concept imagery. Engineering files and validation
                are not included.
              </p>
              <button
                className="dark-button"
                onClick={() => useProject(selected)}
              >
                Make it your own <ArrowRight size={17} />
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

function ArrowDownSmall() {
  return (
    <svg
      width="12"
      height="13"
      viewBox="0 0 12 13"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 1v10m-4-4 4 4 4-4" stroke="currentColor" />
    </svg>
  );
}
