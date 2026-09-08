import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

function parseMessage(line) {
  try { return JSON.parse(line); } catch { return null; }
}

export class ClickHouseMCP {
  constructor() { this.requestId = 0; }

  // Official mcp-clickhouse tool: run_query with argument key 'query'
  // Spec: mcp-clickhouse >=0.4.x — tool is 'run_query', input: { query: string }
  // Runs in read-only mode by default (CLICKHOUSE_ALLOW_WRITE_ACCESS=false unless overridden).
  async queryEvidence(sql) {
    const result = await this.call('run_query', { query: sql });
    // Result is typically { rows: [...] } or a text-wrapped JSON array
    return result;
  }

  async call(name, args) {
    if (config.mcpUrl) return this.httpCall(name, args);
    return this.stdioCall(name, args);
  }

  async httpCall(name, args) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (config.mcpToken) headers.authorization = `Bearer ${config.mcpToken}`;
    // Streamable HTTP MCP uses JSON-RPC requests. Session initialization is handled here per request for stateless servers.
    const endpoint = config.mcpUrl.endsWith('/mcp') ? config.mcpUrl : `${config.mcpUrl.replace(/\/$/, '')}/mcp`;
    let r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ jsonrpc:'2.0', id:++this.requestId, method:'initialize', params:{protocolVersion:'2025-03-26', capabilities:{}, clientInfo:{name:'cinepilot-ai',version:'3.0.0'}} }) });
    if (!r.ok) throw new Error(`MCP initialize failed (${r.status})`);
    const sessionId = r.headers.get('mcp-session-id');
    headers['mcp-session-id'] = sessionId || '';
    await fetch(endpoint, { method:'POST', headers, body: JSON.stringify({jsonrpc:'2.0', method:'notifications/initialized', params:{}}) });
    r = await fetch(endpoint, { method:'POST', headers, body: JSON.stringify({jsonrpc:'2.0', id:++this.requestId, method:'tools/call', params:{name, arguments:args}}) });
    if (!r.ok) throw new Error(`MCP tool failed (${r.status})`);
    const text = await r.text();
    const json = text.split(/\n/).map(parseMessage).find(x => x?.result || x?.error);
    if (!json) throw new Error('MCP returned no JSON-RPC result');
    if (json.error) throw new Error(json.error.message || 'MCP error');
    return unwrapMcpResult(json.result);
  }

  stdioCall(name, args) {
    return new Promise((resolve, reject) => {
      const mcpArgs = (config.mcpArgs || []).map(arg => {
        if (typeof arg === 'string' && arg.endsWith('.py') && !path.isAbsolute(arg)) {
          return path.resolve(config.root, arg);
        }
        return arg;
      });
      let command = config.mcpCommand;
      if (command === 'mcp-clickhouse' && process.platform === 'win32') {
        const localExe = path.join(config.root, 'scripts', 'mcp-clickhouse.exe');
        if (fs.existsSync(localExe)) command = localExe;
      }
      const child = spawn(command, mcpArgs, { cwd: config.root, env: { ...process.env, CLICKHOUSE_HOST: config.clickhouseHost, CLICKHOUSE_PORT: String(config.clickhousePort), CLICKHOUSE_USER: config.clickhouseUser, CLICKHOUSE_PASSWORD: config.clickhousePassword, CLICKHOUSE_DATABASE: config.clickhouseDatabase, CLICKHOUSE_SECURE: String(config.clickhouseSecure), CLICKHOUSE_VERIFY: 'true', CLICKHOUSE_ALLOW_WRITE_ACCESS: 'false', CLICKHOUSE_ALLOW_DROP: 'false' }, stdio:['pipe','pipe','pipe'] });
      let buffer=''; let initialized=false; const initId=++this.requestId; const callId=++this.requestId;
      const timer=setTimeout(()=>{child.kill();reject(new Error('MCP request timed out'));}, 30000);
      child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        const lines=buffer.split('\n'); buffer=lines.pop() || '';
        for (const line of lines) {
          const msg=parseMessage(line.trim()); if(!msg) continue;
          if(msg.id===initId){ initialized=true; child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n'); child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:callId,method:'tools/call',params:{name,arguments:args}})+'\n'); }
          else if(msg.id===callId){
            clearTimeout(timer);
            child.kill();
            if(msg.error) reject(new Error(msg.error.message||'MCP tool error'));
            else if(msg.result?.isError) {
              const errText = (msg.result.content||[]).map(x=>x.text).join(' ') || 'MCP tool error';
              reject(new Error(errText));
            }
            else resolve(unwrapMcpResult(msg.result));
          }
        }
      });
      child.stderr.on('data', ()=>{});
      child.on('error', e=>{clearTimeout(timer);reject(new Error(`Unable to start MCP server: ${e.message}`));});
      child.on('exit', code=>{if(!initialized){clearTimeout(timer);reject(new Error(`MCP server exited before initialize (code ${code})`));}});
      child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:initId,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'cinepilot-ai',version:'3.0.0'}}})+'\n');
    });
  }
}

