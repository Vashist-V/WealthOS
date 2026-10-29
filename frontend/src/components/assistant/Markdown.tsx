/**
 * An assistant's answer, drawn from Markdown: paragraphs, bold, lists, small
 * headings, tables of figures and links to sources.
 *
 * Raw HTML in an answer is never rendered (react-markdown escapes it), and
 * unsafe link schemes are dropped, so text a model picked up from a web page
 * cannot run in the app.
 */
import { ArrowUpRight } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

/** The plain text inside a parsed element. */
function textOf(node: Node | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

const components: Components = {
  p: ({ node: _node, ...props }) => <p {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-ink" {...props} />,
  em: ({ node: _node, ...props }) => <em className="text-ink" {...props} />,
  h1: ({ node: _node, ...props }) => <h3 className="pt-1 text-[14px] font-semibold text-ink" {...props} />,
  h2: ({ node: _node, ...props }) => <h3 className="pt-1 text-[14px] font-semibold text-ink" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="pt-1 text-[14px] font-semibold text-ink" {...props} />,
  h4: ({ node: _node, ...props }) => <h4 className="text-[13.5px] font-semibold text-ink" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-muted" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="flex list-decimal flex-col gap-1.5 pl-5 marker:text-muted" {...props} />,
  li: ({ node: _node, ...props }) => <li className="pl-0.5 [&>ul]:mt-1.5" {...props} />,
  hr: () => <hr className="border-line" />,
  blockquote: ({ node: _node, ...props }) => <blockquote className="border-l-2 border-line-strong pl-3 text-muted" {...props} />,
  code: ({ node: _node, ...props }) => <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-ink" {...props} />,
  pre: ({ node: _node, ...props }) => <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-[12px]" {...props} />,
  table: ({ node: _node, ...props }) => (
    // Wide tables scroll sideways inside their own box, so the panel never does.
    <div className="max-w-full overflow-x-auto rounded-xl ring-1 ring-inset ring-line">
      <table className="w-full border-collapse text-left text-[12.5px] leading-snug tabular-nums" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="bg-surface-2" {...props} />,
  th: ({ node: _node, ...props }) => <th className="whitespace-nowrap px-3 py-2 font-semibold text-ink first:pl-3.5" {...props} />,
  td: ({ node, ...props }) => (
    <td
      className={cn(
        "border-t border-line px-3 py-2 align-top text-ink-2 first:pl-3.5 first:font-medium first:text-ink",
        // A short figure such as "₹4.64 L cr" reads badly broken over two lines; longer text may wrap.
        textOf(node).length <= 16 && "whitespace-nowrap",
      )}
      {...props}
    />
  ),
  a: ({ node: _node, href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href ? host(href) : undefined}
      className="inline-flex items-baseline gap-0.5 rounded-md bg-accent-soft px-1.5 text-[12px] font-medium text-accent no-underline ring-1 ring-inset ring-accent/15 transition-colors hover:bg-accent hover:text-on-accent"
      {...props}
    >
      {children}
      <ArrowUpRight className="size-3 shrink-0 self-center" aria-hidden />
    </a>
  ),
};

/** An answer in Markdown. Keeps the name the chat and the trade check already use. */
export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5 text-[13.5px] leading-relaxed text-ink-2 [overflow-wrap:break-word]", className)}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
