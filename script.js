// ===== CONFIGURAÇÃO =====
// Cole aqui o link do App da Web do Apps Script (termina em /exec).
// Enquanto estiver vazio, o site funciona em modo prévia com palpites de exemplo.
const API_URL = 'https://script.google.com/macros/s/AKfycbwBzcwS8W239yxR7PXhk2YismPUUknA8OfMJctKwAQUQKVIoDLejUQGrfxxQR5t1eH56Q/exec';
// ========================

const DEMO = !API_URL;
const $ = id => document.getElementById(id);
const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = t => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pctTxt = p => Math.round(p * 100) + '%';

let data = null, filter = 'all', form = { s: null, v: 0, p: 'Metade em dinheiro' }, sending = false;

/* ---------- prévia (sem planilha ligada) ---------- */
const demoState = {
  config: { pix: 'exemplo@email.com', recebedor: 'Thiago', cidade: 'Sao Paulo', revelacao: 'a definir', resultado: '', aberto: true, pctDeposito: 0.5 },
  rows: [
    { id: 'R7KD2A', nome: 'Tia Rose', time: 'Eva', valor: 50, premio: 'Tudo em fralda', pago: true, recado: 'Vai ser uma princesa, eu sinto!' },
    { id: 'C2VQ9B', nome: 'Vô Carlos', time: 'Bento', valor: 100, premio: 'Metade em dinheiro', pago: true, recado: 'Mais um pro futebol de domingo.' },
    { id: 'M9XA3C', nome: 'Marina', time: 'Eva', valor: 20, premio: 'Metade em dinheiro', pago: true, recado: '' },
    { id: 'P4LN7D', nome: 'Pedro', time: 'Bento', valor: 20, premio: 'Metade em dinheiro', pago: false, recado: 'Menino com certeza 😎' },
    { id: 'B8TE5E', nome: 'Dinda Bia', time: 'Eva', valor: 30, premio: 'Tudo em fralda', pago: true, recado: 'Já comprei o primeiro body!' },
    { id: 'F3HU4F', nome: 'Rafa', time: 'Bento', valor: 0, premio: '', pago: false, recado: 'Só palpite mesmo kkk' },
    { id: 'J6WS8G', nome: 'Juliana', time: 'Bento', valor: 10, premio: 'Metade em dinheiro', pago: true, recado: '' }
  ]
};
function demoSummary() {
  const s = demoState, pagos = s.rows.filter(r => r.pago && r.valor > 0), total = pagos.reduce((a, r) => a + r.valor, 0);
  return { ok: true, config: s.config, total, fraldaGarantida: total * (1 - s.config.pctDeposito),
    bento: s.rows.filter(r => r.time === 'Bento').length, eva: s.rows.filter(r => r.time === 'Eva').length,
    mural: s.rows.slice().reverse().map(r => ({ nome: r.nome, time: r.time, recado: r.recado })) };
}
function demoMine(id) {
  const s = demoState, p = s.rows.find(r => r.id === id);
  if (!p) return { ok: false, erro: 'Palpite não encontrado.' };
  return { ok: true, ...p, resultado: '', pctDeposito: s.config.pctDeposito, ganhou: false, deposito: 0, fralda: 0, pix: s.config.pix, recebedor: s.config.recebedor, cidade: s.config.cidade };
}

