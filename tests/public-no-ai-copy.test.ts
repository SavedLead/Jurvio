import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = [
  /\bAI-generated\b/i,
  /\bAlso written by\b/i,
  /\bgpt-[\w.]+\b/i,
  /\bOpenAI\b/i,
  /\bChatGPT\b/i,
  /\bLLMs?\b/,
  /\bGPT\b/,
  /\bAI\b/,
  /data-ai-/,
  /ai-title/,
  /\/ai\.json/i,
  /model-written/i,
];

function publicFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (dir === "src/modules" && name !== "ui" && !publicFilesHasUi(path)) {
        const nested = join(path, "ui");
        if (exists(nested)) publicFiles(nested, out);
        continue;
      }
      publicFiles(path, out);
      continue;
    }
    if (/\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts")) out.push(path);
  }
}

function exists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function publicFilesHasUi(path: string): boolean {
  return path.includes("/ui");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function collect(): string[] {
  const files: string[] = [];
  publicFiles("src/app", files);
  for (const entry of readdirSync("src/modules")) {
    const ui = join("src/modules", entry, "ui");
    if (exists(ui)) publicFiles(ui, files);
    const nested = join("src/modules", entry);
    if (!statSync(nested).isDirectory()) continue;
    for (const child of readdirSync(nested)) {
      const deeper = join(nested, child, "ui");
      if (exists(deeper)) publicFiles(deeper, files);
    }
  }
  return files;
}

describe("public pages do not mention AI", () => {
  it("keeps AI, model names, and machine-summary routes out of rendered sources", () => {
    const hits: string[] = [];
    for (const file of collect()) {
      const text = stripComments(readFileSync(file, "utf8"));
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) hits.push(`${file}: ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
