import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBoardService } from '../../server/board-api.js';
import { recordSchematicReview, schematicHash } from '../../src/blocks/review.js';
const evidence = resolve(process.argv[2]!),
  plan = JSON.parse(await readFile(resolve(evidence, 'plan.json'), 'utf8')),
  review = JSON.parse(await readFile(resolve(evidence, 'independent-review.json'), 'utf8'));
if (review.ok !== true) throw new Error('Independent review did not pass');
const hash = schematicHash(plan);
if (
  review.inputHash !== hash &&
  review.schematicHash !== hash &&
  review.planHash !== hash &&
  review.hash !== hash
)
  throw new Error('Review identity differs from current plan');
recordSchematicReview(plan, { by: review.by, findings: review.findings });
const service = createBoardService({ jobsRoot: resolve('var/board-jobs-test-chip'), allowSource: false });
try {
  const job = await service.submit({ plan });
  await writeFile(
    resolve(evidence, 'job-id.json'),
    JSON.stringify({ jobId: job.jobId, jobRoot: service.jobsRoot }, null, 2),
  );
  console.log('JOB', job.jobId);
  await service.idle();
  const done = await service.load(job.jobId);
  await writeFile(resolve(evidence, 'job.json'), JSON.stringify(done, null, 2));
  console.log(
    JSON.stringify({
      status: done?.status,
      error: done?.error,
      totalMs: done?.totalMs,
      gates: done?.gates?.map((g) => ({ gate: g.gate, ok: g.ok })),
      stages: done?.stages,
      board: done?.board,
    }),
  );
  if (done?.status !== 'done') process.exitCode = 2;
} finally {
  await service.close();
}
