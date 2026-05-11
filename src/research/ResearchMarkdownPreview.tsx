import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import 'highlight.js/styles/github.css'
import 'katex/dist/katex.min.css'

export type ResearchMarkdownPreviewProps = {
  markdown: string
}

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined
  const t = href.trim()
  const lower = t.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) return undefined
  if (t.startsWith('#')) return t
  if (t.startsWith('/') && !t.startsWith('//')) return t
  if (/^https?:\/\//i.test(t)) return t
  return undefined
}

const markdownComponents: Components = {
  a({ href, children, ...rest }) {
    const h = safeHref(typeof href === 'string' ? href : undefined)
    if (!h) {
      return <span className="ro-md-preview-muted">{children}</span>
    }
    const external = /^https?:\/\//i.test(h)
    return (
      <a href={h} {...rest} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    )
  },
}

export default function ResearchMarkdownPreview({ markdown }: ResearchMarkdownPreviewProps) {
  const trimmed = markdown.trim()
  if (!trimmed) {
    return <p className="ro-md-preview-empty muted">Nothing to preview yet.</p>
  }

  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[
        [rehypeKatex, { strict: false, throwOnError: false }],
        rehypeHighlight,
      ]}
      components={markdownComponents}
    >
      {markdown}
    </ReactMarkdown>
  )
}
