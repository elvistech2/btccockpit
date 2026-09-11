// OPCOES (Deribit, a maior bolsa de opcoes de bitcoin): o que o dinheiro que se protege
// e aposta esta dizendo. Opcao e dificil; aqui cada numero sai com uma frase de leigo e
// um "isso e bom ou ruim pro preco". Nada disso e previsao: e o posicionamento de agora.
//
// Glossario usado nas frases:
//   aposta de alta = call (direito de comprar a um preco)
//   seguro contra queda / aposta de queda = put (direito de vender a um preco)
//   preco da dor maxima = "max pain": onde, no vencimento, a maior parte das apostas vira po
const API = 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option';
const MESES = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
let cache = null;

// BTC-25SEP26-155000-P -> vencimento 25/09/2026 08:00 UTC, strike 155000, put
function lerNome(nome) {
  const m = /^BTC-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/.exec(nome);
  if (!m || MESES[m[2]] === undefined) return null;
  return { venc: Date.UTC(2000 + +m[3], MESES[m[2]], +m[1], 8), strike: +m[4], tipo: m[5] };
}
const usd = v => v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + ' bilhões' : '$' + (v / 1e6).toFixed(0) + ' milhões';
const $n = v => '$' + Math.round(v).toLocaleString('pt-BR');
const dataBr = t => new Date(t).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

function maxPain(opcoes) {
  const strikes = [...new Set(opcoes.map(o => o.strike))].sort((a, b) => a - b);
  let melhor = null;
  for (const S of strikes) {
    let paga = 0;
    for (const o of opcoes) paga += o.oi * (o.tipo === 'C' ? Math.max(0, S - o.strike) : Math.max(0, o.strike - S));
    if (!melhor || paga < melhor.paga) melhor = { preco: S, paga };
  }
  return melhor ? melhor.preco : null;
}
// IV da opcao com strike mais perto do alvo, desse tipo, nesse vencimento
function ivPerto(opcoes, tipo, alvo) {
  let m = null;
  for (const o of opcoes) if (o.tipo === tipo && o.iv > 0 && (!m || Math.abs(o.strike - alvo) < Math.abs(m.strike - alvo))) m = o;
  return m;
}

