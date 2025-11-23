/**
 * WebSocket client for communicating with WebKit Inspector Protocol.
 *
 * @author John Grimes
 */

import WebSocket from "ws";
import {
  type ProtocolMessage,
  type PendingCommand,
  type DebuggerEventListener,
  type DebuggerEvent,
  type PausedState,
  type ScriptInfo,
  type BreakpointLocation,
  DebuggerError,
  ErrorCode,
} from "./types.js";
import { Logger, logger as rootLogger } from "./logger.js";

/**
 * WebSocket client for the WebKit Inspector Protocol.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private commandId = 1;
  private readonly pendingCommands = new Map<number, PendingCommand>();
  private readonly eventListeners: DebuggerEventListener[] = [];
  private readonly logger: Logger;
  private isConnected = false;
  private reconnectAttempts = 0;

  constructor(
    private readonly targetUrl: string,
    private readonly connectionTimeout: number = 10000,
    private readonly commandTimeout: number = 5000,
    private readonly maxReconnectAttempts: number = 3,
    private readonly reconnectDelay: number = 1000,
  ) {
    this.logger = rootLogger.child("WebSocketClient");
  }

  /**
   * Connect to the WebKit Inspector Protocol endpoint.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.ws) {
          this.ws.terminate();
        }
        reject(
          new DebuggerError(ErrorCode.TIMEOUT, `Connection timeout after ${this.connectionTimeout}ms`),
        );
      }, this.connectionTimeout);

      try {
        this.ws = new WebSocket(this.targetUrl);

        this.ws.on("open", async () => {
          clearTimeout(timeoutId);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.logger.info("WebSocket connection established", { url: this.targetUrl });

          try {
            // Enable the debugger domain.
            await this.sendCommand("Debugger.enable");
            this.logger.info("Debugger domain enabled");
            resolve();
          } catch (error) {
            reject(error);
          }
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on("error", (error: Error) => {
          this.logger.error("WebSocket error", { error: error.message });
          clearTimeout(timeoutId);
          if (!this.isConnected) {
            reject(new DebuggerError(ErrorCode.CONNECTION_FAILED, `WebSocket error: ${error.message}`));
          }
        });

        this.ws.on("close", (code: number, reason: Buffer) => {
          this.logger.info("WebSocket connection closed", {
            code,
            reason: reason.toString(),
          });
          this.isConnected = false;
          this.rejectAllPendingCommands("Connection closed");
          this.emitEvent({ type: "disconnected", reason: reason.toString() });
        });
      } catch (error) {
        clearTimeout(timeoutId);
        reject(
          new DebuggerError(
            ErrorCode.CONNECTION_FAILED,
            `Failed to create WebSocket: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  }

  /**
   * Disconnect from the WebKit Inspector Protocol endpoint.
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      try {
        // Disable the debugger domain before disconnecting.
        await this.sendCommand("Debugger.disable");
      } catch {
        // Ignore errors during disable.
      }

      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Send a command to the WebKit Inspector Protocol.
   */
  async sendCommand<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || !this.isConnected) {
      throw new DebuggerError(ErrorCode.CONNECTION_FAILED, "Not connected to debugger");
    }

    const id = this.commandId++;
    const message: ProtocolMessage = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new DebuggerError(ErrorCode.TIMEOUT, `Command timeout: ${method}`));
      }, this.commandTimeout);

      this.pendingCommands.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      this.logger.debug("Sending command", { id, method, params });
      this.ws!.send(JSON.stringify(message));
    });
  }

  /**
   * Add an event listener.
   */
  addEventListener(listener: DebuggerEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove an event listener.
   */
  removeEventListener(listener: DebuggerEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Check if the client is connected.
   */
  isClientConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Handle incoming WebSocket messages.
   */
  private handleMessage(data: string): void {
    try {
      const message: ProtocolMessage = JSON.parse(data);

      this.logger.debug("Received message", { message });

      if (message.id !== undefined) {
        // This is a response to a command.
        const pending = this.pendingCommands.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingCommands.delete(message.id);

          if (message.error) {
            pending.reject(
              new DebuggerError(ErrorCode.PROTOCOL_ERROR, message.error.message, {
                protocolError: message.error,
              }),
            );
          } else {
            pending.resolve(message.result);
          }
        }
      } else if (message.method) {
        // This is an event notification.
        this.handleEvent(message.method, message.params || {});
      }
    } catch (error) {
      this.logger.error("Failed to parse message", {
        error: error instanceof Error ? error.message : String(error),
        data,
      });
    }
  }

  /**
   * Handle protocol events.
   */
  private handleEvent(method: string, params: Record<string, unknown>): void {
    this.logger.debug("Handling event", { method, params });

    switch (method) {
      case "Debugger.paused":
        this.emitEvent({
          type: "paused",
          data: this.parsePausedEvent(params),
        });
        break;

      case "Debugger.resumed":
        this.emitEvent({ type: "resumed" });
        break;

      case "Debugger.scriptParsed":
        this.emitEvent({
          type: "scriptParsed",
          data: this.parseScriptParsedEvent(params),
        });
        break;

      case "Debugger.breakpointResolved":
        this.emitEvent({
          type: "breakpointResolved",
          data: {
            breakpointId: params.breakpointId as string,
            location: params.location as BreakpointLocation,
          },
        });
        break;
    }
  }

  /**
   * Parse a Debugger.paused event.
   */
  private parsePausedEvent(params: Record<string, unknown>): PausedState {
    return {
      reason: params.reason as string,
      callFrames: (params.callFrames as Record<string, unknown>[]).map((frame) => ({
        callFrameId: frame.callFrameId as string,
        functionName: frame.functionName as string,
        scriptId: (frame.location as Record<string, unknown>).scriptId as string,
        url: frame.url as string,
        lineNumber: (frame.location as Record<string, unknown>).lineNumber as number,
        columnNumber: (frame.location as Record<string, unknown>).columnNumber as number,
        thisObject: frame.this as PausedState["callFrames"][0]["thisObject"],
        scopeChain: (frame.scopeChain as Record<string, unknown>[]).map((scope) => ({
          type: scope.type as PausedState["callFrames"][0]["scopeChain"][0]["type"],
          object: scope.object as PausedState["callFrames"][0]["scopeChain"][0]["object"],
          name: scope.name as string | undefined,
        })),
      })),
      asyncStackTrace: params.asyncStackTrace as PausedState["asyncStackTrace"],
      data: params.data as Record<string, unknown>,
    };
  }

  /**
   * Parse a Debugger.scriptParsed event.
   */
  private parseScriptParsedEvent(params: Record<string, unknown>): ScriptInfo {
    return {
      scriptId: params.scriptId as string,
      url: params.url as string,
      startLine: params.startLine as number,
      startColumn: params.startColumn as number,
      endLine: params.endLine as number,
      endColumn: params.endColumn as number,
      sourceMapURL: params.sourceMapURL as string | undefined,
    };
  }

  /**
   * Emit an event to all listeners.
   */
  private emitEvent(event: DebuggerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error("Event listener error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Reject all pending commands.
   */
  private rejectAllPendingCommands(reason: string): void {
    for (const [id, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new DebuggerError(ErrorCode.CONNECTION_FAILED, reason));
    }
    this.pendingCommands.clear();
  }
}
