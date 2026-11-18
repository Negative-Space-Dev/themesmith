#!/usr/bin/env bun
/**
 * Rename ID-based rules to semantic slugs and refresh frontmatter descriptions.
 * Also updates checklist index rule: paths.
 */

import { readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { RULE_BY_ID, RULE_REGISTRY } from "./lib/rule-registry";

const skillRoot = join(import.meta.dir, "..");
const rulesDir = join(skillRoot, "rules");
const checklistDir = join(skillRoot, "checklist");

for (const entry of RULE_REGISTRY) {
  const oldPath = join(rulesDir, `${entry.id}.mdc`);
  const newPath = join(rulesDir, `${entry.slug}.mdc`);

  let body: string;
  try {
    body = readFileSync(oldPath, "utf8");
  } catch {
    try {
      body = readFileSync(newPath, "utf8");
    } catch {
      console.warn("skip missing", entry.id);
      continue;
    }
  }

  const bodyMatch = body.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
  const content = bodyMatch?.[1]?.trim() ?? body;
  const heading = `# ${entry.id} — ${entry.title}`;

  const updated = /^#\s/m.test(content)
    ? content.replace(/^#[^\n]+/, heading)
    : `${heading}\n\n${content}`;

  const normalized = updated
    .replace(/^(# [^\n]+\n)\n?\1/m, "$1")
    .replace(/\bPERF-(\d+)\b/g, "LIQUID-$1")
    .replace(/\bSMELL-01\b/g, "LIQUID-12");

  const mdc = `---
description: ${JSON.stringify(entry.description)}
id: ${entry.id}
alwaysApply: false
---

${normalized.trim()}
`;

  writeFileSync(newPath, mdc);
  if (oldPath !== newPath) {
    try {
      unlinkSync(oldPath);
    } catch {
      // already renamed
    }
  }
  console.log(`${entry.id} → ${entry.slug}.mdc`);
}

// Remove orphan ID-named files
for (const file of readdirSync(rulesDir)) {
  if (!file.endsWith(".mdc")) continue;
  const slug = file.replace(/\.mdc$/, "");
  if (/^[A-Z]+-\d+$/.test(slug) && RULE_BY_ID[slug]) {
    unlinkSync(join(rulesDir, file));
    console.log("removed orphan", file);
  }
}

// Update checklist indexes
for (const file of readdirSync(checklistDir)) {
  if (!file.endsWith(".md") || file === "README.md" || file === "_SCHEMA.md") {
    continue;
  }
  let content = readFileSync(join(checklistDir, file), "utf8");
  let changed = false;
  for (const entry of RULE_REGISTRY) {
    const patterns = [
      `- **rule:** rules/${entry.id}.mdc`,
      `- **rule:** rules/${entry.slug}.mdc`,
    ];
    const replacement = `- **rule:** rules/${entry.slug}.mdc`;
    for (const pattern of patterns) {
      if (content.includes(pattern) && pattern !== replacement) {
        content = content.replaceAll(pattern, replacement);
        changed = true;
      }
    }
    if (!content.includes(replacement) && content.includes(`#### ${entry.id}`)) {
      // noop — handled by replace
    }
  }
  if (changed) {
    writeFileSync(join(checklistDir, file), content);
    console.log("updated checklist", file);
  }
}

console.log("done");
