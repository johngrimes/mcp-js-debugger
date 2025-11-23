# Chrome DevTools Protocol MCP Server Design Document

## Executive summary

This document outlines the design for a Model Context Protocol (MCP) server that
exposes debugging capabilities via the Chrome DevTools Protocol (CDP). The
server will enable MCP clients to control debugging sessions, manage
breakpoints, inspect execution state, and interact with JavaScript code running
in Node.js, Chrome, Edge, and other CDP-compatible runtimes.

## Background

The Chrome DevTools Protocol provides a JSON-RPC based communication system for
debugging JavaScript code. It operates over WebSocket connections and organises
functionality into domains (Debugger, Runtime, Network, etc.), with the Debugger
domain providing core debugging capabilities such as breakpoint management,
execution control, and call stack inspection.

The Model Context Protocol provides a standardised way for AI assistants and
development tools to interact with external systems through defined tools and
resources. By creating an MCP server that exposes CDP debugging functionality,
we enable AI-assisted debugging workflows and programmatic control of debugging
sessions.

### Why Chrome DevTools Protocol?

CDP is widely supported across JavaScript runtimes and provides a
well-documented, stable API:

- **Node.js**: Native support via `--inspect` flag
- **Chrome/Chromium**: Full support via `--remote-debugging-port`
- **Edge**: Full support via `--devtools-server-port`
- **Firefox**: Partial support (Nightly builds)
- **Deno**: Native support via `--inspect` flag

The protocol is actively maintained by the Chrome DevTools team with
comprehensive documentation
at https://chromedevtools.github.io/devtools-protocol/.

### Relationship to existing chrome-devtools-mcp

Google maintains an official `chrome-devtools-mcp` server at
https://github.com/ChromeDevTools/chrome-devtools-mcp which provides CDP
integration for AI coding assistants. That project focuses on browser automation
and observation:

**chrome-devtools-mcp capabilities:**

- Input automation: click, drag, fill, hover, keyboard input
- Navigation: page management, URL navigation, waiting
- Performance: trace recording and analysis
- Network: request monitoring
- Console: message retrieval
- Screenshots and snapshots

**Capabilities not covered by chrome-devtools-mcp (our focus):**

- Breakpoint management (set, remove, list, conditional)
- Execution control (pause, resume)
- Step-through debugging (step over, step into, step out)
- Call stack inspection
- Scope variable inspection
- Variable modification during debugging
- Exception handling configuration

This project fills the debugging gap by exposing the CDP Debugger domain, which
enables step-through debugging workflows that the existing server does not
support.

## Goals and non-goals

### Goals

- Provide MCP tools for core debugging operations: breakpoint management,
  execution control, and state inspection
- Support source maps for debugging bundled/transpiled code with original source
  locations
- Support both local and remote debugging sessions
- Enable multiple concurrent debugging sessions across different targets
- Maintain protocol compatibility with CDP-compliant runtimes
- Provide clear error handling and status reporting
- Support asynchronous debugging workflows through event notifications

### Non-goals

- Reimplementing the full Chrome DevTools Protocol (only exposing the Debugger
  domain initially)
- Providing a graphical debugging interface
- Implementing source code transformation or hot reloading
- Managing browser or runtime lifecycle (launching, closing)

## Architecture

### High-level overview

```
┌─────────────────┐
│   MCP Client    │
│  (AI Assistant) │
└────────┬────────┘
         │ MCP Protocol
         │ (stdio/HTTP)
         ▼
┌─────────────────────────────┐
│    CDP Debug MCP Server     │
│  ┌─────────────────────┐   │
│  │   Session Manager   │   │
│  └──────────┬──────────┘   │
│             │               │
│  ┌──────────┴──────────┐   │
│  │ chrome-remote-      │   │
│  │ interface clients   │   │
│  └──────────┬──────────┘   │
└─────────────┼──────────────┘
              │ WebSocket
              │ (Chrome DevTools Protocol)
              ▼
┌─────────────────────────────┐
│  Node.js / Chrome / Edge    │
│  ┌─────────────────────┐   │
│  │  Inspector Backend  │   │
│  └─────────────────────┘   │
└─────────────────────────────┘
```

### Component architecture

#### Session manager

Manages multiple debugging sessions and routes commands to the appropriate CDP
client.

**Responsibilities:**

