// AGENDA MACRO: quando o Fed decide o juro e quando saem os dados que mexem com essa
// decisao (inflacao e emprego). As datas das reunioes vem do calendario oficial do Fed;
// CPI e payroll vem do calendario do BLS, via inflacao.js e payroll.js.
//
// Horarios: a decisao do Fed sai as 14h de Washington (entrevista do presidente as 14h30);
// CPI e payroll saem as 8h30. Tudo convertido pra hora de Brasilia com o fuso de verdade
// (o horario de verao americano muda a diferenca entre 1 e 2 horas).
const INFLACAO = require('./inflacao');
const PAYROLL = require('./payroll');

const MESES_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
let cache = null;

// hora de Nova York -> instante UTC (acha o deslocamento do dia com o proprio Intl)
function nyParaUtc(ano, mes, dia, hora, minuto) {
  let t = Date.UTC(ano, mes, dia, hora + 5, minuto);
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
    }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
    const visto = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute);
    t += Date.UTC(ano, mes, dia, hora, minuto) - visto;
  }
  return t;
}
const brasilia = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function reunioesFed() {
  const r = await fetch('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', { headers: { 'user-agent': 'Mozilla/5.0 btc-radar' } });
  if (!r.ok) throw new Error('calendario do Fed respondeu ' + r.status);
  const txt = (await r.text()).replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ');
  const out = [];
  // cada ano tem uma secao "2026 FOMC Meetings"; dentro dela, "March| |17-18*|" ou "April/May| |30-1|"
  const secoes = [...txt.matchAll(/(\d{4}) FOMC Meetings/g)];
  secoes.forEach((sec, i) => {
    const ano = +sec[1];
    const trecho = txt.slice(sec.index, i + 1 < secoes.length ? secoes[i + 1].index : sec.index + 20000);
    for (const m of trecho.matchAll(/\|\s*([A-Z][a-z]+)(?:\/([A-Z][a-z]+))?\s*\|[\s|]*(\d{1,2})-(\d{1,2})(\*?)\s*\|/g)) {
      const m1 = MESES_EN.indexOf(m[1].toLowerCase());
      const m2 = m[2] ? MESES_EN.indexOf(m[2].toLowerCase()) : m1;
      if (m1 < 0 || m2 < 0) continue;
      const dia2 = +m[4];
      const anoDecisao = m2 < m1 ? ano + 1 : ano;           // reuniao que vira o ano (dez/jan)
      const decisao = nyParaUtc(anoDecisao, m2, dia2, 14, 0);
      out.push({
        tipo: 'fomc', decisao, entrevista: decisao + 30 * 6e4,
        projecoes: m[5] === '*',                            // com o "grafico de pontos" dos dirigentes
        rotulo: m[1] + (m[2] ? '/' + m[2] : '') + ' ' + m[3] + '-' + m[4] + ' ' + ano
      });
    }
  });
  const vistos = new Set();
  return out.filter(x => !vistos.has(x.decisao) && vistos.add(x.decisao)).sort((a, b) => a.decisao - b.decisao);
}

async function ler() {
  if (cache && Date.now() - cache.t < 3 * 3.6e6) return montar(cache.v);
  // datas do CPI e do payroll pelas paginas de calendario do BLS: nao gastam a cota da API
  const [fed, cpi, pay] = await Promise.all([
    reunioesFed().catch(e => ({ erro: String(e.message || e).slice(0, 100) })),
    INFLACAO.proximo('cpi').catch(() => null),
    PAYROLL.proximoRelease().catch(() => null)
  ]);
  const v = { fed, cpiProximo: cpi ? cpi.dia : null, payrollProximo: pay ? pay.dia : null };
  cache = { t: Date.now(), v };
  return montar(v);
}

// monta a lista com o "agora" de cada chamada: a contagem regressiva tem que ser fresca
function montar(v) {
  const agora = Date.now();
  const eventos = [];
  const fed = Array.isArray(v.fed) ? v.fed : [];
  // a reuniao de hoje continua na lista ate 3 horas depois da decisao
  for (const r of fed.filter(x => x.decisao > agora - 3 * 3.6e6).slice(0, 4)) {
    eventos.push({
      tipo: 'fomc', nome: 'Decisão de juros do Fed', t: r.decisao, quando: brasilia(r.decisao),
      detalhe: r.projecoes ? 'com projeções dos dirigentes (o "gráfico de pontos") — costuma mexer mais' : 'decisão e entrevista do presidente 30 min depois',
      projecoes: r.projecoes, jaSaiu: r.decisao <= agora
    });
  }
  const dia = (s, h, m, nome, detalhe) => {
    if (!s) return;
    const [a, me, d] = s.split('-').map(Number);
    const t = nyParaUtc(a, me - 1, d, h, m);
    if (t > agora - 3 * 3.6e6) eventos.push({ tipo: nome === 'Inflação (CPI)' ? 'cpi' : 'payroll', nome, t, quando: brasilia(t), detalhe, jaSaiu: t <= agora });
  };
  dia(v.cpiProximo, 8, 30, 'Inflação (CPI)', 'inflação acima do esperado adia o corte de juro');
  dia(v.payrollProximo, 8, 30, 'Emprego (payroll)', 'emprego fraco empurra o Fed a cortar');
  eventos.sort((a, b) => a.t - b.t);
  const proximoFed = eventos.find(e => e.tipo === 'fomc' && !e.jaSaiu) || null;
  return { t: agora, eventos, proximoFed, erroFed: v.fed && v.fed.erro ? v.fed.erro : null };
}

module.exports = { ler, nyParaUtc };
