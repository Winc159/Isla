import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const { HUMAN_RUBRIC, buildMarkdownReport, evaluateReleaseGate, loadFixtures, redactPublicText, scoreAssessment, summarizeTestOutput, validateFixture, validateFixtureSelection } = await import('../../scripts/evaluation-lib.mjs');
const { validatePackageFiles } = await import('../../scripts/package-lib.mjs');

describe('offline evaluation contracts', () => {
  it('loads the fixed, stable, synthetic fixture set', async () => {
    const fixtures = await loadFixtures(resolve(root, 'evaluation/fixtures'), root);
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    expect(fixtures.map(fixture => fixture.id)).toEqual([...fixtures.map(fixture => fixture.id)].sort((a, b) => a.localeCompare(b, 'en')));
    expect(fixtures.every(fixture => fixture.network === 'local-test-only' && fixture.workspace.kind === 'test-managed' && fixture.workspace.seed === 'synthetic')).toBe(true);
  });

  it('rejects missing fields, unsafe test paths, arbitrary commands and unsupported schemas', () => {
    const fixture = {
      schemaVersion: 1, id: 'test.fixture', capability: 'test', prompt: 'do the test',
      workspace: { kind: 'test-managed', seed: 'synthetic' }, network: 'local-test-only', timeoutMs: 1000,
      expectedApprovals: [], expectedFacts: ['fact'],
      contractTests: { files: ['tests/core/session.test.ts'], namePattern: 'test' },
      gateClass: 'behavior', rubricProfile: 'agent-task-v1', cleanup: 'test-managed-cleanup',
    };
    expect(validateFixture(fixture).id).toBe(fixture.id);
    expect(() => validateFixture({ ...fixture, schemaVersion: 2 })).toThrow('FIXTURE_SCHEMA_VERSION_UNSUPPORTED');
    expect(() => validateFixture({ ...fixture, contractTests: { files: ['../../run.ps1'], namePattern: 'x' } })).toThrow('FIXTURE_TEST_PATH_INVALID');
    expect(() => validateFixture({ ...fixture, command: 'whoami' })).toThrow('FIXTURE_UNKNOWN_FIELD');
    expect(() => validateFixture({ ...fixture, expectedFacts: [] })).toThrow('FIXTURE_EXPECTED_FACTS_INVALID');
  });

  it('rejects unknown and duplicate fixture selection', async () => {
    const fixtures = await loadFixtures(resolve(root, 'evaluation/fixtures'), root);
    expect(() => validateFixtureSelection(fixtures, ['unknown'])).toThrow('FIXTURE_UNKNOWN');
    expect(() => validateFixtureSelection(fixtures, [fixtures[0]!.id, fixtures[0]!.id])).toThrow('FIXTURE_SELECTION_DUPLICATE');
  });

  it('redacts synthetic credentials, bearer values, personal paths and transcript-like text', () => {
    const raw = 'api_key=sk-12345678901234567890 Authorization: Bearer eyJabcdefghijklmno.abcdefghijklmno.abcdefghijklmno Cookie: session=private C:\\Users\\Alice\\secret.txt /home/alice/private.txt';
    const safe = redactPublicText(raw, root);
    expect(safe).not.toContain('sk-12345678901234567890');
    expect(safe).not.toContain('eyJabcdefghijklmno');
    expect(safe).not.toContain('C:\\Users\\Alice');
    expect(safe).not.toContain('/home/alice');
  });

  it('scores only complete human rubric assessments with bounded integer values', () => {
    const maximum = Object.fromEntries(HUMAN_RUBRIC.map(item => [item.id, item.weight]));
    expect(scoreAssessment(maximum)).toBe(100);
    expect(() => scoreAssessment({ goal: 30 })).toThrow('ASSESSMENT_CRITERIA_MISMATCH');
    expect(() => scoreAssessment({ ...maximum, safety: 11 })).toThrow('ASSESSMENT_SCORE_OUT_OF_RANGE');
  });

  it('fails closed on offline failures, hard vetoes and incomplete real scenario assessments', () => {
    expect(evaluateReleaseGate({ offlineResults: [{ status: 'passed' }], hardVetoes: [] }).passed).toBe(false);
    expect(evaluateReleaseGate({ offlineResults: [{ status: 'passed' }], scenarioRuns: [], assessments: [], hardVetoes: ['secret-leak'] }).failures).toContain('SAFETY_HARD_VETO');
    const ids = ['coding.inspect-change-verify', 'research.source-verification', 'plan.approval-act'];
    const scenarioRuns = ids.flatMap(fixtureId => [1, 2, 3].map(attempt => ({ fixtureId, attempt, deterministicPassed: true })));
    const assessments = ids.flatMap(fixtureId => [1, 2, 3].map(attempt => ({ fixtureId, attempt, score: attempt < 3 ? 95 : 80, evidence: 'reviewed output and test evidence' })));
    expect(evaluateReleaseGate({ offlineResults: [{ status: 'passed' }], scenarioRuns, assessments, hardVetoes: [] }).passed).toBe(true);
    const duplicateAttempts = [scenarioRuns[0]!, { ...scenarioRuns[1]!, attempt: 1 }, scenarioRuns[2]!];
    expect(evaluateReleaseGate({ offlineResults: [{ status: 'passed' }], scenarioRuns: duplicateAttempts, assessments, hardVetoes: [] }).failures).toContain('REAL_SCENARIO_EVIDENCE_INCOMPLETE:coding.inspect-change-verify');
  });

  it('summarizes tests deterministically and distinguishes offline from real-model results', () => {
    expect(summarizeTestOutput('\u001b[2mTests \u001b[22m2 passed | 1 failed | 3 skipped')).toEqual({ passed: 2, failed: 1, skipped: 3 });
    const report = buildMarkdownReport({ runId: 'run', revision: { commit: 'abc123', dirty: false }, environment: { node: '24', platform: 'win32', arch: 'x64' }, gate: { status: 'passed' }, fixtures: [{ id: 'fixture', capability: 'capability', status: 'passed', durationMs: 1, safetyChecks: 0 }] });
    expect(report).toContain('Real-model assessment: **not run**');
    expect(report).toContain('does not imply a real-model release pass');
  });

  it('rejects evaluation data, scripts and other files from the npm package', () => {
    expect(validatePackageFiles(['package.json', 'README.md', 'LICENSE', 'dist/entrypoints/cli.js']).passed).toBe(true);
    const result = validatePackageFiles(['package.json', 'README.md', 'LICENSE', 'dist/cli.js', 'evaluation/fixtures/private.json']);
    expect(result.passed).toBe(false);
    expect(result.unexpected).toContain('evaluation/fixtures/private.json');
  });
});
