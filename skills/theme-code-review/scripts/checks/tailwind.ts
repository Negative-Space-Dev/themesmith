import { emit, readExistingFiles, scanHtmlElements } from "../lib/io";

const ARBITRARY_UTILITY =
  /^!?-?(?:[a-z]+(?:-[a-z]+)*)?-?\[[^\]]+\]/i;

const COLOR_UTILITY_PREFIX =
  /^(?:bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|accent|caret|shadow|divide|placeholder)(?:-|\[)/i;

const ARBITRARY_COLOR_VALUE =
  /^(?:#|rgb|hsl|oklch|lab|lch|color\()/i;

const ACCEPTABLE_ARBITRARY = [
  /^content-\[''\]$/i,
  /^content-\[""\]$/i,
  /\[var\(--/i,
];

function extractClassTokens(text: string): string[] {
  const tokens: string[] = [];

  for (const match of text.matchAll(
    /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\{`([^`]*)`\}|\{"([^"]*)"\}|\{'([^']*)'\})/gi,
  )) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6];
    if (value) {
      tokens.push(...value.split(/\s+/).filter(Boolean));
    }
  }

  for (const match of text.matchAll(/@apply\s+([^;]+)/gi)) {
    tokens.push(...match[1].split(/\s+/).filter(Boolean));
  }

  return tokens;
}

function getArbitraryValue(token: string): string | undefined {
  const match = token.match(/\[([^\]]+)\]/i);
  return match?.[1];
}

function isAcceptableArbitrary(token: string): boolean {
  return ACCEPTABLE_ARBITRARY.some((pattern) => pattern.test(token));
}

function isArbitraryUtility(token: string): boolean {
  if (!ARBITRARY_UTILITY.test(token)) {
    return false;
  }

  return !isAcceptableArbitrary(token);
}

function isArbitraryColorUtility(token: string): boolean {
  if (!isArbitraryUtility(token) || !COLOR_UTILITY_PREFIX.test(token)) {
    return false;
  }

  const value = getArbitraryValue(token);
  if (!value) {
    return false;
  }

  return ARBITRARY_COLOR_VALUE.test(value.trim());
}

export function checkTailwind(filePaths: string[]): void {
  const files = readExistingFiles(filePaths);
  const reported = new Set<string>();

  function reportLine(location: string, tokens: string[]): void {
    for (const token of tokens) {
      const key = `${location}\t${token}`;
      if (reported.has(key)) {
        continue;
      }

      if (isArbitraryColorUtility(token)) {
        reported.add(key);
        emit("TW-03", location, `arbitrary color utility ${token}`);
        continue;
      }

      if (isArbitraryUtility(token)) {
        reported.add(key);
        emit("TW-01", location, `arbitrary utility ${token}`);
      }
    }
  }

  for (const file of files) {
    file.lines.forEach((line, index) => {
      const location = `${file.path}:${index + 1}`;
      const tokens = extractClassTokens(line);

      if (tokens.length > 0) {
        reportLine(location, tokens);
      }
    });
  }

  scanHtmlElements(files, ({ file, lineNumber, tag }) => {
    const location = `${file.path}:${lineNumber}`;
    const classMatch = tag.match(/\bclass\s*=\s*("([^"]*)"|'([^']*)')/i);
    const classValue = classMatch?.[2] ?? classMatch?.[3];

    if (!classValue) {
      return;
    }

    reportLine(location, classValue.split(/\s+/).filter(Boolean));
  });
}
