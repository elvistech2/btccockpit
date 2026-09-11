// DETECTOR DE ESTADO: acumulacao ou distribuicao.
// A ideia e velha (Wyckoff): antes de uma alta alguem compra devagar de quem esta
// desistindo; antes de uma queda alguem vende devagar pra quem esta animado. Nao da
// pra ver isso num indicador so - o que da pra fazer e cruzar sinais que costumam
// aparecer juntos em cada caso e mostrar CADA voto em texto, sem caixa preta.
//
// Nada aqui e previsao. E leitura do que ja aconteceu no periodo escolhido.
const fs = require('fs');
const path = require('path');
const FLUXOS = require('./fluxos');
const OI = require('./oi');
const CAMINHOS = require('./paths');

const DATA = CAMINHOS.DATA;
const HIST_FILE = path.join(DATA, 'history.jsonl');
const BIN = 'https://fapi.binance.com';

async function jget(url) {
  const c = new AbortController();
  const to = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}
const klines = async (intervalo, limite) => (await jget(`${BIN}/fapi/v1/klines?symbol=BTCUSDT&interval=${intervalo}&limit=${limite}`))
  .map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], compradoBase: +k[9] }));

function lerHistorico(horas) {
  if (!fs.existsSync(HIST_FILE)) return [];
  const corte = Date.now() - horas * 3.6e6;
  return fs.readFileSync(HIST_FILE, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(r => r && r.t >= corte);
}
const media = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// inclinacao da regressao linear em % do preco por dia: diz se a faixa e mesmo lateral
function inclinacao(velas) {
  const n = velas.length;
  if (n < 6) return 0;
  const mx = (n - 1) / 2;
  const my = media(velas.map(v => v.c));
  let num = 0, den = 0;
  velas.forEach((v, i) => { num += (i - mx) * (v.c - my); den += (i - mx) ** 2; });
  const porVela = den ? num / den : 0;
  const porDia = porVela * (864e5 / (velas[1].t - velas[0].t));
  return (porDia / my) * 100;
}
function atrPct(velas, n = 14) {
  const p = velas.slice(-(n + 1));
  if (p.length < 3) return null;
  let soma = 0;
  for (let i = 1; i < p.length; i++) {
    soma += Math.max(p[i].h - p[i].l, Math.abs(p[i].h - p[i - 1].c), Math.abs(p[i].l - p[i - 1].c));
  }
  return (soma / (p.length - 1)) / p.at(-1).c * 100;
}

async function ler(nDias = 14) {
  const velas4h = await klines('4h', Math.min(500, Math.ceil(nDias * 6) + 60));
  const velas1d = await klines('1d', 120);
  const janela = velas4h.slice(-Math.ceil(nDias * 6));
  const preco = velas4h.at(-1).c;

  /* ---------- contexto: em que fase o preco esta ---------- */
  const incl = inclinacao(janela);                                  // % por dia
  const max = Math.max(...janela.map(v => v.h)), min = Math.min(...janela.map(v => v.l));
  const larguraFaixa = (max - min) / ((max + min) / 2) * 100;        // % de amplitude
  const posicaoFaixa = (preco - min) / ((max - min) || 1) * 100;
  const atrAgora = atrPct(velas4h), atrAntes = atrPct(velas4h.slice(0, -Math.ceil(nDias * 6)) || []);
  const compressao = atrAgora != null && atrAntes ? (atrAgora / atrAntes - 1) * 100 : null;
  const fase = Math.abs(incl) < 0.25 ? 'faixa lateral' : incl > 0 ? 'tendência de alta' : 'tendência de baixa';

  /* ---------- dados de fluxo ---------- */
  const hist = lerHistorico(nDias * 24);
  const histOk = hist.length > 30;
  const dOI = histOk ? OI.variacaoTrecho(hist) : null;   // mesmas corretoras no inicio e no fim
  const precoIni = janela[0].c;
  const dPreco = (preco / precoIni - 1) * 100;
  const fundingMedio = histOk ? media(hist.map(r => r.funding).filter(x => isFinite(x))) * 100 : null;

  const [etf, fita] = [
    await FLUXOS.etfs(nDias).catch(() => null),
    FLUXOS.fita(nDias)
  ];
  const etfBtc = etf && etf.btc && !etf.btc.erro ? etf.btc : null;
  const faixa = id => (fita.faixas || []).find(f => f.id === id) || {};
  const grandes = (faixa('grande').liquido || 0) + (faixa('baleia').liquido || 0);
  const miudos = (faixa('varejo').liquido || 0) + (faixa('medio').liquido || 0);
  const brutoFita = (fita.faixas || []).reduce((s, f) => s + f.compra + f.venda, 0);
  const temFita = brutoFita > 0;

  // volume comprado a mercado no periodo, direto das velas: nao depende da fita local
  const compradoUSD = janela.reduce((s, v) => s + v.compradoBase * v.c, 0);
  const totalUSD = janela.reduce((s, v) => s + v.v * v.c, 0);
  const desequilibrio = totalUSD ? (compradoUSD * 2 - totalUSD) / totalUSD : 0;   // -1 a +1

  /* ---------- votos ---------- */
  // Cada voto vai de -1 (cheiro de distribuicao) a +1 (cheiro de acumulacao).
  const votos = [];
  const add = (nome, voto, peso, leitura, oq) => votos.push({ nome, voto: +clamp(voto, -1, 1).toFixed(2), peso, leitura, oq });

  add('agressão no mercado', clamp(desequilibrio * 6, -1, 1), .2,
    `${(desequilibrio * 100).toFixed(1)}% de desequilíbrio a favor de quem ${desequilibrio >= 0 ? 'compra' : 'vende'} a mercado`,
    'quem tem pressa aparece aqui: compra a mercado menos venda a mercado, direto das velas');

  if (etfBtc) {
    const soma = etfBtc.periodo.soma;
    const rel = etfBtc.patrimonio ? soma / etfBtc.patrimonio * 100 : 0;
    add('dinheiro dos fundos', clamp(rel * 8, -1, 1), .2,
      `${soma >= 0 ? '+' : '-'}$${Math.abs(soma / 1e6).toFixed(0)}M nos ETFs à vista em ${etfBtc.periodo.dias} pregões (${rel >= 0 ? '+' : ''}${rel.toFixed(2)}% do patrimônio)`,
      'ETF só compra à vista: dinheiro que entra ali vira bitcoin guardado, não alavancagem');
  }

  if (dOI != null) {
    // preco parado com posicao sendo montada: quem monta decide o lado - olha a agressao
    const lateral = Math.abs(dPreco) < 3;
    let v = 0, txt = `preço ${dPreco >= 0 ? '+' : ''}${dPreco.toFixed(1)}% e posições em aberto ${dOI >= 0 ? '+' : ''}${dOI.toFixed(1)}%`;
    if (lateral && dOI > 3) { v = desequilibrio >= 0 ? .6 : -.6; txt += ' — posição sendo montada de lado'; }
    else if (dPreco < -3 && dOI < -3) { v = .5; txt += ' — alavancagem sendo lavada na queda'; }
    else if (dPreco > 3 && dOI > 5) { v = -.4; txt += ' — subida empurrada por alavancagem nova'; }
    else if (dPreco > 3 && dOI < 0) { v = .4; txt += ' — subiu com gente fechando aposta contra'; }
    else if (dPreco < -3 && dOI > 3) { v = -.5; txt += ' — caiu e ainda entrou posição, briga aberta'; }
    add('posições x preço', v, .15, txt,
      'compra à vista sustenta preço sem inflar posição em aberto; alta só com alavancagem costuma voltar');
  }

  if (fundingMedio != null) {
    // funding barato = quem esta comprado nao esta pagando caro: compra a vista, nao euforia
    const v = clamp(-(fundingMedio - 0.005) * 120, -1, 1);
    add('custo de ficar comprado', v, .15,
      `taxa média de ${fundingMedio.toFixed(4)}% por período${fundingMedio < 0.004 ? ' — barato' : fundingMedio > 0.012 ? ' — caro, mercado esticado' : ''}`,
      'taxa alta significa fila de gente comprada alavancada — combustível para queda, não para alta');
  }

  add('lugar na faixa', clamp((50 - posicaoFaixa) / 40, -1, 1), .1,
    `preço a ${posicaoFaixa.toFixed(0)}% da faixa dos últimos ${nDias} dias (0% é o fundo, 100% é o topo)`,
    'acumulação costuma acontecer na parte de baixo da faixa; distribuição, na parte de cima');

  if (compressao != null) {
    // volatilidade secando dentro de faixa: alguem esta absorvendo os dois lados
    const v = Math.abs(incl) < 0.25 ? clamp(-compressao / 40, -1, 1) * 0.8 : 0;
    add('volatilidade', v, .1,
      `${compressao >= 0 ? 'expandindo' : 'secando'} ${Math.abs(compressao).toFixed(0)}% ante o período anterior${Math.abs(incl) < 0.25 ? ' dentro da faixa' : ''}`,
      'quando o preço para de se mexer e o volume continua, é sinal de que alguém está absorvendo ordem');
  }

  if (temFita && (Math.abs(grandes) > 1000 || Math.abs(miudos) > 1000)) {
    const soma = Math.abs(grandes) + Math.abs(miudos);
    const v = clamp((grandes - miudos) / (soma || 1), -1, 1);
    add('grandes x miúdos', v, .1,
      `ordens grandes ${grandes >= 0 ? 'comprando' : 'vendendo'} $${Math.abs(grandes / 1e6).toFixed(2)}M e miúdas ${miudos >= 0 ? 'comprando' : 'vendendo'} $${Math.abs(miudos / 1e6).toFixed(2)}M na fita`,
      'o padrão clássico de distribuição é ordem grande vendendo para ordem pequena comprando');
  }

  /* ---------- nota ---------- */
  const pesoTotal = votos.reduce((s, v) => s + v.peso, 0) || 1;
  const score = Math.round(votos.reduce((s, v) => s + v.voto * v.peso, 0) / pesoTotal * 100);
  const label = score >= 45 ? 'ACUMULAÇÃO' : score >= 18 ? 'ACUMULAÇÃO FRACA'
    : score > -18 ? 'SEM SINAL CLARO' : score > -45 ? 'DISTRIBUIÇÃO FRACA' : 'DISTRIBUIÇÃO';

  // a leitura muda de significado conforme a fase: distribuicao no topo de alta pesa
  // mais que distribuicao no meio de uma queda que ja aconteceu
  const contexto = fase === 'faixa lateral'
    ? (score >= 18 ? 'Faixa lateral com sinal de compra por baixo — é onde acumulação costuma aparecer.'
      : score <= -18 ? 'Faixa lateral com sinal de venda por cima — é onde distribuição costuma aparecer.'
        : 'Faixa lateral sem lado definido: os dois lados estão se anulando.')
    : fase === 'tendência de alta'
      ? (score <= -18 ? 'Preço subindo enquanto o fluxo já vende: é o retrato de quem aproveita a alta para sair.'
        : 'Preço subindo com o fluxo acompanhando — tendência, ainda não é acumulação escondida.')
      : (score >= 18 ? 'Preço caindo mas o fluxo já compra: pode ser gente pegando o que os outros largam.'
        : 'Preço caindo com o fluxo vendendo junto — nada de compra escondida por enquanto.');

  const explicacao = {
    'ACUMULAÇÃO': 'Mais dinheiro entrando do que saindo, sem preço esticado. Alguém está comprando devagar.',
    'ACUMULAÇÃO FRACA': 'Sinais de compra aparecendo, mas ainda sem convicção.',
    'SEM SINAL CLARO': 'Compra e venda equilibradas. Não dá para dizer que alguém está montando ou desmontando posição.',
    'DISTRIBUIÇÃO FRACA': 'Sinais de venda aparecendo, mas ainda sem convicção.',
    'DISTRIBUIÇÃO': 'Mais dinheiro saindo do que entrando, muitas vezes com o preço ainda bonito. Alguém está vendendo devagar.'
  }[label];

  return {
    t: Date.now(), dias: nDias, preco, score, label, explicacao, fase, contexto,
    faixa: { max, min, largura: +larguraFaixa.toFixed(2), posicao: +posicaoFaixa.toFixed(1), inclinacaoDia: +incl.toFixed(3) },
    variacao: { preco: +dPreco.toFixed(2), oi: dOI != null ? +dOI.toFixed(2) : null, fundingMedio },
    votos: votos.sort((a, b) => Math.abs(b.voto * b.peso) - Math.abs(a.voto * a.peso)),
    cobertura: {
      historicoProprio: histOk, etf: !!etfBtc, fita: temFita,
      aviso: 'a fita local só cobre o que este servidor coletou; o resto vem das velas e das fontes públicas'
    }
  };
}

async function paraSnapshot(nDias = 14) {
  try {
    const e = await ler(nDias);
    return {
      score: e.score, label: e.label, fase: e.fase, dias: e.dias,
      posicaoFaixa: e.faixa.posicao, dPreco: e.variacao.preco, dOI: e.variacao.oi,
      votos: e.votos.map(v => ({ nome: v.nome, voto: v.voto }))
    };
  } catch (e) { return null; }
}

module.exports = { ler, paraSnapshot };
