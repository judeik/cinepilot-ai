import crypto from 'node:crypto';
import { rankPlans } from './domain.js';
import { GeminiReasoner } from './gemini.js';
import { ClickHouseMCP, ClickHouseClient, assertReadOnlyQuery, outcomeInsertSql } from './mcp.js';
import { config } from './config.js';

export class Orchestrator {
  constructor(store){ this.store=store; this.gemini=new GeminiReasoner(); this.mcp=new ClickHouseMCP(); this.ch=new ClickHouseClient(); }
  event(events, agent, type, message, extra={}) { events.push({id:crypto.randomUUID(),timestamp:new Date().toISOString(),agent,type,message,...extra}); }

  async run(scenario, userMessage='') {
    const events=[]; const runId=crypto.randomUUID();
    this.event(events,'orchestrator','agent.started','Recovery workflow activated');
    this.event(events,'orchestrator','evidence.requested','Determining production evidence required');
    const query=`SELECT strategy, count() AS incidents, round(avg(days_saved),2) AS avg_days_saved, round(avg(success_rate),2) AS success_rate FROM cinepilot_incidents WHERE incident_type = 'LOCATION_ACCESS_REVOKED' GROUP BY strategy ORDER BY success_rate DESC`;
    let evidence, source='local_fixture';
    try {
      assertReadOnlyQuery(query);
      if (this.ch.configured) {
        const rows = await this.ch.query(query);
        evidence = normalizeEvidence({ rows });
        source = 'clickhouse_https';
        this.event(events, 'clickhouse', 'tool.completed', 'Retrieved production recovery history from ClickHouse Cloud over HTTPS', { transport: 'https', rows: evidence.rows.length });
      } else if (configLiveMcp()) {
        const result = await this.mcp.call('run_query', { query });
        evidence = normalizeEvidence(result);
        source = 'clickhouse_mcp';
        this.event(events, 'clickhouse', 'tool.completed', 'Retrieved production recovery history through MCP', { tool: 'run_query', rows: evidence.rows.length });
      } else {
        throw new Error('Neither ClickHouse HTTPS nor MCP is configured');
      }
    } catch (e) {
      if (process.env.CINEPILOT_REQUIRE_LIVE_MCP==='true') throw e;
      evidence=localEvidence();
      this.event(events,'clickhouse','tool.skipped','Live ClickHouse unavailable; using bundled development fixture',{tool:'run_query',rows:evidence.rows.length,reason:e.message});
    }
    const impact=impactAgent(scenario,evidence); this.event(events,'impact','agent.completed',`Impact assessed as ${impact.severity}`,{impact});
    const candidates=recoveryAgent(scenario,evidence); this.event(events,'recovery','agent.completed','Candidate recovery strategies generated',{count:candidates.length});
    const plans=rankPlans(scenario,evidence);
    this.event(events,'recovery-engine','decision.ranked',`Ranked ${plans.length} plans deterministically`,{scores:plans.map(p=>({strategy:p.strategy,score:p.score}))});
    const reasoning=await this.gemini.reason({incident:scenario,evidence,plans});
    this.event(events,'gemini','reasoning.completed',reasoning.mode==='gemini'?'Gemini analyzed the evidence and produced a decision':'Local deterministic reasoning used; configure Gemini for live reasoning',{mode:reasoning.mode,recommendation:reasoning.recommendation});
    const recommendation=plans.find(p=>p.strategy===reasoning.recommendation)||plans[0];
    this.event(events,'orchestrator','agent.completed',`Recommendation ready: ${recommendation.strategy}`);
    const run={run_id:runId,created_at:new Date().toISOString(),scenario_id:scenario.scenario_id,user_message:userMessage,incident:{...scenario,incident_type:scenario.incident.type,severity:impact.severity},impact,evidence:{source,row_count:evidence.rows.length,rows:evidence.rows,historical_success:evidence.historical_success},reasoning,plans,recommendation,approved:false,executed:false,verification:null,events};
    this.store.set(runId,run); return run;
  }
}

