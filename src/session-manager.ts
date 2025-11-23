/**
 * Session manager for managing multiple debugging sessions.
 *
 * @author John Grimes
 */

import { v4 as uuidv4 } from "uuid";
import { WebSocketClient } from "./websocket-client.js";
import {
  type BreakpointInfo,
  type PausedState,
  type ScriptInfo,
  type ServerConfig,
  type DebuggerEvent,
  type RemoteObject,
  type CallFrame,
  SessionState,
  DebuggerError,
  ErrorCode,
  DEFAULT_CONFIG,
} from "./types.js";
import { Logger, logger as rootLogger } from "./logger.js";

/**
 * Represents an active debugging session.
 */
export interface DebugSession {
  id: string;
  name?: string;
  targetUrl: string;
  wsClient: WebSocketClient;
  state: SessionState;
  breakpoints: Map<string, BreakpointInfo>;
  scripts: Map<string, ScriptInfo>;
  pausedState?: PausedState;
  createdAt: Date;
  lastActivityAt: Date;
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
 * Session details for detailed inspection.
 */
export interface SessionDetails {
  id: string;
  name?: string;
  targetUrl: string;
  state: SessionState;
  breakpoints: BreakpointInfo[];
  callStack?: CallFrame[];
  pauseReason?: string;
}

/**
 * Result from setting a breakpoint.
 */
export interface SetBreakpointResult {
  breakpointId: string;
  locations: Array<{
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  }>;
}

/**
 * Result from evaluating an expression.
 */
export interface EvaluateResult {
  result: RemoteObject;
  exceptionDetails?: {
    text: string;
    lineNumber: number;
    columnNumber: number;
    exception?: RemoteObject;
  };
}

/**
 * Variable in a scope.
 */
export interface ScopeVariable {
  name: string;
  value: RemoteObject;
}

/**
 * Event listener for session state changes.
 */
export type SessionEventListener = (
  sessionId: string,
  event: "paused" | "resumed" | "disconnected",
  data?: Record<string, unknown>,
) => void;

/**
 * Manages multiple debugging sessions.
 */
export class SessionManager {
  private readonly sessions = new Map<string, DebugSession>();
  private readonly config: ServerConfig;
  private readonly logger: Logger;
  private readonly eventListeners: SessionEventListener[] = [];

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = rootLogger.child("SessionManager");
  }

