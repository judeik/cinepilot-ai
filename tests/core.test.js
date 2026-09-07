import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPlans, validateScenario } from '../src/domain.js';
import { assertReadOnlyQuery } from '../src/mcp.js';
import { execute, verify } from '../src/agents.js';

const scenario={scenario_id:'x',production:'Test',shoot_day:1,incident:{type:'LOCATION_ACCESS_REVOKED',severity:'HIGH'},affected_scenes:[1,2,3,4],crew_count:38,lead_actor_available_until:'18:00',estimated_cost_per_delayed_day_ngn:3200000};
test('validates golden path scenario',()=>assert.equal(validateScenario(scenario).scenario_id,'x'));
test('ranks recovery plans deterministically',()=>{const p=rankPlans(scenario,{historical_success:{reorder:88,relocate:73,split_unit:81},rows:[]});assert.equal(p.length,3);assert.equal(p[0].strategy,'reorder');assert.ok(p[0].score>p[1].score)});
test('rejects unsafe evidence SQL',()=>assert.throws(()=>assertReadOnlyQuery('DROP TABLE cinepilot_incidents')));
test('accepts evidence SQL',()=>assert.equal(assertReadOnlyQuery('SELECT * FROM cinepilot_incidents'),'SELECT * FROM cinepilot_incidents'));
test('execution and verification are real state transitions',()=>{const run={run_id:'r'};const plan={strategy:'reorder',actions:['reorder']};const result=execute(run,plan);assert.equal(result.status,'EXECUTED');assert.equal(verify(run,plan,result).verified,true)});

test('GeminiReasoner rejects schema missing required fields or invalid strategy', async () => {
  const { GeminiReasoner } = await import('../src/gemini.js');
  const reasoner = new GeminiReasoner();
  const plans = [{ strategy: 'reorder' }, { strategy: 'relocate' }];

  // Mock generator returning various invalid outputs
  const testInvalid = async (mockResponse) => {
    reasoner.generate = async () => mockResponse;
    await assert.rejects(
      () => reasoner.reason({ incident: scenario, evidence: { rows: [] }, plans }),
      { message: 'Gemini returned an invalid decision schema.' }
    );
  };

  // Malformed JSON / arbitrary text
  await testInvalid('not json at all');
  // Missing summary
  await testInvalid(JSON.stringify({ recommendation: 'reorder', risks: 'low', expected_outcome: 'save days' }));
  // Missing risks
  await testInvalid(JSON.stringify({ summary: 'ok', recommendation: 'reorder', expected_outcome: 'save days' }));
  // Missing expected_outcome
  await testInvalid(JSON.stringify({ summary: 'ok', recommendation: 'reorder', risks: 'low' }));
  // Unknown recommendation not in candidate plans
  await testInvalid(JSON.stringify({ summary: 'ok', recommendation: 'cancel_shoot', risks: 'high', expected_outcome: 'lost day' }));
});

test('GeminiReasoner accepts valid recommendation with matching or case-insensitive strategy', async () => {
  const { GeminiReasoner } = await import('../src/gemini.js');
  const reasoner = new GeminiReasoner();
  const plans = [{ strategy: 'reorder' }, { strategy: 'relocate' }];

  reasoner.generate = async () => JSON.stringify({
    summary: 'Incident analyzed',
    recommendation: 'REORDER',
    risks: 'Minor rescheduling friction',
    expected_outcome: 'Days saved'
  });

  const res = await reasoner.reason({ incident: scenario, evidence: { rows: [] }, plans });
  assert.equal(res.mode, 'gemini');
  assert.equal(res.recommendation, 'reorder');
  assert.equal(res.summary, 'Incident analyzed');
});

test('GeminiReasoner falls back to deterministic mode on upstream network or API error', async () => {
  const { GeminiReasoner } = await import('../src/gemini.js');
  const reasoner = new GeminiReasoner();
  const plans = [{ strategy: 'reorder' }, { strategy: 'relocate' }];

  reasoner.generate = async () => { throw new Error('Gemini request failed (503)'); };

  const res = await reasoner.reason({ incident: scenario, evidence: { rows: [] }, plans });
  assert.equal(res.mode, 'deterministic-fallback');
  assert.equal(res.recommendation, 'reorder');
  assert.match(res.summary, /Gemini API temporarily unavailable/);
});


test('ClickHouseClient enforces read-only query assertion', async () => {
  const { ClickHouseClient } = await import('../src/mcp.js');
  const client = new ClickHouseClient();
  await assert.rejects(
    () => client.query('DROP TABLE cinepilot_incidents'),
    { message: 'Only SELECT/WITH evidence queries are permitted.' }
  );
  await assert.rejects(
    () => client.query('SELECT * FROM cinepilot_incidents; DROP TABLE cinepilot_incidents'),
    { message: 'Unsafe SQL rejected.' }
  );
});

