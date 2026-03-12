/**
 * Create and start the HTTP server.
 * @param port - Port to listen on
 * @param apiKey - Optional API key for cloud storage mode
 */
declare function startHttpServer(port: number, apiKey?: string): void;

/**
 * Create and start the MCP server on stdio.
 * @param baseUrl - Optional HTTP server URL to fetch from (default: http://localhost:4747)
 */
declare function startMcpServer(baseUrl?: string): Promise<void>;

type Annotation = {
    id: string;
    x: number;
    y: number;
    comment: string;
    element: string;
    elementPath: string;
    timestamp: number;
    selectedText?: string;
    boundingBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    nearbyText?: string;
    cssClasses?: string;
    nearbyElements?: string;
    computedStyles?: string;
    fullPath?: string;
    accessibility?: string;
    isMultiSelect?: boolean;
    isFixed?: boolean;
    reactComponents?: string;
    sessionId?: string;
    url?: string;
    intent?: AnnotationIntent;
    severity?: AnnotationSeverity;
    status?: AnnotationStatus;
    thread?: ThreadMessage[];
    createdAt?: string;
    updatedAt?: string;
    resolvedAt?: string;
    resolvedBy?: "human" | "agent";
    authorId?: string;
};
type AnnotationIntent = "fix" | "change" | "question" | "approve";
type AnnotationSeverity = "blocking" | "important" | "suggestion";
type AnnotationStatus = "pending" | "acknowledged" | "resolved" | "dismissed";
type Session = {
    id: string;
    url: string;
    status: SessionStatus;
    createdAt: string;
    updatedAt?: string;
    projectId?: string;
    metadata?: Record<string, unknown>;
};
type SessionStatus = "active" | "approved" | "closed";
type SessionWithAnnotations = Session & {
    annotations: Annotation[];
};
type ThreadMessage = {
    id: string;
    role: "human" | "agent";
    content: string;
    timestamp: number;
};
type AFSEventType = "annotation.created" | "annotation.updated" | "annotation.deleted" | "session.created" | "session.updated" | "session.closed" | "thread.message" | "action.requested";
type ActionRequest = {
    sessionId: string;
    annotations: Annotation[];
    output: string;
    timestamp: string;
};
type AFSEvent = {
    type: AFSEventType;
    timestamp: string;
    sessionId: string;
    sequence: number;
    payload: Annotation | Session | ThreadMessage | ActionRequest;
};
type Organization = {
    id: string;
    name: string;
    createdAt: string;
    updatedAt?: string;
};
type UserRole = "owner" | "admin" | "member";
type User = {
    id: string;
    email: string;
    orgId: string;
    role: UserRole;
    createdAt: string;
    updatedAt?: string;
};
type ApiKey = {
    id: string;
    keyPrefix: string;
    keyHash: string;
    userId: string;
    name: string;
    createdAt: string;
    expiresAt?: string;
    lastUsedAt?: string;
};
type UserContext = {
    userId: string;
    orgId: string;
    email?: string;
    role?: UserRole;
};
interface AFSStore {
    createSession(url: string, projectId?: string): Session;
    getSession(id: string): Session | undefined;
    getSessionWithAnnotations(id: string): SessionWithAnnotations | undefined;
    updateSessionStatus(id: string, status: SessionStatus): Session | undefined;
    listSessions(): Session[];
    addAnnotation(sessionId: string, data: Omit<Annotation, "id" | "sessionId" | "status" | "createdAt">): Annotation | undefined;
    getAnnotation(id: string): Annotation | undefined;
    updateAnnotation(id: string, data: Partial<Omit<Annotation, "id" | "sessionId" | "createdAt">>): Annotation | undefined;
    updateAnnotationStatus(id: string, status: AnnotationStatus, resolvedBy?: "human" | "agent"): Annotation | undefined;
    addThreadMessage(annotationId: string, role: "human" | "agent", content: string): Annotation | undefined;
    getPendingAnnotations(sessionId: string): Annotation[];
    getSessionAnnotations(sessionId: string): Annotation[];
    deleteAnnotation(id: string): Annotation | undefined;
    getEventsSince(sessionId: string, sequence: number): AFSEvent[];
    close(): void;
}

