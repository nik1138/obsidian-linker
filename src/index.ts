#!/usr/bin/env node

/**
 * Obsidian Linker - CLI entry point.
 *
 * Finds and inserts conceptual wiki-links between Obsidian notes using RAG.
 */

import { createCli } from "./cli/index.js";

const cli = createCli();
cli.parse(process.argv);