- Creating and destroying debugging sessions
- Maintaining session state and metadata
- Routing MCP tool calls to the correct session
- Broadcasting events from CDP clients to MCP clients
- Handling session lifecycle and cleanup

**Key data structures:**

```typescript
interface DebugSession {
  id: string;
  targetUrl: string;
  cdpClient: CDP.Client;
  state: SessionState;
  breakpoints: Map<string, BreakpointInfo>;
  pausedState?: PausedState;
}

enum SessionState {
  CONNECTING = "connecting",
  CONNECTED = "connected",
  PAUSED = "paused",
  RUNNING = "running",
  DISCONNECTED = "disconnected"
}
```

#### CDP client (chrome-remote-interface)

We use the `chrome-remote-interface` library to handle CDP communication. This
well-maintained library provides:

- **Promise-based API**: Async/await friendly for sequential debugging commands
- **TypeScript support**: With devtools-protocol types
- **Event handling**: Built-in support for CDP events
- **Protocol domains**: Direct access to Debugger, Runtime, and other domains

**Example usage:**

```typescript
import CDP from 'chrome-remote-interface';

async function connectToTarget(host: string, port: number) {
  const client = await CDP({host, port});
  const {Debugger, Runtime} = client;

  // Enable debugging
  await Debugger.enable();

  // Listen for paused events
  Debugger.paused((params) => {
    console.log('Paused:', params.reason);
  });

  return client;
}
```

#### MCP tool handlers

Implement MCP tools that map to CDP commands.

**Responsibilities:**

- Validating tool parameters
- Translating MCP tool calls to CDP commands
- Formatting CDP responses for MCP clients
- Handling errors and providing meaningful feedback

## MCP interface design

### Resources

The server will expose resources providing information about active debugging
sessions and their state.

#### Active sessions resource

**URI:** `debug://sessions`

**MIME type:** `application/json`

**Description:** Lists all active debugging sessions with their current state.

**Example content:**

```json
{
  "sessions": [
    {
      "id": "session-123",
      "targetUrl": "ws://localhost:9229/devtools/page/1",
      "state": "paused",
      "pauseReason": "breakpoint",
      "scriptUrl": "file:///app/src/index.js",
      "lineNumber": 42
    }
  ]
}
```

#### Session details resource

**URI:** `debug://sessions/{sessionId}`

**MIME type:** `application/json`

**Description:** Detailed information about a specific debugging session,
including breakpoints and current execution state.

**Example content:**

```json
{
  "id": "session-123",
  "targetUrl": "ws://localhost:9229/devtools/page/1",
  "state": "paused",
  "breakpoints": [
    {
      "id": "bp-1",
      "scriptUrl": "file:///app/src/index.js",
      "lineNumber": 42,
      "condition": "x > 10",
      "enabled": true
    }
  ],
  "callStack": [
    {
      "functionName": "processData",
      "scriptUrl": "file:///app/src/index.js",
      "lineNumber": 42,
      "columnNumber": 12
    }
  ]
}
```

### Tools

#### connect_debugger

Establishes a new debugging session by connecting to a CDP endpoint.

**Parameters:**

```json
{
  "websocket_url": {
    "type": "string",
    "description": "WebSocket URL for the CDP endpoint (e.g., ws://localhost:9229/devtools/page/1)",
    "required": true
  },
  "session_name": {
    "type": "string",
    "description": "Optional human-readable name for the debugging session",
    "required": false
  }
}
```

**Returns:**

```json
{
  "session_id": "session-123",
  "state": "connected",
  "target_info": {
    "title": "Node.js Script",
    "url": "file:///app/src/index.js"
  }
}
```

**Example usage:**

```json
{
  "name": "connect_debugger",
  "arguments": {
    "websocket_url": "ws://localhost:9229/devtools/page/1",
    "session_name": "Main app debugging"
  }
}
```

#### disconnect_debugger

Closes an active debugging session.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session to disconnect",
    "required": true
  }
}
```

**Returns:**

```json
{
  "success": true,
  "session_id": "session-123"
}
```

#### set_breakpoint

Sets a breakpoint at a specific location in the code.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  },
  "url": {
    "type": "string",
    "description": "URL of the script where the breakpoint should be set",
    "required": true
  },
  "line_number": {
    "type": "integer",
    "description": "Line number (0-based) where the breakpoint should be set",
    "required": true
  },
  "column_number": {
    "type": "integer",
    "description": "Optional column number (0-based)",
    "required": false
  },
  "condition": {
    "type": "string",
    "description": "Optional condition that must be true for the breakpoint to trigger",
    "required": false
  }
}
```

