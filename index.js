#!/usr/bin/env node

/**
 * Obsidian Linker - Main Entry Point
 *
 * This application analyzes Obsidian vault files to find conceptual links
 * using NLP techniques.
 */

const path = require('path');
const fs = require('fs-extra');
const { program } = require('commander');
const winston = require('winston');

// Import our modules
const VaultReader = require('./src/vault-reader');
const NLPProcessor = require('./src/nlp-processor');
const LinkFinder = require('./src/link-finder');
const CacheManager = require('./src/cache-manager');
const LinkInserter = require('./src/link-inserter');
const CLI = require('./src/cli');

// Setup logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'obsidian-linker' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Ensure logs directory exists
fs.ensureDirSync('./logs');

// Initialize modules
const cacheManager = new CacheManager(logger);
const nlpProcessor = new NLPProcessor(logger, cacheManager);
const vaultReader = new VaultReader(logger);
const linkFinder = new LinkFinder(nlpProcessor, logger);
const linkInserter = new LinkInserter(logger);
const cli = new CLI(program, vaultReader, linkFinder, cacheManager, linkInserter, logger);

// Run the CLI
cli.run();