test('validateOutcomePayload validates required outcome fields', async () => {
  const { validateOutcomePayload } = await import('../src/mcp.js');

  assert.throws(() => validateOutcomePayload(null), /object required/);
  assert.throws(() => validateOutcomePayload({}), /run_id required/);
  assert.throws(() => validateOutcomePayload({ run_id: 'r1' }), /scenario_id required/);
  assert.throws(() => validateOutcomePayload({ run_id: 'r1', scenario_id: 's1' }), /strategy required/);
  assert.throws(() => validateOutcomePayload({ run_id: 'r1', scenario_id: 's1', strategy: 'reorder', verified: 'not_bool' }), /verified must be boolean/);

  const valid = validateOutcomePayload({
    run_id: 'run-123',
    scenario_id: 'scen-456',
    strategy: 'reorder',
    verified: true
  });
  assert.equal(valid.run_id, 'run-123');
  assert.equal(valid.scenario_id, 'scen-456');
  assert.equal(valid.strategy, 'reorder');
  assert.equal(valid.verified, true);
  assert.equal(valid.status, 'RECOVERED');
  assert.ok(valid.recorded_at);
});

test('persistOutcome persists and verifies outcome with ClickHouseClient mock', async () => {
  const { persistOutcome } = await import('../src/agents.js');
  const events = [];
  const run = { run_id: 'mock-run-001', scenario_id: 'mock-scen-001' };
  const plan = { strategy: 'reorder' };
  const verification = { verified: true };

  let persistedData = null;
  const mockClient = {
    async persistOutcome(data) {
      persistedData = data;
      return data;
    },
    async verifyOutcomeReadback(runId) {
      assert.equal(runId, run.run_id);
      return { run_id: runId, strategy: plan.strategy, verified: 1, status: 'RECOVERED', recorded_at: '2026-09-07 15:00:00' };
    }
  };

  const result = await persistOutcome(mockClient, run, plan, verification, events);
  assert.equal(result.verified, true);
  assert.equal(persistedData.run_id, 'mock-run-001');
  assert.equal(events.some(e => e.type === 'outcome.writing'), true);
  assert.equal(events.some(e => e.type === 'outcome.persisted'), true);
  assert.equal(events.some(e => e.type === 'outcome.verified'), true);
});

test('persistOutcome handles write/readback failure gracefully without crashing', async () => {
  const { persistOutcome } = await import('../src/agents.js');
  const events = [];
  const run = { run_id: 'mock-run-fail', scenario_id: 'mock-scen-fail' };
  const plan = { strategy: 'reorder' };
  const verification = { verified: true };

  const failingClient = {
    async persistOutcome() {
      throw new Error('Database connection failed');
    },
    async verifyOutcomeReadback() {}
  };

  await assert.rejects(
    () => persistOutcome(failingClient, run, plan, verification, events),
    /Database connection failed/
  );
  assert.equal(events.some(e => e.type === 'outcome.writing'), true);
});

test('ClickHouseClient.getRecentOutcomes generates valid query and limits correctly', async () => {
  const { ClickHouseClient } = await import('../src/mcp.js');
  const client = new ClickHouseClient();
  let capturedSql = null;
  client.query = async (sql) => {
    capturedSql = sql;
    return [{ run_id: 'r1', scenario_id: 's1', strategy: 'reorder', verified: 1, status: 'RECOVERED', recorded_at: '2026-09-07 15:00:00' }];
  };

  const results = await client.getRecentOutcomes(10);
  assert.equal(results.length, 1);
  assert.match(capturedSql, /SELECT run_id, scenario_id, strategy, verified, status, toString\(recorded_at\) AS recorded_at FROM cinepilot_outcomes ORDER BY recorded_at DESC LIMIT 10/);
});

test('ClickHouseClient.getOutcomeByRunId generates sanitized query and returns row or null', async () => {
  const { ClickHouseClient } = await import('../src/mcp.js');
  const client = new ClickHouseClient();
  let capturedSql = null;
  client.query = async (sql) => {
    capturedSql = sql;
    if (sql.includes('valid-run')) {
      return [{ run_id: 'valid-run', strategy: 'reorder' }];
    }
    return [];
  };

  const found = await client.getOutcomeByRunId('valid-run');
  assert.equal(found.run_id, 'valid-run');
  assert.match(capturedSql, /WHERE run_id = 'valid-run'/);

  const notFound = await client.getOutcomeByRunId('missing-run');
  assert.equal(notFound, null);

  await assert.rejects(() => client.getOutcomeByRunId(''), /run_id required/);
});

test('ClickHouseClient.verifyOutcomeReadback throws if row is missing', async () => {
  const { ClickHouseClient } = await import('../src/mcp.js');
  const client = new ClickHouseClient();
  client.getOutcomeByRunId = async () => null;

  await assert.rejects(
    () => client.verifyOutcomeReadback('non-existent-run'),
    /Outcome readback failed: run_id non-existent-run not found in cinepilot_outcomes/
  );
});