**Returns:**

```json
{
  "breakpoint_id": "bp-456",
  "locations": [
    {
      "script_id": "15",
      "line_number": 42,
      "column_number": 0
    }
  ]
}
```

**Example usage:**

```json
{
  "name": "set_breakpoint",
  "arguments": {
    "session_id": "session-123",
    "url": "file:///app/src/index.js",
    "line_number": 42,
    "condition": "count > 100"
  }
}
```

#### remove_breakpoint

Removes a previously set breakpoint.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  },
  "breakpoint_id": {
    "type": "string",
    "description": "ID of the breakpoint to remove",
    "required": true
  }
}
```

**Returns:**

```json
{
  "success": true,
  "breakpoint_id": "bp-456"
}
```

#### list_breakpoints

Lists all breakpoints in a debugging session.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  }
}
```

**Returns:**

```json
{
  "breakpoints": [
    {
      "id": "bp-456",
      "url": "file:///app/src/index.js",
      "line_number": 42,
      "column_number": 0,
      "condition": "count > 100",
      "enabled": true
    }
  ]
}
```

#### resume_execution

Resumes execution after being paused.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  }
}
```

**Returns:**

```json
{
  "success": true,
  "state": "running"
}
```

#### step_over

Steps over the current statement to the next line.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  }
}
```

**Returns:**

```json
{
  "success": true,
  "state": "stepping"
}
```

#### step_into

Steps into a function call if present, otherwise steps to the next statement.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  }
}
```

**Returns:**

```json
{
  "success": true,
  "state": "stepping"
}
```

#### step_out

Steps out of the current function to the calling frame.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  }
}
```

**Returns:**

```json
{
  "success": true,
  "state": "stepping"
}
```

#### pause_execution

Pauses execution at the next possible opportunity.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  }
}
```

**Returns:**

```json
{
  "success": true,
  "state": "pausing"
}
```

#### get_call_stack

Retrieves the current call stack when execution is paused.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  },
  "include_async": {
    "type": "boolean",
    "description": "Whether to include asynchronous stack traces",
    "required": false,
    "default": true
  }
}
```

**Returns:**

```json
{
  "call_frames": [
    {
      "call_frame_id": "frame-1",
      "function_name": "processData",
      "script_id": "15",
      "url": "file:///app/src/index.js",
      "line_number": 42,
      "column_number": 12,
      "this": {
        "type": "object",
        "className": "DataProcessor"
      },
      "scope_chain": [
        {
          "type": "local",
          "object": {
            "type": "object",
            "objectId": "scope-1"
          }
        }
      ]
    }
  ],
  "async_stack_trace": {
    "description": "Promise.then",
    "call_frames": []
  }
}
```

#### evaluate_expression

Evaluates a JavaScript expression in the context of a specific call frame or the
global context.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  },
  "expression": {
    "type": "string",
    "description": "JavaScript expression to evaluate",
    "required": true
  },
  "call_frame_id": {
    "type": "string",
    "description": "Optional call frame ID to evaluate in. If not provided, evaluates in global context",
    "required": false
  },
  "return_by_value": {
    "type": "boolean",
    "description": "Whether to return the result by value or as a remote object reference",
    "required": false,
    "default": true
  }
}
```

**Returns:**

```json
{
  "result": {
    "type": "number",
    "value": 42,
    "description": "42"
  },
  "exception_details": null
}
```

**Example usage:**

```json
{
  "name": "evaluate_expression",
  "arguments": {
    "session_id": "session-123",
    "expression": "count * 2",
    "call_frame_id": "frame-1"
  }
}
```

#### get_scope_variables

Retrieves all variables in a specific scope.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  },
  "call_frame_id": {
    "type": "string",
    "description": "ID of the call frame",
    "required": true
  },
  "scope_index": {
    "type": "integer",
    "description": "Index of the scope in the scope chain (0 is local scope)",
    "required": false,
    "default": 0
  }
}
```

**Returns:**