function unwrapMcpResult(result) {
  if (result?.structuredContent?.result && typeof result.structuredContent.result === 'string') {
    try { return JSON.parse(result.structuredContent.result); } catch {}
  }
  if (result?.structuredContent && typeof result.structuredContent === 'object' && (result.structuredContent.rows || result.structuredContent.columns)) {
    return result.structuredContent;
  }
  const text = (result?.content || []).filter(x=>x.type==='text').map(x=>x.text).join('\n');
  if (!text) return result?.structuredContent || result || {};
  try { return JSON.parse(text); } catch { return { text }; }
}

export function assertReadOnlyQuery(sql) {
  const normalized=sql.trim().replace(/^\(+/,'').toLowerCase();
  if (!/^(select|with)\b/.test(normalized)) throw new Error('Only SELECT/WITH evidence queries are permitted.');
  if (/\b(drop|truncate|alter|delete|update|insert|create|grant|revoke|system)\b/i.test(normalized)) throw new Error('Unsafe SQL rejected.');
  return sql;
}

export function assertWrite(sql){
  if(!/^insert\s+into\s+cinepilot_outcomes\b/i.test(sql.trim())) throw new Error('Outcome write rejected');
  return sql;
}


export function outcomeInsertSql(runId, scenarioId, strategy, verified, status, recordedAt) {
  const safe = x => String(x).replaceAll('\\','\\\\').replaceAll("'", "\\'");
  const validStatus = status === 'RECOVERED' || status === 'REVIEW_REQUIRED' ? status : (verified ? 'RECOVERED' : 'REVIEW_REQUIRED');
  const timestamp = recordedAt ? `'${safe(recordedAt)}'` : 'now()';
  return `INSERT INTO cinepilot_outcomes (run_id, scenario_id, strategy, verified, status, recorded_at) VALUES ('${safe(runId)}','${safe(scenarioId)}','${safe(strategy)}',${verified ? 1:0},'${safe(validStatus)}',${timestamp})`;
}

export function validateOutcomePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid outcome payload: object required');
  const { run_id, scenario_id, strategy, verified, status } = payload;
  if (!run_id || typeof run_id !== 'string' || !run_id.trim()) throw new Error('Invalid outcome payload: run_id required');
  if (!scenario_id || typeof scenario_id !== 'string' || !scenario_id.trim()) throw new Error('Invalid outcome payload: scenario_id required');
  if (!strategy || typeof strategy !== 'string' || !strategy.trim()) throw new Error('Invalid outcome payload: strategy required');
  if (typeof verified !== 'boolean' && verified !== 0 && verified !== 1) throw new Error('Invalid outcome payload: verified must be boolean');
  const finalStatus = status || (Boolean(verified) ? 'RECOVERED' : 'REVIEW_REQUIRED');
  return {
    run_id: run_id.trim(),
    scenario_id: scenario_id.trim(),
    strategy: strategy.trim(),
    verified: Boolean(verified),
    status: finalStatus,
    recorded_at: payload.recorded_at || new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19)
  };
}

export class ClickHouseClient {
  get configured() {
    return Boolean(config.clickhouseHost && config.clickhousePassword);
  }

  async query(sql) {
    assertReadOnlyQuery(sql);
    return this._post(sql, true);
  }

  async persistOutcome(outcomeData) {
    const validated = validateOutcomePayload(outcomeData);
    const sql = outcomeInsertSql(validated.run_id, validated.scenario_id, validated.strategy, validated.verified, validated.status, validated.recorded_at);
    assertWrite(sql);
    await this._post(sql, false);
    return validated;
  }

  async verifyOutcomeReadback(runId) {
    if (!runId || typeof runId !== 'string') throw new Error('run_id required for outcome readback');
    const outcome = await this.getOutcomeByRunId(runId);
    if (!outcome) {
      throw new Error(`Outcome readback failed: run_id ${runId} not found in cinepilot_outcomes`);
    }
    return outcome;
  }

  async getRecentOutcomes(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const sql = `SELECT run_id, scenario_id, strategy, verified, status, toString(recorded_at) AS recorded_at FROM cinepilot_outcomes ORDER BY recorded_at DESC LIMIT ${safeLimit}`;
    return this.query(sql);
  }

  async getOutcomeByRunId(runId) {
    if (!runId || typeof runId !== 'string') throw new Error('run_id required');
    const safeId = runId.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
    const sql = `SELECT run_id, scenario_id, strategy, verified, status, toString(recorded_at) AS recorded_at FROM cinepilot_outcomes WHERE run_id = '${safeId}' ORDER BY recorded_at DESC LIMIT 1`;
    const rows = await this.query(sql);
    return rows?.[0] || null;
  }


  async _post(sql, parseJson = true) {
    const host = config.clickhouseHost;
    const port = config.clickhousePort || 8443;
    const user = config.clickhouseUser || 'default';
    const password = config.clickhousePassword || '';
    const database = config.clickhouseDatabase || 'default';
    const proto = config.clickhouseSecure || port === 8443 ? 'https' : 'http';
    const formatParam = parseJson ? '&default_format=JSONEachRow' : '';
    const url = `${proto}://${host}:${port}/?database=${encodeURIComponent(database)}${formatParam}`;

    const headers = {
      'X-ClickHouse-User': user,
      'X-ClickHouse-Key': password
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: sql
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`ClickHouse HTTPS request failed (${res.status}): ${errText.slice(0, 160)}`);
    }

    const text = await res.text();
    if (!parseJson || !text.trim()) return [];
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }
}
