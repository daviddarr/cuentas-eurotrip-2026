(function () {
  var KEY = 'cuentas-claras-v1';
  var L = window.Ledger;
  // Modo compartido: si config.js trae dbUrl y el link trae la clave (#k=...), los datos viven en Firebase.
  // Si no, todo se guarda solo en este navegador (localStorage).
  var CFG = window.CC_CONFIG || {};
  var tripKey = (function () {
    var m = /[#&]k=([\w-]+)/.exec(location.hash);
    try { if (m) localStorage.setItem('cc-key', m[1]); return m ? m[1] : localStorage.getItem('cc-key'); } catch (e) { return m && m[1]; }
  })();
  var remote = !!(CFG.dbUrl && tripKey);
  var DB = remote ? CFG.dbUrl.replace(/\/$/, '') + '/trips/' + tripKey : '';
  var state = remote ? { people: [], events: [], log: [] } : load();
  var synced = {}, inflight = 0, online = true;
  var me = '';
  try { me = localStorage.getItem('cc-me') || ''; } catch (e) {}
  var ui = { tab: 'dashboard', who: '', filter: 'all', sort: 'amount-desc', editing: null, settle: null };

  // ---------- utilidades ----------
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  function money(c) { return fmt.format(c / 100); }
  function toCents(v) { return Math.round(parseFloat(v) * 100); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function $(id) { return document.getElementById(id); }
  function person(id) { return state.people.find(function (p) { return p.id === id; }); }
  function name(id) { var p = person(id); return p ? p.name : '(eliminado)'; }
  function isActive(p) { var g = p.guardianId && person(p.guardianId); return p.active && (!g || g.active); }
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && s.people && s.events) { s.log = s.log || []; return s; } } catch (e) {}
    return { people: [], events: [], log: [] };
  }
  function flat(st) {
    var o = {};
    ['people', 'events', 'log'].forEach(function (k) { (st[k] || []).forEach(function (x) { o[k + '/' + x.id] = x; }); });
    return o;
  }
  // Guarda: en local escribe todo; en modo compartido manda solo lo que cambió (una sola operación atómica)
  function save() {
    if (!remote) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('No se pudo guardar en este navegador'); } return; }
    var cur = flat(state), patch = {}, next = {}, n = 0;
    Object.keys(cur).forEach(function (k) { var j = JSON.stringify(cur[k]); next[k] = j; if (synced[k] !== j) { patch[k] = cur[k]; n++; } });
    Object.keys(synced).forEach(function (k) { if (!(k in cur)) { patch[k] = null; n++; } });
    if (!n) return;
    inflight++;
    fetch(DB + '.json', { method: 'PATCH', body: JSON.stringify(patch) }).then(function (r) {
      if (!r.ok) throw 0;
      synced = next; setOnline(true);
    }).catch(function () { setOnline(false); toast('⚠ No se pudo guardar en la nube. Revisa tu conexión y vuelve a intentar.'); })
      .then(function () { inflight--; });
  }
  function normalize(raw) {
    function vals(o) { return o ? Object.keys(o).map(function (k) { return o[k]; }) : []; }
    var st = { people: vals(raw && raw.people), events: vals(raw && raw.events), log: vals(raw && raw.log) };
    st.people.forEach(function (p) { p.guardianId = p.guardianId || null; });
    st.events.forEach(function (e) { if (e.type !== 'settle') e.participants = e.participants || []; });
    st.events.sort(function (a, b) { return (a.date + ' ' + String(1e13 + (a.ts || 0)) + a.id).localeCompare(b.date + ' ' + String(1e13 + (b.ts || 0)) + b.id); });
    st.log.sort(function (a, b) { return a.ts - b.ts; });
    return st;
  }
  var lastSig = null, started = false;
  function pull() {
    if (!remote || inflight) return;
    fetch(DB + '.json?t=' + Date.now()).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (raw) {
      if (inflight) return;
      setOnline(true);
      var sig = JSON.stringify(raw || {});
      if (sig === lastSig) return;
      lastSig = sig;
      state = normalize(raw);
      synced = {}; var f = flat(state); Object.keys(f).forEach(function (k) { synced[k] = JSON.stringify(f[k]); });
      if (!started) { started = true; show(ui.tab); ensureMe(); return; }
      // no pisar lo que la persona está escribiendo
      var busy = ui.tab === 'nuevo' || (ui.tab === 'personas' && document.activeElement && document.activeElement.tagName === 'INPUT');
      if (!busy && !$('settleDialog').open) render();
    }).catch(function () { setOnline(false); });
  }
  function setOnline(v) { online = v; renderBanner(); }
  function renderBanner() {
    var b = $('banner'); if (!remote) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = (online ? '🟢 En línea' : '🔴 Sin conexión') + ' · ' + (me ? '👤 ' + esc(me) : 'sin nombre') + ' <a href="#" id="changeMe">cambiar</a>';
  }
  function ensureMe() {
    renderBanner();
    if (me) return;
    $('meList').innerHTML = state.people.filter(function (p) { return !p.guardianId; }).map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('');
    if (!$('meDialog').open) $('meDialog').showModal();
  }
  $('banner').addEventListener('click', function (e) { if (e.target.id === 'changeMe') { e.preventDefault(); me = ''; ensureMe(); } });
  $('meForm').addEventListener('submit', function () {
    me = $('meName').value.trim();
    try { localStorage.setItem('cc-me', me); } catch (e) {}
    renderBanner();
  });
  // Registro de actividad ("Últimos movimientos")
  function act(text) { state.log.push({ id: uid(), ts: Date.now(), who: me || 'Alguien', text: text }); }
  function ago(ts) {
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'justo ahora'; if (m < 60) return 'hace ' + m + ' min';
    var h = Math.round(m / 60); if (h < 24) return 'hace ' + h + ' h';
    return new Date(ts).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }
  function activityPanel() {
    var items = (state.log || []).slice(-12).reverse();
    if (!items.length) return '';
    return '<div class="panel"><h2>Últimos movimientos</h2><ul class="list">' + items.map(function (x) {
      return '<li><span><b>' + esc(x.who) + '</b> ' + esc(x.text) + '</span><span class="muted">' + ago(x.ts) + '</span></li>';
    }).join('') + '</ul></div>';
  }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2600); }
  function fmtDate(d) { var p = d.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }

  // ---------- pestañas ----------
  function show(tab) {
    ui.tab = tab;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    document.querySelectorAll('.tab').forEach(function (s) { s.hidden = s.id !== 'tab-' + tab; });
    render();
  }
  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { if (b.dataset.tab === 'nuevo') ui.editing = ui.editing; show(b.dataset.tab); } });
  function render() { ({ dashboard: renderDash, nuevo: renderForm, historial: renderHist, personas: renderPeople })[ui.tab](); }

  // ---------- DASHBOARD ----------
  var mfmt = new Intl.DateTimeFormat('es-MX', { month: 'short', year: 'numeric' });
  function mlabel(ym) { var p = ym.split('-'); return mfmt.format(new Date(+p[0], +p[1] - 1, 1)).replace('.', ''); }
  function sgn(v, show) { return show ? (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v)) : money(Math.abs(v)); }
  function cls(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }

  function renderDash() {
    var el = $('tab-dashboard');
    if (!state.people.length) {
      el.innerHTML = '<div class="panel empty">Aún no hay personas.<br><br><button class="btn primary" data-go="personas">Agregar personas</button></div>';
      return;
    }
    if (ui.who && !person(ui.who)) ui.who = '';
    var all = L.pairs(state);
    var last = {};
    state.events.forEach(function (ev) { L.transfers(state.people, ev).forEach(function (t) { last[t.debtor + '|' + t.creditor] = last[t.creditor + '|' + t.debtor] = ev.date + ev.id; }); });

    // m = +1 si, desde la perspectiva de la vista, el otro le debe a la persona filtrada
    var cards = all.map(function (p) {
      if (ui.who) {
        if (p.debtor !== ui.who && p.creditor !== ui.who) return null;
        var m = p.creditor === ui.who ? 1 : -1;
        return { other: m > 0 ? p.debtor : p.creditor, m: m, p: p };
      }
      return { other: p.debtor, m: 1, p: p };
    }).filter(Boolean);

    var tIn = 0, tOut = 0, dIn = 0, dOut = 0;
    cards.forEach(function (c) {
      var t = c.p.net + c.p.defTotal;
      if (c.m > 0) { tIn += t; dIn += c.p.defTotal; } else { tOut += t; dOut += c.p.defTotal; }
    });
    if (ui.filter === 'in') cards = cards.filter(function (c) { return c.m > 0; });
    if (ui.filter === 'out') cards = cards.filter(function (c) { return c.m < 0; });
    cards.sort(function (a, b) {
      switch (ui.sort) {
        case 'amount-asc': return a.p.total - b.p.total;
        case 'name': return name(a.other).localeCompare(name(b.other));
        case 'recent': return (last[b.p.debtor + '|' + b.p.creditor] || '').localeCompare(last[a.p.debtor + '|' + a.p.creditor] || '');
        default: return b.p.total - a.p.total;
      }
    });

    var opts = '<option value="">Todo el grupo</option>' + state.people.filter(function (p) { return !p.guardianId; }).map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === ui.who ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');
    var sorts = [['amount-desc', 'Mayor monto'], ['amount-asc', 'Menor monto'], ['name', 'Nombre (A-Z)'], ['recent', 'Más reciente']];
    var html = '<div class="toolbar">' +
      '<label>Ver cuentas de<select id="fWho">' + opts + '</select></label>' +
      '<label>Ordenar por<select id="fSort">' + sorts.map(function (s) { return '<option value="' + s[0] + '"' + (ui.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label></div>';
    if (ui.who) {
      html += '<div class="stats"><div class="stat"><span>Le deben a ' + esc(name(ui.who)) + '</span><b class="pos">' + money(tIn) + '</b><small class="muted">' + money(dIn) + ' diferidos</small></div>' +
        '<div class="stat"><span>' + esc(name(ui.who)) + ' debe</span><b class="neg">' + money(tOut) + '</b><small class="muted">' + money(dOut) + ' diferidos</small></div>' +
        '<div class="stat"><span>Balance</span><b class="' + (tIn - tOut >= 0 ? 'pos' : 'neg') + '">' + money(tIn - tOut) + '</b></div></div>';
      html += '<div class="chips" style="margin-bottom:14px">' + [['all', 'Todas'], ['in', 'Me deben'], ['out', 'Debo']].map(function (f) {
        return '<button class="chip' + (ui.filter === f[0] ? ' on' : '') + '" data-filter="' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div>';
    } else {
      html += '<div class="stats"><div class="stat"><span>Cuentas abiertas</span><b>' + all.length + '</b></div>' +
        '<div class="stat"><span>Total pendiente</span><b>' + money(all.reduce(function (s, p) { return s + p.total; }, 0)) + '</b></div></div>';
    }
    if (!cards.length) {
      html += '<div class="panel empty">🎉 No hay cuentas abiertas' + (ui.who ? ' para esta vista.' : '.') + '</div>';
    } else {
      html += '<div class="cards">' + cards.map(function (c) {
        var p = c.p, show = !!ui.who;
        var hist = L.pairHistory(state, p.debtor, p.creditor).slice().reverse().slice(0, 6);
        var title = show ? esc(name(ui.who)) + ' → ' + esc(name(c.other)) : esc(name(p.debtor)) + ' → ' + esc(name(p.creditor));
        var sub = show ? (c.m > 0 ? esc(name(c.other)) + ' le debe a ' + esc(name(ui.who)) : esc(name(ui.who)) + ' le debe a ' + esc(name(c.other)))
                       : esc(name(p.debtor)) + ' le debe a ' + esc(name(p.creditor));
        var tot = p.net + p.defTotal;
        var next = p.sched[0];
        function val(v) { return '<b class="' + (show ? cls(c.m * v) : '') + '">' + (v ? sgn(show ? c.m * v : v, show) : '$0.00') + '</b>'; }
        var rows = '<div class="line"><span>Deuda neta</span>' + val(p.net) + '</div>' +
          '<div class="line"><span>Deuda diferida</span>' + val(p.defTotal) + '</div>';
        if (next) rows += '<div class="line"><span>Pago mensual</span><b>' + money(Math.abs(next.cents)) + ' <small class="muted">/mes desde ' + mlabel(next.month) + '</small></b></div>';
        var runsHtml = p.sched.length ? '<details open><summary>Desglose de pagos mensuales</summary><ul class="mini">' + L.runs(p.sched).map(function (r) {
          return '<li><span>' + (r.n === 1 ? mlabel(r.from) : mlabel(r.from) + ' – ' + mlabel(r.to) + ' (' + r.n + ' meses)') + '</span><b>' + money(Math.abs(r.cents)) + (r.n > 1 ? ' /mes' : '') + '</b></li>';
        }).join('') + '</ul></details>' : '';
        var btns = '';
        if (p.net > 0) btns += '<button class="btn ok small" data-settle="' + p.debtor + '|' + p.creditor + '|net">✓ Saldar neta</button>';
        if (next && next.cents > 0) btns += '<button class="btn ok small" data-settle="' + p.debtor + '|' + p.creditor + '|def">✓ Pago mensual</button>';
        return '<div class="card ' + (show ? (c.m > 0 ? 'in' : 'out') : '') + '">' +
          '<div class="who">' + title + '</div><div class="sub">' + sub + '</div>' +
          '<div class="amount ' + (show ? cls(c.m * tot) : '') + '">' + sgn(show ? c.m * tot : tot, show) + ' <small class="muted">total</small></div>' +
          rows + runsHtml +
          '<div class="actions">' + btns + '</div>' +
          '<details><summary>Ver movimientos</summary><ul class="mini">' + hist.map(function (ev) { return '<li><span>' + esc(evLabel(ev)) + '</span><span class="muted">' + fmtDate(ev.date) + '</span></li>'; }).join('') + '</ul></details></div>';
      }).join('') + '</div>';
    }
    el.innerHTML = html + activityPanel();
  }
  function evLabel(ev) {
    if (ev.type === 'settle') return (ev.deferred ? 'Pago mensual' : 'Pago') + ' de ' + name(ev.fromId) + ' a ' + name(ev.toId) + ' · ' + money(ev.amount);
    return ev.desc + (ev.msi ? ' (' + ev.msi + ' MSI)' : '') + ' · ' + money(ev.amount);
  }

  $('tab-dashboard').addEventListener('change', function (e) {
    if (e.target.id === 'fWho') { ui.who = e.target.value; ui.filter = 'all'; renderDash(); }
    if (e.target.id === 'fSort') { ui.sort = e.target.value; renderDash(); }
  });
  $('tab-dashboard').addEventListener('click', function (e) {
    var f = e.target.closest('[data-filter]'); if (f) { ui.filter = f.dataset.filter; renderDash(); }
    var g = e.target.closest('[data-go]'); if (g) show(g.dataset.go);
    var s = e.target.closest('[data-settle]'); if (s) openSettle(s.dataset.settle.split('|'));
  });

  // saldar (neta) o registrar pago mensual (diferida)
  function openSettle(a) {
    var p = L.pairs(state).find(function (x) { return x.debtor === a[0] && x.creditor === a[1]; });
    if (!p) return;
    var def = a[2] === 'def', owed = def ? p.defTotal : p.net;
    if (owed <= 0) return;
    var amt = def ? p.sched[0].cents : owed;
    ui.settle = { debtor: a[0], creditor: a[1], deferred: def };
    $('settleTitle').textContent = def ? 'Registrar pago mensual' : 'Saldar deuda neta';
    $('settleText').innerHTML = '<b>' + esc(name(a[0])) + '</b> le debe <b>' + money(owed) + '</b> ' + (def ? 'diferidos ' : '') + 'a <b>' + esc(name(a[1])) + '</b>.' +
      (def ? '<br>Próxima mensualidad: <b>' + money(amt) + '</b>' : '');
    $('settleAmount').value = (amt / 100).toFixed(2);
    $('settleAmount').max = (owed / 100).toFixed(2);
    $('settleDialog').showModal();
  }
  $('settleCancel').onclick = function () { $('settleDialog').close(); };
  $('settleForm').addEventListener('submit', function () {
    var s = ui.settle, amt = toCents($('settleAmount').value);
    if (!s || !(amt > 0)) return;
    state.events.push({ id: uid(), type: 'settle', date: today(), ts: Date.now(), fromId: s.debtor, toId: s.creditor, amount: amt, deferred: s.deferred });
    act('registró un pago' + (s.deferred ? ' mensual' : '') + ' de ' + name(s.debtor) + ' a ' + name(s.creditor) + ' por ' + money(amt));
    save(); render(); toast('Pago registrado ✓');
  });

  // ---------- NUEVO PAGO ----------
  function renderForm() {
    var el = $('tab-nuevo');
    var active = state.people.filter(isActive);
    var payers = active.filter(function (p) { return !p.guardianId; });
    if (payers.length < 2) {
      el.innerHTML = '<div class="panel empty">Necesitas al menos 2 personas para registrar pagos.<br><br><button class="btn primary" data-go="personas">Ir a Personas</button></div>';
      return;
    }
    var ev = ui.editing && state.events.find(function (x) { return x.id === ui.editing; });
    if (!ev) ui.editing = null;
    var d = ev || { desc: '', amount: '', payerId: payers[0].id, participants: [], includePayer: true, date: today() };
    el.innerHTML = '<form id="expForm" class="panel"><h2>' + (ev ? 'Editar pago' : 'Nuevo pago') + '</h2>' +
      '<label>Descripción<input type="text" id="eDesc" placeholder="Ej. Restaurante lunes" required value="' + esc(d.desc) + '"></label>' +
      '<div class="row"><label>Monto<input type="number" id="eAmount" step="0.01" min="0.01" placeholder="0.00" required value="' + (d.amount ? (d.amount / 100).toFixed(2) : '') + '"></label>' +
      '<label>Fecha<input type="date" id="eDate" required value="' + d.date + '"></label></div>' +
      '<label>¿Quién pagó?<select id="ePayer">' + payers.map(function (p) { return '<option value="' + p.id + '"' + (p.id === d.payerId ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="switch"><input type="checkbox" id="eInc"' + (d.includePayer ? ' checked' : '') + '> Incluir a quien paga en el reparto</label>' +
      '<label class="switch"><input type="checkbox" id="eMsi"' + (d.msi ? ' checked' : '') + '> Pago a meses sin intereses (MSI)</label>' +
      '<div class="row" id="eMsiBox"' + (d.msi ? '' : ' hidden') + '><label>Número de meses<select id="eMonths">' + [3, 6, 9, 12, 18, 24].concat(d.msi && [3, 6, 9, 12, 18, 24].indexOf(d.msi) < 0 ? [d.msi] : []).sort(function (a, b) { return a - b; }).map(function (n) { return '<option value="' + n + '"' + (n === (d.msi || 9) ? ' selected' : '') + '>' + n + ' meses</option>'; }).join('') + '</select></label>' +
      '<label>Primera mensualidad<select id="eStart">' + startOptions(d.start || d.date.slice(0, 7)) + '</select></label></div>' +
      '<div class="row" style="justify-content:space-between;margin-bottom:0"><label style="margin:0">¿A quiénes se reparte?</label><span style="flex:none"><button type="button" class="btn ghost small" id="eAll">Todos</button> <button type="button" class="btn ghost small" id="eNone">Ninguno</button></span></div>' +
      '<div class="checks" id="eParts"></div>' +
      '<div class="preview" id="ePreview"></div>' +
      '<div class="row end">' + (ev ? '<button type="button" class="btn ghost" id="eCancel">Cancelar</button>' : '') + '<button class="btn primary" type="submit">' + (ev ? 'Guardar cambios' : 'Registrar pago') + '</button></div></form>';
    el._sel = d.participants.slice();
    drawParts(active);
    preview();
  }
  function drawParts() {
    var el = $('tab-nuevo'), payer = $('ePayer').value;
    el._sel = el._sel.filter(function (id) { return id !== payer; });
    $('eParts').innerHTML = state.people.filter(function (p) { return isActive(p) && p.id !== payer; }).map(function (p) {
      var g = p.guardianId ? ' <span class="muted">(de ' + esc(name(p.guardianId)) + ')</span>' : '';
      return '<label class="check"><input type="checkbox" value="' + p.id + '"' + (el._sel.indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + esc(p.name) + g + '</label>';
    }).join('');
  }
  function startOptions(sel) {
    var base = today().slice(0, 7), out = '', seen = false;
    for (var k = -2; k < 18; k++) { var m = L.addMonth(base, k); if (m === sel) seen = true; out += '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' + mlabel(m) + '</option>'; }
    return seen ? out : '<option value="' + sel + '" selected>' + mlabel(sel) + '</option>' + out;
  }
  function formEvent() {
    var el = $('tab-nuevo');
    return { desc: $('eDesc').value.trim(), amount: toCents($('eAmount').value) || 0, payerId: $('ePayer').value, participants: el._sel.slice(), includePayer: $('eInc').checked, date: $('eDate').value,
      msi: $('eMsi').checked ? parseInt($('eMonths').value, 10) : 0, start: $('eStart').value };
  }
  function preview() {
    var e = formEvent(), box = $('ePreview');
    $('eMsiBox').hidden = !e.msi;
    var groups = L.byOwner(state.people, e);
    if (!groups.length || !e.amount) { box.innerHTML = 'Elige el monto y a quiénes se reparte para ver cuánto le toca a cada quien.'; return; }
    var parts = L.shares(e).length;
    box.innerHTML = 'Se divide entre <b>' + parts + '</b> ' + (parts === 1 ? 'parte' : 'partes') + ':<ul>' + groups.map(function (g) {
      var extra = g.members.length > 1 ? ' <span class="muted">(' + g.members.map(function (m) { return esc(name(m)); }).join(' + ') + ')</span>' : '';
      var note = g.owner === e.payerId ? ' <span class="muted">— su propia parte, no genera deuda</span>' : '';
      return '<li><b>' + esc(name(g.owner)) + '</b>' + extra + ': ' + money(g.cents) + note + (e.msi && g.owner !== e.payerId ? ' → <b>' + money(Math.floor(g.cents / e.msi)) + '/mes</b> × ' + e.msi + ' meses' : '') + '</li>';
    }).join('') + '</ul>';
  }
  $('tab-nuevo').addEventListener('input', function (e) {
    if (e.target.matches('#eParts input')) {
      var el = $('tab-nuevo');
      el._sel = Array.prototype.map.call(document.querySelectorAll('#eParts input:checked'), function (i) { return i.value; });
    }
    if (document.getElementById('expForm')) preview();
  });
  $('tab-nuevo').addEventListener('change', function (e) {
    if (e.target.id === 'ePayer') { drawParts(); preview(); }
  });
  $('tab-nuevo').addEventListener('click', function (e) {
    var el = $('tab-nuevo');
    if (e.target.id === 'eAll') { el._sel = state.people.filter(function (p) { return isActive(p) && p.id !== $('ePayer').value; }).map(function (p) { return p.id; }); drawParts(); preview(); }
    if (e.target.id === 'eNone') { el._sel = []; drawParts(); preview(); }
    if (e.target.id === 'eCancel') { ui.editing = null; show('historial'); }
    var g = e.target.closest('[data-go]'); if (g) show(g.dataset.go);
  });
  $('tab-nuevo').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = formEvent();
    if (!f.desc || f.amount <= 0) return;
    if (!f.msi) { delete f.msi; delete f.start; }
    if (!L.shares(f).length) { toast('Elige al menos a una persona para repartir'); return; }
    if (ui.editing) {
      var ev = state.events.find(function (x) { return x.id === ui.editing; });
      delete ev.msi; delete ev.start; Object.assign(ev, f); ui.editing = null; act('editó "' + f.desc + '" (' + money(f.amount) + ')'); save(); toast('Pago actualizado ✓'); show('historial');
    } else {
      f.id = uid(); f.type = 'expense'; f.ts = Date.now(); state.events.push(f);
      act('registró "' + f.desc + '" por ' + money(f.amount) + ', pagó ' + name(f.payerId) + (f.msi ? ' a ' + f.msi + ' MSI' : '')); save(); toast('Pago registrado ✓'); renderForm();
    }
  });

  // ---------- HISTORIAL ----------
  function renderHist() {
    var el = $('tab-historial');
    if (!state.events.length) { el.innerHTML = '<div class="panel empty">Aún no hay movimientos.</div>'; return; }
    var evs = state.events.slice().sort(function (a, b) { return (b.date + b.id).localeCompare(a.date + a.id); });
    el.innerHTML = '<div class="panel"><h2>Historial</h2><ul class="list">' + evs.map(function (ev) {
      if (ev.type === 'settle') {
        return '<li class="ev"><div><div class="title">✅ ' + (ev.deferred ? 'Pago mensual: ' : 'Pago: ') + esc(name(ev.fromId)) + ' → ' + esc(name(ev.toId)) + '</div><div class="muted">' + fmtDate(ev.date) + (ev.deferred ? ' · Deuda diferida' : ' · Deuda neta') + '</div></div>' +
          '<div><b class="pos">' + money(ev.amount) + '</b> <button class="btn danger small" data-del="' + ev.id + '">Eliminar</button></div></li>';
      }
      var groups = L.byOwner(state.people, ev);
      var detail = groups.map(function (g) { return esc(name(g.owner)) + (g.members.length > 1 ? ' (+dep.)' : '') + ' ' + money(g.cents); }).join(' · ');
      return '<li class="ev"><div><div class="title">' + esc(ev.desc) + (ev.msi ? '<span class="tag">' + ev.msi + ' MSI desde ' + mlabel(ev.start) + '</span>' : '') + '</div><div class="muted">' + fmtDate(ev.date) + ' · Pagó ' + esc(name(ev.payerId)) + (ev.includePayer ? '' : ' (sin incluirse)') + '</div><div class="muted">' + detail + '</div></div>' +
        '<div><b>' + money(ev.amount) + '</b> <button class="btn ghost small" data-edit="' + ev.id + '">Editar</button> <button class="btn danger small" data-del="' + ev.id + '">Eliminar</button></div></li>';
    }).join('') + '</ul></div>';
  }
  $('tab-historial').addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]');
    if (d && confirm('¿Eliminar este movimiento? Los saldos se recalcularán.')) {
      var gone = state.events.find(function (x) { return x.id === d.dataset.del; });
      if (gone) act('eliminó ' + (gone.type === 'settle' ? 'un pago de ' + name(gone.fromId) + ' a ' + name(gone.toId) : '"' + gone.desc + '"') + ' (' + money(gone.amount) + ')');
      state.events = state.events.filter(function (x) { return x.id !== d.dataset.del; }); save(); renderHist(); toast('Eliminado');
    }
    var ed = e.target.closest('[data-edit]'); if (ed) { ui.editing = ed.dataset.edit; show('nuevo'); }
  });

  // ---------- PERSONAS ----------
  function renderPeople() {
    var el = $('tab-personas');
    var guardians = state.people.filter(function (p) { return !p.guardianId; });
    var activeG = guardians.filter(function (p) { return p.active; });
    var net = L.ledger(state);
    function hasHistory(id) { return state.events.some(function (ev) { return ev.payerId === id || ev.participants && ev.participants.indexOf(id) >= 0 || ev.fromId === id || ev.toId === id; }); }
    function row(p, dep) {
      var open = state.people.some(function (q) { return q.id !== p.id && net(p.id, q.id) !== 0; });
      return '<li class="' + (dep ? 'dep' : '') + '"><div>' + (dep ? '↳ ' : '') + '<b>' + esc(p.name) + '</b>' + (dep ? '<span class="tag">dependiente</span>' : '') + (p.active ? '' : '<span class="tag off">de baja</span>') + (open ? '<span class="tag">cuenta abierta</span>' : '') + '</div><div>' +
        (p.active ? '<button class="btn ghost small" data-baja="' + p.id + '">Dar de baja</button>' : '<button class="btn ghost small" data-alta="' + p.id + '">Reactivar</button>') +
        (hasHistory(p.id) ? '' : ' <button class="btn danger small" data-rm="' + p.id + '">Eliminar</button>') + '</div></li>';
    }
    var html = '<div class="panel"><h2>Agregar persona</h2><form id="pForm"><div class="row"><label>Nombre<input type="text" id="pName" placeholder="Ej. Andrea" required></label>' +
      '<label>¿Es dependiente de alguien?<select id="pGuard"><option value="">No, es independiente</option>' + activeG.map(function (p) { return '<option value="' + p.id + '">Sí, de ' + esc(p.name) + '</option>'; }).join('') + '</select></label></div>' +
      '<small class="muted">Los dependientes (hijos, etc.) aparecen en los repartos, pero su parte se le cobra a su responsable.</small>' +
      '<div class="row end" style="margin-top:12px"><button class="btn primary" type="submit">Agregar</button></div></form></div>';
    html += '<div class="panel"><h2>Personas</h2>' + (guardians.length ? '<ul class="list">' + guardians.map(function (g) {
      return row(g, false) + state.people.filter(function (d) { return d.guardianId === g.id; }).map(function (d) { return row(d, true); }).join('');
    }).join('') + '</ul>' : '<div class="empty">Todavía no hay nadie. Agrega a la primera persona arriba.</div>') + '</div>';
    html += '<div class="panel"><h2>Respaldo de datos</h2><p class="muted">' + (remote ? 'Los datos están en la nube y todos los ven. Exporta un respaldo de vez en cuando por si acaso.' : 'La información vive en este navegador. Para pasarla a otra computadora, exporta un archivo e impórtalo allá.') + '</p>' +
      '<div class="row"><button class="btn ghost" id="bExport">⬇ Exportar respaldo</button><button class="btn ghost" id="bImport">⬆ Importar respaldo</button>' + (remote ? '' : '<button class="btn danger" id="bReset">Borrar todo</button>') + '</div>' +
      '<input type="file" id="fImport" accept="application/json" hidden></div>';
    el.innerHTML = html;
  }
  $('tab-personas').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = $('pName').value.trim(); if (!n) return;
    if (state.people.some(function (p) { return p.name.toLowerCase() === n.toLowerCase(); })) { toast('Ya existe alguien con ese nombre'); return; }
    state.people.push({ id: uid(), name: n, guardianId: $('pGuard').value || null, active: true });
    act('agregó a ' + n + ($('pGuard').value ? ' (dependiente de ' + name($('pGuard').value) + ')' : ''));
    save(); renderPeople(); toast('Agregado ✓');
  });
  $('tab-personas').addEventListener('click', function (e) {
    var t = e.target;
    var b = t.closest('[data-baja]'), a = t.closest('[data-alta]'), r = t.closest('[data-rm]');
    if (b) {
      var p = person(b.dataset.baja), net = L.ledger(state);
      var open = state.people.some(function (q) { return q.id !== p.id && net(p.id, q.id) !== 0; });
      if (open && !confirm(p.name + ' tiene cuentas abiertas. Se ocultará de nuevos pagos pero sus saldos se conservan. ¿Continuar?')) return;
      p.active = false; act('dio de baja a ' + p.name); save(); renderPeople();
    }
    if (a) { person(a.dataset.alta).active = true; act('reactivó a ' + name(a.dataset.alta)); save(); renderPeople(); }
    if (r && confirm('¿Eliminar definitivamente a esta persona?')) {
      var id = r.dataset.rm;
      act('eliminó a ' + name(id));
      state.people = state.people.filter(function (x) { return x.id !== id; });
      state.people.forEach(function (x) { if (x.guardianId === id) x.guardianId = null; });
      save(); renderPeople();
    }
    if (t.id === 'bExport') {
      var blob = new Blob([JSON.stringify({ people: state.people, events: state.events, log: state.log, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
      var link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'cuentas-eurotrip-respaldo-' + today() + '.json'; link.click();
    }
    if (t.id === 'bImport') $('fImport').click();
    if (t.id === 'bReset' && confirm('Esto borra TODAS las personas y pagos. ¿Seguro?')) { state = { people: [], events: [], log: [] }; save(); renderPeople(); toast('Datos borrados'); }
  });
  $('tab-personas').addEventListener('change', function (e) {
    if (e.target.id !== 'fImport' || !e.target.files[0]) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var s = JSON.parse(rd.result);
        if (!s.people || !s.events) throw 0;
        if (!confirm('Esto reemplazará los datos actuales por los del archivo. ¿Continuar?')) return;
        s.log = s.log || []; state = s; act('importó un respaldo'); save(); renderPeople(); toast('Respaldo importado ✓');
      } catch (err) { toast('Archivo no válido'); }
    };
    rd.readAsText(e.target.files[0]);
  });

  renderBanner();
  if (remote) {
    pull();
    setInterval(pull, 5000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) pull(); });
    $('tab-dashboard').innerHTML = '<div class="panel empty">Cargando…</div>';
  } else {
    show('dashboard');
  }
})();
