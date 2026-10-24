import { z } from 'zod';

export const ArtifactRef = z.object({
  id: z.string().min(1), revision: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), uri: z.string().min(1),
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;

export const PCBGeometry = z.object({
  artifact: ArtifactRef, units: z.literal('mm'), coordinateFrame: z.string().min(1),
  width: z.number().positive(), height: z.number().positive(), thickness: z.number().positive(),
  holes: z.array(z.object({ x: z.number(), y: z.number(), diameter: z.number().positive() })),
  geometryComplete: z.boolean(), unresolved: z.array(z.string()),
});

export type Artifact = ArtifactRef & { inputs: ArtifactRef[] };
export type Validation = { outcome: 'pass' | 'fail' | 'blocked'; checker: string; inputs: ArtifactRef[]; evidence: string[] };

export function staleDependents(artifacts: Artifact[], changedIds: string[]): string[] {
  const stale = new Set(changedIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const artifact of artifacts) {
      if (!stale.has(artifact.id) && artifact.inputs.some(input => stale.has(input.id))) {
        stale.add(artifact.id); expanded = true;
      }
    }
  }
  return [...stale].filter(id => !changedIds.includes(id));
}

export function acceptsValidation(validation: Validation, currentInputs: ArtifactRef[]): boolean {
  if (currentInputs.length === 0 || validation.outcome !== 'pass' || !validation.checker || validation.evidence.length === 0) return false;
  if (validation.inputs.length !== currentInputs.length) return false;
  return currentInputs.every(current => validation.inputs.some(tested => tested.id === current.id && tested.revision === current.revision && tested.sha256 === current.sha256));
}
