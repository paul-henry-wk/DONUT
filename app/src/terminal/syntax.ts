// ═══════════════════════════════════════════════════════════════════
// terminal/syntax.ts — Syntax highlighting (nabsic + YAML + XML + JSON)
// ═══════════════════════════════════════════════════════════════════

export function syntaxHL(html: string, ext: string): string {
  const e = ext.toLowerCase();
  if (e === 'xml' || e === 'config' || e === 'csproj' || e === 'xaml') return xmlHL(html);
  if (e === 'json') return jsonHL(html);
  // YAML keys (word followed by colon at start or after spaces)
  if (html.match(/^\s*[\w.!$]+:/)) {
    html = html.replace(/^(\s*)([\w.!$]+)(:)/, '$1<span class="sh-key">$2</span>$3');
    return html;
  }
  // Nabsic keywords
  html = html.replace(/\b(Dim|If|Else|ElseIf|End If|Then|New|Set|For|Each|Next|While|Do|Loop|With|End With|WithTrans|Catch|Function|Sub|End Function|End Sub|Return|Not|And|Or|True|False|Nothing|Null|Call|Append|Get|Insert|Split|FillText)\b/g, '<span class="sh-kw">$1</span>');
  // Strings
  html = html.replace(/(&quot;[^&]*?&quot;)/g, '<span class="sh-str">$1</span>');
  // Comments (nabsic uses ')
  html = html.replace(/^(\s*&#39;.*)$/gm, '<span class="sh-cmt">$1</span>');
  // Variables (ending with @ # %)
  html = html.replace(/\b(\w+[@#%])\b/g, '<span class="sh-var">$1</span>');
  // Types/classes (PascalCase before . or #)
  html = html.replace(/\b([A-Z][a-zA-Z]+[#]?)\b(?=[\.(])/g, '<span class="sh-type">$1</span>');
  // Numbers
  html = html.replace(/\b(\d+)\b/g, '<span class="sh-num">$1</span>');
  return html;
}

export function xmlHL(html: string): string {
  // Comments
  html = html.replace(/(&lt;!--.*?--&gt;)/g, '<span class="sh-cmt">$1</span>');
  // Tag names
  html = html.replace(/(&lt;\/?)([\w:.]+)/g, '$1<span class="sh-kw">$2</span>');
  // Attribute names
  html = html.replace(/\b([\w:.-]+)(=&quot;)/g, '<span class="sh-key">$1</span>$2');
  // Attribute values
  html = html.replace(/(=)(&quot;[^&]*?&quot;)/g, '$1<span class="sh-str">$2</span>');
  return html;
}

export function jsonHL(html: string): string {
  // Keys
  html = html.replace(/(&quot;)([\w.$-]+)(&quot;)(\s*:)/g, '<span class="sh-key">$1$2$3</span>$4');
  // String values
  html = html.replace(/(:\s*)(&quot;[^&]*?&quot;)/g, '$1<span class="sh-str">$2</span>');
  // Booleans, null
  html = html.replace(/\b(true|false|null)\b/g, '<span class="sh-kw">$1</span>');
  // Numbers
  html = html.replace(/(:\s*)(-?\d+\.?\d*)/g, '$1<span class="sh-num">$2</span>');
  return html;
}