  /**
   * Connect to a new debugging target.
   */
  async connect(targetUrl: string, sessionName?: string): Promise<DebugSession> {
    // Validate URL.
    this.validateTargetUrl(targetUrl);

    // Check session limit.
    if (this.sessions.size >= this.config.maxConcurrentSessions) {
      throw new DebuggerError(
        ErrorCode.MAX_SESSIONS_REACHED,
        `Maximum concurrent sessions (${this.config.maxConcurrentSessions}) reached`,
      );
    }

    const sessionId = uuidv4();
    this.logger.info("Creating new debugging session", { sessionId, targetUrl, sessionName });

    const wsClient = new WebSocketClient(
      targetUrl,
      this.config.connectionTimeout,
      this.config.commandTimeout,
      this.config.reconnectAttempts,
      this.config.reconnectDelay,
    );

    const session: DebugSession = {
      id: sessionId,
      name: sessionName,
      targetUrl,
      wsClient,
      state: SessionState.CONNECTING,
      breakpoints: new Map(),
      scripts: new Map(),
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    // Set up event listener before connecting.
    wsClient.addEventListener((event) => this.handleSessionEvent(session, event));

    try {
      await wsClient.connect();
      session.state = SessionState.CONNECTED;
      this.sessions.set(sessionId, session);
      this.logger.info("Session connected successfully", { sessionId });
      return session;
    } catch (error) {
      session.state = SessionState.DISCONNECTED;
      throw error;
    }
  }

  /**
   * Disconnect a debugging session.
   */
  async disconnect(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);

    this.logger.info("Disconnecting session", { sessionId });

    await session.wsClient.disconnect();
    session.state = SessionState.DISCONNECTED;
    this.sessions.delete(sessionId);

    this.logger.info("Session disconnected", { sessionId });
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): DebugSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new DebuggerError(ErrorCode.SESSION_NOT_FOUND, `Session not found: ${sessionId}`);
    }
    session.lastActivityAt = new Date();
    return session;
  }

  /**
   * List all active sessions.
   */
  listSessions(): SessionSummary[] {
    return Array.from(this.sessions.values()).map((session) => {
      const summary: SessionSummary = {
        id: session.id,
        name: session.name,
        targetUrl: session.targetUrl,
        state: session.state,
      };

      if (session.pausedState) {
        summary.pauseReason = session.pausedState.reason;
        if (session.pausedState.callFrames.length > 0) {
          const topFrame = session.pausedState.callFrames[0];
          summary.scriptUrl = topFrame.url;
          summary.lineNumber = topFrame.lineNumber;
        }
      }

      return summary;
    });
  }

  /**
   * Get detailed session information.
   */
  getSessionDetails(sessionId: string): SessionDetails {
    const session = this.getSession(sessionId);

    const details: SessionDetails = {
      id: session.id,
      name: session.name,
      targetUrl: session.targetUrl,
      state: session.state,
      breakpoints: Array.from(session.breakpoints.values()),
    };

    if (session.pausedState) {
      details.pauseReason = session.pausedState.reason;
      details.callStack = session.pausedState.callFrames;
    }

    return details;
  }

  /**
   * Set a breakpoint.
   */
  async setBreakpoint(
    sessionId: string,
    url: string,
    lineNumber: number,
    columnNumber?: number,
    condition?: string,
    ignoreCount?: number,
  ): Promise<SetBreakpointResult> {
    const session = this.getSession(sessionId);
    this.requireState(session, [SessionState.CONNECTED, SessionState.PAUSED, SessionState.RUNNING]);

    const params: Record<string, unknown> = {
      lineNumber,
      url,
    };

    if (columnNumber !== undefined) {
      params.columnNumber = columnNumber;
    }
    if (condition) {
      params.condition = condition;
    }
    if (ignoreCount !== undefined && ignoreCount > 0) {
      params.options = { ignoreCount };
    }

    this.logger.debug("Setting breakpoint", { sessionId, url, lineNumber, condition });

    const result = await session.wsClient.sendCommand<{
      breakpointId: string;
      locations: Array<{ scriptId: string; lineNumber: number; columnNumber: number }>;
    }>("Debugger.setBreakpointByUrl", params);

    // Store breakpoint info.
    const breakpointInfo: BreakpointInfo = {
      id: result.breakpointId,
      url,
      lineNumber,
      columnNumber,
      condition,
      enabled: true,
      locations: result.locations,
    };
    session.breakpoints.set(result.breakpointId, breakpointInfo);

    this.logger.info("Breakpoint set", { sessionId, breakpointId: result.breakpointId });

    return result;
  }

  /**
   * Remove a breakpoint.
   */
  async removeBreakpoint(sessionId: string, breakpointId: string): Promise<void> {
    const session = this.getSession(sessionId);
    this.requireState(session, [SessionState.CONNECTED, SessionState.PAUSED, SessionState.RUNNING]);

    this.logger.debug("Removing breakpoint", { sessionId, breakpointId });

    await session.wsClient.sendCommand("Debugger.removeBreakpoint", { breakpointId });
    session.breakpoints.delete(breakpointId);

    this.logger.info("Breakpoint removed", { sessionId, breakpointId });
  }

  /**
   * List all breakpoints in a session.
   */
  listBreakpoints(sessionId: string): BreakpointInfo[] {
    const session = this.getSession(sessionId);
    return Array.from(session.breakpoints.values());
  }

  /**
   * Resume execution.
   */
  async resume(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    this.requireState(session, [SessionState.PAUSED]);

    this.logger.debug("Resuming execution", { sessionId });
    await session.wsClient.sendCommand("Debugger.resume");
  }

  /**
   * Step over the current statement.
   */
  async stepOver(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    this.requireState(session, [SessionState.PAUSED]);

    this.logger.debug("Stepping over", { sessionId });
    await session.wsClient.sendCommand("Debugger.stepOver");
  }

  /**
   * Step into a function call.
   */
  async stepInto(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    this.requireState(session, [SessionState.PAUSED]);

    this.logger.debug("Stepping into", { sessionId });
    await session.wsClient.sendCommand("Debugger.stepInto");
  }

  /**
   * Step out of the current function.
   */
  async stepOut(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    this.requireState(session, [SessionState.PAUSED]);

    this.logger.debug("Stepping out", { sessionId });
    await session.wsClient.sendCommand("Debugger.stepOut");
  }

  /**
   * Pause execution.
   */
  async pause(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    this.requireState(session, [SessionState.CONNECTED, SessionState.RUNNING]);

    this.logger.debug("Pausing execution", { sessionId });
    await session.wsClient.sendCommand("Debugger.pause");
  }

  /**
   * Get the current call stack.
   */
  getCallStack(sessionId: string): CallFrame[] {
    const session = this.getSession(sessionId);

    if (!session.pausedState) {
      throw new DebuggerError(
        ErrorCode.SESSION_INVALID_STATE,
        "Session is not paused; cannot retrieve call stack",
      );
    }

    return session.pausedState.callFrames;
  }

  /**
   * Evaluate an expression.
   */
  async evaluateExpression(
    sessionId: string,
    expression: string,
    callFrameId?: string,
    returnByValue: boolean = true,
  ): Promise<EvaluateResult> {
    const session = this.getSession(sessionId);

    let result: EvaluateResult;

    if (callFrameId) {
      // Evaluate on a specific call frame.
      this.requireState(session, [SessionState.PAUSED]);

      result = await session.wsClient.sendCommand<EvaluateResult>("Debugger.evaluateOnCallFrame", {
        callFrameId,
        expression,
        returnByValue,
      });
    } else {
      // Evaluate in global context using Runtime.evaluate.
      result = await session.wsClient.sendCommand<EvaluateResult>("Runtime.evaluate", {
        expression,
        returnByValue,
      });
    }

    return result;
  }

  /**
   * Get variables in a scope.
   */
  async getScopeVariables(
    sessionId: string,
    callFrameId: string,
    scopeIndex: number = 0,
  ): Promise<ScopeVariable[]> {
    const session = this.getSession(sessionId);
    this.requireState(session, [SessionState.PAUSED]);

    if (!session.pausedState) {
      throw new DebuggerError(
        ErrorCode.SESSION_INVALID_STATE,
        "Session is not paused; cannot retrieve scope variables",
      );
    }

    // Find the call frame.
    const callFrame = session.pausedState.callFrames.find((f) => f.callFrameId === callFrameId);
    if (!callFrame) {
      throw new DebuggerError(ErrorCode.INVALID_PARAMETERS, `Call frame not found: ${callFrameId}`);
    }

    // Get the scope.
    if (scopeIndex < 0 || scopeIndex >= callFrame.scopeChain.length) {
      throw new DebuggerError(ErrorCode.INVALID_PARAMETERS, `Invalid scope index: ${scopeIndex}`);
    }

    const scope = callFrame.scopeChain[scopeIndex];
    if (!scope.object.objectId) {
      return [];
    }

    // Get properties of the scope object.
    const result = await session.wsClient.sendCommand<{
      result: Array<{
        name: string;
        value?: RemoteObject;
      }>;
    }>("Runtime.getProperties", {
      objectId: scope.object.objectId,
      ownProperties: true,
    });

    return result.result
      .filter((prop) => prop.value !== undefined)
      .map((prop) => ({
        name: prop.name,
        value: prop.value!,
      }));
  }

  /**
   * Set the value of a variable.
   */
  async setVariableValue(
    sessionId: string,
    callFrameId: string,
    scopeIndex: number,
    variableName: string,
    newValue: string,
  ): Promise<void> {
    const session = this.getSession(sessionId);
    this.requireState(session, [SessionState.PAUSED]);

    // First evaluate the new value to get a RemoteObject.
    const evalResult = await session.wsClient.sendCommand<{ result: RemoteObject }>(
      "Debugger.evaluateOnCallFrame",
      {
        callFrameId,
        expression: newValue,
        returnByValue: false,
      },
    );

    // Set the variable value.
    await session.wsClient.sendCommand("Debugger.setVariableValue", {
      scopeNumber: scopeIndex,
      variableName,
      newValue: {
        value: evalResult.result.value,
      },
      callFrameId,
    });

    this.logger.info("Variable value set", {
      sessionId,
      variableName,
      newValue,
    });
  }

  /**
   * Configure pause on exceptions.
   */
  async setPauseOnExceptions(
    sessionId: string,
    state: "none" | "uncaught" | "all",
  ): Promise<void> {
    const session = this.getSession(sessionId);
    this.requireState(session, [SessionState.CONNECTED, SessionState.PAUSED, SessionState.RUNNING]);

    this.logger.debug("Setting pause on exceptions", { sessionId, state });
    await session.wsClient.sendCommand("Debugger.setPauseOnExceptions", { state });
  }

  /**
   * Add an event listener for session events.
   */
  addEventListener(listener: SessionEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove an event listener.
   */
  removeEventListener(listener: SessionEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Handle events from the WebSocket client.
   */
  private handleSessionEvent(session: DebugSession, event: DebuggerEvent): void {
    this.logger.debug("Session event", { sessionId: session.id, eventType: event.type });

    switch (event.type) {
      case "paused":
        session.state = SessionState.PAUSED;
        session.pausedState = event.data;
        this.emitEvent(session.id, "paused", {
          reason: event.data.reason,
          callFrames: event.data.callFrames.length,
        });
        break;

      case "resumed":
        session.state = SessionState.RUNNING;
        session.pausedState = undefined;
        this.emitEvent(session.id, "resumed");
        break;

      case "scriptParsed":
        session.scripts.set(event.data.scriptId, event.data);
        break;

      case "breakpointResolved":
        const bp = session.breakpoints.get(event.data.breakpointId);
        if (bp) {
          bp.locations = [event.data.location];
        }
        break;

      case "disconnected":
        session.state = SessionState.DISCONNECTED;
        this.sessions.delete(session.id);
        this.emitEvent(session.id, "disconnected", { reason: event.reason });
        break;
    }
  }

  /**
   * Emit an event to all listeners.
   */
  private emitEvent(
    sessionId: string,
    event: "paused" | "resumed" | "disconnected",
    data?: Record<string, unknown>,
  ): void {
    for (const listener of this.eventListeners) {
      try {
        listener(sessionId, event, data);
      } catch (error) {
        this.logger.error("Event listener error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Validate a target URL.
   */
  private validateTargetUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new DebuggerError(ErrorCode.INVALID_PARAMETERS, `Invalid URL: ${url}`);
    }

    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      throw new DebuggerError(
        ErrorCode.INVALID_PARAMETERS,
        `URL must use ws:// or wss:// scheme: ${url}`,
      );
    }

    const hostname = parsed.hostname;
    const isLocalhost = this.config.allowedHosts.includes(hostname);

    if (!isLocalhost && this.config.requireConfirmationForRemote) {
      throw new DebuggerError(
        ErrorCode.INVALID_PARAMETERS,
        `Remote host "${hostname}" not in allowed hosts list. Add to configuration to allow.`,
      );
    }
  }

  /**
   * Require the session to be in one of the specified states.
   */
  private requireState(session: DebugSession, allowedStates: SessionState[]): void {
    if (!allowedStates.includes(session.state)) {
      throw new DebuggerError(
        ErrorCode.SESSION_INVALID_STATE,
        `Operation not allowed in state "${session.state}". Required: ${allowedStates.join(", ")}`,
      );
    }
  }
}
