/**
 * MCP Server implementation for WebKit Inspector Protocol debugging.
 *
 * @author John Grimes
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type Tool,
  type Resource,
  type Prompt,
  type TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SessionManager } from "./session-manager.js";
import { type ServerConfig, DEFAULT_CONFIG, DebuggerError, ErrorCode } from "./types.js";
import { logger } from "./logger.js";

/**
 * Parameter schemas for tools.
 */
const ConnectDebuggerSchema = z.object({
  websocket_url: z.string().describe("WebSocket URL for the WebKit Inspector endpoint"),
  session_name: z.string().optional().describe("Optional human-readable name for the session"),
});

const DisconnectDebuggerSchema = z.object({
  session_id: z.string().describe("ID of the debugging session to disconnect"),
});

const SetBreakpointSchema = z.object({
  session_id: z.string().describe("ID of the debugging session"),
  url: z.string().describe("URL of the script where the breakpoint should be set"),
  line_number: z.number().int().describe("Line number (0-based) for the breakpoint"),
  column_number: z.number().int().optional().describe("Optional column number (0-based)"),
  condition: z.string().optional().describe("Optional condition expression"),
  ignore_count: z.number().int().optional().describe("Number of times to ignore before stopping"),
});

const RemoveBreakpointSchema = z.object({
  session_id: z.string().describe("ID of the debugging session"),
  breakpoint_id: z.string().describe("ID of the breakpoint to remove"),
});

const ListBreakpointsSchema = z.object({
  session_id: z.string().describe("ID of the debugging session"),
});

const SessionIdSchema = z.object({
  session_id: z.string().describe("ID of the debugging session"),
});

const GetCallStackSchema = z.object({
  session_id: z.string().describe("ID of the debugging session"),
  include_async: z.boolean().optional().default(true).describe("Include async stack traces"),
});

const EvaluateExpressionSchema = z.object({
  session_id: z.string().describe("ID of the debugging session"),
  expression: z.string().describe("JavaScript expression to evaluate"),
  call_frame_id: z.string().optional().describe("Optional call frame ID for context"),
  return_by_value: z.boolean().optional().default(true).describe("Return result by value"),
});

const GetScopeVariablesSchema = z.object({
  session_id: z.string().describe("ID of the debugging session"),
  call_frame_id: z.string().describe("ID of the call frame"),
  scope_index: z.number().int().optional().default(0).describe("Index in the scope chain"),
});

const SetVariableValueSchema = z.object({
  session_id: z.string().describe("ID of the debugging session"),
  call_frame_id: z.string().describe("ID of the call frame"),
  scope_index: z.number().int().describe("Index of the scope containing the variable"),
  variable_name: z.string().describe("Name of the variable to modify"),
  new_value: z.string().describe("JavaScript expression for the new value"),
});

const SetPauseOnExceptionsSchema = z.object({
  session_id: z.string().describe("ID of the debugging session"),
  state: z.enum(["none", "uncaught", "all"]).describe("When to pause on exceptions"),
});

/**
 * Tool definitions.
 */
