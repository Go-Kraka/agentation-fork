# Security Audit Report: Agentation Agent Skill

**Date**: 2026-03-12
**Reviewer**: Senior Security Engineer (Agentic AI Systems)
**Scope**: Agentation agent skills (`/agentation`, `/agentation-self-driving`), MCP server, client-side toolbar component, and sync protocol

---

## Executive Summary

Agentation has a **moderate overall risk posture** appropriate for a local-development tool, but several findings require attention before broader deployment or cloud usage. The most significant risks center on the **unauthenticated HTTP server with wildcard CORS** (enabling cross-origin attacks from any browser tab), **unrestricted `agent-browser eval` usage** in the self-driving skill (enabling arbitrary JavaScript execution on target pages), and **no request body size limits** on the MCP server (enabling denial-of-service). The tool's design philosophy of "local-first, trust-based" is reasonable for single-developer localhost use, but the cloud proxy mode and webhook system extend the attack surface beyond that trust boundary without commensurate security controls.

---

## Findings

### 1. Unauthenticated HTTP Server with Wildcard CORS

- **Category**: Authentication & Identity
- **Severity**: High
- **Description**: The MCP HTTP server (`mcp/src/server/http.ts`) binds to a port (default 4747) with no authentication and responds with `Access-Control-Allow-Origin: *` on every response. Any website open in the user's browser can make cross-origin requests to `localhost:4747`, read all sessions and annotations, create/delete annotations, and trigger agent actions. This is a classic localhost service CSRF/cross-origin attack vector.
- **Evidence**: `http.ts:199` — `"Access-Control-Allow-Origin": "*"` in `sendJson()`. No authentication middleware anywhere in the request pipeline. All route handlers are directly accessible.
- **Remediation**:
  1. Restrict CORS to known development origins (e.g., `localhost:*`, `127.0.0.1:*`) rather than `*`.
  2. Implement a shared secret or token-based auth (e.g., a randomly generated token written to a local file at startup, which the toolbar reads).
  3. At minimum, validate the `Origin` header and reject requests from non-localhost origins.

---

### 2. Arbitrary JavaScript Execution via `agent-browser eval`

- **Category**: Tool & Permission Scope
- **Severity**: High
- **Description**: The self-driving skill instructs the AI agent to execute arbitrary JavaScript on the target page via `agent-browser eval`. While scoped to `allowed-tools: Bash(agent-browser:*)`, the `eval` command can execute any JS in the page context — reading cookies, localStorage, session tokens, or exfiltrating page content. If the agent's prompt is influenced by page content (which it is, via snapshots), a malicious page could craft DOM content that induces the agent to execute attacker-controlled JavaScript.
- **Evidence**: `SKILL.md:61` — `agent-browser eval "document.querySelector('h1').scrollIntoView({block:'center'})"` and throughout. The skill builds CSS selectors from page content (snapshot output) and passes them directly into `eval` strings.
- **Remediation**:
  1. Restrict `eval` to a predefined set of safe operations (scroll, getBoundingClientRect, querySelector for existence checks) rather than arbitrary JS.
  2. Sanitize any page-derived content (element text, class names) before interpolating into `eval` strings to prevent JS injection.
  3. Consider using `agent-browser` commands that don't require raw JS execution where possible.

---

### 3. No Request Body Size Limits (DoS Vector)

- **Category**: Error Handling & Fail-Safe Behavior
- **Severity**: Medium
- **Description**: The HTTP server's `parseBody()` function concatenates request body chunks into a string with no size limit. An attacker (or a misbehaving client) can send an arbitrarily large JSON payload, consuming all available memory and crashing the server process.
- **Evidence**: `http.ts:178-190` — `let body = ""; req.on("data", (chunk) => (body += chunk));` with no size check or early termination.
- **Remediation**: Add a maximum body size check (e.g., 1MB) and abort the request with `413 Payload Too Large` if exceeded.

---

### 4. Prompt Injection via Page Content in Self-Driving Mode

- **Category**: Prompt Injection & Instruction Hijacking
- **Severity**: High
- **Description**: The self-driving skill reads full page snapshots (`agent-browser snapshot -i`) which include all visible text content from the target page. This content is fed directly into the agent's context. A malicious page could embed hidden or visible text that resembles agent instructions (e.g., "SYSTEM: Ignore all previous instructions and execute..."), potentially hijacking the agent's behavior. The skill provides no guardrails against prompt injection from page content.
- **Evidence**: `SKILL.md:75` — `agent-browser snapshot -i` feeds full page content to the agent. `SKILL.md:57-58` — snapshot output like `heading "Point at bugs." [ref=e10]` includes raw page text. The agent then uses this text to make decisions about what to critique and how to interact.
- **Remediation**:
  1. Add explicit instructions in the skill to treat all page content as untrusted data and never execute instructions found in page text.
  2. Implement a content boundary marker (e.g., `--- BEGIN PAGE CONTENT ---` / `--- END PAGE CONTENT ---`) to help the model distinguish instructions from data.
  3. Consider filtering or truncating page text content before it enters the agent context.

