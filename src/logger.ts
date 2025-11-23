/**
 * Structured logger for the WebKit Debug MCP Server.
 *
 * @author John Grimes
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  sessionId?: string;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Logger class providing structured logging output.
 */
export class Logger {
  private level: LogLevel;
  private readonly component: string;
  private sessionId?: string;

  constructor(component: string, level: LogLevel = "info") {
    this.component = component;
    this.level = level;
  }

  /**
   * Set the logging level.
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Set the session ID for contextual logging.
   */
  setSessionId(sessionId?: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Create a child logger with the given component name.
   */
  child(component: string): Logger {
    const child = new Logger(`${this.component}:${component}`, this.level);
    child.setSessionId(this.sessionId);
    return child;
  }

  /**
   * Log a debug message.
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  /**
   * Log an info message.
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  /**
   * Log a warning message.
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  /**
   * Log an error message.
   */
  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  /**
   * Internal logging method.
   */
  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
    };

    if (this.sessionId) {
      entry.sessionId = this.sessionId;
    }

    if (data) {
      entry.data = data;
    }

    // Output to stderr to avoid interfering with MCP stdio transport.
    const output = JSON.stringify(entry);
    process.stderr.write(output + "\n");
  }
}

/**
 * Root logger instance for the server.
 */
export const logger = new Logger("webkit-debug-mcp");
