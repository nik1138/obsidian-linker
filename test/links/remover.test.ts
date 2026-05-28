import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkRemover } from '../../src/links/remover';

vi.mock('fs-extra');

describe('LinkRemover', () => {
  let remover: LinkRemover;

  beforeEach(() => {
    remover = new LinkRemover();
    vi.clearAllMocks();
  });

  it('can be instantiated', () => {
    expect(remover).toBeDefined();
  });
});
