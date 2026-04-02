import { describe, it, expect } from 'vitest';
import { syntaxHL, xmlHL, jsonHL } from '../terminal/syntax';

describe('syntaxHL', () => {
  it('highlights nabsic keywords', () => {
    const result = syntaxHL('Dim x', 'nabsic');
    expect(result).toContain('<span class="sh-kw">Dim</span>');
  });

  it('highlights multiple nabsic keywords in one line', () => {
    const result = syntaxHL('If x Then Return', 'nabsic');
    expect(result).toContain('<span class="sh-kw">If</span>');
    expect(result).toContain('<span class="sh-kw">Then</span>');
    expect(result).toContain('<span class="sh-kw">Return</span>');
  });

  it('highlights nabsic variables ending with @ # %', () => {
    // The regex \b(\w+[@#%])\b requires a word boundary after the symbol,
    // which means a word character must follow (e.g. myVar@next)
    const result = syntaxHL('Set x = myVar@next', 'nabsic');
    expect(result).toContain('<span class="sh-var">myVar@</span>');
  });

  it('highlights numbers in nabsic code', () => {
    const result = syntaxHL('x = 42', 'nabsic');
    expect(result).toContain('<span class="sh-num">42</span>');
  });

  it('delegates to xmlHL for xml extension', () => {
    const result = syntaxHL('&lt;root&gt;', 'xml');
    expect(result).toContain('<span class="sh-kw">root</span>');
  });

  it('delegates to xmlHL for config extension', () => {
    const result = syntaxHL('&lt;setting&gt;', 'config');
    expect(result).toContain('<span class="sh-kw">setting</span>');
  });

  it('delegates to xmlHL for csproj extension', () => {
    const result = syntaxHL('&lt;Project&gt;', 'csproj');
    expect(result).toContain('<span class="sh-kw">Project</span>');
  });

  it('delegates to jsonHL for json extension', () => {
    const result = syntaxHL('&quot;key&quot;: &quot;value&quot;', 'json');
    expect(result).toContain('<span class="sh-key">');
  });

  it('highlights YAML keys', () => {
    const result = syntaxHL('name: value', 'yaml');
    expect(result).toContain('<span class="sh-key">name</span>');
  });

  it('is case-insensitive on extension', () => {
    const result = syntaxHL('&lt;root&gt;', 'XML');
    expect(result).toContain('<span class="sh-kw">root</span>');
  });
});

describe('xmlHL', () => {
  it('highlights tag names', () => {
    const result = xmlHL('&lt;div&gt;');
    expect(result).toContain('<span class="sh-kw">div</span>');
  });

  it('highlights closing tag names', () => {
    const result = xmlHL('&lt;/div&gt;');
    expect(result).toContain('<span class="sh-kw">div</span>');
  });

  it('highlights attribute names and values', () => {
    const result = xmlHL('&lt;el attr=&quot;val&quot;&gt;');
    expect(result).toContain('<span class="sh-key">attr</span>');
    expect(result).toContain('<span class="sh-str">&quot;val&quot;</span>');
  });

  it('highlights XML comments', () => {
    const result = xmlHL('&lt;!-- comment --&gt;');
    expect(result).toContain('<span class="sh-cmt">');
  });
});

describe('jsonHL', () => {
  it('highlights JSON keys', () => {
    const result = jsonHL('&quot;name&quot;: &quot;test&quot;');
    expect(result).toContain('<span class="sh-key">&quot;name&quot;</span>');
  });

  it('highlights JSON string values', () => {
    const result = jsonHL('&quot;key&quot;: &quot;hello&quot;');
    expect(result).toContain('<span class="sh-str">&quot;hello&quot;</span>');
  });

  it('highlights booleans and null', () => {
    const result = jsonHL('&quot;ok&quot;: true');
    expect(result).toContain('<span class="sh-kw">true</span>');

    const result2 = jsonHL('&quot;v&quot;: null');
    expect(result2).toContain('<span class="sh-kw">null</span>');
  });

  it('highlights numbers after colon', () => {
    const result = jsonHL('&quot;count&quot;: 42');
    expect(result).toContain('<span class="sh-num">42</span>');
  });
});
