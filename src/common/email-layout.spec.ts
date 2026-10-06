import { renderEmail } from './email-layout';

describe('renderEmail — modelo dos e-mails do PulseRx', () => {
  const base = {
    preheader: 'Falta pouco',
    title: 'Crie sua senha',
    greetingName: 'Ana',
    paragraphs: ['Primeiro parágrafo.', 'Segundo parágrafo.'],
    cta: { label: 'Criar minha senha', url: 'https://pulserx.com.br/redefinir-senha#token=abc&x=1' },
    note: 'O link vale 7 dias.',
  };

  it('monta marca, título, saudação, parágrafos, botão com link por extenso, nota e rodapé', () => {
    const { html, text } = renderEmail(base);
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain('>PULSE</span>');
    expect(html).toContain('>RX</span>');
    expect(html).toContain('Falta pouco');
    expect(html).toContain('>Crie sua senha</h1>');
    expect(html).toContain('Olá, Ana.');
    expect(html).toContain('Primeiro parágrafo.');
    expect(html).toContain('href="https://pulserx.com.br/redefinir-senha#token=abc&amp;x=1"');
    expect(html).toContain('>Criar minha senha</a>');
    expect(html).toContain('Se o botão não abrir');
    expect(html).toContain('O link vale 7 dias.');
    expect(html).toContain('não responda');

    expect(text).toContain('Crie sua senha\n\nOlá, Ana.\n\nPrimeiro parágrafo.');
    expect(text).toContain('Criar minha senha: https://pulserx.com.br/redefinir-senha#token=abc&x=1');
    expect(text).toContain('O link vale 7 dias.');
    expect(text).not.toContain('<');
  });

  it('todo texto vindo de usuário é escapado (nome, parágrafo, quadro, título, botão)', () => {
    const xss = '<script>alert(1)</script>';
    const { html } = renderEmail({
      preheader: xss, title: xss, greetingName: xss, paragraphs: [xss],
      details: [{ label: xss, value: '<img src=x onerror=alert(1)>' }],
      cta: { label: xss, url: 'https://pulserx.com.br/"><script>' }, note: xss,
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://pulserx.com.br/&quot;&gt;&lt;script&gt;"');
  });

  it('link que não é http(s) nunca vira botão (nem no texto)', () => {
    const { html, text } = renderEmail({ ...base, cta: { label: 'Clique', url: 'javascript:alert(1)' } });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Se o botão não abrir');
    expect(text).not.toContain('javascript:');
  });

  it('partes opcionais: sem saudação, botão, quadro e nota, não aparecem', () => {
    const { html, text } = renderEmail({ preheader: 'p', title: 'T', paragraphs: ['Só isto.'] });
    expect(html).not.toContain('Olá,');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('border-top:1px');
    expect(text).toBe('T\n\nSó isto.\n\n—\nPulseRx · plataforma da AEVON SOFTWARE. Este é um e-mail automático, não responda.');
  });

  it('quadro de detalhes: rótulo e valor no HTML e no texto', () => {
    const { html, text } = renderEmail({
      preheader: 'p', title: 'Novo contato', paragraphs: ['x'],
      details: [{ label: 'Nome', value: 'Bia' }, { label: 'E-mail', value: 'bia@example.com' }],
    });
    expect(html).toContain('>Nome</td>');
    expect(html).toContain('>bia@example.com</td>');
    expect(text).toContain('Nome: Bia\nE-mail: bia@example.com');
  });
});
