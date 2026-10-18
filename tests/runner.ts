/**
 * Main executable E2E Test Runner entrypoint for 星伴 Platform.
 * Imports and executes Tier 1 Feature Coverage and Tier 2 Boundary test suites.
 */

import { runner } from './helpers/test-runner';
import { registerRoleplayMarkupTests } from './unit-rp-markup.test';
import { registerTier1Tests } from './tier1-feature-coverage.test';
import { registerTier2Tests } from './tier2-boundary-corner.test';
import { registerTier3Tests } from './tier3-cross-feature.test';
import { registerTier4Tests } from './tier4-real-world.test';

async function main() {
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
  console.log(`\x1b[34m[INFO] Target Test Server Base URL: ${baseUrl}\x1b[0m`);

  // Register all 4 test suites
  // Pure-function cover runs first; it needs no server, so a failure here points at the
  // parser rather than the environment.
  registerRoleplayMarkupTests();
  registerTier1Tests();
  registerTier2Tests();
  registerTier3Tests();
  registerTier4Tests();

  // Execute test run
  const summary = await runner.runAll();

  // Exit code based on test outcome
  if (summary.failed > 0) {
    console.error(`\x1b[31m[FAILURE] ${summary.failed} test(s) failed out of ${summary.total} total tests.\x1b[0m`);
    process.exit(1);
  } else {
    console.log(`\x1b[32m[SUCCESS] All ${summary.passed} test(s) passed successfully!\x1b[0m`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('\x1b[31m[FATAL] Test runner encountered unexpected error:\x1b[0m', err);
  process.exit(1);
});
