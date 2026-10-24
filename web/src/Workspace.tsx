import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MessageScroller } from "@shadcn/react/message-scroller";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  ArrowLeft,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Box,
  CircuitBoard,
  ScanLine,
  Image as ImageIcon,
  FolderOpen,
  FileText,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal,
  Maximize2,
  Minus,
  Focus,
  Check,
  Circle,
  Paperclip,
  MessageSquare,
  Layers,
  Info,
} from "lucide-react";
import { Ink } from "./brand";
import "./workspace.css";

type View = "product" | "checks" | "showcase" | "files";
type Concept = {
  id: string;
  name: string;
  image: string;
  color: string;
  caption: string;
};
const concepts: Concept[] = [
  {
    id: "timer",
    name: "Pebble",
    image: "/images/pebble.webp",
    color: "#f6e5aa",
    caption: "A little more focus.",
  },
  {
    id: "synth",
    name: "Pocket synth",
    image: "/images/pocket-synth.webp",
    color: "#bccdeb",
    caption: "Good things make noise.",
  },
  {
    id: "lamp",
    name: "Little sun",
    image: "/images/little-sun.webp",
    color: "#e7bcb1",
    caption: "Your own little sun.",
  },
];
const plan = [
  {
    icon: Box,
    title: "Shape & enclosure",
    detail: "Form, materials, and how the pieces fit.",
    tab: "product" as View,
  },
  {
    icon: CircuitBoard,
    title: "Electronics & behavior",
    detail: "The board, connections, and controls.",
    tab: "product" as View,
  },
  {
    icon: ScanLine,
    title: "Fit & checks",
    detail: "Evidence from the actual design files.",
    tab: "checks" as View,
  },
  {
    icon: ImageIcon,
    title: "Story & showcase",
    detail: "A first impression for your invention.",
    tab: "showcase" as View,
  },
];
const tabs = [
  { key: "product", title: "Product", icon: Box },
  { key: "showcase", title: "Showcase", icon: ImageIcon },
] as const;

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Workspace({
  brief,
  reference,
  onBack,
}: {
  brief: string;
  reference: File | null;
  onBack: () => void;
}) {
  const initialConcept = /timer|focus/i.test(brief)
    ? concepts[0]!
    : /synth|music/i.test(brief)
      ? concepts[1]!
      : /lamp|light/i.test(brief)
        ? concepts[2]!
        : null;
  const [concept, setConcept] = useState<Concept | null>(initialConcept);
  const [title, setTitle] = useState(
    initialConcept
      ? `${initialConcept.name} ${initialConcept.id === "timer" ? "— focus timer" : "— concept"}`
      : "Untitled invention",
  );
  const [view, setView] = useState<View>("product");
  const [chatOpen, setChatOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<Array<{ id: string; text: string }>>([]);
  const [attachment, setAttachment] = useState<File | null>(reference);
  const [attachmentError, setAttachmentError] = useState("");
  const [showcaseRatio, setShowcaseRatio] = useState("4 / 3");
  const [headline, setHeadline] = useState(initialConcept?.name || "");
  const [description, setDescription] = useState(brief);
  const [filePreview, setFilePreview] = useState("brief");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const referenceDialog = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    document.title = `${title || "Untitled invention"} — Moki`;
  }, [title]);
  useEffect(() => {
    if (referencesOpen) referenceDialog.current?.showModal();
    else referenceDialog.current?.close();
  }, [referencesOpen]);
  useEffect(() => {
    const listener = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);

  const briefFile = useMemo(
    () =>
      `# ${title || "Untitled invention"}\n\n## Original idea\n\n${brief}\n\n${notes.length ? "## Refinements\n\n" + notes.map((n) => "- " + n.text).join("\n") + "\n\n" : ""}${attachment ? "## Reference\n\n" + attachment.name + " (local reference, not uploaded)\n\n" : ""}## Status\n\nDesign brief only. No CAD, PCB, firmware, or validation outputs have been generated.\n${concept ? "\nGallery reference: " + concept.name + ". Illustrative imagery, not current CAD.\n" : ""}`,
    [title, brief, notes, attachment, concept],
  );

  function addNote(event?: FormEvent) {
    event?.preventDefault();
    if (!input.trim()) return;
    setNotes((n) => [...n, { id: crypto.randomUUID(), text: input.trim() }]);
    setInput("");
  }
  function chooseConcept(c: Concept) {
    setConcept(c);
    setZoom(1);
    setReferencesOpen(false);
  }
  function changeView(next: View) {
    setView(next);
    setDetailsOpen(false);
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (stageRef.current?.requestFullscreen)
      await stageRef.current.requestFullscreen();
  }

  return (
    <div className={`studio-page ${chatOpen ? "" : "studio-chat-hidden"}`}>
      <header className="studio-header">
        <div className="studio-project-identity">
          <button
            className="studio-brand"
            onClick={onBack}
            aria-label="Back to Moki ideas"
            title="Back to ideas"
          >
            <Ink />
          </button>
          <span className="studio-header-divider" />
          <div className="studio-title-wrap">
            <input
              ref={titleRef}
              className="studio-project-title"
              value={title}
              maxLength={70}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (!title.trim()) setTitle("Untitled invention");
              }}
              aria-label="Project name"
            />
            <button
              onClick={() => titleRef.current?.focus()}
              aria-label="Rename project"
            >
              <ChevronDown size={13} />
            </button>
          </div>
          <span className="studio-draft-label">
            <span />
            Concept
          </span>
        </div>
        <div className="studio-header-actions">
          <button
            className={`studio-icon-button ${watchOpen ? "selected" : ""}`}
            onClick={() => setWatchOpen(!watchOpen)}
            aria-label="Show workshop activity"
            aria-pressed={watchOpen}
            title="Workshop activity"
          >
            <Layers size={17} />
          </button>
          <button
            className="studio-export"
            onClick={() => downloadText("project-brief.md", briefFile)}
          >
            <Download size={14} />
            <span>Export brief</span>
          </button>
        </div>
      </header>
      <main className="studio-main">
        <aside
          className="studio-conversation"
          aria-label="Project conversation"
        >
          <div className="studio-chat-heading">
            <div>
              <Ink />
              <span>Your workshop</span>
            </div>
            <button
              className="studio-icon-button"
              onClick={() => setChatOpen(false)}
              aria-label="Collapse conversation"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
          <MessageScroller.Provider autoScroll defaultScrollPosition="start">
            <MessageScroller.Root className="studio-thread">
              <MessageScroller.Viewport
                className="studio-thread-viewport"
                aria-label="Project conversation messages"
              >
                <MessageScroller.Content className="studio-thread-content">
                  <MessageScroller.Item messageId="original-brief" scrollAnchor>
                    <div className="studio-message-meta">
                      <span>YOU</span>
                      <span>The starting point</span>
                    </div>
                    <div className="studio-user-message">{brief}</div>
                    {attachment && (
                      <span className="studio-message-reference">
                        <Paperclip size={11} />
                        {attachment.name}
                      </span>
                    )}
                  </MessageScroller.Item>
                  <MessageScroller.Item messageId="workshop-intro">
                    <div className="studio-assistant-label">
                      <Ink />
                      <span>Moki</span>
                    </div>
                    <div className="studio-assistant-message">
                      <p>
                        Choose a visual starting point, or add more detail to
                        your brief.
                      </p>
                    </div>
                    <details className="studio-plan">
                      <summary>
                        <span className="studio-plan-dot" />
                        <span>The making plan</span>
                        <small>4 stages</small>
                        <ChevronDown size={13} />
                      </summary>
                      <div className="studio-plan-items">
                        {plan.map(
                          (
                            { icon: Icon, title: itemTitle, detail, tab },
                            i,
                          ) => (
                            <button
                              key={itemTitle}
                              onClick={() => changeView(tab)}
                            >
                              <span className="plan-step-icon">
                                <Icon size={15} />
                              </span>
                              <span>
                                <strong>{itemTitle}</strong>
                                <small>{detail}</small>
                              </span>
                              <span className="plan-step-index">0{i + 1}</span>
                            </button>
                          ),
                        )}
                      </div>
                    </details>
                  </MessageScroller.Item>
                  {notes.map((note) => (
                    <MessageScroller.Item
                      key={note.id}
                      messageId={note.id}
                      scrollAnchor
                    >
                      <div className="studio-message-meta">
                        <span>YOU</span>
                        <span>Refinement</span>
                      </div>
                      <div className="studio-user-message">{note.text}</div>
                      <div className="studio-note-saved">
                        <Check size={12} />
                        Added to your brief
                      </div>
                    </MessageScroller.Item>
                  ))}
                </MessageScroller.Content>
              </MessageScroller.Viewport>
              <MessageScroller.Button
                className="studio-jump-latest"
                direction="end"
              >
                <ArrowDown size={12} />
                Latest
              </MessageScroller.Button>
            </MessageScroller.Root>
          </MessageScroller.Provider>
          <div className="studio-chat-bottom">
            <form className="studio-prompt" onSubmit={addNote}>
              <label className="sr-only" htmlFor="studio-message">
                Refine your idea
              </label>
              <textarea
                ref={inputRef}
                id="studio-message"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={3000}
                placeholder="A new detail. A different direction…"
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    addNote();
                  }
                }}
              />
              <div className="studio-prompt-toolbar">
                <button
                  type="button"
                  className="studio-icon-button"
                  aria-label="Attach a reference image"
                  onClick={() => fileRef.current?.click()}
                >
                  <Plus size={17} />
                </button>
                <span>Add to brief</span>
                <button
                  type="submit"
                  className="studio-send"
                  disabled={!input.trim()}
                  aria-label="Add refinement"
                >
                  <ArrowUp size={17} />
                </button>
              </div>
            </form>
            {attachmentError && (
              <p className="studio-attachment-error" role="alert">
                {attachmentError}
              </p>
            )}
            <div className="studio-chat-footnote">
              <span className="studio-blue-dot" />
              Local design session <span>↵ to add · ⇧↵ new line</span>
            </div>
          </div>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            ref={fileRef}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 10 * 1024 * 1024) {
                setAttachmentError("Choose an image smaller than 10 MB.");
                e.target.value = "";
                return;
              }
              setAttachmentError("");
              setAttachment(f);
            }}
          />
        </aside>

        <section className="studio-workbench" aria-label="Product workspace">
          <div className="studio-workbench-heading">
            <div className="studio-canvas-heading">
              {!chatOpen && (
                <button
                  className="studio-icon-button"
                  onClick={() => setChatOpen(true)}
                  aria-label="Expand conversation"
                >
                  <PanelLeftOpen size={17} />
                </button>
              )}
            </div>
            <div
              className="studio-view-tabs"
              role="tablist"
              aria-label="Workspace views"
            >
              {tabs.map(({ key, title: label, icon: Icon }, i) => (
                <button
                  key={key}
                  role="tab"
                  id={`tab-${key}`}
                  aria-selected={view === key}
                  aria-controls={`studio-${key}`}
                  tabIndex={
                    view === key ||
                    ((view === "checks" || view === "files") &&
                      key === "product")
                      ? 0
                      : -1
                  }
                  className={view === key ? "active" : ""}
                  onClick={() => changeView(key)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      const next =
                        tabs[
                          (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                            tabs.length
                        ]!;
                      changeView(next.key);
                      document.getElementById(`tab-${next.key}`)?.focus();
                    }
                  }}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="studio-workbench-tools">
              <button
                className={`studio-icon-button ${view === "checks" ? "selected" : ""}`}
                onClick={() =>
                  changeView(view === "checks" ? "product" : "checks")
                }
                aria-label="Open checks"
                title="Checks"
              >
                <ScanLine size={16} />
              </button>
              <button
                className={`studio-icon-button ${view === "files" ? "selected" : ""}`}
                onClick={() =>
                  changeView(view === "files" ? "product" : "files")
                }
                aria-label="Open files"
                title="Files"
              >
                <FolderOpen size={16} />
              </button>
              <button
                className={`studio-icon-button ${detailsOpen ? "selected" : ""}`}
                onClick={() => setDetailsOpen(!detailsOpen)}
                aria-label="Show project details"
                aria-pressed={detailsOpen}
                title="Project details"
              >
                <SlidersHorizontal size={16} />
              </button>
            </div>
          </div>
          <div
            className="studio-view-body"
            role="tabpanel"
            id={`studio-${view}`}
            aria-labelledby={
              view === "product" || view === "showcase"
                ? `tab-${view}`
                : undefined
            }
            aria-label={
              view === "checks"
                ? "Checks"
                : view === "files"
                  ? "Files"
                  : undefined
            }
          >
            {view === "product" && (
              <div className="studio-product-view" ref={stageRef}>
                <div
                  className="studio-artboard"
                  style={{ backgroundColor: concept?.color || "#fcfbf7" }}
                >
                  <div className="studio-artboard-top">
                    <div className="studio-representation-control">
                      <span className="active">
                        <ImageIcon size={12} />
                        Reference image
                      </span>
                      <button
                        disabled
                        title="CAD view becomes available when a model is generated"
                      >
                        <Box size={12} />
                        CAD
                      </button>
                    </div>
                    <button
                      className="studio-reference-button"
                      onClick={() => setReferencesOpen(true)}
                    >
                      Explore references <Plus size={13} />
                    </button>
                  </div>
                  {concept ? (
                    <div className="studio-concept-image-wrap">
                      <img
                        className="studio-concept-image"
                        src={concept.image}
                        alt={`${concept.name}: illustrative gallery reference, not generated CAD`}
                        style={{ transform: `scale(${zoom})` }}
                      />
                    </div>
                  ) : (
                    <div className="studio-empty-concept">
                      <span className="studio-empty-mark">
                        <Box size={38} strokeWidth={1} />
                      </span>
                      <h2>Choose a starting point</h2>
                      <p>Add a reference to your product canvas.</p>
                      <button
                        className="studio-export"
                        onClick={() => setReferencesOpen(true)}
                      >
                        Explore references <ArrowUpRight size={14} />
                      </button>
                    </div>
                  )}
                  <div className="studio-canvas-tools">
                    <button
                      aria-label="Zoom out"
                      disabled={!concept || zoom <= 0.8}
                      onClick={() => setZoom((z) => Math.max(0.8, z - 0.1))}
                    >
                      <Minus size={15} />
                    </button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button
                      aria-label="Zoom in"
                      disabled={!concept || zoom >= 1.5}
                      onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
                    >
                      <Plus size={15} />
                    </button>
                    <i />
                    <button
                      aria-label="Reset canvas view"
                      onClick={() => setZoom(1)}
                    >
                      <Focus size={15} />
                    </button>
                    <button
                      aria-label={
                        fullscreen
                          ? "Exit fullscreen canvas"
                          : "Fullscreen canvas"
                      }
                      onClick={() => void toggleFullscreen()}
                    >
                      <Maximize2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="studio-product-status">
                  <span>
                    <Info size={13} />
                    {concept
                      ? "Concept imagery · no engineering geometry yet"
                      : "Your canvas is ready for a reference"}
                  </span>
                  <button onClick={() => changeView("checks")}>
                    View checks <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            )}
            {view === "checks" && (
              <section className="studio-checks-view">
                <div className="studio-check-summary">
                  <span className="studio-check-summary-icon">
                    <ScanLine size={24} strokeWidth={1.3} />
                  </span>
                  <div>
                    <strong>No checks have run yet</strong>
                    <p>
                      Engineering artifacts are needed before these can begin.
                    </p>
                  </div>
                  <span className="studio-neutral-badge">Not checked</span>
                </div>
                <div className="studio-check-list">
                  {[
                    {
                      title: "Board rules & connections",
                      detail:
                        "Electrical rules, routing, and netlist consistency.",
                      needs: "PCB & schematic",
                    },
                    {
                      title: "Board-to-enclosure fit",
                      detail: "Mounts, clearances, and component envelopes.",
                      needs: "PCB geometry & case",
                    },
                    {
                      title: "Connector access",
                      detail: "The port opening and space for the cable.",
                      needs: "Connector & case",
                    },
                    {
                      title: "Firmware behavior",
                      detail: "Compilation and fixed behavior scenarios.",
                      needs: "Firmware source",
                    },
                  ].map((item) => (
                    <details key={item.title}>
                      <summary>
                        <span className="studio-unchecked">
                          <Circle size={16} />
                        </span>
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <span className="studio-neutral-badge">Not run</span>
                        <ChevronDown size={14} />
                      </summary>
                      <div className="studio-check-detail">
                        <span>REQUIRED INPUT</span>
                        <p>{item.needs}</p>
                        <p>
                          No checker evidence or artifact hashes are available
                          for this check.
                        </p>
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            )}
            {view === "showcase" && (
              <section className="studio-showcase-view">
                <div className="studio-showcase-heading">
                  <div
                    className="studio-ratio-control"
                    aria-label="Showcase crop"
                  >
                    {[
                      { text: "Square", ratio: "1 / 1" },
                      { text: "Portrait", ratio: "4 / 5" },
                      { text: "Wide", ratio: "4 / 3" },
                    ].map((r) => (
                      <button
                        key={r.text}
                        aria-pressed={showcaseRatio === r.ratio}
                        onClick={() => setShowcaseRatio(r.ratio)}
                      >
                        {r.text}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="studio-showcase-layout">
                  <div
                    className="studio-showcase-image"
                    style={{ aspectRatio: showcaseRatio }}
                  >
                    {concept ? (
                      <img
                        src={concept.image}
                        alt={`${concept.name} gallery reference`}
                      />
                    ) : (
                      <div>
                        <ImageIcon size={35} strokeWidth={1} />
                        <p>Choose a reference to explore a composition.</p>
                        <button onClick={() => setReferencesOpen(true)}>
                          Explore references
                        </button>
                      </div>
                    )}
                    <span>Reference image</span>
                  </div>
                  <div className="studio-showcase-editor">
                    <label htmlFor="showcase-headline">Headline</label>
                    <input
                      id="showcase-headline"
                      placeholder="Product name or headline"
                      value={headline}
                      onChange={(e) => setHeadline(e.target.value)}
                    />
                    <label htmlFor="showcase-description">Description</label>
                    <textarea
                      id="showcase-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <button
                      className="studio-export"
                      onClick={() =>
                        downloadText(
                          "showcase-notes.md",
                          `# ${headline}\n\n${description}\n\nReference concept imagery only. Not grounded in current CAD.\n`,
                        )
                      }
                    >
                      <Download size={14} />
                      Export story notes
                    </button>
                  </div>
                </div>
              </section>
            )}
            {view === "files" && (
              <section className="studio-files-view">
                <div className="studio-files-heading">
                  <button
                    className="studio-export"
                    onClick={() => downloadText("project-brief.md", briefFile)}
                  >
                    <Download size={14} />
                    Download brief
                  </button>
                </div>
                <div className="studio-file-browser">
                  <div className="studio-file-tree">
                    <span>PROJECT</span>
                    <button
                      className={filePreview === "brief" ? "active" : ""}
                      onClick={() => setFilePreview("brief")}
                    >
                      <FileText size={15} />
                      project-brief.md
                    </button>
                    {[
                      { label: "Mechanical", id: "mechanical", icon: Box },
                      {
                        label: "Electronics",
                        id: "electronics",
                        icon: CircuitBoard,
                      },
                      { label: "Firmware", id: "firmware", icon: Layers },
                    ].map(({ label, id, icon: Icon }) => (
                      <button
                        key={id}
                        className={filePreview === id ? "active" : ""}
                        onClick={() => setFilePreview(id)}
                      >
                        <Icon size={15} />
                        {label}
                        <span>0</span>
                      </button>
                    ))}
                  </div>
                  <div className="studio-file-preview">
                    <div>
                      <FileText size={14} />
                      <span>
                        {filePreview === "brief"
                          ? "project-brief.md"
                          : filePreview}
                      </span>
                      <small>
                        {filePreview === "brief"
                          ? "Current session"
                          : "No artifacts"}
                      </small>
                    </div>
                    {filePreview === "brief" ? (
                      <pre>{briefFile}</pre>
                    ) : (
                      <div className="studio-files-empty">
                        <FolderOpen size={32} strokeWidth={1} />
                        <h2>Nothing here just yet.</h2>
                        <p>
                          Real {filePreview} artifacts will appear here when
                          generated.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
            {detailsOpen && (
              <aside className="studio-inspector">
                <div>
                  <strong>Project details</strong>
                  <button
                    className="studio-icon-button"
                    onClick={() => setDetailsOpen(false)}
                    aria-label="Close project details"
                  >
                    <X size={15} />
                  </button>
                </div>
                <span className="studio-section-kicker">REPRESENTATION</span>
                <h3>{concept ? concept.name : "No reference selected"}</h3>
                <p>
                  {concept
                    ? "Illustrative gallery reference. This image was created before your project and is not derived from its engineering geometry."
                    : "Your project begins with a brief. You can add a visual reference to the canvas."}
                </p>
                <dl>
                  <div>
                    <dt>Stage</dt>
                    <dd>Concept exploration</dd>
                  </div>
                  <div>
                    <dt>CAD geometry</dt>
                    <dd>Not generated</dd>
                  </div>
                  <div>
                    <dt>PCB geometry</dt>
                    <dd>Not generated</dd>
                  </div>
                  <div>
                    <dt>Checked dimensions</dt>
                    <dd>None yet</dd>
                  </div>
                </dl>
                <span className="studio-section-kicker">
                  REFERENCE ATTACHMENT
                </span>
                <p>{attachment?.name || "No local attachment"}</p>
                {attachment && (
                  <button
                    className="studio-remove-reference"
                    onClick={() => setAttachment(null)}
                  >
                    Remove attachment
                  </button>
                )}
              </aside>
            )}
          </div>
          {watchOpen && (
            <div className="studio-activity">
              <div>
                <Layers size={15} />
                <strong>Workshop activity</strong>
                <span>No jobs running</span>
                <button
                  className="studio-icon-button"
                  onClick={() => setWatchOpen(false)}
                  aria-label="Close workshop activity"
                >
                  <X size={15} />
                </button>
              </div>
              <p>
                Engineering execution is not connected to this workspace yet.
                Live tool actions, worker views, and validation evidence will
                appear here when it is.
              </p>
            </div>
          )}
        </section>
      </main>
      <button
        className="studio-mobile-chat-toggle"
        onClick={() => setChatOpen(!chatOpen)}
        aria-label={chatOpen ? "Show product canvas" : "Show conversation"}
      >
        {chatOpen ? <Box size={18} /> : <MessageSquare size={18} />}
        <span>{chatOpen ? "View product" : "Your workshop"}</span>
      </button>
      <dialog
        ref={referenceDialog}
        className="studio-reference-dialog"
        aria-labelledby="studio-references-title"
        onCancel={() => setReferencesOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setReferencesOpen(false);
        }}
      >
        <div className="studio-reference-dialog-heading">
          <div>
            <span className="studio-section-kicker">A PLACE TO START</span>
            <h2 id="studio-references-title">Reference gallery</h2>
          </div>
          <button
            className="studio-icon-button"
            aria-label="Close reference gallery"
            onClick={() => setReferencesOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          These are gallery concepts to explore, not designs generated from your
          brief.
        </p>
        <div>
          {concepts.map((c) => (
            <button key={c.id} onClick={() => chooseConcept(c)}>
              <img src={c.image} alt={c.caption} />
              <span>
                {c.name}
                <ArrowUpRight size={14} />
              </span>
            </button>
          ))}
        </div>
      </dialog>
    </div>
  );
}
