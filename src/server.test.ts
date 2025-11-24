/**
 * Tests for MCP Server.
 *
 * @author John Grimes
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {createServer} from './server.js';
import type {Server} from '@modelcontextprotocol/sdk/server/index.js';

// Mock SessionManager.
const mockSessionManager = {
  createSession: vi.fn().mockResolvedValue('test-session-id'),
  destroySession: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockReturnValue([]),
  getSessionDetails: vi.fn().mockReturnValue({
    id: 'test-session-id',
    name: 'Test Session',
    targetUrl: 'ws://localhost:9229/test',
    state: 'connected',
    breakpoints: [],
  }),
  setBreakpoint: vi.fn().mockResolvedValue({
    id: 'bp-123',
    url: 'file:///test.js',
    lineNumber: 10,
    columnNumber: 0,
    enabled: true,
    resolvedLocations: [{scriptId: 'script-1', lineNumber: 10, columnNumber: 0}],
  }),
  removeBreakpoint: vi.fn().mockResolvedValue(undefined),
  listBreakpoints: vi.fn().mockReturnValue([]),
  resume: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  stepOver: vi.fn().mockResolvedValue(undefined),
  stepInto: vi.fn().mockResolvedValue(undefined),
  stepOut: vi.fn().mockResolvedValue(undefined),
  getCallStack: vi.fn().mockReturnValue({
    callFrames: [],
    asyncStackTrace: undefined,
  }),
  evaluate: vi.fn().mockResolvedValue({
    result: {type: 'number', value: 42},
  }),
  getScopeVariables: vi.fn().mockResolvedValue([
    {name: 'x', value: {type: 'number', value: 1}, writable: true},
  ]),
  setVariableValue: vi.fn().mockResolvedValue(undefined),
  setPauseOnExceptions: vi.fn().mockResolvedValue(undefined),
  getOriginalLocation: vi.fn().mockReturnValue({hasSourceMap: false}),
  getScriptSource: vi.fn().mockResolvedValue({
    source: 'console.log("test");',
    sourceUrl: 'file:///test.js',
    isOriginal: false,
  }),
  listScripts: vi.fn().mockReturnValue([]),
  on: vi.fn(),
};

vi.mock('./session-manager.js', () => ({
  SessionManager: function SessionManager() {
    return mockSessionManager;
  },
}));

// Helper to extract request handlers from server.
type RequestHandler = (request: {params: unknown}) => Promise<unknown>;
const handlers: Record<string, RequestHandler> = {};

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class MockServer {
    setRequestHandler(schema: {method: string}, handler: RequestHandler) {
      handlers[schema.method] = handler;
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: {method: 'tools/list'},
  CallToolRequestSchema: {method: 'tools/call'},
  ListResourcesRequestSchema: {method: 'resources/list'},
  ReadResourceRequestSchema: {method: 'resources/read'},
}));

describe('MCP Server', () => {
  let server: Server;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset handlers.
    Object.keys(handlers).forEach((key) => delete handlers[key]);
    server = createServer();
  });

  describe('createServer', () => {
    it('should create a server instance', () => {
      expect(server).toBeDefined();
    });
  });

  describe('tools/list', () => {
    it('should return list of available tools', async () => {
      const handler = handlers['tools/list'];
      const result = (await handler({params: {}})) as {
        tools: Array<{name: string}>;
      };

      expect(result.tools).toBeDefined();
      expect(result.tools.length).toBeGreaterThan(0);

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain('connect_debugger');
      expect(toolNames).toContain('disconnect_debugger');
      expect(toolNames).toContain('set_breakpoint');
      expect(toolNames).toContain('remove_breakpoint');
      expect(toolNames).toContain('list_breakpoints');
      expect(toolNames).toContain('resume_execution');
      expect(toolNames).toContain('step_over');
      expect(toolNames).toContain('step_into');
      expect(toolNames).toContain('step_out');
      expect(toolNames).toContain('pause_execution');
      expect(toolNames).toContain('get_call_stack');
      expect(toolNames).toContain('evaluate_expression');
      expect(toolNames).toContain('get_scope_variables');
      expect(toolNames).toContain('set_variable_value');
      expect(toolNames).toContain('set_pause_on_exceptions');
      expect(toolNames).toContain('get_original_location');
      expect(toolNames).toContain('get_script_source');
      expect(toolNames).toContain('list_scripts');
    });
  });

  describe('tools/call', () => {
    describe('connect_debugger', () => {
      it('should connect to a debugger', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'connect_debugger',
            arguments: {
              websocket_url: 'ws://localhost:9229/test',
              session_name: 'Test Session',
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.session_id).toBe('test-session-id');
        expect(response.state).toBe('connected');
      });
    });

    describe('disconnect_debugger', () => {
      it('should disconnect from a debugger', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'disconnect_debugger',
            arguments: {session_id: 'test-session-id'},
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(mockSessionManager.destroySession).toHaveBeenCalledWith(
          'test-session-id'
        );
      });
    });

    describe('set_breakpoint', () => {
      it('should set a breakpoint', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'set_breakpoint',
            arguments: {
              session_id: 'test-session-id',
              url: 'file:///test.js',
              line_number: 10,
              column_number: 0,
              condition: 'x > 5',
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.breakpoint_id).toBe('bp-123');
        expect(response.locations).toHaveLength(1);
      });
    });

    describe('remove_breakpoint', () => {
      it('should remove a breakpoint', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'remove_breakpoint',
            arguments: {
              session_id: 'test-session-id',
              breakpoint_id: 'bp-123',
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
      });
    });

    describe('list_breakpoints', () => {
      it('should list breakpoints', async () => {
        mockSessionManager.listBreakpoints.mockReturnValue([
          {
            id: 'bp-123',
            url: 'file:///test.js',
            lineNumber: 10,
            columnNumber: 0,
            condition: undefined,
            enabled: true,
          },
        ]);

        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'list_breakpoints',
            arguments: {session_id: 'test-session-id'},
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.breakpoints).toHaveLength(1);
        expect(response.breakpoints[0].id).toBe('bp-123');
      });
    });

    describe('resume_execution', () => {
      it('should resume execution', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'resume_execution',
            arguments: {session_id: 'test-session-id'},
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.state).toBe('running');
      });
    });

    describe('step_over', () => {
      it('should step over', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'step_over',
            arguments: {session_id: 'test-session-id'},
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.state).toBe('stepping');
      });
    });

    describe('step_into', () => {
      it('should step into', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'step_into',
            arguments: {session_id: 'test-session-id'},
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.state).toBe('stepping');
      });
    });

    describe('step_out', () => {
      it('should step out', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'step_out',
            arguments: {session_id: 'test-session-id'},
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.state).toBe('stepping');
      });
    });

    describe('pause_execution', () => {
      it('should pause execution', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'pause_execution',
            arguments: {session_id: 'test-session-id'},
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.state).toBe('pausing');
      });
    });

    describe('get_call_stack', () => {
      it('should get call stack', async () => {
        mockSessionManager.getCallStack.mockReturnValue({
          callFrames: [
            {
              callFrameId: 'frame-1',
              functionName: 'test',
              generatedLocation: {scriptId: 'script-1', lineNumber: 10, columnNumber: 0},
              originalLocation: {
                sourceUrl: 'src/app.ts',
                lineNumber: 5,
                columnNumber: 0,
                functionName: 'test',
              },
              scopeChain: [{type: 'local', name: 'Local'}],
              this: {type: 'object'},
            },
          ],
          asyncStackTrace: {description: 'Promise.then'},
        });

        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'get_call_stack',
            arguments: {session_id: 'test-session-id', include_async: true},
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.call_frames).toHaveLength(1);
        expect(response.call_frames[0].function_name).toBe('test');
        expect(response.async_stack_trace).toBeDefined();
      });
    });

    describe('evaluate_expression', () => {
      it('should evaluate expression', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'evaluate_expression',
            arguments: {
              session_id: 'test-session-id',
              expression: '1 + 1',
              call_frame_id: 'frame-1',
              return_by_value: true,
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.result.value).toBe(42);
      });

      it('should include exception details when evaluation fails', async () => {
        mockSessionManager.evaluate.mockResolvedValue({
          result: {type: 'undefined'},
          exceptionDetails: {
            text: 'ReferenceError',
            lineNumber: 1,
            columnNumber: 0,
          },
        });

        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'evaluate_expression',
            arguments: {
              session_id: 'test-session-id',
              expression: 'undefinedVar',
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.exception_details).toBeDefined();
        expect(response.exception_details.text).toBe('ReferenceError');
      });
    });

    describe('get_scope_variables', () => {
      it('should get scope variables', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'get_scope_variables',
            arguments: {
              session_id: 'test-session-id',
              call_frame_id: 'frame-1',
              scope_index: 0,
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.variables).toHaveLength(1);
        expect(response.variables[0].name).toBe('x');
      });
    });

    describe('set_variable_value', () => {
      it('should set variable value', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'set_variable_value',
            arguments: {
              session_id: 'test-session-id',
              call_frame_id: 'frame-1',
              scope_index: 0,
              variable_name: 'x',
              new_value: '100',
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
      });
    });

    describe('set_pause_on_exceptions', () => {
      it('should set pause on exceptions', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'set_pause_on_exceptions',
            arguments: {
              session_id: 'test-session-id',
              state: 'all',
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.success).toBe(true);
        expect(response.state).toBe('all');
      });
    });

    describe('get_original_location', () => {
      it('should get original location without source map', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'get_original_location',
            arguments: {
              session_id: 'test-session-id',
              script_id: 'script-1',
              line_number: 10,
              column_number: 0,
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.has_source_map).toBe(false);
      });

      it('should get original location with source map', async () => {
        mockSessionManager.getOriginalLocation.mockReturnValue({
          hasSourceMap: true,
          original: {
            sourceUrl: 'src/app.ts',
            lineNumber: 5,
            columnNumber: 0,
            name: 'test',
          },
        });

        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'get_original_location',
            arguments: {
              session_id: 'test-session-id',
              script_id: 'script-1',
              line_number: 10,
              column_number: 0,
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.has_source_map).toBe(true);
        expect(response.original.source_url).toBe('src/app.ts');
      });
    });

    describe('get_script_source', () => {
      it('should get script source', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'get_script_source',
            arguments: {
              session_id: 'test-session-id',
              script_id: 'script-1',
              prefer_original: true,
            },
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.source).toBe('console.log("test");');
        expect(response.is_original).toBe(false);
      });
    });

    describe('list_scripts', () => {
      it('should list scripts', async () => {
        mockSessionManager.listScripts.mockReturnValue([
          {
            scriptId: 'script-1',
            url: 'file:///test.js',
            sourceMapUrl: undefined,
            originalSources: undefined,
            isInternal: false,
          },
        ]);

        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'list_scripts',
            arguments: {session_id: 'test-session-id', include_internal: false},
          },
        })) as {content: Array<{text: string}>};

        const response = JSON.parse(result.content[0].text);
        expect(response.scripts).toHaveLength(1);
        expect(response.scripts[0].script_id).toBe('script-1');
      });
    });

    describe('error handling', () => {
      it('should return error for unknown tool', async () => {
        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'unknown_tool',
            arguments: {},
          },
        })) as {content: Array<{text: string}>; isError: boolean};

        expect(result.isError).toBe(true);
        const response = JSON.parse(result.content[0].text);
        expect(response.error.message).toContain('Unknown tool');
      });

      it('should handle session manager errors', async () => {
        const error = new Error('Session not found');
        (error as Error & {code: string}).code = 'SESSION_NOT_FOUND';
        mockSessionManager.destroySession.mockRejectedValue(error);

        const handler = handlers['tools/call'];
        const result = (await handler({
          params: {
            name: 'disconnect_debugger',
            arguments: {session_id: 'unknown'},
          },
        })) as {content: Array<{text: string}>; isError: boolean};

        expect(result.isError).toBe(true);
        const response = JSON.parse(result.content[0].text);
        expect(response.error.code).toBe('SESSION_NOT_FOUND');
      });
    });
  });

  describe('resources/list', () => {
    it('should return list of resources', async () => {
      mockSessionManager.listSessions.mockReturnValue([
        {
          id: 'test-session-id',
          name: 'Test Session',
          targetUrl: 'ws://localhost:9229/test',
          state: 'connected',
        },
      ]);

      const handler = handlers['resources/list'];
      const result = (await handler({params: {}})) as {
        resources: Array<{uri: string; name: string}>;
      };

      expect(result.resources).toHaveLength(2);
      expect(result.resources[0].uri).toBe('debug://sessions');
      expect(result.resources[1].uri).toBe('debug://sessions/test-session-id');
    });
  });

  describe('resources/read', () => {
    it('should read sessions list resource', async () => {
      mockSessionManager.listSessions.mockReturnValue([]);

      const handler = handlers['resources/read'];
      const result = (await handler({
        params: {uri: 'debug://sessions'},
      })) as {contents: Array<{text: string}>};

      const response = JSON.parse(result.contents[0].text);
      expect(response.sessions).toEqual([]);
    });

    it('should read specific session resource', async () => {
      const handler = handlers['resources/read'];
      const result = (await handler({
        params: {uri: 'debug://sessions/test-session-id'},
      })) as {contents: Array<{text: string}>};

      const response = JSON.parse(result.contents[0].text);
      expect(response.id).toBe('test-session-id');
    });

    it('should throw for session not found', async () => {
      mockSessionManager.getSessionDetails.mockImplementation(() => {
        throw new Error('Session not found');
      });

      const handler = handlers['resources/read'];

      await expect(
        handler({params: {uri: 'debug://sessions/unknown'}})
      ).rejects.toThrow('Session not found');
    });

    it('should throw for unknown resource', async () => {
      const handler = handlers['resources/read'];

      await expect(
        handler({params: {uri: 'debug://unknown'}})
      ).rejects.toThrow('Unknown resource');
    });
  });
});
