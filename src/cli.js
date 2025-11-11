const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const cliProgress = require('cli-progress');

/**
 * CLI - Command Line Interface for Obsidian Linker
 */
class CLI {
  /**
   * Constructor
   * @param {Object} program - Commander program instance
   * @param {VaultReader} vaultReader - Vault reader instance
   * @param {LinkFinder} linkFinder - Link finder instance
   * @param {CacheManager} cacheManager - Cache manager instance
   * @param {LinkInserter} linkInserter - Link inserter instance
   * @param {Object} logger - Logger instance
   */
  constructor(program, vaultReader, linkFinder, cacheManager, linkInserter, logger) {
    this.program = program;
    this.vaultReader = vaultReader;
    this.linkFinder = linkFinder;
    this.cacheManager = cacheManager;
    this.linkInserter = linkInserter;
    this.logger = logger;
  }

  /**
   * Run the CLI
   */
  async run() {
    // Configure CLI options
    this.program
      .name('obsidian-linker')
      .description('Find conceptual links in Obsidian vault using NLP')
      .version('1.0.0');
    
    // Analysis command
    this.program
      .command('analyze')
      .description('Analyze Obsidian vault and find conceptual links')
      .requiredOption('-v, --vault <path>', 'path to Obsidian vault')
      .option('-o, --output <file>', 'output file for links (JSON format)', 'links.json')
      .option('-t, --threshold <number>', 'similarity threshold (0-1)', '0.5')
      .option('-m, --max-links <number>', 'maximum links per note', '10')
      .option('--adjust-low-links', 'adjust similarity for notes with few links')
      .option('--iterative-adjustment', 'iteratively adjust threshold for notes with few links until minimum 3 links are found')
      .option('--incremental', 'incremental analysis (only changed files)')
      .option('--clear-cache', 'clear cache before analysis')
      .option('--verbose', 'enable verbose logging')
      .option('--dry-run', 'perform dry run without saving results')
      .action(async (options) => {
        await this.handleAnalyzeCommand(options);
      });
    
    // Insert command
    this.program
      .command('insert')
      .description('Insert found links into Obsidian notes')
      .requiredOption('-i, --input <file>', 'input file with analysis results (JSON format)')
      .option('--remove', 'remove previously inserted links instead of adding them')
      .option('-t, --title <title>', 'custom title for the links section', 'Связанные заметки')
      .option('-g, --group-by <criteria>', 'group links by criteria (file, similarity)', 'file')
      .option('-l, --limit <number>', 'limit number of links per file', parseInt)
      .option('--verbose', 'enable verbose logging')
      .action(async (options) => {
        await this.handleInsertCommand(options);
      });

    // Parse command line arguments
    this.program.parse();
  }

  /**
   * Handle analyze command
   * @param {Object} options - CLI options
   */
  async handleAnalyzeCommand(options) {
    try {
      // Set log level
      if (options.verbose) {
        this.logger.level = 'debug';
      }

      this.logger.info('Starting Obsidian Linker analysis');
      
      // Initialize cache manager
      await this.cacheManager.initialize();
      
      // Clear cache if requested
      if (options.clearCache) {
        this.logger.info('Clearing cache...');
        await this.cacheManager.clearCache();
      }
      
      // Validate vault path
      const vaultPath = path.resolve(options.vault);
      this.logger.info(`Using vault path: ${vaultPath}`);
      
      // Get markdown files
      const files = await this.vaultReader.getMarkdownFiles(vaultPath);
      
      if (files.length === 0) {
        this.logger.warn('No markdown files found in vault');
        return;
      }
      
      this.logger.info(`Processing ${files.length} files`);
      
      // Create progress bar
      const progressBar = new cliProgress.SingleBar({
        format: chalk.cyan('Processing files') + ' [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} files',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
      });
      
      // Read and process files
      const notes = [];
      const fileMetadataList = [];
      
      progressBar.start(files.length, 0);
      
      for (const [index, filePath] of files.entries()) {
        try {
          // Update progress bar
          progressBar.update(index);
          
          // Get file metadata for caching
          const fileMetadata = await this.vaultReader.getFileMetadata(filePath);
          fileMetadataList.push(fileMetadata);
          
          // Check if cache is valid for incremental analysis
          if (options.incremental) {
            const stats = await fs.stat(filePath);
            if (this.cacheManager.isCacheValid(filePath, stats)) {
              this.logger.debug(`Skipping cached file: ${filePath}`);
              continue;
            }
          }
          
          // Read file
          const note = await this.vaultReader.readFile(filePath);
          notes.push(note);
        } catch (error) {
          this.logger.error(`Error processing file ${filePath}:`, error);
        }
      }
      
      // Stop progress bar
      progressBar.stop();
      
      if (notes.length === 0) {
        this.logger.warn('No files to process');
        return;
      }
      
      this.logger.info(`Analyzing ${notes.length} notes`);
      
      // Configure link finder
      const threshold = parseFloat(options.threshold);
      const maxLinks = parseInt(options.maxLinks);
      
      this.linkFinder.setSimilarityThreshold(threshold);
      this.linkFinder.setMaxLinksPerNote(maxLinks);
      
      // Create progress bar for analysis
      const analysisProgressBar = new cliProgress.SingleBar({
        format: chalk.yellow('Analyzing notes') + ' [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} notes',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
      });
      
      analysisProgressBar.start(notes.length, 0);
      
      // Find conceptual links with progress tracking
      const links = await this.linkFinder.findLinks(notes, {
        threshold: threshold,
        maxLinksPerNote: maxLinks,
        adjustLowLinks: options.adjustLowLinks,
        iterativeAdjustment: options.iterativeAdjustment,
        onProgress: (current, total) => {
          analysisProgressBar.update(current);
        }
      });
      
      // Stop progress bar
      analysisProgressBar.stop();
      
      this.logger.info(chalk.green(`Found ${links.length} conceptual links`));
      
      // Group links by source note
      const groupedLinks = this.linkFinder.groupLinksBySource(links);
      
      // Prepare results
      const results = {
        metadata: {
          timestamp: new Date().toISOString(),
          vaultPath: vaultPath,
          totalFiles: files.length,
          processedNotes: notes.length,
          totalLinks: links.length,
          similarityThreshold: threshold,
          maxLinksPerNote: maxLinks,
          cacheStats: this.cacheManager.getCacheStats()
        },
        links: links,
        groupedLinks: groupedLinks
      };
      
      // Output results
      if (!options.dryRun) {
        const outputPath = path.resolve(options.output);
        await fs.writeJson(outputPath, results, { spaces: 2 });
        this.logger.info(`Results saved to: ${outputPath}`);
      }
      
      // Log summary
      this.logSummary(results);
      
      this.logger.info('Obsidian Linker analysis completed successfully');
    } catch (error) {
      this.logger.error(chalk.red('Error running Obsidian Linker analysis:'), error);
      process.exit(1);
    }
  }

