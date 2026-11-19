import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REPOSITORY_ROOT,
  REVIEWED_IMPLEMENTATION_REVISION,
  calculateReviewedImplementationRevision,
} from "../src/execution/reviewed-scenarios";
import {
  IMPORTED_IMPLEMENTATION_REVISION,
  calculateImportedImplementationRevision,
} from "../src/adapter/imported-v1";

// Fails when a recorded implementation-review pin no longer matches the files it
// covers, so a stale pin fails `npm test` with the new value instead of failing a
// later suite with "incomplete". Updating a pin is a review decision (see
// docs/reuse-readiness.md); this script only reports.
const problems: string[] = [];

const reviewed = calculateReviewedImplementationRevision();
if (reviewed !== REVIEWED_IMPLEMENTATION_REVISION)
  problems.push(
    `REVIEWED_IMPLEMENTATION_REVISION (src/execution/reviewed-scenarios.ts) is ${REVIEWED_IMPLEMENTATION_REVISION}, files hash to ${reviewed}`,
  );

const imported = calculateImportedImplementationRevision();
if (imported !== IMPORTED_IMPLEMENTATION_REVISION)
  problems.push(
    `IMPORTED_IMPLEMENTATION_REVISION (src/adapter/imported-v1.ts) is ${IMPORTED_IMPLEMENTATION_REVISION}, files hash to ${imported}`,
  );

for (const fixture of ["v1-compatible.json", "v1-rejected.json"]) {
  const relative = path.join("fixtures/adapter", fixture);
  const parsed = JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, relative), "utf8"),
  ) as { approval?: { implementationRevision?: string } };
  if (
    parsed.approval?.implementationRevision !== REVIEWED_IMPLEMENTATION_REVISION
  )
    problems.push(
      `${relative} approval.implementationRevision differs from REVIEWED_IMPLEMENTATION_REVISION`,
    );
}

if (problems.length > 0) {
  process.stderr.write(
    `Review pins are stale:\n- ${problems.join("\n- ")}\nSee docs/reuse-readiness.md for the review steps.\n`,
  );
  process.exitCode = 1;
}
