import chalk from "chalk";
import cliProgress from "cli-progress";
import fsExtra from "fs-extra";
import path from "path";
import { ConfigLoader, cliOverridesToPartial } from "../config.js";
import { VaultReader } from "../vault/reader.js";
import { BackendImpl } from "../backend/index.js";
import { LinkFinder } from "../links/finder.js";
import type { TypedConnection as LogicalConnection } from "../backend/types.js";

interface AnalyzeOptions {
  vault?: string;
  output?: string;
  threshold?: string;
  maxLinks?: string;
  incremental?: boolean;
  clearCache?: boolean;
  verbose?: boolean;
}

/**
 * Analyze command - full pipeline
 */
export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  const configLoader = new ConfigLoader();
  const overrides = cliOverridesToPartial(options);
  const config = await configLoader.load(overrides);

  if (config.verbose) {
    console.log(chalk.blue("Configuration:"), config);
  }

  // Initialize backend
  console.log(chalk.blue("Initializing backend..."));
  const backend = new BackendImpl();
  await backend.initialize({
    vaultPath: config.vaultPath,
    apiKey: config.apiKey,
    modelCacheDir: config.modelCacheDir,
  });

  try {
    // Scan vault
    console.log(chalk.blue("Scanning vault..."));
    const reader = new VaultReader();
    const filePaths = await reader.scanVault(config.vaultPath);
    console.log(chalk.green(`Found ${filePaths.length} markdown files`));

    // Read all notes
    console.log(chalk.blue("Reading notes..."));
    const notes = await reader.readAllNotes(filePaths);

    // Index notes
    console.log(chalk.blue("Indexing notes..."));
    if (config.incremental) {
      const diff = await backend.incrementalUpdate(notes, (progress) => {
        console.log(`  ${progress.phase}: ${progress.processed}/${progress.total}`);
      });
      console.log(chalk.green(`Incremental update complete:`));
      console.log(`  New: ${diff.newNotes.length}, Modified: ${diff.modifiedNotes.length}, Deleted: ${diff.deletedNotes.length}, Unchanged: ${diff.unchangedCount}`);
    } else {
      await backend.fullIndex(notes, (progress) => {
        console.log(`  ${progress.phase}: ${progress.processed}/${progress.total}`);
      });
      console.log(chalk.green("Full index complete"));
    }

    // Find connections
    console.log(chalk.blue("Finding connections..."));
    const finder = new LinkFinder();
    const allConnections = new Map<string, LogicalConnection[]>();

    const progressBar = new cliProgress.SingleBar(
      { format: "  Processing notes |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s" },
      cliProgress.Presets.shades_classic
    );

    progressBar.start(notes.length, 0);

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      try {
        const connections = await finder.findLinksForNote(note, notes, backend);
        allConnections.set(note.path, connections);
      } catch (error: any) {
        console.error(chalk.yellow(`Warning: failed to analyze ${note.path}:`), error.message);
        allConnections.set(note.path, []);
      }

      progressBar.update(i + 1);
    }

    progressBar.stop();

    // Save results
    const outputData = {
      generatedAt: new Date().toISOString(),
      vaultPath: config.vaultPath,
      totalNotes: notes.length,
      connections: Array.from(allConnections.entries()).map(([sourcePath, connections]) => ({
        sourcePath,
        sourceName: path.basename(sourcePath, ".md"),
        connections,
      })),
    };

    const outputPath = path.resolve(process.cwd(), config.outputFile);
    await fsExtra.writeJson(outputPath, outputData, { spaces: 2 });
    console.log(chalk.green(`Results saved to ${outputPath}`));

    // Summary
    const totalConnections = Array.from(allConnections.values()).reduce((sum, conns) => sum + conns.length, 0);
    const notesWithLinks = Array.from(allConnections.values()).filter((c) => c.length > 0).length;
    console.log(chalk.blue("Summary:"));
    console.log(`  Total notes: ${notes.length}`);
    console.log(`  Notes with links: ${notesWithLinks}`);
    console.log(`  Total connections: ${totalConnections}`);
    console.log(`  Average per note: ${(totalConnections / notes.length).toFixed(2)}`);
  } finally {
    await backend.shutdown();
  }
}