/**
 * Store module - provides persistence for sessions and annotations.
 *
 * By default uses SQLite (~/.agentation/store.db).
 * Falls back to in-memory storage if SQLite fails to initialize.
 *
 * Usage:
 *   import { store } from './store.js';
 *   const session = store.createSession('http://localhost:3000');
 */

/**
 * Get the store instance. Lazily initializes on first access.
 */
declare function getStore(): AFSStore;
declare const store: {
    readonly instance: AFSStore;
};
declare function createSession(url: string, projectId?: string): Session;
declare function getSession(id: string): Session | undefined;
declare function getSessionWithAnnotations(id: string): SessionWithAnnotations | undefined;
declare function updateSessionStatus(id: string, status: SessionStatus): Session | undefined;
declare function listSessions(): Session[];
declare function addAnnotation(sessionId: string, data: Omit<Annotation, "id" | "sessionId" | "status" | "createdAt">): Annotation | undefined;
declare function getAnnotation(id: string): Annotation | undefined;
declare function updateAnnotation(id: string, data: Partial<Omit<Annotation, "id" | "sessionId" | "createdAt">>): Annotation | undefined;
declare function updateAnnotationStatus(id: string, status: AnnotationStatus, resolvedBy?: "human" | "agent"): Annotation | undefined;
declare function addThreadMessage(annotationId: string, role: "human" | "agent", content: string): Annotation | undefined;
declare function getPendingAnnotations(sessionId: string): Annotation[];
declare function getSessionAnnotations(sessionId: string): Annotation[];
declare function deleteAnnotation(id: string): Annotation | undefined;
declare function getEventsSince(sessionId: string, sequence: number): AFSEvent[];
/**
 * Clear all data and reset the store.
 */
declare function clearAll(): void;

/**
 * EventBus for real-time event distribution.
 * Coordinates SSE streams, MCP notifications, and future webhooks.
 */

type EventHandler = (event: AFSEvent) => void;
/**
 * Simple pub/sub event bus for AFS events.
 */
declare class EventBus {
    private handlers;
    private sessionHandlers;
    /**
     * Subscribe to all events.
     */
    subscribe(handler: EventHandler): () => void;
    /**
     * Subscribe to events for a specific session.
     */
    subscribeToSession(sessionId: string, handler: EventHandler): () => void;
    /**
     * Emit an event to all subscribers.
     */
    emit(type: AFSEventType, sessionId: string, payload: Annotation | Session | ThreadMessage | ActionRequest): AFSEvent;
    /**
     * Get current sequence number (for reconnect logic).
     */
    getSequence(): number;
    /**
     * Set sequence from persisted state (for server restart).
     */
    setSequence(seq: number): void;
}
declare const eventBus: EventBus;
/**
 * User-scoped event bus that filters events by user ID.
 * Prevents data leakage between users in multi-tenant environments.
 */
declare class UserEventBus {
    private userHandlers;
    private userSessionHandlers;
    /**
     * Subscribe to all events for a specific user.
     */
    subscribeForUser(userId: string, handler: EventHandler): () => void;
    /**
     * Subscribe to events for a specific session of a specific user.
     */
    subscribeToSessionForUser(userId: string, sessionId: string, handler: EventHandler): () => void;
    /**
     * Emit an event scoped to a specific user.
     * Only handlers for that user will receive the event.
     */
    emitForUser(userId: string, type: AFSEventType, sessionId: string, payload: Annotation | Session | ThreadMessage | ActionRequest): AFSEvent;
    /**
     * Check if a user has any active listeners.
     */
    hasListenersForUser(userId: string): boolean;
    /**
     * Get count of listeners for a user.
     */
    getListenerCountForUser(userId: string): number;
}
declare const userEventBus: UserEventBus;

/**
 * SQLite-backed store for sessions, annotations, and events.
 * Provides persistence across server restarts.
 */

