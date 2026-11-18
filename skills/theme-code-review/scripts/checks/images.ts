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

  for (const file of files) {
    file.lines.forEach((line, index) => {
      if (!/image_tag/i.test(line) || /\bwidths\s*:/i.test(line)) {
        return;
      }

      emit("IMG-03", `${file.path}:${index + 1}`, "image_tag without widths:");
    });
  }
}