  /**
   * Handle insert command
   * @param {Object} options - CLI options
   */
  async handleInsertCommand(options) {
    try {
      // Set log level
      if (options.verbose) {
        this.logger.level = 'debug';
      }

      this.logger.info('Starting link insertion process');
      
      // Validate input file path
      const inputPath = path.resolve(options.input);
      this.logger.info(`Using input file: ${inputPath}`);
      
      // Check if input file exists
      if (!await fs.pathExists(inputPath)) {
        this.logger.error(`Input file not found: ${inputPath}`);
        process.exit(1);
      }
      
      // Prepare insertion options
      const insertOptions = {
        sectionTitle: options.title || 'Связанные заметки',
        groupBy: options.groupBy || 'file',
        limit: options.limit ? parseInt(options.limit) : undefined
      };
      
      if (options.remove) {
        // Remove previously inserted links
        await this.linkInserter.removeInsertedLinks(inputPath);
        this.logger.info('Link removal completed successfully');
      } else {
        // Insert links into files
        await this.linkInserter.insertLinks(inputPath, insertOptions);
        this.logger.info('Link insertion completed successfully');
      }
    } catch (error) {
      this.logger.error(chalk.red('Error running link insertion:'), error);
      process.exit(1);
    }
  }

  /**
   * Log summary of results
   * @param {Object} results - Analysis results
   */
  logSummary(results) {
    console.log('\n' + chalk.bold.blue('=== Obsidian Linker Results ==='));
    console.log(chalk.cyan('Vault Path: ') + results.metadata.vaultPath);
    console.log(chalk.cyan('Total Files: ') + chalk.yellow(results.metadata.totalFiles));
    console.log(chalk.cyan('Processed Notes: ') + chalk.yellow(results.metadata.processedNotes));
    console.log(chalk.cyan('Total Links Found: ') + chalk.green(results.metadata.totalLinks));
    console.log(chalk.cyan('Similarity Threshold: ') + chalk.yellow(results.metadata.similarityThreshold));
    console.log(chalk.cyan('Max Links Per Note: ') + chalk.yellow(results.metadata.maxLinksPerNote));
    console.log(chalk.cyan('Analysis Timestamp: ') + results.metadata.timestamp);
    
    // Show cache stats
    const cacheStats = this.cacheManager.getCacheStats();
    console.log(chalk.bold('\nCache Stats:'));
    console.log(chalk.cyan('  Memory Cache Size: ') + chalk.yellow(cacheStats.memoryCacheSize));
    console.log(chalk.cyan('  Disk Cache Size: ') + chalk.yellow(cacheStats.diskCacheSize));
    
    // Show top connected notes
    console.log(chalk.bold('\nTop Connected Notes:'));
    const sortedNotes = Object.entries(results.groupedLinks)
      .map(([note, links]) => ({ note, linkCount: links.length }))
      .sort((a, b) => b.linkCount - a.linkCount)
      .slice(0, 10);
    
    for (const { note, linkCount } of sortedNotes) {
      console.log(chalk.cyan('  ' + note + ': ') + chalk.green(linkCount + ' links'));
    }
    
    console.log(chalk.bold.blue('===============================\n'));
  }
}

module.exports = CLI;