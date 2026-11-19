import { emit, readExistingFiles, scanHtmlElements } from "../lib/io";

function getAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[2] ?? match?.[3] ?? match?.[4];
}

// A class naming the container itself (`modal`, `cart-drawer`), not one of its parts (`modal-close`,
// `cart-drawer__header`).
const MODAL_CLASS = /^(?:[\w-]+[-_])?(?:modal|dialog|popover|drawer|off-?canvas)$/i;

export function checkModalsDialogs(filePaths: string[]): void {
  const files = readExistingFiles(filePaths);

  scanHtmlElements(files, ({ file, lineNumber, tag }) => {
    const location = `${file.path}:${lineNumber}`;
    const className = getAttribute(tag, "class") ?? "";
    const role = getAttribute(tag, "role") ?? "";
    const isDialogElement = /^<\s*dialog\b/i.test(tag);
    const hasDialogRole = /^dialog$/i.test(role);
    const hasAriaModal = /\baria-modal\s*=\s*["']?true\b/i.test(tag);
    const looksLikeModal = className.split(/\s+/).some((name) => MODAL_CLASS.test(name));

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
