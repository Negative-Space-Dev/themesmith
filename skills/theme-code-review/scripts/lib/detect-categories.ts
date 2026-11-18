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
    pattern:
      /\bclass(?:Name)?\s*=|@apply\b|@tailwind\b|tailwind\.config|@theme\b|-\[[^\]]+\]/i,
  },
];

export function detectCategories(filePaths: string[]): string[] {
  const files = readExistingFiles(filePaths);
  const combined = files.map((file) => file.lines.join("\n")).join("\n");
  const matched: string[] = [];

  for (const { id, pattern } of CATEGORY_SIGNALS) {
    if (pattern.test(combined)) {
      matched.push(id);
    }
  }

  return matched;
}
