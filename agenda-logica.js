// ===================== LÓGICA DE PROJEÇÃO DA FILA (compartilhada) =====================
// Extraído do index.html (Agenda de Produção) pra ser reaproveitado por outras páginas
// do mesmo site (ex: agenda-papel-ondulados.html) sem duplicar/perder sincronia com a
// lógica original. Qualquer ajuste de capacidade/setup deve ser feito aqui E no
// index.html continuar puxando os mesmos valores (hoje o index.html ainda tem sua
// própria cópia inline — ver memória "agenda-papel-ondulados" sobre isso).

const VELOCIDADE_M_MIN = 60;           // confirmado pelos dados reais (ajuste deu 59,4 m/min)
const CAP_MIN_DIA = 960;               // 08-18h (-1h almoço) + 18-02h (-1h jantar) = 16h úteis

const SETUP = {
  semTrocaBobina: 8,
  ate150mm:      30,
  de150a400mm:   36,
  acima400mm:    46,
  trocaPapel:     5,
  semAnterior:   36
};

function setupEntre(ant, p){
  if (p && typeof p.setupManual === 'number') return p.setupManual;
  if (!ant) return SETUP.semAnterior;

  const la = Number(ant.largura) || 0, lp = Number(p.largura) || 0;
  if (!la || !lp) return SETUP.semAnterior;

  const dif = Math.abs(la - lp) * 1000;
  let min = dif < 5      ? SETUP.semTrocaBobina
          : dif < 150    ? SETUP.ate150mm
          : dif < 400    ? SETUP.de150a400mm
          :                SETUP.acima400mm;

  const pa = String(ant.po || '').trim().toUpperCase();
  const pp = String(p.po || '').trim().toUpperCase();
  if (pa && pp && pa !== pp) min += SETUP.trocaPapel;
  return min;
}
function tempoPedido(p, ant){
  return setupEntre(ant, p) + (Number(p.ml) || 0) / VELOCIDADE_M_MIN;
}
const DIAS_UTEIS = [1,2,3,4,5];

const TURNOS = [
  [8*60, 12*60],
  [13*60, 18*60],
  [18*60, 20*60],
  [21*60, 26*60],
];

