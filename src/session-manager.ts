/**
 * Session Manager for managing multiple debugging sessions.
 *
 * @author John Grimes
 */

import {v4 as uuidv4} from 'uuid';
import type {Protocol} from 'devtools-protocol';
import {CDPClient} from './cdp-client.js';
import {SourceMapManager} from './source-map-manager.js';
import {
  type BreakpointInfo,
  type PausedState,
  type ScriptInfo,
  type EnrichedCallFrame,
  type SessionSummary,
  type SessionDetails,
  SessionState,
  ErrorCode,
} from './types.js';

/**
 * Event handler types for session events.
 */
export interface SessionManagerEvents {
  sessionCreated: (sessionId: string) => void;
  sessionDestroyed: (sessionId: string) => void;
  executionPaused: (sessionId: string, state: PausedState) => void;
  executionResumed: (sessionId: string) => void;
  scriptParsed: (sessionId: string, scriptInfo: ScriptInfo) => void;
  breakpointResolved: (
    sessionId: string,
    breakpointId: string,
    location: Protocol.Debugger.Location
  ) => void;
}

/**
 * Internal session data structure.
 */
interface ManagedSession {
  id: string;
  name?: string;
  targetUrl: string;
  state: SessionState;
  cdpClient: CDPClient;
  sourceMapManager: SourceMapManager;
  breakpoints: Map<string, BreakpointInfo>;
  pausedState?: PausedState;
  createdAt: Date;
}

/**
 * Manages multiple debugging sessions and coordinates CDP clients.
 */