/* ---------- Pix: código "copia e cola" no padrão do Banco Central ---------- */
function pixField(id, v) { return id + String(v.length).padStart(2, '0') + v; }
function semAcento(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').trim(); }
function pixKey(k) {
  k = String(k || '').trim();
  if (k.includes('@')) return k.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase();
  if (k.startsWith('+')) return '+' + k.replace(/\D/g, '');
  const d = k.replace(/\D/g, '');
  return (d.length === 11 || d.length === 14) ? d : k;
}
function crc16(s) {
  let crc = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function pixPayload({ chave, nome, cidade, valor, txid }) {
  const conta = pixField('00', 'br.gov.bcb.pix') + pixField('01', pixKey(chave));
  let s = pixField('00', '01') + pixField('26', conta) + pixField('52', '0000') + pixField('53', '986');
  if (valor > 0) s += pixField('54', Number(valor).toFixed(2));
  s += pixField('58', 'BR') + pixField('59', (semAcento(nome) || 'BEBEBET').slice(0, 25)) + pixField('60', (semAcento(cidade) || 'BRASIL').slice(0, 15));
  s += pixField('62', pixField('05', (String(txid || '').replace(/[^A-Za-z0-9]/g, '') || '***').slice(0, 25)));
  s += '6304';
  return s + crc16(s);
}
const pixPronto = c => c && c.pix && !/preencher/i.test(c.pix);
const cidadeOk = c => c && c.cidade && !/preencher/i.test(c.cidade) ? c.cidade : 'BRASIL';
function qrSvg(texto) {
  const qr = qrcode(0, 'M'); qr.addData(texto); qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}
function pixBoxHtml(c, valor, id) {
  if (!pixPronto(c)) return '<div class="status w">Os organizadores ainda vão informar a chave Pix. Volte por aqui em breve pelo seu link "meu palpite".</div>';
  const code = pixPayload({ chave: c.pix, nome: c.recebedor, cidade: cidadeOk(c), valor, txid: 'BEBEBET' + id });
  return `<div class="amount num">${brl(valor)}</div>
    <button class="cta copypix" data-code="${esc(code)}" style="margin-top:6px">📋 Copiar Pix copia e cola</button>
    <div class="pixhow">Abra o app do seu banco › Pix › <b>Pix copia e cola</b> › cole. O valor já vem preenchido.</div>
    <details class="qrbox"><summary>Pagar por QR Code (outro aparelho)</summary><div class="qr">${qrSvg(code)}</div></details>
    <div class="pixkey">Chave Pix: <b>${esc(c.pix)}</b>${c.recebedor ? ' · ' + esc(c.recebedor) : ''}</div>`;
}

/* ---------- comunicação com a planilha ---------- */
async function apiGet(params) {
  if (DEMO) return params && params.id ? demoMine(params.id) : demoSummary();
  const url = API_URL + (params ? '?' + new URLSearchParams(params) : '');
  const r = await fetch(url);
  return r.json();
}
async function apiPost(body) {
  if (DEMO) {
    const id = Math.random().toString(36).slice(2, 8).toUpperCase();
    demoState.rows.push({ id, nome: body.nome, time: body.time, valor: body.valor, premio: body.valor ? body.premio : '', pago: false, recado: body.recado });
    return { ok: true, id };
  }
  // text/plain evita o bloqueio de CORS do Apps Script
  const r = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) });
  return r.json();
}

/* ---------- meus palpites guardados neste celular ---------- */
function myIds() { try { return JSON.parse(localStorage.getItem('bebebet_ids') || '[]'); } catch (e) { return []; } }
function saveId(id) { try { const l = myIds(); l.push(id); localStorage.setItem('bebebet_ids', JSON.stringify(l)); } catch (e) {} }
const myLink = id => location.origin + location.pathname + '?meu=' + id;

