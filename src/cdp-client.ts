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
 * CDP Client wrapper using chrome-remote-interface.
 *
 * @author John Grimes
 */

import CDP, {type Client} from 'chrome-remote-interface';
import type {Protocol} from 'devtools-protocol';
import type {ScriptInfo} from './types.js';

/**
 * Event handler types for CDP events.
 */
export interface CDPClientEvents {
  paused: (params: Protocol.Debugger.PausedEvent) => void;
  resumed: () => void;
  scriptParsed: (params: Protocol.Debugger.ScriptParsedEvent) => void;
  breakpointResolved: (params: Protocol.Debugger.BreakpointResolvedEvent) => void;
  disconnected: () => void;
}

/**
 * Wrapper around chrome-remote-interface for CDP communication.
 */
export class CDPClient {
  private client: Client | null = null;
  private eventHandlers: Partial<CDPClientEvents> = {};
  private readonly scripts = new Map<string, ScriptInfo>();
  private connected = false;

  /**
   * Connects to a CDP endpoint.
   *
   * @param target - WebSocket URL or connection options
   */
  async connect(target: string | {host: string; port: number}): Promise<void> {
    if (this.connected) {
      throw new Error('Already connected');
    }

    const options = typeof target === 'string' ? {target} : target;

    this.client = await CDP(options);
    this.connected = true;

    // Set up event handlers BEFORE enabling domains to catch initial state.
    this.setupEventHandlers();

    // Enable required domains.
    await this.client.Debugger.enable({});
    await this.client.Runtime.enable();
  }

  /**
   * Sets up event handlers for CDP events.
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.Debugger.paused((params) => {
      this.eventHandlers.paused?.(params);
    });

    this.client.Debugger.resumed(() => {
      this.eventHandlers.resumed?.();
    });

    this.client.Debugger.scriptParsed((params) => {
      // Cache script info.
      this.scripts.set(params.scriptId, {
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
      });

      this.eventHandlers.scriptParsed?.(params);
    });

    this.client.Debugger.breakpointResolved((params) => {
      this.eventHandlers.breakpointResolved?.(params);
    });

    this.client.on('disconnect', () => {
      this.connected = false;
      this.eventHandlers.disconnected?.();
    });
  }

  /**
   * Registers an event handler.
   */
  on<K extends keyof CDPClientEvents>(event: K, handler: CDPClientEvents[K]): void {
    this.eventHandlers[event] = handler;
  }

  /**
   * Sets a breakpoint by URL.
   */
  async setBreakpointByUrl(
    url: string,
    lineNumber: number,
    columnNumber?: number,
    condition?: string
  ): Promise<Protocol.Debugger.SetBreakpointByUrlResponse> {
    this.ensureConnected();
    return this.client!.Debugger.setBreakpointByUrl({
      url,
      lineNumber,
      columnNumber,
      condition,
    });
  }

  /**
   * Removes a breakpoint.
   */
  async removeBreakpoint(breakpointId: string): Promise<void> {
    this.ensureConnected();
    await this.client!.Debugger.removeBreakpoint({breakpointId});
  }

  /**
   * Resumes execution.
   */
  async resume(): Promise<void> {
    this.ensureConnected();
    await this.client!.Debugger.resume({});
  }

  /**
   * Pauses execution.
   */
  async pause(): Promise<void> {
    this.ensureConnected();
    await this.client!.Debugger.pause();
  }

  /**
   * Steps over the current statement.
   */
  async stepOver(): Promise<void> {
    this.ensureConnected();
    await this.client!.Debugger.stepOver({});
  }

  /**
   * Steps into a function call.
   */
  async stepInto(): Promise<void> {
    this.ensureConnected();
    await this.client!.Debugger.stepInto({});
  }

  /**
   * Steps out of the current function.
   */
  async stepOut(): Promise<void> {
    this.ensureConnected();
    await this.client!.Debugger.stepOut();
  }

  /**
   * Resumes execution if waiting for debugger (e.g., --inspect-brk).
   */
  async runIfWaitingForDebugger(): Promise<void> {
    this.ensureConnected();
    // Type assertion needed as chrome-remote-interface types are incomplete.
    await (this.client!.Runtime as unknown as {runIfWaitingForDebugger: () => Promise<void>}).runIfWaitingForDebugger();
  }

  /**
   * Evaluates an expression on a call frame.
   */
  async evaluateOnCallFrame(
    callFrameId: string,
    expression: string,
    returnByValue = true
  ): Promise<Protocol.Debugger.EvaluateOnCallFrameResponse> {
    this.ensureConnected();
    return this.client!.Debugger.evaluateOnCallFrame({
      callFrameId,
      expression,
      returnByValue,
    });
  }

  /**
   * Evaluates an expression in the global context.
   */
  async evaluate(
    expression: string,
    returnByValue = true
  ): Promise<Protocol.Runtime.EvaluateResponse> {
    this.ensureConnected();
    return this.client!.Runtime.evaluate({
      expression,
      returnByValue,
    });
  }

  /**
   * Gets properties of an object.
   */
  async getProperties(
    objectId: string,
    ownProperties = true
  ): Promise<Protocol.Runtime.GetPropertiesResponse> {
    this.ensureConnected();
    return this.client!.Runtime.getProperties({
      objectId,
      ownProperties,
    });
  }

  /**
   * Sets a variable value in a call frame.
   */
  async setVariableValue(
    scopeNumber: number,
    variableName: string,
    newValue: Protocol.Runtime.CallArgument,
    callFrameId: string
  ): Promise<void> {
    this.ensureConnected();
    await this.client!.Debugger.setVariableValue({
      scopeNumber,
      variableName,
      newValue,
      callFrameId,
    });
  }

  /**
   * Sets pause on exceptions mode.
   */
  async setPauseOnExceptions(
    state: 'none' | 'uncaught' | 'all'
  ): Promise<void> {
    this.ensureConnected();
    await this.client!.Debugger.setPauseOnExceptions({state});
  }

  /**
   * Gets the source of a script.
   */
  async getScriptSource(
    scriptId: string
  ): Promise<Protocol.Debugger.GetScriptSourceResponse> {
    this.ensureConnected();
    return this.client!.Debugger.getScriptSource({scriptId});
  }

  /**
   * Gets cached script info.
   */
  getScript(scriptId: string): ScriptInfo | undefined {
    return this.scripts.get(scriptId);
  }

  /**
   * Gets all cached scripts.
   */
  getAllScripts(): ScriptInfo[] {
    return Array.from(this.scripts.values());
  }

  /**
   * Finds scripts matching a URL pattern.
   */
  findScriptsByUrl(urlPattern: string): ScriptInfo[] {
    return Array.from(this.scripts.values()).filter((script) =>
      script.url.includes(urlPattern)
    );
  }

  /**
   * Checks if the client is connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Closes the connection.
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connected = false;
      this.scripts.clear();
    }
  }

  /**
   * Ensures the client is connected before executing a command.
   */
  private ensureConnected(): void {
    if (!this.connected || !this.client) {
      throw new Error('Not connected to CDP endpoint');
    }
  }
}
