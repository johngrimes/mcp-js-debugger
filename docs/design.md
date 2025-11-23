# WebKit Inspector Protocol MCP Server Design Document

## Executive summary

This document outlines the design for a Model Context Protocol (MCP) server that exposes debugging capabilities from the WebKit Inspector Protocol. The server will enable MCP clients to control debugging sessions, manage breakpoints, inspect execution state, and interact with JavaScript code running in WebKit-based browsers and runtimes.

## Background

The WebKit Inspector Protocol provides a JSON-RPC 2.0 based communication system for debugging JavaScript code. It operates over WebSocket connections and organizes functionality into domains, with the Debugger domain providing core debugging capabilities such as breakpoint management, execution control, and call stack inspection.

The Model Context Protocol provides a standardized way for AI assistants and development tools to interact with external systems through defined tools and resources. By creating an MCP server that exposes WebKit debugging functionality, we enable AI-assisted debugging workflows and programmatic control of debugging sessions.

## Goals and non-goals

### Goals

- Provide MCP tools for core debugging operations: breakpoint management, execution control, and state inspection
- Support both local and remote debugging sessions
- Enable multiple concurrent debugging sessions across different targets
- Maintain protocol compatibility with WebKit-based browsers and runtimes
- Provide clear error handling and status reporting
- Support asynchronous debugging workflows through event notifications

### Non-goals

- Reimplementing the full WebKit Inspector Protocol (only exposing the Debugger domain initially)
- Providing a graphical debugging interface
- Supporting non-WebKit debugging protocols
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
│   WebKit Debug MCP Server   │
│  ┌─────────────────────┐   │
│  │   Session Manager   │   │
│  └──────────┬──────────┘   │
│             │               │
│  ┌──────────┴──────────┐   │
│  │  WebSocket Clients  │   │
│  └──────────┬──────────┘   │
└─────────────┼──────────────┘
              │ WebSocket
              │ (WebKit Inspector Protocol)
              ▼
┌─────────────────────────────┐
│  WebKit Runtime/Browser     │
│  ┌─────────────────────┐   │
│  │  Inspector Backend  │   │
│  └─────────────────────┘   │
└─────────────────────────────┘
```

### Component architecture

#### Session manager

Manages multiple debugging sessions and routes commands to the appropriate WebSocket client.

**Responsibilities:**
- Creating and destroying debugging sessions
- Maintaining session state and metadata
- Routing MCP tool calls to the correct session
- Broadcasting events from WebSocket clients to MCP clients
- Handling session lifecycle and cleanup

**Key data structures:**
```typescript
interface DebugSession {
  id: string;
  targetUrl: string;
  wsClient: WebSocketClient;
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

#### WebSocket client

Handles communication with the WebKit Inspector Protocol backend.

**Responsibilities:**
- Establishing and maintaining WebSocket connections
- Sending JSON-RPC commands to the backend
- Receiving and parsing protocol responses and events
- Managing command identifiers and response correlation
- Handling connection errors and reconnection

**Protocol interface:**
```typescript
interface ProtocolMessage {
  id?: number;
  method?: string;
  params?: object;
  result?: object;
  error?: {
    code: number;
    message: string;
  };
}
```

#### MCP tool handlers

Implement MCP tools that map to WebKit Inspector Protocol commands.

**Responsibilities:**
- Validating tool parameters
- Translating MCP tool calls to protocol commands
- Formatting protocol responses for MCP clients
- Handling errors and providing meaningful feedback

## MCP interface design

### Resources

The server will expose resources providing information about active debugging sessions and their state.

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
      "targetUrl": "ws://localhost:9222/devtools/page/1",
      "state": "paused",
      "pauseReason": "breakpoint",
      "scriptUrl": "https://example.com/app.js",
      "lineNumber": 42
    }
  ]
}
```

#### Session details resource

**URI:** `debug://sessions/{sessionId}`

**MIME type:** `application/json`

**Description:** Detailed information about a specific debugging session, including breakpoints and current execution state.

**Example content:**
```json
{
  "id": "session-123",
  "targetUrl": "ws://localhost:9222/devtools/page/1",
  "state": "paused",
  "breakpoints": [
    {
      "id": "bp-1",
      "scriptUrl": "https://example.com/app.js",
      "lineNumber": 42,
      "condition": "x > 10",
      "enabled": true
    }
  ],
  "callStack": [
    {
      "functionName": "processData",
      "scriptUrl": "https://example.com/app.js",
      "lineNumber": 42,
      "columnNumber": 12
    }
  ]
}
```

### Tools

#### connect_debugger

