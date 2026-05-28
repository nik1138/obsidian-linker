import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkInserter } from '../../src/links/inserter';
import fsExtra from 'fs-extra';

vi.mock('fs-extra');

describe('LinkInserter', () => {
  let inserter: LinkInserter;

  beforeEach(() => {
    inserter = new LinkInserter();
    vi.clearAllMocks();
  });

  it('can be instantiated', () => {
    expect(inserter).toBeDefined();
  });
});
