/**
 * BEBEBET – ponte entre o site e a planilha.
 * Projeto do Apps Script ligado à planilha BEBEBET pelo ID. Implantado como "App da Web".
 *
 * GET  (sem parâmetros)  -> total arrecadado, contagem por time, mural (sem telefones e sem valores)
 * GET  ?id=XXXXXX        -> "meu palpite" de uma pessoa (status do Pix e prêmio)
 * POST {nome, tel, time, valor, premio, recado} -> grava um palpite novo
 */

const PLANILHA_ID = '1r4hXr34_EmFCe8cQ9D6Nf5ryvuXTEd0aus6wO5GynLU';
const ABA_PALPITES = 'Palpites';
const ABA_CONFIG = 'Config';

function doGet(e) {
  const ss = SpreadsheetApp.openById(PLANILHA_ID);
  const cfg = lerConfig_(ss);
  const lista = lerPalpites_(ss);
  const id = e && e.parameter && e.parameter.id;
  if (id) return json_(meuPalpite_(String(id).toUpperCase(), lista, cfg));

  const pagos = lista.filter(p => p.pago && p.valor > 0);
  const total = soma_(pagos);
  return json_({
    ok: true,
    config: {
      pix: cfg.pix, recebedor: cfg.recebedor, cidade: cfg.cidade, revelacao: cfg.revelacao,
      resultado: cfg.resultado, aberto: cfg.aberto, pctDeposito: cfg.pct
    },
    total: arred_(total),
    fraldaGarantida: arred_(total * (1 - cfg.pct)),
    bento: lista.filter(p => p.time === 'Bento').length,
    eva: lista.filter(p => p.time === 'Eva').length,
    mural: lista.slice().reverse().map(p => ({ nome: p.nome, time: p.time, recado: p.recado }))
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let d;
    try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, erro: 'Dados inválidos.' }); }

    const ss = SpreadsheetApp.openById(PLANILHA_ID);
    if (d && d.acao) return json_(admin_(ss, d));

    const cfg = lerConfig_(ss);
    if (!cfg.aberto) return json_({ ok: false, erro: 'Os palpites estão encerrados.' });

    const nome = limpa_(d.nome, 40);
    const tel = String(d.tel || '').replace(/\D/g, '');
    const time = d.time === 'Bento' || d.time === 'Eva' ? d.time : '';
    const valor = Math.round(Number(d.valor) * 100) / 100;
    const premio = d.premio === 'Tudo em fralda' ? 'Tudo em fralda' : 'Metade em dinheiro';
    const recado = limpa_(d.recado, 140);

    if (nome.length < 2) return json_({ ok: false, erro: 'Digite seu nome.' });
    if (tel.length < 10 || tel.length > 11) return json_({ ok: false, erro: 'WhatsApp inválido.' });
    if (!time) return json_({ ok: false, erro: 'Escolha o Time Bento ou o Time Eva.' });
    if (!(valor === 0 || (valor >= 1 && valor <= 5000))) return json_({ ok: false, erro: 'O valor mínimo é R$ 1,00.' });

    const id = novoId_();
    const telFmt = tel.length === 11
      ? '(' + tel.slice(0, 2) + ') ' + tel.slice(2, 7) + '-' + tel.slice(7)
      : '(' + tel.slice(0, 2) + ') ' + tel.slice(2, 6) + '-' + tel.slice(6);

    const sh = ss.getSheetByName(ABA_PALPITES);
    const linha = ultimaLinha_(sh) + 1;
    sh.getRange(linha, 1, 1, 9).setValues([[
      id, new Date(), nome, telFmt, time, valor, valor > 0 ? premio : '', recado, valor > 0 ? 'NÃO' : ''
    ]]);
    return json_({ ok: true, id: id });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- painel dos organizadores (/admin) ---------- */

