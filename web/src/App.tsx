import { Ink, LivingField } from "./brand";
import Workspace from "./Workspace";
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

export default function App() {
  const demoBrief =
    new URLSearchParams(window.location.search).get("demo") === "timer"
      ? projects[0]!.prompt
      : "";
  const [idea, setIdea] = useState(demoBrief);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("All ideas");
  const [selected, setSelected] = useState<Project | null>(null);
  const [draft, setDraft] = useState<string | null>(demoBrief || null);
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
    if (draft === null) document.title = "Moki — little ideas, real things.";
  }, [draft]);

  function focusComposer() {
    document.getElementById("make")?.scrollIntoView({
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

  if (draft !== null) {
    return (
      <Workspace
        brief={draft}
        reference={reference}
        onBack={() => setDraft(null)}
      />
    );
  }

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
