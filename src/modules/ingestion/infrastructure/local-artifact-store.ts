import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactStore, ArtifactWrite } from "../application/artifact-store";

export class LocalArtifactStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  async putIfAbsent(input: ArtifactWrite): Promise<{ objectKey: string }> {
    const safeKey = input.key.replaceAll("..", "").replace(/^\/+/, "");
    const destination = path.join(this.root, safeKey);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, input.body, typeof input.body === "string"
      ? { encoding: "utf8", flag: "wx" }
      : { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    return { objectKey: safeKey };
  }
}
