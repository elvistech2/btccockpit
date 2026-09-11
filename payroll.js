// Payroll (Employment Situation do BLS): quantas vagas os EUA criaram no mes, desemprego
// e salario. E o dado que mais move a expectativa de corte ou alta de juro entre uma
// reuniao do Fed e outra - por isso entra na analise do Fed, nao ao lado dela.
// API publica do BLS, sem chave (limite de 25 consultas por dia por IP; cache de 6h).
const SERIES = {
  vagas: 'CES0000000001',       // total nonfarm, nivel em milhares, com ajuste sazonal
  desemprego: 'LNS14000000',    // taxa de desemprego
  salario: 'CES0500000003',     // salario medio por hora, setor privado
  participacao: 'LNS11300000'   // taxa de participacao na forca de trabalho
};
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

let cache = null;
async function jget(url, opts = {}) {
  const c = new AbortController();
  const to = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'user-agent': 'Mozilla/5.0 btc-radar', 'content-type': 'application/json', accept: '*/*' },
      body: opts.body, signal: c.signal
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return opts.texto ? await r.text() : await r.json();
  } finally { clearTimeout(to); }
}

// devolve a serie em ordem cronologica: [{ano, mes(1-12), rotulo, valor, preliminar}]
function ordenar(serie) {
  return (serie.data || [])
    .filter(d => /^M(0[1-9]|1[0-2])$/.test(d.period))
    .map(d => ({
      ano: +d.year, mes: +d.period.slice(1), valor: +d.value,
      rotulo: MESES[+d.period.slice(1) - 1] + ' de ' + d.year,
      preliminar: (d.footnotes || []).some(f => f && f.code === 'P')
    }))
    .filter(d => isFinite(d.valor))
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
}

// data do proximo Employment Situation, direto do calendario do BLS
async function proximoRelease() {
  try {
    const html = await jget('https://www.bls.gov/schedule/news_release/empsit.htm', { texto: true });
    const txt = html.replace(/<[^>]+>/g, '|');
    const datas = [...txt.matchAll(/([A-Z][a-z]{2})\.?\s+(\d{1,2}),\s+(\d{4})/g)]
      .map(m => Date.parse(m[1] + ' ' + m[2] + ', ' + m[3]))
      .filter(t => isFinite(t))
      .sort((a, b) => a - b);
    const fimDeHoje = new Date(); fimDeHoje.setHours(23, 59, 59, 999);   // no dia do release o dado de hoje ja saiu
    const proxima = datas.find(t => t > fimDeHoje.getTime());
    return proxima ? { t: proxima, dia: new Date(proxima).toISOString().slice(0, 10) } : null;
  } catch (e) { return null; }
}

async function ler() {
  if (cache && Date.now() - cache.t < 6 * 3.6e6) return cache.v;
  const ano = new Date().getFullYear();
  const j = await jget('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
    method: 'POST',
    body: JSON.stringify({ seriesid: Object.values(SERIES), startyear: String(ano - 2), endyear: String(ano) })
  });
  if (j.status !== 'REQUEST_SUCCEEDED') throw new Error('BLS: ' + (j.message || []).join(' ').slice(0, 120));
  const por = {};
  for (const s of (j.Results.series || [])) {
    const nome = Object.keys(SERIES).find(k => SERIES[k] === s.seriesID);
    if (nome) por[nome] = ordenar(s);
  }
  const niveis = por.vagas || [];
  if (niveis.length < 4) throw new Error('BLS devolveu serie de emprego curta demais');

  // variacao mensal em milhares de vagas = o numero que o mercado chama de payroll
  const criacao = [];
  for (let i = 1; i < niveis.length; i++) {
    criacao.push({ ...niveis[i], vagas: Math.round(niveis[i].valor - niveis[i - 1].valor) });
  }
  const ult = criacao[criacao.length - 1];
  const media = n => {
    const p = criacao.slice(-n);
    return p.length ? Math.round(p.reduce((s, x) => s + x.vagas, 0) / p.length) : null;
  };
  const desemp = por.desemprego || [];
  const sal = por.salario || [];
  const salAnoAtras = sal.length > 12 ? sal[sal.length - 13] : null;
  const part = por.participacao || [];

  const v = {
    t: Date.now(),
    mes: ult.rotulo, preliminar: ult.preliminar,
    vagas: ult.vagas,
    media3m: media(3), media6m: media(6), media12m: media(12),
    serie: criacao.slice(-13).map(x => ({ rotulo: x.rotulo, mes: x.mes, ano: x.ano, vagas: x.vagas })),
    desemprego: desemp.length ? desemp[desemp.length - 1].valor : null,
    desempregoAnterior: desemp.length > 1 ? desemp[desemp.length - 2].valor : null,
    desempregoMes: desemp.length ? desemp[desemp.length - 1].rotulo : null,
    salarioYoY: sal.length && salAnoAtras ? +((sal[sal.length - 1].valor / salAnoAtras.valor - 1) * 100).toFixed(2) : null,
    participacao: part.length ? part[part.length - 1].valor : null,
    proximo: await proximoRelease()
  };
  // leitura do dado do ponto de vista do juro (o Fed corta quando o emprego enfraquece)
  v.forcaMercado = v.vagas >= 200 ? 'forte' : v.vagas >= 100 ? 'saudável' : v.vagas >= 50 ? 'morno' : v.vagas >= 0 ? 'fraco' : 'em contração';
  v.viesJuro = v.vagas < 50 || (v.desempregoAnterior != null && v.desemprego > v.desempregoAnterior + 0.1)
    ? 'empurra o Fed para cortar juro'
    : v.vagas > 200 && v.salarioYoY != null && v.salarioYoY > 4
      ? 'tira pressa do Fed para cortar juro'
      : 'não força a mão do Fed para nenhum lado';
  cache = { t: Date.now(), v };
  return v;
}

// bloco de texto que vai junto com os documentos do Fed no prompt
function paraPrompt(p) {
  if (!p) return '';
  const l = [];
  l.push(`ULTIMO PAYROLL (Employment Situation do BLS, referente a ${p.mes}${p.preliminar ? ', numero preliminar' : ''}):`);
  l.push(`- Criacao de vagas no mes: ${p.vagas >= 0 ? '+' : ''}${p.vagas} mil (mercado de trabalho ${p.forcaMercado})`);
  if (p.media3m != null) l.push(`- Media dos ultimos 3 meses: ${p.media3m >= 0 ? '+' : ''}${p.media3m} mil por mes; 12 meses: ${p.media12m >= 0 ? '+' : ''}${p.media12m} mil`);
  if (p.desemprego != null) l.push(`- Desemprego: ${p.desemprego}%${p.desempregoAnterior != null ? ' (mes anterior ' + p.desempregoAnterior + '%)' : ''}`);
  if (p.salarioYoY != null) l.push(`- Salario medio por hora: ${p.salarioYoY >= 0 ? '+' : ''}${p.salarioYoY}% em 12 meses`);
  if (p.participacao != null) l.push(`- Participacao na forca de trabalho: ${p.participacao}%`);
  l.push(`- Ultimos meses: ${p.serie.slice(-6).map(x => x.rotulo.split(' de ')[0] + ' ' + (x.vagas >= 0 ? '+' : '') + x.vagas + 'k').join(', ')}`);
  if (p.proximo) l.push(`- Proximo payroll sai em ${p.proximo.dia}`);
  return l.join('\n');
}

module.exports = { ler, paraPrompt };