```json
{
  "variables": [
    {
      "name": "count",
      "value": {
        "type": "number",
        "value": 42
      }
    },
    {
      "name": "data",
      "value": {
        "type": "object",
        "className": "Array",
        "description": "Array(10)"
      }
    }
  ]
}
```

#### set_variable_value

Modifies the value of a variable in a specific call frame.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  },
  "call_frame_id": {
    "type": "string",
    "description": "ID of the call frame containing the variable",
    "required": true
  },
  "scope_index": {
    "type": "integer",
    "description": "Index of the scope containing the variable",
    "required": true
  },
  "variable_name": {
    "type": "string",
    "description": "Name of the variable to modify",
    "required": true
  },
  "new_value": {
    "type": "string",
    "description": "JavaScript expression that evaluates to the new value",
    "required": true
  }
}
```

**Returns:**

```json
{
  "success": true
}
```

#### set_pause_on_exceptions

Configures whether the debugger should pause on exceptions.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  },
  "state": {
    "type": "string",
    "enum": [
      "none",
      "uncaught",
      "all"
    ],
    "description": "When to pause on exceptions: none (never), uncaught (only uncaught exceptions), all (all exceptions)",
    "required": true
  }
}
```

**Returns:**

```json
{
  "success": true,
  "state": "uncaught"
}
```

#### get_original_location

Maps a generated code location back to the original source location using source
maps. This is essential for debugging bundled or transpiled code (TypeScript,
Babel, webpack, etc.).

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  },
  "script_id": {
    "type": "string",
    "description": "ID of the script containing the generated code",
    "required": true
  },
  "line_number": {
    "type": "integer",
    "description": "Line number in the generated code (0-based)",
    "required": true
  },
  "column_number": {
    "type": "integer",
    "description": "Column number in the generated code (0-based)",
    "required": true
  }
}
```

**Returns:**

```json
{
  "has_source_map": true,
  "original": {
    "source_url": "src/components/Button.tsx",
    "line_number": 42,
    "column_number": 8,
    "name": "handleClick"
  },
  "generated": {
    "script_id": "15",
    "line_number": 1847,
    "column_number": 24
  }
}
```

#### get_script_source

Retrieves the source code for a script, with optional source map resolution to
return the original source instead of the generated code.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  },
  "script_id": {
    "type": "string",
    "description": "ID of the script",
    "required": true
  },
  "prefer_original": {
    "type": "boolean",
    "description": "If true and a source map exists, return the original source",
    "required": false,
    "default": true
  }
}
```

**Returns:**

```json
{
  "source": "export function handleClick(event: MouseEvent) {\n  ...",
  "source_url": "src/components/Button.tsx",
  "is_original": true,
  "source_map_url": "bundle.js.map"
}
```

#### list_scripts

Lists all scripts loaded in the debugging session, including source map
information where available.

**Parameters:**

```json
{
  "session_id": {
    "type": "string",
    "description": "ID of the debugging session",
    "required": true
  },
  "include_internal": {
    "type": "boolean",
    "description": "Include internal/node_modules scripts",
    "required": false,
    "default": false
  }
}
```

**Returns:**

```json
{
  "scripts": [
    {
      "script_id": "15",
      "url": "file:///app/dist/bundle.js",
      "source_map_url": "bundle.js.map",
      "original_sources": [
        "src/index.tsx",
        "src/components/Button.tsx",
        "src/utils/helpers.ts"
      ],
      "is_internal": false
    }
  ]
}
```

### Prompts

The server will provide prompt templates to guide common debugging workflows.

#### analyze_crash

Guides analysis of a crashed or paused application by examining the call stack
and local variables.

**Prompt:**

```
I'll help you analyze why execution stopped. Let me:

1. Get the current call stack
2. Examine variables in each frame
3. Look for common issues (null references, type errors, etc.)
4. Suggest potential causes

Session ID: {{session_id}}

Would you like me to proceed with this analysis?
```

#### investigate_condition

Helps investigate why a specific condition might be true or false.

**Prompt:**

```
I'll evaluate this expression across the current call stack to understand its state:

Expression: {{expression}}
Session ID: {{session_id}}

I'll evaluate it in:
- Global scope
- Each frame in the call stack

Would you like to proceed?
```

## Implementation details

### Technology stack

**Language:** TypeScript/Node.js

**Key dependencies:**