/* ---------- desenho da página ---------- */
function render() {
  if (!data) return;
  const c = data.config, pct = Number(c.pctDeposito) || 0.5;
  $('revData').textContent = c.revelacao || 'a definir';
  $('potT').textContent = brl(data.total);
  $('potF').textContent = brl(data.fraldaGarantida) + ' já garantidos em fralda*';
  $('cntB').textContent = data.bento; $('cntG').textContent = data.eva;
  const tot = data.bento + data.eva, pb = tot ? Math.round(data.bento / tot * 100) : 50;
  $('barB').style.width = pb + '%'; $('pctB').textContent = pb + '% Bento'; $('pctG').textContent = (100 - pb) + '% Eva';
  $('upd').textContent = DEMO ? 'prévia' : 'atualizado agora';

  $('cashTxt').textContent = `${pctTxt(pct)} depositado pra você · ${pctTxt(1 - pct)} vira fralda`;
  $('rule4').innerHTML = `Quem escolher dinheiro recebe <b>${pctTxt(pct)} depositado e ${pctTxt(1 - pct)} vira fralda</b>. Quem escolher fralda converte 100%.`;
  $('footNote').textContent = `* fralda garantida = no mínimo ${pctTxt(1 - pct)} de todo valor pago, mesmo que o acertador escolha dinheiro.`;

  const open = c.aberto && !c.resultado;
  $('liveTxt').textContent = open ? 'Apostas abertas' : 'Apostas encerradas';
  $('liveTag').style.opacity = open ? 1 : .6;
  $('closed').hidden = open;
  if (!open) { $('form').style.display = 'none'; $('pix').style.display = 'none'; }

  const w = $('winner');
  if (c.resultado) {
    const boy = c.resultado === 'Bento';
    w.className = 'winner ' + (boy ? 'boy' : 'girl'); w.style.display = 'block';
    w.innerHTML = `<h2>${boy ? 'É o Bento! 💙' : 'É a Eva! 💗'}</h2><div style="font-weight:700">${boy ? 'Deu menino' : 'Deu menina'}</div><div style="opacity:.9;margin-top:4px">Abra o seu link "meu palpite" para ver se você ganhou.</div>`;
  } else w.style.display = 'none';

  renderList(); renderRet();
  $('myBtn').hidden = !myIds().length;
}

function renderList() {
  const L = data.mural.filter(b => filter === 'all' || b.time === filter);
  $('total').textContent = data.mural.length + (data.mural.length === 1 ? ' pessoa' : ' pessoas');
  $('list').innerHTML = L.length ? L.map(b => {
    const boy = b.time === 'Bento';
    return `<div class="it"><div class="av ${boy ? 'boy' : 'girl'}">${esc((b.nome.trim()[0] || '?').toUpperCase())}</div>
      <div class="mid"><div class="nm">${esc(b.nome)}</div><div class="sub">${boy ? '💙 Time Bento' : '💗 Time Eva'}</div>
      ${b.recado ? `<div class="msg">“${esc(b.recado)}”</div>` : ''}</div></div>`;
  }).join('') : '<div class="empty">Ninguém desse time ainda. Seja o primeiro!</div>';
}

