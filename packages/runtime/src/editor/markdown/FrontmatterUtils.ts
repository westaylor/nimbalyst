/**
 * Frontmatter utilities for managing metadata in Lexical documents.
 * Provides functions to parse and serialize frontmatter while storing it
 * in the Lexical root node's NodeState.
 *
 * Parsing is implemented inline against `js-yaml` (already a dependency) so
 * we don't pull in jxson/front-matter or gray-matter -- both had supply-chain
 * concerns (stale / Buffer-dependent in the browser).
 */

import * as yaml from 'js-yaml';
import { $getRoot, $getState, $setState, createState } from 'lexical';

export interface FrontmatterData {
  [key: string]: any;
}

/**
 * Create a state configuration for frontmatter storage.
 * This properly integrates with Lexical's state management system.
 */
const frontmatterState = createState('frontmatter', {
  parse: (value: unknown): FrontmatterData | null => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as FrontmatterData;
    }
    return null;
  }
});

/**
 * Stores frontmatter data in the root node's NodeState.
 */
export function $setFrontmatter(data: FrontmatterData | null): void {
  const root = $getRoot();
  $setState(root, frontmatterState, data);
}

/**
 * Retrieves frontmatter data from the root node's NodeState.
 */
export function $getFrontmatter(): FrontmatterData | null {
  const root = $getRoot();
  return $getState(root, frontmatterState);
}

interface SplitFrontmatter {
  body: string;
  attributes: FrontmatterData | null;
  frontmatter: string;
}

/**
 * Split a markdown string into its YAML frontmatter block and body.
 * Matches the `---\n...\n---\n` convention used by jxson/front-matter and
 * gray-matter. Returns the entire string as body when the opening `---` is
 * absent or no closing `---` is found.
 */
function splitFrontmatter(markdown: string): SplitFrontmatter {
  // Opening fence: must be at start of file, exactly `---` on its own line.
  const openMatch = markdown.match(/^---\r?\n/);
  if (!openMatch) {
    return { body: markdown, attributes: null, frontmatter: '' };
  }
  const restStart = openMatch[0].length;
  // Closing fence: `---` on its own line, preceded by a newline.
  const closeMatch = markdown.slice(restStart).match(/(\r?\n)---(\r?\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    return { body: markdown, attributes: null, frontmatter: '' };
  }
  const frontmatterText = markdown.slice(restStart, restStart + closeMatch.index);
  const bodyStart = restStart + closeMatch.index + closeMatch[0].length;
  const body = markdown.slice(bodyStart);
  let attributes: FrontmatterData | null = null;
  try {
    const parsed = yaml.load(frontmatterText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      attributes = parsed as FrontmatterData;
    }
  } catch {
    // YAML parse failed - leave attributes null; caller's fallback path runs.
  }
  return { body, attributes, frontmatter: frontmatterText };
}

/**
 * Parses markdown content with optional frontmatter.
 * Returns the content without frontmatter and the parsed frontmatter data.
 */
export function parseFrontmatter(markdown: string): {
  content: string;
  data: FrontmatterData | null;
  orig?: string;
} {
  const split = splitFrontmatter(markdown);
  const hasFrontmatterBlock = split.frontmatter.trim().length > 0;

  if (hasFrontmatterBlock && split.attributes && Object.keys(split.attributes).length > 0) {
    return {
      content: split.body,
      data: split.attributes,
      orig: markdown,
    };
  }

  // Fallback: yaml.load threw or returned non-object, but the fences look
  // present. Parse line-by-line to extract whatever we can. Mirrors the
  // previous front-matter catch path.
  if (markdown.startsWith('---\n')) {
    const endIndex = markdown.indexOf('\n---\n', 4);
    if (endIndex !== -1) {
      const frontmatterText = markdown.substring(4, endIndex);
      const content = markdown.substring(endIndex + 5);

      const data: FrontmatterData = {};
      const lines = frontmatterText.split('\n');

      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const valueStr = line.substring(colonIndex + 1).trim();

          if (key && !key.includes(' ')) {
            let value: any = valueStr;

            if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
                (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
              value = valueStr.slice(1, -1);
            } else if (valueStr === 'true') {
              value = true;
            } else if (valueStr === 'false') {
              value = false;
            } else if (valueStr === 'null' || valueStr === '') {
              value = null;
            } else if (/^-?\d+$/.test(valueStr)) {
              value = parseInt(valueStr, 10);
            } else if (/^-?\d+\.\d+$/.test(valueStr)) {
              value = parseFloat(valueStr);
            }

            data[key] = value;
          }
        }
      }

      if (Object.keys(data).length > 0) {
        console.warn('Partially parsed malformed frontmatter. Extracted:', data);
        return {
          content,
          data,
          orig: markdown,
        };
      }
    }
  }

  if (hasFrontmatterBlock) {
    // We found a frontmatter block but couldn't parse anything useful.
    return {
      content: split.body,
      data: null,
      orig: markdown,
    };
  }

  return {
    content: markdown,
    data: null,
  };
}

/**
 * Serializes content with optional frontmatter.
 * If frontmatter data is provided, it will be added to the beginning of the content.
 */
export function serializeWithFrontmatter(
  content: string,
  data: FrontmatterData | null
): string {
  if (!data || Object.keys(data).length === 0) {
    return content;
  }

  try {
    const yamlStr = yaml.dump(data, {
      lineWidth: -1,
      sortKeys: false,
      quotingType: '"',
      forceQuotes: false,
    });
    const trimmedYaml = yamlStr.trimEnd();
    const contentPrefix = content.startsWith('\n') ? '' : '\n';
    return `---\n${trimmedYaml}\n---${contentPrefix}${content}`;
  } catch (error) {
    console.warn('Failed to serialize frontmatter:', error);
    return content;
  }
}

/**
 * Checks if a markdown string contains frontmatter.
 */
export function hasFrontmatter(markdown: string): boolean {
  return /^---\s*\n/.test(markdown);
}

/**
 * Validates frontmatter data structure.
 */
export function isValidFrontmatter(data: any): data is FrontmatterData {
  return (
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Object.getPrototypeOf(data) === Object.prototype
  );
}