const TOOLS: Tool[] = [
  {
    name: "connect_debugger",
    description:
      "Establishes a new debugging session by connecting to a WebKit Inspector Protocol endpoint.",
    inputSchema: {
      type: "object",
      properties: {
        websocket_url: {
          type: "string",
          description: "WebSocket URL for the WebKit Inspector endpoint (e.g., ws://localhost:9222/devtools/page/1)",
        },
        session_name: {
          type: "string",
          description: "Optional human-readable name for the debugging session",
        },
      },
      required: ["websocket_url"],
    },
  },
  {
    name: "disconnect_debugger",
    description: "Closes an active debugging session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "ID of the debugging session to disconnect",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "set_breakpoint",
    description: "Sets a breakpoint at a specific location in the code.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
        url: { type: "string", description: "URL of the script" },
        line_number: { type: "integer", description: "Line number (0-based)" },
        column_number: { type: "integer", description: "Optional column number (0-based)" },
        condition: { type: "string", description: "Optional condition expression" },
        ignore_count: { type: "integer", description: "Times to ignore before stopping" },
      },
      required: ["session_id", "url", "line_number"],
    },
  },
  {
    name: "remove_breakpoint",
    description: "Removes a previously set breakpoint.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
        breakpoint_id: { type: "string", description: "ID of the breakpoint to remove" },
      },
      required: ["session_id", "breakpoint_id"],
    },
  },
  {
    name: "list_breakpoints",
    description: "Lists all breakpoints in a debugging session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "resume_execution",
    description: "Resumes execution after being paused.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "step_over",
    description: "Steps over the current statement to the next line.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "step_into",
    description: "Steps into a function call if present, otherwise steps to the next statement.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "step_out",
    description: "Steps out of the current function to the calling frame.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "pause_execution",
    description: "Pauses execution at the next possible opportunity.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_call_stack",
    description: "Retrieves the current call stack when execution is paused.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
        include_async: {
          type: "boolean",
          description: "Whether to include async stack traces",
          default: true,
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "evaluate_expression",
    description:
      "Evaluates a JavaScript expression in the context of a specific call frame or global context.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
        expression: { type: "string", description: "JavaScript expression to evaluate" },
        call_frame_id: { type: "string", description: "Optional call frame ID" },
        return_by_value: { type: "boolean", description: "Return by value", default: true },
      },
      required: ["session_id", "expression"],
    },
  },
  {
    name: "get_scope_variables",
    description: "Retrieves all variables in a specific scope.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
        call_frame_id: { type: "string", description: "ID of the call frame" },
        scope_index: { type: "integer", description: "Index in scope chain", default: 0 },
      },
      required: ["session_id", "call_frame_id"],
    },
  },
  {
    name: "set_variable_value",
    description: "Modifies the value of a variable in a specific call frame.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
        call_frame_id: { type: "string", description: "ID of the call frame" },
        scope_index: { type: "integer", description: "Index of scope" },
        variable_name: { type: "string", description: "Name of the variable" },
        new_value: { type: "string", description: "JavaScript expression for new value" },
      },
      required: ["session_id", "call_frame_id", "scope_index", "variable_name", "new_value"],
    },
  },
  {
    name: "set_pause_on_exceptions",
    description: "Configures whether the debugger should pause on exceptions.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "ID of the debugging session" },
        state: {
          type: "string",
          enum: ["none", "uncaught", "all"],
          description: "When to pause: none, uncaught, or all",
        },
      },
      required: ["session_id", "state"],
    },
  },
];

/**
 * Resource definitions.
 */
const RESOURCES: Resource[] = [
  {
    uri: "debug://sessions",
    name: "Active Debug Sessions",
    description: "Lists all active debugging sessions with their current state.",
    mimeType: "application/json",
  },
];

/**
 * Prompt definitions.
 */
const PROMPTS: Prompt[] = [
  {
    name: "analyze_crash",
    description: "Guides analysis of a crashed or paused application",
    arguments: [
      {
        name: "session_id",
        description: "ID of the debugging session to analyse",
        required: true,
      },
    ],
  },
  {
    name: "investigate_condition",
    description: "Helps investigate why a specific condition might be true or false",
    arguments: [
      {
        name: "session_id",
        description: "ID of the debugging session",
        required: true,
      },
      {
        name: "expression",
        description: "The expression to investigate",
        required: true,
      },
    ],
  },
];

/**
 * WebKit Debug MCP Server.
 */
export class WebKitDebugMCPServer {
  private readonly server: Server;
  private readonly sessionManager: SessionManager;
  private readonly config: ServerConfig;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionManager = new SessionManager(this.config);

    logger.setLevel(this.config.logLevel);