function maskTel(x) {
  const d = x.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? '(' + d : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
const telOk = () => { const n = $('tel').value.replace(/\D/g, '').length; return n === 10 || n === 11; };
function curVal() {
  if (form.v === 'outro') { const x = parseFloat(String($('outro').value).replace(',', '.')); return x > 0 ? Math.round(x * 100) / 100 : 0; }
  return form.v;
}
function renderRet() {
  const v = curVal(), pct = data ? Number(data.config.pctDeposito) || 0.5 : 0.5;
  $('prize').classList.toggle('off', v === 0);
  if (form.v === 'outro' && v > 0 && v < 1) { $('ret').innerHTML = '<b>O valor mínimo é R$ 1,00.</b>'; $('send').disabled = true; return; }
  if (v === 0) $('ret').innerHTML = form.v === 'outro' ? 'Digite o valor que quer apostar (mínimo R$ 1,00).' : '<b>Palpite na faixa!</b> Você entra no mural e na torcida, mas sem prêmio. 😊';
  else {
    const dep = form.p === 'Tudo em fralda' ? 0 : v * pct, fr = v - dep;
    $('ret').innerHTML = `<div class="row"><span>Se você acertar, recebe <b>no mínimo</b></span></div>
      <div class="row">${dep ? `<span class="big num">${brl(dep)}</span><span class="fr num">+ ${brl(fr)} em fralda</span>` : `<span class="big num" style="color:var(--mint)">${brl(fr)} em fralda</span>`}</div>
      <em style="font-size:13px;color:var(--ink);margin-top:8px">É a sua aposta de ${brl(v)} de volta. O dinheiro de quem apostar no time errado é dividido entre quem acertou, então seu prêmio só aumenta a partir daí.</em>`;
  }
  $('send').disabled = sending || !($('nome').value.trim().length >= 2 && telOk() && form.s);
}

/* ---------- meu palpite ---------- */
async function openMine(id) {
  $('mine').classList.add('show');
  $('mineBody').innerHTML = '<div class="empty">Carregando…</div>';
  try {
    const ids = id ? [id] : myIds().slice().reverse();
    const res = await Promise.all(ids.map(x => apiGet({ id: x })));
    $('mineBody').innerHTML = res.map(mineCard).join('') || '<div class="empty">Nenhum palpite encontrado.</div>';
  } catch (e) {
    $('mineBody').innerHTML = '<div class="empty">Não consegui carregar agora. Tente de novo em instantes.</div>';
  }
}
function mineCard(b) {
  if (!b.ok) return `<div class="status z">${esc(b.erro || 'Palpite não encontrado.')}</div>`;
  const pct = Number(b.pctDeposito) || 0.5;
  let st;
  if (b.resultado) {
    if (b.time !== b.resultado) st = `<div class="status z">Deu ${b.resultado === 'Bento' ? 'Bento 💙' : 'Eva 💗'}. Não foi dessa vez, mas obrigado por entrar na torcida!</div>`;
    else if (b.ganhou) st = `<div class="status win">Você acertou! 🎉<b class="num">${brl(b.deposito)}</b>${b.deposito ? 'depositados pra você · ' : ''}<span style="color:#7FE0B6">+ ${brl(b.fralda)} em fralda pro bebê</span></div>`;
    else st = `<div class="status p">Você acertou! 🎉 ${b.valor ? 'Mas o Pix não foi confirmado, então não entrou no prêmio.' : 'Como foi só palpite, fica a glória. 😄'}</div>`;
  } else if (!b.valor) st = '<div class="status z">Palpite na torcida 🍀 Aguardando a revelação.</div>';
  else st = b.pago ? '<div class="status p">✓ Pix confirmado. Você está valendo no bolão!</div>'
    : `<div class="status w">⏳ Aguardando confirmação do Pix pelos organizadores.</div><div class="mypay">${pixBoxHtml(b, b.valor, b.id)}</div>`;
  return `<div class="mycard">
    <div class="row"><span>Nome</span><b>${esc(b.nome)}</b></div>
    <div class="row"><span>Palpite</span><b>${b.time === 'Bento' ? '💙 Time Bento' : '💗 Time Eva'}</b></div>
    <div class="row"><span>Valor</span><b class="num">${b.valor ? brl(b.valor) : 'Só palpite'}</b></div>
    ${b.valor ? `<div class="row"><span>Se ganhar</span><b>${b.premio === 'Tudo em fralda' ? '100% em fralda' : pctTxt(pct) + ' depositado · ' + pctTxt(1 - pct) + ' fralda'}</b></div>` : ''}
  </div>${st}`;
}

/* ---------- eventos ---------- */
document.querySelectorAll('.pick button').forEach(b => b.onclick = () => { form.s = b.dataset.s; document.querySelectorAll('.pick button').forEach(x => x.classList.toggle('on', x === b)); renderRet(); });
document.querySelectorAll('.vals button').forEach(b => b.onclick = () => {
  form.v = b.dataset.v === 'outro' ? 'outro' : +b.dataset.v;
  document.querySelectorAll('.vals button').forEach(x => x.classList.toggle('on', x === b));
  $('outro').style.display = form.v === 'outro' ? 'block' : 'none'; if (form.v === 'outro') $('outro').focus();
  renderRet();
});
document.querySelectorAll('.prize button').forEach(b => b.onclick = () => { form.p = b.dataset.p; document.querySelectorAll('.prize button').forEach(x => x.classList.toggle('on', x === b)); renderRet(); });
['nome', 'outro'].forEach(id => $(id).addEventListener('input', renderRet));
$('tel').addEventListener('input', e => { e.target.value = maskTel(e.target.value); renderRet(); });

$('send').onclick = async () => {
  const v = curVal();
  if (form.v === 'outro' && v < 1) { $('err').textContent = 'O valor mínimo é R$ 1,00. Se preferir, escolha "Só palpite".'; return; }
  if (v > 5000) { $('err').textContent = 'O valor máximo é R$ 5.000.'; return; }
  $('err').textContent = ''; sending = true; $('send').textContent = 'Enviando…'; renderRet();
  try {
    const r = await apiPost({ nome: $('nome').value.trim(), tel: $('tel').value, time: form.s, valor: v, premio: form.p, recado: $('msg').value.trim() });
    if (!r.ok) throw new Error(r.erro || 'Não deu certo.');
    saveId(r.id);
    $('myUrl').textContent = myLink(r.id).replace(/^https?:\/\//, '');
    $('myUrl').dataset.full = myLink(r.id);
    $('openMy').dataset.id = r.id;
    $('form').style.display = 'none'; $('pix').style.display = 'block';
    if (v) {
      $('pixT').textContent = 'Palpite registrado!';
      $('pixP').textContent = 'Agora é só fazer o Pix. Os organizadores confirmam e seu valor entra no bolão.';
      $('pixBox').style.display = 'block'; $('pixBox').innerHTML = pixBoxHtml(data.config, v, r.id);
    } else {
      $('pixT').textContent = 'Palpite na torcida!';
      $('pixP').textContent = 'Seu nome já está no mural. Boa sorte! 🍀';
      $('pixBox').style.display = 'none';
    }
    $('apostar').scrollIntoView({ behavior: 'smooth', block: 'start' });
    load();
  } catch (e) {
    $('err').textContent = (e && e.message) || 'Não consegui enviar. Verifique a internet e tente de novo.';
  } finally {
    sending = false; $('send').textContent = 'Confirmar palpite'; renderRet();
  }
};
$('again').onclick = () => {
  form = { s: null, v: 0, p: 'Metade em dinheiro' };
  ['nome', 'tel', 'msg', 'outro'].forEach(id => $(id).value = ''); $('outro').style.display = 'none';
  document.querySelectorAll('.pick button').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.vals button').forEach(x => x.classList.toggle('on', x.dataset.v === '0'));
  document.querySelectorAll('.prize button').forEach(x => x.classList.toggle('on', x.dataset.p === 'Metade em dinheiro'));
  $('pix').style.display = 'none'; $('form').style.display = 'block'; renderRet();
};
function copy(t, ok) { (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(ok), () => toast('Copie: ' + t)); }
document.addEventListener('click', e => { const b = e.target.closest('.copypix'); if (b) copy(b.dataset.code, 'Pix copiado! Agora cole no app do banco'); });
$('copyMy').onclick = () => copy($('myUrl').dataset.full || '', 'Link copiado! Salve no seu WhatsApp');
$('openMy').onclick = () => openMine($('openMy').dataset.id);
$('myBtn').onclick = () => openMine();
$('closeMine').onclick = () => $('mine').classList.remove('show');
$('mine').onclick = e => { if (e.target.id === 'mine') $('mine').classList.remove('show'); };
document.querySelectorAll('.filters button').forEach(b => b.onclick = () => { filter = b.dataset.f; document.querySelectorAll('.filters button').forEach(x => x.classList.toggle('on', x === b)); renderList(); });
let tt; function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => e.classList.remove('show'), 2000); }

/* ---------- carregar ---------- */
async function load() {
  try {
    const r = await apiGet();
    if (!r.ok) throw new Error();
    data = r; render();
  } catch (e) {
    $('upd').textContent = 'sem conexão';
    if (!data) $('list').innerHTML = '<div class="empty">Não consegui carregar os palpites. Puxe a página para atualizar.</div>';
  }
}
$('demoBar').hidden = !DEMO;
renderRet();
load();
setInterval(load, 60000);
const meu = new URLSearchParams(location.search).get('meu');
if (meu) openMine(meu.toUpperCase());
