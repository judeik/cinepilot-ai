# CinePilot AI V3 — Render + Vercel Production Deployment Guide

## 1. Architecture Overview

CinePilot AI V3 operates with a decoupled public frontend and long-running execution backend:

```
Producer / Judge Browser
         │
         ▼ HTTPS
Vercel Edge Network
   (public/index.html — Command Center UI)
         │
         │ API Fetch & Warm-Up (/ready, /api/runs)
         ▼ HTTPS
Render Web Service
   (cinepilot-ai — Docker: Node.js 20 + Python 3.10)
         │
         ├──► Google Gemini (gemini-3.6-flash via @google/genai)
         │       Server-side AI trade-off analysis & structured recommendations
         │
         ├──► child_process.spawn()
         │       Official mcp-clickhouse 0.6.0 (stdio JSON-RPC 2.0)
         │       └──► ClickHouse Cloud TLS (cinepilot_incidents evidence read)
         │
         └──► ClickHouse Cloud HTTPS (cinepilot_outcomes persistence & readback)
```

---

## 2. Infrastructure Roles

### Vercel (Frontend / Public Web Experience)
* Serves the static command center (`public/index.html`).
* Provides rapid global CDN distribution for the user interface.
* Uses `vercel.json` rewrites to proxy `/api/*`, `/health`, `/healthz`, and `/ready` to the Render backend, preventing browser CORS issues.
* Contains **zero secrets**: neither `GEMINI_API_KEY`, `CLICKHOUSE_PASSWORD`, nor any cloud credentials are ever placed in Vercel environment variables.

### Render (Backend API + Official ClickHouse MCP Runtime)
* Runs the dual-runtime Linux container (`Dockerfile`).
* Houses the Node.js API orchestrator and the Python 3 environment running `mcp-clickhouse==0.6.0`.
* Injects dynamic `PORT=8080` and binds to `0.0.0.0`.
* Manages server-side secret environment variables (`GEMINI_API_KEY`, `CLICKHOUSE_PASSWORD`).

### ClickHouse Cloud
* Hosted on AWS (`eu-central-1`).
* Enforces TLS with certificate verification (`CLICKHOUSE_SECURE=true`, `CLICKHOUSE_VERIFY=true`).
* Read-only evidence retrieval via `mcp-clickhouse 0.6.0` (`CLICKHOUSE_ALLOW_WRITE_ACCESS=false`).
* Strict HTTPS outcome persistence and readback verification.

### Google Gemini
* Powered by `gemini-3.6-flash` via official `@google/genai`.
* Generates structured decision schemas over operational evidence.
* Strictly server-side; calls never originate from the client browser.

---

## 3. Environment Configuration

### Render Backend Variables

| Variable | Recommended Value | Secret? | Description |
|---|---|---|---|
| `NODE_ENV` | `production` | No | Enables production runtime mode |
| `HOST` | `0.0.0.0` | No | Binds all network interfaces |
| `PORT` | `8080` | No | Injected dynamically by Render |
| `CORS_ORIGIN` | `*` (or specific Vercel URL) | No | Allowed frontend origins |
| `CLICKHOUSE_HOST` | `gibzmvxu0x.eu-central-1.aws.clickhouse.cloud` | No | ClickHouse Cloud endpoint |
| `CLICKHOUSE_PORT` | `8443` | No | Secure HTTPS / TLS port |
| `CLICKHOUSE_USER` | `default` | No | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | `<Render Secret>` | **YES** | ClickHouse database password |
| `CLICKHOUSE_DATABASE` | `default` | No | Database name |
| `CLICKHOUSE_SECURE` | `true` | No | Forces TLS |
| `CLICKHOUSE_VERIFY` | `true` | No | Forces SSL certificate verification |
| `CLICKHOUSE_MCP_COMMAND` | `mcp-clickhouse` | No | Invokes official MCP package |
| `CLICKHOUSE_ALLOW_WRITE_ACCESS`| `false` | No | Enforces read-only MCP access |
| `CINEPILOT_REQUIRE_LIVE_MCP` | `true` | No | Fails fast if MCP is unavailable |
| `GEMINI_MODEL` | `gemini-3.6-flash` | No | Target Gemini model |
| `GEMINI_API_KEY` | `<Render Secret>` | **YES** | Google AI Studio / Gemini API Key |
| `GOOGLE_GENAI_USE_VERTEXAI` | `false` | No | Set true only when Vertex ADC is mounted |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` | No | Vertex AI region |

### Vercel Frontend Variables
* No environment variables required. Configuration uses `vercel.json` rewrites and automatic host detection.

---

## 4. Health, Readiness & Graceful Warm-Up

### Liveness Endpoint (`GET /health`, `GET /healthz`)
* Returns HTTP `200 OK` in `<5ms`.
* Confirms the Node.js event loop is operational without hitting downstream dependencies.

### Readiness Endpoint (`GET /ready`)
* Returns HTTP `200 OK` when dependencies are configured:
  ```json
  {
    "status": "ready",
    "service": "cinepilot",
    "version": "3.0.0",
    "gemini_configured": true,
    "mcp_configured": true,
    "clickhouse_configured": true
  }
  ```
* Returns HTTP `503 Service Unavailable` (`status: "starting"`) if credentials or connections are initializing.

### Cold-Start UX & Bounded Backoff
To gracefully handle Render free-tier spinning down after idle periods:
1. When a user opens the Vercel URL, `initWarmup()` polls `/ready`.
2. If Render is waking, the UI presents an intentional banner:
   *"CinePilot is starting its production intelligence engine… (Waking cloud runtime, attempt X/5)"*
3. Retries use bounded exponential backoff:
   - Attempt 1: 0s (immediate)
   - Attempt 2: ~2s
   - Attempt 3: ~4s
   - Attempt 4: ~8s
   - Attempt 5: ~15s
4. Once `/ready` responds `200`, the banner automatically clears, and the Golden Path scenario and historical audit records load.
5. If waking exceeds the timeout, an explicit *[Retry Connection]* action is shown rather than a broken page.

---

## 5. Production Testing Procedure

Run the complete Golden Path recovery workflow:
1. Open the production Vercel URL.
2. Confirm the command center marks status `Ready`.
3. Verify ClickHouse status displays `MCP connected` (or `HTTPS connected`) and Gemini displays `Active`.
4. Click **Load Golden Path** (`Echoes of Nsukka`, Shoot Day 12, ₦3,200,000/day).
5. Click **Run Recovery**:
   - Verify historical evidence query returns 3 rows (`reorder`, `split_unit`, `relocate`).
   - Verify Gemini reasoning executes with `recommendation: "reorder"`.
   - Verify deterministic scores:
     - `reorder`: **92.78**
     - `split_unit`: **83.46**
     - `relocate`: **74.68**
6. Click **Approve & Execute**:
   - Enforces producer authorization gate.
   - Updates state: `EXECUTED` → `RECOVERED` (`verified: true`).
   - Writes outcome to ClickHouse Cloud `cinepilot_outcomes`.
   - Executes immediate readback audit query.
   - Refreshes Recovery History table showing new confirmed record.

---

## 6. Rollback Procedure

1. **Vercel Rollback**:
   - In the Vercel Dashboard, select the project `cinepilot-ai`.
   - Under **Deployments**, locate the previous working deployment and click **Rollback**.
2. **Render Rollback**:
   - In the Render Dashboard, select `cinepilot-ai`.
   - Under **Deploys**, select the previous stable commit build and click **Rollback to this deploy**.
   - Or revert the Git commit on `main` and push to GitHub.