function chaveDiaISO(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function chaveLote(p){ return String(p.lote || p.cliente || '').trim().toUpperCase(); }
function nomeLote(p){ return String(p.lote || p.cliente || '').trim(); }
function agruparPorLote(lista){
  const mapa = new Map();
  lista.forEach(p => {
    const k = chaveLote(p);
    if (!mapa.has(k)) mapa.set(k, { chave: k, lote: nomeLote(p), cliente: String(p.cliente||'').trim(), pedidos: [] });
    mapa.get(k).pedidos.push(p);
  });
  return Array.from(mapa.values());
}
function achatarGrupos(grupos){
  return grupos.flatMap(g => g.pedidos);
}

function proximoDiaUtil(d){
  let n = new Date(d);
  n.setDate(n.getDate()+1);
  while(!DIAS_UTEIS.includes(n.getDay())) n.setDate(n.getDate()+1);
  return n;
}
function ehDiaUtil(d){ return DIAS_UTEIS.includes(d.getDay()); }
function proximoDiaUtilAPartirDe(d){
  let n = new Date(d);
  while(!ehDiaUtil(n)) n.setDate(n.getDate()+1);
  return n;
}

function minutosUsadosNoTurno(t){
  let used = 0;
  for (const [s,e] of TURNOS){
    if (t <= s) break;
    used += Math.min(t,e) - s;
  }
  return used;
}
function estadoAgora(now){
  const hoje0h = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hour = now.getHours(), min = now.getMinutes();

  if (hour >= 2){
    const tMin = hour*60 + min;
    if (ehDiaUtil(hoje0h) && tMin >= TURNOS[0][0] && tMin < TURNOS[TURNOS.length-1][1]){
      return { bucketStart: hoje0h, restanteHoje: CAP_MIN_DIA - minutosUsadosNoTurno(tMin), emTurno: true };
    }
  } else {
    const ontem0h = new Date(hoje0h); ontem0h.setDate(ontem0h.getDate()-1);
    const tMin = 24*60 + hour*60 + min;
    if (ehDiaUtil(ontem0h) && tMin < TURNOS[TURNOS.length-1][1]){
      return { bucketStart: ontem0h, restanteHoje: CAP_MIN_DIA - minutosUsadosNoTurno(tMin), emTurno: true };
    }
  }

  const candidato = hour < 8 ? hoje0h : new Date(hoje0h.getFullYear(), hoje0h.getMonth(), hoje0h.getDate()+1);
  return { bucketStart: proximoDiaUtilAPartirDe(candidato), restanteHoje: CAP_MIN_DIA, emTurno: false };
}

// pedidos: lista (fila) de {id,cliente,po,of,oc,kg,ml,largura,dataReservada?}
// retorna: { dias, pedidosInfo: {id:{diaInicio,diaFim}} }
function calcularAgenda(pedidos, agora){
  agora = agora || new Date();
  const estado = estadoAgora(agora);
  const bucketStart = estado.bucketStart;

  const naoReservados = pedidos.filter(p => !p.dataReservada);

  const reservasPorDia = new Map();
  pedidos.filter(p => p.dataReservada).forEach(p => {
    const [y,m,d] = p.dataReservada.split('-').map(Number);
    let dt = new Date(y, m-1, d);
    if (dt < bucketStart) dt = new Date(bucketStart);
    if (!ehDiaUtil(dt)) dt = proximoDiaUtilAPartirDe(dt);
    const k = chaveDiaISO(dt);
    if (!reservasPorDia.has(k)) reservasPorDia.set(k, []);
    reservasPorDia.get(k).push(p);
  });
  const diasProcessados = new Set();

  const dias = [];
  let diaAtual = new Date(bucketStart);
  let capRestante = estado.restanteHoje;
  let diaObj = { data: new Date(diaAtual), itens: [], minUsados: CAP_MIN_DIA - capRestante, emAndamento: estado.emTurno };
  dias.push(diaObj);

  const pedidosInfo = {};

  let ultimoPedido = null;
  function custoDe(p){
    const min = tempoPedido(p, ultimoPedido);
    ultimoPedido = p;
    return min;
  }

  function aplicarReservasDoDiaAtual(){
    let k = chaveDiaISO(diaObj.data);
    while (reservasPorDia.has(k) && !diasProcessados.has(k)){
      diasProcessados.add(k);
      reservasPorDia.get(k).forEach(p => {
        let restante = custoDe(p);
        const diasTocados = [];
        while (restante > 0.0001){
          if (capRestante <= 0.0001){
            diaAtual = proximoDiaUtil(diaAtual);
            capRestante = CAP_MIN_DIA;
            diaObj = { data: new Date(diaAtual), itens: [], minUsados: 0, emAndamento: false };
            dias.push(diaObj);
          }
          const usar = Math.min(restante, capRestante);
          restante -= usar;
          capRestante -= usar;
          diaObj.minUsados += usar;
          diaObj.itens.push({ pedido: p, status: 'reservado', minUsados: usar });
          diasTocados.push(diaObj.data);
        }
        pedidosInfo[p.id] = { diaInicio: diasTocados[0], diaFim: diasTocados[diasTocados.length-1] };
      });
      k = chaveDiaISO(diaObj.data);
    }
  }
  aplicarReservasDoDiaAtual();

  naoReservados.forEach(p => {
    let restante = custoDe(p);
    let primeiraVez = true;
    const diasTocados = [];

    while (restante > 0.0001) {
      if (capRestante <= 0.0001) {
        diaAtual = proximoDiaUtil(diaAtual);
        capRestante = CAP_MIN_DIA;
        diaObj = { data: new Date(diaAtual), itens: [], minUsados: 0, emAndamento: false };
        dias.push(diaObj);
        aplicarReservasDoDiaAtual();
      }
      const usar = Math.min(restante, capRestante);
      restante -= usar;
      capRestante -= usar;
      diaObj.minUsados += usar;

      const status = primeiraVez ? (restante > 0.0001 ? 'inicio' : 'unico') : (restante > 0.0001 ? 'continua' : 'conclui');
      diaObj.itens.push({ pedido: p, status, minUsados: usar });
      diasTocados.push(diaObj.data);
      primeiraVez = false;
    }
    pedidosInfo[p.id] = { diaInicio: diasTocados[0], diaFim: diasTocados[diasTocados.length-1] };
  });

  const chavesRestantes = [...reservasPorDia.keys()].filter(k => !diasProcessados.has(k)).sort();
  let dataDia = null, capDoDia = 0, novoDia = null, antDoDia = null;

  function abrirDia(dt){
    dataDia = new Date(dt);
    capDoDia = CAP_MIN_DIA;
    novoDia = { data: new Date(dataDia), itens: [], minUsados: 0, emAndamento: false };
    dias.push(novoDia);
    diasProcessados.add(chaveDiaISO(dataDia));
  }

  chavesRestantes.forEach(k => {
    const [y,m,d] = k.split('-').map(Number);
    const dataReserva = new Date(y, m-1, d);

    if (!novoDia || dataReserva > dataDia){
      abrirDia(dataReserva);
      antDoDia = null;
    }

    reservasPorDia.get(k).forEach(p => {
      let restante = tempoPedido(p, antDoDia);
      antDoDia = p;
      const diasTocados = [];
      while (restante > 0.0001){
        if (capDoDia <= 0.0001) abrirDia(proximoDiaUtil(dataDia));
        const usar = Math.min(restante, capDoDia);
        restante -= usar;
        capDoDia -= usar;
        novoDia.minUsados += usar;
        novoDia.itens.push({ pedido: p, status: 'reservado', minUsados: usar });
        diasTocados.push(novoDia.data);
      }
      pedidosInfo[p.id] = { diaInicio: diasTocados[0], diaFim: diasTocados[diasTocados.length-1] };
    });
  });
  dias.sort((a,b) => a.data - b.data);

  return { dias, pedidosInfo };
}
