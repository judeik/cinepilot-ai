import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
for(const f of ['src/server.js','src/domain.js','src/agents.js','src/gemini.js','src/mcp.js','src/store.js','src/config.js']){if(!fs.existsSync(path.join(root,f)))throw new Error(`Missing ${f}`)}
console.log('CinePilot build validation passed. Runtime uses Node.js built-ins; no compile step is required.');
