import { emit, readExistingFiles } from "../lib/io";

export function checkLiquidPerformance(filePaths: string[]): void {
  for (const file of readExistingFiles(filePaths)) {
    let forDepth = 0;
    let paginateDepth = 0;

    file.lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const location = `${file.path}:${lineNumber}`;
      const opensFor = /\{%-?\s*for\s/i.test(line);

      if (/\{%-?\s*paginate\s/i.test(line)) {
        paginateDepth += 1;
      }

      if (opensFor) {
        forDepth += 1;
        if (forDepth >= 2) {
          emit(
            "LIQUID-01",
            location,
            `nested {% for %} (depth ${forDepth})`,
          );
        }
      }

      if (/\{%-?\s*endfor\s*-?%\}/i.test(line) && forDepth > 0) {
        forDepth -= 1;
      }

      if (
        opensFor &&
        /\b(?:collection|collections(?:\[[^\]]+\]|\.[\w-]+)|all_products)\b.*\.products\b/i.test(
          line,
        ) &&
        !/\blimit\s*:/i.test(line) &&
        paginateDepth === 0
      ) {
        emit("LIQUID-02", location, "for over collection without limit:/paginate");
      }

      if (
        /\ball_products\s*(?:\[|\.)/i.test(line) ||
        /\bcollections\s*(?:\[|\.[\w-]+)/i.test(line) ||
        /\blinklists\s*(?:\[|\.[\w-]+)/i.test(line)
      ) {
        emit("LIQUID-03", location, "expensive global object lookup");
      }

      if (/\{%-?\s*include\s/i.test(line)) {
        emit("LIQUID-04", location, "deprecated {% include %} (prefer {% render %})");
      }

      if (/['"]now['"]\s*\|\s*date/i.test(line)) {
        emit("LIQUID-06", location, "cache-breaking 'now' | date operation");
      }

      if (
        /\{%-?\s*render\s/i.test(line) &&
        /\b(variant|product|collection|cart|item)\s*:\s*\b\1\b/i.test(line)
      ) {
        emit("LIQUID-07", location, "render passes whole object instead of primitives");
      }

      if (/\b(product|collection|cart|all_products|collections)\s*\|\s*json\b/i.test(line)) {
        emit("LIQUID-08", location, "large object | json serialization");
      }

      if (/\{%-?\s*endpaginate\s*-?%\}/i.test(line) && paginateDepth > 0) {
        paginateDepth -= 1;
      }
    });
  }
}
