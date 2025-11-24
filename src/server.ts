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
 * MCP Server implementation for CDP debugging.
 *
 * @author John Grimes
 */

import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {SessionManager} from './session-manager.js';
import {ErrorCode} from './types.js';

/**
 * Creates and configures the MCP server with debugging tools.
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: 'cdp-debug-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  const sessionManager = new SessionManager();

  // Register tool handlers.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'connect_debugger',
          description:
            'Establishes a new debugging session by connecting to a Chrome DevTools Protocol (CDP) endpoint. ' +
            'Use this to connect to Node.js (started with --inspect), Chrome, Edge, or other CDP-compatible runtimes. ' +
            'Returns a session_id that must be used in all subsequent debugging operations.',
          inputSchema: {
            type: 'object',
            properties: {
              websocket_url: {
                type: 'string',
                description:
                  'WebSocket URL for the CDP endpoint. For Node.js, this is typically ws://localhost:9229/{uuid}. ' +
                  'For Chrome, use ws://localhost:9222/devtools/page/{pageId}. ' +
                  'You can find available targets by visiting http://localhost:9229/json (Node.js) or http://localhost:9222/json (Chrome).',
              },
              session_name: {
                type: 'string',
                description:
                  'Optional human-readable name for this debugging session. Useful when managing multiple concurrent sessions.',
              },
            },
            required: ['websocket_url'],
          },
        },
        {
          name: 'disconnect_debugger',
          description:
            'Closes an active debugging session and releases all resources. ' +
            'Any breakpoints set in the session will be removed.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description:
                  'ID of the debugging session to disconnect. Obtain this from connect_debugger or the debug://sessions resource.',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'set_breakpoint',
          description:
            'Sets a breakpoint at a specific location in the code. ' +
            'The breakpoint will pause execution when the specified line is reached. ' +
            'You can set conditional breakpoints that only trigger when an expression evaluates to true.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session.',
              },
              url: {
                type: 'string',
                description:
                  'URL of the script where the breakpoint should be set. ' +
                  'For Node.js, use file:// URLs (e.g., file:///path/to/script.js). ' +
                  'For remote scripts, use the full URL. Use list_scripts to find available scripts.',
              },
              line_number: {
                type: 'integer',
                description:
                  'Line number (0-based) where the breakpoint should be set. ' +
                  'Note: Most editors display 1-based line numbers, so subtract 1.',
              },
              column_number: {
                type: 'integer',
                description:
                  'Optional column number (0-based). Useful for setting breakpoints in minified code.',
              },
              condition: {
                type: 'string',
                description:
                  'Optional JavaScript expression. The breakpoint only triggers when this expression evaluates to true. ' +
                  'Example: "count > 100" or "user.name === \'admin\'"',
              },
            },
            required: ['session_id', 'url', 'line_number'],
          },
        },
        {
          name: 'remove_breakpoint',
          description:
            'Removes a previously set breakpoint. Use list_breakpoints to find breakpoint IDs.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session.',
              },
              breakpoint_id: {
                type: 'string',
                description:
                  'ID of the breakpoint to remove. Obtain this from set_breakpoint or list_breakpoints.',
              },
            },
            required: ['session_id', 'breakpoint_id'],
          },
        },
        {
          name: 'list_breakpoints',
          description:
            'Lists all breakpoints set in a debugging session, including their locations and conditions.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session.',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'resume_execution',
          description:
            'Resumes execution after being paused at a breakpoint or by pause_execution. ' +
            'Execution continues until the next breakpoint or the program ends.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session. The session must be paused.',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'step_over',
          description:
            'Steps over the current statement to the next line in the same function. ' +
            'If the current line contains a function call, the entire function executes without stepping into it. ' +
            'The session must be paused.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session. The session must be paused.',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'step_into',
          description:
            'Steps into a function call if the current line contains one, otherwise steps to the next statement. ' +
            'Use this to examine what happens inside a function. The session must be paused.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session. The session must be paused.',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'step_out',
          description:
            'Steps out of the current function and pauses at the calling code. ' +
            'Use this to quickly exit a function you\'ve stepped into. The session must be paused.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session. The session must be paused.',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'pause_execution',
          description:
            'Pauses execution at the next possible opportunity. ' +
            'Use this when the program is running and you want to inspect its state.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session. The session must be running.',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'get_call_stack',
          description:
            'Retrieves the current call stack when execution is paused. ' +
            'Shows the chain of function calls that led to the current location, ' +
            'including function names, file locations, and scope information. ' +
            'If source maps are available, original source locations are included.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session. The session must be paused.',
              },
              include_async: {
                type: 'boolean',
                description:
                  'Whether to include asynchronous stack traces (Promise chains, async/await). Defaults to true.',
              },
            },
            required: ['session_id'],
          },
        },
        {
          name: 'evaluate_expression',
          description:
            'Evaluates a JavaScript expression in the context of a specific call frame or global context. ' +
            'Use this to inspect variables, test expressions, or understand the program state. ' +
            'The expression is evaluated in the JavaScript runtime, so you can call methods, access properties, etc.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session.',
              },
              expression: {
                type: 'string',
                description:
                  'JavaScript expression to evaluate. Examples: "myVariable", "array.length", "JSON.stringify(data)", "obj.method()"',
              },
              call_frame_id: {
                type: 'string',
                description:
                  'Optional call frame ID to evaluate in. If not provided, evaluates in the global context. ' +
                  'Obtain call_frame_id from get_call_stack. Evaluating in a frame provides access to local variables.',
              },
              return_by_value: {
                type: 'boolean',
                description:
                  'Whether to return the result by value (serialised) or as a remote object reference. ' +
                  'Defaults to true. Set to false for large objects to avoid serialisation overhead.',
              },
            },
            required: ['session_id', 'expression'],
          },
        },
        {
          name: 'get_scope_variables',
          description:
            'Retrieves all variables in a specific scope. ' +
            'Use this to see all local variables, closure variables, or global variables at a given point in execution.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session. The session must be paused.',
              },
              call_frame_id: {
                type: 'string',
                description:
                  'ID of the call frame. Obtain this from get_call_stack.',
              },
              scope_index: {
                type: 'integer',
                description:
                  'Index of the scope in the scope chain. 0 is the local scope, higher indices are closure and global scopes. Defaults to 0.',
              },
            },
            required: ['session_id', 'call_frame_id'],
          },
        },
        {
          name: 'set_variable_value',
          description:
            'Modifies the value of a variable in a specific call frame. ' +
            'Use this to test different scenarios or fix values during debugging.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session. The session must be paused.',
              },
              call_frame_id: {
                type: 'string',
                description:
                  'ID of the call frame containing the variable. Obtain from get_call_stack.',
              },
              scope_index: {
                type: 'integer',
                description:
                  'Index of the scope containing the variable. 0 is the local scope.',
              },
              variable_name: {
                type: 'string',
                description: 'Name of the variable to modify.',
              },
              new_value: {
                type: 'string',
                description:
                  'JavaScript expression that evaluates to the new value. Examples: "42", "\'new string\'", "{a: 1, b: 2}", "null"',
              },
            },
            required: [
              'session_id',
              'call_frame_id',
              'scope_index',
              'variable_name',
              'new_value',
            ],
          },
        },
        {
          name: 'set_pause_on_exceptions',
          description:
            'Configures whether the debugger should pause when exceptions are thrown. ' +
            'Useful for catching errors as they occur.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session.',
              },
              state: {
                type: 'string',
                enum: ['none', 'uncaught', 'all'],
                description:
                  'When to pause: "none" (never pause on exceptions), ' +
                  '"uncaught" (pause only on uncaught exceptions), ' +
                  '"all" (pause on all exceptions, including caught ones).',
              },
            },
            required: ['session_id', 'state'],
          },
        },
        {
          name: 'get_original_location',
          description:
            'Maps a generated code location back to the original source location using source maps. ' +
            'Essential for debugging bundled or transpiled code (TypeScript, Babel, webpack, esbuild, etc.).',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session.',
              },
              script_id: {
                type: 'string',
                description:
                  'ID of the script containing the generated code. Obtain from list_scripts or get_call_stack.',
              },
              line_number: {
                type: 'integer',
                description: 'Line number in the generated code (1-based).',
              },
              column_number: {
                type: 'integer',
                description: 'Column number in the generated code (0-based).',
              },
            },
            required: ['session_id', 'script_id', 'line_number', 'column_number'],
          },
        },
        {
          name: 'get_script_source',
          description:
            'Retrieves the source code for a script. ' +
            'If source maps are available, can return the original source instead of the generated/bundled code.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session.',
              },
              script_id: {
                type: 'string',
                description:
                  'ID of the script. Obtain from list_scripts or get_call_stack.',
              },
              prefer_original: {
                type: 'boolean',
                description:
                  'If true and a source map exists, return the original source (e.g., TypeScript). Defaults to true.',
              },
            },
            required: ['session_id', 'script_id'],
          },
        },
        {
          name: 'list_scripts',
          description:
            'Lists all scripts loaded in the debugging session. ' +
            'Includes source map information where available, showing which original sources are mapped.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'ID of the debugging session.',
              },
              include_internal: {
                type: 'boolean',
                description:
                  'Include internal scripts (node_modules, Node.js built-ins). Defaults to false.',
              },
            },
            required: ['session_id'],
          },
        },
      ],
    };
  });

  // Handle tool calls.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const {name, arguments: args} = request.params;

    try {
      switch (name) {
        case 'connect_debugger': {
          const params = z
            .object({
              websocket_url: z.string(),
              session_name: z.string().optional(),
            })
            .parse(args);

          const sessionId = await sessionManager.createSession(
            params.websocket_url,
            params.session_name
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    session_id: sessionId,
                    state: 'connected',
                    message: 'Successfully connected to debugging target.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'disconnect_debugger': {
          const params = z.object({session_id: z.string()}).parse(args);

          await sessionManager.destroySession(params.session_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    session_id: params.session_id,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'set_breakpoint': {
          const params = z
            .object({
              session_id: z.string(),
              url: z.string(),
              line_number: z.number(),
              column_number: z.number().optional(),
              condition: z.string().optional(),
            })
            .parse(args);

          const breakpoint = await sessionManager.setBreakpoint(
            params.session_id,
            params.url,
            params.line_number,
            params.column_number,
            params.condition
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    breakpoint_id: breakpoint.id,
                    locations: breakpoint.resolvedLocations.map((loc) => ({
                      script_id: loc.scriptId,
                      line_number: loc.lineNumber,
                      column_number: loc.columnNumber,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'remove_breakpoint': {
          const params = z
            .object({
              session_id: z.string(),
              breakpoint_id: z.string(),
            })
            .parse(args);

          await sessionManager.removeBreakpoint(
            params.session_id,
            params.breakpoint_id
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    breakpoint_id: params.breakpoint_id,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'list_breakpoints': {
          const params = z.object({session_id: z.string()}).parse(args);

          const breakpoints = sessionManager.listBreakpoints(params.session_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    breakpoints: breakpoints.map((bp) => ({
                      id: bp.id,
                      url: bp.url,
                      line_number: bp.lineNumber,
                      column_number: bp.columnNumber,
                      condition: bp.condition,
                      enabled: bp.enabled,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'resume_execution': {
          const params = z.object({session_id: z.string()}).parse(args);

          await sessionManager.resume(params.session_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    state: 'running',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'step_over': {
          const params = z.object({session_id: z.string()}).parse(args);

          await sessionManager.stepOver(params.session_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    state: 'stepping',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'step_into': {
          const params = z.object({session_id: z.string()}).parse(args);

          await sessionManager.stepInto(params.session_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    state: 'stepping',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'step_out': {
          const params = z.object({session_id: z.string()}).parse(args);

          await sessionManager.stepOut(params.session_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    state: 'stepping',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'pause_execution': {
          const params = z.object({session_id: z.string()}).parse(args);

          await sessionManager.pause(params.session_id);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    state: 'pausing',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'get_call_stack': {
          const params = z
            .object({
              session_id: z.string(),
              include_async: z.boolean().optional(),
            })
            .parse(args);

          const {callFrames, asyncStackTrace} = sessionManager.getCallStack(
            params.session_id,
            params.include_async ?? true
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    call_frames: callFrames.map((frame) => ({
                      call_frame_id: frame.callFrameId,
                      function_name: frame.functionName,
                      generated_location: {
                        script_id: frame.generatedLocation.scriptId,
                        line_number: frame.generatedLocation.lineNumber,
                        column_number: frame.generatedLocation.columnNumber,
                      },
                      original_location: frame.originalLocation
                        ? {
                            source_url: frame.originalLocation.sourceUrl,
                            line_number: frame.originalLocation.lineNumber,
                            column_number: frame.originalLocation.columnNumber,
                            function_name: frame.originalLocation.functionName,
                          }
                        : undefined,
                      scope_chain: frame.scopeChain.map((scope) => ({
                        type: scope.type,
                        name: scope.name,
                      })),
                    })),
                    async_stack_trace: asyncStackTrace
                      ? {
                          description: asyncStackTrace.description,
                        }
                      : undefined,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'evaluate_expression': {
          const params = z
            .object({
              session_id: z.string(),
              expression: z.string(),
              call_frame_id: z.string().optional(),
              return_by_value: z.boolean().optional(),
            })
            .parse(args);

          const {result, exceptionDetails} = await sessionManager.evaluate(
            params.session_id,
            params.expression,
            params.call_frame_id,
            params.return_by_value ?? true
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    result: {
                      type: result.type,
                      value: result.value,
                      description: result.description,
                      className: result.className,
                    },
                    exception_details: exceptionDetails
                      ? {
                          text: exceptionDetails.text,
                          line_number: exceptionDetails.lineNumber,
                          column_number: exceptionDetails.columnNumber,
                        }
                      : null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'get_scope_variables': {
          const params = z
            .object({
              session_id: z.string(),
              call_frame_id: z.string(),
              scope_index: z.number().optional(),
            })
            .parse(args);

          const variables = await sessionManager.getScopeVariables(
            params.session_id,
            params.call_frame_id,
            params.scope_index ?? 0
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    variables: variables.map((v) => ({
                      name: v.name,
                      value: {
                        type: v.value?.type,
                        value: v.value?.value,
                        description: v.value?.description,
                        className: v.value?.className,
                      },
                      writable: v.writable,
                      configurable: v.configurable,
                      enumerable: v.enumerable,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'set_variable_value': {
          const params = z
            .object({
              session_id: z.string(),
              call_frame_id: z.string(),
              scope_index: z.number(),
              variable_name: z.string(),
              new_value: z.string(),
            })
            .parse(args);

          await sessionManager.setVariableValue(
            params.session_id,
            params.call_frame_id,
            params.scope_index,
            params.variable_name,
            params.new_value
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({success: true}, null, 2),
              },
            ],
          };
        }

        case 'set_pause_on_exceptions': {
          const params = z
            .object({
              session_id: z.string(),
              state: z.enum(['none', 'uncaught', 'all']),
            })
            .parse(args);

          await sessionManager.setPauseOnExceptions(
            params.session_id,
            params.state
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    state: params.state,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'get_original_location': {
          const params = z
            .object({
              session_id: z.string(),
              script_id: z.string(),
              line_number: z.number(),
              column_number: z.number(),
            })
            .parse(args);

          const location = sessionManager.getOriginalLocation(
            params.session_id,
            params.script_id,
            params.line_number,
            params.column_number
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    has_source_map: location.hasSourceMap,
                    original: location.original
                      ? {
                          source_url: location.original.sourceUrl,
                          line_number: location.original.lineNumber,
                          column_number: location.original.columnNumber,
                          name: location.original.name,
                        }
                      : undefined,
                    generated: {
                      script_id: params.script_id,
                      line_number: params.line_number,
                      column_number: params.column_number,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'get_script_source': {
          const params = z
            .object({
              session_id: z.string(),
              script_id: z.string(),
              prefer_original: z.boolean().optional(),
            })
            .parse(args);

          const source = await sessionManager.getScriptSource(
            params.session_id,
            params.script_id,
            params.prefer_original ?? true
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    source: source.source,
                    source_url: source.sourceUrl,
                    is_original: source.isOriginal,
                    source_map_url: source.sourceMapUrl,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'list_scripts': {
          const params = z
            .object({
              session_id: z.string(),
              include_internal: z.boolean().optional(),
            })
            .parse(args);

          const scripts = sessionManager.listScripts(
            params.session_id,
            params.include_internal ?? false
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    scripts: scripts.map((s) => ({
                      script_id: s.scriptId,
                      url: s.url,
                      source_map_url: s.sourceMapUrl,
                      original_sources: s.originalSources,
                      is_internal: s.isInternal,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorCode =
        (error as Error & {code?: ErrorCode}).code ?? 'UNKNOWN_ERROR';

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: {
                  code: errorCode,
                  message: errorMessage,
                },
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });

  // Register resource handlers.
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const sessions = sessionManager.listSessions();

    const resources = [
      {
        uri: 'debug://sessions',
        name: 'Active Debugging Sessions',
        description: 'Lists all active debugging sessions with their current state.',
        mimeType: 'application/json',
      },
      ...sessions.map((session) => ({
        uri: `debug://sessions/${session.id}`,
        name: session.name ?? `Session ${session.id.substring(0, 8)}`,
        description: `Debugging session for ${session.targetUrl}`,
        mimeType: 'application/json',
      })),
    ];

    return {resources};
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const {uri} = request.params;

    if (uri === 'debug://sessions') {
      const sessions = sessionManager.listSessions();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({sessions}, null, 2),
          },
        ],
      };
    }

    const sessionMatch = uri.match(/^debug:\/\/sessions\/(.+)$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      try {
        const details = sessionManager.getSessionDetails(sessionId);
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(details, null, 2),
            },
          ],
        };
      } catch {
        throw new Error(`Session not found: ${sessionId}`);
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}
