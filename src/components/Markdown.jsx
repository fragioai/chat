import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.props && node.props.children) return textOf(node.props.children);
  return '';
}

export function CopyButton({ getText, label = 'Kopieren', className = 'btn small ghost' }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(getText());
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      setDone(false);
    }
  }
  return (
    <button type="button" className={className} onClick={copy}>
      {done ? 'Kopiert' : label}
    </button>
  );
}

function Pre({ children }) {
  return (
    <div className="codeblock">
      <div className="codebar">
        <CopyButton getText={() => textOf(children)} className="btn small" />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function Link({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Table({ children }) {
  return (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  );
}

export default function Markdown({ text }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{ pre: Pre, a: Link, table: Table }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
