// HOROSCOPO CRIPTO: um astrologo cinico que so entende de mercado. Um texto por signo
// por dia, escrito pela IA com os numeros reais do dia (preco, variacao, medo/ganancia,
// funding) e guardado em disco - o painel abre todo dia e nao pode gastar cota a toa.
// Sem chave ou com a IA fora do ar, um gerador proprio de frases acidas assume.
const fs = require('fs');
const path = require('path');
const { DATA } = require('./paths');
const SENT = require('./sentiment');

const ARQ = path.join(DATA, 'horoscopo.json');
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
  const clima = m.variacao == null ? 'o mercado nem saiu da cama' : subiu
    ? `o bitcoin subiu ${m.variacao}% e você já está se sentindo o Warren Buffett`
    : `o bitcoin caiu ${Math.abs(m.variacao)}% e você já está pesquisando "vaga de motorista de aplicativo"`;
  const titulos = subiu
    ? ['Os astros estão verdes (por enquanto)', 'Mercúrio em alta, você em FOMO', 'Júpiter comprou no topo com você']
    : ['Saturno liquidou sua posição', 'A lua está em candle vermelho', 'Marte em retrógrado, sua carteira também'];
  const conselhos = ['Coloque um stop loss. Nos astros e na vida.', 'Desinstale o app de corretora por 24 horas. A carteira agradece.',
    'Não opere depois das 23h. Nada de bom acontece depois das 23h.', 'Se o influencer está gritando, é hora de ficar quieto.',
    'Beba água. O gráfico de 1 minuto não vai sentir sua falta.'];
  const amores = ['Seu crush vê seus stories; sua corretora vê suas liquidações. Os dois ignoram.',
    'Não misture alavancagem e relacionamento: os dois terminam em chamada de margem.',
    'O amor da sua vida pode estar no grupo do zap. O golpe também.'];
  const texto = `${sig.nome}, hoje ${clima}. ` +
    (m.medo != null ? `O índice de medo e ganância está em ${m.medo}, ou seja, ${m.medo > 60 ? 'todo mundo eufórico — o que historicamente termina bem para ninguém' : m.medo < 40 ? 'todo mundo com medo, inclusive você, que jurou que era "diamond hands"' : 'o mercado está tão indeciso quanto você na hora de apertar o botão de venda'}. ` : '') +
    `Com a energia de ${sig.elemento} do seu signo, a tendência é você ${subiu ? 'aumentar a alavancagem "só um pouquinho"' : 'vender exatamente no fundo, como manda a tradição'}.`;
  return {
    titulo: sorteia(titulos), texto, amor: sorteia(amores), conselho: sorteia(conselhos),
    numero: Math.floor(rnd() * 99) + 1, cor: subiu ? 'verde candle' : 'vermelho liquidação',
    compatibilidade: sorteia(['hodlers de 2017', 'quem já perdeu a seed phrase', 'o analista que só acerta depois', 'trader de 125x (fuja)'])
  };
}

async function ler(signoId) {
  const sig = SIGNOS.find(s => s.id === signoId);
  if (!sig) throw new Error('signo desconhecido');
  const dia = hoje(), todos = lerArq();
  if (todos[dia] && todos[dia][sig.id]) return { ...todos[dia][sig.id], signo: sig, dia, guardado: true };

  const m = await mercado();
  let h = null, origem = 'ia';
  try {
    const dataTxt = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    const prompt = `Você é um astrólogo cínico e ácido que só entende de cripto. Escreva o horóscopo de hoje (${dataTxt}) para ${sig.nome} (signo de ${sig.elemento}), em português do Brasil, bem-humorado e debochado, zoando o trader e o mercado.
Use os números REAIS de hoje: bitcoin a $${m.preco ?? '?'} (${m.variacao ?? '?'}% em 24 horas), índice de medo e ganância ${m.medo ?? '?'} (${m.medoTexto ?? '?'}), taxa de funding ${m.funding ?? '?'}%.
Regras:
- Humor ácido sobre alavancagem, FOMO, influencer de cripto, grupo do zap, "dessa vez é diferente", stop loss, comprar no topo. Pode zoar o próprio leitor.
- Nada de ofensa a grupos de pessoas (raça, religião, gênero, orientação, origem) e nada de política.
- É piada: nunca dê recomendação real de compra ou venda.
- Texto principal com 55 a 85 palavras, citando pelo menos um dos números de hoje de um jeito engraçado.
Responda em JSON: {"titulo":"3 a 7 palavras","texto":"...","amor":"uma frase sobre amor e alavancagem","conselho":"conselho absurdo mas no fundo sensato","numero":inteiro de 1 a 99,"cor":"cor da sorte com piada","compatibilidade":"tipo de trader ou signo compatível, com piada"}`;
    h = await SENT.gemini(prompt, 1.0);
    if (!h || !h.texto) throw new Error('IA devolveu vazio');
  } catch (e) {
    h = semIA(sig, m); origem = 'modelo';
  }
  const item = { ...h, origem, mercado: m, t: Date.now() };
  // so guarda o da IA: o do gerador proprio pode tentar a IA de novo mais tarde
  if (origem === 'ia') { todos[dia] = todos[dia] || {}; todos[dia][sig.id] = item; gravarArq(todos); }
  return { ...item, signo: sig, dia, guardado: false };
}

module.exports = { SIGNOS, ler };
