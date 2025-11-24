# MCP JS Debugger

An MCP (Model Context Protocol) server that exposes
[Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
debugging capabilities, enabling AI assistants to debug JavaScript and
TypeScript applications.

## Features

- Connect to any CDP-compatible debugger (Node.js, Chrome, Edge)
- Set, list, and remove breakpoints
- Step through code (over, into, out)
- Inspect call stacks with source map support
- Evaluate expressions in any stack frame
- View and modify variables
- Pause on exceptions
- Full source map support for debugging transpiled code

## Installation

```bash
npm install
npm run build
```

### Claude Code integration

Add to your Claude Code configuration:

```bash
claude mcp add mcp-js-debugger -- npx mcp-js-debugger
```

Or add to `.mcp.json`:

```json
{
  "mcpServers": {
    "mcp-js-debugger": {
      "command": "npx",
      "args": ["mcp-js-debugger"]
    }
  }
}
```

## Usage

### Starting a debug target

Start your Node.js application with the inspector:

```bash
# Pause on first line (recommended for setting initial breakpoints)
node --inspect-brk=9229 your-script.js

# Or start without pausing
node --inspect=9229 your-script.js
```

### Available tools

| Tool                      | Description                                      |
|---------------------------|--------------------------------------------------|
| `connect_debugger`        | Connect to a CDP endpoint via WebSocket URL      |
| `disconnect_debugger`     | Disconnect from a debugging session              |
| `set_breakpoint`          | Set a breakpoint by URL and line number          |
| `remove_breakpoint`       | Remove a breakpoint by ID                        |
| `list_breakpoints`        | List all breakpoints in a session                |
| `resume_execution`        | Resume execution after pause                     |
| `step_over`               | Step over the current statement                  |
| `step_into`               | Step into a function call                        |
| `step_out`                | Step out of the current function                 |
| `pause_execution`         | Pause running execution                          |
| `get_call_stack`          | Get the current call stack with source locations |
| `evaluate_expression`     | Evaluate a JavaScript expression                 |
| `get_scope_variables`     | Get variables in a scope                         |
| `set_variable_value`      | Modify a variable's value                        |
| `set_pause_on_exceptions` | Configure exception handling                     |
| `get_original_location`   | Map generated to original source location        |
| `get_script_source`       | Get script source code                           |
| `list_scripts`            | List loaded scripts                              |

### Example workflow

1. Start your application with `--inspect-brk`:
   ```bash
   node --inspect-brk=9229 app.js
   ```

2. Get the WebSocket URL:
   ```bash
   curl http://localhost:9229/json
   ```

3. Connect the debugger:
   ```
   connect_debugger(websocket_url: "ws://localhost:9229/<id>")
   ```

4. Set breakpoints:
   ```
   set_breakpoint(session_id: "...", url: "file:///path/to/app.js", line_number: 10)
   ```

5. Resume execution to hit the breakpoint:
   ```
   resume_execution(session_id: "...")
   ```

6. Inspect state when paused:
   ```
   get_call_stack(session_id: "...")
   get_scope_variables(session_id: "...", call_frame_id: "...", scope_index: 0)
   evaluate_expression(session_id: "...", expression: "myVariable")
   ```

7. Continue debugging:
   ```
   step_over(session_id: "...")
   resume_execution(session_id: "...")
   ```

## Source map support

The server automatically loads source maps for transpiled code (TypeScript,
bundled JavaScript, etc.). When source maps are available:

- Call stacks show original source locations
- Breakpoints can be set on original source files
- `get_original_location` maps generated positions to original source
- `get_script_source` can return original source content

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Watch mode for development
npm run dev
```

## Architecture

- **cdp-client.ts** - Low-level Chrome DevTools Protocol client wrapper
- **session-manager.ts** - Manages multiple debugging sessions
- **source-map-manager.ts** - Handles source map loading and position mapping
- **server.ts** - MCP server implementation with tool handlers
- **types.ts** - TypeScript type definitions

## Requirements

- Node.js 18.0.0 or later
- A CDP-compatible debug target (Node.js, Chrome, Edge, etc.)

## Licence

Apache-2.0
