#!/usr/bin/env node
/**
 * Entry point for the WebKit Debug MCP Server.
 *
 * @author John Grimes
 */

import { WebKitDebugMCPServer } from "./server.js";
import { type ServerConfig, DEFAULT_CONFIG } from "./types.js";
import { logger } from "./logger.js";

/**
 * Parse configuration from environment variables.
 */
function parseConfig(): Partial<ServerConfig> {
  const config: Partial<ServerConfig> = {};

  // Connection settings.
  if (process.env.WEBKIT_DEBUG_CONNECTION_TIMEOUT) {
    config.connectionTimeout = parseInt(process.env.WEBKIT_DEBUG_CONNECTION_TIMEOUT, 10);
  }
  if (process.env.WEBKIT_DEBUG_COMMAND_TIMEOUT) {
    config.commandTimeout = parseInt(process.env.WEBKIT_DEBUG_COMMAND_TIMEOUT, 10);
  }
  if (process.env.WEBKIT_DEBUG_RECONNECT_ATTEMPTS) {
    config.reconnectAttempts = parseInt(process.env.WEBKIT_DEBUG_RECONNECT_ATTEMPTS, 10);
  }
  if (process.env.WEBKIT_DEBUG_RECONNECT_DELAY) {
    config.reconnectDelay = parseInt(process.env.WEBKIT_DEBUG_RECONNECT_DELAY, 10);
  }

  // Security settings.
  if (process.env.WEBKIT_DEBUG_ALLOWED_HOSTS) {
    config.allowedHosts = process.env.WEBKIT_DEBUG_ALLOWED_HOSTS.split(",").map((h) => h.trim());
  }
  if (process.env.WEBKIT_DEBUG_REQUIRE_CONFIRMATION === "false") {
    config.requireConfirmationForRemote = false;
  }

  // Session settings.
  if (process.env.WEBKIT_DEBUG_MAX_SESSIONS) {
    config.maxConcurrentSessions = parseInt(process.env.WEBKIT_DEBUG_MAX_SESSIONS, 10);
  }
  if (process.env.WEBKIT_DEBUG_SESSION_TIMEOUT) {
    config.sessionIdleTimeout = parseInt(process.env.WEBKIT_DEBUG_SESSION_TIMEOUT, 10);
  }

  // Logging settings.
  if (process.env.WEBKIT_DEBUG_LOG_LEVEL) {
    const level = process.env.WEBKIT_DEBUG_LOG_LEVEL.toLowerCase();
    if (level === "debug" || level === "info" || level === "warn" || level === "error") {
      config.logLevel = level;
    }
  }
  if (process.env.WEBKIT_DEBUG_LOG_PROTOCOL === "true") {
    config.logProtocolMessages = true;
  }

  return config;
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  try {
    const config = parseConfig();
    logger.info("Starting WebKit Debug MCP Server", {
      config: { ...DEFAULT_CONFIG, ...config },
    });

    const server = new WebKitDebugMCPServer(config);
    await server.run();
  } catch (error) {
    logger.error("Fatal error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

main();
