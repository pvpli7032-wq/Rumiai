/**
 * Lightweight, self-contained TypeScript test runner harness and assertion library.
 */

export class AssertionError extends Error {
  public actual?: any;
  public expected?: any;

  constructor(message: string, actual?: any, expected?: any) {
    super(message);
    this.name = 'AssertionError';
    this.actual = actual;
    this.expected = expected;
  }
}

export function assertOk(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message || `Expected condition to be truthy, received: ${condition}`, condition, true);
  }
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new AssertionError(
      message || `Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`,
      actual,
      expected
    );
  }
}

export function assertDeepEquals<T>(actual: T, expected: T, message?: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new AssertionError(
      message || `Deep equality assertion failed.\nExpected: ${expectedStr}\nActual:   ${actualStr}`,
      actual,
      expected
    );
  }
}

export async function assertThrows(
  fn: () => any | Promise<any>,
  message?: string
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
  }
  if (!threw) {
    throw new AssertionError(message || 'Expected function to throw an error, but it executed without throwing.');
  }
}

export async function assertStatus(
  response: Response,
  expectedStatus: number | number[],
  message?: string
): Promise<void> {
  const expectedList = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expectedList.includes(response.status)) {
    let bodyPreview = '';
    try {
      const clone = response.clone();
      bodyPreview = (await clone.text()).substring(0, 300);
    } catch {
      // Ignore clone failure
    }
    throw new AssertionError(
      message || `Expected HTTP status ${expectedList.join(' or ')}, but received ${response.status}. Body: ${bodyPreview}`,
      response.status,
      expectedStatus
    );
  }
}

export interface TestCase {
  name: string;
  suite: string;
  fn: () => void | Promise<void>;
}

export interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: Error;
}

export interface SuiteSummary {
  name: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
}

export interface TestRunSummary {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  suites: SuiteSummary[];
  results: TestResult[];
}

export class TestRunner {
  private currentSuite = 'Default Suite';
  private tests: TestCase[] = [];

  public describe(suiteName: string, fn: () => void): void {
    const previousSuite = this.currentSuite;
    this.currentSuite = suiteName;
    try {
      fn();
    } finally {
      this.currentSuite = previousSuite;
    }
  }

  public test(testName: string, fn: () => void | Promise<void>): void {
    this.tests.push({
      name: testName,
      suite: this.currentSuite,
      fn,
    });
  }

  public async runAll(): Promise<TestRunSummary> {
    const startTime = Date.now();
    const results: TestResult[] = [];
    const suiteMap = new Map<string, SuiteSummary>();

    console.log('\n==================================================');
    console.log('         KHUI AI E2E TEST RUNNER HARNESS          ');
    console.log('==================================================\n');

    let currentGroup = '';

    for (const t of this.tests) {
      if (t.suite !== currentGroup) {
        currentGroup = t.suite;
        console.log(`\n\x1b[36m[SUITE] ${currentGroup}\x1b[0m`);
      }

      if (!suiteMap.has(t.suite)) {
        suiteMap.set(t.suite, {
          name: t.suite,
          total: 0,
          passed: 0,
          failed: 0,
          durationMs: 0,
        });
      }

      const suiteSummary = suiteMap.get(t.suite)!;
      suiteSummary.total++;

      const testStart = Date.now();
      try {
        await t.fn();
        const duration = Date.now() - testStart;
        suiteSummary.passed++;
        suiteSummary.durationMs += duration;
        results.push({
          suite: t.suite,
          name: t.name,
          passed: true,
          durationMs: duration,
        });
        console.log(`  \x1b[32m✔\x1b[0m ${t.name} \x1b[90m(${duration}ms)\x1b[0m`);
      } catch (err: any) {
        const duration = Date.now() - testStart;
        suiteSummary.failed++;
        suiteSummary.durationMs += duration;
        const error = err instanceof Error ? err : new Error(String(err));
        results.push({
          suite: t.suite,
          name: t.name,
          passed: false,
          durationMs: duration,
          error,
        });
        console.log(`  \x1b[31m✖\x1b[0m ${t.name} \x1b[90m(${duration}ms)\x1b[0m`);
        console.log(`    \x1b[31mError: ${error.message}\x1b[0m`);
      }
    }

    const totalDuration = Date.now() - startTime;
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    console.log('\n==================================================');
    console.log('                TEST RUN SUMMARY                  ');
    console.log('==================================================');
    console.log(`Total Suites:  ${suiteMap.size}`);
    console.log(`Total Tests:   ${total}`);
    console.log(`Passed:        \x1b[32m${passed}\x1b[0m`);
    console.log(`Failed:        ${failed > 0 ? `\x1b[31m${failed}\x1b[0m` : '0'}`);
    console.log(`Duration:      ${totalDuration}ms`);
    console.log('==================================================\n');

    return {
      total,
      passed,
      failed,
      durationMs: totalDuration,
      suites: Array.from(suiteMap.values()),
      results,
    };
  }
}

// Global runner instance helpers for concise syntax
export const runner = new TestRunner();

export function describe(suiteName: string, fn: () => void): void {
  runner.describe(suiteName, fn);
}

export function test(testName: string, fn: () => void | Promise<void>): void {
  runner.test(testName, fn);
}
