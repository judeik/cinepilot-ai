import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

const csv = (v, fallback) => (v ? v.split(',').map(x => x.trim()).filter(Boolean) : fallback);
export const config = {
  root,
  port: Number(process.env.PORT || 8056),
  host: process.env.HOST || '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  apiToken: process.env.API_TOKEN || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  vertex: process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true',
  project: process.env.GOOGLE_CLOUD_PROJECT || '',
  location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
  vertexAccessToken: process.env.VERTEX_ACCESS_TOKEN || '',
  clickhouseUrl: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  clickhouseHost: process.env.CLICKHOUSE_HOST || 'localhost',
  clickhousePort: Number(process.env.CLICKHOUSE_PORT || 8443),
  clickhouseUser: process.env.CLICKHOUSE_USER || 'default',
  clickhousePassword: process.env.CLICKHOUSE_PASSWORD || '',
  clickhouseDatabase: process.env.CLICKHOUSE_DATABASE || 'default',
  clickhouseSecure: process.env.CLICKHOUSE_SECURE === 'true',
  mcpCommand: process.env.CLICKHOUSE_MCP_COMMAND || 'mcp-clickhouse',
  mcpArgs: csv(process.env.CLICKHOUSE_MCP_ARGS, []),
  mcpUrl: process.env.MCP_CLICKHOUSE_URL || '',
  mcpToken: process.env.MCP_CLICKHOUSE_TOKEN || '',
  requireLiveMcp: process.env.CINEPILOT_REQUIRE_LIVE_MCP === 'true'
};
