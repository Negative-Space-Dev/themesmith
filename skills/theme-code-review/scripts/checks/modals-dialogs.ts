import { emit, readExistingFiles, scanHtmlElements } from "../lib/io";

function getAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[2] ?? match?.[3] ?? match?.[4];
}

export function checkModalsDialogs(filePaths: string[]): void {
  const files = readExistingFiles(filePaths);

  scanHtmlElements(files, ({ file, lineNumber, tag }) => {
    const location = `${file.path}:${lineNumber}`;
    const className = getAttribute(tag, "class") ?? "";
    const role = getAttribute(tag, "role") ?? "";
    const isDialogElement = /^<\s*dialog\b/i.test(tag);
    const hasDialogRole = /^dialog$/i.test(role);
    const hasAriaModal = /\baria-modal\s*=\s*["']?true\b/i.test(tag);
    const looksLikeModal =
      /\b(modal|dialog|popover)\b/i.test(className) ||
      /\b(drawer|off-?canvas)\b/i.test(className);

    if (looksLikeModal && !isDialogElement && !hasDialogRole) {
      emit("MODAL-01", location, 'modal container without <dialog>/role="dialog"');
    }

    if (isDialogElement || hasDialogRole || hasAriaModal) {
      if (!/\baria-label\s*=/i.test(tag) && !/\baria-labelledby\s*=/i.test(tag)) {
        emit("MODAL-02", location, "dialog without aria-label/aria-labelledby");
      }
    }
  });
}
