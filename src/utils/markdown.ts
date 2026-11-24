// Lightweight, resilient Markdown to HTML parser for mod descriptions and changelogs
export function parseMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';

  let html = markdown;

  // Normalize line endings
  html = html.replace(/\r\n/g, '\n');

  // Strip scripts/dangerous elements if any
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Headers: # Title, ## Subtitle, etc.
  html = html.replace(/^###### (.*$)/gim, '<h6 class="text-xs font-semibold text-white/90 mt-4 mb-2">$1</h6>');
  html = html.replace(/^##### (.*$)/gim, '<h5 class="text-xs font-bold text-white/90 mt-4 mb-2">$1</h5>');
  html = html.replace(/^#### (.*$)/gim, '<h4 class="text-sm font-bold text-white mt-4 mb-2">$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3 class="text-sm font-bold text-white mt-5 mb-2">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="text-base font-bold text-white mt-6 mb-3 border-b border-white/10 pb-1.5">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="text-lg font-extrabold text-white mt-6 mb-3 border-b border-white/10 pb-2">$1</h1>');

  // Images: ![alt](url) -> formatted responsive image with caption
  html = html.replace(/!\[(.*?)\]\((.*?)\)/gim, (_match, alt, url) => {
    return `<div class="my-4 rounded-2xl overflow-hidden border border-white/10 bg-black/40 p-1 inline-block max-w-full">
      <img src="${url}" alt="${alt || 'mod screenshot'}" class="max-h-96 w-auto rounded-xl object-contain" loading="lazy" />
      ${alt ? `<p class="text-[10px] text-white/40 text-center py-1 font-mono">${alt}</p>` : ''}
    </div>`;
  });

  // Links: [text](url) -> safe external link with stylish highlight
  html = html.replace(/\[(.*?)\]\((.*?)\)/gim, (_match, text, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition-colors font-medium">${text}</a>`;
  });

  // Bold / Italic
  html = html.replace(/\*\*\*(.*?)\*\*\*/gim, '<strong class="font-bold text-white"><em>$1</em></strong>');
  html = html.replace(/\*\*(.*?)\*\*/gim, '<strong class="font-bold text-white">$1</strong>');
  html = html.replace(/\*(.*?)\*/gim, '<em class="italic text-white/80">$1</em>');

  // Code blocks: ```lang\ncode\n```
  html = html.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/gim, (_match, _lang, code) => {
    return `<pre class="my-3 p-3.5 rounded-xl bg-black/60 border border-white/10 font-mono text-[11px] text-emerald-300 overflow-x-auto leading-relaxed"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
  });

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/gim, '<code class="px-1.5 py-0.5 rounded-md bg-white/10 text-emerald-300 font-mono text-[11px] border border-white/10">$1</code>');

  // Blockquotes: > quote
  html = html.replace(/^\> (.*$)/gim, '<blockquote class="border border-white/10 px-4 my-3 text-xs italic text-white/60 bg-white/[0.03] py-2 rounded-xl">$1</blockquote>');

  // Unordered list items: * or -
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li class="text-xs text-white/70 leading-relaxed ml-4 list-disc">$1</li>');

  // Numbered list items
  html = html.replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li class="text-xs text-white/70 leading-relaxed ml-4 list-decimal">$1</li>');

  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr class="border-white/10 my-6" />');

  // Paragraphs: separate double newlines into styled paragraphs
  const paragraphs = html.split(/\n\s*\n/);
  html = paragraphs
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      // Don't wrap if already a block-level HTML tag
      if (/^<(h[1-6]|div|blockquote|pre|hr|li|ul|ol|table|p)\b/i.test(trimmed)) {
        return trimmed;
      }
      return `<p class="text-xs text-white/70 leading-relaxed my-2">${trimmed.replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');

  return html;
}
