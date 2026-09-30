# Estudo — cartão com débito automático no Asaas (2026-09-30)

> Pedido do dono: "cartão com débito automático" — estudo primeiro, sem código. Base: documentação oficial do Asaas e
> **testes reais no sandbox** (conta de teste, sem dinheiro) feitos em 2026-09-30, com os dados de teste apagados no fim.

## Resumo em uma frase

**O débito automático no cartão já funciona hoje, sem mudar código**: a nossa assinatura é criada com a forma de pagamento
"indefinida" (o aluno escolhe PIX, boleto ou cartão na fatura), e quando o aluno paga a 1ª fatura **com cartão** o Asaas
**troca a assinatura para "cartão" e guarda o cartão** — as mensalidades seguintes passam a ser cobradas nele sozinhas.
Falta só **avisar isso direito ao aluno** e confirmar um detalhe pela tela de fatura (abaixo).

## Como é hoje no PulseRx

- `AsaasService.createSubscription` cria a assinatura com `billingType: 'UNDEFINED'`, mensal, com split para a carteira do
  coach (`split: [{ walletId, percentualValue }]`). O aluno vai para a fatura (`invoiceUrl`) e escolhe como pagar.
- O webhook (`POST /webhooks/asaas`) reconsulta cada pagamento no Asaas e grava o status (pago / vencido / pendente);
  pago volta a assinatura para ACTIVE, vencido marca PAST_DUE. Não depende da forma de pagamento.

## O que o sandbox mostrou (2026-09-30)

| Teste | Resultado |
|---|---|
| Criar assinatura `CREDIT_CARD` **sem** enviar dados do cartão | Aceita (200). A 1ª cobrança nasce `PENDING`, tipo cartão, com link de fatura. |
| Pagar essa 1ª cobrança com cartão de teste | `CONFIRMED`. A assinatura passa a mostrar o cartão (final e bandeira) e um token do cartão. |
| **Fluxo atual (`UNDEFINED`)**: pagar a 1ª cobrança com cartão | `CONFIRMED`, e a assinatura **muda sozinha para `CREDIT_CARD` com o cartão guardado**. |
| Adiantar a próxima cobrança para o mesmo dia | Cobrança nova criada como `PENDING` — não foi capturada nos segundos seguintes (a captura acontece nas tentativas do dia do vencimento; ver abaixo). |
| Tokenização (`/creditCard/tokenizeCreditCard`) | Funciona no sandbox. **Em produção precisa ser liberada pelo gerente de contas do Asaas.** |

**Limite do teste:** o pagamento foi feito pela API (`payWithCreditCard`), não pela tela da fatura. O esperado é o mesmo
comportamento, mas **não foi visto pela tela**. Conferir: no sandbox, abrir o link da fatura de uma assinatura, pagar com
cartão de teste e ver no painel do Asaas se a assinatura ficou "Cartão de crédito" com o final do cartão. A captura
automática da 2ª mensalidade também só se confirma deixando uma assinatura de teste vencer (dia seguinte).

## O que diz a documentação do Asaas

- Assinatura com cartão: o cartão é validado na criação e **as próximas cobranças usam o mesmo cartão enquanto a
  assinatura estiver ativa**; a validação não garante as cobranças futuras (cartão vence, é bloqueado, fica sem limite).
- Segundo material do próprio Asaas, são feitas **3 tentativas de captura no dia do vencimento, a cada 6 horas**
  (não achei isso na página de referência da API — tratar como informação a confirmar com o Asaas).
- Trocar o cartão da assinatura: `PUT /v3/subscriptions/{id}/creditCard` (com token ou com os dados completos) — não cobra
  na hora e atualiza as cobranças pendentes.
- Mandar dados do cartão pela nossa API exige HTTPS, `remoteIp` do aluno e coloca o PulseRx no escopo de segurança de
  cartão (PCI); a tokenização reduz isso, mas em produção depende de liberação do Asaas.
