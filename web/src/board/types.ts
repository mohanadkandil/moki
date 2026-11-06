// The Job API contract from docs/engineering/2026-11-04-tscircuit/BRIEF.md, as the browser reads it.
// Kept here (not imported from server/) so the UI bundle never pulls in server code.
import type { CircuitDesign } from '../../../src/circuit/model';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type StageStatus = 'done' | 'failed' | 'skipped';
export type ArtifactKind = 'source' | 'svg' | 'glb' | 'stl' | 'zip' | 'csv' | 'json' | 'step';

export interface JobStage { name: string; status: StageStatus; ms: number; note?: string }
export interface DrcEntry { type: string; message: string }
export interface Artifact { url: string; bytes: number; sha256: string; kind: ArtifactKind }

export interface BoardJob {
  jobId: string;
  status: JobStatus;
  error?: string;
  input?: { kind: 'design' | 'source'; template?: string; designContentId?: string; sourceSha256?: string };
  cache?: 'hit' | 'miss';
  stages?: JobStage[];
  totalMs?: number;
  drc?: { errors: DrcEntry[]; warnings: DrcEntry[]; checked?: boolean };
  board?: { widthMm: number; heightMm: number; layers: number; traceCount: number; viaCount: number };
  artifacts?: Record<string, Artifact>;
  toolVersions?: Record<string, string>;
  /** The plan has no microcontroller, so this board has no firmware. */
  noFirmware?: boolean;
}

export type JobRequest = { design: CircuitDesign } | { source: string; baseJobId?: string };

export interface BoardApi {
  readonly isMock: boolean;
  create(body: JobRequest): Promise<{ jobId: string }>;
  get(jobId: string, signal?: AbortSignal): Promise<BoardJob>;
}

export const TAB_IDS = ['schematic', 'pcb', '3d', 'enclosure', 'firmware', 'code', 'files'] as const;
export type TabId = (typeof TAB_IDS)[number];
