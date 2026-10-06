import { escapeHtml } from './escape-html';

/**
 * Conteúdo de um e-mail do PulseRx. Tudo aqui é TEXTO PURO — o modelo escapa cada campo antes de montar o HTML, então quem
 * chama nunca interpola HTML (nome, mensagem e e-mail digitados por usuário chegam aqui como vieram).
 */
export interface EmailContent {
  /** Linha que aparece ao lado do assunto na caixa de entrada (fica escondida no corpo). */
  preheader: string;
  title: string;
  /** "Olá, Fulano." no topo do texto; sem nome, não aparece. */
  greetingName?: string;
  paragraphs: string[];
  /** Botão principal. Só aceita http(s) — qualquer outra coisa fica de fora. */
  cta?: { label: string; url: string };
  /** Pares "rótulo: valor" num quadro (ex.: dados de um contato). */
  details?: { label: string; value: string }[];
  /** Observação em letra menor depois do botão (validade do link, "se não foi você…"). */
  note?: string;
}

/** Cores da marca (as mesmas do app). E-mail não lê CSS externo: tudo vai inline. */
const COR = {
  fundo: '#F2F2F2',
  topo: '#0D0D0D',
  laranja: '#FF6B00',
  cartao: '#FFFFFF',
  texto: '#1A1A1A',
  textoSuave: '#5C5C5C',
  borda: '#E6E6E6',
  quadro: '#F7F7F7',
} as const;
const FONTE = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

function safeUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Monta o HTML (tabelas e estilos inline — compatível com Gmail/Outlook/celular) e a versão só texto. */
export function renderEmail(c: EmailContent): { html: string; text: string } {
  const url = c.cta ? safeUrl(c.cta.url) : null;
  const p = (texto: string) =>
    `<p style="margin:0 0 16px;font-family:${FONTE};font-size:16px;line-height:24px;color:${COR.texto};">${escapeHtml(texto)}</p>`;

  const saudacao = c.greetingName ? p(`Olá, ${c.greetingName}.`) : '';
  const paragrafos = c.paragraphs.map(p).join('');
  const quadro = c.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:${COR.quadro};border:1px solid ${COR.borda};border-radius:8px;">` +
      c.details
        .map(
          d =>
            `<tr><td style="padding:10px 16px;font-family:${FONTE};font-size:13px;color:${COR.textoSuave};width:110px;vertical-align:top;">${escapeHtml(d.label)}</td>` +
            `<td style="padding:10px 16px;font-family:${FONTE};font-size:15px;color:${COR.texto};word-break:break-word;">${escapeHtml(d.value)}</td></tr>`,
        )
        .join('') +
      '</table>'
    : '';
  const botao = url && c.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>` +
      `<td style="border-radius:8px;background:${COR.laranja};">` +
      `<a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONTE};font-size:15px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase;color:${COR.topo};text-decoration:none;border-radius:8px;">${escapeHtml(c.cta.label)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 16px;font-family:${FONTE};font-size:12px;line-height:18px;color:${COR.textoSuave};">Se o botão não abrir, copie e cole este endereço no navegador:<br>` +
      `<a href="${escapeHtml(url)}" target="_blank" style="color:${COR.laranja};word-break:break-all;">${escapeHtml(url)}</a></p>`
    : '';
  const nota = c.note
    ? `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid ${COR.borda};font-family:${FONTE};font-size:13px;line-height:20px;color:${COR.textoSuave};">${escapeHtml(c.note)}</p>`
    : '';

  const html =
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>${escapeHtml(c.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${COR.fundo};">` +
    // Texto da prévia na caixa de entrada — escondido no corpo.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(c.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR.fundo};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">` +
    // Topo da marca
    `<tr><td style="background:${COR.topo};border-radius:12px 12px 0 0;padding:22px 28px;">` +
    `<span style="font-family:${FONTE};font-size:22px;font-weight:900;letter-spacing:1px;color:#FFFFFF;">PULSE</span>` +
    `<span style="font-family:${FONTE};font-size:22px;font-weight:900;letter-spacing:1px;color:${COR.laranja};">RX</span>` +
    `</td></tr>` +
    `<tr><td style="background:${COR.laranja};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>` +
    // Cartão
    `<tr><td style="background:${COR.cartao};border-radius:0 0 12px 12px;padding:32px 28px;">` +
    `<h1 style="margin:0 0 20px;font-family:${FONTE};font-size:22px;line-height:28px;font-weight:bold;color:${COR.texto};">${escapeHtml(c.title)}</h1>` +
    saudacao + paragrafos + quadro + botao + nota +
    `</td></tr>` +
    // Rodapé
    `<tr><td style="padding:20px 28px;font-family:${FONTE};font-size:12px;line-height:18px;color:${COR.textoSuave};text-align:center;">` +
    `PulseRx · plataforma da AEVON SOFTWARE<br>Este é um e-mail automático, não responda.` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`;

  const text = [
    c.title,
    '',
    ...(c.greetingName ? [`Olá, ${c.greetingName}.`, ''] : []),
    ...c.paragraphs.flatMap(par => [par, '']),
    ...(c.details?.length ? [...c.details.map(d => `${d.label}: ${d.value}`), ''] : []),
    ...(url && c.cta ? [`${c.cta.label}: ${url}`, ''] : []),
    ...(c.note ? [c.note, ''] : []),
    '—',
    'PulseRx · plataforma da AEVON SOFTWARE. Este é um e-mail automático, não responda.',
  ].join('\n');

  return { html, text };
}
