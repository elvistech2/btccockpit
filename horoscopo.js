// HOROSCOPO CRIPTO: um astrologo cinico que so entende de mercado. Um texto por signo
// por dia, escrito pela IA com os numeros reais do dia (preco, variacao, medo/ganancia,
// funding) e guardado em disco - o painel abre todo dia e nao pode gastar cota a toa.
// Sem chave ou com a IA fora do ar, um gerador proprio de frases acidas assume.
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');
const SENT = require('./sentiment');

const ARQ = path.join(DATA, 'horoscopo.json');
const VERSAO = 2;
const SIGNOS = [
  { id: 'aries', nome: 'Áries', emoji: '♈', elemento: 'fogo' }, { id: 'touro', nome: 'Touro', emoji: '♉', elemento: 'terra' },
  { id: 'gemeos', nome: 'Gêmeos', emoji: '♊', elemento: 'ar' }, { id: 'cancer', nome: 'Câncer', emoji: '♋', elemento: 'água' },
  { id: 'leao', nome: 'Leão', emoji: '♌', elemento: 'fogo' }, { id: 'virgem', nome: 'Virgem', emoji: '♍', elemento: 'terra' },
  { id: 'libra', nome: 'Libra', emoji: '♎', elemento: 'ar' }, { id: 'escorpiao', nome: 'Escorpião', emoji: '♏', elemento: 'água' },
  { id: 'sagitario', nome: 'Sagitário', emoji: '♐', elemento: 'fogo' }, { id: 'capricornio', nome: 'Capricórnio', emoji: '♑', elemento: 'terra' },
  { id: 'aquario', nome: 'Aquário', emoji: '♒', elemento: 'ar' }, { id: 'peixes', nome: 'Peixes', emoji: '♓', elemento: 'água' }
];

function hoje() {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function lerArq() { try { return JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch (e) { return {}; } }
function gravarArq(d) {
  const dias = Object.keys(d).sort();
  for (const k of dias.slice(0, -30)) delete d[k];          // guarda um mes, pra historia
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(ARQ, JSON.stringify(d)); } catch (e) { }
}

async function mercado() {
  const j = async u => { try { const r = await fetch(u); return r.ok ? r.json() : null; } catch (e) { return null; } };
  const [tk, pr, fng] = await Promise.all([
    j('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT'),
    j('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT'),
    SENT.fearGreed().catch(() => null)
  ]);
  const f = fng && fng[0];
  return {
    preco: tk ? Math.round(+tk.lastPrice) : null,
    variacao: tk ? +(+tk.priceChangePercent).toFixed(2) : null,
    medo: f ? f.v : null, medoTexto: f ? f.label : null,
    funding: pr ? +(+pr.lastFundingRate * 100).toFixed(4) : null
  };
}

/* ---------- gerador proprio (sem IA) ---------- */
// sorteio com semente do dia + signo: sem IA, o texto do dia fica o mesmo a cada abertura
function semente(txt) { let h = 2166136261; for (const c of txt) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; }; }
function semIA(sig, m) {
  const rnd = semente(hoje() + sig.id);
  const sorteia = a => a[Math.floor(rnd() * a.length)];
  const subiu = (m.variacao || 0) >= 0;
  const energia = { fogo: 'iniciativa e coragem', terra: 'paciência e pé no chão', ar: 'ideias e boas conversas', 'água': 'intuição e sensibilidade' }[sig.elemento];
  const clima = m.variacao == null ? 'o mercado acordou devagar, e tudo bem ir no seu ritmo' : subiu
    ? `o bitcoin sobe ${m.variacao}% e o clima geral é de otimismo — aproveite essa maré boa, sem pressa`
    : `o bitcoin recua ${Math.abs(m.variacao)}%, e dias assim pedem calma: nem tudo que cai é problema seu`;
  const titulos = subiu
    ? ['Dia de colher o que plantou', 'Os astros estão no verde', 'Boa maré, pé no chão']
    : ['Calma que o dia melhora', 'Paciência é o seu superpoder hoje', 'Dia de observar antes de agir'];
  const conselhos = ['Anote uma decisão antes de tomá-la; relê-la depois evita arrependimento.',
    'Faça uma pausa longe das telas no meio da tarde. As ideias boas aparecem no café.',
    'Termine uma tarefa pendente antes de começar outra. Sua cabeça agradece.',
    'Converse com alguém de confiança antes de decidir algo grande.',
    'Durma cedo: amanhã você vai querer estar afiado.'];
  const amores = ['Uma mensagem sincera vale mais que qualquer gráfico hoje.',
    'Dia bom pra ouvir mais do que falar — alguém próximo precisa disso.',
    'Um convite simples pode render a melhor conversa da semana.'];
  const texto = `${sig.nome}, hoje ${clima}. Seu signo de ${sig.elemento} traz ${energia}, e é isso que vai te guiar: ` +
    (subiu ? 'use o bom humor pra resolver o que estava parado e dividir as boas notícias.' : 'escolha bem onde gastar energia e deixe o resto pra amanhã.') +
    (m.medo != null ? ` O mercado está com ${m.medo} de ${m.medo > 55 ? 'ganância' : m.medo < 45 ? 'medo' : 'equilíbrio'} no termômetro; você não precisa entrar no mesmo humor.` : '') +
    ' No fim do dia, vai perceber que fez mais do que imaginava.';
  return {
    titulo: sorteia(titulos), texto, amor: sorteia(amores), conselho: sorteia(conselhos),
    numero: Math.floor(rnd() * 99) + 1, cor: subiu ? 'verde' : 'azul-sereno',
    compatibilidade: sorteia(SIGNOS.filter(s => s.elemento === sig.elemento && s.id !== sig.id).map(s => s.nome + ', pela mesma energia de ' + sig.elemento))
  };
}

