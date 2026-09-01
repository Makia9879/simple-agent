// Deliberately small allow-list renderer: no links, HTML, attributes, or script-capable protocols.
const escape = (value:string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export function safeMarkdown(value:string):string {
  const escaped = escape(value);
  const blocks = escaped.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  return blocks.split(/\n{2,}/).map(part => part.startsWith('<pre>') ? part : `<p>${part.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\n/g, '<br>')}</p>`).join('');
}
