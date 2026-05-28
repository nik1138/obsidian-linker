import type { LogicalConnection } from "../backend/types.js";
import { LinkInserter } from "./inserter.js";

export class LinkRemover {
  private inserter: LinkInserter;

  constructor() {
    this.inserter = new LinkInserter();
  }

  async removeLinks(
    connectionsBySource: Map<string, LogicalConnection[]>
  ): Promise<void> {
    await this.inserter.removeLinks(connectionsBySource);
  }
}
