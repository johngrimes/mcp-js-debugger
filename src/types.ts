/**
 * Core type definitions for the WebKit Debug MCP Server.
 *
 * @author John Grimes
 */

/**
 * State of a debugging session.
 */
export enum SessionState {
  CONNECTING = "connecting",
  CONNECTED = "connected",
  PAUSED = "paused",
  RUNNING = "running",
  DISCONNECTED = "disconnected",
}

/**
 * Information about a breakpoint.
 */
export interface BreakpointInfo {
  id: string;
  url: string;
  lineNumber: number;
  columnNumber?: number;
  condition?: string;
  enabled: boolean;
  locations: BreakpointLocation[];
}

/**
 * Resolved location of a breakpoint.
 */
export interface BreakpointLocation {
  scriptId: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * Call frame from the debugger.
 */
export interface CallFrame {
  callFrameId: string;
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  thisObject: RemoteObject;
  scopeChain: Scope[];
}

/**
 * Scope information.
 */
export interface Scope {
  type: "global" | "local" | "with" | "closure" | "catch" | "block" | "script";
  object: RemoteObject;
  name?: string;
}

/**
 * Remote object representation from the debugger.
 */
export interface RemoteObject {
  type: "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";
  subtype?: "array" | "null" | "node" | "regexp" | "date" | "map" | "set" | "weakmap" | "weakset" | "iterator" | "generator" | "error" | "proxy" | "promise" | "typedarray" | "arraybuffer" | "dataview";
  className?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
}

/**
 * State when execution is paused.
 */
export interface PausedState {
  reason: string;
  callFrames: CallFrame[];
  asyncStackTrace?: AsyncStackTrace;
  data?: Record<string, unknown>;
}

/**
 * Async stack trace information.
 */
export interface AsyncStackTrace {
  description?: string;
  callFrames: CallFrame[];
  parent?: AsyncStackTrace;
}

/**
 * Information about a parsed script.
 */
export interface ScriptInfo {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  sourceMapURL?: string;
}

/**
 * WebKit Inspector Protocol message format.
 */
export interface ProtocolMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: ProtocolError;
}

/**
 * Protocol error response.
 */
export interface ProtocolError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Pending command waiting for response.
 */
export interface PendingCommand {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Server configuration options.
 */
export interface ServerConfig {
  /**
   * MCP transport type.
   */
  transport: "stdio" | "http";

  /**
   * Port for HTTP transport.
   */
  httpPort?: number;

  /**
   * WebSocket connection timeout in milliseconds.
   */
  connectionTimeout: number;

  /**
   * Command response timeout in milliseconds.
   */
  commandTimeout: number;

  /**
   * Number of reconnection attempts.
   */
  reconnectAttempts: number;

  /**
   * Delay between reconnection attempts in milliseconds.
   */
  reconnectDelay: number;

  /**
   * Allowed hosts for WebSocket connections.
   */
  allowedHosts: string[];

  /**
   * Whether to require confirmation for remote connections.
   */
  requireConfirmationForRemote: boolean;

  /**
   * Maximum number of concurrent sessions.
   */
  maxConcurrentSessions: number;

  /**
   * Session idle timeout in milliseconds.
   */
  sessionIdleTimeout: number;

  /**
   * Logging level.
   */
  logLevel: "debug" | "info" | "warn" | "error";

  /**
   * Whether to log protocol messages.
   */
  logProtocolMessages: boolean;
}

/**
 * Error codes used by the server.
 */
export enum ErrorCode {
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
  SESSION_INVALID_STATE = "SESSION_INVALID_STATE",
  CONNECTION_FAILED = "CONNECTION_FAILED",
  PROTOCOL_ERROR = "PROTOCOL_ERROR",
  INVALID_PARAMETERS = "INVALID_PARAMETERS",
  TIMEOUT = "TIMEOUT",
  MAX_SESSIONS_REACHED = "MAX_SESSIONS_REACHED",
}

/**
 * Custom error class for debugger operations.
 */
export class DebuggerError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DebuggerError";
  }
}

/**
 * Event types emitted by the WebSocket client.
 */
export type DebuggerEvent =
  | { type: "paused"; data: PausedState }
  | { type: "resumed" }
  | { type: "scriptParsed"; data: ScriptInfo }
  | { type: "breakpointResolved"; data: { breakpointId: string; location: BreakpointLocation } }
  | { type: "disconnected"; reason?: string };

/**
 * Listener for debugger events.
 */
export type DebuggerEventListener = (event: DebuggerEvent) => void;

/**
 * Default server configuration.
 */
export const DEFAULT_CONFIG: ServerConfig = {
  transport: "stdio",
  connectionTimeout: 10000,
  commandTimeout: 5000,
  reconnectAttempts: 3,
  reconnectDelay: 1000,
  allowedHosts: ["localhost", "127.0.0.1", "::1"],
  requireConfirmationForRemote: true,
  maxConcurrentSessions: 10,
  sessionIdleTimeout: 3600000, // 1 hour
  logLevel: "info",
  logProtocolMessages: false,
};