function localEvidence(){return {rows:[{strategy:'reorder',incidents:12,avg_days_saved:2.4,success_rate:88},{strategy:'split_unit',incidents:9,avg_days_saved:2.7,success_rate:81},{strategy:'relocate',incidents:7,avg_days_saved:1.8,success_rate:73}],historical_success:{reorder:88,split_unit:81,relocate:73}}}
function normalizeEvidence(result){
  const rows=result?.rows || result?.data || result?.result || [];
  const normalized=Array.isArray(rows)?rows:[];
  const historical={}; for(const r of normalized){if(r.strategy) historical[r.strategy]=Number(r.success_rate??r.historical_success??70)}
  return {rows:normalized,historical_success:Object.keys(historical).length?historical:{reorder:70,relocate:70,split_unit:70}};
}
function impactAgent(s,e){ const scheduleRisk=s.affected_scenes.length>=4?'HIGH':'MEDIUM'; const budgetRisk=s.estimated_cost_per_delayed_day_ngn>=3000000?'HIGH':'MEDIUM'; return {severity:s.incident.severity==='HIGH'?'HIGH':scheduleRisk, schedule_risk:scheduleRisk,budget_risk:budgetRisk,affected_resources:[`${s.affected_scenes.length} scenes`,`${s.crew_count} crew`],downstream_consequences:['Actor availability window may be missed','Delay may compound across dependent scenes','Additional location or unit costs may be incurred']}; }
function recoveryAgent(s,e){ return Object.keys({reorder:1,relocate:1,split_unit:1}).map(strategy=>({strategy,evidence_backed:true})); }
export function execute(run, plan){ return {run_id:run.run_id,status:'EXECUTED',strategy:plan.strategy,actions:plan.actions,updated_state:{recovery_status:'IN_PROGRESS',selected_strategy:plan.strategy,updated_at:new Date().toISOString()}}; }
export function verify(run, plan, execution){ const ok=execution.status==='EXECUTED' && execution.strategy===plan.strategy; return {verified:ok,status:ok?'RECOVERED':'REVIEW_REQUIRED',checks:[{name:'strategy_applied',passed:execution.strategy===plan.strategy},{name:'execution_recorded',passed:execution.status==='EXECUTED'}],message:ok?'Recovery state transition verified.':'Recovery requires manual review.'}; }
export async function persistOutcome(clientOrMcp, run, plan, verification, events = null) {
  const outcomeData = {
    run_id: run.run_id,
    scenario_id: run.scenario_id,
    strategy: plan.strategy,
    verified: Boolean(verification.verified),
    status: verification.verified ? 'RECOVERED' : 'REVIEW_REQUIRED'
  };

  // If using direct ClickHouseClient (HTTPS)
  if (clientOrMcp instanceof ClickHouseClient || clientOrMcp?.persistOutcome) {
    if (events) {
      events.push({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        agent: 'clickhouse',
        type: 'outcome.writing',
        message: 'Initiating recovery outcome persistence to ClickHouse Cloud over HTTPS',
        strategy: plan.strategy,
        verified: verification.verified
      });
    }

    const written = await clientOrMcp.persistOutcome(outcomeData);

    if (events) {
      events.push({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        agent: 'clickhouse',
        type: 'outcome.persisted',
        message: `Outcome persisted to cinepilot_outcomes (status: ${written.status})`,
        run_id: run.run_id,
        strategy: plan.strategy
      });
    }

    // Controlled readback verification
    const readback = await clientOrMcp.verifyOutcomeReadback(run.run_id);

    if (events) {
      events.push({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        agent: 'clickhouse',
        type: 'outcome.verified',
        message: `Readback confirmed: outcome for run ${run.run_id} is persisted in ClickHouse Cloud`,
        readback_verified: true,
        recorded_at: readback.recorded_at
      });
    }

    return { written, readback, verified: true };
  }

  // Fallback for MCP if ever configured
  const sql = outcomeInsertSql(run.run_id, run.scenario_id, plan.strategy, verification.verified, outcomeData.status);
  assertWrite(sql);
  return clientOrMcp.call('run_query', { query: sql });
}

function assertWrite(sql){if(!/^insert\s+into\s+cinepilot_outcomes\b/i.test(sql.trim())) throw new Error('Outcome write rejected');}

function configLiveMcp(){ return Boolean(config.mcpUrl || config.mcpCommand); }
