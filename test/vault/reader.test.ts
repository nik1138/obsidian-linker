import { describe, it, expect, beforeEach } from 'vitest';
import { VaultReader } from '../../src/vault/reader.js';
import path from 'path';
import fsExtra from 'fs-extra';

describe('VaultReader', () => {
  let reader: VaultReader;
  const fixturesDir = path.join(process.cwd(), 'test', 'fixtures', 'small-vault');

  beforeEach(() => {
    reader = new VaultReader();
  });

  describe('scanVault', () => {
    it('should find all .md files in vault directory', async () => {
      const files = await reader.scanVault(fixturesDir);

      expect(files).toBeInstanceOf(Array);
      expect(files.length).toBeGreaterThanOrEqual(5);

      const fileNames = files.map(f => path.basename(f));
      expect(fileNames).toContain('AI.md');
      expect(fileNames).toContain('MachineLearning.md');
      expect(fileNames).toContain('DeepLearning.md');
      expect(fileNames).toContain('NeuralNetworks.md');
      expect(fileNames).toContain('NLP.md');
    });

    it('should return absolute paths', async () => {
      const files = await reader.scanVault(fixturesDir);

      for (const file of files) {
        expect(path.isAbsolute(file)).toBe(true);
      }
    });

    it('should ignore .git and node_modules directories', async () => {
      const vaultWithDirs = path.join(process.cwd(), 'test', 'temp-vault');
      await fsExtra.ensureDir(vaultWithDirs);
      await fsExtra.ensureDir(path.join(vaultWithDirs, '.git'));
      await fsExtra.ensureDir(path.join(vaultWithDirs, 'node_modules'));
      await fsExtra.writeFile(path.join(vaultWithDirs, 'test.md'), '# Test');

      const files = await reader.scanVault(vaultWithDirs);

      expect(files.some(f => f.includes('.git'))).toBe(false);
      expect(files.some(f => f.includes('node_modules'))).toBe(false);

      await fsExtra.remove(vaultWithDirs);
    });

    it('should handle empty vault directory', async () => {
      const emptyDir = path.join(process.cwd(), 'test', 'empty-vault');
      await fsExtra.ensureDir(emptyDir);

      const files = await reader.scanVault(emptyDir);

      expect(files).toEqual([]);

      await fsExtra.remove(emptyDir);
    });

    it('should throw error for non-existent directory', async () => {
      await expect(reader.scanVault('/non/existent/path')).rejects.toThrow();
    });
  });

  describe('readNote', () => {
    it('should read and parse a valid markdown file', async () => {
      const testFile = path.join(fixturesDir, 'AI.md');
      const note = await reader.readNote(testFile);

      expect(note.path).toBe(testFile);
      expect(note.name).toBe('AI');
      expect(note.content).toContain('Artificial Intelligence');
      expect(note.content).toContain('# Artificial Intelligence');
      expect(note.modifiedAt).toBeGreaterThan(0);
      expect(note.sizeBytes).toBeGreaterThan(0);
    });

    it('should handle files with YAML frontmatter', async () => {
      const testFile = path.join(fixturesDir, 'AI.md');
      const note = await reader.readNote(testFile);

      expect(note.content).toContain('---');
      expect(note.content).toContain('title: Artificial Intelligence');
    });

    it('should throw error for non-existent file', async () => {
      await expect(reader.readNote('/non/existent/file.md')).rejects.toThrow();
    });

    it('should correctly extract filename as note name', async () => {
      const testFile = path.join(fixturesDir, 'MachineLearning.md');
      const note = await reader.readNote(testFile);

      expect(note.name).toBe('MachineLearning');
    });
  });

  describe('readAllNotes', () => {
    it('should read multiple files in parallel', async () => {
      const files = await reader.scanVault(fixturesDir);
      const notes = await reader.readAllNotes(files);

      expect(notes.length).toBeGreaterThanOrEqual(5);

      for (const note of notes) {
        expect(note).toHaveProperty('path');
        expect(note).toHaveProperty('name');
        expect(note).toHaveProperty('content');
        expect(note).toHaveProperty('modifiedAt');
        expect(note).toHaveProperty('sizeBytes');
      }
    });

    it('should maintain order of input files', async () => {
      const files = await reader.scanVault(fixturesDir);
      const notes = await reader.readAllNotes(files);

      for (let i = 0; i < files.length; i++) {
        expect(notes[i].path).toBe(files[i]);
      }
    });

    it('should handle empty file list', async () => {
      const notes = await reader.readAllNotes([]);
      expect(notes).toEqual([]);
    });
  });

  describe('extractTextContent', () => {
    it('should extract plain text from markdown', () => {
      const markdown = `# Heading

This is a paragraph with **bold** and *italic* text.

Another paragraph.`;

      const text = reader.extractTextContent(markdown);

      expect(text).toContain('Heading');
      expect(text).toContain('This is a paragraph');
      expect(text).toContain('Another paragraph');
      expect(text).not.toContain('**');
      expect(text).not.toContain('*');
    });

    it('should skip code blocks', () => {
      const markdown = `# Code Example

\`\`\`javascript
const x = 1;
console.log(x);
\`\`\`

Text after code.`;

      const text = reader.extractTextContent(markdown);

      expect(text).not.toContain('const x = 1');
      expect(text).not.toContain('console.log');
      expect(text).toContain('Text after code');
    });

    it('should skip inline code', () => {
      const markdown = `Use the \`print()\` function to output.`;

      const text = reader.extractTextContent(markdown);

      expect(text).not.toContain('print()');
      expect(text).toContain('Use the');
      expect(text).toContain('function to output');
    });

    it('should skip images', () => {
      const markdown = `![Alt text](image.png)`;

      const text = reader.extractTextContent(markdown);

      expect(text).not.toContain('image.png');
    });

    it('should handle empty markdown', () => {
      const text = reader.extractTextContent('');
      expect(text).toBe('');
    });

    it('should handle markdown with only frontmatter', () => {
      const markdown = `---
title: Test
---

# Content`;

      const text = reader.extractTextContent(markdown);

      expect(text).toContain('Content');
      expect(text).not.toContain('---');
    });
  });

  describe('extractExistingLinks', () => {
    it('should extract wiki-links from markdown', () => {
      const markdown = `See [[AI]] and [[Machine Learning|ML]] for more.`;

      const links = reader.extractExistingLinks(markdown);

      expect(links).toEqual(['AI', 'Machine Learning']);
    });

    it('should handle multiple links in same paragraph', () => {
      const markdown = `[[AI]] is related to [[Machine Learning]] and [[Deep Learning]].`;

      const links = reader.extractExistingLinks(markdown);

      expect(links).toHaveLength(3);
      expect(links).toContain('AI');
      expect(links).toContain('Machine Learning');
      expect(links).toContain('Deep Learning');
    });

    it('should return empty array when no links present', () => {
      const markdown = `# Heading

Just plain text.`;

      const links = reader.extractExistingLinks(markdown);

      expect(links).toEqual([]);
    });

    it('should handle links with special characters', () => {
      const markdown = `See [[C++]] and [[C#]] for programming.`;

      const links = reader.extractExistingLinks(markdown);

      expect(links).toContain('C++');
      expect(links).toContain('C#');
    });
  });

  describe('extractFrontmatter', () => {
    it('should extract YAML frontmatter', () => {
      const markdown = `---
title: Test Note
created: 2024-01-15
tags: [test, example]
---

# Content`;

      const frontmatter = reader.extractFrontmatter(markdown);

      expect(frontmatter).not.toBeNull();
      expect(frontmatter?.title).toBe('Test Note');
      expect(frontmatter?.created).toBe('2024-01-15');
      expect(frontmatter?.tags).toBe('[test, example]');
    });

    it('should return null when no frontmatter present', () => {
      const markdown = `# Content

Just text.`;

      const frontmatter = reader.extractFrontmatter(markdown);

      expect(frontmatter).toBeNull();
    });

    it('should handle malformed frontmatter gracefully', () => {
      const markdown = `---
title: Test
invalid line without colon
---

Content`;

      const frontmatter = reader.extractFrontmatter(markdown);

      expect(frontmatter).not.toBeNull();
      expect(frontmatter?.title).toBe('Test');
    });
  });

  describe('isInForbiddenZone', () => {
    it('should detect position inside code block', () => {
      const markdown = `\`\`\`javascript
const x = 1;
\`\`\``;

      const result = reader.isInForbiddenZone(markdown, markdown.indexOf('const x'));

      expect(result.inCode).toBe(true);
    });

    it('should detect position inside inline code', () => {
      const markdown = `Use \`console.log()\` function.`;

      const position = markdown.indexOf('console.log');
      const result = reader.isInForbiddenZone(markdown, position);

      expect(result.inCode).toBe(true);
    });

    it('should detect position inside frontmatter', () => {
      const markdown = `---
title: Test
---

Content`;

      const position = markdown.indexOf('title');
      const result = reader.isInForbiddenZone(markdown, position);

      expect(result.inFrontmatter).toBe(true);
    });

    it('should detect position inside existing wiki-link', () => {
      const markdown = `See [[AI]] for more.`;

      const position = markdown.indexOf('AI');
      const result = reader.isInForbiddenZone(markdown, position);

      expect(result.inLink).toBe(true);
    });

    it('should return false for normal text', () => {
      const markdown = `# Heading

This is normal text.`;

      const position = markdown.indexOf('normal');
      const result = reader.isInForbiddenZone(markdown, position);

      expect(result.inCode).toBe(false);
      expect(result.inFrontmatter).toBe(false);
      expect(result.inLink).toBe(false);
    });
  });

  describe('getChangedFiles', () => {
    it('should return files modified after given date', async () => {
      const since = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      const changed = await reader.getChangedFiles(fixturesDir, since);

      // All fixture files should be considered "changed" since they were modified recently
      expect(changed.length).toBeGreaterThan(0);
    });

    it('should not return files modified before given date', async () => {
      const testDir = path.join(process.cwd(), 'test', 'temp-vault');
      await fsExtra.ensureDir(testDir);
      const testFile = path.join(testDir, 'old-file.md');
      await fsExtra.writeFile(testFile, '# Old file');

      const oneDayAgo = Date.now() - 1000 * 60 * 60 * 24;
      await fsExtra.utime(testFile, new Date(oneDayAgo), new Date(oneDayAgo));

      const since = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      const changed = await reader.getChangedFiles(testDir, since);

      expect(changed).not.toContain(testFile);

      await fsExtra.remove(testDir);
    });
  });
});