    this.server = new Server(
      {
        name: "webkit-debug-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );

    this.setupHandlers();
    this.setupSessionEvents();

    logger.info("WebKit Debug MCP Server initialised");
  }

  /**
   * Set up MCP request handlers.
   */
  private setupHandlers(): void {
    // List tools.
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS,
    }));

    // Call tool.
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      return this.handleToolCall(request.params.name, request.params.arguments ?? {});
    });

    // List resources.
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: RESOURCES,
    }));

    // Read resource.
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      return this.handleResourceRead(request.params.uri);
    });

    // List prompts.
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: PROMPTS,
    }));

    // Get prompt.
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      return this.handlePromptGet(request.params.name, request.params.arguments ?? {});
    });
  }

  /**
   * Set up session event listeners.
   */
  private setupSessionEvents(): void {
    this.sessionManager.addEventListener((sessionId, event, data) => {
      logger.info("Session event", { sessionId, event, data });
      // MCP notifications could be sent here if supported.
    });
  }

  /**
   * Handle tool calls.
   */
  private async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: TextContent[]; isError?: boolean }> {
    try {
      logger.debug("Tool call", { name, args });

      let result: unknown;

      switch (name) {
        case "connect_debugger": {
          const params = ConnectDebuggerSchema.parse(args);
          const session = await this.sessionManager.connect(
            params.websocket_url,
            params.session_name,
          );
          result = {
            session_id: session.id,
            state: session.state,
            target_url: session.targetUrl,
          };
          break;
        }

        case "disconnect_debugger": {
          const params = DisconnectDebuggerSchema.parse(args);
          await this.sessionManager.disconnect(params.session_id);
          result = { success: true, session_id: params.session_id };
          break;
        }

        case "set_breakpoint": {
          const params = SetBreakpointSchema.parse(args);
          const bpResult = await this.sessionManager.setBreakpoint(
            params.session_id,
            params.url,
            params.line_number,
            params.column_number,
            params.condition,
            params.ignore_count,
          );
          result = {
            breakpoint_id: bpResult.breakpointId,
            locations: bpResult.locations.map((loc) => ({
              script_id: loc.scriptId,
              line_number: loc.lineNumber,
              column_number: loc.columnNumber,
            })),
          };
          break;
        }

        case "remove_breakpoint": {
          const params = RemoveBreakpointSchema.parse(args);
          await this.sessionManager.removeBreakpoint(params.session_id, params.breakpoint_id);
          result = { success: true, breakpoint_id: params.breakpoint_id };
          break;
        }

        case "list_breakpoints": {
          const params = ListBreakpointsSchema.parse(args);
          const breakpoints = this.sessionManager.listBreakpoints(params.session_id);
          result = {
            breakpoints: breakpoints.map((bp) => ({
              id: bp.id,
              url: bp.url,
              line_number: bp.lineNumber,
              column_number: bp.columnNumber,
              condition: bp.condition,
              enabled: bp.enabled,
            })),
          };
          break;
        }

        case "resume_execution": {
          const params = SessionIdSchema.parse(args);
          await this.sessionManager.resume(params.session_id);
          result = { success: true, state: "running" };
          break;
        }

        case "step_over": {
          const params = SessionIdSchema.parse(args);
          await this.sessionManager.stepOver(params.session_id);
          result = { success: true, state: "stepping" };
          break;
        }

        case "step_into": {
          const params = SessionIdSchema.parse(args);
          await this.sessionManager.stepInto(params.session_id);
          result = { success: true, state: "stepping" };
          break;
        }

        case "step_out": {
          const params = SessionIdSchema.parse(args);
          await this.sessionManager.stepOut(params.session_id);
          result = { success: true, state: "stepping" };
          break;
        }

        case "pause_execution": {
          const params = SessionIdSchema.parse(args);
          await this.sessionManager.pause(params.session_id);
          result = { success: true, state: "pausing" };
          break;
        }

        case "get_call_stack": {
          const params = GetCallStackSchema.parse(args);
          const callFrames = this.sessionManager.getCallStack(params.session_id);
          result = {
            call_frames: callFrames.map((frame) => ({
              call_frame_id: frame.callFrameId,
              function_name: frame.functionName,
              script_id: frame.scriptId,
              url: frame.url,
              line_number: frame.lineNumber,
              column_number: frame.columnNumber,
              this: frame.thisObject,
              scope_chain: frame.scopeChain.map((scope) => ({
                type: scope.type,
                name: scope.name,
              })),
            })),
          };
          break;
        }

        case "evaluate_expression": {
          const params = EvaluateExpressionSchema.parse(args);
          const evalResult = await this.sessionManager.evaluateExpression(
            params.session_id,
            params.expression,
            params.call_frame_id,
            params.return_by_value,
          );
          result = {
            result: {
              type: evalResult.result.type,
              value: evalResult.result.value,
              description: evalResult.result.description,
            },
            exception_details: evalResult.exceptionDetails
              ? {
                  text: evalResult.exceptionDetails.text,
                  line_number: evalResult.exceptionDetails.lineNumber,
                  column_number: evalResult.exceptionDetails.columnNumber,
                }
              : null,
          };
          break;
        }

        case "get_scope_variables": {
          const params = GetScopeVariablesSchema.parse(args);
          const variables = await this.sessionManager.getScopeVariables(
            params.session_id,
            params.call_frame_id,
            params.scope_index,
          );
          result = {
            variables: variables.map((v) => ({
              name: v.name,
              value: {
                type: v.value.type,
                value: v.value.value,
                description: v.value.description,
              },
            })),
          };
          break;
        }

        case "set_variable_value": {
          const params = SetVariableValueSchema.parse(args);
          await this.sessionManager.setVariableValue(
            params.session_id,
            params.call_frame_id,
            params.scope_index,
            params.variable_name,
            params.new_value,
          );
          result = { success: true };
          break;
        }

        case "set_pause_on_exceptions": {
          const params = SetPauseOnExceptionsSchema.parse(args);
          await this.sessionManager.setPauseOnExceptions(params.session_id, params.state);
          result = { success: true, state: params.state };
          break;
        }

        default:
          throw new DebuggerError(ErrorCode.INVALID_PARAMETERS, `Unknown tool: ${name}`);
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error("Tool call error", {
        name,
        error: error instanceof Error ? error.message : String(error),
      });

      const errorResponse = this.formatError(error);
      return {
        content: [{ type: "text", text: JSON.stringify(errorResponse, null, 2) }],
        isError: true,
      };
    }
  }

  /**
   * Handle resource reads.
   */
  private async handleResourceRead(
    uri: string,
  ): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    logger.debug("Resource read", { uri });

    if (uri === "debug://sessions") {
      const sessions = this.sessionManager.listSessions();
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ sessions }, null, 2),
          },
        ],
      };
    }

    // Handle session-specific resources.
    const sessionMatch = uri.match(/^debug:\/\/sessions\/(.+)$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      try {
        const details = this.sessionManager.getSessionDetails(sessionId);
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(details, null, 2),
            },
          ],
        };
      } catch (error) {
        throw new Error(`Session not found: ${sessionId}`);
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  }

  /**
   * Handle prompt requests.
   */
  private async handlePromptGet(
    name: string,
    args: Record<string, string>,
  ): Promise<{ messages: Array<{ role: "user" | "assistant"; content: { type: "text"; text: string } }> }> {
    logger.debug("Prompt get", { name, args });

    switch (name) {
      case "analyze_crash": {
        const sessionId = args.session_id;
        if (!sessionId) {
          throw new Error("session_id is required");
        }
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `I'll help you analyse why execution stopped. Let me:

1. Get the current call stack
2. Examine variables in each frame
3. Look for common issues (null references, type errors, etc.)
4. Suggest potential causes

Session ID: ${sessionId}

Would you like me to proceed with this analysis?`,
              },
            },
          ],
        };
      }

      case "investigate_condition": {
        const sessionId = args.session_id;
        const expression = args.expression;
        if (!sessionId || !expression) {
          throw new Error("session_id and expression are required");
        }
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `I'll evaluate this expression across the current call stack to understand its state:

Expression: ${expression}
Session ID: ${sessionId}

I'll evaluate it in:
- Global scope
- Each frame in the call stack

Would you like to proceed?`,
              },
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  }

  /**
   * Format an error for response.
   */
  private formatError(error: unknown): { error: { code: string; message: string; details?: unknown } } {
    if (error instanceof DebuggerError) {
      return {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      };
    }

    if (error instanceof z.ZodError) {
      return {
        error: {
          code: ErrorCode.INVALID_PARAMETERS,
          message: "Invalid parameters",
          details: error.errors,
        },
      };
    }

    return {
      error: {
        code: "UNKNOWN_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * Run the server.
   */
  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info("WebKit Debug MCP Server running on stdio");
  }
}
