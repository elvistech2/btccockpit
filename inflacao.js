// Inflacao nos EUA (CPI e PPI do BLS): o outro lado da balanca do Fed. Emprego fraco
// empurra corte de juro; inflacao alta ou acelerando segura o corte. Por isso entra
// na analise do Fed junto com o payroll.
// API publica do BLS, sem chave (25 consultas por dia por IP; cache de 6h).
//
// Como o BLS calcula: variacao do mes usa o indice COM ajuste sazonal; variacao em
// 12 meses usa o indice SEM ajuste. Fazemos igual. A conta sai dos indices, entao
// pode diferir do numero arredondado do comunicado em 0,1 ponto de vez em quando.
const SERIES = {
  cheio: 'CUUR0000SA0',        // CPI-U, todos os itens, sem ajuste (12 meses)
  cheioSA: 'CUSR0000SA0',      // CPI-U, todos os itens, com ajuste (mes)
  nucleo: 'CUUR0000SA0L1E',    // nucleo: sem alimentos e energia, sem ajuste
  nucleoSA: 'CUSR0000SA0L1E',  // nucleo com ajuste
  ppi: 'WPUFD4',               // PPI demanda final, sem ajuste
  ppiSA: 'WPSFD4'              // PPI demanda final, com ajuste
};
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const META = 2;                // meta de inflacao do Fed (ele mira o PCE, que o BLS nao publica)

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
const r1 = v => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
const anual = (s, i) => (i >= 12 ? (s[i].valor / s[i - 12].valor - 1) * 100 : null);
const mensal = (s, i) => (i >= 1 ? (s[i].valor / s[i - 1].valor - 1) * 100 : null);
// nucleo anualizado dos ultimos 3 meses: mostra a velocidade de agora, sem o peso de um ano atras
const tresMeses = (s, i) => (i >= 3 ? ((s[i].valor / s[i - 3].valor) ** 4 - 1) * 100 : null);