async function ler(signoId) {
  const sig = SIGNOS.find(s => s.id === signoId);
  if (!sig) throw new Error('signo desconhecido');
  const dia = hoje(), todos = lerArq();
  // versao 2 = tom leve e com sentido pro dia; texto guardado da versao acida e refeito
  if (todos[dia] && todos[dia][sig.id] && todos[dia][sig.id].versao === VERSAO) return { ...todos[dia][sig.id], signo: sig, dia, guardado: true };

  const m = await mercado();
  let h = null, origem = 'ia';
  try {
    const dataTxt = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    const prompt = `Você é um astrólogo simpático e bem-humorado que também acompanha o mercado de bitcoin. Escreva o horóscopo de hoje (${dataTxt}) para ${sig.nome} (signo de ${sig.elemento}), em português do Brasil.
Clima do mercado hoje, pra usar de pano de fundo: bitcoin a $${m.preco ?? '?'} (${m.variacao ?? '?'}% em 24 horas), índice de medo e ganância ${m.medo ?? '?'} (${m.medoTexto ?? '?'}).
Regras de tom e conteúdo:
- Leve e divertido, com humor gentil. Nada de deboche, ironia pesada ou crítica ao leitor: ele deve terminar de ler com um sorriso.
- Tem que ter sentido pro dia da pessoa: fale de energia, foco, trabalho, relações, decisões, paciência, impulsos. O mercado entra como tempero, de forma natural, citando de leve um dos números de hoje.
- O dia pode ser bom ou desafiador (decida pelo signo e pelo clima dos números), mas sempre termine com uma orientação útil e otimista.
- Sem recomendação de compra ou venda, sem política, sem ofensa a ninguém.
- Texto principal com 60 a 90 palavras.
Responda em JSON: {"titulo":"3 a 7 palavras","texto":"...","amor":"uma frase leve sobre amor e relações hoje","conselho":"um conselho prático pro dia, com uma pitada de humor","numero":inteiro de 1 a 99,"cor":"cor da sorte","compatibilidade":"signo que combina com você hoje, com o motivo em poucas palavras"}`;
    h = await SENT.gemini(prompt, 1.0);
    if (!h || !h.texto) throw new Error('IA devolveu vazio');
  } catch (e) {
    h = semIA(sig, m); origem = 'modelo';
  }
  const item = { ...h, origem, mercado: m, t: Date.now(), versao: VERSAO };
  // so guarda o da IA: o do gerador proprio pode tentar a IA de novo mais tarde
  if (origem === 'ia') { todos[dia] = todos[dia] || {}; todos[dia][sig.id] = item; gravarArq(todos); }
  return { ...item, signo: sig, dia, guardado: false };
}

module.exports = { SIGNOS, ler };
