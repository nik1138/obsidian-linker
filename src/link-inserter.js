const fs = require('fs-extra');
const path = require('path');

/**
 * LinkInserter - Module for inserting conceptual links into Obsidian notes
 */
class LinkInserter {
  /**
   * Constructor
   * @param {Object} logger - Logger instance
   */
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Insert links into Obsidian notes based on analysis results
   * @param {string} resultsPath - Path to JSON file with analysis results
   * @param {Object} options - Insertion options
   * @returns {Promise<void>}
   */
  async insertLinks(resultsPath, options = {}) {
    try {
      this.logger.info(`Inserting links from ${resultsPath}`);
      
      // Read analysis results
      const results = await fs.readJson(resultsPath);
      
      if (!results.links || !Array.isArray(results.links)) {
        throw new Error('Invalid results format: missing links array');
      }
      
      this.logger.info(`Found ${results.links.length} links to insert`);
      
      // Apply limit if specified
      let linksToInsert = results.links;
      if (options.limit && options.limit > 0) {
        // Sort by similarity and take top N
        linksToInsert = [...results.links]
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, options.limit);
        this.logger.debug(`Limited to top ${options.limit} links`);
      }
      
      // Group links by source file
      const linksBySource = this.groupLinksBySource(linksToInsert);
      
      // Insert links into each file
      for (const [sourcePath, links] of Object.entries(linksBySource)) {
        try {
          await this.insertLinksIntoFile(sourcePath, links, options);
        } catch (error) {
          this.logger.error(`Error inserting links into ${sourcePath}:`, error);
        }
      }
      
      this.logger.info('Link insertion completed successfully');
    } catch (error) {
      this.logger.error('Error inserting links:', error);
      throw error;
    }
  }

  /**
   * Group links by source file path
   * @param {Array<Object>} links - Array of link objects
   * @returns {Object} - Links grouped by source file path
   */
  groupLinksBySource(links) {
    const grouped = {};
    
    for (const link of links) {
      const sourcePath = link.sourcePath;
      
      if (!grouped[sourcePath]) {
        grouped[sourcePath] = [];
      }
      
      grouped[sourcePath].push(link);
    }
    
    return grouped;
  }

  /**
   * Insert links into a specific file
   * @param {string} filePath - Path to file
   * @param {Array<Object>} links - Links to insert
   * @param {Object} options - Insertion options
   * @returns {Promise<void>}
   */
  async insertLinksIntoFile(filePath, links, options = {}) {
    try {
      this.logger.debug(`Inserting ${links.length} links into ${filePath}`);
      
      // Check if file exists
      if (!await fs.pathExists(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      // Read file content
      let content = await fs.readFile(filePath, 'utf8');
      
      // Check if file already has the "Связанные заметки" section
      const hasRelatedNotesSection = content.includes('## Связанные заметки');
      
      // Prepare links for insertion
      const linkLines = links.map(link => {
        // Format: [[Target Note]] - similarity: 0.85
        return `[[${link.target}]] - similarity: ${link.similarity.toFixed(3)}`;
      });
      
      // Create the related notes section
      const sectionTitle = options.sectionTitle || 'Связанные заметки';
      const relatedNotesSection = [
        '',
        `## ${sectionTitle}`,
        '',
        '> [!info] Автоматически найденные связи',
        '> Эти ссылки были найдены с помощью NLP-анализа и могут содержать концептуальные связи.',
        '',
        ...linkLines,
        ''
      ].join('\n');
      
      if (hasRelatedNotesSection) {
        // If section exists, update it
        content = this.updateRelatedNotesSection(content, relatedNotesSection);
      } else {
        // If section doesn't exist, append it
        content = content.trimEnd() + relatedNotesSection;
      }
      
      // Write updated content back to file
      await fs.writeFile(filePath, content, 'utf8');
      
      this.logger.info(`Successfully inserted ${links.length} links into ${filePath}`);
    } catch (error) {
      this.logger.error(`Error inserting links into ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Update existing "Связанные заметки" section
   * @param {string} content - File content
   * @param {string} newSection - New section content
   * @returns {string} - Updated content
   */
  updateRelatedNotesSection(content, newSection) {
    // Find the start of the existing section
    // Look for any header that might be a "related notes" section
    const sectionRegex = /##\s+(.*[Сс]вязанные.*|[Пп]охожие.*|[Rr]elated.*).*\n/;
    const sectionMatch = content.match(sectionRegex);
    
    if (!sectionMatch) {
      // Section not found, append new section
      return content.trimEnd() + newSection;
    }
    
    const sectionStart = sectionMatch.index;
    
    // Find the end of the existing section
    // Look for the next header or end of file
    const nextHeader = content.indexOf('\n## ', sectionStart + 1);
    const sectionEnd = nextHeader !== -1 ? nextHeader : content.length;
    
    // Replace the existing section with the new one
    const beforeSection = content.substring(0, sectionStart);
    const afterSection = content.substring(sectionEnd);
    
    return beforeSection + newSection.trimStart() + afterSection;
  }

  /**
   * Remove automatically inserted links from files
   * @param {string} resultsPath - Path to JSON file with analysis results
   * @returns {Promise<void>}
   */
  async removeInsertedLinks(resultsPath) {
    try {
      this.logger.info(`Removing inserted links based on ${resultsPath}`);
      
      // Read analysis results
      const results = await fs.readJson(resultsPath);
      
      if (!results.links || !Array.isArray(results.links)) {
        throw new Error('Invalid results format: missing links array');
      }
      
      // Get unique source files
      const sourceFiles = [...new Set(results.links.map(link => link.sourcePath))];
      
      // Remove links from each file
      for (const filePath of sourceFiles) {
        try {
          await this.removeLinksFromFile(filePath);
        } catch (error) {
          this.logger.error(`Error removing links from ${filePath}:`, error);
        }
      }
      
      this.logger.info('Link removal completed successfully');
    } catch (error) {
      this.logger.error('Error removing links:', error);
      throw error;
    }
  }

  /**
   * Remove links from a specific file
   * @param {string} filePath - Path to file
   * @returns {Promise<void>}
   */
  async removeLinksFromFile(filePath) {
    try {
      this.logger.debug(`Removing inserted links from ${filePath}`);
      
      // Check if file exists
      if (!await fs.pathExists(filePath)) {
        this.logger.warn(`File not found: ${filePath}`);
        return;
      }
      
      // Read file content
      let content = await fs.readFile(filePath, 'utf8');
      
      // Check if file has the "Связанные заметки" section
      // Look for any header that might be a "related notes" section
      const sectionRegex = /##\s+(.*[Сс]вязанные.*|[Пп]охожие.*|[Rr]elated.*).*\n/;
      const sectionMatch = content.match(sectionRegex);
      
      if (!sectionMatch) {
        this.logger.debug(`No "Связанные заметки" section found in ${filePath}`);
        return;
      }
      
      const sectionStart = sectionMatch.index;
      
      // Find the end of the section
      const nextHeader = content.indexOf('\n## ', sectionStart + 1);
      const sectionEnd = nextHeader !== -1 ? nextHeader : content.length;
      
      // Remove the section
      const beforeSection = content.substring(0, sectionStart);
      const afterSection = sectionEnd < content.length ? content.substring(sectionEnd) : '';
      
      content = beforeSection.trimEnd() + '\n' + afterSection.trimStart();
      
      // Write updated content back to file
      await fs.writeFile(filePath, content, 'utf8');
      
      this.logger.info(`Successfully removed links from ${filePath}`);
    } catch (error) {
      this.logger.error(`Error removing links from ${filePath}:`, error);
      throw error;
    }
  }
}

module.exports = LinkInserter;