Establishes a new debugging session by connecting to a WebKit Inspector Protocol endpoint.

**Parameters:**
```json
{
  "websocket_url": {
    "type": "string",
    "description": "WebSocket URL for the WebKit Inspector endpoint (e.g., ws://localhost:9222/devtools/page/1)",
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
    "title": "Example Page",
    "url": "https://example.com"
  }
}
```

**Example usage:**
```json
{
  "name": "connect_debugger",
  "arguments": {
    "websocket_url": "ws://localhost:9222/devtools/page/1",
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
  },
  "ignore_count": {
    "type": "integer",
    "description": "Number of times to ignore this breakpoint before stopping",
    "required": false,
    "default": 0
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
    "url": "https://example.com/app.js",
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
      "url": "https://example.com/app.js",
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
      "url": "https://example.com/app.js",
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
    "call_frames": [...]
  }
}
```

#### evaluate_expression

Evaluates a JavaScript expression in the context of a specific call frame or the global context.

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
    "enum": ["none", "uncaught", "all"],
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

### Prompts

The server will provide prompt templates to guide common debugging workflows.

#### analyze_crash

Guides analysis of a crashed or paused application by examining the call stack and local variables.

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
- `ws`: WebSocket client library
- `zod`: Schema validation for parameters
- `uuid`: Unique identifier generation

### WebSocket connection management

The server will implement a robust WebSocket client with the following features:

**Connection lifecycle:**
1. Initial connection with timeout
2. Protocol handshake (sending `Debugger.enable` command)
3. Active state monitoring with heartbeat
4. Graceful disconnection
5. Error handling and reconnection with exponential backoff

**Command correlation:**
```typescript
class WebSocketClient {
  private commandId = 1;
  private pendingCommands = new Map<number, PendingCommand>();
  
  async sendCommand(method: string, params?: object): Promise<any> {
    const id = this.commandId++;
    const message = { id, method, params };
    
    return new Promise((resolve, reject) => {
      this.pendingCommands.set(id, { resolve, reject, timeout: setTimeout(...) });
      this.ws.send(JSON.stringify(message));
    });
  }
  
  private handleMessage(data: string) {
    const message = JSON.parse(data);
    
    if (message.id !== undefined) {
      // Response to a command
      const pending = this.pendingCommands.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingCommands.delete(message.id);
        
        if (message.error) {
          pending.reject(new ProtocolError(message.error));
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.method) {
      // Event notification
      this.handleEvent(message.method, message.params);
    }
  }
}
```

### Event handling

The server will listen for key WebKit Inspector Protocol events and translate them into notifications or state updates:

**Critical events:**
- `Debugger.paused`: Execution paused (update session state, cache call frames)
- `Debugger.resumed`: Execution resumed (clear paused state)
- `Debugger.scriptParsed`: New script loaded (track available scripts)
- `Debugger.breakpointResolved`: Breakpoint location resolved (update breakpoint info)

**Event processing:**
```typescript
private handleEvent(method: string, params: any) {
  switch (method) {
    case 'Debugger.paused':
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
        reason: params.reason
      });
      break;
      
    case 'Debugger.resumed':
      this.session.state = SessionState.RUNNING;
      this.session.pausedState = undefined;
      this.notifyMCPClient({
        type: 'execution_resumed',
        sessionId: this.session.id
      });
      break;
      
    // Additional event handlers...
  }
}
```

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
- `CONNECTION_FAILED`: Failed to establish WebSocket connection
- `PROTOCOL_ERROR`: WebKit Inspector Protocol returned an error
- `INVALID_PARAMETERS`: Tool parameters are invalid
- `TIMEOUT`: Operation timed out

### State synchronization

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

The server will validate WebSocket URLs to prevent connection to malicious endpoints:

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
- WebSocket client: Message handling, command correlation, event processing
- Tool handlers: Parameter validation, protocol command generation
- State management: Cache updates, invalidation

**Testing approach:**
- Mock WebSocket connections for predictable behavior
- Test error conditions and edge cases
- Validate protocol message formatting

### Integration tests

**Test scenarios:**
1. Connect to a real WebKit debugging target
2. Set breakpoints and verify they trigger
3. Step through code execution
4. Evaluate expressions in different scopes
5. Handle disconnections and reconnections

**Test environment:**
- Use Bun with `--inspect` flag as a debugging target
- Automated script to trigger breakpoints
- Verify server state matches protocol events

### End-to-end tests

**Workflow tests:**
1. Full debugging session: Connect, set breakpoints, pause, inspect, resume, disconnect
2. Multiple concurrent sessions
3. Error handling: Invalid commands, connection failures
4. Resource queries during active debugging

