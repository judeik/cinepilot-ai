# CinePilot AI --  Official 3-Minute Demo Recording Guide

**Target Duration:** 2:40 – 2:50 (Maximum: 3:00)  
**Production URL:** [https://cinepilotapp.vercel.app/](https://cinepilotapp.vercel.app/)  
**Presenter:** Founder / Developer (First person, conversational, technically precise)  

---

## Pre-Recording Checklist

- [ ] **Warm up backend:** Open `https://cinepilotapp.vercel.app/health` in a tab 1–2 minutes before recording to ensure Render container is awake.
- [ ] **Clean browser window:** Open `https://cinepilotapp.vercel.app/` in an incognito window at 100% zoom. Top-right runtime status must show **Scenario loaded** or **Ready**.
- [ ] **Audio & Environment:** Clear microphone audio, no background noise, no terminal windows or browser developer consoles visible.
- [ ] **Timing:** Keep a stopwatch visible. Aim to wrap between **2:40 and 2:50**.

---

## Storyboard & Timing Overview

| Act | Timestamp | Stage | Focus |
|---|---|---|---|
| **Act 1** | 0:00 – 0:25 | The Problem | Benchmark incident (*Echoes of Nsukka*, Day 12, ₦3.2M/day delay cost) |
| **Act 2** | 0:25 – 1:00 | The Evidence | ClickHouse Cloud via official `mcp-clickhouse 0.6.0` (`run_query`, 3 rows) |
| **Act 3** | 1:00 – 1:30 | The Decision & AI | Deterministic multi-factor ranking (92.78 / 83.46 / 74.68) + Gemini rationale |
| **Act 4** | 1:30 – 2:10 | Human Authority | Producer Approval Gate (`approved: false` → `EXECUTED` → `RECOVERED`) |
| **Act 5** | 2:10 – 2:40 | The Audit Trail | ClickHouse outcome persistence & immediate readback confirmation |
| **Act 6** | 2:40 – 2:50 | Founder Wrap-Up | Closing statement on evidence-first recovery decisions |

---

## Detailed Act-by-Act Script

### Act 1: The Production Incident (0:00 – 0:25)
* **Screen Action:** Full screen on `https://cinepilotapp.vercel.app/`. Cursor hovers over the **Benchmark Incident** card on the left.
* **Exact Narration:**
  > "Hi, I'm Jude, and this is CinePilot AI. I built CinePilot because film production problems become very expensive when decisions have to be made in a rush.
  > 
  > Here is today's benchmark scenario: an independent production titled *Echoes of Nsukka* on Shoot Day 12. Overnight, access to our primary compound location was revoked. 38 crew members are on payroll, scenes 42 through 45 cannot shoot, our lead actor must leave at 18:00 sharp, and every delayed day costs ₦3.2 million.
  > 
  > Instead of frantic WhatsApp chats and guesswork, let's see how CinePilot recovers the day."
* **What Judges Should Notice:** Real on-set operational constraints (scenes, crew, actor departure, delay burn rate) clearly presented in the Command Center UI.

---

### Act 2: ClickHouse MCP Evidence Retrieval (0:25 – 1:00)
* **Screen Action:** Click **Run Recovery**. Scroll down slightly to center the **Live Event Stream**. Point cursor to the `clickhouse` agent entry and the 3 evidence rows.
* **Exact Narration:**
  > "I'll click **Run Recovery**. Watch the event stream: CinePilot does not invent advice or use hardcoded assumptions.
  > 
  > Our backend spawns the official ClickHouse MCP server -- version 0.6.0 -- running as an isolated subprocess. Over stdio JSON-RPC, it calls the `run_query` tool against our live ClickHouse Cloud cluster.
  > 
  > It retrieves three empirical recovery records:
  > Resequencing scenes historically saved 2.4 days with an 88% success rate.
  > Splitting the unit saved 2.7 days with an 81% success rate.
  > Full relocation saved only 1.8 days with a 73% success rate.
  > 
  > CinePilot uses ClickHouse as active operational memory to ground the recovery decision in actual performance data."
* **What Judges Should Notice:** The event log explicitly indicates `mcp-clickhouse`, `run_query`, and `3 evidence rows (clickhouse mcp)`.

---

### Act 3: Deterministic Ranking & Gemini Rationale (1:00 – 1:30)
* **Screen Action:** Scroll right to the **Recovery Options** cards. Click on `#1 · reorder` to display its score breakdown bars. Point to the **Recommended Recovery** rationale card.
* **Exact Narration:**
  > "CinePilot scores each candidate strategy deterministically across schedule preservation, budget protection, resources, continuity, and ClickHouse historical performance.
  > 
  > `reorder` ranks first with a score of **92.78**, followed by `split_unit` at **83.46**, and `relocate` at **74.68**.
  > 
  > Here, Google Gemini -- powered by `gemini-3.6-flash` via the official `@google/genai` SDK -- analyzes the trade-offs in plain language. It explains that reordering call sheets protects our lead actor's 18:00 window by pulling forward interior scenes into an available ancillary room, avoiding the heavy relocation cost of transporting 38 crew members across town."
* **What Judges Should Notice:** The 92.78 / 83.46 / 74.68 scores, the 5 weighted dimension bars, and the Gemini trade-off rationale.

---

### Act 4: The Producer Approval Gate & Verified State Transition (1:30 – 2:10)
* **Screen Action:** Point cursor at the **Approve & Execute** button. Pause for 2 seconds to highlight that execution has not occurred. Click **Approve & Execute**. Watch the button transition to **Executed**, and the verification badge confirm `status: "RECOVERED"`, `verified: true`.
* **Exact Narration:**
  > "Here is our core design principle: CinePilot never changes a production schedule autonomously. On a film set, automated changes cause contract breaches and crew confusion.
  > 
  > Everything stops at this **Producer Approval Gate**. The run is unexecuted until authorized by human authority.
  > 
  > As the producer, I inspect the rationale, verify the constraint breakdown, and authorize the plan. I click **Approve & Execute**.
  > 
  > Immediately, the system transitions to `EXECUTED`. Our verification agent confirms schedule integrity, and the status updates to `RECOVERED` with verification true."
* **What Judges Should Notice:** The explicit human-in-the-loop authorization and the verified state transition.

---

### Act 5: ClickHouse Audit Persistence & Readback (2:10 – 2:40)
* **Screen Action:** Scroll down to the **Recovery History & Audit Evidence** table at the bottom. Point to the newest row showing `run_id`, `golden-path-location-001`, `reorder`, `RECOVERED`, `✓ True`, and timestamp.
* **Exact Narration:**
  > "Finally, look at the **Recovery History** table.
  > 
  > Once verified, CinePilot writes an immutable audit record directly to ClickHouse Cloud over encrypted TLS, and immediately executes a readback query to confirm persistence.
  > 
  > ClickHouse serves both as the source of empirical evidence that informed today's decision, and the destination for today's verified outcome to train future production intelligence."
* **What Judges Should Notice:** Complete end-to-end feedback loop with persistent storage in ClickHouse Cloud.

---

### Act 6: Founder Wrap-Up (2:40 – 2:50)
* **Screen Action:** Scroll smoothly back up to show the complete Command Center overview.
* **Exact Narration:**
  > "CinePilot turns a production disruption into an evidence-backed recovery decision, combining ClickHouse historical data, deterministic constraints, Gemini reasoning, and human producer approval.
  > 
  > Thank you for reviewing CinePilot AI."
* **What Judges Should Notice:** Clean dashboard, coherent product experience, professional closure.

---

## Recording Failure & Fallback Guidance

### 1. Render Cold Start (Waking Engine)
* **Symptom:** Warm-up banner appears (*"CinePilot is starting its production intelligence engine…"*).
* **Instruction:** Do not panic or restart. Speak calmly:
  > *"Our backend runs in an isolated Linux container with Python and the MCP server on Render, so the frontend uses bounded exponential retries while the engine wakes up."*
  The banner clears in 10–15 seconds.

### 2. Gemini Upstream Capacity Spike (Temporary 503)
* **Symptom:** Rationale pill displays *"Deterministic fallback"*.
* **Instruction:** Do not hide it or stop recording. Frame it as intentional resilience:
  > *"Notice our reasoning layer engaged its deterministic fallback mode. If Google's upstream model experiences a temporary capacity spike, CinePilot doesn't freeze the film set -- it automatically relies on its mathematical scoring engine to keep production moving."*

### 3. ClickHouse Query Delay
* **Symptom:** Button spinner runs for 2–3 seconds.
* **Instruction:** Let it complete naturally. Speak calmly:
  > *"The backend is currently performing a secure TLS handshake with ClickHouse Cloud and querying the official MCP server."*

---

## Important Claim Restrictions

- ❌ Do NOT claim that Render is running Vertex AI. (Current production uses Google AI Studio API key authentication; Vertex AI is supported in code via `GOOGLE_GENAI_USE_VERTEXAI`).
- ❌ Do NOT claim autonomous execution. (Producer approval is always required).
- ❌ Do NOT claim *Echoes of Nsukka* is a commercial customer. (It is our authoritative benchmark validation scenario).
- ❌ Do NOT claim ClickHouse is just a general database. (It is operational memory queried via official MCP).
- ❌ Do NOT claim Gemini is infallible. (Always highlight our deterministic fallback resilience).
