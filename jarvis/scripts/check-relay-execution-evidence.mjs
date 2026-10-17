import {readFileSync} from 'node:fs';
import {validateEvidence, missingExecutionGates, summarizeCosts} from './lib/relay-execution-evidence.mjs';

// No network calls, live auth, host execution or configuration changes.
try {
  if (process.argv.length !== 3) throw Error('Usage: node scripts/check-relay-execution-evidence.mjs <evidence.json>');
  const evidence = validateEvidence(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  process.stdout.write(JSON.stringify({schemaValid: true, assessmentKind: 'metadata-consistency-only', hostExecutionVerified: false,
    sourceCommit: evidence.sourceCommit, harnessSha256: evidence.harnessSha256,
    assessments: evidence.cases.map(record => ({scenario: record.scenario, reportedScope: record.scope, reportedStatus: record.status,
      reportedLevel: record.level, missingExecutionGates: missingExecutionGates(record), costs: summarizeCosts(record.costs)}))}, null, 2) + '\n');
} catch (error) {
  // JSON parse errors can quote private input; emit only our own safe errors.
  process.stderr.write(error.message.startsWith('Invalid execution evidence') || error.message.startsWith('Usage:')
    ? error.message + '\n' : 'Evidence could not be read or parsed\n');
  process.exitCode = 1;
}
