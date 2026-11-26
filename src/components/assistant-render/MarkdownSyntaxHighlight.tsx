import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';

/** Render source immediately. Only settled, bounded snippets pay for tokenization. */
export function MarkdownSyntaxHighlight({ language, code, components: { Pre, Code } }: SyntaxHighlighterProps) {
  const [highlight, setHighlight] = useState<{ code: string; language: string; lines: ReactNode }>();
  useEffect(() => {
    if (language === 'unknown' || language === 'text' || code.length > 16_384) return;
    let current = true;
    async function highlightCode() {
      const { getSharedHighlighter, getFiletypeFromFileName } = await import('@pierre/diffs');
      if (!current) return;
      const filetype = getFiletypeFromFileName(`snippet.${language}`);
      const lang = filetype === 'text' ? language : filetype;
      const themes = { light: 'github-light-default', dark: 'github-dark-default' };
      const highlighter = await getSharedHighlighter({ langs: [lang], themes: Object.values(themes) });
      if (!current) return;
      const tokens = highlighter.codeToTokensWithThemes(code, { lang, themes });
      const lines = tokens.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && '\n'}
          {line.map((token, i) => (
            <span key={i} className="markdown-syntax-token" style={{
              '--syntax-light': token.variants.light.color,
              '--syntax-dark': token.variants.dark.color,
            } as CSSProperties}>{token.content}</span>
          ))}
        </Fragment>
      ));
      setHighlight({ code, language, lines });
    }
    // Unknown fence labels and unavailable grammars keep their original source.
    void highlightCode().catch(() => {});
    return () => { current = false; };
  }, [code, language]);
  return <Pre><Code>{highlight?.code === code && highlight.language === language ? highlight.lines : code}</Code></Pre>;
}
