import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export type SourceFile = {
  path: string;
  lines: string[];
};

export type HtmlTagMatch = {
  file: SourceFile;
  lineNumber: number;
  tag: string;
};

let findingCount = 0;

export function readExistingFiles(paths: string[]): SourceFile[] {
  const files: SourceFile[] = [];
  const unreadable: string[] = [];

  for (const inputPath of paths) {
    try {
      const path = resolve(inputPath);
      const stat = statSync(path);
      if (!stat.isFile()) {
        unreadable.push(`${inputPath} (not a file)`);
        continue;
      }
      const content = readFileSync(path, "utf8");
      files.push({ path: inputPath, lines: content.split(/\r?\n/) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      unreadable.push(`${inputPath} (${message})`);
    }
  }

  if (unreadable.length > 0) {
    for (const path of unreadable) {
      console.error(`unreadable input: ${path}`);
    }
    process.exit(2);
  }

  if (files.length === 0) {
    console.error("no readable input files");
    process.exit(2);
  }

  return files;
}

export function emit(itemId: string, location: string, message: string): void {
  findingCount += 1;
  console.log(`${itemId}\t${location}\t${message}`);
}

export function getFindingCount(): number {
  return findingCount;
}

export function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

export function scanLines(
  files: SourceFile[],
  pattern: RegExp,
  onMatch: (file: SourceFile, lineNumber: number, line: string) => void,
): void {
  for (const file of files) {
    file.lines.forEach((line, index) => {
      if (pattern.test(line)) {
        onMatch(file, index + 1, line);
      }
    });
  }
}

// The inside of an opening tag, up to its closing `>`. A `>` inside Liquid (`{% if count > 0 %}`) or inside a
// quoted attribute value doesn't end the tag.
const TAG_BODY = String.raw`(?:\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}|"[^"]*"|'[^']*'|\{(?![{%])|[^>{"'])*`;

export function scanHtmlTags(
  files: SourceFile[],
  tagName: string,
  onMatch: (match: HtmlTagMatch) => void,
): void {
  const pattern = new RegExp(`<\\s*${tagName}\\b${TAG_BODY}>`, "gi");

  for (const file of files) {
    const content = file.lines.join("\n");
    for (const match of content.matchAll(pattern)) {
      const index = match.index ?? 0;
      const lineNumber = content.slice(0, index).split("\n").length;
      onMatch({ file, lineNumber, tag: match[0] });
    }
  }
}

export function scanHtmlElements(
  files: SourceFile[],
  onMatch: (match: HtmlTagMatch) => void,
): void {
  const pattern = new RegExp(`<\\s*[a-z][\\w:-]*\\b${TAG_BODY}>`, "gi");

  for (const file of files) {
    const content = file.lines.join("\n");
    for (const match of content.matchAll(pattern)) {
      const index = match.index ?? 0;
      const lineNumber = content.slice(0, index).split("\n").length;
      onMatch({ file, lineNumber, tag: match[0] });
    }
  }
}

export function scanHtmlBlocks(
  files: SourceFile[],
  tagName: string,
  onMatch: (match: HtmlTagMatch) => void,
): void {
  const pattern = new RegExp(
    `<\\s*${tagName}\\b[\\s\\S]*?<\\/\\s*${tagName}\\s*>`,
    "gi",
  );

  for (const file of files) {
    const content = file.lines.join("\n");
    for (const match of content.matchAll(pattern)) {
      const index = match.index ?? 0;
      const lineNumber = content.slice(0, index).split("\n").length;
      onMatch({ file, lineNumber, tag: match[0] });
    }
  }
}