async function ler() {
  if (cache && Date.now() - cache.t < 5 * 6e4) return cache.v;
  const r = await fetch(API, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('Deribit respondeu ' + r.status);
  const lista = ((await r.json()).result || []).map(x => {
    const n = lerNome(x.instrument_name); if (!n) return null;
    return { ...n, oi: +x.open_interest || 0, vol: +x.volume || 0, iv: +x.mark_iv || 0, fut: +x.underlying_price || 0 };
  }).filter(Boolean);
  const agora = Date.now();
  const vivas = lista.filter(o => o.venc > agora);
  if (!vivas.length) throw new Error('Deribit nao devolveu opcoes');

  // preco de referencia: o do vencimento mais proximo
  const proxVenc = Math.min(...vivas.map(o => o.venc));
  const precos = vivas.filter(o => o.venc === proxVenc && o.fut > 0).map(o => o.fut).sort((a, b) => a - b);
  const preco = precos[Math.floor(precos.length / 2)];

  // agrupa por vencimento
  const porVenc = new Map();
  for (const o of vivas) { if (!porVenc.has(o.venc)) porVenc.set(o.venc, []); porVenc.get(o.venc).push(o); }
  const venc = [...porVenc.entries()].map(([t, ops]) => {
    const calls = ops.filter(o => o.tipo === 'C').reduce((s, o) => s + o.oi, 0);
    const puts = ops.filter(o => o.tipo === 'P').reduce((s, o) => s + o.oi, 0);
    return { t, ops, calls, puts, notional: (calls + puts) * preco };
  }).sort((a, b) => a.t - b.t);

  // vencimento que importa: o de maior valor nas proximas 5 semanas
  const janela = venc.filter(v => v.t - agora < 35 * 864e5);
  const principal = janela.reduce((m, v) => (!m || v.notional > m.notional ? v : m), null);
  const dor = maxPain(principal.ops);
  const diasPrincipal = (principal.t - agora) / 864e5;

  // totais
  const callsTot = venc.reduce((s, v) => s + v.calls, 0), putsTot = venc.reduce((s, v) => s + v.puts, 0);
  const pcOI = putsTot / (callsTot || 1);
  const volC = vivas.filter(o => o.tipo === 'C').reduce((s, o) => s + o.vol, 0);
  const volP = vivas.filter(o => o.tipo === 'P').reduce((s, o) => s + o.vol, 0);
  const pcVol = volP / (volC || 1);

  // medo de queda (skew): seguro 10% abaixo x aposta 10% acima, no vencimento de ~30 dias
  const v30 = venc.filter(v => v.t - agora > 7 * 864e5).reduce((m, v) => (!m || Math.abs(v.t - agora - 30 * 864e5) < Math.abs(m.t - agora - 30 * 864e5) ? v : m), null);
  let skew = null, ivAtm = null;
  if (v30) {
    const f = v30.ops.find(o => o.fut > 0)?.fut || preco;
    const p = ivPerto(v30.ops, 'P', f * .9), c = ivPerto(v30.ops, 'C', f * 1.1);
    const a1 = ivPerto(v30.ops, 'C', f), a2 = ivPerto(v30.ops, 'P', f);
    if (p && c) skew = { valor: +(p.iv - c.iv).toFixed(1), putStrike: p.strike, callStrike: c.strike, dias: Math.round((v30.t - agora) / 864e5) };
    if (a1 && a2) ivAtm = +((a1.iv + a2.iv) / 2).toFixed(1);
  }

  // muralhas: onde se concentra a aposta, somando os vencimentos das proximas 5 semanas
  const porStrike = new Map();
  for (const v of janela) for (const o of v.ops) {
    const k = porStrike.get(o.strike) || { c: 0, p: 0 };
    if (o.tipo === 'C') k.c += o.oi; else k.p += o.oi;
    porStrike.set(o.strike, k);
  }
  let teto = null, piso = null;
  for (const [k, x] of porStrike) {
    if (k > preco && (!teto || x.c > teto.oi)) teto = { strike: k, oi: x.c };
    if (k < preco && (!piso || x.p > piso.oi)) piso = { strike: k, oi: x.p };
  }

  /* ---------- traducao pra leigo: cada sinal com nota e frase ---------- */
  const sinais = [];
  const add = (nome, nota, tom, texto) => sinais.push({ nome, nota, tom, texto });
  {
    const nota = pcOI < .5 ? 30 : pcOI < .7 ? 15 : pcOI < .9 ? 0 : pcOI < 1.1 ? -15 : -30;
    add('Apostas de alta x de queda', nota, nota > 0 ? 'bom' : nota < 0 ? 'ruim' : 'neutro',
      `Pra cada 10 apostas de alta abertas existem ${(pcOI * 10).toFixed(0)} de queda. ` +
      (nota > 0 ? 'Quem opera opções está mais otimista que pessimista.' : nota < 0 ? 'Tem mais gente se protegendo de queda do que apostando em alta.' : 'Os dois lados estão parecidos.'));
  }
  if (skew) {
    const s = skew.valor;
    const nota = s > 6 ? -35 : s > 3 ? -20 : s > 1 ? -8 : s > -1 ? 0 : 20;
    add('Preço do seguro contra queda', nota, nota > 0 ? 'bom' : nota < 0 ? 'ruim' : 'neutro',
      s > 3 ? `Proteger-se de uma queda de 10% está bem mais caro que apostar numa alta de 10% (${s.toFixed(1)} pontos de diferença). Gente grande pagando caro por seguro: é sinal de medo.`
        : s > 1 ? `O seguro contra queda está um pouco mais caro que a aposta de alta (${s.toFixed(1)} pontos). Cautela leve — é o normal na maior parte do tempo.`
        : s < -1 ? `Apostar numa alta de 10% está mais caro que se proteger de uma queda (${Math.abs(s).toFixed(1)} pontos). O mercado está com vontade de subir.`
          : 'Seguro contra queda e aposta de alta custam parecido: ninguém está desesperado nem eufórico.');
  }
  {
    const nota = pcVol > 1.3 ? -15 : pcVol > 1 ? -5 : pcVol < .6 ? 10 : 0;
    add('O que foi comprado nas últimas 24h', nota, nota > 0 ? 'bom' : nota < 0 ? 'ruim' : 'neutro',
      pcVol > 1 ? `Hoje foram negociadas mais apostas de queda que de alta (${pcVol.toFixed(2)} pra 1): alguém está correndo atrás de proteção agora.`
        : `Hoje saíram mais apostas de alta que de queda (${(1 / (pcVol || 1)).toFixed(1)} pra 1).`);
  }
  if (dor) {
    const dist = (preco / dor - 1) * 100;
    const perto = diasPrincipal <= 4 && Math.abs(dist) > 4;
    const nota = perto ? (dist > 0 ? -8 : 8) : 0;
    add('Preço da dor máxima', nota, nota > 0 ? 'bom' : nota < 0 ? 'ruim' : 'neutro',
      `Na ${dataBr(principal.t)}, vencem ${usd(principal.notional)} em opções. O "preço da dor máxima" é ${$n(dor)}: nele a maior parte dessas apostas vira pó. ` +
      (perto ? `O preço está ${Math.abs(dist).toFixed(1)}% ${dist > 0 ? 'acima' : 'abaixo'} dele e faltam poucos dias — às vezes o mercado é puxado pra perto desse número até o vencimento.`
        : `O preço está ${Math.abs(dist).toFixed(1)}% ${dist > 0 ? 'acima' : 'abaixo'} dele. Com o vencimento ainda longe, esse "ímã" pesa pouco.`));
  }
  const nota = Math.max(-100, Math.min(100, Math.round(sinais.reduce((s, x) => s + x.nota, 0) * 1.4)));
  const veredito = nota >= 25 ? 'BOM PRA ALTA' : nota >= 8 ? 'LEVEMENTE OTIMISTA' : nota > -8 ? 'NEUTRO' : nota > -25 ? 'CAUTELOSO' : 'MEDO';
  const resumo = {
    'BOM PRA ALTA': 'O dinheiro das opções está apostando mais em alta do que se protegendo. Ambiente favorável.',
    'LEVEMENTE OTIMISTA': 'Um pouco mais de aposta em alta do que medo. Nada gritante.',
    'NEUTRO': 'Nem medo nem euforia nas opções. O mercado de opções não está puxando pra lado nenhum.',
    'CAUTELOSO': 'Tem mais gente se protegendo de queda do que o normal. Não é pânico, mas é cautela.',
    'MEDO': 'O dinheiro das opções está pagando caro pra se proteger de queda. Clima de medo.'
  }[veredito];

  const v = {
    t: agora, preco, nota, veredito, resumo, sinais,
    numeros: {
      pcOI: +pcOI.toFixed(2), pcVol: +pcVol.toFixed(2), skew, ivAtm,
      maxPain: dor, vencimento: { t: principal.t, dia: dataBr(principal.t), dias: +diasPrincipal.toFixed(1), valor: principal.notional },
      teto: teto ? teto.strike : null, piso: piso ? piso.strike : null,
      apostasAbertas: Math.round(callsTot + putsTot)
    },
    muralhas: teto || piso ? `Maior muralha de apostas de alta em ${teto ? $n(teto.strike) : '—'} (funciona como teto) e de queda em ${piso ? $n(piso.strike) : '—'} (funciona como piso).` : null
  };
  cache = { t: agora, v };
  return v;
}

module.exports = { ler, maxPain, lerNome };