- `@modelcontextprotocol/sdk`: MCP server implementation
- `chrome-remote-interface`: CDP client library
- `source-map`: Source map parsing and position mapping
- `zod`: Schema validation for parameters
- `uuid`: Unique identifier generation

### CDP client integration

The server uses `chrome-remote-interface` for all CDP communication:

**Connection management:**

```typescript
import CDP from 'chrome-remote-interface';

class CDPClientWrapper {
  private client: CDP.Client | null = null;

  async connect(host: string, port: number): Promise<void> {
    this.client = await CDP({host, port});

    // Enable required domains
    await this.client.Debugger.enable();
    await this.client.Runtime.enable();

    // Set up event handlers
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.Debugger.paused((params) => {
      this.handlePaused(params);
    });

    this.client.Debugger.resumed(() => {
      this.handleResumed();
    });

    this.client.Debugger.scriptParsed((params) => {
      this.handleScriptParsed(params);
    });
  }

  async setBreakpoint(url: string, lineNumber: number, condition?: string) {
    if (!this.client) throw new Error('Not connected');

    return this.client.Debugger.setBreakpointByUrl({
      url,
      lineNumber,
      condition
    });
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
```

### Event handling

The server listens for key CDP events and translates them into notifications or
state updates:

**Critical events:**

- `Debugger.paused`: Execution paused (update session state, cache call frames)
- `Debugger.resumed`: Execution resumed (clear paused state)
- `Debugger.scriptParsed`: New script loaded (track available scripts)
- `Debugger.breakpointResolved`: Breakpoint location resolved (update breakpoint
  info)

**Event processing:**

```typescript
private
handlePaused(params
:
Protocol.Debugger.PausedEvent
):
void {
  this.session.state = SessionState.PAUSED;
  this.session.pausedState = {
    reason: params.reason,
    callFrames: params.callFrames,
    asyncStackTrace: params.asyncStackTrace,
    data: params.data
  };

  this.notifyMCPClient({
    type: 'execution_paused',
    sessionId: this.session.id,
    reason: params.reason,
    hitBreakpoints: params.hitBreakpoints
  });
}

private
handleResumed()
:
void {
  this.session.state = SessionState.RUNNING;
  this.session.pausedState = undefined;

  this.notifyMCPClient({
    type: 'execution_resumed',
    sessionId: this.session.id
  });
}
```

### Source map support

The server implements source map support to enable debugging of bundled and
transpiled code. When working with tools like webpack, esbuild, TypeScript, or
Babel, source maps allow the debugger to display original source locations
instead of the generated code.

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                     CDP Debug MCP Server                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │               Source Map Manager                     │   │
│  │  ┌─────────────────┐  ┌──────────────────────────┐ │   │
│  │  │ Source Map      │  │ Position Mapping Cache   │ │   │
│  │  │ Consumer Cache  │  │ (generated → original)   │ │   │
│  │  └─────────────────┘  └──────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Source map discovery:**

When a script is parsed (`Debugger.scriptParsed` event), the server checks for
source map references:

1. **Inline source maps**: Data URLs embedded in the script (e.g.,
   `//# sourceMappingURL=data:application/json;base64,...`)
2. **External source maps**: Referenced via URL (e.g.,
   `//# sourceMappingURL=bundle.js.map`)
3. **X-SourceMap header**: HTTP response header for remotely loaded scripts

**Source map manager implementation:**

