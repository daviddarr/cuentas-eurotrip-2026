// Lógica pura (sin DOM). Todos los montos se manejan en centavos enteros.
(function (root) {
  function ownerOf(people, id) {
    var p = people.find(function (x) { return x.id === id; });
    if (p && p.guardianId && people.some(function (x) { return x.id === p.guardianId; })) return p.guardianId;
    return id;
  }

  // Reparte un pago entre participantes (cada uno = 1 parte). Devuelve [{id, cents}]
  function shares(e) {
    var ids = e.participants.filter(function (id) { return id !== e.payerId; });
    if (e.includePayer) ids.push(e.payerId);
    var n = ids.length;
    if (!n) return [];
    var base = Math.floor(e.amount / n), rem = e.amount - base * n;
    return ids.map(function (id, i) { return { id: id, cents: base + (i < rem ? 1 : 0) }; });
  }

  // Agrupa las partes por quien responde (responsable en caso de dependientes)
  function byOwner(people, e) {
    var map = {}, order = [];
    shares(e).forEach(function (s) {
      var o = ownerOf(people, s.id);
      if (!map[o]) { map[o] = { owner: o, cents: 0, members: [] }; order.push(o); }
      map[o].cents += s.cents;
      map[o].members.push(s.id);
    });
    return order.map(function (o) { return map[o]; });
  }

  // Lista de deudas generadas por un movimiento: [{debtor, creditor, cents, deferred}]
  function transfers(people, ev) {
    if (ev.type === "settle") return [{ debtor: ev.fromId, creditor: ev.toId, cents: -ev.amount, deferred: !!ev.deferred }];
    return byOwner(people, ev)
      .filter(function (g) { return g.owner !== ev.payerId; })
      .map(function (g) { return { debtor: g.owner, creditor: ev.payerId, cents: g.cents, deferred: !!ev.msi }; });
  }

  function addMonth(ym, k) {
    var p = ym.split("-"), t = parseInt(p[0], 10) * 12 + parseInt(p[1], 10) - 1 + k;
    return Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0");
  }

  // Deuda neta (pagos en una sola exhibición). net(a,b): cuánto le debe a a b (negativo = b le debe a a)
  function ledger(state) {
    var owed = {};
    state.events.forEach(function (ev) {
      transfers(state.people, ev).forEach(function (t) {
        if (t.deferred) return;
        owed[t.debtor] = owed[t.debtor] || {};
        owed[t.debtor][t.creditor] = (owed[t.debtor][t.creditor] || 0) + t.cents;
      });
    });
    function get(a, b) { return (owed[a] && owed[a][b]) || 0; }
    return function net(a, b) { return get(a, b) - get(b, a); };
  }

  // Mensualidades pendientes entre a y b (positivo = a debe a b): [{month, cents}] ya descontados los pagos
  function deferredFn(state) {
    var owed = {}, paid = {};
    function add(o, a, b, k, v) { o[a] = o[a] || {}; o[a][b] = o[a][b] || {}; o[a][b][k] = (o[a][b][k] || 0) + v; }
    state.events.forEach(function (ev) {
      transfers(state.people, ev).forEach(function (t) {
        if (!t.deferred) return;
        if (ev.type === "settle") { add(paid, t.debtor, t.creditor, "p", -t.cents); return; }
        var n = ev.msi, base = Math.floor(t.cents / n), rem = t.cents - base * n;
        for (var k = 0; k < n; k++) add(owed, t.debtor, t.creditor, addMonth(ev.start, k), base + (k < rem ? 1 : 0));
      });
    });
    function g(o, a, b, k) { return (o[a] && o[a][b] && o[a][b][k]) || 0; }
    return function (a, b) {
      var months = {};
      [[a, b], [b, a]].forEach(function (x) { Object.keys((owed[x[0]] && owed[x[0]][x[1]]) || {}).forEach(function (m) { months[m] = 1; }); });
      var P = g(paid, a, b, "p") - g(paid, b, a, "p");
      return Object.keys(months).sort().map(function (m) {
        var s = g(owed, a, b, m) - g(owed, b, a, m);
        if (P > 0 && s > 0) { var t = Math.min(P, s); s -= t; P -= t; }
        else if (P < 0 && s < 0) { var u = Math.min(-P, -s); s += u; P += u; }
        return { month: m, cents: s };
      }).filter(function (x) { return x.cents !== 0; });
    };
  }

  // Pares con algo pendiente. Montos positivos = el deudor le debe al acreedor.
  function pairs(state) {
    var net = ledger(state), def = deferredFn(state), out = [], ids = state.people.map(function (p) { return p.id; });
    for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
      var a = ids[i], b = ids[j], n = net(a, b), sched = def(a, b);
      var dt = sched.reduce(function (s, x) { return s + x.cents; }, 0);
      if (!n && !sched.length) continue;
      var tot = n + dt, sign = tot >= 0 ? 1 : -1;
      out.push({
        debtor: sign > 0 ? a : b, creditor: sign > 0 ? b : a, sign: sign,
        net: n * sign, defTotal: dt * sign, total: Math.abs(tot),
        sched: sched.map(function (x) { return { month: x.month, cents: x.cents * sign }; })
      });
    }
    return out;
  }

  // Movimientos que afectan a un par (a,b)
  function pairHistory(state, a, b) {
    return state.events.filter(function (ev) {
      return transfers(state.people, ev).some(function (t) {
        return (t.debtor === a && t.creditor === b) || (t.debtor === b && t.creditor === a);
      });
    });
  }

  // Agrupa mensualidades consecutivas iguales: [{from, to, cents, n}]
  function runs(sched) {
    var out = [];
    sched.forEach(function (x) {
      var l = out[out.length - 1];
      if (l && l.cents === x.cents && addMonth(l.to, 1) === x.month) { l.to = x.month; l.n++; }
      else out.push({ from: x.month, to: x.month, cents: x.cents, n: 1 });
    });
    return out;
  }

  var api = { ownerOf: ownerOf, shares: shares, byOwner: byOwner, transfers: transfers, ledger: ledger, pairs: pairs, pairHistory: pairHistory, addMonth: addMonth, runs: runs };
  if (typeof module !== 'undefined') module.exports = api; else root.Ledger = api;
})(this);
