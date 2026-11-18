import { emit, readExistingFiles, scanHtmlTags } from "../lib/io";

export function checkVideo(filePaths: string[]): void {
  const files = readExistingFiles(filePaths);

  scanHtmlTags(files, "video", ({ file, lineNumber, tag }) => {
    const location = `${file.path}:${lineNumber}`;

    if (!/\bposter\s*=/i.test(tag)) {
      emit("VID-01", location, "<video> without poster");
    }

    if (/\bautoplay\b/i.test(tag)) {
      if (!/\bmuted\b/i.test(tag)) {
        emit("VID-02", location, "<video autoplay> without muted");
      }
      if (!/\bplaysinline\b/i.test(tag)) {
        emit("VID-02", location, "<video autoplay> without playsinline");
      }
    }

    if (!/\bdata-lazy-video\b/i.test(tag)) {
      emit(
        "VID-03",
        location,
        "<video> without lazy-video pattern — use lazy-video snippet or confirm exception",
      );
    }
  });

  scanHtmlTags(files, "iframe", ({ file, lineNumber, tag }) => {
    const location = `${file.path}:${lineNumber}`;

    if (!/youtube|youtu\.be|vimeo/i.test(tag)) {
      return;
    }

    if (!/\bloading\s*=\s*["']lazy["']/i.test(tag)) {
      emit(
        "VID-03",
        location,
        "video iframe without loading=lazy — add lazy or confirm exception",
      );
    }
  });
}
