import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/**
 * Renders problem statements, constraints and editorials. Raw HTML in the source is never rendered
 * (react-markdown's default), `javascript:` links are stripped, and external links get rel=noopener.
 * Math uses KaTeX (`$x^2$`).
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="pq-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children: kids }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {kids}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
