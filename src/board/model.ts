import type { CircuitDesign } from '../circuit/model.js';
import type { MakerEdits } from './edits.js';
import type { BoardPlan, GateResult } from '../blocks/contract.js';
export type { MakerEdits, BoardLayout } from './edits.js';
export interface BoardSubmission { ops?: unknown; design?: CircuitDesign; source?: string; plan?: BoardPlan; baseJobId?: string; edits?: MakerEdits }
export type BoardStageName = 'codegen' | 'render' | 'route' | 'svg' | 'gltf' | 'fab' | 'enclosure' | 'firmware' | 'firmware-compile' | 'erc' | 'power' | 'verify' | 'spice' | 'review' | 'drc' | 'compile' | 'block-test'
  | 'placement'
  | 'fanout';
export interface BoardStage { name: BoardStageName; status: 'done' | 'failed' | 'skipped'; ms: number; note?: string }
export interface BoardIssue { type: string; message: string }
export interface BoardArtifact { url: string; bytes: number; sha256: string; kind: 'source' | 'svg' | 'glb' | 'stl' | 'zip' | 'csv' | 'json' | 'step' }
export interface BoardReceipt {
  stages: BoardStage[]; totalMs: number; drc: { checked?: boolean; errors: BoardIssue[]; warnings: BoardIssue[] };
  board: { widthMm: number; heightMm: number; layers: number; traceCount: number; viaCount: number };
  toolVersions: Record<string, string>;
}
export interface BoardJob extends BoardReceipt {
  jobId: string; status: 'queued' | 'running' | 'done' | 'failed'; error?: string;
  input: { kind: 'design' | 'source' | 'plan'; /** The edits that made this job from its base. */ ops?: unknown[]; template?: string; designContentId?: string; sourceSha256: string; baseJobId?: string; edits?: MakerEdits; layoutSha256?: string; plan?: BoardPlan };
  gates?: GateResult[];
  /** The plan has no microcontroller, so this board has no firmware to write or compile. */
  noFirmware?: boolean;
  editSummary?: string[];
  cache: 'hit' | 'miss'; artifacts: Record<string, BoardArtifact>; createdAt: string;
}