## Deployment considerations

### Configuration

The server will support configuration through environment variables and a config file:

**Configuration options:**
```typescript
interface ServerConfig {
  // MCP transport
  transport: 'stdio' | 'http';
  httpPort?: number;
  
  // WebSocket settings
  connectionTimeout: number;
  commandTimeout: number;
  reconnectAttempts: number;
  reconnectDelay: number;
  
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

**Optimization strategies:**
1. Cache frequently accessed data (call stacks, breakpoints)
2. Batch protocol commands when possible
3. Limit call stack depth in responses to reduce payload size
4. Implement request throttling to prevent overload
5. Use connection pooling for multiple targets on same host

**Resource limits:**
- Maximum concurrent sessions: 10
- Maximum breakpoints per session: 100
- Maximum expression evaluation length: 10,000 characters
- WebSocket message size limit: 10 MB

## Future enhancements

### Phase 2 features

**Advanced breakpoint types:**
- Conditional breakpoints with hit count
- Logpoint-style breakpoints that output without pausing
- Data breakpoints (watch expressions)

**Source mapping:**
- Support for source maps in bundled/transpiled code
- Map breakpoints from original source to generated code
- Display original source in call stacks

**Performance profiling:**
- Expose Timeline/Profiler domain for performance analysis
- CPU and memory profiling tools
- Timeline recording and playback

### Phase 3 features

**Multi-target debugging:**
- Debug multiple pages/workers simultaneously
- Coordinate breakpoints across targets
- Unified view of distributed execution

**Advanced inspection:**
- DOM inspection tools
- Network request monitoring
- Console message capture

**Debugging workflows:**
- Saved debugging configurations
- Automated debugging scripts
- Integration with test frameworks

## Success metrics

**Functional metrics:**
- Successfully connect to WebKit debugging targets
- Set and trigger breakpoints with 100% reliability
- Execute stepping operations within 100ms
- Evaluate expressions and return results within 200ms

**Reliability metrics:**
- Handle connection failures with automatic reconnection
- Recover from protocol errors without session loss
- Support 10+ concurrent debugging sessions

**Usability metrics:**
- Clear error messages for all failure modes
- Complete documentation with examples
- MCP clients can implement common debugging workflows

## Appendices

### Appendix A: WebKit Inspector Protocol reference

Key protocol domains and commands used by this implementation:

**Debugger domain:**
- `Debugger.enable`: Enable debugging
- `Debugger.disable`: Disable debugging
- `Debugger.setBreakpointByUrl`: Set breakpoint
- `Debugger.removeBreakpoint`: Remove breakpoint
- `Debugger.pause`: Pause execution
- `Debugger.resume`: Resume execution
- `Debugger.stepOver`: Step over
- `Debugger.stepInto`: Step into
- `Debugger.stepOut`: Step out
- `Debugger.evaluateOnCallFrame`: Evaluate expression
- `Debugger.setPauseOnExceptions`: Configure exception pausing

**Events:**
- `Debugger.paused`: Execution paused
- `Debugger.resumed`: Execution resumed
- `Debugger.scriptParsed`: Script loaded
- `Debugger.breakpointResolved`: Breakpoint location resolved

### Appendix B: Example debugging workflow

**Scenario:** Debug a function that processes user data

**Step 1: Connect to debugging target**
```json
{
  "name": "connect_debugger",
  "arguments": {
    "websocket_url": "ws://localhost:9222/devtools/page/1"
  }
}
```

**Step 2: Set breakpoint in target function**
```json
{
  "name": "set_breakpoint",
  "arguments": {
    "session_id": "session-123",
    "url": "https://example.com/processor.js",
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

**Setting a breakpoint (request):**
```json
{
  "id": 1,
  "method": "Debugger.setBreakpointByUrl",
  "params": {
    "lineNumber": 42,
    "url": "https://example.com/app.js",
    "condition": "count > 10"
  }
}
```

**Setting a breakpoint (response):**
```json
{
  "id": 1,
  "result": {
    "breakpointId": "1:42:0:https://example.com/app.js",
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
          }
        ],
        "this": {
          "type": "object",
          "className": "DataProcessor"
        }
      }
    ],
    "reason": "breakpoint",
    "data": {
      "breakpointId": "1:42:0:https://example.com/app.js"
    }
  }
}
```

## Document history

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-23 | Design Team | Initial design document |

## References

- WebKit Inspector Protocol documentation
- Model Context Protocol specification
- JSON-RPC 2.0 specification
- WebSocket Protocol (RFC 6455)
