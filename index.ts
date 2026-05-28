#!/usr/bin/env node

/**
 * Obsidian Linker v2 - Main Entry Point
 *
 * Finds and inserts conceptual wiki-links between Obsidian notes using RAG.
 */

import { createCli } from "./cli/index.js";

/**
 * Main entry point
 */
function main(): void {
  const cli = createCli();
  cli.parse(process.argv);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// Export for programmatic use
export { createCli } from "./cli/index.js";