```typescript
import {SourceMapConsumer} from 'source-map';

interface ScriptInfo {
  scriptId: string;
  url: string;
  sourceMapUrl?: string;
  sourceMapConsumer?: SourceMapConsumer;
  originalSources?: string[];
}

class SourceMapManager {
  private scripts = new Map<string, ScriptInfo>();
  private consumers = new Map<string, SourceMapConsumer>();

  async handleScriptParsed(params: Protocol.Debugger.ScriptParsedEvent) {
    const scriptInfo: ScriptInfo = {
      scriptId: params.scriptId,
      url: params.url,
      sourceMapUrl: params.sourceMapURL
    };

    if (params.sourceMapURL) {
      await this.loadSourceMap(scriptInfo);
    }

    this.scripts.set(params.scriptId, scriptInfo);
  }

  private async loadSourceMap(scriptInfo: ScriptInfo): Promise<void> {
    if (!scriptInfo.sourceMapUrl) return;

    try {
      const sourceMapJson = await this.fetchSourceMap(scriptInfo.sourceMapUrl);
      const consumer = await new SourceMapConsumer(sourceMapJson);
      scriptInfo.sourceMapConsumer = consumer;
      scriptInfo.originalSources = consumer.sources;
      this.consumers.set(scriptInfo.scriptId, consumer);
    } catch (error) {
      // Source map unavailable; continue with generated code
    }
  }

  getOriginalLocation(
    scriptId: string,
    line: number,
    column: number
  ): OriginalLocation | null {
    const consumer = this.consumers.get(scriptId);
    if (!consumer) return null;

    const original = consumer.originalPositionFor({line, column});
    if (!original.source) return null;

    return {
      source: original.source,
      line: original.line,
      column: original.column,
      name: original.name
    };
  }

  async getOriginalSource(
    scriptId: string,
    sourceUrl: string
  ): Promise<string | null> {
    const consumer = this.consumers.get(scriptId);
    if (!consumer) return null;

    return consumer.sourceContentFor(sourceUrl) || null;
  }
}
```

**Call stack mapping:**

When execution pauses, call stack frames are automatically enriched with
original source locations:

```typescript
interface EnrichedCallFrame {
  // Generated location (from CDP)
  generatedLocation: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  };
  // Original location (if source map available)
  originalLocation?: {
    sourceUrl: string;
    lineNumber: number;
    columnNumber: number;
    functionName?: string;
  };
}
```

**Breakpoint mapping:**

When setting breakpoints via `set_breakpoint`, the server:

1. Accepts original source URLs and line numbers
2. Maps to generated code locations using source maps
3. Sets the breakpoint at the generated location
4. Returns both original and generated location information

### Error handling

The server will implement comprehensive error handling:

**Error categories:**

1. **Connection errors**: WebSocket connection failures, timeouts
2. **Protocol errors**: Invalid commands, malformed responses
3. **Session errors**: Invalid session ID, session not in correct state
4. **Parameter errors**: Invalid tool parameters, missing required fields

**Error response format:**

```typescript
interface ErrorResponse {
  error: {
    code: string;
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
```

**Error codes:**

- `SESSION_NOT_FOUND`: Specified session ID doesn't exist
- `SESSION_INVALID_STATE`: Operation not valid in current session state
- `CONNECTION_FAILED`: Failed to establish connection
- `PROTOCOL_ERROR`: CDP returned an error
- `INVALID_PARAMETERS`: Tool parameters are invalid
- `TIMEOUT`: Operation timed out

### State synchronisation

The server maintains a local cache of debugging state to improve responsiveness:

**Cached state:**

- Active breakpoints with their resolved locations
- Current paused state (call stack, reason, data)
- Script information (ID, URL, source availability)
- Session connection status

**Cache invalidation:**

- Breakpoints: Invalidate on `breakpointResolved` events
- Paused state: Clear on `resumed` events
- Scripts: Update on `scriptParsed` events

## Security considerations

### WebSocket URL validation

The server will validate WebSocket URLs to prevent connection to malicious
endpoints:

**Validation rules:**

1. URL must use `ws://` or `wss://` scheme
2. Localhost connections: Allow any port
3. Remote connections: Require explicit allowlist or confirmation

**Configuration:**

```json
{
  "allowed_hosts": [
    "localhost",
    "127.0.0.1",
    "192.168.1.100"
  ],
  "require_confirmation_for_remote": true
}
```

### Command restrictions

The server will not expose destructive operations beyond debugging scope:

**Restricted operations:**

- No access to file system operations
- No ability to execute arbitrary system commands
- No access to network operations beyond debugging protocol
- Expression evaluation sandboxed to debugging context

### Credential management

If debugging targets require authentication:

**Approach:**