export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private eventHandlers: Partial<SessionManagerEvents> = {};

  /**
   * Creates a new debugging session by connecting to a CDP endpoint.
   *
   * @param targetUrl - WebSocket URL for the CDP endpoint
   * @param name - Optional human-readable name for the session
   * @returns The session ID
   */
  async createSession(targetUrl: string, name?: string): Promise<string> {
    const sessionId = uuidv4();
    const cdpClient = new CDPClient();
    const sourceMapManager = new SourceMapManager();

    const session: ManagedSession = {
      id: sessionId,
      name,
      targetUrl,
      state: SessionState.CONNECTING,
      cdpClient,
      sourceMapManager,
      breakpoints: new Map(),
      createdAt: new Date(),
    };

    // Set up event handlers before connecting.
    this.setupSessionEventHandlers(session);

    try {
      await cdpClient.connect(targetUrl);
      session.state = SessionState.CONNECTED;
      this.sessions.set(sessionId, session);
      this.eventHandlers.sessionCreated?.(sessionId);
      return sessionId;
    } catch (error) {
      throw this.createError(
        ErrorCode.CONNECTION_FAILED,
        `Failed to connect to ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Destroys a debugging session.
   *
   * @param sessionId - The session ID
   */
  async destroySession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);

    try {
      await session.cdpClient.close();
    } catch {
      // Ignore close errors.
    }

    session.sourceMapManager.clear();
    this.sessions.delete(sessionId);
    this.eventHandlers.sessionDestroyed?.(sessionId);
  }

  /**
   * Gets a list of all active sessions.
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
        const topFrame = session.pausedState.callFrames[0];
        if (topFrame) {
          const script = session.cdpClient.getScript(topFrame.location.scriptId);
          summary.scriptUrl = script?.url;
          summary.lineNumber = topFrame.location.lineNumber;
        }
      }

      return summary;
    });
  }

  /**
   * Gets detailed information about a session.
   *
   * @param sessionId - The session ID
   */
  getSessionDetails(sessionId: string): SessionDetails {
    const session = this.getSession(sessionId);

    const details: SessionDetails = {
      id: session.id,
      name: session.name,
      targetUrl: session.targetUrl,
      state: session.state,
      breakpoints: Array.from(session.breakpoints.values()).map((bp) => ({
        id: bp.id,
        scriptUrl: bp.url,
        lineNumber: bp.lineNumber,
        columnNumber: bp.columnNumber,
        condition: bp.condition,
        enabled: bp.enabled,
      })),
    };

    if (session.pausedState) {
      details.pauseReason = session.pausedState.reason;
      details.callStack = this.enrichCallFrames(session);
    }

    return details;
  }

  /**
   * Sets a breakpoint in a session.
   *
   * @param sessionId - The session ID
   * @param url - URL of the script
   * @param lineNumber - Line number (0-based)
   * @param columnNumber - Optional column number (0-based)
   * @param condition - Optional condition expression
   */
  async setBreakpoint(
    sessionId: string,
    url: string,
    lineNumber: number,
    columnNumber?: number,
    condition?: string
  ): Promise<BreakpointInfo> {
    const session = this.getSession(sessionId);

    const response = await session.cdpClient.setBreakpointByUrl(
      url,
      lineNumber,
      columnNumber,
      condition
    );

    const breakpointInfo: BreakpointInfo = {
      id: response.breakpointId,
      url,
      lineNumber,
      columnNumber,
      condition,
      enabled: true,
      resolvedLocations: response.locations.map((loc) => ({
        scriptId: loc.scriptId,
        lineNumber: loc.lineNumber,
        columnNumber: loc.columnNumber ?? 0,
      })),
    };

    session.breakpoints.set(response.breakpointId, breakpointInfo);
    return breakpointInfo;
  }

  /**
   * Removes a breakpoint from a session.
   *
   * @param sessionId - The session ID
   * @param breakpointId - The breakpoint ID
   */
  async removeBreakpoint(
    sessionId: string,
    breakpointId: string
  ): Promise<void> {
    const session = this.getSession(sessionId);

    if (!session.breakpoints.has(breakpointId)) {
      throw this.createError(
        ErrorCode.BREAKPOINT_NOT_FOUND,
        `Breakpoint ${breakpointId} not found`
      );
    }

    await session.cdpClient.removeBreakpoint(breakpointId);
    session.breakpoints.delete(breakpointId);
  }

  /**
   * Lists all breakpoints in a session.
   *
   * @param sessionId - The session ID
   */
  listBreakpoints(sessionId: string): BreakpointInfo[] {
    const session = this.getSession(sessionId);
    return Array.from(session.breakpoints.values());
  }

  /**
   * Resumes execution in a session.
   *
   * @param sessionId - The session ID
   */
  async resume(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (session.state === SessionState.PAUSED) {
      await session.cdpClient.resume();
    } else if (session.state === SessionState.CONNECTED) {
      // Handle --inspect-brk: target is waiting for debugger to start.
      await session.cdpClient.runIfWaitingForDebugger();
      session.state = SessionState.RUNNING;
    } else {
      throw this.createError(
        ErrorCode.SESSION_INVALID_STATE,
        `Session ${session.id} is not paused or waiting for debugger`
      );
    }
  }

  /**
   * Pauses execution in a session.
   *
   * @param sessionId - The session ID
   */
  async pause(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    this.ensureRunning(session);
    await session.cdpClient.pause();
  }

  /**
   * Steps over the current statement.
   *
   * @param sessionId - The session ID
   */
  async stepOver(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    this.ensurePaused(session);
    await session.cdpClient.stepOver();
  }

  /**
   * Steps into a function call.
   *
   * @param sessionId - The session ID
   */
  async stepInto(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    this.ensurePaused(session);
    await session.cdpClient.stepInto();
  }

  /**
   * Steps out of the current function.
   *
   * @param sessionId - The session ID
   */
  async stepOut(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    this.ensurePaused(session);
    await session.cdpClient.stepOut();
  }

  /**
   * Gets the enriched call stack for a paused session.
   *
   * @param sessionId - The session ID
   * @param includeAsync - Whether to include async stack traces
   */
  getCallStack(
    sessionId: string,
    includeAsync = true
  ): {
    callFrames: EnrichedCallFrame[];
    asyncStackTrace?: Protocol.Runtime.StackTrace;
  } {
    const session = this.getSession(sessionId);
    this.ensurePaused(session);

    const enrichedFrames = this.enrichCallFrames(session);

    return {
      callFrames: enrichedFrames,
      asyncStackTrace: includeAsync
        ? session.pausedState?.asyncStackTrace
        : undefined,
    };
  }

  /**
   * Evaluates an expression in a session.
   *
   * @param sessionId - The session ID
   * @param expression - JavaScript expression to evaluate
   * @param callFrameId - Optional call frame ID
   * @param returnByValue - Whether to return the result by value
   */
  async evaluate(
    sessionId: string,
    expression: string,
    callFrameId?: string,
    returnByValue = true
  ): Promise<{
    result: Protocol.Runtime.RemoteObject;
    exceptionDetails?: Protocol.Runtime.ExceptionDetails;
  }> {
    const session = this.getSession(sessionId);

    if (callFrameId) {
      this.ensurePaused(session);
      const response = await session.cdpClient.evaluateOnCallFrame(
        callFrameId,
        expression,
        returnByValue
      );
      return {
        result: response.result,
        exceptionDetails: response.exceptionDetails,
      };
    } else {
      const response = await session.cdpClient.evaluate(
        expression,
        returnByValue
      );
      return {
        result: response.result,
        exceptionDetails: response.exceptionDetails,
      };
    }
  }

  /**
   * Gets variables in a scope.
   *
   * @param sessionId - The session ID
   * @param callFrameId - The call frame ID
   * @param scopeIndex - Index of the scope in the scope chain
   */
  async getScopeVariables(
    sessionId: string,
    callFrameId: string,
    scopeIndex = 0
  ): Promise<Protocol.Runtime.PropertyDescriptor[]> {
    const session = this.getSession(sessionId);
    this.ensurePaused(session);

    // Find the call frame.
    const callFrame = session.pausedState?.callFrames.find(
      (f) => f.callFrameId === callFrameId
    );

    if (!callFrame) {
      throw this.createError(
        ErrorCode.INVALID_PARAMETERS,
        `Call frame ${callFrameId} not found`
      );
    }

    const scope = callFrame.scopeChain[scopeIndex];
    if (!scope || !scope.object.objectId) {
      throw this.createError(
        ErrorCode.INVALID_PARAMETERS,
        `Scope at index ${scopeIndex} not found or has no object ID`
      );
    }

    const response = await session.cdpClient.getProperties(
      scope.object.objectId
    );

    return response.result;
  }

  /**
   * Sets a variable value in a scope.
   *
   * @param sessionId - The session ID
   * @param callFrameId - The call frame ID
   * @param scopeIndex - Index of the scope
   * @param variableName - Name of the variable
   * @param newValue - JavaScript expression for the new value
   */
  async setVariableValue(
    sessionId: string,
    callFrameId: string,
    scopeIndex: number,
    variableName: string,
    newValue: string
  ): Promise<void> {
    const session = this.getSession(sessionId);
    this.ensurePaused(session);

    // Evaluate the new value expression to get a CallArgument.
    const evalResult = await session.cdpClient.evaluateOnCallFrame(
      callFrameId,
      newValue,
      false
    );

    if (evalResult.exceptionDetails) {
      throw this.createError(
        ErrorCode.PROTOCOL_ERROR,
        `Failed to evaluate new value: ${evalResult.exceptionDetails.text}`
      );
    }

    const callArgument: Protocol.Runtime.CallArgument = {};
    if (evalResult.result.objectId) {
      callArgument.objectId = evalResult.result.objectId;
    } else if ('value' in evalResult.result) {
      callArgument.value = evalResult.result.value;
    } else if (evalResult.result.unserializableValue) {
      callArgument.unserializableValue = evalResult.result.unserializableValue;
    }

    await session.cdpClient.setVariableValue(
      scopeIndex,
      variableName,
      callArgument,
      callFrameId
    );
  }

  /**
   * Sets the pause on exceptions mode.
   *
   * @param sessionId - The session ID
   * @param state - When to pause: 'none', 'uncaught', or 'all'
   */
  async setPauseOnExceptions(
    sessionId: string,
    state: 'none' | 'uncaught' | 'all'
  ): Promise<void> {
    const session = this.getSession(sessionId);
    await session.cdpClient.setPauseOnExceptions(state);
  }

  /**
   * Gets the original source location for a generated code position.
   *
   * @param sessionId - The session ID
   * @param scriptId - The script ID
   * @param lineNumber - Line number in generated code (1-based)
   * @param columnNumber - Column number in generated code (0-based)
   */
  getOriginalLocation(
    sessionId: string,
    scriptId: string,
    lineNumber: number,
    columnNumber: number
  ): {
    hasSourceMap: boolean;
    original?: {
      sourceUrl: string;
      lineNumber: number;
      columnNumber: number;
      name?: string;
    };
  } {
    const session = this.getSession(sessionId);

    if (!session.sourceMapManager.hasSourceMap(scriptId)) {
      return {hasSourceMap: false};
    }

    const original = session.sourceMapManager.getOriginalLocation(
      scriptId,
      lineNumber,
      columnNumber
    );

    if (!original) {
      return {hasSourceMap: true};
    }

    return {
      hasSourceMap: true,
      original: {
        sourceUrl: original.source,
        lineNumber: original.line ?? 0,
        columnNumber: original.column ?? 0,
        name: original.name ?? undefined,
      },
    };
  }

  /**
   * Gets script source, optionally returning original source if available.
   *
   * @param sessionId - The session ID
   * @param scriptId - The script ID
   * @param preferOriginal - Whether to prefer original source
   * @param originalSourceUrl - Optional specific original source URL
   */
  async getScriptSource(
    sessionId: string,
    scriptId: string,
    preferOriginal = true,
    originalSourceUrl?: string
  ): Promise<{
    source: string;
    sourceUrl: string;
    isOriginal: boolean;
    sourceMapUrl?: string;
  }> {
    const session = this.getSession(sessionId);
    const script = session.cdpClient.getScript(scriptId);

    if (!script) {
      throw this.createError(
        ErrorCode.SCRIPT_NOT_FOUND,
        `Script ${scriptId} not found`
      );
    }

    // Try to get original source if preferred and available.
    if (preferOriginal && session.sourceMapManager.hasSourceMap(scriptId)) {
      const sources = session.sourceMapManager.getOriginalSources(scriptId);
      const targetSource = originalSourceUrl ?? sources?.[0];

      if (targetSource) {
        const originalSource = session.sourceMapManager.getOriginalSource(
          scriptId,
          targetSource
        );

        if (originalSource) {
          return {
            source: originalSource,
            sourceUrl: targetSource,
            isOriginal: true,
            sourceMapUrl: session.sourceMapManager.getSourceMapUrl(scriptId),
          };
        }
      }
    }

    // Fall back to generated source.
    const response = await session.cdpClient.getScriptSource(scriptId);

    return {
      source: response.scriptSource,
      sourceUrl: script.url,
      isOriginal: false,
      sourceMapUrl: script.sourceMapUrl,
    };
  }

  /**
   * Lists all scripts in a session.
   *
   * @param sessionId - The session ID
   * @param includeInternal - Whether to include internal/node_modules scripts
   */
  listScripts(
    sessionId: string,
    includeInternal = false
  ): Array<{
    scriptId: string;
    url: string;
    sourceMapUrl?: string;
    originalSources?: string[];
    isInternal: boolean;
  }> {
    const session = this.getSession(sessionId);
    const scripts = session.cdpClient.getAllScripts();

    return scripts
      .filter((script) => {
        if (includeInternal) return true;
        // Filter out internal scripts (node modules, built-ins).
        const isInternal =
          script.url.includes('node_modules') ||
          script.url.startsWith('node:') ||
          script.url.startsWith('internal/') ||
          !script.url;
        return !isInternal;
      })
      .map((script) => ({
        scriptId: script.scriptId,
        url: script.url,
        sourceMapUrl: script.sourceMapUrl,
        originalSources: session.sourceMapManager.getOriginalSources(
          script.scriptId
        ),
        isInternal:
          script.url.includes('node_modules') ||
          script.url.startsWith('node:') ||
          script.url.startsWith('internal/'),
      }));
  }

  /**
   * Registers an event handler.
   */
  on<K extends keyof SessionManagerEvents>(
    event: K,
    handler: SessionManagerEvents[K]
  ): void {
    this.eventHandlers[event] = handler;
  }

  /**
   * Gets a session by ID, throwing if not found.
   */
  private getSession(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw this.createError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session ${sessionId} not found`
      );
    }
    return session;
  }

  /**
   * Ensures a session is in the paused state.
   */
  private ensurePaused(session: ManagedSession): void {
    if (session.state !== SessionState.PAUSED || !session.pausedState) {
      throw this.createError(
        ErrorCode.SESSION_INVALID_STATE,
        `Session ${session.id} is not paused`
      );
    }
  }

  /**
   * Ensures a session is in the running state.
   */
  private ensureRunning(session: ManagedSession): void {
    if (
      session.state !== SessionState.RUNNING &&
      session.state !== SessionState.CONNECTED
    ) {
      throw this.createError(
        ErrorCode.SESSION_INVALID_STATE,
        `Session ${session.id} is not running`
      );
    }
  }

  /**
   * Sets up event handlers for a session's CDP client.
   */
  private setupSessionEventHandlers(session: ManagedSession): void {
    session.cdpClient.on('paused', (params) => {
      session.state = SessionState.PAUSED;
      const pausedState: PausedState = {
        reason: params.reason,
        callFrames: params.callFrames,
        asyncStackTrace: params.asyncStackTrace,
        data: params.data,
        hitBreakpoints: params.hitBreakpoints,
      };
      session.pausedState = pausedState;
      this.eventHandlers.executionPaused?.(session.id, pausedState);
    });

    session.cdpClient.on('resumed', () => {
      session.state = SessionState.RUNNING;
      session.pausedState = undefined;
      this.eventHandlers.executionResumed?.(session.id);
    });

    session.cdpClient.on('scriptParsed', async (params) => {
      const scriptInfo: ScriptInfo = {
        scriptId: params.scriptId,
        url: params.url,
        sourceMapUrl: params.sourceMapURL,
        startLine: params.startLine,
        startColumn: params.startColumn,
        endLine: params.endLine,
        endColumn: params.endColumn,
        hash: params.hash,
        isModule: params.isModule,
        length: params.length,
      };

      // Load source map if available.
      if (params.sourceMapURL) {
        if (params.sourceMapURL.startsWith('data:')) {
          await session.sourceMapManager.loadInlineSourceMap(
            params.scriptId,
            params.sourceMapURL
          );
        } else {
          await session.sourceMapManager.loadSourceMap(
            scriptInfo,
            async (url) => {
              // Fetch source map from URL.
              try {
                if (url.startsWith('file://')) {
                  // Read from filesystem for file:// URLs.
                  const filePath = url.replace('file://', '');
                  const fs = await import('fs/promises');
                  return fs.readFile(filePath, 'utf-8');
                } else {
                  const response = await fetch(url);
                  if (!response.ok) return null;
                  return response.text();
                }
              } catch {
                return null;
              }
            }
          );
        }
      }

      this.eventHandlers.scriptParsed?.(session.id, scriptInfo);
    });

    session.cdpClient.on('breakpointResolved', (params) => {
      const breakpoint = session.breakpoints.get(params.breakpointId);
      if (breakpoint) {
        breakpoint.resolvedLocations.push({
          scriptId: params.location.scriptId,
          lineNumber: params.location.lineNumber,
          columnNumber: params.location.columnNumber ?? 0,
        });
      }
      this.eventHandlers.breakpointResolved?.(
        session.id,
        params.breakpointId,
        params.location
      );
    });

    session.cdpClient.on('disconnected', () => {
      session.state = SessionState.DISCONNECTED;
      session.pausedState = undefined;
    });
  }

  /**
   * Enriches call frames with original source locations.
   */
  private enrichCallFrames(session: ManagedSession): EnrichedCallFrame[] {
    if (!session.pausedState) return [];

    return session.pausedState.callFrames.map((frame) => {
      const enriched: EnrichedCallFrame = {
        callFrameId: frame.callFrameId,
        functionName: frame.functionName,
        generatedLocation: {
          scriptId: frame.location.scriptId,
          lineNumber: frame.location.lineNumber,
          columnNumber: frame.location.columnNumber ?? 0,
        },
        scopeChain: frame.scopeChain,
        this: frame.this,
      };

      // Try to map to original location.
      const original = session.sourceMapManager.getOriginalLocation(
        frame.location.scriptId,
        frame.location.lineNumber + 1, // source-map uses 1-based lines.
        frame.location.columnNumber ?? 0
      );

      if (original) {
        enriched.originalLocation = {
          sourceUrl: original.source,
          lineNumber: original.line ?? 0,
          columnNumber: original.column ?? 0,
          functionName: original.name ?? undefined,
        };
      }

      return enriched;
    });
  }

  /**
   * Creates a structured error.
   */
  private createError(code: ErrorCode, message: string): Error {
    const error = new Error(message);
    (error as Error & {code: ErrorCode}).code = code;
    return error;
  }
}
