import type { ReactNode } from 'react';

/**
 * Tiny markdown-lite renderer for Zen replies: **bold**, "- "/"* "
 * bullet lists, "1. " numbered lists, and line breaks. Renders to React
 * nodes (no `dangerouslySetInnerHTML`) so text is escaped automatically
 * — no markdown library needed for this small a surface (docs/
 * REVAMP_SPEC.md §6 UI paragraph).
 */

type Block = { kind: 'ul'; items: string[] } | { kind: 'ol'; items: string[] } | { kind: 'p'; lines: string[] };

const BULLET_RE = /^\s*[-*]\s+/;
const NUMBERED_RE = /^\s*\d+[.)]\s+/;

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (BULLET_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) { items.push(lines[i].replace(BULLET_RE, '')); i++; }
      blocks.push({ kind: 'ul', items });
    } else if (NUMBERED_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && NUMBERED_RE.test(lines[i])) { items.push(lines[i].replace(NUMBERED_RE, '')); i++; }
      blocks.push({ kind: 'ol', items });
    } else if (line.trim() === '') {
      i++;
    } else {
      const pLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !BULLET_RE.test(lines[i]) && !NUMBERED_RE.test(lines[i])) {
        pLines.push(lines[i]);
        i++;
      }
      blocks.push({ kind: 'p', lines: pLines });
    }
  }
  return blocks;
}

/** Splits on `**bold**` spans; everything else renders as plain text. */
function renderInline(text: string, keyPrefix: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '');
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
      : <span key={`${keyPrefix}-${i}`}>{part}</span>,
  );
}

export function renderZenMarkdown(text: string): ReactNode {
  return parseBlocks(text).map((block, bi) => {
    if (block.kind === 'ul') {
      return (
        <ul key={bi} className="list-disc pl-4 space-y-0.5 my-1 last:mb-0">
          {block.items.map((item, ii) => <li key={ii}>{renderInline(item, `${bi}-${ii}`)}</li>)}
        </ul>
      );
    }
    if (block.kind === 'ol') {
      return (
        <ol key={bi} className="list-decimal pl-4 space-y-0.5 my-1 last:mb-0">
          {block.items.map((item, ii) => <li key={ii}>{renderInline(item, `${bi}-${ii}`)}</li>)}
        </ol>
      );
    }
    return (
      <p key={bi} className={bi > 0 ? 'mt-2' : undefined}>
        {block.lines.map((line, li) => (
          <span key={li}>
            {renderInline(line, `${bi}-${li}`)}
            {li < block.lines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  });
}
