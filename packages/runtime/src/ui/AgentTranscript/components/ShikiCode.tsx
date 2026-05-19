import React, { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';

/**
 * Drop-in replacement for the `<Prism as SyntaxHighlighter>` usage from
 * `react-syntax-highlighter` (the package was flagged in the supply-chain
 * audit -- conorhastings, single maintainer, 138 open issues). Uses shiki,
 * which is already in the dependency tree via @lexical/code-shiki.
 *
 * shiki's `codeToHtml` is async, so we render a plain `<pre><code>` fallback
 * while the highlight resolves. Unknown languages fall back to plain text
 * (shiki rejects unsupported langs; the catch path returns the raw code).
 */

interface ShikiCodeProps {
  code: string;
  language?: string;
  className?: string;
  customStyle?: React.CSSProperties;
  codeTagStyle?: React.CSSProperties;
}

const DEFAULT_THEME = 'github-dark';

// Normalise language names that react-syntax-highlighter accepted but shiki
// either spells differently or doesn't ship in the default bundle. Anything
// not in this map is passed through; shiki will fall back to plain text for
// unknown languages.
const LANG_ALIASES: Record<string, string> = {
  text: 'text',
  txt: 'text',
  plaintext: 'text',
  docker: 'dockerfile',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
};

function normaliseLang(language: string | undefined): string {
  if (!language) return 'text';
  const lower = language.toLowerCase();
  return LANG_ALIASES[lower] || lower;
}

export const ShikiCode: React.FC<ShikiCodeProps> = ({
  code,
  language,
  className,
  customStyle,
  codeTagStyle,
}) => {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const lang = normaliseLang(language);
    codeToHtml(code, { lang: lang as any, theme: DEFAULT_THEME })
      .then((h) => { if (active) setHtml(h); })
      .catch(() => { if (active) setHtml(null); });
    return () => { active = false; };
  }, [code, language]);

  // Loading / unsupported language: plain `<pre><code>` matches the visual
  // shape callers expect from the previous library.
  if (html === null) {
    return (
      <div className={className} style={customStyle}>
        <pre style={{ margin: 0, background: 'none' }}>
          <code style={codeTagStyle}>{code}</code>
        </pre>
      </div>
    );
  }

  // shiki returns a <pre><code> tree pre-styled by the chosen theme. Wrap in
  // a div so callers' customStyle (background, padding, margin) still applies.
  return (
    <div
      className={className}
      style={customStyle}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
