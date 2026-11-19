import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readExistingFiles } from "./io";

const CATEGORY_SIGNALS: { id: string; pattern: RegExp }[] = [
  {
    id: "images",
    pattern: /<img\b|image_tag|image_url|<picture\b|srcset/i,
  },
  {
    id: "video",
    pattern: /<video|video_tag|external_video|youtube|vimeo/i,
  },
  {
    id: "liquid-performance",
    pattern:
      /\{%-?\s*for\s|paginate|all_products|\.products|\| json|'now'\s*\|\s*date|\{%-?\s*render|\{%-?\s*include|\bcollections\b|linklists|\{%-?\s*(liquid|assign|capture)\s/i,
  },
  {
    id: "modals-dialogs",
    pattern: /<dialog\b|aria-modal|role\s*=\s*["']dialog["']|\bmodal\b|\bdrawer\b|\bpopover\b|off-?canvas/i,
  },
  {
    id: "tailwind",
    pattern: /@apply\b|@tailwind\b|tailwind\.config|@theme\b|@import\s+["']tailwindcss/i,
  },
];

export function detectCategories(filePaths: string[]): string[] {
  const files = readExistingFiles(filePaths);
  const combined = files.map((file) => file.lines.join("\n")).join("\n");
  const matched: string[] = [];

  for (const { id, pattern } of CATEGORY_SIGNALS) {
    if (pattern.test(combined) || (id === "tailwind" && filePaths.some(usesTailwind))) {
      matched.push(id);
    }
  }

  return matched;
}

// Whether the project a file belongs to uses Tailwind: a Tailwind config, or Tailwind in a package.json, in the
// file's folder or any folder above it up to the repository's top.
function usesTailwind(filePath: string): boolean {
  for (let dir = dirname(resolve(filePath)); ; dir = dirname(dir)) {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {}
    if (names.some((name) => /^tailwind\.config\./.test(name))) return true;
    if (names.includes("package.json")) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (Object.keys(deps).some((name) => name === "tailwindcss" || name.startsWith("@tailwindcss/"))) return true;
      } catch {}
    }
    if (names.includes(".git") || existsSync(join(dir, ".git")) || dirname(dir) === dir) return false;
  }
}
