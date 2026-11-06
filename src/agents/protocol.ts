// What the agent API and the browser agree on. Types only: the web bundle imports this file, so it
// must never pull in server code, an SDK or a key.
import type { DesignOp } from './edits.js';
import type { BoardPlan, GateResult, Requirement, RequirementResult } from '../blocks/contract.js';
import type { CircuitDesign } from '../circuit/model.js';

export type AgentRole = 'designer' | 'editor' | 'fixer' | 'explainer' | 'firmware' | 'reviewer' | 'verifier' | 'author';

export interface PartPlacement { refdes: string; x: number; y: number; rotation: number }
export type UsbEdge = 'left' | 'right' | 'top' | 'bottom';
/** Layer 2 of docs/engineering/2026-11-04-canvas-tools/BRIEF.md. The job API owns this contract. */
export interface BoardEdits {
  placements?: PartPlacement[];
  board?: { widthMm: number; heightMm: number; cornerRadiusMm?: number };
  usbEdge?: UsbEdge;
}

export interface AgentStatus {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'replay' | null;
  model: string | null;
  capUsd: number;
  /** Why it is off, in words the chat can show as they are. */
  reason: string | null;
  /** What the picker offers. Empty when agents are off. */
  efforts?: EffortOption[];
}

export type EffortId = 'fast' | 'balanced' | 'deep';
export interface EffortOption {
  id: EffortId;
  label: string;
  /** What it's for, in a maker's words. */
  use: string;
  model: string;
  reasoning: 'low' | 'medium' | 'high';
  capUsd: number;
  /** From builds on this server. Null until there is at least one. */
  avgCostUsd: number | null;
  builds: number;
}

/** A plan drawn without a block library in the browser. */
export interface SheetGraph {
  parts: { ref: string; inst: string; title: string; mpn?: string; value?: string; pins: { id: string; label: string; role?: string }[] }[];
  nets: { name: string; pins: { ref: string; pin: string }[] }[];
}

export type { DesignOp };

export interface ChatLine { role: 'user' | 'agent'; text: string }

export type { DeviceFacts, Requirement, RequirementMetric, RequirementMetricDef, RequirementResult } from '../blocks/contract.js';
export type VerifyGate = GateResult;

export interface TurnRequest {
  message: string;
  design?: CircuitDesign;
  brief?: string;
  jobId?: string;
  edits?: BoardEdits;
  history?: ChatLine[];
  /** A chip-level board. A first turn leaves this out and the server decides; a card's confirmation sends back what it was told. */
  mode?: 'chip';
  /** The maker was told this idea needs no microcontroller. Goes with mode, and comes back the same way. */
  noMcu?: boolean;
  effort?: EffortId;
  /** The project this turn belongs to. The server adds its builds and outcome to that project. */
  projectId?: string;
  /** Checks shown to the maker. Unconfirmed, the message asks to change them. Confirmed, design can start. */
  requirements?: Requirement[];
  requirementsConfirmed?: boolean;
  /** A person's edits to the chip-level board in `jobId`. They run through every gate, with no model deciding the change. */
  ops?: DesignOp[];
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  capUsd: number;
  agentMs: number;
  pipelineMs: number;
  /** True when any number here came from a character estimate or an assumed price, not a provider bill. */
  estimated: boolean;
}

export type TurnOutcome = 'built' | 'build-failed' | 'declined' | 'answered' | 'no-change' | 'fallback' | 'stopped' | 'error' | 'awaiting-confirmation' | 'built-unverified';

export type AgentEvent =
  | { type: 'start'; turnId: string; role: AgentRole; provider: string; model: string; capUsd: number }
  | { type: 'role'; role: AgentRole }
  | { type: 'plan'; plan: BoardPlan; unreviewed: string[] }
  /** Everything known so far, sent after each Designer step, so the canvas can grow while the agent works. */
  | { type: 'plan.partial'; step: string; design?: CircuitDesign; plan?: BoardPlan; graph?: SheetGraph }
  | { type: 'requirements'; requirements: Requirement[]; /** Stored with the turn. The chat doesn't list them. */ notCheckable: string[]; /** What the Verifier says to the maker, in its own words. */ message: string; brief: string; /** These checks belong to the device already on screen. */ existing: boolean; /** Send this back with the answer: the checks were written for this mode. */ mode?: 'chip'; /** And for a board with no microcontroller. */ noMcu?: boolean }
  | { type: 'verify'; ok: boolean; results: (RequirementResult & { plain: string })[] }
  | { type: 'message'; role: AgentRole; text: string }
  | { type: 'call'; role: AgentRole; index: number; ms: number; inputTokens: number; outputTokens: number; costUsd: number; estimated: boolean }
  /** tokens/costUsd belong to the model call that asked for this tool; `sharedWith` tools came from the same call. */
  | { type: 'tool'; role: AgentRole; name: string; ms: number; ok: boolean; summary: string; tokens: number; costUsd: number; sharedWith: number; estimated: boolean }
  | { type: 'design'; design: CircuitDesign; brief: string; changes: string[] }
  | { type: 'edit'; edits: BoardEdits; changes: string[] }
  | { type: 'decline'; message: string; closest: string | null; closestBrief: string | null }
  | { type: 'job'; jobId: string; attempt: number; baseJobId: string | null; label: string }
  | { type: 'job-result'; jobId: string; attempt: number; status: string; ok: boolean; drcErrors: number; compile: string; caseOk: boolean; pipelineMs: number; problems: string[] }
  | { type: 'fallback'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'done'; outcome: TurnOutcome; usage: UsageTotals };
