/*
 * Copyright 2025 John Grimes
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Type definitions for the CDP Debug MCP Server.
 *
 * @author John Grimes
 */

import type {Protocol} from 'devtools-protocol';

/**
 * Represents the state of a debugging session.
 */
export enum SessionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  PAUSED = 'paused',
  RUNNING = 'running',
  DISCONNECTED = 'disconnected',
}

/**
 * Information about a breakpoint set in a debugging session.
 */
export interface BreakpointInfo {
  id: string;
  url: string;
  lineNumber: number;
  columnNumber?: number;
  condition?: string;
  enabled: boolean;
  resolvedLocations: Array<{
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  }>;
}

/**
 * Information about a loaded script.
 */
export interface ScriptInfo {
  scriptId: string;
  url: string;
  sourceMapUrl?: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  hash: string;
  isModule?: boolean;
  length?: number;
}

/**
 * Represents the paused state when execution is stopped.
 */
export interface PausedState {
  reason: string;
  callFrames: Protocol.Debugger.CallFrame[];
  asyncStackTrace?: Protocol.Runtime.StackTrace;
  data?: object;
  hitBreakpoints?: string[];
}

/**
 * Represents a debugging session.
 */
export interface DebugSession {
  id: string;
  name?: string;
  targetUrl: string;
  state: SessionState;
  breakpoints: Map<string, BreakpointInfo>;
  scripts: Map<string, ScriptInfo>;
  pausedState?: PausedState;
  createdAt: Date;
}

/**
 * Original source location from source map mapping.
 */
export interface OriginalLocation {
  source: string;
  line: number | null;
  column: number | null;
  name: string | null;
}

/**
 * Enriched call frame with both generated and original locations.
 */
export interface EnrichedCallFrame {
  callFrameId: string;
  functionName: string;
  generatedLocation: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  };
  originalLocation?: {
    sourceUrl: string;
    lineNumber: number;
    columnNumber: number;
    functionName?: string;
  };
  scopeChain: Protocol.Debugger.Scope[];
  this: Protocol.Runtime.RemoteObject;
}

/**
 * Error codes returned by the MCP server.
 */
export enum ErrorCode {
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_INVALID_STATE = 'SESSION_INVALID_STATE',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  PROTOCOL_ERROR = 'PROTOCOL_ERROR',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  TIMEOUT = 'TIMEOUT',
  BREAKPOINT_NOT_FOUND = 'BREAKPOINT_NOT_FOUND',
  SCRIPT_NOT_FOUND = 'SCRIPT_NOT_FOUND',
  SOURCE_MAP_ERROR = 'SOURCE_MAP_ERROR',
}

/**
 * Error response structure.
 */
export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: {
      sessionId?: string;
      protocolError?: {
        code: number;
        message: string;
      };
    };
  };
}

/**
 * Session summary for listing sessions.
 */
export interface SessionSummary {
  id: string;
  name?: string;
  targetUrl: string;
  state: SessionState;
  pauseReason?: string;
  scriptUrl?: string;
  lineNumber?: number;
}

/**
 * Detailed session information including breakpoints and call stack.
 */
export interface SessionDetails {
  id: string;
  name?: string;
  targetUrl: string;
  state: SessionState;
  breakpoints: Array<{
    id: string;
    scriptUrl: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
    enabled: boolean;
  }>;
  callStack?: EnrichedCallFrame[];
  pauseReason?: string;
}
