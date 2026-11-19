import { emit, readExistingFiles } from "../lib/io";

// Loops over these can hold hundreds of items, so a loop nested with one is worth flagging. A nested loop over
// small, bounded lists (a product's options and their values) is not.
const LARGE_LIST = /\bin\s+[\w.[\]'"-]*\b(?:products|variants|collections|all_products|results|articles|blogs|linklists|metaobjects|orders|line_items|items)\b/i;

// The statements of a `{% liquid %}` tag, one per line, rewritten as ordinary tags so the line checks see them.
function withLiquidTagStatements(lines: string[]): string[] {
  let inside = false;
  return lines.map((line) => {
    if (!inside) {
      const opens = /\{%-?\s*liquid\b/.test(line);
      if (opens && !/-?%\}/.test(line.slice(line.search(/\{%-?\s*liquid\b/) + 2))) inside = true;
      return line;
    }
    if (/-?%\}/.test(line)) inside = false;
    const statement = line.replace(/-?%\}.*$/, "").trim();
    return /^(?:for|endfor|paginate|endpaginate|render|include|assign|echo)\b/.test(statement) ? `{% ${statement} %}` : line;
  });
}

export function checkLiquidPerformance(filePaths: string[]): void {
  const liquidFiles = filePaths.filter((path) => /\.liquid$/i.test(path));
  if (liquidFiles.length === 0) return;
  for (const file of readExistingFiles(liquidFiles)) {
    const loops: boolean[] = [];
    let paginateDepth = 0;

    withLiquidTagStatements(file.lines).forEach((line, index) => {
      const lineNumber = index + 1;
      const location = `${file.path}:${lineNumber}`;
      const opensFor = /\{%-?\s*for\s/i.test(line);

      if (/\{%-?\s*paginate\s/i.test(line)) {
        paginateDepth += 1;
      }

      if (opensFor) {
        const large = LARGE_LIST.test(line);
        if (loops.length > 0 && (large || loops.some(Boolean))) {
          emit("LIQUID-01", location, `nested {% for %} (depth ${loops.length + 1}) over a list that can be large`);
        }
        loops.push(large);
      }

      if (/\{%-?\s*endfor\s*-?%\}/i.test(line) && loops.length > 0) {
        loops.pop();
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
