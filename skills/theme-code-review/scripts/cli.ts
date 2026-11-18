#!/usr/bin/env bun
/**
 * Cross-platform review scripts (macOS, Linux, Windows).
 *
 * Usage:
 *   bun cli.ts detect <file> [<file> ...]
 *   bun cli.ts check <category> <file> [<file> ...]
 *
 * Categories: images | video | liquid-performance | modals-dialogs | tailwind | all
 */

import { detectCategories } from "./lib/detect-categories";
import { checkImages } from "./checks/images";
import { checkVideo } from "./checks/video";
import { checkLiquidPerformance } from "./checks/liquid-performance";
import { checkModalsDialogs } from "./checks/modals-dialogs";
import { checkTailwind } from "./checks/tailwind";
import { getFindingCount } from "./lib/io";

const CHECKS = {
  images: checkImages,
  video: checkVideo,
  "liquid-performance": checkLiquidPerformance,
  "modals-dialogs": checkModalsDialogs,
  tailwind: checkTailwind,
} as const;

type CheckName = keyof typeof CHECKS;

const REVIEWABLE_SOURCE_PATTERN = /\.(liquid|html?|js|mjs|cjs|ts|tsx|css)$/i;

function reviewableSourcePaths(filePaths: string[]): string[] {
  const filtered = filePaths.filter((filePath) =>
    REVIEWABLE_SOURCE_PATTERN.test(filePath),
  );

  if (filtered.length === 0) {
    console.error("no reviewable theme source files");
    process.exit(2);
  }

  return filtered;
}

function usage(): never {
  console.error(`usage:
  bun cli.ts detect <file> [<file> ...]
  bun cli.ts check <category> <file> [<file> ...]

categories: ${Object.keys(CHECKS).join(" | ")} | all`);
  process.exit(2);
}

const [, , command, ...args] = process.argv;

if (command === "detect") {
  if (args.length === 0) {
    usage();
  }

  for (const category of detectCategories(reviewableSourcePaths(args))) {
    console.log(category);
  }
  process.exit(0);
}

if (command === "check") {
  const [category, ...filePaths] = args;

  if (!category || filePaths.length === 0) {
    usage();
  }

  if (category === "all") {
    const sourcePaths = reviewableSourcePaths(filePaths);
    for (const run of Object.values(CHECKS)) {
      run(sourcePaths);
    }
    process.exit(getFindingCount() > 0 ? 1 : 0);
  }

  const run = CHECKS[category as CheckName];
  if (!run) {
    console.error(`unknown category: ${category}`);
    usage();
  } else {
    run(reviewableSourcePaths(filePaths));
    process.exit(getFindingCount() > 0 ? 1 : 0);
  }
}

usage();
