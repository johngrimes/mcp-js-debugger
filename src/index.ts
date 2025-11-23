#!/usr/bin/env node
/**
 * Entry point for the CDP Debug MCP Server.
 *
 * @author John Grimes
 */

import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createServer} from './server.js';

/**
 * Main function to start the MCP server.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Handle graceful shutdown.
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
