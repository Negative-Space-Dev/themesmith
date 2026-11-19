import { emit, readExistingFiles, scanHtmlBlocks, scanHtmlTags } from "../lib/io";

export function checkImages(filePaths: string[]): void {
  const files = readExistingFiles(filePaths);

  scanHtmlTags(files, "img", ({ file, lineNumber, tag }) => {
    const location = `${file.path}:${lineNumber}`;
    const hasWidth = /\bwidth\s*=/i.test(tag);
    const hasHeight = /\bheight\s*=/i.test(tag);
    const hasAspectRatio = /aspect-ratio\s*:/i.test(tag);

    if ((!hasWidth || !hasHeight) && !hasAspectRatio) {
      emit("IMG-01", location, "raw <img> without width/height or aspect-ratio");
    }

    if (!/\balt\s*=/i.test(tag)) {
      emit("IMG-04", location, "raw <img> missing alt attribute");
    }

    if (!/\bsrcset\s*=/i.test(tag) && !/icon|logo|sprite/i.test(tag)) {
      emit("IMG-03", location, "<img> without srcset (responsive)");
    }

    emit(
      "IMG-05",
      location,
      "raw <img> in source — evaluate image_tag or confirm intentional",
    );

    const srcMatch = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i);
    const srcValue = srcMatch?.[2] ?? srcMatch?.[3] ?? "";
    const isHardcodedSrc =
      srcValue.length > 0 &&
      !srcValue.includes("{{") &&
      !srcValue.includes("{%") &&
      (/^https?:\/\//i.test(srcValue) ||
        /^\/\//.test(srcValue) ||
        /^\/[^/]/.test(srcValue));

    if (isHardcodedSrc) {
      emit("IMG-05", location, "hardcoded image URL in src — evaluate or confirm");
    }
  });

  scanHtmlBlocks(files, "picture", ({ file, lineNumber, tag }) => {
    if (!/<\s*img\b/i.test(tag)) {
      emit("IMG-06", `${file.path}:${lineNumber}`, "<picture> without fallback <img>");
    }
  });

  // Whole Liquid tags, since a formatter wraps a long `image_tag` call across lines. A `{% liquid %}` tag holds one
  // statement per line.
  for (const file of files) {
    const content = file.lines.join("\n");
    for (const match of content.matchAll(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g)) {
      const start = content.slice(0, match.index).split("\n").length;
      const statements = /^\{%-?\s*liquid\b/.test(match[0]) ? match[0].split("\n").map((text, i) => ({ text, line: start + i })) : [{ text: match[0], line: start }];
      for (const { text, line } of statements) {
        if (/\|\s*image_tag\b/i.test(text) && !/\bwidths\s*:/i.test(text)) {
          emit("IMG-03", `${file.path}:${line}`, "image_tag without widths:");
        }
      }
    }
  }
}
