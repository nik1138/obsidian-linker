import { Command } from "commander";
import chalk from "chalk";
import { analyzeCommand } from "./analyze.js";
import { insertCommand } from "./insert.js";
import { removeCommand } from "./remove.js";

/**
 * CLI setup with Commander.js
 */
export function createCli(): Command {
  const program = new Command();

  program
    .name("obsidian-linker")
    .description("Find and insert conceptual links in Obsidian vault using RAG")
    .version("2.0.0");

  // Analyze command
  program
    .command("analyze")
    .description("Full pipeline: scan vault, index, find connections")
    .option("-v, --vault <path>", "Path to Obsidian vault")
    .option("-o, --output <file>", "Output file for connections", "obsidian-links.json")
    .option("-t, --threshold <number>", "Similarity threshold (0-1)", "0.5")
    .option("-m, --max-links <number>", "Max connections per note", "10")
    .option("--incremental", "Only process changed files")
    .option("--clear-cache", "Clear cache before analysis")
    .option("--verbose", "Verbose output")
    .option("--api-key <key>", "StepFun API key")
    .option("--max-candidates <number>", "Max candidate notes per analysis", "5")
    .option("--top-k <number>", "Top-K similar chunks to retrieve", "10")
    .option("--max-chunks-per-candidate <number>", "Max chunks per candidate", "3")
    .action(async (options) => {
      try {
        await analyzeCommand(options);
      } catch (error) {
        console.error(chalk.red("Error:"), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Insert command
  program
    .command("insert")
    .description("Insert links from connections file into notes")
    .option("-i, --input <file>", "Input connections file", "obsidian-links.json")
    .option("--dry-run", "Preview without writing")
    .option("-l, --limit <number>", "Limit connections per note")
    .action(async (options) => {
      try {
        await insertCommand(options);
      } catch (error) {
        console.error(chalk.red("Error:"), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Remove command
  program
    .command("remove")
    .description("Remove previously inserted links")
    .option("-i, --input <file>", "Input connections file", "obsidian-links.json")
    .action(async (options) => {
      try {
        await removeCommand(options);
      } catch (error) {
        console.error(chalk.red("Error:"), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return program;
}
