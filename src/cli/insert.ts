import chalk from "chalk";
import fsExtra from "fs-extra";
import path from "path";
import { LinkInserter } from "../links/inserter.js";
import type { LogicalConnection } from "../backend/types.js";

interface InsertOptions {
  input?: string;
  dryRun?: boolean;
  limit?: number | string;
}

export async function insertCommand(options: InsertOptions): Promise<void> {
  const inputFile = options.input || "obsidian-links.json";
  const inputPath = path.resolve(process.cwd(), inputFile);

  if (!(await fsExtra.pathExists(inputPath))) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  console.log(chalk.blue(`Loading connections from ${inputPath}...`));
  const data = await fsExtra.readJson(inputPath);

  const connectionsBySource = new Map<string, LogicalConnection[]>();
  for (const entry of data.connections || []) {
    const sourcePath = entry.sourcePath;
    if (!sourcePath) continue;
    const existing = connectionsBySource.get(sourcePath) || [];
    existing.push(...(entry.connections || []));
    connectionsBySource.set(sourcePath, existing);
  }

  console.log(chalk.green(`Loaded connections for ${connectionsBySource.size} notes`));

  if (options.limit) {
    const limit = typeof options.limit === "string" ? parseInt(options.limit, 10) : options.limit;
    console.log(chalk.blue(`Limiting to ${limit} connections per note`));
    for (const [source, conns] of connectionsBySource) {
      const sorted = conns.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
      connectionsBySource.set(source, sorted);
    }
  }

  console.log(chalk.blue("Inserting links..."));
  const inserter = new LinkInserter();
  const result = await inserter.insertLinks(connectionsBySource, {
    dryRun: options.dryRun,
    limitPerNote: options.limit ? undefined : 10,
  });

  for (const item of result.results) {
    if (item.success && item.insertedCount > 0) {
      console.log(chalk.green(`  ${item.notePath}: inserted ${item.insertedCount}`));
    }
    for (const error of item.errors) {
      console.error(chalk.yellow(`    Warning: ${error}`));
    }
  }

  console.log(chalk.blue("Summary:"));
  console.log(`  Files processed: ${result.results.length}`);
  console.log(chalk.green(`  Links inserted: ${result.totalInserted}`));
  console.log(chalk.yellow(`  Skipped: ${result.totalSkipped}`));

  if (options.dryRun) {
    console.log(chalk.yellow("DRY RUN - no files were modified"));
  }
}
