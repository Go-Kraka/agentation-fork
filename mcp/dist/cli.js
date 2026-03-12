#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/server/mcp.ts
function setHttpBaseUrl(url) {
  httpBaseUrl = url;
}
function setApiKey(key) {
  apiKey = key;
}
async function httpGet(path2) {
  const headers = {};
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  const res = await fetch(`${httpBaseUrl}${path2}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}
async function httpPatch(path2, body) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  const res = await fetch(`${httpBaseUrl}${path2}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}
async function httpPost(path2, body) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  const res = await fetch(`${httpBaseUrl}${path2}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}
function success(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
  };
}
function error(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}
function watchForAnnotations(sessionId, batchWindowMs, timeoutMs) {
  return new Promise((resolve) => {
    let aborted = false;
    const controller = new AbortController();
    let batchTimeout = null;
    const detectedSessions = /* @__PURE__ */ new Set();
    const collectedAnnotations = [];
    const cleanup = () => {
      aborted = true;
      controller.abort();
      if (batchTimeout) clearTimeout(batchTimeout);
    };
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve({ type: "timeout" });
    }, timeoutMs);
    const sseUrl = sessionId ? `${httpBaseUrl}/sessions/${sessionId}/events?agent=true` : `${httpBaseUrl}/events?agent=true`;
    const sseHeaders = { Accept: "text/event-stream" };
    if (apiKey) {
      sseHeaders["x-api-key"] = apiKey;
    }
    fetch(sseUrl, {
      signal: controller.signal,
      headers: sseHeaders
    }).then(async (res) => {
      if (!res.ok) {
        clearTimeout(timeoutId);
        cleanup();
        resolve({ type: "error", message: `HTTP server returned ${res.status}: ${res.statusText}` });
        return;
      }
      if (!res.body) {
        clearTimeout(timeoutId);
        cleanup();
        resolve({ type: "error", message: "No response body from SSE endpoint" });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) {
          if (!aborted) {
            clearTimeout(timeoutId);
            cleanup();
            if (collectedAnnotations.length > 0) {
              resolve({
                type: "annotations",
                annotations: collectedAnnotations,
                sessions: Array.from(detectedSessions)
              });
            } else {
              resolve({ type: "error", message: "SSE connection closed unexpectedly. The agentation server may have restarted." });
            }
          }
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "annotation.created") {
                if (event.sequence === 0) continue;
                if (sessionId && event.sessionId !== sessionId) continue;
                detectedSessions.add(event.sessionId);
                collectedAnnotations.push(event.payload);
                if (!batchTimeout) {
                  batchTimeout = setTimeout(() => {
                    clearTimeout(timeoutId);
                    cleanup();
                    resolve({
                      type: "annotations",
                      annotations: collectedAnnotations,
                      sessions: Array.from(detectedSessions)
                    });
                  }, batchWindowMs);
                }
              }
            } catch {
            }
          }
        }
      }
    }).catch((err) => {
      if (!aborted) {
        clearTimeout(timeoutId);
        const message = err instanceof Error ? err.message : "Unknown connection error";
        if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
          resolve({ type: "error", message: `Cannot connect to HTTP server at ${httpBaseUrl}. Is the agentation server running?` });
        } else if (message.includes("abort")) {
          resolve({ type: "timeout" });
        } else {
          resolve({ type: "error", message: `Connection error: ${message}` });
        }
      }
    });
  });
}
async function handleTool(name, args) {
  switch (name) {
    case "agentation_list_sessions": {
      const sessions = await httpGet("/sessions");
      return success({
        sessions: sessions.map((s) => ({
          id: s.id,
          url: s.url,
          status: s.status,
          createdAt: s.createdAt
        }))
      });
    }
    case "agentation_get_session": {
      const { sessionId } = GetSessionSchema.parse(args);
      try {
        const session = await httpGet(`/sessions/${sessionId}`);
        return success(session);
      } catch (err) {
        if (err.message.includes("404")) {
          return error(`Session not found: ${sessionId}`);
        }
        throw err;
      }
    }
    case "agentation_get_pending": {
      const { sessionId } = GetPendingSchema.parse(args);
      const response = await httpGet(`/sessions/${sessionId}/pending`);
      return success({
        count: response.count,
        annotations: response.annotations.map((a) => ({
          id: a.id,
          comment: a.comment,
          element: a.element,
          elementPath: a.elementPath,
          url: a.url,
          intent: a.intent,
          severity: a.severity,
          timestamp: a.timestamp,
          nearbyText: a.nearbyText,
          reactComponents: a.reactComponents
        }))
      });
    }
    case "agentation_get_all_pending": {
      const response = await httpGet("/pending");
      return success({
        count: response.count,
        annotations: response.annotations.map((a) => ({
          id: a.id,
          comment: a.comment,
          element: a.element,
          elementPath: a.elementPath,
          url: a.url,
          intent: a.intent,
          severity: a.severity,
          timestamp: a.timestamp,
          nearbyText: a.nearbyText,
          reactComponents: a.reactComponents
        }))
      });
    }
    case "agentation_acknowledge": {
      const { annotationId } = AcknowledgeSchema.parse(args);
      try {
        await httpPatch(`/annotations/${annotationId}`, { status: "acknowledged" });
        return success({ acknowledged: true, annotationId });
      } catch (err) {
        if (err.message.includes("404")) {
          return error(`Annotation not found: ${annotationId}`);
        }
        throw err;
      }
    }
    case "agentation_resolve": {
      const { annotationId, summary } = ResolveSchema.parse(args);
      try {
        await httpPatch(`/annotations/${annotationId}`, {
          status: "resolved",
          resolvedBy: "agent"
        });
        if (summary) {
          await httpPost(`/annotations/${annotationId}/thread`, {
            role: "agent",
            content: `Resolved: ${summary}`
          });
        }
        return success({ resolved: true, annotationId, summary });
      } catch (err) {
        if (err.message.includes("404")) {
          return error(`Annotation not found: ${annotationId}`);
        }
        throw err;
      }
    }
    case "agentation_dismiss": {
      const { annotationId, reason } = DismissSchema.parse(args);
      try {
        await httpPatch(`/annotations/${annotationId}`, {
          status: "dismissed",
          resolvedBy: "agent"
        });
        await httpPost(`/annotations/${annotationId}/thread`, {
          role: "agent",
          content: `Dismissed: ${reason}`
        });
        return success({ dismissed: true, annotationId, reason });
      } catch (err) {
        if (err.message.includes("404")) {
          return error(`Annotation not found: ${annotationId}`);
        }
        throw err;
      }
    }
    case "agentation_reply": {
      const { annotationId, message } = ReplySchema.parse(args);
      try {
        await httpPost(`/annotations/${annotationId}/thread`, {
          role: "agent",
          content: message
        });
        return success({ replied: true, annotationId, message });
      } catch (err) {
        if (err.message.includes("404")) {
          return error(`Annotation not found: ${annotationId}`);
        }
        throw err;
      }
    }
    case "agentation_watch_annotations": {
      const parsed = WatchAnnotationsSchema.parse(args);
      const sessionId = parsed.sessionId;
      const batchWindowSeconds = Math.min(60, Math.max(1, parsed.batchWindowSeconds ?? 10));
      const timeoutSeconds = Math.min(300, Math.max(1, parsed.timeoutSeconds ?? 120));
      try {
        const pendingPath = sessionId ? `/sessions/${sessionId}/pending` : "/pending";
        const pending = await httpGet(pendingPath);
        if (pending.count > 0) {
          const sessions = [...new Set(pending.annotations.map((a) => a.sessionId))];
          return success({
            timeout: false,
            count: pending.count,
            sessions,
            annotations: pending.annotations.map((a) => ({
              id: a.id,
              comment: a.comment,
              element: a.element,
              elementPath: a.elementPath,
              url: a.url,
              intent: a.intent,
              severity: a.severity,
              timestamp: a.timestamp,
              nearbyText: a.nearbyText,
              reactComponents: a.reactComponents
            }))
          });
        }
      } catch (err) {
        console.error("[MCP] Pending drain failed, falling through to SSE watch:", err);
      }
      const result = await watchForAnnotations(
        sessionId,
        batchWindowSeconds * 1e3,
        timeoutSeconds * 1e3
      );
      switch (result.type) {
        case "annotations":
          return success({
            timeout: false,
            count: result.annotations.length,
            sessions: result.sessions,
            annotations: result.annotations.map((a) => ({
              id: a.id,
              comment: a.comment,
              element: a.element,
              elementPath: a.elementPath,
              url: a.url,
              intent: a.intent,
              severity: a.severity,
              timestamp: a.timestamp,
              nearbyText: a.nearbyText,
              reactComponents: a.reactComponents
            }))
          });
        case "timeout":
          return success({
            timeout: true,
            message: `No new annotations within ${timeoutSeconds} seconds`
          });
        case "error":
          return error(result.message);
      }
    }
    default:
      return error(`Unknown tool: ${name}`);
  }
}
async function startMcpServer(baseUrl) {
  if (baseUrl) {
    setHttpBaseUrl(baseUrl);
  }
  const server = new import_server.Server(
    {
      name: "agentation",
      version: "0.0.1"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );
  server.setRequestHandler(import_types.ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });
  server.setRequestHandler(import_types.CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await handleTool(name, args);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message);
    }
  });
  const transport = new import_stdio.StdioServerTransport();
  await server.connect(transport);
  const isRemote = httpBaseUrl.startsWith("https://") || !httpBaseUrl.includes("localhost") && !httpBaseUrl.includes("127.0.0.1");
  if (isRemote && apiKey) {
    console.error(`[MCP] Agentation MCP server started on stdio (Remote: ${httpBaseUrl}, API key: configured)`);
  } else if (isRemote) {
    console.error(`[MCP] Agentation MCP server started on stdio (Remote: ${httpBaseUrl}, API key: not configured)`);
  } else {
    console.error(`[MCP] Agentation MCP server started on stdio (HTTP: ${httpBaseUrl})`);
  }
}
var import_server, import_stdio, import_types, import_zod, httpBaseUrl, apiKey, GetPendingSchema, AcknowledgeSchema, ResolveSchema, DismissSchema, ReplySchema, GetSessionSchema, WatchAnnotationsSchema, TOOLS;
var init_mcp = __esm({
  "src/server/mcp.ts"() {
    "use strict";
    import_server = require("@modelcontextprotocol/sdk/server/index.js");
    import_stdio = require("@modelcontextprotocol/sdk/server/stdio.js");
    import_types = require("@modelcontextprotocol/sdk/types.js");
    import_zod = require("zod");
    httpBaseUrl = "http://localhost:4747";
    GetPendingSchema = import_zod.z.object({
      sessionId: import_zod.z.string().describe("The session ID to get pending annotations for")
    });
    AcknowledgeSchema = import_zod.z.object({
      annotationId: import_zod.z.string().describe("The annotation ID to acknowledge")
    });
    ResolveSchema = import_zod.z.object({
      annotationId: import_zod.z.string().describe("The annotation ID to resolve"),
      summary: import_zod.z.string().optional().describe("Optional summary of how it was resolved")
    });
    DismissSchema = import_zod.z.object({
      annotationId: import_zod.z.string().describe("The annotation ID to dismiss"),
      reason: import_zod.z.string().describe("Reason for dismissing this annotation")
    });
    ReplySchema = import_zod.z.object({
      annotationId: import_zod.z.string().describe("The annotation ID to reply to"),
      message: import_zod.z.string().describe("The reply message")
    });
    GetSessionSchema = import_zod.z.object({
      sessionId: import_zod.z.string().describe("The session ID to get")
    });
    WatchAnnotationsSchema = import_zod.z.object({
      sessionId: import_zod.z.string().optional().describe("Optional session ID to filter. If not provided, watches ALL sessions."),
      batchWindowSeconds: import_zod.z.number().optional().default(10).describe("Seconds to wait after first annotation before returning batch (default: 10, max: 60)"),
      timeoutSeconds: import_zod.z.number().optional().default(120).describe("Max seconds to wait for first annotation (default: 120, max: 300)")
    });
    TOOLS = [
      {
        name: "agentation_list_sessions",
        description: "List all active annotation sessions",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "agentation_get_session",
        description: "Get a session with all its annotations",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "The session ID to get"
            }
          },
          required: ["sessionId"]
        }
      },
      {
        name: "agentation_get_pending",
        description: "Get all pending (unacknowledged) annotations for a session. Use this to see what feedback the human has given that needs attention.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "The session ID to get pending annotations for"
            }
          },
          required: ["sessionId"]
        }
      },
      {
        name: "agentation_get_all_pending",
        description: "Get all pending annotations across ALL sessions. Use this to see all unaddressed feedback from the human across all pages they've visited.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "agentation_acknowledge",
        description: "Mark an annotation as acknowledged. Use this to let the human know you've seen their feedback and will address it.",
        inputSchema: {
          type: "object",
          properties: {
            annotationId: {
              type: "string",
              description: "The annotation ID to acknowledge"
            }
          },
          required: ["annotationId"]
        }
      },
      {
        name: "agentation_resolve",
        description: "Mark an annotation as resolved. Use this after you've addressed the feedback. Optionally include a summary of what you did.",
        inputSchema: {
          type: "object",
          properties: {
            annotationId: {
              type: "string",
              description: "The annotation ID to resolve"
            },
            summary: {
              type: "string",
              description: "Optional summary of how it was resolved"
            }
          },
          required: ["annotationId"]
        }
      },
      {
        name: "agentation_dismiss",
        description: "Dismiss an annotation. Use this when you've decided not to address the feedback, with a reason why.",
        inputSchema: {
          type: "object",
          properties: {
            annotationId: {
              type: "string",
              description: "The annotation ID to dismiss"
            },
            reason: {
              type: "string",
              description: "Reason for dismissing this annotation"
            }
          },
          required: ["annotationId", "reason"]
        }
      },
      {
        name: "agentation_reply",
        description: "Add a reply to an annotation's thread. Use this to ask clarifying questions or provide updates to the human.",
        inputSchema: {
          type: "object",
          properties: {
            annotationId: {
              type: "string",
              description: "The annotation ID to reply to"
            },
            message: {
              type: "string",
              description: "The reply message"
            }
          },
          required: ["annotationId", "message"]
        }
      },
      {
        name: "agentation_watch_annotations",
        description: "Block until new annotations appear, then collect a batch and return them. Triggers automatically when annotations are created \u2014 the user just annotates in the browser and the agent picks them up. After detecting the first new annotation, waits for a batch window to collect more before returning. Use in a loop for hands-free processing. After addressing each annotation, call agentation_resolve with the annotation ID and a summary of what you did. Only resolve annotations the user accepted \u2014 if the user rejects your change, leave the annotation open.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "Optional session ID to filter. If not provided, watches ALL sessions."
            },
            batchWindowSeconds: {
              type: "number",
              description: "Seconds to wait after first annotation before returning batch (default: 10, max: 60)"
            },
            timeoutSeconds: {
              type: "number",
              description: "Max seconds to wait for first annotation (default: 120, max: 300)"
            }
          },
          required: []
        }
      }
    ];
  }
});

// src/server/events.ts
var globalSequence, EventBus, eventBus, UserEventBus, userEventBus;
var init_events = __esm({
  "src/server/events.ts"() {
    "use strict";
    globalSequence = 0;
    EventBus = class {
      handlers = /* @__PURE__ */ new Set();
      sessionHandlers = /* @__PURE__ */ new Map();
      /**
       * Subscribe to all events.
       */
      subscribe(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
      }
      /**
       * Subscribe to events for a specific session.
       */
      subscribeToSession(sessionId, handler) {
        if (!this.sessionHandlers.has(sessionId)) {
          this.sessionHandlers.set(sessionId, /* @__PURE__ */ new Set());
        }
        this.sessionHandlers.get(sessionId).add(handler);
        return () => {
          const handlers = this.sessionHandlers.get(sessionId);
          if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
              this.sessionHandlers.delete(sessionId);
            }
          }
        };
      }
      /**
       * Emit an event to all subscribers.
       */
      emit(type, sessionId, payload) {
        const event = {
          type,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          sessionId,
          sequence: ++globalSequence,
          payload
        };
        for (const handler of this.handlers) {
          try {
            handler(event);
          } catch (err) {
            console.error("[EventBus] Handler error:", err);
          }
        }
        const sessionHandlers = this.sessionHandlers.get(sessionId);
        if (sessionHandlers) {
          for (const handler of sessionHandlers) {
            try {
              handler(event);
            } catch (err) {
              console.error("[EventBus] Session handler error:", err);
            }
          }
        }
        return event;
      }
      /**
       * Get current sequence number (for reconnect logic).
       */
      getSequence() {
        return globalSequence;
      }
      /**
       * Set sequence from persisted state (for server restart).
       */
      setSequence(seq) {
        globalSequence = seq;
      }
    };
    eventBus = new EventBus();
    UserEventBus = class {
      userHandlers = /* @__PURE__ */ new Map();
      userSessionHandlers = /* @__PURE__ */ new Map();
      /**
       * Subscribe to all events for a specific user.
       */
      subscribeForUser(userId, handler) {
        if (!this.userHandlers.has(userId)) {
          this.userHandlers.set(userId, /* @__PURE__ */ new Set());
        }
        this.userHandlers.get(userId).add(handler);
        return () => {
          const handlers = this.userHandlers.get(userId);
          if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
              this.userHandlers.delete(userId);
            }
          }
        };
      }
      /**
       * Subscribe to events for a specific session of a specific user.
       */
      subscribeToSessionForUser(userId, sessionId, handler) {
        if (!this.userSessionHandlers.has(userId)) {
          this.userSessionHandlers.set(userId, /* @__PURE__ */ new Map());
        }
        const userSessions = this.userSessionHandlers.get(userId);
        if (!userSessions.has(sessionId)) {
          userSessions.set(sessionId, /* @__PURE__ */ new Set());
        }
        userSessions.get(sessionId).add(handler);
        return () => {
          const userSessions2 = this.userSessionHandlers.get(userId);
          if (userSessions2) {
            const handlers = userSessions2.get(sessionId);
            if (handlers) {
              handlers.delete(handler);
              if (handlers.size === 0) {
                userSessions2.delete(sessionId);
              }
            }
            if (userSessions2.size === 0) {
              this.userSessionHandlers.delete(userId);
            }
          }
        };
      }
      /**
       * Emit an event scoped to a specific user.
       * Only handlers for that user will receive the event.
       */
      emitForUser(userId, type, sessionId, payload) {
        const event = {
          type,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          sessionId,
          sequence: ++globalSequence,
          payload
        };
        const userHandlers = this.userHandlers.get(userId);
        if (userHandlers) {
          for (const handler of userHandlers) {
            try {
              handler(event);
            } catch (err) {
              console.error("[UserEventBus] Handler error:", err);
            }
          }
        }
        const userSessions = this.userSessionHandlers.get(userId);
        if (userSessions) {
          const sessionHandlers = userSessions.get(sessionId);
          if (sessionHandlers) {
            for (const handler of sessionHandlers) {
              try {
                handler(event);
              } catch (err) {
                console.error("[UserEventBus] Session handler error:", err);
              }
            }
          }
        }
        return event;
      }
      /**
       * Check if a user has any active listeners.
       */
      hasListenersForUser(userId) {
        const hasGlobal = this.userHandlers.has(userId) && this.userHandlers.get(userId).size > 0;
        const hasSessions = this.userSessionHandlers.has(userId) && this.userSessionHandlers.get(userId).size > 0;
        return hasGlobal || hasSessions;
      }
      /**
       * Get count of listeners for a user.
       */
      getListenerCountForUser(userId) {
        let count = 0;
        const handlers = this.userHandlers.get(userId);
        if (handlers) count += handlers.size;
        const sessions = this.userSessionHandlers.get(userId);
        if (sessions) {
          for (const sessionHandlers of sessions.values()) {
            count += sessionHandlers.size;
          }
        }
        return count;
      }
    };
    userEventBus = new UserEventBus();
  }
});

// src/server/sqlite.ts
var sqlite_exports = {};
__export(sqlite_exports, {
  createSQLiteStore: () => createSQLiteStore,
  createTenantStore: () => createTenantStore
});
function getDbPath() {
  const dataDir = (0, import_path.join)((0, import_os.homedir)(), ".agentation");
  if (!(0, import_fs.existsSync)(dataDir)) {
    (0, import_fs.mkdirSync)(dataDir, { recursive: true });
  }
  return (0, import_path.join)(dataDir, "store.db");
}
function initDatabase(db) {
  db.exec(`
    -- Multi-tenant tables
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      org_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (org_id) REFERENCES organizations(id)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      project_id TEXT,
      metadata TEXT,
      user_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      comment TEXT NOT NULL,
      element TEXT NOT NULL,
      element_path TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      selected_text TEXT,
      bounding_box TEXT,
      nearby_text TEXT,
      css_classes TEXT,
      nearby_elements TEXT,
      computed_styles TEXT,
      full_path TEXT,
      accessibility TEXT,
      is_multi_select INTEGER DEFAULT 0,
      is_fixed INTEGER DEFAULT 0,
      react_components TEXT,
      url TEXT,
      intent TEXT,
      severity TEXT,
      status TEXT DEFAULT 'pending',
      thread TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      resolved_at TEXT,
      resolved_by TEXT,
      author_id TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      user_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_session ON annotations(session_id);
    CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id);
  `);
}
function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function rowToSession(row) {
  return {
    id: row.id,
    url: row.url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectId: row.project_id,
    metadata: row.metadata ? JSON.parse(row.metadata) : void 0,
    userId: row.user_id
  };
}
function rowToOrganization(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function rowToUser(row) {
  return {
    id: row.id,
    email: row.email,
    orgId: row.org_id,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function rowToApiKey(row) {
  return {
    id: row.id,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at
  };
}
function rowToAnnotation(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    x: row.x,
    y: row.y,
    comment: row.comment,
    element: row.element,
    elementPath: row.element_path,
    timestamp: row.timestamp,
    selectedText: row.selected_text,
    boundingBox: row.bounding_box ? JSON.parse(row.bounding_box) : void 0,
    nearbyText: row.nearby_text,
    cssClasses: row.css_classes,
    nearbyElements: row.nearby_elements,
    computedStyles: row.computed_styles,
    fullPath: row.full_path,
    accessibility: row.accessibility,
    isMultiSelect: Boolean(row.is_multi_select),
    isFixed: Boolean(row.is_fixed),
    reactComponents: row.react_components,
    url: row.url,
    intent: row.intent,
    severity: row.severity,
    status: row.status,
    thread: row.thread ? JSON.parse(row.thread) : void 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    authorId: row.author_id
  };
}
function createSQLiteStore(dbPath) {
  const db = new import_better_sqlite3.default(dbPath ?? getDbPath());
  db.pragma("journal_mode = WAL");
  initDatabase(db);
  const lastEvent = db.prepare("SELECT MAX(sequence) as seq FROM events").get();
  if (lastEvent?.seq) {
    eventBus.setSequence(lastEvent.seq);
  }
  const stmts = {
    // Sessions
    insertSession: db.prepare(`
      INSERT INTO sessions (id, url, status, created_at, project_id, metadata)
      VALUES (@id, @url, @status, @createdAt, @projectId, @metadata)
    `),
    getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
    updateSessionStatus: db.prepare(`
      UPDATE sessions SET status = @status, updated_at = @updatedAt WHERE id = @id
    `),
    listSessions: db.prepare("SELECT * FROM sessions ORDER BY created_at DESC"),
    // Annotations
    insertAnnotation: db.prepare(`
      INSERT INTO annotations (
        id, session_id, x, y, comment, element, element_path, timestamp,
        selected_text, bounding_box, nearby_text, css_classes, nearby_elements,
        computed_styles, full_path, accessibility, is_multi_select, is_fixed,
        react_components, url, intent, severity, status, thread, created_at,
        updated_at, resolved_at, resolved_by, author_id
      ) VALUES (
        @id, @sessionId, @x, @y, @comment, @element, @elementPath, @timestamp,
        @selectedText, @boundingBox, @nearbyText, @cssClasses, @nearbyElements,
        @computedStyles, @fullPath, @accessibility, @isMultiSelect, @isFixed,
        @reactComponents, @url, @intent, @severity, @status, @thread, @createdAt,
        @updatedAt, @resolvedAt, @resolvedBy, @authorId
      )
    `),
    getAnnotation: db.prepare("SELECT * FROM annotations WHERE id = ?"),
    getAnnotationsBySession: db.prepare("SELECT * FROM annotations WHERE session_id = ? ORDER BY timestamp"),
    getPendingAnnotations: db.prepare("SELECT * FROM annotations WHERE session_id = ? AND status = 'pending' ORDER BY timestamp"),
    deleteAnnotation: db.prepare("DELETE FROM annotations WHERE id = ?"),
    updateAnnotation: db.prepare(`
      UPDATE annotations SET
        comment = COALESCE(@comment, comment),
        status = COALESCE(@status, status),
        updated_at = @updatedAt,
        resolved_at = COALESCE(@resolvedAt, resolved_at),
        resolved_by = COALESCE(@resolvedBy, resolved_by),
        thread = COALESCE(@thread, thread),
        intent = COALESCE(@intent, intent),
        severity = COALESCE(@severity, severity)
      WHERE id = @id
    `),
    // Events
    insertEvent: db.prepare(`
      INSERT INTO events (type, timestamp, session_id, sequence, payload)
      VALUES (@type, @timestamp, @sessionId, @sequence, @payload)
    `),
    getEventsSince: db.prepare(`
      SELECT * FROM events WHERE session_id = ? AND sequence > ? ORDER BY sequence
    `),
    pruneOldEvents: db.prepare(`
      DELETE FROM events WHERE timestamp < ?
    `)
  };
  const retentionDays = parseInt(process.env.AGENTATION_EVENT_RETENTION_DAYS || "7", 10);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1e3).toISOString();
  stmts.pruneOldEvents.run(cutoff);
  function persistEvent(event) {
    stmts.insertEvent.run({
      type: event.type,
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      sequence: event.sequence,
      payload: JSON.stringify(event.payload)
    });
  }
  return {
    // Sessions
    createSession(url, projectId) {
      const session = {
        id: generateId(),
        url,
        status: "active",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        projectId
      };
      stmts.insertSession.run({
        id: session.id,
        url: session.url,
        status: session.status,
        createdAt: session.createdAt,
        projectId: session.projectId ?? null,
        metadata: null
      });
      const event = eventBus.emit("session.created", session.id, session);
      persistEvent(event);
      return session;
    },
    getSession(id) {
      const row = stmts.getSession.get(id);
      return row ? rowToSession(row) : void 0;
    },
    getSessionWithAnnotations(id) {
      const sessionRow = stmts.getSession.get(id);
      if (!sessionRow) return void 0;
      const annotationRows = stmts.getAnnotationsBySession.all(id);
      return {
        ...rowToSession(sessionRow),
        annotations: annotationRows.map(rowToAnnotation)
      };
    },
    updateSessionStatus(id, status) {
      const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const result = stmts.updateSessionStatus.run({ id, status, updatedAt });
      if (result.changes === 0) return void 0;
      const session = this.getSession(id);
      if (session) {
        const eventType = status === "closed" ? "session.closed" : "session.updated";
        const event = eventBus.emit(eventType, id, session);
        persistEvent(event);
      }
      return session;
    },
    listSessions() {
      const rows = stmts.listSessions.all();
      return rows.map(rowToSession);
    },
    // Annotations
    addAnnotation(sessionId, data) {
      const session = this.getSession(sessionId);
      if (!session) return void 0;
      const annotation = {
        ...data,
        id: generateId(),
        sessionId,
        status: "pending",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      stmts.insertAnnotation.run({
        id: annotation.id,
        sessionId: annotation.sessionId,
        x: annotation.x,
        y: annotation.y,
        comment: annotation.comment,
        element: annotation.element,
        elementPath: annotation.elementPath,
        timestamp: annotation.timestamp,
        selectedText: annotation.selectedText ?? null,
        boundingBox: annotation.boundingBox ? JSON.stringify(annotation.boundingBox) : null,
        nearbyText: annotation.nearbyText ?? null,
        cssClasses: annotation.cssClasses ?? null,
        nearbyElements: annotation.nearbyElements ?? null,
        computedStyles: annotation.computedStyles ?? null,
        fullPath: annotation.fullPath ?? null,
        accessibility: annotation.accessibility ?? null,
        isMultiSelect: annotation.isMultiSelect ? 1 : 0,
        isFixed: annotation.isFixed ? 1 : 0,
        reactComponents: annotation.reactComponents ?? null,
        url: annotation.url ?? null,
        intent: annotation.intent ?? null,
        severity: annotation.severity ?? null,
        status: annotation.status ?? "pending",
        thread: annotation.thread ? JSON.stringify(annotation.thread) : null,
        createdAt: annotation.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: null,
        resolvedAt: null,
        resolvedBy: null,
        authorId: annotation.authorId ?? null
      });
      const event = eventBus.emit("annotation.created", sessionId, annotation);
      persistEvent(event);
      return annotation;
    },
    getAnnotation(id) {
      const row = stmts.getAnnotation.get(id);
      return row ? rowToAnnotation(row) : void 0;
    },
    updateAnnotation(id, data) {
      const existing = this.getAnnotation(id);
      if (!existing) return void 0;
      stmts.updateAnnotation.run({
        id,
        comment: data.comment ?? null,
        status: data.status ?? null,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        resolvedAt: data.resolvedAt ?? null,
        resolvedBy: data.resolvedBy ?? null,
        thread: data.thread ? JSON.stringify(data.thread) : null,
        intent: data.intent ?? null,
        severity: data.severity ?? null
      });
      const updated = this.getAnnotation(id);
      if (updated && existing.sessionId) {
        const event = eventBus.emit("annotation.updated", existing.sessionId, updated);
        persistEvent(event);
      }
      return updated;
    },
    updateAnnotationStatus(id, status, resolvedBy) {
      const isResolved = status === "resolved" || status === "dismissed";
      return this.updateAnnotation(id, {
        status,
        resolvedAt: isResolved ? (/* @__PURE__ */ new Date()).toISOString() : void 0,
        resolvedBy: isResolved ? resolvedBy || "agent" : void 0
      });
    },
    addThreadMessage(annotationId, role, content) {
      const existing = this.getAnnotation(annotationId);
      if (!existing) return void 0;
      const message = {
        id: generateId(),
        role,
        content,
        timestamp: Date.now()
      };
      const thread = [...existing.thread || [], message];
      const updated = this.updateAnnotation(annotationId, { thread });
      if (updated && existing.sessionId) {
        const event = eventBus.emit("thread.message", existing.sessionId, message);
        persistEvent(event);
      }
      return updated;
    },
    getPendingAnnotations(sessionId) {
      const rows = stmts.getPendingAnnotations.all(sessionId);
      return rows.map(rowToAnnotation);
    },
    getSessionAnnotations(sessionId) {
      const rows = stmts.getAnnotationsBySession.all(sessionId);
      return rows.map(rowToAnnotation);
    },
    deleteAnnotation(id) {
      const existing = this.getAnnotation(id);
      if (!existing) return void 0;
      stmts.deleteAnnotation.run(id);
      if (existing.sessionId) {
        const event = eventBus.emit("annotation.deleted", existing.sessionId, existing);
        persistEvent(event);
      }
      return existing;
    },
    // Events
    getEventsSince(sessionId, sequence) {
      const rows = stmts.getEventsSince.all(sessionId, sequence);
      return rows.map((row) => ({
        type: row.type,
        timestamp: row.timestamp,
        sessionId: row.session_id,
        sequence: row.sequence,
        payload: JSON.parse(row.payload)
      }));
    },
    // Lifecycle
    close() {
      db.close();
    }
  };
}
function createTenantStore(dbPath) {
  const db = new import_better_sqlite3.default(dbPath ?? getDbPath());
  db.pragma("journal_mode = WAL");
  initDatabase(db);
  const lastEvent = db.prepare("SELECT MAX(sequence) as seq FROM events").get();
  if (lastEvent?.seq) {
    eventBus.setSequence(lastEvent.seq);
  }
  const tenantStmts = {
    // Organizations
    insertOrg: db.prepare(`
      INSERT INTO organizations (id, name, created_at)
      VALUES (@id, @name, @createdAt)
    `),
    getOrg: db.prepare("SELECT * FROM organizations WHERE id = ?"),
    // Users
    insertUser: db.prepare(`
      INSERT INTO users (id, email, org_id, role, created_at)
      VALUES (@id, @email, @orgId, @role, @createdAt)
    `),
    getUser: db.prepare("SELECT * FROM users WHERE id = ?"),
    getUserByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    getUsersByOrg: db.prepare("SELECT * FROM users WHERE org_id = ?"),
    // API Keys
    insertApiKey: db.prepare(`
      INSERT INTO api_keys (id, key_prefix, key_hash, user_id, name, created_at, expires_at)
      VALUES (@id, @keyPrefix, @keyHash, @userId, @name, @createdAt, @expiresAt)
    `),
    getApiKeyByHash: db.prepare("SELECT * FROM api_keys WHERE key_hash = ?"),
    listApiKeys: db.prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC"),
    deleteApiKey: db.prepare("DELETE FROM api_keys WHERE id = ?"),
    updateApiKeyLastUsed: db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?"),
    // User-scoped sessions
    insertSessionForUser: db.prepare(`
      INSERT INTO sessions (id, url, status, created_at, project_id, metadata, user_id)
      VALUES (@id, @url, @status, @createdAt, @projectId, @metadata, @userId)
    `),
    listSessionsForUser: db.prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC"),
    getSessionForUser: db.prepare("SELECT * FROM sessions WHERE id = ? AND user_id = ?"),
    getAnnotationsBySession: db.prepare("SELECT * FROM annotations WHERE session_id = ? ORDER BY timestamp"),
    getPendingAnnotationsForSession: db.prepare("SELECT * FROM annotations WHERE session_id = ? AND status = 'pending' ORDER BY timestamp"),
    // Get all pending for a user (across all their sessions)
    getAllPendingForUser: db.prepare(`
      SELECT a.* FROM annotations a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.user_id = ? AND a.status = 'pending'
      ORDER BY a.timestamp
    `),
    // Events
    insertEvent: db.prepare(`
      INSERT INTO events (type, timestamp, session_id, sequence, payload, user_id)
      VALUES (@type, @timestamp, @sessionId, @sequence, @payload, @userId)
    `),
    // Prune old events
    pruneOldEvents: db.prepare(`
      DELETE FROM events WHERE timestamp < ?
    `)
  };
  const retentionDays = parseInt(process.env.AGENTATION_EVENT_RETENTION_DAYS || "7", 10);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1e3).toISOString();
  tenantStmts.pruneOldEvents.run(cutoff);
  function persistEventForUser(event, userId) {
    tenantStmts.insertEvent.run({
      type: event.type,
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      sequence: event.sequence,
      payload: JSON.stringify(event.payload),
      userId
    });
  }
  return {
    // Organizations
    createOrganization(name) {
      const org = {
        id: `org_${generateId()}`,
        name,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      tenantStmts.insertOrg.run({
        id: org.id,
        name: org.name,
        createdAt: org.createdAt
      });
      return org;
    },
    getOrganization(id) {
      const row = tenantStmts.getOrg.get(id);
      return row ? rowToOrganization(row) : void 0;
    },
    // Users
    createUser(email, orgId, role = "member") {
      const user = {
        id: `user_${generateId()}`,
        email,
        orgId,
        role,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      tenantStmts.insertUser.run({
        id: user.id,
        email: user.email,
        orgId: user.orgId,
        role: user.role,
        createdAt: user.createdAt
      });
      return user;
    },
    getUser(id) {
      const row = tenantStmts.getUser.get(id);
      return row ? rowToUser(row) : void 0;
    },
    getUserByEmail(email) {
      const row = tenantStmts.getUserByEmail.get(email);
      return row ? rowToUser(row) : void 0;
    },
    getUsersByOrg(orgId) {
      const rows = tenantStmts.getUsersByOrg.all(orgId);
      return rows.map(rowToUser);
    },
    // API Keys
    createApiKey(userId, name, expiresAt) {
      const id = `key_${generateId()}`;
      const rawKey = `sk_live_${(0, import_crypto.randomBytes)(32).toString("base64url")}`;
      const keyPrefix = rawKey.substring(0, 12);
      const keyHash = (0, import_crypto.createHash)("sha256").update(rawKey).digest("hex");
      const apiKey2 = {
        id,
        keyPrefix,
        keyHash,
        userId,
        name,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        expiresAt
      };
      tenantStmts.insertApiKey.run({
        id: apiKey2.id,
        keyPrefix: apiKey2.keyPrefix,
        keyHash: apiKey2.keyHash,
        userId: apiKey2.userId,
        name: apiKey2.name,
        createdAt: apiKey2.createdAt,
        expiresAt: apiKey2.expiresAt ?? null
      });
      return { apiKey: apiKey2, rawKey };
    },
    getApiKeyByHash(hash) {
      const row = tenantStmts.getApiKeyByHash.get(hash);
      return row ? rowToApiKey(row) : void 0;
    },
    listApiKeys(userId) {
      const rows = tenantStmts.listApiKeys.all(userId);
      return rows.map(rowToApiKey);
    },
    deleteApiKey(id) {
      const result = tenantStmts.deleteApiKey.run(id);
      return result.changes > 0;
    },
    updateApiKeyLastUsed(id) {
      tenantStmts.updateApiKeyLastUsed.run((/* @__PURE__ */ new Date()).toISOString(), id);
    },
    // User-scoped sessions
    createSessionForUser(userId, url, projectId) {
      const session = {
        id: generateId(),
        url,
        status: "active",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        projectId
      };
      tenantStmts.insertSessionForUser.run({
        id: session.id,
        url: session.url,
        status: session.status,
        createdAt: session.createdAt,
        projectId: session.projectId ?? null,
        metadata: null,
        userId
      });
      const event = eventBus.emit("session.created", session.id, session);
      persistEventForUser(event, userId);
      return session;
    },
    listSessionsForUser(userId) {
      const rows = tenantStmts.listSessionsForUser.all(userId);
      return rows.map(rowToSession);
    },
    getSessionForUser(userId, sessionId) {
      const row = tenantStmts.getSessionForUser.get(sessionId, userId);
      return row ? rowToSession(row) : void 0;
    },
    getSessionWithAnnotationsForUser(userId, sessionId) {
      const sessionRow = tenantStmts.getSessionForUser.get(sessionId, userId);
      if (!sessionRow) return void 0;
      const annotationRows = tenantStmts.getAnnotationsBySession.all(sessionId);
      return {
        ...rowToSession(sessionRow),
        annotations: annotationRows.map(rowToAnnotation)
      };
    },
    // User-scoped annotations
    getPendingAnnotationsForUser(userId, sessionId) {
      const session = this.getSessionForUser(userId, sessionId);
      if (!session) return [];
      const rows = tenantStmts.getPendingAnnotationsForSession.all(sessionId);
      return rows.map(rowToAnnotation);
    },
    getAllPendingForUser(userId) {
      const rows = tenantStmts.getAllPendingForUser.all(userId);
      return rows.map(rowToAnnotation);
    },
    // Lifecycle
    close() {
      db.close();
    }
  };
}
var import_better_sqlite3, import_crypto, import_fs, import_path, import_os;
var init_sqlite = __esm({
  "src/server/sqlite.ts"() {
    "use strict";
    import_better_sqlite3 = __toESM(require("better-sqlite3"));
    import_crypto = require("crypto");
    import_fs = require("fs");
    import_path = require("path");
    import_os = require("os");
    init_events();
  }
});

// src/server/store.ts
function getStore() {
  if (!_store) {
    _store = initializeStore();
  }
  return _store;
}
function initializeStore() {
  if (process.env.AGENTATION_STORE === "memory") {
    process.stderr.write("[Store] Using in-memory store (AGENTATION_STORE=memory)\n");
    return createMemoryStore();
  }
  try {
    const { createSQLiteStore: createSQLiteStore2 } = (init_sqlite(), __toCommonJS(sqlite_exports));
    const store2 = createSQLiteStore2();
    process.stderr.write("[Store] Using SQLite store (~/.agentation/store.db)\n");
    return store2;
  } catch (err) {
    console.warn("[Store] SQLite unavailable, falling back to in-memory:", err.message);
    return createMemoryStore();
  }
}
function createMemoryStore() {
  const sessions = /* @__PURE__ */ new Map();
  const annotations = /* @__PURE__ */ new Map();
  const events = [];
  function generateId2() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return {
    createSession(url, projectId) {
      const session = {
        id: generateId2(),
        url,
        status: "active",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        projectId
      };
      sessions.set(session.id, session);
      const event = eventBus.emit("session.created", session.id, session);
      events.push(event);
      return session;
    },
    getSession(id) {
      return sessions.get(id);
    },
    getSessionWithAnnotations(id) {
      const session = sessions.get(id);
      if (!session) return void 0;
      const sessionAnnotations = Array.from(annotations.values()).filter(
        (a) => a.sessionId === id
      );
      return {
        ...session,
        annotations: sessionAnnotations
      };
    },
    updateSessionStatus(id, status) {
      const session = sessions.get(id);
      if (!session) return void 0;
      session.status = status;
      session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const eventType = status === "closed" ? "session.closed" : "session.updated";
      const event = eventBus.emit(eventType, id, session);
      events.push(event);
      return session;
    },
    listSessions() {
      return Array.from(sessions.values());
    },
    addAnnotation(sessionId, data) {
      const session = sessions.get(sessionId);
      if (!session) return void 0;
      const annotation = {
        ...data,
        id: generateId2(),
        sessionId,
        status: "pending",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      annotations.set(annotation.id, annotation);
      const event = eventBus.emit("annotation.created", sessionId, annotation);
      events.push(event);
      return annotation;
    },
    getAnnotation(id) {
      return annotations.get(id);
    },
    updateAnnotation(id, data) {
      const annotation = annotations.get(id);
      if (!annotation) return void 0;
      Object.assign(annotation, data, { updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      if (annotation.sessionId) {
        const event = eventBus.emit("annotation.updated", annotation.sessionId, annotation);
        events.push(event);
      }
      return annotation;
    },
    updateAnnotationStatus(id, status, resolvedBy) {
      const annotation = annotations.get(id);
      if (!annotation) return void 0;
      annotation.status = status;
      annotation.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (status === "resolved" || status === "dismissed") {
        annotation.resolvedAt = (/* @__PURE__ */ new Date()).toISOString();
        annotation.resolvedBy = resolvedBy || "agent";
      }
      if (annotation.sessionId) {
        const event = eventBus.emit("annotation.updated", annotation.sessionId, annotation);
        events.push(event);
      }
      return annotation;
    },
    addThreadMessage(annotationId, role, content) {
      const annotation = annotations.get(annotationId);
      if (!annotation) return void 0;
      const message = {
        id: generateId2(),
        role,
        content,
        timestamp: Date.now()
      };
      if (!annotation.thread) {
        annotation.thread = [];
      }
      annotation.thread.push(message);
      annotation.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (annotation.sessionId) {
        const event = eventBus.emit("thread.message", annotation.sessionId, message);
        events.push(event);
      }
      return annotation;
    },
    getPendingAnnotations(sessionId) {
      return Array.from(annotations.values()).filter(
        (a) => a.sessionId === sessionId && a.status === "pending"
      );
    },
    getSessionAnnotations(sessionId) {
      return Array.from(annotations.values()).filter(
        (a) => a.sessionId === sessionId
      );
    },
    deleteAnnotation(id) {
      const annotation = annotations.get(id);
      if (!annotation) return void 0;
      annotations.delete(id);
      if (annotation.sessionId) {
        const event = eventBus.emit("annotation.deleted", annotation.sessionId, annotation);
        events.push(event);
      }
      return annotation;
    },
    getEventsSince(sessionId, sequence) {
      return events.filter(
        (e) => e.sessionId === sessionId && e.sequence > sequence
      );
    },
    close() {
      sessions.clear();
      annotations.clear();
      events.length = 0;
    }
  };
}
function createSession(url, projectId) {
  return getStore().createSession(url, projectId);
}
function getSession(id) {
  return getStore().getSession(id);
}
function getSessionWithAnnotations(id) {
  return getStore().getSessionWithAnnotations(id);
}
function updateSessionStatus(id, status) {
  return getStore().updateSessionStatus(id, status);
}
function listSessions() {
  return getStore().listSessions();
}
function addAnnotation(sessionId, data) {
  return getStore().addAnnotation(sessionId, data);
}
function getAnnotation(id) {
  return getStore().getAnnotation(id);
}
function updateAnnotation(id, data) {
  return getStore().updateAnnotation(id, data);
}
function updateAnnotationStatus(id, status, resolvedBy) {
  return getStore().updateAnnotationStatus(id, status, resolvedBy);
}
function addThreadMessage(annotationId, role, content) {
  return getStore().addThreadMessage(annotationId, role, content);
}
function getPendingAnnotations(sessionId) {
  return getStore().getPendingAnnotations(sessionId);
}
function getSessionAnnotations(sessionId) {
  return getStore().getSessionAnnotations(sessionId);
}
function deleteAnnotation(id) {
  return getStore().deleteAnnotation(id);
}
function getEventsSince(sessionId, sequence) {
  return getStore().getEventsSince(sessionId, sequence);
}
function clearAll() {
  getStore().close();
  _store = null;
}
var _store, store;
var init_store = __esm({
  "src/server/store.ts"() {
    "use strict";
    init_events();
    _store = null;
    store = {
      get instance() {
        return getStore();
      }
    };
  }
});

// src/server/http.ts
function log(message) {
  process.stderr.write(message + "\n");
}
function setCloudApiKey(key) {
  cloudApiKey = key;
}
function isCloudMode() {
  return !!cloudApiKey;
}
function createMcpSession() {
  const transport = new import_streamableHttp.StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID()
  });
  const server = new import_server2.Server(
    { name: "agentation", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(import_types2.ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(import_types2.CallToolRequestSchema, async (req) => {
    try {
      return await handleTool(req.params.name, req.params.arguments);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(message);
    }
  });
  server.connect(transport);
  return { server, transport };
}
function getWebhookUrls() {
  const urls = [];
  const singleUrl = process.env.AGENTATION_WEBHOOK_URL;
  if (singleUrl) {
    urls.push(singleUrl.trim());
  }
  const multipleUrls = process.env.AGENTATION_WEBHOOKS;
  if (multipleUrls) {
    const parsed = multipleUrls.split(",").map((url) => url.trim()).filter((url) => url.length > 0);
    urls.push(...parsed);
  }
  return urls;
}
function sendWebhooks(actionRequest) {
  const webhookUrls = getWebhookUrls();
  if (webhookUrls.length === 0) {
    return;
  }
  const payload = JSON.stringify(actionRequest);
  for (const url of webhookUrls) {
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Agentation-Webhook/1.0"
      },
      body: payload
    }).then((res) => {
      log(
        `[Webhook] POST ${url} -> ${res.status} ${res.statusText}`
      );
    }).catch((err) => {
      console.error(`[Webhook] POST ${url} failed:`, err.message);
    });
  }
  log(
    `[Webhook] Fired ${webhookUrls.length} webhook(s) for session ${actionRequest.sessionId}`
  );
}
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => body += chunk);
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}
function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}
function handleCors(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Max-Age": "86400"
  });
  res.end();
}
function sendSSEEvent(res, event) {
  res.write(`event: ${event.type}
`);
  res.write(`id: ${event.sequence}
`);
  res.write(`data: ${JSON.stringify(event)}

`);
}
async function handleMcp(req, res) {
  const method = req.method || "GET";
  const sessionId = req.headers["mcp-session-id"];
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (method === "POST") {
    let transport;
    if (sessionId) {
      if (!mcpTransports.has(sessionId)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32e3, message: "Session not found. Please re-initialize." },
          id: null
        }));
        return;
      }
      transport = mcpTransports.get(sessionId);
    } else {
      const { transport: newTransport } = createMcpSession();
      transport = newTransport;
    }
    try {
      const body = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => data += chunk);
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });
      const parsedBody = body ? JSON.parse(body) : void 0;
      await transport.handleRequest(req, res, parsedBody);
      const newSessionId = transport.sessionId;
      if (newSessionId && !mcpTransports.has(newSessionId)) {
        mcpTransports.set(newSessionId, transport);
        log(`[MCP HTTP] New session created: ${newSessionId}`);
      }
    } catch (err) {
      console.error("[MCP HTTP] Error handling request:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
    return;
  }
  if (method === "GET") {
    if (!sessionId || !mcpTransports.has(sessionId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing or invalid Mcp-Session-Id" }));
      return;
    }
    const transport = mcpTransports.get(sessionId);
    try {
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("[MCP HTTP] Error handling SSE:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
    return;
  }
  if (method === "DELETE") {
    if (sessionId && mcpTransports.has(sessionId)) {
      const transport = mcpTransports.get(sessionId);
      await transport.close();
      mcpTransports.delete(sessionId);
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
    }
    return;
  }
  res.writeHead(405, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Method not allowed" }));
}
function matchRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (match) {
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return { handler: route.handler, params };
    }
  }
  return null;
}
function startHttpServer(port, apiKey2) {
  if (apiKey2) {
    setCloudApiKey(apiKey2);
  }
  const server = (0, import_http.createServer)(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const pathname = url.pathname;
    const method = req.method || "GET";
    if (method !== "OPTIONS" && pathname !== "/health") {
      log(`[HTTP] ${method} ${pathname}`);
    }
    if (method === "OPTIONS") {
      return handleCors(res);
    }
    if (pathname === "/health" && method === "GET") {
      return sendJson(res, 200, { status: "ok", mode: isCloudMode() ? "cloud" : "local" });
    }
    if (pathname === "/status" && method === "GET") {
      const webhookUrls = getWebhookUrls();
      return sendJson(res, 200, {
        mode: isCloudMode() ? "cloud" : "local",
        webhooksConfigured: webhookUrls.length > 0,
        webhookCount: webhookUrls.length,
        activeListeners: sseConnections.size,
        agentListeners: agentConnections.size
      });
    }
    if (pathname === "/mcp") {
      return handleMcp(req, res);
    }
    const match = matchRoute(method, pathname);
    if (!match) {
      return sendError(res, 404, "Not found");
    }
    try {
      await match.handler(req, res, match.params);
    } catch (err) {
      console.error("Request error:", err);
      sendError(res, 500, "Internal server error");
    }
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      log(`[HTTP] Port ${port} already in use \u2014 skipping HTTP server (MCP stdio still active)`);
    } else {
      log(`[HTTP] Server error: ${err.message}`);
    }
  });
  server.listen(port, () => {
    if (isCloudMode()) {
      log(`[HTTP] Agentation server listening on http://localhost:${port} (cloud mode)`);
    } else {
      log(`[HTTP] Agentation server listening on http://localhost:${port}`);
    }
  });
}
var import_http, import_streamableHttp, import_server2, import_types2, cloudApiKey, sseConnections, agentConnections, mcpTransports, createSessionHandler, listSessionsHandler, getSessionHandler, addAnnotationHandler, updateAnnotationHandler, getAnnotationHandler, deleteAnnotationHandler, getPendingHandler, getAllPendingHandler, requestActionHandler, addThreadHandler, sseHandler, globalSseHandler, routes;
var init_http = __esm({
  "src/server/http.ts"() {
    "use strict";
    import_http = require("http");
    import_streamableHttp = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
    import_server2 = require("@modelcontextprotocol/sdk/server/index.js");
    import_types2 = require("@modelcontextprotocol/sdk/types.js");
    init_mcp();
    init_store();
    init_events();
    sseConnections = /* @__PURE__ */ new Set();
    agentConnections = /* @__PURE__ */ new Set();
    mcpTransports = /* @__PURE__ */ new Map();
    createSessionHandler = async (req, res) => {
      try {
        const body = await parseBody(req);
        if (!body.url) {
          return sendError(res, 400, "url is required");
        }
        const session = createSession(body.url, body.projectId);
        sendJson(res, 201, session);
      } catch (err) {
        sendError(res, 400, err.message);
      }
    };
    listSessionsHandler = async (_req, res) => {
      const sessions = listSessions();
      sendJson(res, 200, sessions);
    };
    getSessionHandler = async (_req, res, params) => {
      const session = getSessionWithAnnotations(params.id);
      if (!session) {
        return sendError(res, 404, "Session not found");
      }
      sendJson(res, 200, session);
    };
    addAnnotationHandler = async (req, res, params) => {
      try {
        const body = await parseBody(req);
        if (!body.comment || !body.element || !body.elementPath) {
          return sendError(res, 400, "comment, element, and elementPath are required");
        }
        const annotation = addAnnotation(params.id, body);
        if (!annotation) {
          return sendError(res, 404, "Session not found");
        }
        sendJson(res, 201, annotation);
      } catch (err) {
        sendError(res, 400, err.message);
      }
    };
    updateAnnotationHandler = async (req, res, params) => {
      try {
        const body = await parseBody(req);
        const existing = getAnnotation(params.id);
        if (!existing) {
          return sendError(res, 404, "Annotation not found");
        }
        const annotation = updateAnnotation(params.id, body);
        sendJson(res, 200, annotation);
      } catch (err) {
        sendError(res, 400, err.message);
      }
    };
    getAnnotationHandler = async (_req, res, params) => {
      const annotation = getAnnotation(params.id);
      if (!annotation) {
        return sendError(res, 404, "Annotation not found");
      }
      sendJson(res, 200, annotation);
    };
    deleteAnnotationHandler = async (_req, res, params) => {
      const annotation = deleteAnnotation(params.id);
      if (!annotation) {
        return sendError(res, 404, "Annotation not found");
      }
      sendJson(res, 200, { deleted: true, annotationId: params.id });
    };
    getPendingHandler = async (_req, res, params) => {
      const pending = getPendingAnnotations(params.id);
      sendJson(res, 200, { count: pending.length, annotations: pending });
    };
    getAllPendingHandler = async (_req, res) => {
      const sessions = listSessions();
      const allPending = sessions.flatMap((session) => getPendingAnnotations(session.id));
      sendJson(res, 200, { count: allPending.length, annotations: allPending });
    };
    requestActionHandler = async (req, res, params) => {
      try {
        const sessionId = params.id;
        const body = await parseBody(req);
        const session = getSessionWithAnnotations(sessionId);
        if (!session) {
          return sendError(res, 404, "Session not found");
        }
        if (!body.output) {
          return sendError(res, 400, "output is required");
        }
        const actionRequest = {
          sessionId,
          annotations: session.annotations,
          output: body.output,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
        eventBus.emit("action.requested", sessionId, actionRequest);
        const webhookUrls = getWebhookUrls();
        sendWebhooks(actionRequest);
        const agentListeners = agentConnections.size;
        const webhooks = webhookUrls.length;
        sendJson(res, 200, {
          success: true,
          annotationCount: session.annotations.length,
          delivered: {
            sseListeners: agentListeners,
            webhooks,
            total: agentListeners + webhooks
          }
        });
      } catch (err) {
        sendError(res, 400, err.message);
      }
    };
    addThreadHandler = async (req, res, params) => {
      try {
        const body = await parseBody(req);
        if (!body.role || !body.content) {
          return sendError(res, 400, "role and content are required");
        }
        const annotation = addThreadMessage(params.id, body.role, body.content);
        if (!annotation) {
          return sendError(res, 404, "Annotation not found");
        }
        sendJson(res, 201, annotation);
      } catch (err) {
        sendError(res, 400, err.message);
      }
    };
    sseHandler = async (req, res, params) => {
      const sessionId = params.id;
      const url = new URL(req.url || "/", "http://localhost");
      const isAgent = url.searchParams.get("agent") === "true";
      const session = getSessionWithAnnotations(sessionId);
      if (!session) {
        return sendError(res, 404, "Session not found");
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      sseConnections.add(res);
      if (isAgent) {
        agentConnections.add(res);
      }
      res.write(": connected\n\n");
      const lastEventId = req.headers["last-event-id"];
      if (lastEventId) {
        const lastSequence = parseInt(lastEventId, 10);
        if (!isNaN(lastSequence)) {
          const missedEvents = getEventsSince(sessionId, lastSequence);
          for (const event of missedEvents) {
            sendSSEEvent(res, event);
          }
        }
      }
      const unsubscribe = eventBus.subscribeToSession(sessionId, (event) => {
        sendSSEEvent(res, event);
      });
      const keepAlive = setInterval(() => {
        res.write(": ping\n\n");
      }, 3e4);
      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
        sseConnections.delete(res);
        agentConnections.delete(res);
      });
    };
    globalSseHandler = async (req, res) => {
      const url = new URL(req.url || "/", "http://localhost");
      const domain = url.searchParams.get("domain");
      const isAgent = url.searchParams.get("agent") === "true";
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      sseConnections.add(res);
      if (isAgent) {
        agentConnections.add(res);
      }
      res.write(`: connected${domain ? ` to domain ${domain}` : ""}

`);
      if (isAgent) {
        let syncCount = 0;
        const sessions = listSessions();
        for (const session of sessions) {
          try {
            if (domain) {
              const sessionHost = new URL(session.url).host;
              if (sessionHost !== domain) continue;
            }
            const pending = getPendingAnnotations(session.id);
            for (const annotation of pending) {
              sendSSEEvent(res, {
                type: "annotation.created",
                sessionId: session.id,
                timestamp: annotation.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
                sequence: 0,
                payload: annotation
              });
              syncCount++;
            }
          } catch {
          }
        }
        res.write(`event: sync.complete
data: ${JSON.stringify({ domain: domain ?? "all", count: syncCount, timestamp: (/* @__PURE__ */ new Date()).toISOString() })}

`);
      }
      const unsubscribe = eventBus.subscribe((event) => {
        if (!domain) {
          sendSSEEvent(res, event);
          return;
        }
        const session = getSession(event.sessionId);
        if (session) {
          try {
            const sessionHost = new URL(session.url).host;
            if (sessionHost === domain) {
              sendSSEEvent(res, event);
            }
          } catch {
          }
        }
      });
      const keepAlive = setInterval(() => {
        res.write(": ping\n\n");
      }, 3e4);
      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
        sseConnections.delete(res);
        agentConnections.delete(res);
      });
    };
    routes = [
      {
        method: "GET",
        pattern: /^\/events$/,
        handler: globalSseHandler,
        paramNames: []
      },
      {
        method: "GET",
        pattern: /^\/pending$/,
        handler: getAllPendingHandler,
        paramNames: []
      },
      {
        method: "GET",
        pattern: /^\/sessions$/,
        handler: listSessionsHandler,
        paramNames: []
      },
      {
        method: "POST",
        pattern: /^\/sessions$/,
        handler: createSessionHandler,
        paramNames: []
      },
      {
        method: "GET",
        pattern: /^\/sessions\/([^/]+)$/,
        handler: getSessionHandler,
        paramNames: ["id"]
      },
      {
        method: "GET",
        pattern: /^\/sessions\/([^/]+)\/events$/,
        handler: sseHandler,
        paramNames: ["id"]
      },
      {
        method: "GET",
        pattern: /^\/sessions\/([^/]+)\/pending$/,
        handler: getPendingHandler,
        paramNames: ["id"]
      },
      {
        method: "POST",
        pattern: /^\/sessions\/([^/]+)\/action$/,
        handler: requestActionHandler,
        paramNames: ["id"]
      },
      {
        method: "POST",
        pattern: /^\/sessions\/([^/]+)\/annotations$/,
        handler: addAnnotationHandler,
        paramNames: ["id"]
      },
      {
        method: "PATCH",
        pattern: /^\/annotations\/([^/]+)$/,
        handler: updateAnnotationHandler,
        paramNames: ["id"]
      },
      {
        method: "GET",
        pattern: /^\/annotations\/([^/]+)$/,
        handler: getAnnotationHandler,
        paramNames: ["id"]
      },
      {
        method: "DELETE",
        pattern: /^\/annotations\/([^/]+)$/,
        handler: deleteAnnotationHandler,
        paramNames: ["id"]
      },
      {
        method: "POST",
        pattern: /^\/annotations\/([^/]+)\/thread$/,
        handler: addThreadHandler,
        paramNames: ["id"]
      }
    ];
  }
});