- Credentials passed through MCP tool parameters
- Not logged or persisted by the server
- Transmitted only over secure WebSocket connections (wss://)

## Testing strategy

### Unit tests

**Coverage areas:**

- Session manager: Session creation, routing, cleanup
- CDP client wrapper: Connection management, command execution
- Tool handlers: Parameter validation, protocol command generation
- State management: Cache updates, invalidation

**Testing approach:**

- Mock CDP client for predictable behaviour
- Test error conditions and edge cases
- Validate protocol message formatting

### Integration tests

**Test scenarios:**

1. Connect to a real Node.js debugging target
2. Set breakpoints and verify they trigger
3. Step through code execution
4. Evaluate expressions in different scopes
5. Handle disconnections and reconnections

**Test environment:**

- Use Node.js with `--inspect` flag as a debugging target
- Automated script to trigger breakpoints
- Verify server state matches protocol events

### End-to-end tests

**Workflow tests:**

1. Full debugging session: Connect, set breakpoints, pause, inspect, resume,
   disconnect
2. Multiple concurrent sessions
3. Error handling: Invalid commands, connection failures
4. Resource queries during active debugging

## Deployment considerations

### Configuration

The server will support configuration through environment variables and a config
file:

**Configuration options:**

```typescript
interface ServerConfig {
  // MCP transport
  transport: 'stdio' | 'http';
  httpPort?: number;

  // CDP settings
  connectionTimeout: number;
  commandTimeout: number;

  // Security
  allowedHosts: string[];
  requireConfirmationForRemote: boolean;

  // Session management
  maxConcurrentSessions: number;
  sessionIdleTimeout: number;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logProtocolMessages: boolean;
}
```

### Logging

Structured logging for debugging and monitoring:

**Log levels:**

- `debug`: Protocol messages, detailed state changes
- `info`: Session lifecycle events, tool invocations
- `warn`: Recoverable errors, retries
- `error`: Unrecoverable errors, crashes

**Log format:**

```typescript
interface LogEntry {
  timestamp: string;
  level: string;
  sessionId?: string;
  component: string;
  message: string;
  data?: object;
}
```

### Performance considerations

**Optimisation strategies:**

1. Cache frequently accessed data (call stacks, breakpoints)
2. Batch protocol commands when possible
3. Limit call stack depth in responses to reduce payload size
4. Implement request throttling to prevent overload

**Resource limits:**

- Maximum concurrent sessions: 10
- Maximum breakpoints per session: 100
- Maximum expression evaluation length: 10,000 characters
- WebSocket message size limit: 10 MB

## Success metrics

**Functional metrics:**

- Successfully connect to CDP debugging targets
- Set and trigger breakpoints with 100% reliability
- Execute stepping operations within 100ms
- Evaluate expressions and return results within 200ms

**Reliability metrics:**

- Handle connection failures gracefully
- Recover from protocol errors without session loss
- Support 10+ concurrent debugging sessions

**Usability metrics:**

- Clear error messages for all failure modes
- Complete documentation with examples
- MCP clients can implement common debugging workflows

## Appendices

### Appendix A: Chrome DevTools Protocol reference

Key protocol domains and commands used by this implementation:

**Debugger domain:**

- `Debugger.enable`: Enable debugging
- `Debugger.disable`: Disable debugging
- `Debugger.setBreakpointByUrl`: Set breakpoint by URL (persists across reloads)
- `Debugger.setBreakpoint`: Set breakpoint by script ID
- `Debugger.removeBreakpoint`: Remove breakpoint
- `Debugger.pause`: Pause execution
- `Debugger.resume`: Resume execution
- `Debugger.stepOver`: Step over
- `Debugger.stepInto`: Step into
- `Debugger.stepOut`: Step out
- `Debugger.evaluateOnCallFrame`: Evaluate expression in call frame
- `Debugger.setVariableValue`: Modify variable value
- `Debugger.setPauseOnExceptions`: Configure exception pausing

**Events:**

- `Debugger.paused`: Execution paused
- `Debugger.resumed`: Execution resumed
- `Debugger.scriptParsed`: Script loaded
- `Debugger.breakpointResolved`: Breakpoint location resolved

**Runtime domain (supplementary):**

- `Runtime.evaluate`: Evaluate expression in global context
- `Runtime.getProperties`: Get object properties
- `Runtime.callFunctionOn`: Call function on remote object

Full documentation: https://chromedevtools.github.io/devtools-protocol/

### Appendix B: Example debugging workflow

**Scenario:** Debug a Node.js application

**Step 0: Start Node.js with debugging enabled**

```bash
node --inspect=9229 app.js
# Or pause at start:
node --inspect-brk=9229 app.js
```

**Step 1: Connect to debugging target**

```json
{
  "name": "connect_debugger",
  "arguments": {
    "websocket_url": "ws://localhost:9229/devtools/page/1"
  }
}
```

**Step 2: Set breakpoint in target function**

```json
{
  "name": "set_breakpoint",
  "arguments": {
    "session_id": "session-123",
    "url": "file:///app/src/processor.js",
    "line_number": 15,
    "condition": "userData.length > 0"
  }
}
```

**Step 3: Wait for breakpoint to trigger**
(Server sends notification when paused)

**Step 4: Examine call stack**

```json
{
  "name": "get_call_stack",
  "arguments": {
    "session_id": "session-123",
    "include_async": true
  }
}
```

**Step 5: Evaluate expression to check data**

```json
{
  "name": "evaluate_expression",
  "arguments": {
    "session_id": "session-123",
    "expression": "userData.map(u => u.id)",
    "call_frame_id": "frame-1"
  }
}
```

**Step 6: Step through problematic code**

```json
{
  "name": "step_over",
  "arguments": {
    "session_id": "session-123"
  }
}
```

**Step 7: Resume execution after identifying issue**

```json
{
  "name": "resume_execution",
  "arguments": {
    "session_id": "session-123"
  }
}
```

### Appendix C: Protocol message examples

**Setting a breakpoint (CDP command):**

```json
{
  "id": 1,
  "method": "Debugger.setBreakpointByUrl",
  "params": {
    "lineNumber": 42,
    "url": "file:///app/src/index.js",
    "condition": "count > 10"
  }
}
```

**Setting a breakpoint (CDP response):**

```json
{
  "id": 1,
  "result": {
    "breakpointId": "1:42:0:file:///app/src/index.js",
    "locations": [
      {
        "scriptId": "15",
        "lineNumber": 42,
        "columnNumber": 0
      }
    ]
  }
}
```

**Paused event:**

```json
{
  "method": "Debugger.paused",
  "params": {
    "callFrames": [
      {
        "callFrameId": "{\"ordinal\":0,\"injectedScriptId\":1}",
        "functionName": "processData",
        "location": {
          "scriptId": "15",
          "lineNumber": 42,
          "columnNumber": 12
        },
        "scopeChain": [
          {
            "type": "local",
            "object": {
              "type": "object",
              "objectId": "{\"injectedScriptId\":1,\"id\":1}"
            }
          },
          {
            "type": "closure",
            "object": {
              "type": "object",
              "objectId": "{\"injectedScriptId\":1,\"id\":2}"
            }
          },
          {
            "type": "global",
            "object": {
              "type": "object",
              "objectId": "{\"injectedScriptId\":1,\"id\":3}"
            }
          }
        ],
        "this": {
          "type": "object",
          "className": "DataProcessor"
        }
      }
    ],
    "reason": "breakpoint",
    "hitBreakpoints": [
      "1:42:0:file:///app/src/index.js"
    ]
  }
}
```

### Appendix D: Supported runtimes

| Runtime | Debug flag                | Default port | Notes                 |
|---------|---------------------------|--------------|-----------------------|
| Node.js | `--inspect`               | 9229         | Full CDP support      |
| Node.js | `--inspect-brk`           | 9229         | Pauses at first line  |
| Chrome  | `--remote-debugging-port` | 9222         | Full CDP support      |
| Edge    | `--devtools-server-port`  | 9222         | Full CDP support      |
| Deno    | `--inspect`               | 9229         | CDP support           |
| Firefox | `--remote-debugging-port` | 9222         | Partial CDP (Nightly) |

## Document history

| Version | Date       | Author      | Changes                                                           |
|---------|------------|-------------|-------------------------------------------------------------------|
| 1.0     | 2025-11-23 | John Grimes | Initial design document (WebKit Inspector Protocol)               |
| 2.0     | 2025-11-24 | John Grimes | Migrated to Chrome DevTools Protocol with chrome-remote-interface |
| 2.1     | 2025-11-24 | John Grimes | Added source map support; removed future enhancements section     |

## References

- Chrome DevTools Protocol
  documentation: https://chromedevtools.github.io/devtools-protocol/
- chrome-remote-interface
  library: https://github.com/cyrus-and/chrome-remote-interface
- chrome-devtools-mcp (Google's official CDP MCP
  server): https://github.com/ChromeDevTools/chrome-devtools-mcp
- Model Context Protocol specification
- JSON-RPC 2.0 specification
- WebSocket Protocol (RFC 6455)
