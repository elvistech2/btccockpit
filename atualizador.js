// ATUALIZADOR: o proprio painel descobre que saiu versao nova e, se a pessoa pedir,
// se atualiza sozinho.
//
// De onde vem a versao nova: a Release mais recente do repositorio no GitHub. O arquivo
// baixado so e aceito se o SHA-256 bater com o que o proprio GitHub publica pra ele.
//
// Como aplica depende de como o painel foi instalado:
//   windows-instalado  baixa o Setup novo, fecha o servidor, roda o Setup em modo
//                      silencioso por cima (mesmo AppId: atalhos e dados ficam) e sobe
//                      o painel de novo pelo "BTC Radar.exe --silencioso"
//   git                git pull --ff-only e reinicia o servidor (Linux com git clone)
//   windows-portatil   e manual: baixar o zip novo (nao da pra trocar o node.exe em uso)
//   manual             so avisa e mostra o link
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const REPO = 'elvistech2/btccockpit';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_OK = `https://github.com/${REPO}/releases/download/`;
const RAIZ = __dirname;
const TMP = path.join(os.tmpdir(), 'btc-radar-atualizacao');
const RESULTADO = path.join(TMP, 'resultado.json');

// Sem versao legivel, nao existe "versao nova": se caisse em 0.0.0, o painel acharia que
// toda Release e mais nova e ficaria se atualizando. Editor do Windows grava BOM no json.
function versaoLocal() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8').replace(/^﻿/, '')).version;
    return /^\d+\.\d+\.\d+/.test(v || '') ? v : null;
  } catch (e) { return null; }
}
const partes = v => String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
function comparar(a, b) {
  const x = partes(a), y = partes(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
function modo() {
  if (fs.existsSync(path.join(RAIZ, '.git'))) return 'git';
  const exe = fs.existsSync(path.join(RAIZ, 'BTC Radar.exe'));
  if (exe && fs.existsSync(path.join(RAIZ, 'unins000.exe'))) return 'windows-instalado';
  if (exe) return 'windows-portatil';
  return 'manual';
}

let ultimaConsulta = null;          // { t, dados }
let progresso = { fase: 'ocioso' };  // ocioso | baixando | conferindo | instalando | reiniciando | erro

async function verificar(forcar = false) {
  if (!forcar && ultimaConsulta && Date.now() - ultimaConsulta.t < 6 * 3.6e6) return ultimaConsulta.dados;
  const c = new AbortController();
  const to = setTimeout(() => c.abort(), 20000);
  let r;
  try {
    // a API do GitHub recusa pedido sem user-agent
    r = await fetch(API, { headers: { 'user-agent': 'btc-radar-atualizador', accept: 'application/vnd.github+json' }, signal: c.signal });
  } finally { clearTimeout(to); }
  if (r.status === 404) throw new Error('o repositorio ainda nao tem nenhuma versao publicada');
  if (!r.ok) throw new Error('GitHub respondeu ' + r.status + (r.status === 403 ? ' (limite de consultas por hora; tenta de novo mais tarde)' : ''));
  const rel = await r.json();
  const nova = String(rel.tag_name || '').replace(/^v/i, '');
  const arq = re => {
    const a = (rel.assets || []).find(x => re.test(x.name));
    return a ? { nome: a.name, url: a.browser_download_url, tamanho: a.size, sha256: String(a.digest || '').replace(/^sha256:/, '') || null } : null;
  };
  const m = modo();
  const dados = {
    atual: versaoLocal(), nova, temNova: !!versaoLocal() && comparar(nova, versaoLocal()) > 0,
    nome: rel.name || ('v' + nova), publicadaEm: rel.published_at,
    notas: String(rel.body || '').slice(0, 4000), pagina: rel.html_url,
    instalador: arq(/Setup.*\.exe$/i), portatil: arq(/portatil.*\.zip$/i),
    modo: m,
    podeAplicar: m === 'git' || (m === 'windows-instalado' && !!arq(/Setup.*\.exe$/i))
  };
  ultimaConsulta = { t: Date.now(), dados };
  return dados;
}

// resultado da ultima atualizacao, escrito pelo script que roda o Setup: e assim que o
// painel novo sabe se subiu depois de uma atualizacao que deu certo ou que falhou
function ultimoResultado() {
  try {
    const r = JSON.parse(fs.readFileSync(RESULTADO, 'utf8').replace(/^﻿/, ''));
    return Date.now() - r.t < 24 * 3.6e6 ? r : null;
  } catch (e) { return null; }
}

async function estado(forcar) {
  let info = null, erro = null;
  try { info = await verificar(forcar); } catch (e) { erro = String(e.message || e).slice(0, 200); }
  // versao instalada e "tem nova" saem sempre da leitura de agora, nunca do cache da
  // consulta ao GitHub (o package.json pode ter mudado desde entao)
  const atual = versaoLocal();
  return {
    ...(info || {}),
    atual, modo: modo(),
    temNova: !!(info && atual && comparar(info.nova, atual) > 0),
    erro, progresso,
    ultimoResultado: ultimoResultado(),
    consultadoEm: ultimaConsulta ? ultimaConsulta.t : null
  };
}

/* ---------------- download com progresso e conferencia ---------------- */
async function baixar(a) {
  if (!a || !a.url || !a.url.startsWith(DOWNLOAD_OK)) throw new Error('endereco de download fora do repositorio oficial');
  fs.mkdirSync(TMP, { recursive: true });
  const destino = path.join(TMP, a.nome.replace(/[^\w.\-]/g, '_'));
  progresso = { fase: 'baixando', baixado: 0, total: a.tamanho || 0, arquivo: a.nome };
  const r = await fetch(a.url, { headers: { 'user-agent': 'btc-radar-atualizador' }, redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error('download falhou: HTTP ' + r.status);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(destino);
  const leitor = r.body.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    hash.update(value);
    if (!out.write(value)) await new Promise(ok => out.once('drain', ok));
    progresso.baixado += value.length;
  }
  await new Promise((ok, falha) => out.end(e => (e ? falha(e) : ok())));
  progresso = { ...progresso, fase: 'conferindo' };
  const tam = fs.statSync(destino).size;
  if (a.tamanho && tam !== a.tamanho) throw new Error(`arquivo veio com ${tam} bytes, esperava ${a.tamanho}`);
  const sha = hash.digest('hex');
  if (a.sha256 && sha !== a.sha256) {
    try { fs.unlinkSync(destino); } catch (e) { }
    throw new Error('o arquivo baixado nao bate com o que o GitHub publicou (SHA-256 diferente) - nada foi instalado');
  }
  return { destino, sha, conferido: !!a.sha256 };
}

/* ---------------- Windows instalado: Setup silencioso por cima ---------------- */
const aspas = s => "'" + String(s).replace(/'/g, "''") + "'";   // string literal do PowerShell
function scriptWindows({ setup, de, para }) {
  const exe = path.join(RAIZ, 'BTC Radar.exe');
  const log = path.join(TMP, 'atualizacao.log');
  const logSetup = path.join(TMP, 'instalador.log');
  // So ASCII aqui dentro: o PowerShell 5 le .ps1 sem BOM na pagina de codigo do sistema.
  return `$ErrorActionPreference = 'Continue'
$log = ${aspas(log)}
function L($m) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m) }
L "atualizacao ${de} -> ${para}: esperando o painel fechar (PID ${process.pid})"
for ($i = 0; $i -lt 40; $i++) {
  if (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 500
}
Stop-Process -Id ${process.pid} -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
L "rodando o instalador"
$codigo = -1
try {
  $p = Start-Process -FilePath ${aspas(setup)} -ArgumentList ${aspas(`/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /LOG="${logSetup}"`)} -Wait -PassThru
  $codigo = $p.ExitCode
} catch { L ("instalador nao abriu: " + $_) }
L "instalador terminou com codigo $codigo"
$res = [ordered]@{ ok = ($codigo -eq 0); codigo = $codigo; de = ${aspas(de)}; para = ${aspas(para)}; t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
($res | ConvertTo-Json -Compress) | Set-Content -Path ${aspas(RESULTADO)} -Encoding ASCII
L "subindo o painel de novo"
Start-Process -FilePath ${aspas(exe)} -ArgumentList '--silencioso' -WorkingDirectory ${aspas(RAIZ)}
`;
}

/* ---------------- reinicio do servidor (modo git) ---------------- */
function reiniciarServidor() {
  progresso = { fase: 'reiniciando' };
  if (process.env.INVOCATION_ID) {                  // rodando pelo systemd: ele sobe de novo
    setTimeout(() => process.exit(0), 800);
    return;
  }
  // um node pequeno espera a porta liberar e sobe o servidor de novo, sem depender de shell
  const servidor = path.join(RAIZ, 'server.js');
  const codigo = `setTimeout(()=>{require('child_process').spawn(process.execPath,[${JSON.stringify(servidor)}],{cwd:${JSON.stringify(RAIZ)},detached:true,stdio:'ignore',windowsHide:true}).unref()},2500)`;
  spawn(process.execPath, ['-e', codigo], { cwd: RAIZ, detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).unref();
  setTimeout(() => process.exit(0), 800);
}

let aplicando = false;
async function aplicar() {
  if (aplicando) return { ok: true, fase: progresso.fase };
  const info = await verificar(true);
  if (!info.atual) throw new Error('nao consegui ler a versao instalada (package.json)');
  if (!info.temNova) throw new Error(`voce ja esta na versao mais nova (${info.atual})`);
  if (!info.podeAplicar) {
    throw new Error(info.modo === 'windows-portatil'
      ? 'na versao portatil a atualizacao e manual: baixe o zip novo na pagina da versao'
      : 'nesta forma de instalacao a atualizacao e manual: veja a pagina da versao');
  }
  aplicando = true;
  (async () => {
    try {
      if (info.modo === 'windows-instalado') {
        const { destino } = await baixar(info.instalador);
        const ps1 = path.join(TMP, 'aplicar.ps1');
        fs.writeFileSync(ps1, scriptWindows({ setup: destino, de: info.atual, para: info.nova }), 'ascii');
        try { fs.unlinkSync(RESULTADO); } catch (e) { }
        progresso = { fase: 'instalando', para: info.nova };
        spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1],
          { detached: true, stdio: 'ignore', windowsHide: true, cwd: TMP }).unref();
        setTimeout(() => process.exit(0), 1500);   // solta o node.exe pra o Setup poder trocar ele
      } else if (info.modo === 'git') {
        progresso = { fase: 'instalando', para: info.nova };
        await new Promise((ok, falha) => execFile('git', ['pull', '--ff-only'], { cwd: RAIZ, windowsHide: true },
          (e, so, se) => (e ? falha(new Error('git pull falhou: ' + String(se || e.message).trim().slice(0, 200))) : ok(so))));
        fs.mkdirSync(TMP, { recursive: true });
        fs.writeFileSync(RESULTADO, JSON.stringify({ ok: true, codigo: 0, de: info.atual, para: info.nova, t: Date.now() }));
        reiniciarServidor();
      }
    } catch (e) {
      aplicando = false;
      progresso = { fase: 'erro', msg: String(e.message || e).slice(0, 300) };
    }
  })();
  return { ok: true, fase: 'comecou' };
}

module.exports = { estado, verificar, aplicar, versaoLocal, modo, comparar };
