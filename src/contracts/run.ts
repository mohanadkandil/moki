export type StageState = 'pending' | 'running' | 'passed' | 'failed' | 'blocked';
export type RunStage = { id: string; name: string; state: StageState; startedAt?: string; finishedAt?: string; message?: string };
export type RunArtifact = { name: string; url: string; bytes: number; sha256: string };
export type LiveRun = {
  id: string; brief: string; status: 'running' | 'completed' | 'failed';
  createdAt: string; finishedAt?: string; stages: RunStage[];
  inspirationId?: string; conceptId?: string;
  projectId?: string;
  events: Array<{ stage: string; state: StageState; message: string; at: string }>;
  artifacts: RunArtifact[];
  report?: {
    ok: boolean; timingsMs?: Record<string, number>; error?: string;
    electrical?: { width: number; height: number; holes: number | Array<{x:number;y:number;diameter:number}> };
    fit?: { bboxMm: number[]; overlapMm3: number; negativeOverlapMm3: number; boardSha256: string; stepSha256: string; outcome: string };
    geometry?: {bboxMm:number[];solidCount:number;volumeMm3:number;stepSha256:string;boardSha256:string;scope:string};
    release?: { outcome: string; reason: string };
  };
  error?: string;
};