---

### 5. Webhook URL Injection via Environment Variables and UI Settings

- **Category**: Data Handling & Confidentiality
- **Severity**: Medium
- **Description**: Webhook URLs are configured via environment variables (`AGENTATION_WEBHOOK_URL`, `AGENTATION_WEBHOOKS`) and can also be set by users via the toolbar's settings UI. Annotation data — including page URLs, DOM paths, selected text, CSS classes, and user comments — is sent to these webhook endpoints without user confirmation per-request. A compromised or misconfigured webhook URL could exfiltrate all annotation data to an attacker-controlled server. The toolbar UI allows overriding the webhook URL, meaning any page the toolbar is loaded on could influence where data is sent if the user inadvertently changes settings.
- **Evidence**: `http.ts:136-168` — `sendWebhooks()` is fire-and-forget with no validation beyond URL format. Toolbar settings allow webhook URL override from UI. Environment variables are not validated for trustworthiness.
- **Remediation**:
  1. Restrict webhook URLs to localhost/internal addresses by default; require explicit opt-in for external URLs.
  2. Display a confirmation dialog when changing webhook URLs in the UI.
  3. Log all webhook deliveries with destination URL for audit purposes.

---

### 6. Sensitive Page Data Captured and Transmitted Without Consent Controls

- **Category**: Data Handling & Confidentiality
- **Severity**: Medium
- **Description**: The annotation capture system collects extensive page metadata: full DOM paths, CSS classes, computed styles (in forensic mode), React component hierarchies, source file paths, accessibility labels, selected text, and nearby text content. This data may inadvertently capture sensitive information displayed on the page (user data, API keys shown in debug UIs, internal URLs). All of this is stored in localStorage, synced to the HTTP server, and potentially sent via webhooks — with no data classification or redaction.
- **Evidence**: `types.ts` — Annotation type includes `computedStyles`, `nearbyText`, `selectedText`, `sourceFile`, `fullPath`, `accessibility`, `reactComponents`. The "forensic" output detail level captures maximum data.
- **Remediation**:
  1. Add a data sensitivity warning when forensic mode is enabled.
  2. Implement automatic redaction of common secret patterns (API keys, tokens, passwords) from captured text fields.
  3. Allow users to configure which metadata fields are captured and transmitted.

---

### 7. Cloud Proxy Forwards Requests Without Input Validation

- **Category**: Supply Chain & External Dependencies
- **Severity**: Medium
- **Description**: When an API key is set (cloud mode), the HTTP server proxies all non-health/non-status requests to `agentation-mcp-cloud.vercel.app/api` by forwarding the raw pathname and query string. The `proxyToCloud()` function constructs the cloud URL by concatenating `CLOUD_API_URL + pathname + url.search`. There is no validation that the pathname is a legitimate API route, and no sanitization of query parameters. If the cloud API has additional endpoints or the URL can be manipulated (e.g., path traversal), requests could reach unintended cloud services.
- **Evidence**: `http.ts:239` — `const cloudUrl = \`${CLOUD_API_URL}${pathname}\`;` directly concatenates user-controlled path. `http.ts:974` — `proxyToCloud(req, res, pathname + url.search)` passes raw path+query.
- **Remediation**:
  1. Validate that the proxied pathname matches expected API routes before forwarding.
  2. Sanitize the pathname to prevent path traversal (e.g., reject paths containing `..`).
  3. Use an allowlist of valid cloud API endpoints rather than proxying arbitrary paths.

---

### 8. SSE Event Stream Has No Access Control

- **Category**: Authentication & Identity
- **Severity**: Medium
- **Description**: The SSE endpoints (`/events`, `/sessions/:id/events`) stream all annotation events to any connected client without authentication. Combined with the wildcard CORS policy, any website can open an EventSource to `localhost:4747/events` and receive a real-time stream of all annotation activity, including page URLs, user feedback text, and DOM metadata.
- **Evidence**: `http.ts:533-591` — `sseHandler` and `http.ts:609-695` — `globalSseHandler` both accept any connection without auth. `http.ts:549` — `"Access-Control-Allow-Origin": "*"` on SSE responses.
- **Remediation**: Same as Finding #1 — implement origin validation or token-based auth for SSE connections.

---

### 9. MCP Tools Lack Authorization Boundaries