// src/server/index.ts
var server_exports = {};
__export(server_exports, {
  addAnnotation: () => addAnnotation,
  addThreadMessage: () => addThreadMessage,
  clearAll: () => clearAll,
  createSession: () => createSession,
  deleteAnnotation: () => deleteAnnotation,
  getAnnotation: () => getAnnotation,
  getEventsSince: () => getEventsSince,
  getPendingAnnotations: () => getPendingAnnotations,
  getSession: () => getSession,
  getSessionAnnotations: () => getSessionAnnotations,
  getSessionWithAnnotations: () => getSessionWithAnnotations,
  getStore: () => getStore,
  listSessions: () => listSessions,
  setApiKey: () => setApiKey,
  setCloudApiKey: () => setCloudApiKey,
  startHttpServer: () => startHttpServer,
  startMcpServer: () => startMcpServer,
  store: () => store,
  updateAnnotation: () => updateAnnotation,
  updateAnnotationStatus: () => updateAnnotationStatus,
  updateSessionStatus: () => updateSessionStatus
});
var init_server = __esm({
  "src/server/index.ts"() {
    "use strict";
    init_http();
    init_mcp();
    init_http();
    init_mcp();
    init_store();
  }
});

// src/cli.ts
var readline = __toESM(require("readline"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
var command = process.argv[2];
async function runInit() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const question = (q) => new Promise((resolve) => rl.question(q, resolve));
  console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                 Agentation MCP Setup Wizard                    \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const claudeConfigPath = path.join(homeDir, ".claude.json");
  const hasClaudeConfig = fs.existsSync(claudeConfigPath);
  if (hasClaudeConfig) {
    console.log(`\u2713 Found Claude Code config at ${claudeConfigPath}`);
  } else {
    console.log(`\u25CB No Claude Code config found at ${claudeConfigPath}`);
  }
  console.log();
  console.log(`The Agentation MCP server allows Claude Code to receive`);
  console.log(`real-time annotations and respond to feedback.`);
  console.log();
  const setupMcp = await question(`Set up MCP server integration? [Y/n] `);
  const wantsMcp = setupMcp.toLowerCase() !== "n";
  if (wantsMcp) {
    let port = 4747;
    const portAnswer = await question(`HTTP server port [4747]: `);
    if (portAnswer && !isNaN(parseInt(portAnswer, 10))) {
      port = parseInt(portAnswer, 10);
    }
    const mcpArgs = port === 4747 ? ["mcp", "add", "agentation", "--", "npx", "agentation-mcp", "server"] : ["mcp", "add", "agentation", "--", "npx", "agentation-mcp", "server", "--port", String(port)];
    console.log();
    console.log(`Running: claude ${mcpArgs.join(" ")}`);
    try {
      const result = (0, import_child_process.spawn)("claude", mcpArgs, { stdio: "inherit" });
      await new Promise((resolve, reject) => {
        result.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`claude mcp add exited with code ${code}`));
        });
        result.on("error", reject);
      });
      console.log(`\u2713 Registered agentation MCP server with Claude Code`);
    } catch (err) {
      console.log(`\u2717 Could not register MCP server automatically: ${err}`);
      console.log(`  You can register manually by running:`);
      console.log(`  claude mcp add agentation -- npx agentation-mcp server`);
    }
    console.log();
    const testNow = await question(`Start server and test connection? [Y/n] `);
    if (testNow.toLowerCase() !== "n") {
      console.log();
      console.log(`Starting server on port ${port}...`);
      const server = (0, import_child_process.spawn)("agentation-mcp", ["server", "--port", String(port)], {
        stdio: "inherit",
        detached: false
      });
      await new Promise((resolve) => setTimeout(resolve, 2e3));
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        if (response.ok) {
          console.log();
          console.log(`\u2713 Server is running on http://localhost:${port}`);
          console.log(`\u2713 MCP tools available to Claude Code`);
          console.log();
          console.log(`Press Ctrl+C to stop the server.`);
          await new Promise(() => {
          });
        } else {
          console.log(`\u2717 Server health check failed: ${response.status}`);
          server.kill();
        }
      } catch (err) {
        console.log(`\u2717 Could not connect to server: ${err}`);
        server.kill();
      }
    }
  }
  console.log();
  console.log(`Setup complete! Run 'agentation-mcp doctor' to verify your setup.`);
  rl.close();
}
async function runDoctor() {
  console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                    Agentation MCP Doctor                       \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D
`);
  let allPassed = true;
  const results = [];
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (majorVersion >= 18) {
    results.push({ name: "Node.js", status: "pass", message: `${nodeVersion} (18+ required)` });
  } else {
    results.push({ name: "Node.js", status: "fail", message: `${nodeVersion} (18+ required)` });
    allPassed = false;
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const claudeConfigPath = path.join(homeDir, ".claude.json");
  if (fs.existsSync(claudeConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(claudeConfigPath, "utf-8"));
      let found = false;
      if (config.mcpServers?.agentation) {
        found = true;
      }
      if (!found && config.projects) {
        for (const proj of Object.values(config.projects)) {
          if (proj.mcpServers?.agentation) {
            found = true;
            break;
          }
        }
      }
      if (found) {
        results.push({ name: "Claude Code config", status: "pass", message: "MCP server configured" });
      } else {
        results.push({ name: "Claude Code config", status: "warn", message: "Config exists but no agentation MCP entry. Run: claude mcp add agentation -- npx agentation-mcp server" });
      }
    } catch {
      results.push({ name: "Claude Code config", status: "fail", message: "Could not parse config file" });
      allPassed = false;
    }
  } else {
    results.push({ name: "Claude Code config", status: "warn", message: "No config found at ~/.claude.json. Run: claude mcp add agentation -- npx agentation-mcp server" });
  }
  const oldConfigPath = path.join(homeDir, ".claude", "claude_code_config.json");
  if (fs.existsSync(oldConfigPath)) {
    results.push({ name: "Stale config", status: "warn", message: `${oldConfigPath} exists but Claude Code doesn't read this file. Safe to delete.` });
  }
  try {
    const response = await fetch("http://localhost:4747/health", { signal: AbortSignal.timeout(2e3) });
    if (response.ok) {
      results.push({ name: "Server (port 4747)", status: "pass", message: "Running and healthy" });
    } else {
      results.push({ name: "Server (port 4747)", status: "warn", message: `Responded with ${response.status}` });
    }
  } catch {
    results.push({ name: "Server (port 4747)", status: "warn", message: "Not running (start with: agentation-mcp server)" });
  }
  for (const r of results) {
    const icon = r.status === "pass" ? "\u2713" : r.status === "fail" ? "\u2717" : "\u25CB";
    const color = r.status === "pass" ? "\x1B[32m" : r.status === "fail" ? "\x1B[31m" : "\x1B[33m";
    console.log(`${color}${icon}\x1B[0m ${r.name}: ${r.message}`);
  }
  console.log();
  if (allPassed) {
    console.log(`All checks passed!`);
  } else {
    console.log(`Some checks failed. Run 'agentation-mcp init' to fix.`);
    process.exit(1);
  }
}
if (command === "init") {
  runInit().catch((err) => {
    console.error("Init failed:", err);
    process.exit(1);
  });
} else if (command === "doctor") {
  runDoctor().catch((err) => {
    console.error("Doctor failed:", err);
    process.exit(1);
  });
} else if (command === "server") {
  Promise.resolve().then(() => (init_server(), server_exports)).then(({ startHttpServer: startHttpServer2, startMcpServer: startMcpServer2, setApiKey: setApiKey3 }) => {
    const args = process.argv.slice(3);
    let port = 4747;
    let mcpOnly = false;
    let httpUrl = "http://localhost:4747";
    let apiKeyArg;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--port" && args[i + 1]) {
        const parsed = parseInt(args[i + 1], 10);
        if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
          port = parsed;
          if (!args.includes("--http-url")) {
            httpUrl = `http://localhost:${port}`;
          }
        }
        i++;
      }
      if (args[i] === "--mcp-only") {
        mcpOnly = true;
      }
      if (args[i] === "--http-url" && args[i + 1]) {
        httpUrl = args[i + 1];
        i++;
      }
      if (args[i] === "--api-key" && args[i + 1]) {
        apiKeyArg = args[i + 1];
        i++;
      }
    }
    const apiKey2 = apiKeyArg || process.env.AGENTATION_API_KEY;
    if (apiKey2) {
      setApiKey3(apiKey2);
    }
    if (!mcpOnly) {
      startHttpServer2(port, apiKey2);
    }
    startMcpServer2(httpUrl).catch((err) => {
      console.error("MCP server error:", err);
      process.exit(1);
    });
  });
} else if (command === "help" || command === "--help" || command === "-h" || !command) {
  console.log(`
agentation-mcp - MCP server for Agentation visual feedback

Usage:
  agentation-mcp init                    Interactive setup wizard
  agentation-mcp server [options]        Start the annotation server
  agentation-mcp doctor                  Check your setup and diagnose issues
  agentation-mcp help                    Show this help message

Server Options:
  --port <port>      HTTP server port (default: 4747)
  --mcp-only         Skip HTTP server, only run MCP on stdio
  --http-url <url>   HTTP server URL for MCP to fetch from
  --api-key <key>    API key for cloud storage (or set AGENTATION_API_KEY env var)

Commands:
  init      Guided setup that configures Claude Code to use the MCP server.
            Registers the server via 'claude mcp add'.

  server    Starts both an HTTP server and MCP server for collecting annotations.
            The HTTP server receives annotations from the React component.
            The MCP server exposes tools for Claude Code to read/act on annotations.

  doctor    Runs diagnostic checks on your setup:
            - Node.js version
            - Claude Code configuration
            - Server connectivity

Examples:
  agentation-mcp init                Set up Agentation MCP
  agentation-mcp server              Start server on default port 4747
  agentation-mcp server --port 8080  Start server on port 8080
  agentation-mcp doctor              Check if everything is configured correctly

  # Use cloud storage with API key (local server proxies to cloud)
  agentation-mcp server --api-key ag_xxx

  # Or using environment variable
  AGENTATION_API_KEY=ag_xxx agentation-mcp server
`);
} else {
  console.error(`Unknown command: ${command}`);
  console.error("Run 'agentation-mcp help' for usage information.");
  process.exit(1);
}
//# sourceMappingURL=cli.js.map