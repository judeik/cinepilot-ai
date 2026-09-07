# CinePilot AI V3 — Production Recovery Command Center

CinePilot converts a production disruption into an evidence-backed recovery decision: **Evidence → Reasoning → Decision → Action → Verification**.

## 60-second local start

Requirements: **Node.js 20.11+**.

```bash
npm install
npm run dev
```

Open **http://localhost:8080**. The bundled Golden Path is functional without external credentials.

## What works locally

- Production Command Center UI
- Golden Path scenario
- Orchestrator workflow
- Impact assessment
- Recovery strategy generation
- Deterministic ranking using 35/25/20/10/10 weights
- Producer approval
- Execution state transition
- Verification
- Runtime audit timeline
- Unit tests

## Live Gemini

Copy `.env.example` to `.env` and set `GEMINI_API_KEY`. CinePilot then sends the incident, evidence and candidate plans to Gemini and validates the returned JSON decision before accepting it.

## Live ClickHouse + official MCP

The application contains an MCP client for the official ClickHouse MCP server. Configure either:

```text
MCP_CLICKHOUSE_URL=https://your-mcp-host/mcp
MCP_CLICKHOUSE_TOKEN=...
```

or a local executable:

```text
CLICKHOUSE_MCP_COMMAND=mcp-clickhouse
CLICKHOUSE_MCP_ARGS=
CLICKHOUSE_HOST=...
CLICKHOUSE_PORT=8443
CLICKHOUSE_USER=...
CLICKHOUSE_PASSWORD=...
CLICKHOUSE_DATABASE=...
```

Install/configure the official `mcp-clickhouse` release according to its upstream documentation. The app calls the MCP `run_query` tool for evidence and, when remote MCP is configured, persists verified outcomes with a controlled INSERT.

For local ClickHouse infrastructure:

```bash
docker compose up -d clickhouse
```

The seed schema is in `scripts/clickhouse-init.sql`.

## Security

- No secrets are stored in source code.
- Optional `X-CinePilot-Token` protects API routes.
- Evidence SQL is limited to SELECT/WITH.
- Outcome writes use a controlled INSERT shape.
- Request payloads are size-limited.
- External Gemini output is schema-validated before becoming a decision.
- Destructive SQL is rejected.

For production, put Gemini/MCP credentials in Google Secret Manager or another managed secret store.

## Tests

```bash
npm test
npm run check
npm run build
```

## Production / Cloud Run

```bash
export PROJECT_ID=your-gcp-project
export REGION=europe-west1
./gcp/deploy.sh
```

Inject production secrets through Cloud Run/Secret Manager rather than `.env`.

## Hackathon Golden Path

1. Load the location-access-revoked scenario.
2. Orchestrator requests evidence.
3. ClickHouse MCP supplies production-history evidence when configured.
4. Impact Agent assesses severity and consequences.
5. Recovery Agent proposes alternatives.
6. Deterministic engine ranks candidates.
7. Gemini explains the evidence-backed decision when configured.
8. Producer approves.
9. Execution updates internal production state.
10. Verification confirms the transition.
11. Outcome is persisted through MCP when live MCP is configured.

The UI renders events returned by the runtime. It does not manufacture fake agent activity.

## License

MIT.
