import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { validateScenario } from './domain.js';
import { Orchestrator, execute, verify, persistOutcome } from './agents.js';
import { ClickHouseMCP, ClickHouseClient } from './mcp.js';
import { RunStore } from './store.js';

const store=new RunStore(); const orchestrator=new Orchestrator(store); const mcp=new ClickHouseMCP(); const ch=new ClickHouseClient();
const scenarioPath=path.join(config.root,'data','location-access-revoked.json');
const indexPath=path.join(config.root,'public','index.html');

function getCorsOrigin(reqOrigin){
  if(!reqOrigin) return config.corsOrigin || '*';
  if(config.corsOrigin === '*') return '*';
  const allowed = (config.corsOrigin || '').split(',').map(s=>s.trim()).filter(Boolean);
  if(allowed.includes(reqOrigin) || allowed.includes('*')) return reqOrigin;
  if(/\.vercel\.app$/i.test(reqOrigin) || /^http:\/\/localhost(:\d+)?$/i.test(reqOrigin)) return reqOrigin;
  return allowed[0] || config.corsOrigin || '*';
}

function send(res,status,data,type='application/json',reqOrigin=''){
  res.writeHead(status,{
    'content-type':type,
    'access-control-allow-origin':getCorsOrigin(reqOrigin),
    'access-control-allow-methods':'GET, POST, OPTIONS',
    'access-control-allow-headers':'Content-Type, X-CinePilot-Token, Authorization',
    'x-content-type-options':'nosniff',
    'x-frame-options':'DENY',
    'referrer-policy':'no-referrer',
    'cache-control':'no-store'
  });
  res.end(type==='application/json'?JSON.stringify(data):data);
}
async function body(req){let s='';for await(const c of req)s+=c;if(s.length>1_000_000)throw new Error('Payload too large');return s?JSON.parse(s):{}}
function auth(req){if(config.apiToken && req.headers['x-cinepilot-token']!==config.apiToken) throw Object.assign(new Error('Unauthorized'),{status:401})}
async function handler(req,res){
  const reply=(status,data,type='application/json')=>send(res,status,data,type,req.headers?.origin);
  try{
    if(req.method==='OPTIONS'){
      res.writeHead(204,{
        'access-control-allow-origin':getCorsOrigin(req.headers?.origin),
        'access-control-allow-methods':'GET, POST, OPTIONS',
        'access-control-allow-headers':'Content-Type, X-CinePilot-Token, Authorization',
        'access-control-max-age':'86400'
      });
      return res.end();
    }
    if(req.method==='GET'&&(req.url==='/healthz'||req.url==='/health')) return reply(200,{status:'ok',service:'cinepilot',version:'3.0.0',gemini_configured:Boolean(config.geminiApiKey||(config.project&&config.location)),mcp_configured:Boolean(config.mcpUrl||config.mcpCommand),clickhouse_configured:ch.configured});
    if(req.method==='GET'&&req.url==='/ready') {
      const isReady = ch.configured && Boolean(config.geminiApiKey || (config.project && config.location));
      return reply(isReady ? 200 : 503, {
        status: isReady ? 'ready' : 'starting',
        service: 'cinepilot',
        version: '3.0.0',
        gemini_configured: Boolean(config.geminiApiKey || (config.project && config.location)),
        mcp_configured: Boolean(config.mcpUrl || config.mcpCommand),
        clickhouse_configured: ch.configured
      });
    }
    if(req.method==='GET'&&req.url==='/') return reply(200,await fs.readFile(indexPath,'utf8'),'text/html; charset=utf-8');
    auth(req);
    if(req.method==='GET'&&req.url==='/api/scenario') return reply(200,JSON.parse(await fs.readFile(scenarioPath,'utf8')));
    if(req.method==='POST'&&req.url==='/api/runs') {const p=await body(req);const scenario=validateScenario(p.scenario);const run=await orchestrator.run(scenario,p.user_message||'');return reply(200,run)}
    const approve=req.url?.match(/^\/api\/runs\/([^/]+)\/approve$/);
    if(req.method==='POST'&&approve){const id=approve[1];const p=await body(req);const run=store.get(id);if(!run)return reply(404,{detail:'Run not found'});if(run.executed)return reply(409,{detail:'Run already executed'});if(p.run_id!==id)return reply(400,{detail:'Run id mismatch'});const plan=run.plans.find(x=>x.strategy===p.strategy);if(!plan)return reply(400,{detail:'Invalid strategy'});run.approved=true;run.approved_strategy=plan.strategy;run.events.push({id:cryptoRandom(),timestamp:new Date().toISOString(),agent:'producer',type:'approval.granted',message:`Producer approved ${plan.strategy}`});const result=execute(run,plan);run.executed=true;run.execution=result;run.events.push({id:cryptoRandom(),timestamp:new Date().toISOString(),agent:'execution',type:'execution.completed',message:'Internal production state updated',strategy:plan.strategy});run.verification=verify(run,plan,result);run.events.push({id:cryptoRandom(),timestamp:new Date().toISOString(),agent:'verification',type:'verification.completed',message:run.verification.status,verified:run.verification.verified});try{if(ch.configured){const outcomeResult=await persistOutcome(ch,run,plan,run.verification,run.events);run.outcome=outcomeResult;}else if(config.mcpUrl){await persistOutcome(mcp,run,plan,run.verification,run.events);run.events.push({id:cryptoRandom(),timestamp:new Date().toISOString(),agent:'clickhouse',type:'learning.persisted',message:'Outcome persisted through mcp-clickhouse'});}else{run.events.push({id:cryptoRandom(),timestamp:new Date().toISOString(),agent:'clickhouse',type:'learning.skipped',message:'Outcome persistence skipped because live ClickHouse is not configured'});}}catch(e){run.events.push({id:cryptoRandom(),timestamp:new Date().toISOString(),agent:'clickhouse',type:'learning.failed',message:`Outcome persistence failed: ${e.message}; recovery result retained`});}store.set(id,run);return reply(200,run)}
    const getOutcome=req.url?.match(/^\/api\/outcomes\/([^/?#]+)$/);
    if(req.method==='GET'&&getOutcome){
      if(!ch.configured) return reply(503,{detail:'ClickHouse Cloud HTTPS is not configured'});
      try{
        const outcome=await ch.getOutcomeByRunId(getOutcome[1]);
        return outcome?reply(200,{source:'clickhouse_https',outcome}):reply(404,{detail:'Outcome not found'});
      }catch(e){
        return reply(500,{detail:`Failed to retrieve outcome: ${e.message}`});
      }
    }
    if(req.method==='GET'&&req.url?.startsWith('/api/outcomes')){
      if(!ch.configured) return reply(200,{source:'unavailable',outcomes:[],detail:'ClickHouse Cloud HTTPS is not configured'});
      try{
        const outcomes=await ch.getRecentOutcomes(20);
        return reply(200,{source:'clickhouse_https',count:outcomes.length,outcomes});
      }catch(e){
        return reply(500,{detail:`Failed to retrieve outcomes: ${e.message}`});
      }
    }
    const get=req.url?.match(/^\/api\/runs\/([^/]+)$/); if(req.method==='GET'&&get){const run=store.get(get[1]);return run?reply(200,run):reply(404,{detail:'Run not found'})}
    return reply(404,{detail:'Not found'});
  }catch(e){const status=e.status|| (e.name==='SyntaxError'?400:500);console.error(e);return reply(status,{detail:status>=500?'Request failed. Check server logs.':e.message})}
}

function cryptoRandom(){return Math.random().toString(36).slice(2)+Date.now().toString(36)}
http.createServer(handler).listen(config.port,config.host,()=>console.log(`CinePilot AI V3 running at http://localhost:${config.port}`));
