import { describe, it, expect } from 'vitest';
import { chunkNote } from '../../src/backend/chunker';
import type { VaultNote } from '../../src/backend/types';

describe('Chunker', () => {
  it('chunks a simple note', () => {
    const note: VaultNote = {
      path: '/test.md',
      name: 'Test',
      content: '# Heading\n\nParagraph one.\n\nParagraph two.',
      modifiedAt: Date.now(),
      sizeBytes: 40,
    };

    const chunks = chunkNote(note);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunkId).toContain('test.md');
    expect(chunks[0].text).toBeDefined();
  });

  it('produces chunks with required properties', () => {
    const note: VaultNote = {
      path: '/test.md',
      name: 'Test',
      content: '# Test\n\nSome content here.',
      modifiedAt: Date.now(),
      sizeBytes: 30,
    };

    const chunks = chunkNote(note);
    const chunk = chunks[0];

    expect(chunk).toHaveProperty('chunkId');
    expect(chunk).toHaveProperty('notePath');
    expect(chunk).toHaveProperty('chunkIndex');
    expect(chunk).toHaveProperty('text');
    expect(chunk).toHaveProperty('tokenCount');
    expect(chunk).toHaveProperty('headingPath');
    expect(chunk).toHaveProperty('byteOffsetStart');
    expect(chunk).toHaveProperty('byteOffsetEnd');
  });
});