- Split vale para assinatura (campo `split` na criação) — o nosso já é aplicado a todas as cobranças da assinatura.

## Opções

| | O que é | Prós | Contras |
|---|---|---|---|
| **A (recomendada)** | Manter a fatura do Asaas (`UNDEFINED`) e **deixar claro** que pagar com cartão ativa o débito automático | Zero dado de cartão no PulseRx (fora do escopo PCI); aluno continua podendo usar PIX/boleto; já funciona | Trocar o cartão depende do Asaas (ver abaixo) |
| B | Planos só no cartão (`CREDIT_CARD` sem dados) | Garante recorrência automática em todos | Perde PIX/boleto; mesma tela do Asaas |
| C | Formulário de cartão dentro do PulseRx (checkout transparente) | Experiência sem sair do app | Dados do cartão passam pelo nosso servidor (PCI, HTTPS, IP do aluno), tokenização precisa de liberação, mais risco e mais código — **não recomendado agora** |

## Se escolher A — o que faltaria (1 PR pequeno, depois de decidir)

1. **Avisar o aluno** no passo de pagamento e na tela Assinatura: "Se pagar com cartão, as próximas mensalidades são
   cobradas automaticamente no mesmo cartão. Você pode cancelar quando quiser." — e a mesma frase nos Termos (hoje eles
   já falam de "renovação automática", mas não do cartão guardado). Mudou os Termos → decidir se troca a versão.
2. **Mostrar "Débito automático no cartão final 8829"** na tela Assinatura do aluno (o Asaas devolve só o final e a
   bandeira — nunca o número).
3. **Cartão recusado**: hoje a cobrança fica pendente e, vencida, a assinatura vira PAST_DUE (inadimplente) — o aluno já
   vê a fatura em aberto e pode pagar pelo link. Avaliar um aviso específico ("seu cartão foi recusado, pague pela fatura
   ou troque o cartão").
4. **Trocar o cartão**: sem o PulseRx receber dados de cartão, a saída é o aluno pagar uma fatura em aberto com o cartão
   novo (a confirmar no sandbox se isso troca o cartão guardado) ou pedir ao Asaas/usar o painel. Pesquisar/confirmar
   antes de prometer um botão "trocar cartão".

## Pontos que o estudo levantou (independentes da escolha)

- **Cartão "confirmado" não é dinheiro na conta**: no cartão o status `CONFIRMED` = aprovado; o dinheiro cai depois
  (prazo do cartão no Asaas). O Financeiro trata `CONFIRMED` como pago — está certo para "o aluno pagou", mas o repasse
  real ao coach segue o prazo do Asaas. Vale uma legenda na tela.
- **Estorno e contestação**: status como `REFUNDED` e `CHARGEBACK_*` hoje viram "pendente" no nosso mapeamento
  (`webhooks.service.ts`, `mapStatus`). Com cartão isso fica mais comum — tratar num PR próprio (ex.: status "estornado").
- **Ambiente de teste com cobrança real**: o dono decidiu (2026-09-30) que `aevonfit.aevon.online` é o ambiente de teste
  até a mudança para `pulserx.com.br`, mas ele roda com `ASAAS_ENV=production` (cobrança de verdade). Decidir se o teste
  passa para o sandbox.
- **Taxas do cartão**: não levantadas aqui (dependem do contrato da conta Asaas) — conferir no painel antes de definir
  preço/percentual.

## Fontes

- Criando assinatura com cartão de crédito — https://docs.asaas.com/docs/criando-assinatura-com-cartao-de-credito
- Criar assinatura com cartão de crédito (referência) — https://docs.asaas.com/reference/criar-assinatura-com-cartao-de-credito
- Cobranças via cartão de crédito — https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito
- Atualizar cartão da assinatura — https://docs.asaas.com/reference/atualizar-cartao-de-credito-assinatura
- Tokenização — https://docs.asaas.com/reference/credit-card-tokenization
