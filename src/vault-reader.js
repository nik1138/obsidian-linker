const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');
const markdown = require('markdown-it')();

/**
 * VaultReader - Module for reading and processing Obsidian vault files
 */
class VaultReader {
  /**
   * Constructor
   * @param {Object} logger - Logger instance
   */
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Get all markdown files from vault
   * @param {string} vaultPath - Path to Obsidian vault
   * @returns {Promise<Array<string>>} - Array of file paths
   */
  async getMarkdownFiles(vaultPath) {
    try {
      this.logger.info(`Scanning vault at: ${vaultPath}`);
      
      // Check if vault path exists
      if (!await fs.pathExists(vaultPath)) {
        throw new Error(`Vault path does not exist: ${vaultPath}`);
      }
      
      // Find all .md files recursively
      const pattern = path.join(vaultPath, '**/*.md');
      const files = glob.sync(pattern, { 
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.obsidian/**'
        ]
      });
      
      this.logger.info(`Found ${files.length} markdown files`);
      return files;
    } catch (error) {
      this.logger.error('Error scanning vault:', error);
      throw error;
    }
  }

  /**
   * Read and parse a markdown file
   * @param {string} filePath - Path to markdown file
   * @returns {Promise<Object>} - Parsed file data
   */
  async readFile(filePath) {
    try {
      this.logger.debug(`Reading file: ${filePath}`);
      
      // Read file content
      const content = await fs.readFile(filePath, 'utf8');
      
      // Get file stats
      const stats = await fs.stat(filePath);
      
      // Extract file name without extension
      const fileName = path.basename(filePath, '.md');
      
      // Parse markdown to extract text content
      const parsed = markdown.parse(content, {});
      const textContent = this.extractTextFromTokens(parsed);
      
      return {
        path: filePath,
        name: fileName,
        content: content,
        textContent: textContent,
        size: stats.size,
        modified: stats.mtime
      };
    } catch (error) {
      this.logger.error(`Error reading file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Extract plain text from markdown tokens
   * @param {Array} tokens - Markdown tokens
   * @returns {string} - Extracted text
   */
  extractTextFromTokens(tokens) {
    let text = '';
    
    for (const token of tokens) {
      if (token.type === 'text' || token.type === 'inline') {
        text += token.content + ' ';
      }
      
      if (token.children) {
        text += this.extractTextFromTokens(token.children);
      }
    }
    
    return text.trim();
  }

  /**
   * Get file metadata (for caching purposes)
   * @param {string} filePath - Path to file
   * @returns {Promise<Object>} - File metadata
   */
  async getFileMetadata(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return {
        path: filePath,
        size: stats.size,
        modified: stats.mtime.getTime()
      };
    } catch (error) {
      this.logger.error(`Error getting metadata for ${filePath}:`, error);
      throw error;
    }
  }
}

module.exports = VaultReader;