function admin_(ss, d) {
  const cache = CacheService.getScriptCache();
  if (cache.get('bloqueado')) return { ok: false, erro: 'Muitas tentativas erradas. Tente de novo em 10 minutos.' };
  const senha = String(ss.getSheetByName(ABA_CONFIG).getRange('B11').getDisplayValue()).trim();
  if (!senha || String(d.senha || '') !== senha) {
    const n = Number(cache.get('falhas') || 0) + 1;
    cache.put('falhas', String(n), 600);
    if (n >= 8) cache.put('bloqueado', '1', 600);
    Utilities.sleep(800);
    return { ok: false, erro: 'Senha incorreta.', senhaErrada: true };
  }
  const sh = ss.getSheetByName(ABA_PALPITES);
  const cfgSh = ss.getSheetByName(ABA_CONFIG);
  const linhaDoId = id => {
    const n = ultimaLinha_(sh);
    if (n < 2) return 0;
    const ids = sh.getRange(2, 1, n - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim().toUpperCase() === String(id).toUpperCase()) return i + 2;
    return 0;
  };

  if (d.acao === 'pago') {
    const l = linhaDoId(d.id);
    if (!l) return { ok: false, erro: 'Palpite não encontrado.' };
    sh.getRange(l, 9).setValue(d.pago ? 'SIM' : 'NÃO');
  } else if (d.acao === 'apagar') {
    const l = linhaDoId(d.id);
    if (!l) return { ok: false, erro: 'Palpite não encontrado.' };
    sh.deleteRow(l);
  } else if (d.acao === 'config') {
    if (typeof d.aberto === 'boolean') cfgSh.getRange('B6').setValue(d.aberto ? 'SIM' : 'NÃO');
    if (typeof d.revelacao === 'string') cfgSh.getRange('B4').setValue("'" + limpa_(d.revelacao, 60).replace(/^'/, ''));
    if (typeof d.resultado === 'string') cfgSh.getRange('B5').setValue(d.resultado === 'Bento' || d.resultado === 'Eva' ? d.resultado : '');
  } else if (d.acao !== 'lista') {
    return { ok: false, erro: 'Ação desconhecida.' };
  }
  SpreadsheetApp.flush();
  return painel_(ss);
}

function painel_(ss) {
  const cfg = lerConfig_(ss);
  const sh = ss.getSheetByName(ABA_PALPITES);
  const n = ultimaLinha_(sh);
  const linhas = n < 2 ? [] : sh.getRange(2, 1, n - 1, 9).getValues().filter(r => String(r[0]).trim() !== '');
  const tz = ss.getSpreadsheetTimeZone();
  const lista = linhas.map(r => ({
    id: String(r[0]).trim().toUpperCase(),
    data: r[1] instanceof Date ? Utilities.formatDate(r[1], tz, 'dd/MM HH:mm') : String(r[1]),
    nome: String(r[2]), tel: String(r[3]), time: String(r[4]), valor: Number(r[5]) || 0,
    premio: String(r[6]), recado: String(r[7]), pago: String(r[8]).trim().toUpperCase() === 'SIM'
  }));
  const pagos = lista.filter(p => p.pago && p.valor > 0);
  const total = soma_(pagos);
  let ganhadores = [], depositar = 0, fralda = cfg.resultado ? total : 0;
  if (cfg.resultado) {
    const doTime = soma_(pagos.filter(p => p.time === cfg.resultado));
    if (doTime > 0) {
      fralda = 0;
      ganhadores = pagos.filter(p => p.time === cfg.resultado).map(p => {
        const bruto = p.valor / doTime * total;
        const dep = p.premio === 'Tudo em fralda' ? 0 : bruto * cfg.pct;
        depositar += dep; fralda += bruto - dep;
        return { id: p.id, nome: p.nome, tel: p.tel, valor: p.valor, premio: p.premio, deposito: arred_(dep), fralda: arred_(bruto - dep) };
      });
    }
  }
  return {
    ok: true,
    config: { pix: cfg.pix, recebedor: cfg.recebedor, revelacao: cfg.revelacao, resultado: cfg.resultado, aberto: cfg.aberto, pctDeposito: cfg.pct },
    total: arred_(total),
    pendente: arred_(soma_(lista.filter(p => !p.pago && p.valor > 0))),
    lista: lista.reverse(),
    ganhadores: ganhadores, depositar: arred_(depositar), fralda: arred_(fralda),
    planilha: 'https://docs.google.com/spreadsheets/d/' + PLANILHA_ID + '/edit'
  };
}

/* ---------- leitura ---------- */

function lerConfig_(ss) {
  const v = ss.getSheetByName(ABA_CONFIG).getRange('B2:B9').getDisplayValues().map(r => String(r[0]).trim());
  const pctBruto = ss.getSheetByName(ABA_CONFIG).getRange('B7').getValue();
  const pct = Number(pctBruto);
  return {
    pix: v[0], recebedor: v[1], revelacao: v[2], cidade: v[7],
    resultado: v[3] === 'Bento' || v[3] === 'Eva' ? v[3] : '',
    aberto: v[4].toUpperCase() === 'SIM',
    pct: pct >= 0 && pct <= 1 ? pct : 0.5
  };
}

function lerPalpites_(ss) {
  const sh = ss.getSheetByName(ABA_PALPITES);
  const n = ultimaLinha_(sh);
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 9).getValues()
    .filter(r => String(r[0]).trim() !== '')
    .map(r => ({
      id: String(r[0]).trim().toUpperCase(), nome: String(r[2]), time: String(r[4]),
      valor: Number(r[5]) || 0, premio: String(r[6]), recado: String(r[7]),
      pago: String(r[8]).trim().toUpperCase() === 'SIM'
    }));
}

function meuPalpite_(id, lista, cfg) {
  const p = lista.find(x => x.id === id);
  if (!p) return { ok: false, erro: 'Palpite não encontrado.' };
  const r = { ok: true, id: p.id, nome: p.nome, time: p.time, valor: p.valor, premio: p.premio, pago: p.pago,
              resultado: cfg.resultado, pctDeposito: cfg.pct, deposito: 0, fralda: 0, ganhou: false,
              pix: cfg.pix, recebedor: cfg.recebedor, cidade: cfg.cidade };
  if (cfg.resultado && p.time === cfg.resultado && p.pago && p.valor > 0) {
    const pagos = lista.filter(x => x.pago && x.valor > 0);
    const total = soma_(pagos);
    const doTime = soma_(pagos.filter(x => x.time === cfg.resultado));
    const bruto = p.valor / doTime * total;
    const dep = p.premio === 'Tudo em fralda' ? 0 : bruto * cfg.pct;
    r.ganhou = true; r.deposito = arred_(dep); r.fralda = arred_(bruto - dep);
  }
  return r;
}

/* ---------- utilidades ---------- */

function ultimaLinha_(sh) {
  const col = sh.getRange('A:A').getValues();
  for (let i = col.length - 1; i >= 0; i--) if (String(col[i][0]).trim() !== '') return i + 1;
  return 1;
}
function soma_(l) { return l.reduce((a, p) => a + p.valor, 0); }
function arred_(x) { return Math.round(x * 100) / 100; }
function limpa_(t, max) {
  let s = String(t || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // impede que o texto vire fórmula na planilha
  return s;
}
function novoId_() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
