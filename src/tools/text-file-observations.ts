import { createHash } from "node:crypto";

export class TextFileObservations {
  private readonly revisions = new Map<string, string>();

  observe(path: string, content: string): void {
    this.revisions.set(path, revisionOf(content));
  }

  observeRevision(path: string, revision: string): void {
    this.revisions.set(path, revision);
  }

  revision(path: string): string | undefined {
    return this.revisions.get(path);
  }

  matches(path: string, content: string): boolean {
    return this.revision(path) === revisionOf(content);
  }
}

function revisionOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
