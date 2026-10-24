export type InspirationConcept = { id: string; title: string; direction: string;
  status: 'pending' | 'running' | 'ready' | 'failed'; imageUrl?: string; error?: string };
export type InspirationSet = { id: string; brief: string; status: 'running' | 'completed' | 'failed';
  model: string; concepts: InspirationConcept[]; selectedId?: string; error?: string };