async function proximo(pagina) {
  try {
    const html = await jget('https://www.bls.gov/schedule/news_release/' + pagina + '.htm', { texto: true });
    const datas = [...html.replace(/<[^>]+>/g, '|').matchAll(/([A-Z][a-z]{2})\.?\s+(\d{1,2}),\s+(\d{4})/g)]
      .map(m => Date.parse(m[1] + ' ' + m[2] + ', ' + m[3])).filter(isFinite).sort((a, b) => a - b);
    const fimDeHoje = new Date(); fimDeHoje.setHours(23, 59, 59, 999);
    const t = datas.find(x => x > fimDeHoje.getTime());
    return t ? { t, dia: new Date(t).toISOString().slice(0, 10) } : null;
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
  const s = {};
  for (const x of (j.Results.series || [])) {
    const nome = Object.keys(SERIES).find(k => SERIES[k] === x.seriesID);
    if (nome) s[nome] = ordenar(x);
  }
  if (!s.cheio || s.cheio.length < 14) throw new Error('BLS devolveu serie de CPI curta demais');

  const ult = a => (a && a.length ? a.length - 1 : -1);
  const i = ult(s.cheio), iS = ult(s.cheioSA), n = ult(s.nucleo), nS = ult(s.nucleoSA);
  const p = ult(s.ppi), pS = ult(s.ppiSA);

  const v = {
    t: Date.now(),
    mes: s.cheio[i].rotulo,
    cpi: {
      anual: r1(anual(s.cheio, i)), anualAnterior: r1(anual(s.cheio, i - 1)),
      mensal: iS >= 0 ? r1(mensal(s.cheioSA, iS)) : null
    },
    nucleo: {
      anual: n >= 0 ? r1(anual(s.nucleo, n)) : null,
      anualAnterior: n >= 1 ? r1(anual(s.nucleo, n - 1)) : null,
      mensal: nS >= 0 ? r1(mensal(s.nucleoSA, nS)) : null,
      tresMesesAnualizado: nS >= 0 ? r1(tresMeses(s.nucleoSA, nS)) : null
    },
    ppi: p >= 0 ? {
      mes: s.ppi[p].rotulo, preliminar: s.ppi[p].preliminar,
      anual: r1(anual(s.ppi, p)), mensal: pS >= 0 ? r1(mensal(s.ppiSA, pS)) : null
    } : null,
    // trajetoria dos ultimos meses em 12 meses: e o que diz se a inflacao esta cedendo
    serie: s.cheio.slice(-7).map((x, k, arr) => {
      const idx = s.cheio.length - arr.length + k;
      const idxN = s.nucleo ? s.nucleo.findIndex(y => y.ano === x.ano && y.mes === x.mes) : -1;
      return { rotulo: x.rotulo, cheio: r1(anual(s.cheio, idx)), nucleo: idxN >= 0 ? r1(anual(s.nucleo, idxN)) : null };
    }).filter(x => x.cheio != null),
    meta: META,
    proximo: await proximo('cpi')
  };

  // leitura para o juro: o Fed olha o nucleo e a direcao, nao o numero cheio de um mes
  const nuc = v.nucleo.anual, ant = v.nucleo.anualAnterior, vel = v.nucleo.tresMesesAnualizado;
  v.direcao = nuc == null || ant == null ? 'sem comparação'
    : nuc > ant ? 'acelerando' : nuc < ant ? 'desacelerando' : 'estável';
  v.distanciaMeta = nuc != null ? r1(nuc - META) : null;
  v.viesJuro = nuc == null ? 'sem leitura'
    : (nuc >= 3 && v.direcao !== 'desacelerando') || (vel != null && vel >= 3.5)
      ? 'segura o Fed longe do corte de juro'
      : nuc <= 2.5 && v.direcao !== 'acelerando'
        ? 'abre espaço para o Fed cortar juro'
        : v.direcao === 'desacelerando'
          ? 'cedendo, mas ainda acima da meta — corte possível, sem pressa'
          : 'acima da meta e sem ceder — o Fed tende a esperar';
  cache = { t: Date.now(), v };
  return v;
}

function paraPrompt(x) {
  if (!x) return '';
  const sinal = v => (v == null ? '?' : (v >= 0 ? '+' : '') + v);
  const l = [];
  l.push(`ULTIMA INFLACAO (CPI do BLS, referente a ${x.mes}):`);
  l.push(`- CPI cheio: ${sinal(x.cpi.anual)}% em 12 meses (mes anterior ${sinal(x.cpi.anualAnterior)}%), ${sinal(x.cpi.mensal)}% no mes`);
  l.push(`- Nucleo (sem alimentos e energia): ${sinal(x.nucleo.anual)}% em 12 meses (mes anterior ${sinal(x.nucleo.anualAnterior)}%), ${sinal(x.nucleo.mensal)}% no mes`);
  if (x.nucleo.tresMesesAnualizado != null) l.push(`- Nucleo dos ultimos 3 meses, anualizado: ${sinal(x.nucleo.tresMesesAnualizado)}% (velocidade de agora)`);
  l.push(`- Direcao do nucleo: ${x.direcao}; distancia da meta de ${x.meta}%: ${sinal(x.distanciaMeta)} ponto(s)`);
  if (x.ppi) l.push(`- Inflacao ao produtor (PPI demanda final, ${x.ppi.mes}${x.ppi.preliminar ? ', preliminar' : ''}): ${sinal(x.ppi.anual)}% em 12 meses, ${sinal(x.ppi.mensal)}% no mes`);
  l.push(`- Trajetoria do CPI cheio em 12 meses: ${x.serie.map(s => s.rotulo.split(' de ')[0].slice(0, 3) + ' ' + s.cheio + '%').join(', ')}`);
  if (x.proximo) l.push(`- Proximo CPI sai em ${x.proximo.dia}`);
  l.push('- Observacao: a meta do Fed e medida pelo PCE, que costuma rodar um pouco abaixo do CPI.');
  return l.join('\n');
}

module.exports = { ler, paraPrompt };