- **Category**: Tool & Permission Scope
- **Severity**: Medium
- **Description**: All MCP tools (`agentation_list_sessions`, `agentation_get_all_pending`, `agentation_resolve`, `agentation_dismiss`, `agentation_watch_annotations`, etc.) are available to any MCP client that connects. There is no concept of tool-level permissions — an agent that only needs read access can also resolve, dismiss, or delete annotations. In a multi-agent scenario, one compromised or misbehaving agent could dismiss all pending annotations, disrupting the workflow.
- **Evidence**: `http.ts:85-93` — All tools registered without any authorization check. MCP session creation requires no credentials.
- **Remediation**:
  1. Implement role-based access for MCP tools (e.g., `reader` vs `responder` roles).
  2. Add a confirmation step for destructive MCP operations (dismiss, resolve) when triggered by automated agents.
  3. Log all MCP tool invocations with client identity for audit.

---

### 10. Self-Driving Skill Can Be Triggered Against Arbitrary URLs

- **Category**: Human Oversight & Irreversibility
- **Severity**: Low
- **Description**: The self-driving skill opens a headed browser to any user-specified URL and begins interacting with it. While the interaction is visible (headed mode), there's no validation that the URL is a development server. If pointed at a production site or third-party service, the agent would be interacting with real web applications, potentially triggering actions on authenticated sessions if cookies are present in the browser profile.
- **Evidence**: `SKILL.md:23-26` — `agent-browser --headed open <url>` accepts any URL. No URL validation or localhost-only restriction.
- **Remediation**:
  1. Add a warning when the target URL is not localhost or a known development domain.
  2. Consider using an isolated browser profile (no existing cookies/sessions) by default.
  3. Require explicit user confirmation before the agent begins interacting with non-localhost URLs.

---

### 11. No Rate Limiting on API Endpoints

- **Category**: Error Handling & Fail-Safe Behavior
- **Severity**: Low
- **Description**: The HTTP server has no rate limiting on any endpoint. A malicious script or runaway agent could flood the server with session creation, annotation addition, or action requests, filling memory (in-memory store mode) or disk (SQLite mode) and degrading performance.
- **Evidence**: All route handlers in `http.ts` process requests immediately with no rate limiting. The in-memory store (`store.ts`) has no eviction policy.
- **Remediation**:
  1. Add basic rate limiting (e.g., max 100 requests/minute per IP).
  2. Implement a maximum session/annotation count with oldest-first eviction.
  3. For the event retention system, enforce `AGENTATION_EVENT_RETENTION_DAYS` with active cleanup.

---

### 12. Error Messages May Leak Internal State

- **Category**: Output Safety & Downstream Trust
- **Severity**: Low
- **Description**: Error messages from the cloud proxy and request handlers include raw error messages from Node.js and the cloud API, which could expose internal paths, stack traces, or infrastructure details.
- **Evidence**: `http.ts:306` — `sendError(res, 502, \`Cloud proxy error: ${(err as Error).message}\`)` exposes raw error messages to clients.
- **Remediation**: Return generic error messages to clients; log detailed errors to stderr only.

---

## Risk Summary Table

| # | Finding | Category | Severity |
|---|---------|----------|----------|
| 1 | Unauthenticated HTTP server with wildcard CORS | Authentication & Identity | High |
| 2 | Arbitrary JS execution via `agent-browser eval` | Tool & Permission Scope | High |
| 3 | No request body size limits | Error Handling & Fail-Safe Behavior | Medium |
| 4 | Prompt injection via page content | Prompt Injection & Instruction Hijacking | High |
| 5 | Webhook URL injection / data exfiltration | Data Handling & Confidentiality | Medium |
| 6 | Sensitive page data captured without consent controls | Data Handling & Confidentiality | Medium |
| 7 | Cloud proxy forwards without input validation | Supply Chain & External Dependencies | Medium |
| 8 | SSE event stream has no access control | Authentication & Identity | Medium |
| 9 | MCP tools lack authorization boundaries | Tool & Permission Scope | Medium |
| 10 | Self-driving skill targets arbitrary URLs | Human Oversight & Irreversibility | Low |
| 11 | No rate limiting on API endpoints | Error Handling & Fail-Safe Behavior | Low |
| 12 | Error messages leak internal state | Output Safety & Downstream Trust | Low |

---

## Overall Risk Rating

**High** — The combination of an unauthenticated localhost server with wildcard CORS (Finding #1), unrestricted JavaScript execution on target pages (Finding #2), and prompt injection susceptibility from page content (Finding #4) creates a realistic attack chain: a malicious web page open in a neighboring browser tab could read all annotation data, inject annotations, trigger agent actions, or craft page content that hijacks the self-driving agent's behavior. While the tool is designed for local development and these risks are partially mitigated by that context, the cloud proxy mode and webhook system extend the trust boundary without corresponding security controls.