interface TenantStore {
    createOrganization(name: string): Organization;
    getOrganization(id: string): Organization | undefined;
    createUser(email: string, orgId: string, role?: UserRole): User;
    getUser(id: string): User | undefined;
    getUserByEmail(email: string): User | undefined;
    getUsersByOrg(orgId: string): User[];
    createApiKey(userId: string, name: string, expiresAt?: string): {
        apiKey: ApiKey;
        rawKey: string;
    };
    getApiKeyByHash(hash: string): ApiKey | undefined;
    listApiKeys(userId: string): ApiKey[];
    deleteApiKey(id: string): boolean;
    updateApiKeyLastUsed(id: string): void;
    createSessionForUser(userId: string, url: string, projectId?: string): Session;
    listSessionsForUser(userId: string): Session[];
    getSessionForUser(userId: string, sessionId: string): Session | undefined;
    getSessionWithAnnotationsForUser(userId: string, sessionId: string): SessionWithAnnotations | undefined;
    getPendingAnnotationsForUser(userId: string, sessionId: string): Annotation[];
    getAllPendingForUser(userId: string): Annotation[];
    close(): void;
}

/**
 * Get the tenant store instance. Lazily initializes on first access.
 */
declare function getTenantStore(): TenantStore;
/**
 * Reset the tenant store singleton (for testing).
 */
declare function resetTenantStore(): void;
/**
 * Hash an API key for lookup.
 * Used by auth middleware to find the key in the database.
 */
declare function hashApiKey(rawKey: string): string;
/**
 * Validate API key format.
 */
declare function isValidApiKeyFormat(key: string): boolean;
/**
 * Create a UserContext from a User and Organization.
 */
declare function createUserContext(user: User): UserContext;
declare function createOrganization(name: string): Organization;
declare function getOrganization(id: string): Organization | undefined;
declare function createUser(email: string, orgId: string, role?: UserRole): User;
declare function getUser(id: string): User | undefined;
declare function getUserByEmail(email: string): User | undefined;
declare function getUsersByOrg(orgId: string): User[];
declare function createApiKey(userId: string, name: string, expiresAt?: string): {
    apiKey: ApiKey;
    rawKey: string;
};
declare function getApiKeyByHash(hash: string): ApiKey | undefined;
declare function listApiKeys(userId: string): ApiKey[];
declare function deleteApiKey(id: string): boolean;
declare function updateApiKeyLastUsed(id: string): void;
declare function createSessionForUser(userId: string, url: string, projectId?: string): Session;
declare function listSessionsForUser(userId: string): Session[];
declare function getSessionForUser(userId: string, sessionId: string): Session | undefined;
declare function getSessionWithAnnotationsForUser(userId: string, sessionId: string): SessionWithAnnotations | undefined;
declare function getPendingAnnotationsForUser(userId: string, sessionId: string): Annotation[];
declare function getAllPendingForUser(userId: string): Annotation[];

export { type AFSEvent, type AFSEventType, type AFSStore, type ActionRequest, type Annotation, type AnnotationIntent, type AnnotationSeverity, type AnnotationStatus, type ApiKey, type Organization, type Session, type SessionStatus, type SessionWithAnnotations, type TenantStore, type ThreadMessage, type User, type UserContext, type UserRole, addAnnotation, addThreadMessage, clearAll, createApiKey, createOrganization, createSession, createSessionForUser, createUser, createUserContext, deleteAnnotation, deleteApiKey, eventBus, getAllPendingForUser, getAnnotation, getApiKeyByHash, getEventsSince, getOrganization, getPendingAnnotations, getPendingAnnotationsForUser, getSession, getSessionAnnotations, getSessionForUser, getSessionWithAnnotations, getSessionWithAnnotationsForUser, getStore, getTenantStore, getUser, getUserByEmail, getUsersByOrg, hashApiKey, isValidApiKeyFormat, listApiKeys, listSessions, listSessionsForUser, resetTenantStore, startHttpServer, startMcpServer, store, updateAnnotation, updateAnnotationStatus, updateApiKeyLastUsed, updateSessionStatus, userEventBus };
