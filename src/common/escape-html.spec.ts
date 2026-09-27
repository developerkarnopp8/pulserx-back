import { escapeHtml } from './escape-html';

describe('escapeHtml', () => {
  it('escapa &, <, >, aspas duplas e aspas simples', () => {
    expect(escapeHtml('& < > " \'')).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it('neutraliza uma tentativa de injeção de script', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('texto sem caracteres especiais fica igual', () => {
    expect(escapeHtml('Ana Paula Silva')).toBe('Ana Paula Silva');
  });
});
