import { api, modoDemo } from './store.js';
import { ico, anillo, ICONOS_SOBRE, ICONOS_AHORRO } from './iconos.js';
import { leerAviso, normalizarComercio } from './parser.js';

// ================= utilidades =================
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const miles = (n) => Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function fmt(n, moneda = 'CRC') {
  const s = n < 0 ? '−' : '';
  if (moneda === 'USD') return s + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s + '₡' + miles(n);
}
const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const FUENTES = { manual: 'A mano', applepay: 'Apple Pay', sms: 'SMS', correo: 'Correo', suscripcion: 'Suscripción', ahorro: 'Pasado a ahorro' };
const TIPOS_METODO = {
  tarjeta: ['Tarjeta', 'tarjeta'], debito: ['Tarjeta de débito', 'tarjeta'], credito: ['Tarjeta de crédito', 'tarjeta'],
  sinpe: ['SINPE Móvil', 'sinpe'], efectivo: ['Efectivo', 'efectivo'], otro: ['Otro', 'billete'],
};
const METODOS_RAPIDOS = [['SINPE Móvil', 'sinpe'], ['Tarjeta de débito', 'debito'], ['Tarjeta de crédito', 'credito'], ['Efectivo', 'efectivo']];
const tipoMetodo = (m) => TIPOS_METODO[m.tipo] || TIPOS_METODO.otro;
const ACENTOS = { verde: '#7ee8a3', azul: '#8cc8ff', morado: '#c4a8ff', naranja: '#ffc078' };
const NOMBRE_APP = 'Whiplash';
// Montos en los campos: punto para miles y coma para decimales (2.500.000,00)
const SEL_MONTO = 'input[name="monto"], input[name="presupuesto"], input[name="meta"], input[data-cfg="tipo_cambio"]';
const leerMontoCampo = (v) => {
  const n = Number(String(v || '').replace(/[^\d,]/g, '').replace(',', '.'));
  return n > 0 ? Math.round(n * 100) / 100 : 0;
};
const puntosMiles = (ent) => ent.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
// número guardado -> texto del campo
function numATexto(n) {
  n = Math.round(Number(n) * 100) / 100;
  if (!(n > 0)) return '';
  const [ent, dec] = n.toFixed(2).split('.');
  return puntosMiles(ent) + (dec === '00' ? '' : ',' + dec);
}
// lo que se va escribiendo -> mismo texto con separadores
function formatoVivo(valor, tecla) {
  let v = String(valor);
  // un punto recién tecleado es el separador decimal; los demás puntos son de miles
  // (también al pegar un número como 2500000.5)
  const pegado = tecla && tecla.length > 1 && /^\d+\.\d{1,2}$/.test(v.trim());
  if ((tecla === '.' || v.endsWith('.') || pegado) && !v.includes(',')) { const i = v.lastIndexOf('.'); v = v.slice(0, i) + ',' + v.slice(i + 1); }
  v = v.replace(/[^\d,]/g, '');
  const i = v.indexOf(',');
  if (i < 0) return puntosMiles(v);
  const ent = v.slice(0, i), dec = v.slice(i + 1).replace(/,/g, '').slice(0, 2);
  return (puntosMiles(ent) || '0') + ',' + dec;
}
const decimalesFaltan = (v) => { const i = v.indexOf(','); return !v ? '' : i < 0 ? ',00' : '0'.repeat(Math.max(0, 2 - (v.length - i - 1))); };

// ================= estado =================
const S = {
  cfg: null, sobres: [], metodos: [], gastos: [], reglas: [], subs: [], ahorros: [], usuario: null,
  ingresos: [], fijos: [], mov: { filtro: 'todo', q: '' }, est: { d: 0, sel: 5 },
  tab: 'inicio', pila: [],
};
const vistaActual = () => S.pila[S.pila.length - 1] || { v: S.tab };

async function cargarTodo() {
  const [config, sobres, metodos, gastos, reglas, subs, ahorros, ingresos, fijos] = await Promise.all(
    ['config', 'sobres', 'metodos_pago', 'gastos', 'reglas_comercio', 'suscripciones', 'ahorros', 'ingresos', 'ingresos_fijos'].map(t => api.listar(t)));
  S.cfg = config[0];
  const orden = (a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.creado).localeCompare(String(b.creado));
  S.sobres = sobres.filter(s => !s.archivado).sort(orden);
  S.metodos = metodos.sort(orden);
  S.gastos = gastos.sort((a, b) => b.fecha.localeCompare(a.fecha));
  S.reglas = reglas; S.subs = subs; S.ahorros = ahorros.sort(orden);
  S.ingresos = ingresos.sort((a, b) => b.fecha.localeCompare(a.fecha)); S.fijos = fijos;
  aplicarTema();
  await cobrarSuscripciones();
  await registrarFijos();
}

function aplicarTema() {
  const r = document.documentElement;
  if (S.cfg.tema === 'claro') r.dataset.theme = 'light'; else if (S.cfg.tema === 'oscuro') r.dataset.theme = 'dark'; else delete r.dataset.theme;
  if (S.cfg.acento && S.cfg.acento !== 'verde') r.dataset.acento = S.cfg.acento; else delete r.dataset.acento;
}

// ================= dinero y ciclos =================
const tc = () => Number(S.cfg.tipo_cambio) || 1;
const conv = (monto, de, a) => de === a ? Number(monto) : (de === 'USD' ? monto * tc() : monto / tc());
const sobreDe = (id) => S.sobres.find(s => s.id === id);
const metodoDe = (id) => S.metodos.find(m => m.id === id);

function inicioCiclo(fecha, dia, desplazar = 0) {
  const f = new Date(fecha);
  let m = f.getMonth();
  if (f.getDate() < dia) m -= 1;
  return new Date(f.getFullYear(), m + desplazar, dia);
}
const finCiclo = (ini) => new Date(ini.getFullYear(), ini.getMonth() + 1, ini.getDate());
const ciclo = (desplazar = 0) => { const ini = inicioCiclo(new Date(), S.cfg.dia_cierre, desplazar); return { ini, fin: finCiclo(ini) }; };
function nombreCiclo(ini) {
  if (S.cfg.dia_cierre === 1) return `${MESES_L[ini.getMonth()]} ${ini.getFullYear()}`;
  const fin = new Date(finCiclo(ini) - 864e5);
  return `${ini.getDate()} ${MESES[ini.getMonth()]} – ${fin.getDate()} ${MESES[fin.getMonth()]}`;
}
const diasParaCierre = () => Math.max(0, Math.ceil((ciclo().fin - new Date()) / 864e5));
const enCiclo = (c) => S.gastos.filter(g => { const f = new Date(g.fecha); return f >= c.ini && f < c.fin; });
const gastadoSobre = (s, lista) => lista.filter(g => g.sobre_id === s.id).reduce((a, g) => a + conv(g.monto, g.moneda, s.moneda), 0);

// Estado de un sobre: con presupuesto dice sobrante o sobregiro; sin presupuesto, solo lo gastado
function estadoSobre(s, gastado) {
  const p = Number(s.presupuesto) || 0;
  if (p <= 0) return { conPres: false, etiqueta: 'gastado', monto: gastado, cls: '', aro: 'neutro', frac: 0 };
  const queda = p - gastado;
  return queda < 0
    ? { conPres: true, etiqueta: 'sobregiro', monto: -queda, cls: 'mal', aro: 'excedido', frac: 1 }
    : { conPres: true, etiqueta: 'sobrante', monto: queda, cls: 'bien', aro: '', frac: gastado / p };
}

// ================= suscripciones =================
function proximoCobro(s, desde = new Date()) {
  const h = new Date(desde); h.setHours(0, 0, 0, 0);
  const dia = (y, m) => new Date(y, m, Math.min(s.dia_cobro, new Date(y, m + 1, 0).getDate()));
  if (s.frecuencia === 'anual') {
    const m = (s.mes_cobro || 1) - 1;
    let f = dia(h.getFullYear(), m); if (f < h) f = dia(h.getFullYear() + 1, m);
    return f;
  }
  let f = dia(h.getFullYear(), h.getMonth()); if (f < h) f = dia(h.getFullYear(), h.getMonth() + 1);
  return f;
}
function cobroAnterior(s) {
  const p = proximoCobro(s);
  return s.frecuencia === 'anual' ? new Date(p.getFullYear() - 1, p.getMonth(), p.getDate()) : new Date(p.getFullYear(), p.getMonth() - 1, p.getDate());
}
async function cobrarSuscripciones() {
  const hoy = new Date();
  for (const s of S.subs.filter(x => x.activa)) {
    // el cobro de hoy (si ya es el día) o el último que pasó
    let cobro = proximoCobro(s);
    if (cobro.toDateString() !== hoy.toDateString()) cobro = cobroAnterior(s);
    cobro.setHours(9);
    if (cobro > hoy || new Date(s.creado) > cobro) continue;
    const marca = 'sub:' + s.id;
    const ya = S.gastos.some(g => g.nota === marca && Math.abs(new Date(g.fecha) - cobro) < 2 * 864e5);
    if (ya) continue;
    S.gastos.push(await api.insertar('gastos', {
      sobre_id: s.sobre_id, metodo_id: s.metodo_id || null, monto: s.monto, moneda: s.moneda,
      comercio: s.nombre, fuente: 'suscripcion', fecha: cobro.toISOString(), nota: marca,
    }));
  }
  S.gastos.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

// ================= piezas de interfaz =================
const top = (titulo, { atras = false, derecha = '' } = {}) => `
  <header class="top">
    ${atras ? `<button class="redondo" data-accion="atras" aria-label="Volver">${ico('izquierda')}</button>` : ''}
    ${atras ? `<h2>${esc(titulo)}</h2>` : `<h1 class="marca">${esc(titulo)}</h1>`}
    ${derecha}
  </header>`;

function filaGasto(g, conSobre = true) {
  const s = sobreDe(g.sobre_id), m = metodoDe(g.metodo_id);
  const f = new Date(g.fecha);
  const hora = f.toLocaleTimeString('es-CR', { hour: 'numeric', minute: '2-digit' });
  const detalle = [hora, m ? m.nombre : FUENTES[g.fuente], conSobre ? (s ? s.nombre : '<em>Sin sobre</em>') : ''].filter(Boolean).join(' · ');
  const otra = s && s.moneda !== g.moneda ? `<small>${fmt(conv(g.monto, g.moneda, s.moneda), s.moneda)}</small>` : '';
  return `<button class="fila" data-accion="editar-gasto" data-id="${g.id}">
    <span class="mini-ico">${ico(s ? s.icono : 'bandeja')}</span>
    <span class="txt"><b>${esc(g.comercio || 'Gasto')}</b><small>${detalle}</small></span>
    <span class="lado">${fmt(g.monto, g.moneda)}${otra}</span></button>`;
}

function listaPorDia(gastos, conSobre = true) {
  if (!gastos.length) return `<div class="vacio">${ico('recibo')}<div>Todavía no hay gastos.</div></div>`;
  const grupos = new Map();
  for (const g of gastos) {
    const f = new Date(g.fecha), k = f.toDateString();
    if (!grupos.has(k)) grupos.set(k, { f, items: [] });
    grupos.get(k).items.push(g);
  }
  const hoy = new Date().toDateString(), ayer = new Date(Date.now() - 864e5).toDateString();
  return [...grupos.entries()].map(([k, { f, items }]) => {
    const t = k === hoy ? 'Hoy' : k === ayer ? 'Ayer' : `${DIAS[f.getDay()]} ${f.getDate()} ${MESES[f.getMonth()]}`;
    return `<div class="dia">${t}</div><div class="grupo">${items.map(g => filaGasto(g, conSobre)).join('')}</div>`;
  }).join('');
}

// ================= vistas: pestañas =================
// ================= finanzas: ingresos, balance y movimientos =================
const enCicloI = (c) => S.ingresos.filter(i => { const f = new Date(i.fecha); return f >= c.ini && f < c.fin; });
const conSigno = (n, moneda, s) => (Math.abs(n) < 0.005 ? '' : s) + fmt(Math.abs(n), moneda);

// Balance del ciclo: lo que realmente entró menos lo que realmente se gastó.
// "Seguro para gastar" solo le resta lo que ya está comprometido (gastos pendientes o planeados).
// El presupuesto de los sobres NO se resta: es un plan, no plata que ya salió.
function balance(c = ciclo()) {
  const mv = S.cfg.moneda_vista, gastos = enCiclo(c), ingresos = enCicloI(c);
  const ing = ingresos.reduce((a, i) => a + conv(i.monto, i.moneda, mv), 0);
  const pagado = (g) => (g.estado || 'pagado') === 'pagado';
  const gas = gastos.filter(pagado).reduce((a, g) => a + conv(g.monto, g.moneda, mv), 0);
  const porPagar = gastos.filter(g => !pagado(g)).reduce((a, g) => a + conv(g.monto, g.moneda, mv), 0);
  const reservado = S.sobres.filter(s => s.presupuesto > 0)
    .reduce((a, s) => a + conv(Math.max(0, s.presupuesto - gastadoSobre(s, gastos)), s.moneda, mv), 0);
  const disp = ing - gas;
  return { mv, ing, gas, disp, reservado, porPagar, seguro: disp - porPagar, dias: Math.max(1, diasParaCierre()), hayIngresos: ingresos.length > 0 };
}

// Ingresos fijos (salario): fechas de pago de este mes y del anterior que ya pasaron
function fechasFijo(f, hasta = new Date()) {
  const out = [];
  for (const dm of [-1, 0]) {
    const y = hasta.getFullYear(), m = hasta.getMonth() + dm, ult = new Date(y, m + 1, 0).getDate();
    for (const d of (f.frecuencia === 'quincenal' ? [f.dia1, f.dia2 || 30] : [f.dia1])) out.push(new Date(y, m, Math.min(d, ult), 8));
  }
  const desde = new Date(f.creado); desde.setHours(0, 0, 0, 0);
  return out.filter(d => d <= hasta && d >= desde);
}
async function registrarFijos() {
  for (const f of S.fijos.filter(x => x.activo)) {
    const marca = 'fijo:' + f.id;
    for (const d of fechasFijo(f)) {
      if (S.ingresos.some(i => i.nota === marca && new Date(i.fecha).toDateString() === d.toDateString())) continue;
      S.ingresos.push(await api.insertar('ingresos', { monto: f.monto, moneda: f.moneda, origen: f.nombre, fuente: 'fijo', fecha: d.toISOString(), nota: marca }));
    }
  }
  S.ingresos.sort((a, b) => b.fecha.localeCompare(a.fecha));
}
function proximoFijo(f) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dias = f.frecuencia === 'quincenal' ? [f.dia1, f.dia2 || 30] : [f.dia1];
  const cand = [];
  for (const dm of [0, 1]) {
    const y = hoy.getFullYear(), m = hoy.getMonth() + dm, ult = new Date(y, m + 1, 0).getDate();
    for (const d of dias) cand.push(new Date(y, m, Math.min(d, ult)));
  }
  return cand.filter(d => d >= hoy).sort((a, b) => a - b)[0];
}

// Gastos e ingresos en una sola lista
function movimientos({ filtro = 'todo', q = '', c = null } = {}) {
  let l = [];
  if (filtro !== 'ingresos') l = l.concat(S.gastos.filter(g => filtro !== 'pend' || (g.estado || 'pagado') !== 'pagado').map(g => ({ t: 'g', x: g, f: g.fecha })));
  if (filtro !== 'gastos' && filtro !== 'pend') l = l.concat(S.ingresos.map(i => ({ t: 'i', x: i, f: i.fecha })));
  if (c) l = l.filter(m => { const f = new Date(m.f); return f >= c.ini && f < c.fin; });
  const k = q.trim().toLowerCase();
  if (k) l = l.filter(m => [m.x.comercio, m.x.origen, /^(sub|ahorro|fijo):/.test(m.x.nota || '') ? '' : m.x.nota, sobreDe(m.x.sobre_id)?.nombre, metodoDe(m.x.metodo_id)?.nombre]
    .some(v => v && String(v).toLowerCase().includes(k)));
  return l.sort((a, b) => b.f.localeCompare(a.f));
}
function filaMovU(m) {
  const x = m.x;
  if (m.t === 'i') {
    const sub = x.fuente === 'fijo' ? 'Ingreso fijo' : x.fuente === 'manual' ? 'Ingreso' : 'SINPE recibido';
    return `<button class="movu" data-accion="editar-ingreso" data-id="${x.id}">
      <span class="tile ing">${ico('monedas')}</span>
      <span class="txt"><b>${esc(x.origen || 'Ingreso')}</b><small>${sub}</small></span>
      <span class="monto bien">+${fmt(x.monto, x.moneda)}</span></button>`;
  }
  const s = sobreDe(x.sobre_id);
  const est = x.estado && x.estado !== 'pagado' ? x.estado : '';
  return `<button class="movu ${est ? 'por-pagar' : ''}" data-accion="editar-gasto" data-id="${x.id}">
    <span class="tile">${ico(s ? s.icono : 'bandeja')}</span>
    <span class="txt"><b>${esc(x.comercio || 'Gasto')}${est ? `<i class="marca-est ${est}" title="${est}"></i>` : ''}</b><small>${est ? (est === 'pendiente' ? 'Pendiente · ' : 'Planeado · ') : ''}${s ? esc(s.nombre) : '<em>Sin sobre</em>'}</small></span>
    <span class="monto">−${fmt(x.monto, x.moneda)}</span></button>`;
}
function listaMovs(l, vacio = 'Todavía no hay movimientos.') {
  if (!l.length) return `<div class="vacio">${ico('recibo')}<div>${vacio}</div></div>`;
  const mv = S.cfg.moneda_vista, grupos = new Map();
  for (const m of l) {
    const f = new Date(m.f), k = f.toDateString();
    if (!grupos.has(k)) grupos.set(k, { f, items: [], neto: 0 });
    const g = grupos.get(k); g.items.push(m); g.neto += (m.t === 'i' ? 1 : -1) * conv(m.x.monto, m.x.moneda, mv);
  }
  const hoy = new Date().toDateString(), ayer = new Date(Date.now() - 864e5).toDateString();
  return [...grupos.entries()].map(([k, g]) => {
    const t = k === hoy ? 'Hoy' : k === ayer ? 'Ayer' : `${DIAS[g.f.getDay()]} ${g.f.getDate()} ${MESES[g.f.getMonth()]}`;
    return `<div class="dia-mov"><span>${t}</span><span class="${g.neto > 0 ? 'bien' : ''}">${conSigno(g.neto, mv, g.neto > 0 ? '+' : '−')}</span></div>
      <div class="pila chica">${g.items.map(filaMovU).join('')}</div>`;
  }).join('');
}

function vistaInicio() {
  const c = ciclo(), b = balance(c), mv = b.mv;
  const pct = b.ing > 0 ? Math.max(0, Math.min(1, b.disp / b.ing)) : 0;
  const pendientes = S.gastos.filter(g => !g.sobre_id && new Date(g.fecha) >= c.ini).length;
  const prox = S.subs.filter(s => s.activa).map(s => ({ s, d: Math.round((proximoCobro(s) - new Date().setHours(0, 0, 0, 0)) / 864e5) })).filter(x => x.d <= 2);
  let seguro;
  if (!b.hayIngresos) {
    seguro = `<button class="tarjeta-seguro vacia" data-accion="nuevo-ingreso">
      <div class="ts-top"><span class="tile ing">${ico('monedas')}</span><b>Registrá tu ingreso</b>${ico('derecha', 'fin')}</div>
      <p>Con tus ingresos del mes la app calcula cuánto podés gastar por día.</p></button>`;
  } else if (b.seguro >= 0) {
    seguro = `<section class="tarjeta-seguro">
      <div class="ts-top"><span class="tile ing">${ico('efectivo')}</span><b>Seguro para gastar</b></div>
      <div class="ts-monto bien">${fmt(b.seguro, mv)}</div>
      <p>${fmt(b.seguro / b.dias, mv)} / día · ${b.dias} ${b.dias === 1 ? 'día restante' : 'días restantes'}${b.porPagar > 0 ? `<br>Ya descontados ${fmt(b.porPagar, mv)} por pagar` : ''}</p></section>`;
  } else {
    seguro = `<section class="tarjeta-seguro deficit">
      <div class="ts-top"><span class="tile mal">${ico('info')}</span><b>Déficit del período</b></div>
      <div class="ts-monto mal">−${fmt(Math.abs(b.seguro), mv)}</div>
      <p>${b.disp < 0 ? 'Tus gastos superan tus ingresos.' : `Lo disponible no alcanza para los ${fmt(b.porPagar, mv)} que tenés por pagar.`}</p></section>`;
  }
  return `
  <header class="top inicio">
    <button class="marca-btn" data-accion="panel" aria-label="Abrir menú"><img src="icon.svg" alt=""><span><b>${NOMBRE_APP}</b><small>${nombreCiclo(c.ini)}</small></span></button>
    <button class="redondo" data-accion="panel" aria-label="Configuración">${ico('usuario')}</button>
  </header>
  <section class="tarjeta-balance">
    <div class="tb-top"><span>Balance disponible</span><button class="chip-moneda oscuro" data-accion="cambiar-moneda" aria-label="Cambiar moneda">${mv} ${ico('abajo')}</button></div>
    <div class="tb-monto">${conSigno(b.disp, mv, b.disp < 0 ? '−' : '') || fmt(0, mv)}</div>
    <div class="tb-pct"><span>Disponible</span><span>${Math.round(pct * 100)}%</span></div>
    <div class="tb-barra"><span style="width:${(pct * 100).toFixed(1)}%"></span></div>
    <div class="tb-dos">
      <div><small>${ico('sube')} Ingresos</small><b>${conSigno(b.ing, mv, '+') || fmt(0, mv)}</b></div>
      <div><small>${ico('baja')} Gastos</small><b>${conSigno(b.gas, mv, '−') || fmt(0, mv)}</b></div>
    </div>
  </section>
  ${seguro}
  ${pendientes ? `<button class="item alerta" data-accion="ir" data-v="sinsobre" style="margin-top:12px">
      ${anillo(1, 'neutro', 'bandeja', 44)}<span class="nombre">${pendientes} ${pendientes === 1 ? 'gasto sin sobre' : 'gastos sin sobre'}<small>Tocá para asignarlos</small></span>${ico('derecha', 'fin')}</button>` : ''}
  ${prox.map(({ s, d }) => `<div class="item alerta" style="margin-top:12px">${anillo(1, 'neutro', 'calendario', 44)}
      <span class="nombre">${esc(s.nombre)}<small>Se cobra ${d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`}</small></span>
      <span class="valor"><b>${fmt(s.monto, s.moneda)}</b></span></div>`).join('')}
  <div class="cab-mov" style="margin-top:28px"><h3 class="h-mov">Movimientos</h3><button class="enlace sin-raya" data-accion="tab" data-v="movs">Ver todos</button></div>
  ${listaMovs(movimientos({ c }).slice(0, 25))}`;
}

const FILTROS_MOV = [['todo', 'Todo'], ['gastos', 'Gastos'], ['ingresos', 'Ingresos'], ['pend', 'Por pagar']];
function resMovs() {
  const l = movimientos(S.mov), mv = S.cfg.moneda_vista;
  const neto = l.reduce((a, m) => a + (m.t === 'i' ? 1 : -1) * conv(m.x.monto, m.x.moneda, mv), 0);
  return `<div class="cab-res"><span><b>${l.length} ${l.length === 1 ? 'movimiento' : 'movimientos'}</b>
      <small class="${neto >= 0 ? 'bien' : 'mal'}">${neto >= 0 ? '+' : '−'} ${fmt(Math.abs(neto), mv)}</small></span>
    <span class="iconos"><button class="ic-btn" data-accion="ir" data-v="descargas" aria-label="Descargar datos">${ico('descargar')}</button>
      <button class="ic-btn" data-accion="ir" data-v="historial" aria-label="Ver historial">${ico('historial')}</button></span></div>
  ${listaMovs(l.slice(0, 200), 'Nada coincide con lo que buscás.')}`;
}
function vistaMovs() {
  const f = S.mov;
  return `${top('Movimientos', { derecha: `<button class="redondo" data-accion="panel" aria-label="Configuración">${ico('usuario')}</button>` })}
  <label class="buscador">${ico('buscar')}<input type="search" data-buscar placeholder="Buscar comercio, sobre o nota" value="${esc(f.q)}" aria-label="Buscar movimientos" autocomplete="off"></label>
  <div class="segmento desliza" id="seg-mov" style="--n:${FILTROS_MOV.length};--i:${FILTROS_MOV.findIndex(x => x[0] === f.filtro)}" role="tablist"><span class="pill"></span>
    ${FILTROS_MOV.map(([k, t]) => `<button class="${f.filtro === k ? 'activo' : ''}" data-accion="filtro-mov" data-valor="${k}" role="tab" aria-selected="${f.filtro === k}">${t}</button>`).join('')}</div>
  <div id="res-movs">${resMovs()}</div>`;
}

// ---------- panel lateral (configuración) ----------
function abrirPanel() {
  const p = $('#panel');
  const fila = (icono, txt, v) => `<button class="fila" data-accion="ir" data-v="${v}">${ico(icono)}<span class="txt"><b>${txt}</b></span></button>`;
  const n = S.gastos.filter(g => !g.sobre_id).length;
  p.innerHTML = `<div class="velo" data-accion="cerrar-panel"></div>
  <aside class="cajon" role="dialog" aria-label="Menú">
    <div class="cajon-cab"><img src="icon.svg" alt=""><span><b>${NOMBRE_APP}</b><small>${esc(modoDemo ? 'Modo demo' : S.usuario?.email || '')}</small></span></div>
    <div class="cajon-lista">
      ${fila('monedas', 'Ingresos fijos', 'fijos')}
      ${fila('tarjeta', 'Métodos de pago', 'metodos')}
      ${fila('calendario', 'Suscripciones', 'suscripciones')}
      ${fila('bandeja', `Gastos sin sobre${n ? ` (${n})` : ''}`, 'sinsobre')}
      ${fila('historial', 'Historial', 'historial')}
      ${fila('descargar', 'Descargar datos', 'descargas')}
    </div>
    <div class="cajon-pie">
      ${fila('magia', 'Trackear con Apple Pay', 'applepay')}
      ${fila('mensaje', 'Avisos del banco', 'avisos')}
      ${fila('ajustes', 'Configuración', 'ajustes')}
    </div>
  </aside>`;
  p.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('abierta')));
}
function cerrarPanel() {
  const p = $('#panel');
  if (!p || p.hidden) return;
  p.classList.remove('abierta');
  setTimeout(() => { if (!p.classList.contains('abierta')) { p.hidden = true; p.innerHTML = ''; } }, 260);
}

// ---------- ingresos ----------
const selectorTipo = (sel) => `<div class="alternar tipo" role="radiogroup" aria-label="Tipo de movimiento">
  <label><input type="radio" name="tipoMov" value="gasto" ${sel === 'gasto' ? 'checked' : ''}><span>Gasto</span></label>
  <label><input type="radio" name="tipoMov" value="ingreso" ${sel === 'ingreso' ? 'checked' : ''}><span>Ingreso</span></label></div>`;
function enlazarTipo(f) {
  f.querySelectorAll('input[name="tipoMov"]').forEach(r => r.addEventListener('change', () => { if (r.value === 'ingreso') hojaIngreso(); else hojaGasto(); }));
}

function hojaIngreso(i = null, pre = {}) {
  const v0 = i || pre;
  const fecha = new Date(i ? i.fecha : Date.now());
  const local = new Date(fecha - fecha.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const esFijo = /^fijo:/.test(i?.nota || '');
  const f = abrirHoja(i ? 'Editar ingreso' : 'Nuevo ingreso', `${i || pre.monto ? '' : selectorTipo('ingreso')}
    <div class="monto-grande">
      <div class="fila-monto"><span class="simbolo">${v0.moneda === 'USD' ? '$' : '₡'}</span>
        <input name="monto" inputmode="decimal" placeholder="0" value="${v0.monto ?? ''}" autofocus aria-label="Monto"></div>
      ${alternarMoneda('moneda', v0.moneda || 'CRC')}
    </div>
    <div class="campos">
      <label class="campo"><span>De</span><input name="origen" value="${esc(v0.origen || '')}" placeholder="Salario, cliente, persona…" autocomplete="off"></label>
      <label class="campo"><span>Fecha</span><input type="datetime-local" name="fecha" value="${local}"></label>
      <label class="campo"><span>Nota</span><input name="nota" value="${esc(esFijo ? '' : i?.nota || '')}" placeholder="Opcional"></label>
    </div>
    ${i && i.fuente !== 'manual' ? `<p class="nota">${esFijo ? 'Registrado solo por tu ingreso fijo.' : 'Registrado por un aviso del banco.'}</p>` : ''}
    <div class="acciones">
      ${i ? `<button type="button" class="btn peligro" data-accion="borrar-ingreso" data-id="${i.id}" aria-label="Borrar ingreso">${ico('basura')}</button>` : ''}
      <button type="submit" class="btn primario">Guardar</button>
    </div>`);
  enlazarTipo(f);
  f.querySelectorAll('input[name="moneda"]').forEach(r => r.addEventListener('change', () => { $('.simbolo', f).textContent = r.value === 'USD' ? '$' : '₡'; }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const monto = leerMontoCampo(f.monto.value);
    if (!monto) { f.monto.classList.add('mal-campo'); f.monto.focus(); return; }
    const fila = { monto, moneda: valorRadio(f, 'moneda'), origen: f.origen.value.trim() || null, fecha: new Date(f.fecha.value || Date.now()).toISOString() };
    if (!esFijo) fila.nota = f.nota.value.trim() || null;
    if (i) Object.assign(i, await api.actualizar('ingresos', i.id, fila));
    else S.ingresos.push(await api.insertar('ingresos', { ...fila, fuente: pre.fuente || 'manual', referencia: pre.referencia || null }));
    S.ingresos.sort((a, b) => b.fecha.localeCompare(a.fecha));
    cerrarHoja(); render(); toast(i ? 'Ingreso actualizado' : 'Ingreso agregado');
  });
}

function vistaFijos() {
  return `${top('Ingresos fijos', { atras: true })}
  <section class="pila">
    ${S.fijos.map(f => {
      const p = proximoFijo(f);
      return `<button class="item" data-accion="editar-fijo" data-id="${f.id}" ${f.activo ? '' : 'style="opacity:.55"'}>
        ${anillo(1, 'neutro', 'monedas')}
        <span class="nombre">${esc(f.nombre)}<small>${f.activo ? `Próximo: ${p.getDate()} ${MESES[p.getMonth()]}` : 'Pausado'}</small></span>
        <span class="valor"><b class="bien">${fmt(f.monto, f.moneda)}</b><span>${f.frecuencia === 'quincenal' ? `días ${f.dia1} y ${f.dia2 || 30}` : `día ${f.dia1}`}</span></span></button>`;
    }).join('')}
    ${S.fijos.length ? '' : `<div class="vacio">${ico('monedas')}<div>Agregá tu salario con el botón ＋.<br>Se registra solo cada día de pago.</div></div>`}
  </section>
  <p class="nota">El monto es lo que te entra en cada pago, no el total del mes. Los ingresos que no son fijos se agregan desde Inicio con el botón ＋ → Ingreso.</p>`;
}

function hojaFijo(x = null) {
  const f = abrirHoja(x ? 'Editar ingreso fijo' : 'Nuevo ingreso fijo', `
    <div class="monto-grande">
      <div class="fila-monto"><span class="simbolo">${x?.moneda === 'USD' ? '$' : '₡'}</span>
        <input name="monto" inputmode="decimal" placeholder="0" value="${x?.monto ?? ''}" aria-label="Monto de cada pago"></div>
      ${alternarMoneda('moneda', x?.moneda || 'CRC')}
      <small class="nota" style="margin:8px 0 0">lo que entra en cada pago</small>
    </div>
    <div class="campos">
      <label class="campo"><span>Nombre</span><input name="nombre" value="${esc(x?.nombre || 'Salario')}" autocomplete="off"></label>
      <label class="campo"><span>Frecuencia</span><select name="frecuencia"><option value="quincenal">Quincenal</option><option value="mensual" ${x?.frecuencia === 'mensual' ? 'selected' : ''}>Mensual</option></select></label>
      <label class="campo"><span>Día de pago</span><input name="dia1" inputmode="numeric" value="${x?.dia1 ?? 15}"></label>
      <label class="campo" data-segundo ${x?.frecuencia === 'mensual' ? 'hidden' : ''}><span>Segundo día</span><input name="dia2" inputmode="numeric" value="${x?.dia2 ?? 30}"></label>
      ${x ? `<label class="campo"><span style="color:var(--tinta)">Activo</span><span class="interruptor"><input type="checkbox" name="activo" ${x.activo ? 'checked' : ''}><span></span></span></label>` : ''}
    </div>
    <p class="nota">Si el mes no tiene ese día (30 en febrero), se usa el último día del mes.</p>
    <div class="acciones">
      ${x ? `<button type="button" class="btn peligro" data-accion="borrar-fijo" data-id="${x.id}" aria-label="Eliminar ingreso fijo">${ico('basura')}</button>` : ''}
      <button type="submit" class="btn primario">Guardar</button>
    </div>`);
  f.frecuencia.addEventListener('change', () => { f.querySelector('[data-segundo]').hidden = f.frecuencia.value !== 'quincenal'; });
  f.querySelectorAll('input[name="moneda"]').forEach(r => r.addEventListener('change', () => { $('.simbolo', f).textContent = r.value === 'USD' ? '$' : '₡'; }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const monto = leerMontoCampo(f.monto.value), d1 = Math.round(Number(f.dia1.value)), d2 = Math.round(Number(f.dia2.value));
    const quinc = f.frecuencia.value === 'quincenal';
    if (!monto) { f.monto.classList.add('mal-campo'); f.monto.focus(); return; }
    if (!f.nombre.value.trim()) { f.nombre.classList.add('mal-campo'); f.nombre.focus(); return; }
    if (!(d1 >= 1 && d1 <= 31)) { f.dia1.classList.add('mal-campo'); f.dia1.focus(); return; }
    if (quinc && !(d2 >= 1 && d2 <= 31 && d2 !== d1)) { f.dia2.classList.add('mal-campo'); f.dia2.focus(); return; }
    const fila = { nombre: f.nombre.value.trim(), monto, moneda: valorRadio(f, 'moneda'), frecuencia: f.frecuencia.value, dia1: d1, dia2: quinc ? d2 : null, activo: x ? f.activo.checked : true };
    if (x) Object.assign(x, await api.actualizar('ingresos_fijos', x.id, fila));
    else S.fijos.push(await api.insertar('ingresos_fijos', fila));
    await registrarFijos();
    cerrarHoja(); render(); toast('Ingreso fijo guardado');
  });
}

// ================= estadísticas =================
// Los colores siguen al sobre (su posición en la lista), no a su puesto en el ranking.
// Hay 8 colores validados; si hay más sobres, del octavo en adelante se agrupan en "Otros".
const MAX_SERIES = 8;
function colorDeSobre(i) {
  if (S.sobres.length <= MAX_SERIES) return `var(--s${i + 1})`;
  return i < MAX_SERIES - 1 ? `var(--s${i + 1})` : null;
}

function datosEst(d) {
  const c = ciclo(d), mv = S.cfg.moneda_vista, lista = enCiclo(c);
  const val = (g) => conv(g.monto, g.moneda, mv);
  const filas = []; let otros = 0;
  S.sobres.forEach((s, i) => {
    const v = lista.filter(g => g.sobre_id === s.id).reduce((a, g) => a + val(g), 0);
    if (v <= 0) return;
    const color = colorDeSobre(i);
    if (color) filas.push({ nombre: s.nombre, icono: s.icono, v, color }); else otros += v;
  });
  if (otros > 0) filas.push({ nombre: 'Otros sobres', icono: 'lista', v: otros, color: 'var(--s-otros)' });
  const sin = lista.filter(g => !sobreDe(g.sobre_id)).reduce((a, g) => a + val(g), 0);
  if (sin > 0) filas.push({ nombre: 'Sin sobre', icono: 'bandeja', v: sin, color: 'var(--s-sin)' });
  filas.sort((a, b) => b.v - a.v);
  const total = filas.reduce((a, f) => a + f.v, 0);

  const meses = [];
  for (let k = -5; k <= 0; k++) {
    const cc = ciclo(d + k);
    meses.push({
      ini: cc.ini,
      ing: enCicloI(cc).reduce((a, i) => a + conv(i.monto, i.moneda, mv), 0),
      gas: enCiclo(cc).reduce((a, g) => a + val(g), 0),
    });
  }
  const porComercio = new Map();
  for (const g of lista) {
    if (!g.comercio || g.fuente === 'ahorro') continue;
    const k = normalizarComercio(g.comercio);
    const e = porComercio.get(k) || { nombre: g.comercio, v: 0, n: 0 };
    e.v += val(g); e.n++; porComercio.set(k, e);
  }
  const comercios = [...porComercio.values()].sort((a, b) => b.v - a.v).slice(0, 5);
  return { c, mv, filas, total, meses, comercios };
}

function detalleMes(m, mv) {
  const neto = m.ing - m.gas;
  return `<b style="text-transform:capitalize">${nombreCiclo(m.ini)}</b>
    <span><i class="punto" style="background:var(--s-ing)"></i>Ingresos ${fmt(m.ing, mv)}</span>
    <span><i class="punto" style="background:var(--s-gas)"></i>Gastos ${fmt(m.gas, mv)}</span>
    <span class="neto">${neto >= 0 ? 'Quedó' : 'Faltó'} ${fmt(Math.abs(neto), mv)}</span>`;
}

function vistaEst() {
  const d = S.est.d, e = datosEst(d), mv = e.mv;
  const max = Math.max(1, ...e.meses.flatMap(m => [m.ing, m.gas]));
  const sel = Math.min(5, Math.max(0, S.est.sel ?? 5));
  return `${top('Análisis', { derecha: `<button class="redondo" data-accion="panel" aria-label="Configuración">${ico('usuario')}</button>` })}
  <div class="nav-per">
    <button class="ic-btn" data-accion="est-mover" data-d="-1" aria-label="Mes anterior">${ico('izquierda')}</button>
    <b>${nombreCiclo(e.c.ini)}</b>
    <button class="ic-btn" data-accion="est-mover" data-d="1" aria-label="Mes siguiente" ${d >= 0 ? 'disabled' : ''}>${ico('derecha')}</button>
  </div>

  <h3 class="h-est">Gastos por sobre</h3>
  ${e.filas.length ? `<section class="tarjeta-est">
    <div class="est-total"><small>Total gastado</small><b>${fmt(e.total, mv)}</b></div>
    <div class="tira" role="img" aria-label="Reparto del gasto por sobre">${e.filas.map(f => `<span style="flex:${(f.v / e.total).toFixed(4)};background:${f.color}" title="${esc(f.nombre)}: ${fmt(f.v, mv)}"></span>`).join('')}</div>
    <div class="est-lista">
      ${e.filas.map(f => `<div class="est-fila">
        <i class="punto" style="background:${f.color}"></i>
        <span class="n">${esc(f.nombre)}</span>
        <span class="p">${Math.round(f.v / e.total * 100)}%</span>
        <span class="v">${fmt(f.v, mv)}</span>
      </div>`).join('')}
    </div></section>`
    : `<div class="vacio">${ico('barras')}<div>No hay gastos en este período.</div></div>`}

  <h3 class="h-est">Ingresos y gastos</h3>
  <section class="tarjeta-est">
    <div class="leyenda"><span><i class="punto" style="background:var(--s-ing)"></i>Ingresos</span><span><i class="punto" style="background:var(--s-gas)"></i>Gastos</span></div>
    <div class="grupos" role="group" aria-label="Ingresos y gastos de los últimos seis meses">
      ${e.meses.map((m, k) => `<button class="grupo-mes ${k === sel ? 'sel' : ''}" data-accion="est-mes" data-k="${k}" aria-pressed="${k === sel}"
          aria-label="${nombreCiclo(m.ini)}: ingresos ${fmt(m.ing, mv)}, gastos ${fmt(m.gas, mv)}">
        <span class="barras2"><span class="b ing" style="height:${(m.ing / max * 100).toFixed(1)}%"></span><span class="b gas" style="height:${(m.gas / max * 100).toFixed(1)}%"></span></span>
        <i>${MESES[m.ini.getMonth()]}</i></button>`).join('')}
    </div>
    <div class="detalle-mes" id="det-mes" aria-live="polite">${detalleMes(e.meses[sel], mv)}</div>
  </section>

  ${e.comercios.length ? `<h3 class="h-est">Dónde más gastaste</h3>
  <div class="grupo sin-icono">${e.comercios.map(x => `<div class="fila"><span class="txt"><b>${esc(x.nombre)}</b><small>${x.n} ${x.n === 1 ? 'compra' : 'compras'}</small></span><span class="lado">${fmt(x.v, mv)}</span></div>`).join('')}</div>` : ''}`;
}

function vistaSobres() {
  const c = ciclo(), lista = enCiclo(c), mv = S.cfg.moneda_vista;
  const total = S.sobres.filter(s => s.presupuesto > 0).reduce((a, s) => a + conv(s.presupuesto - gastadoSobre(s, lista), s.moneda, mv), 0);
  const pendientes = S.gastos.filter(g => !g.sobre_id && new Date(g.fecha) >= c.ini).length;
  const prox = S.subs.filter(s => s.activa).map(s => ({ s, d: Math.round((proximoCobro(s) - new Date().setHours(0, 0, 0, 0)) / 864e5) })).filter(x => x.d <= 2);
  return `
  ${top('Sobres', { derecha: `<button class="redondo" data-accion="menu" aria-label="Más opciones">${ico('puntos')}</button>` })}
  <div class="destacada">
    <div class="lado">
      <button class="chip-moneda" data-accion="cambiar-moneda" aria-label="Cambiar moneda">${mv} ${ico('abajo')}</button>
      <small style="margin-top:6px">Cierra en ${diasParaCierre()} ${diasParaCierre() === 1 ? 'día' : 'días'}</small>
    </div>
    <div class="lado der"><small>${total < 0 ? 'Sobregiro total' : 'Sobrante total'}</small><b class="${total < 0 ? 'mal' : ''}">${fmt(Math.abs(total), mv)}</b></div>
  </div>
  ${pendientes ? `<button class="item alerta" data-accion="ir" data-v="sinsobre">
      ${anillo(1, 'neutro', 'bandeja', 44)}<span class="nombre">${pendientes} ${pendientes === 1 ? 'gasto sin sobre' : 'gastos sin sobre'}<small>Tocá para asignarlos</small></span>${ico('derecha', 'fin')}</button>` : ''}
  ${prox.map(({ s, d }) => `<div class="item alerta" style="margin-top:12px">${anillo(1, 'neutro', 'calendario', 44)}
      <span class="nombre">${esc(s.nombre)}<small>Se cobra ${d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`}</small></span>
      <span class="valor"><b>${fmt(s.monto, s.moneda)}</b></span></div>`).join('')}
  ${pendientes || prox.length ? '<div style="height:18px"></div>' : ''}
  <div class="separador"></div>
  <section class="pila">
    ${S.sobres.map(s => {
      const e = estadoSobre(s, gastadoSobre(s, lista));
      return `<button class="item" data-accion="abrir-sobre" data-id="${s.id}">
        ${anillo(e.frac, e.aro, s.icono)}
        <span class="nombre">${esc(s.nombre)}${e.conPres ? `<small>Presupuesto ${fmt(s.presupuesto, s.moneda)}</small>` : '<small>Sin presupuesto</small>'}</span>
        <span class="valor"><b class="${e.cls}">${fmt(e.monto, s.moneda)}</b><span>${e.etiqueta}</span></span>
      </button>`;
    }).join('')}
    <button class="item punteado" data-accion="nuevo-sobre">${ico('mas')} Nuevo sobre</button>
    <button class="item" data-accion="ir" data-v="suscripciones">${anillo(1, 'neutro', 'calendario')}
      <span class="nombre">Suscripciones<small>${S.subs.filter(s => s.activa).length} activas</small></span>${ico('derecha', 'fin')}</button>
  </section>`;
}

function vistaAhorros() {
  return `
  ${top('Ahorros')}
  <section class="pila">
    ${S.ahorros.map(a => `<button class="item" data-accion="mover-ahorro" data-id="${a.id}">
      ${anillo(a.meta > 0 ? a.ahorrado / a.meta : 0, a.ahorrado > 0 ? '' : 'neutro', a.icono)}
      <span class="nombre">${esc(a.nombre)}${a.meta > 0 ? `<small>Meta ${fmt(a.meta, a.moneda)}</small>` : ''}</span>
      <span class="valor"><b class="bien">${fmt(a.ahorrado, a.moneda)}</b><span>ahorrados</span></span></button>`).join('')}
    ${S.ahorros.length ? '' : `<div class="vacio">${ico('alcancia')}<div>Creá un sobre de ahorro con el botón ＋.<br>Le podés poner meta y pasarle el sobrante de tus sobres.</div></div>`}
  </section>`;
}

function vistaSuscripciones() {
  const mv = S.cfg.moneda_vista;
  const activas = S.subs.filter(s => s.activa);
  const mensual = activas.reduce((a, s) => a + conv(s.frecuencia === 'anual' ? s.monto / 12 : s.monto, s.moneda, mv), 0);
  const lista = [...S.subs].sort((a, b) => (b.activa - a.activa) || (proximoCobro(a) - proximoCobro(b)));
  return `
  ${top('Suscripciones', { atras: true })}
  <div class="destacada"><span class="lado"><b style="font-size:19px;font-weight:600">Total mensual</b></span>
    <span class="lado der"><b>${fmt(mensual, mv)}</b></span></div>
  <div class="separador"></div>
  <section class="pila">
    ${lista.map(s => {
      const p = proximoCobro(s), a = cobroAnterior(s);
      const frac = (Date.now() - a) / (p - a);
      return `<button class="item" data-accion="editar-sub" data-id="${s.id}" ${s.activa ? '' : 'style="opacity:.55"'}>
        ${anillo(frac, '', 'calendario')}
        <span class="nombre">${esc(s.nombre)}<small>${s.activa ? `Próximo cobro: ${p.getDate()} ${MESES[p.getMonth()]}` : 'Pausada'}</small></span>
        <span class="valor"><b>${fmt(s.monto, s.moneda)}</b><span>${s.frecuencia === 'anual' ? 'Anual' : 'Mensual'}</span></span></button>`;
    }).join('')}
    ${S.subs.length ? '' : `<div class="vacio">${ico('calendario')}<div>Agregá Netflix, Spotify o lo que pagués cada mes con el botón ＋</div></div>`}
  </section>`;
}

const filaAjuste = (icono, texto, v, valor = '') =>
  `<button class="fila" data-accion="ir" data-v="${v}">${ico(icono)}<span class="txt"><b>${texto}</b></span>${valor ? `<span class="valor-txt">${valor}</span>` : ''}${ico('derecha', 'fin')}</button>`;

function vistaAjustes() {
  return `
  ${top('Configuración', { atras: true })}
  <div class="titulo">Cuenta</div>
  <div class="grupo">${filaAjuste('usuario', 'Cuenta', 'cuenta')}</div>
  <div class="titulo">Sobres</div>
  <div class="grupo">
    ${filaAjuste('moneda', 'Monedas', 'monedas', S.cfg.moneda_vista)}
    ${filaAjuste('tarjeta', 'Métodos de pago', 'metodos', S.metodos.length || '')}
    ${filaAjuste('monedas', 'Ingresos fijos', 'fijos', S.fijos.length || '')}
    ${filaAjuste('reinicio', 'Reinicio automático', 'reinicio', 'Día ' + S.cfg.dia_cierre)}
  </div>
  <div class="titulo">General</div>
  <div class="grupo">
    ${filaAjuste('magia', 'Trackear con Apple Pay', 'applepay')}
    ${filaAjuste('mensaje', 'Avisos del banco', 'avisos')}
    ${filaAjuste('pincel', 'Personalización', 'personalizacion')}
  </div>
  <div class="titulo">Más</div>
  <div class="grupo">
    ${filaAjuste('descargar', 'Descargar datos', 'descargas', 'Excel · PDF')}
    ${filaAjuste('info', 'Acerca de', 'acerca')}
  </div>`;
}

// ================= vistas: detalle =================
function filaMov(g, s) {
  const m = metodoDe(g.metodo_id), f = new Date(g.fecha);
  const medio = m ? m.nombre : (g.fuente === 'manual' ? '' : FUENTES[g.fuente]);
  const otra = g.moneda !== s.moneda ? ` · ${fmt(conv(g.monto, g.moneda, s.moneda), s.moneda)}` : '';
  return `<button class="mov" data-accion="editar-gasto" data-id="${g.id}">
    <span class="mov-izq"><b>${esc(g.comercio || 'Gasto')}</b><small>${f.getDate()} ${MESES[f.getMonth()]} ${f.getFullYear()}</small></span>
    <span class="mov-der"><b>${fmt(g.monto, g.moneda)}</b><small>${esc(medio)}${otra}</small></span></button>`;
}

function vistaSobre(p) {
  const s = sobreDe(p.id);
  if (!s) { S.pila.pop(); return render(); }
  const c = ciclo(), lista = enCiclo(c).filter(g => g.sobre_id === s.id);
  const g = gastadoSobre(s, lista), e = estadoSobre(s, g);
  const hist = p.seg === 'hist';
  return `
  <header class="top">
    <button class="redondo" data-accion="atras" aria-label="Volver">${ico('izquierda')}</button>
    <button class="redondo" data-accion="menu-sobre" data-id="${s.id}" aria-label="Opciones del sobre">${ico('puntos')}</button>
  </header>
  <div class="tarjeta-sobre">
    <h2><span class="ico-sobre ${e.cls === 'mal' ? 'mal' : ''}">${ico(s.icono)}</span>${esc(s.nombre)}</h2>
    ${e.conPres ? `<p><b>${fmt(s.presupuesto, s.moneda)}</b> presupuestados</p>` : `<p>Sin presupuesto · <button class="enlace" data-accion="presupuesto" data-id="${s.id}">poner uno</button></p>`}
    <p><b>${fmt(g, s.moneda)}</b> gastados</p>
    ${e.conPres ? `<div class="saldo"><b class="${e.cls}">${fmt(e.monto, s.moneda)}</b><span>${e.etiqueta === 'sobregiro' ? 'de sobregiro' : 'disponibles'}</span></div>` : ''}
  </div>
  <div class="cab-mov">
    <span class="titulo" style="margin:0">${hist ? 'Historial' : 'Últimos movimientos'}</span>
    <button class="redondo chico" data-accion="seg" data-seg="${hist ? 'mes' : 'hist'}" aria-label="${hist ? 'Ver movimientos' : 'Ver historial'}">${ico(hist ? 'lista' : 'historial')}</button>
  </div>
  ${hist ? bloqueHistorial(s) : (lista.length
    ? `<div class="grupo movs">${lista.map(x => filaMov(x, s)).join('')}</div>`
    : `<div class="vacio">${ico('recibo')}<div>Todavía no hay gastos este mes.</div></div>`)}`;
}

function abrirMenuSobre(s) {
  const e = estadoSobre(s, gastadoSobre(s, enCiclo(ciclo())));
  const capa = document.createElement('div');
  capa.innerHTML = `<div class="capa-menu" data-accion="cerrar-menu"></div><div class="menu" role="menu">
    <button role="menuitem" data-accion="presupuesto" data-id="${s.id}">${e.conPres ? 'Cambiar presupuesto' : 'Poner presupuesto'} ${ico('moneda')}</button>
    ${e.cls === 'bien' && e.monto > 0 ? `<button role="menuitem" data-accion="sobrante-ahorro" data-id="${s.id}">Pasar sobrante a ahorro ${ico('alcancia')}</button>` : ''}
    <button role="menuitem" data-accion="seg" data-seg="hist">Ver historial ${ico('historial')}</button>
    <button role="menuitem" data-accion="editar-sobre" data-id="${s.id}">Editar sobre ${ico('pincel')}</button></div>`;
  capa.id = 'menu'; document.body.appendChild(capa);
}

const mediana = (xs) => { if (!xs.length) return 0; const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

function bloqueHistorial(s = null) {
  const mon = s ? s.moneda : S.cfg.moneda_vista;
  const valor = (g) => conv(g.monto, g.moneda, mon);
  const pres = s ? Number(s.presupuesto) : S.sobres.reduce((a, x) => a + conv(x.presupuesto, x.moneda, mon), 0);
  const ciclos = [];
  for (let d = -11; d <= 0; d++) {
    const c = ciclo(d), lista = enCiclo(c).filter(g => !s || g.sobre_id === s.id);
    ciclos.push({ ...c, lista, total: lista.reduce((a, g) => a + valor(g), 0) });
  }
  const cerrados = ciclos.filter(c => c.fin <= new Date() && c.lista.length);
  const todos = ciclos.flatMap(c => c.lista);
  const cuenta = {};
  todos.forEach(g => { const k = metodoDe(g.metodo_id)?.nombre || FUENTES[g.fuente]; cuenta[k] = (cuenta[k] || 0) + 1; });
  const metodo = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
  const max = Math.max(pres, ...ciclos.map(c => c.total), 1);
  return `
  <div class="stats">
    <div><small>Promedio por mes</small><b>${cerrados.length ? fmt(cerrados.reduce((a, c) => a + c.total, 0) / cerrados.length, mon) : '—'}</b></div>
    <div><small>Gasto mediano</small><b>${todos.length ? fmt(mediana(todos.map(valor)), mon) : '—'}</b></div>
    <div class="ancha"><small>Método de pago más usado</small><b>${metodo ? esc(metodo[0]) : '—'}</b></div>
  </div>
  <div class="grafico" aria-label="Gasto de cada mes contra el presupuesto">
    <div class="columnas">
      ${ciclos.map(c => `<div class="col ${pres && c.total > pres ? 'excedido' : ''} ${c.total ? '' : 'vacia'}" title="${nombreCiclo(c.ini)}: ${fmt(c.total, mon)}">
        <span class="area"><span class="b" style="height:${(c.total / max * 100).toFixed(1)}%"></span></span><i>${MESES[c.ini.getMonth()][0].toUpperCase()}</i></div>`).join('')}
      ${pres ? `<span class="linea" style="bottom:calc(20px + (100% - 20px) * ${(pres / max).toFixed(4)})"><em>${fmt(pres, mon)}</em></span>` : ''}
    </div>
  </div>
  <div class="titulo">Meses</div>
  <div class="grupo sin-icono">
    ${[...ciclos].reverse().filter(c => c.lista.length).map(c => `<div class="fila"><span class="txt"><b style="text-transform:capitalize">${nombreCiclo(c.ini)}</b><small>${c.lista.length} ${c.lista.length === 1 ? 'gasto' : 'gastos'}</small></span>
      <span class="lado">${fmt(c.total, mon)}${pres ? `<small class="${c.total > pres ? 'mal' : 'bien'}">${c.total > pres ? 'sobregiro ' + fmt(c.total - pres, mon) : 'sobrante ' + fmt(pres - c.total, mon)}</small>` : ''}</span></div>`).join('') || '<div class="vacio">Sin historial todavía.</div>'}
  </div>`;
}

const vistaMovimientos = () => `${top('Movimientos', { atras: true })}<p class="nota" style="margin:-6px 4px 6px;text-transform:capitalize">${nombreCiclo(ciclo().ini)}</p>${listaPorDia(enCiclo(ciclo()))}`;
const vistaSinSobre = () => `${top('Sin sobre', { atras: true })}<p class="nota" style="margin:-6px 4px 6px">Tocá cada gasto para elegir su sobre. La próxima vez ese comercio entra solo.</p>${listaPorDia(S.gastos.filter(g => !g.sobre_id))}`;
const vistaHistorialGeneral = () => `${top('Historial', { atras: true })}${bloqueHistorial(null)}`;

// ================= vistas: ajustes =================
const opcion = (accion, valor, texto, marcado, extra = '') =>
  `<button class="fila opcion" data-accion="${accion}" data-valor="${esc(valor)}" role="radio" aria-checked="${marcado}">${extra}<span class="txt"><b>${texto}</b></span>${marcado ? ico('check', 'check') : ''}</button>`;

function vistaCuenta() {
  return `${top('Cuenta', { atras: true })}
  <div class="grupo sin-icono"><div class="fila"><span class="txt"><b>${modoDemo ? 'Modo demo' : esc(S.usuario?.email || '')}</b>
    <small>${modoDemo ? 'Los datos viven solo en este navegador.' : 'Sesión iniciada'}</small></span></div></div>
  ${modoDemo ? '' : `<div style="height:22px"></div><div class="grupo"><button class="fila peligro" data-accion="salir">Cerrar sesión</button></div>`}`;
}

function vistaMonedas() {
  return `${top('Monedas', { atras: true })}
  <div class="titulo">Moneda para totales</div>
  <div class="grupo sin-icono" role="radiogroup">
    ${opcion('cfg-moneda', 'CRC', 'Colones (₡)', S.cfg.moneda_vista === 'CRC')}
    ${opcion('cfg-moneda', 'USD', 'Dólares ($)', S.cfg.moneda_vista === 'USD')}
  </div>
  <div class="titulo" style="margin-top:26px">Tipo de cambio</div>
  <div class="campos"><label class="campo"><span>₡ por $1</span>
    <input type="text" inputmode="decimal" value="${numATexto(S.cfg.tipo_cambio)}" data-cfg="tipo_cambio"></label></div>
  <p class="nota">Cada sobre tiene su moneda. Un gasto en dólares que cae en un sobre en colones se convierte con este tipo de cambio.</p>`;
}

function vistaMetodos() {
  const faltan = METODOS_RAPIDOS.filter(([n, tp]) => !S.metodos.some(m => m.tipo === tp || m.nombre.toLowerCase() === n.toLowerCase()));
  return `${top('Métodos de pago', { atras: true })}
  ${faltan.length ? `<div class="etiqueta" style="margin-top:0">Agregar con un toque</div>
  <div class="chips" style="margin-bottom:14px">${faltan.map(([n, tp]) => `<button class="chip-btn" data-accion="metodo-rapido" data-nombre="${esc(n)}" data-tipo="${tp}">${ico('mas')}${esc(n)}</button>`).join('')}</div>` : ''}
  <div class="grupo">
    ${S.metodos.map(m => `<button class="fila" data-accion="editar-metodo" data-id="${m.id}">${ico(tipoMetodo(m)[1])}
      <span class="txt"><b>${esc(m.nombre)}</b><small>${[m.ultimos4 ? '•••• ' + m.ultimos4 : tipoMetodo(m)[0], m.sobre_id ? 'Sobre: ' + esc(sobreDe(m.sobre_id)?.nombre || '') : ''].filter(Boolean).join(' · ')}</small></span>${ico('derecha', 'fin')}</button>`).join('')}
    <button class="fila" data-accion="nuevo-metodo" style="color:var(--bien)">${ico('mas')}<span class="txt"><b>Agregar otro método</b></span></button>
  </div>
  <p class="nota">Las tarjetas que usés con Apple Pay se agregan solas aquí la primera vez que pagás con ellas. Tocá una para ponerle un sobre: todo lo que pagués con esa tarjeta cae ahí sin preguntar.</p>`;
}

function vistaReinicio() {
  return `${top('Reinicio automático', { atras: true })}
  <div class="campos"><label class="campo"><span>Día de reinicio</span>
    <select data-cfg="dia_cierre">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${S.cfg.dia_cierre === i + 1 ? 'selected' : ''}>${i + 1} de cada mes</option>`).join('')}</select></label></div>
  <p class="nota">Ese día todos los sobres vuelven a tener su presupuesto completo. Lo gastado queda guardado en el historial de cada sobre. Si te pagan el 15, poné 15.</p>`;
}

function vistaApplePay() {
  const id = S.cfg.atajo_sobre_id;
  return `${top('Apple Pay', { atras: true })}
  <div class="titulo">Sobre al pagar</div>
  <div class="grupo" role="radiogroup">
    ${opcion('cfg-atajo-sobre', '', 'Sin sobre fijo', !id, ico('lista'))}
    ${S.sobres.map(s => opcion('cfg-atajo-sobre', s.id, esc(s.nombre), id === s.id, ico(s.icono))).join('')}
  </div>
  <div style="height:12px"></div>
  <div class="campos"><label class="campo"><span style="color:var(--tinta)">Recordar el sobre de cada comercio</span>
    <span class="interruptor"><input type="checkbox" data-cfg-bool="atajo_recordar" ${S.cfg.atajo_recordar ? 'checked' : ''}><span></span></span></label></div>
  <p class="nota">${id ? 'Todo lo que pagués con Apple Pay cae en este sobre.' : 'El pago se registra solo. Si la app ya conoce el comercio o la tarjeta tiene sobre propio, cae ahí; si no, queda en "Sin sobre". Para que te pregunte el sobre en el momento de pagar, seguí los pasos de más abajo.'}</p>
  <div class="titulo" style="margin-top:26px">Configurar el atajo (una sola vez)</div>
  ${datosAtajo()}
  ${estadoAtajo()}
  <div class="pasos" style="margin-top:12px">
    <div class="paso"><b>Nueva automatización</b>Abrí la app Atajos → pestaña Automatización → ＋ → <b style="display:inline">Wallet</b> (en iOS 18 o anterior: Transacción).</div>
    <div class="paso"><b>Elegí la tarjeta</b>Tocá la tarjeta, dejá marcadas todas las categorías, elegí <b style="display:inline">Ejecutar inmediatamente</b> y tocá Siguiente. Si solo te deja una tarjeta, terminá esta y repetí los pasos para cada tarjeta.</div>
    <div class="paso"><b>Una sola acción</b>Tocá "Nueva automatización en blanco", buscá <code>Obtener contenido de URL</code> y pegá la Dirección de arriba donde dice URL.</div>
    <div class="paso"><b>Método POST</b>Tocá la flecha ⌄ de la acción y cambiá Método a <code>POST</code>. Dejá "Cuerpo de la solicitud" en JSON.</div>
    <div class="paso"><b>Cuatro campos de texto</b>Con "Agregar campo nuevo → Texto":<br><code>token</code> → pegá tu Token<br><code>monto</code> → tocá el valor, elegí Entrada del atajo → Importe<br><code>comercio</code> → Entrada del atajo → Comercio<br><code>tarjeta</code> → Entrada del atajo → Tarjeta o pase</div>
    <div class="paso"><b>Listo</b>Tocá OK. La fecha la pone la app sola. Al pagar, el gasto aparece en su sobre o en "Sin sobre".</div>
  </div>
  <div class="titulo" style="margin-top:26px">Que pregunte el sobre al pagar</div>
  <p class="nota" style="margin:0 4px 12px">El pago se guarda de una vez y enseguida te sale la lista de sobres, con el sugerido de primero. Si no elegís nada, el gasto queda guardado sin sobre.</p>
  <div class="pasos">
    <div class="paso"><b>Un campo más</b>En la acción que ya tenés, agregá un quinto campo de texto: <code>preguntar</code> con el valor <code>1</code>.</div>
    <div class="paso"><b>Sacar la lista</b>Debajo agregá la acción <code>Obtener valor del diccionario</code>. Dejala en "Valor", y en Clave escribí <code>opciones</code>.</div>
    <div class="paso"><b>Mostrar la lista</b>Agregá la acción <code>Seleccionar de la lista</code>. Se conecta sola con el paso anterior.</div>
    <div class="paso"><b>Mandar el sobre elegido</b>Agregá otra <code>Obtener contenido de URL</code> con la misma Dirección, Método <code>POST</code> y dos campos de texto: <code>token</code> → tu Token, y <code>sobre</code> → Elemento seleccionado.</div>
  </div>
  <div class="titulo" style="margin-top:26px">Opcional: ver un aviso</div>
  <div class="pasos">
    <div class="paso"><b>Notificación con el resultado</b>Al final agregá <code>Obtener valor del diccionario</code> con la clave <code>mensaje</code> y luego <code>Mostrar notificación</code>. Te dice el sobre y cuánto queda.</div>
  </div>`;
}

function estadoAtajo() {
  const u = S.gastos.find(g => g.fuente === 'applepay');
  if (!u) return `<div class="resultado" style="margin-top:12px">Todavía no ha llegado ningún pago por Apple Pay. Cuando llegue el primero, aquí vas a ver cuál fue.</div>`;
  const f = new Date(u.fecha);
  return `<div class="resultado" style="margin-top:12px"><b>El atajo funciona.</b> Último pago recibido: ${fmt(u.monto, u.moneda)}${u.comercio ? ' en ' + esc(u.comercio) : ''}, ${f.getDate()} ${MESES[f.getMonth()]} ${f.toLocaleTimeString('es-CR', { hour: 'numeric', minute: '2-digit' })}</div>`;
}

function datosAtajo() {
  const url = api.urlFuncion;
  return `<div class="campos">
    <div class="campo"><span>Dirección</span>${url ? `<code>${esc(url)}</code><button class="boton-txt" data-accion="copiar" data-texto="${esc(url)}" aria-label="Copiar dirección">${ico('copiar')}</button>` : '<span class="pendiente">Al publicar la app</span>'}</div>
    <div class="campo"><span>Token</span><code>${esc(S.cfg.token_atajos.slice(0, 6))}••••••</code><button class="boton-txt" data-accion="copiar" data-texto="${esc(S.cfg.token_atajos)}">${ico('copiar')} Copiar</button></div>
  </div><p class="nota">No compartás el token: con él se pueden registrar gastos en tu cuenta.</p>`;
}

function vistaAvisos() {
  return `${top('Avisos del banco', { atras: true })}
  <p class="nota" style="margin:-4px 4px 14px">Para compras con tarjeta física y SINPE Móvil que no pasan por Apple Pay. El BAC manda un SMS o un correo por cada compra; un atajo lo lee y registra el gasto.</p>
  ${datosAtajo()}
  <div class="titulo" style="margin-top:26px">SMS de SINPE</div>
  <p class="nota" style="margin:0 4px 12px">El BAC avisa por SMS cada SINPE. Los que recibís entran como ingreso, con el nombre de quien envió; los que enviás entran como gasto. Cada uno se registra una sola vez por su número de referencia.</p>
  <div class="pasos">
    <div class="paso"><b>Nueva automatización</b>App Atajos → ＋ → buscá el disparador <b style="display:inline">Mensaje</b>. En Remitente poné el número del que llegan los avisos del BAC, y en "El mensaje contiene" escribí <code>SINPE</code>.</div>
    <div class="paso"><b>La misma acción</b>Agregá <code>Obtener contenido de URL</code> con la Dirección de arriba, Método <code>POST</code> y cuerpo JSON.</div>
    <div class="paso"><b>Dos campos de texto</b><code>token</code> → tu Token<br><code>texto</code> → Entrada del atajo (el mensaje; si pide elegir, <b style="display:inline">Contenido</b>)</div>
  </div>
  <div class="titulo" style="margin-top:26px">Correo</div>
  <div class="pasos">
    <div class="paso"><b>Automatización de Correo</b>Remitente: la dirección de notificaciones del BAC. La cuenta tiene que estar en la app Mail.</div>
    <div class="paso"><b>Mandá el contenido</b>Igual que el SMS, con <code>fuente</code> = correo.</div>
  </div>
  <div class="titulo" style="margin-top:26px">Probar o registrar a mano</div>
  <div class="campos"><label class="campo columna"><span>Pegá aquí un SMS o correo del banco</span>
    <textarea id="aviso-txt" placeholder="BAC: Compra aprobada en AUTO MERCADO por CRC 12,500.00 tarjeta ****1234"></textarea></label></div>
  <div class="acciones"><button class="btn primario" data-accion="leer-aviso">Leer aviso</button></div>
  <div id="aviso-res"></div>`;
}

function vistaPersonalizacion() {
  return `${top('Personalización', { atras: true })}
  <div class="titulo">Tema</div>
  <div class="grupo sin-icono" role="radiogroup">
    ${opcion('cfg-tema', 'auto', 'Automático', S.cfg.tema === 'auto')}
    ${opcion('cfg-tema', 'claro', 'Claro', S.cfg.tema === 'claro')}
    ${opcion('cfg-tema', 'oscuro', 'Oscuro', S.cfg.tema === 'oscuro')}
  </div>
  <div class="titulo" style="margin-top:26px">Color</div>
  <div class="grupo sin-icono"><div class="fila colores" role="radiogroup">
    ${Object.entries(ACENTOS).map(([k, c]) => `<label><input type="radio" name="acento" value="${k}" data-cfg-acento ${S.cfg.acento === k ? 'checked' : ''} aria-label="${k}"><span style="background:${c}"></span></label>`).join('')}
  </div></div>`;
}

const vistaAcerca = () => `${top('Acerca de', { atras: true })}
  <div class="grupo sin-icono"><div class="fila"><span class="txt"><b>${NOMBRE_APP}</b><small>Presupuesto personal por sobres · versión 3</small></span></div></div>
  <p class="nota">Tus datos se guardan en tu propia base de datos. Nadie más tiene acceso.</p>`;

// ================= render =================
const VISTAS = {
  inicio: vistaInicio, sobres: vistaSobres, ahorros: vistaAhorros, movs: vistaMovs, est: vistaEst,
  suscripciones: vistaSuscripciones, ajustes: vistaAjustes, fijos: vistaFijos,
  sobre: vistaSobre, movimientos: vistaMovimientos, sinsobre: vistaSinSobre, historial: vistaHistorialGeneral,
  cuenta: vistaCuenta, monedas: vistaMonedas, metodos: vistaMetodos, reinicio: vistaReinicio, applepay: vistaApplePay,
  avisos: vistaAvisos, personalizacion: vistaPersonalizacion, acerca: vistaAcerca, descargas: vistaDescargas,
};
const TABS = [['inicio', 'casa', 'Inicio'], ['sobres', 'carrito', 'Sobres'], ['ahorros', 'alcancia', 'Ahorros'], ['est', 'barras', 'Análisis'], ['movs', 'buscar', 'Buscar']];

function render(animar = false) {
  const v = vistaActual();
  const el = $('#vista');
  el.innerHTML = VISTAS[v.v](v);
  if (animar) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
  // la barra se arma una vez; después solo se mueve la pastilla, así el cambio se ve deslizar
  const barra = $('.tabs');
  if (!barra.dataset.lista) {
    barra.innerHTML = '<span class="pill"></span>' + TABS.map(([k, i, t]) => `<button data-accion="tab" data-v="${k}">${ico(i)}${t}</button>`).join('');
    barra.dataset.lista = '1';
  }
  barra.style.setProperty('--i', Math.max(0, TABS.findIndex(x => x[0] === S.tab)));
  barra.querySelectorAll('button').forEach(b => { const on = b.dataset.v === S.tab; b.classList.toggle('activa', on); on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
  const fab = $('.fab');
  const fabVisible = ['inicio', 'sobres', 'ahorros', 'movs', 'suscripciones', 'sobre', 'movimientos', 'fijos'].includes(v.v);
  fab.hidden = !fabVisible;
  fab.innerHTML = ico('mas');
}

function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('ver');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('ver'), 2200);
}

// ================= hojas =================
function abrirHoja(titulo, cuerpo) {
  const h = $('#hoja');
  h.innerHTML = `<div class="velo" data-accion="cerrar"></div>
    <form class="panel" novalidate role="dialog" aria-label="${esc(titulo)}">
      <div class="panel-top"><h3>${esc(titulo)}</h3><button type="button" class="redondo" data-accion="cerrar" aria-label="Cerrar">${ico('cerrar')}</button></div>
      ${cuerpo}</form>`;
  h.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => h.classList.add('abierta')));
  const f = h.querySelector('form');
  // el monto grande crece con lo que se escribe, para que el símbolo quede pegado
  const m = f.querySelector('.monto-grande input');
  f.querySelectorAll(SEL_MONTO).forEach(i => { if (i.value) i.value = numATexto(i.value); });
  if (m) {
    m.insertAdjacentHTML('afterend', '<span class="dec" aria-hidden="true"></span>');
    const dec = m.nextElementSibling;
    const ajustar = () => {
      dec.textContent = decimalesFaltan(m.value);
      const largo = (m.value || m.placeholder).length + dec.textContent.length;
      // los montos largos bajan de tamaño para caber en una línea
      const px = largo > 13 ? 30 : largo > 10 ? 38 : largo > 8 ? 46 : 54;
      m.closest('.fila-monto').style.setProperty('--tam', px + 'px');
      m.style.width = Math.max(1, (m.value || m.placeholder).length) + 0.3 + 'ch';
    };
    m.addEventListener('input', ajustar); ajustar();
  }
  // que el chip elegido quede a la vista
  f.querySelectorAll('.chips').forEach(c => { const l = c.querySelector('input:checked')?.closest('label'); if (l) c.scrollLeft = l.offsetLeft - 20; });
  const foco = f.querySelector('[autofocus]'); if (foco) setTimeout(() => foco.focus(), 80);
  return f;
}
function cerrarHoja() {
  const h = $('#hoja'); h.classList.remove('abierta');
  setTimeout(() => { if (!h.classList.contains('abierta')) { h.hidden = true; h.innerHTML = ''; } }, 250);
}

const chipsSobre = (nombre, sel, primera = 'Sin sobre') => `<div class="chips" role="radiogroup">
  <label><input type="radio" name="${nombre}" value="" ${!sel ? 'checked' : ''}><span>${primera}</span></label>
  ${S.sobres.map(s => `<label><input type="radio" name="${nombre}" value="${s.id}" ${sel === s.id ? 'checked' : ''}><span>${ico(s.icono)}${esc(s.nombre)}</span></label>`).join('')}</div>`;
const alternarMoneda = (nombre, sel) => `<div class="alternar" role="radiogroup" aria-label="Moneda">
  <label><input type="radio" name="${nombre}" value="CRC" ${sel !== 'USD' ? 'checked' : ''}><span>₡ Colones</span></label>
  <label><input type="radio" name="${nombre}" value="USD" ${sel === 'USD' ? 'checked' : ''}><span>$ Dólares</span></label></div>`;
const valorRadio = (f, n) => (f.querySelector(`input[name="${n}"]:checked`) || {}).value || '';

function hojaGasto(g = null, pre = {}) {
  const v = vistaActual();
  const base = { sobre_id: v.v === 'sobre' ? v.id : '', moneda: 'CRC', ...pre, ...(g || {}) };
  const fecha = new Date(base.fecha || Date.now());
  const local = new Date(fecha - fecha.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const automatico = g && g.fuente !== 'manual' && g.fuente !== 'suscripcion';
  const f = abrirHoja(g ? 'Editar gasto' : 'Nuevo gasto', `${g || pre.fuente ? '' : selectorTipo('gasto')}
    <div class="monto-grande">
      <div class="fila-monto"><span class="simbolo">${base.moneda === 'USD' ? '$' : '₡'}</span>
        <input name="monto" inputmode="decimal" placeholder="0" value="${base.monto ?? ''}" autofocus aria-label="Monto"></div>
      ${alternarMoneda('moneda', base.moneda)}
    </div>
    <div class="etiqueta">Sobre</div>${chipsSobre('sobre', base.sobre_id)}
    ${S.metodos.length ? `<div class="etiqueta">Método de pago</div><div class="chips" role="radiogroup">
      <label><input type="radio" name="metodo" value="" ${!base.metodo_id ? 'checked' : ''}><span>Ninguno</span></label>
      ${S.metodos.map(m => `<label><input type="radio" name="metodo" value="${m.id}" ${base.metodo_id === m.id ? 'checked' : ''}><span>${ico(tipoMetodo(m)[1])}${esc(m.nombre)}</span></label>`).join('')}</div>` : ''}
    <div class="etiqueta">Estado</div><div class="chips" role="radiogroup">
      ${[['pagado', 'Pagado'], ['pendiente', 'Pendiente'], ['planeado', 'Planeado']].map(([k, n]) => `<label><input type="radio" name="estado" value="${k}" ${(base.estado || 'pagado') === k ? 'checked' : ''}><span>${k === 'pagado' ? '' : `<i class="marca-est ${k}" style="margin:0"></i>`}${n}</span></label>`).join('')}</div>
    <div class="campos" style="margin-top:14px">
      <label class="campo"><span>Comercio</span><input name="comercio" value="${esc(base.comercio || '')}" placeholder="Opcional" list="comercios" autocomplete="off"></label>
      <label class="campo"><span>Fecha</span><input type="datetime-local" name="fecha" value="${local}"></label>
      <label class="campo"><span>Nota</span><input name="nota" value="${esc(/^(sub|ahorro):/.test(base.nota || '') ? '' : base.nota || '')}" placeholder="Opcional"></label>
      ${automatico && g.comercio ? `<label class="campo"><span style="color:var(--tinta)">Recordar sobre para este comercio</span><span class="interruptor"><input type="checkbox" name="recordar" checked><span></span></span></label>` : ''}
    </div>
    <datalist id="comercios">${[...new Set(S.gastos.map(x => x.comercio).filter(Boolean))].slice(0, 80).map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    ${automatico ? `<p class="nota">Registrado por ${FUENTES[g.fuente]}${g.tarjeta ? ' · tarjeta •••• ' + esc(g.tarjeta) : ''}</p>` : ''}
    <div class="acciones">
      ${g ? `<button type="button" class="btn peligro" data-accion="borrar-gasto" data-id="${g.id}" aria-label="Borrar gasto">${ico('basura')}</button>` : ''}
      <button type="submit" class="btn primario">Guardar</button>
    </div>`);
  enlazarTipo(f);
  let tocoSobre = !!(g || pre.sobre_id);
  f.querySelectorAll('input[name="sobre"]').forEach(r => r.addEventListener('change', () => { tocoSobre = true; }));
  f.querySelectorAll('input[name="moneda"]').forEach(r => r.addEventListener('change', () => { $('.simbolo', f).textContent = r.value === 'USD' ? '$' : '₡'; }));
  f.comercio.addEventListener('input', () => {
    if (tocoSobre) return;
    const r = S.reglas.find(x => x.comercio === normalizarComercio(f.comercio.value));
    if (r) { const radio = f.querySelector(`input[name="sobre"][value="${r.sobre_id}"]`); if (radio) { radio.checked = true; radio.closest('label').scrollIntoView({ inline: 'center', block: 'nearest' }); } }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const monto = leerMontoCampo(f.monto.value);
    if (!monto) { f.monto.classList.add('mal-campo'); f.monto.focus(); return; }
    const fila = {
      monto, moneda: valorRadio(f, 'moneda'), comercio: f.comercio.value.trim() || null,
      sobre_id: valorRadio(f, 'sobre') || null, metodo_id: valorRadio(f, 'metodo') || null, estado: valorRadio(f, 'estado') || 'pagado',
      fecha: new Date(f.fecha.value || Date.now()).toISOString(),
    };
    if (!g || !/^(sub|ahorro):/.test(g.nota || '')) fila.nota = f.nota.value.trim() || null;
    if (g) Object.assign(g, await api.actualizar('gastos', g.id, fila));
    else S.gastos.push(await api.insertar('gastos', { ...fila, fuente: pre.fuente || 'manual', tarjeta: pre.tarjeta || null }));
    S.gastos.sort((a, b) => b.fecha.localeCompare(a.fecha));
    const recordar = f.recordar ? f.recordar.checked : true;
    if (fila.comercio && fila.sobre_id && recordar) await aprender(fila.comercio, fila.sobre_id);
    cerrarHoja(); render(); toast(g ? 'Gasto actualizado' : 'Gasto agregado');
  });
}

// Memoria comercio -> sobre; acomoda también los otros gastos sin sobre de ese comercio
async function aprender(comercio, sobreId) {
  const r = { comercio: normalizarComercio(comercio), sobre_id: sobreId };
  if (!r.comercio) return;
  await api.insertar('reglas_comercio', r);
  S.reglas = S.reglas.filter(x => x.comercio !== r.comercio).concat(r);
  for (const x of S.gastos.filter(x => !x.sobre_id && normalizarComercio(x.comercio) === r.comercio)) {
    Object.assign(x, await api.actualizar('gastos', x.id, { sobre_id: sobreId }));
  }
}

function rejilla(nombre, lista, sel) {
  return `<div class="rejilla-iconos" role="radiogroup" aria-label="Ícono">${lista.map(i => `<label><input type="radio" name="${nombre}" value="${i}" ${sel === i ? 'checked' : ''} aria-label="${i}"><span>${ico(i)}</span></label>`).join('')}</div>`;
}

function hojaSobre(s = null) {
  const f = abrirHoja(s ? 'Editar sobre' : 'Nuevo sobre', `
    <div class="campos">
      <label class="campo"><span>Nombre</span><input name="nombre" value="${esc(s?.nombre || '')}" placeholder="Supermercado" autofocus></label>
      <label class="campo"><span>Presupuesto</span><input name="presupuesto" inputmode="decimal" value="${s && s.presupuesto > 0 ? s.presupuesto : ''}" placeholder="Sin presupuesto"></label>
      <label class="campo"><span>Moneda</span><select name="moneda"><option value="CRC" ${s?.moneda !== 'USD' ? 'selected' : ''}>Colones ₡</option><option value="USD" ${s?.moneda === 'USD' ? 'selected' : ''}>Dólares $</option></select></label>
    </div>
    <div class="etiqueta">Ícono</div>${rejilla('icono', ICONOS_SOBRE, s?.icono || 'carrito')}
    <div class="acciones">
      ${s ? `<button type="button" class="btn peligro" data-accion="borrar-sobre" data-id="${s.id}" aria-label="Eliminar sobre">${ico('basura')}</button>` : ''}
      <button type="submit" class="btn primario">Guardar</button>
    </div>`);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = f.nombre.value.trim();
    if (!nombre) { f.nombre.classList.add('mal-campo'); f.nombre.focus(); return; }
    const fila = { nombre, presupuesto: leerMontoCampo(f.presupuesto.value), moneda: f.moneda.value, icono: valorRadio(f, 'icono') || 'carrito' };
    if (s) Object.assign(s, await api.actualizar('sobres', s.id, fila));
    else S.sobres.push(await api.insertar('sobres', { ...fila, orden: S.sobres.length }));
    cerrarHoja(); render(); toast(s ? 'Sobre actualizado' : 'Sobre creado');
  });
}

function hojaMetodo(m = null) {
  const f = abrirHoja(m ? 'Editar método' : 'Nuevo método de pago', `
    <div class="campos">
      <label class="campo"><span>Nombre</span><input name="nombre" value="${esc(m?.nombre || '')}" placeholder="BAC Visa" autofocus></label>
      <label class="campo"><span>Tipo</span><select name="tipo">${Object.entries(TIPOS_METODO).map(([k, [t]]) => `<option value="${k}" ${(m?.tipo || 'tarjeta') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="campo"><span>Últimos 4</span><input name="ultimos4" inputmode="numeric" maxlength="4" value="${esc(m?.ultimos4 || '')}" placeholder="1234"></label>
    </div>
    <div class="etiqueta">Al pagar con este método, cargar a</div>${chipsSobre('sobre', m?.sobre_id, 'Lo de Ajustes')}
    <div class="acciones">
      ${m ? `<button type="button" class="btn peligro" data-accion="borrar-metodo" data-id="${m.id}" aria-label="Eliminar método">${ico('basura')}</button>` : ''}
      <button type="submit" class="btn primario">Guardar</button>
    </div>`);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = f.nombre.value.trim(), u4 = f.ultimos4.value.replace(/\D/g, '');
    if (!nombre) { f.nombre.classList.add('mal-campo'); f.nombre.focus(); return; }
    if (u4 && u4.length !== 4) { f.ultimos4.classList.add('mal-campo'); f.ultimos4.focus(); return; }
    const fila = { nombre, tipo: f.tipo.value, ultimos4: u4 || null, sobre_id: valorRadio(f, 'sobre') || null };
    if (m) Object.assign(m, await api.actualizar('metodos_pago', m.id, fila));
    else S.metodos.push(await api.insertar('metodos_pago', { ...fila, orden: S.metodos.length }));
    cerrarHoja(); render(); toast('Método guardado');
  });
}

function hojaSub(s = null) {
  const f = abrirHoja(s ? 'Editar suscripción' : 'Nueva suscripción', `
    <div class="monto-grande">
      <div class="fila-monto"><span class="simbolo">${s?.moneda === 'CRC' ? '₡' : '$'}</span><input name="monto" inputmode="decimal" placeholder="0" value="${s?.monto ?? ''}" aria-label="Monto"></div>
      ${alternarMoneda('moneda', s?.moneda || 'USD')}
    </div>
    <div class="campos">
      <label class="campo"><span>Nombre</span><input name="nombre" value="${esc(s?.nombre || '')}" placeholder="Spotify" autofocus></label>
      <label class="campo"><span>Frecuencia</span><select name="frecuencia"><option value="mensual">Mensual</option><option value="anual" ${s?.frecuencia === 'anual' ? 'selected' : ''}>Anual</option></select></label>
      <label class="campo"><span>Día de cobro</span><input name="dia_cobro" inputmode="numeric" value="${s?.dia_cobro ?? new Date().getDate()}"></label>
      <label class="campo" data-anual ${s?.frecuencia === 'anual' ? '' : 'hidden'}><span>Mes</span><select name="mes_cobro">${MESES_L.map((m, i) => `<option value="${i + 1}" ${(s?.mes_cobro || new Date().getMonth() + 1) === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      ${s ? `<label class="campo"><span style="color:var(--tinta)">Activa</span><span class="interruptor"><input type="checkbox" name="activa" ${s.activa ? 'checked' : ''}><span></span></span></label>` : ''}
    </div>
    <div class="etiqueta">Cargar al sobre</div>${chipsSobre('sobre', s?.sobre_id)}
    <p class="nota">El día de cobro se registra solo como gasto, y dos días antes te sale el aviso en Gastos.</p>
    <div class="acciones">
      ${s ? `<button type="button" class="btn peligro" data-accion="borrar-sub" data-id="${s.id}" aria-label="Eliminar suscripción">${ico('basura')}</button>` : ''}
      <button type="submit" class="btn primario">Guardar</button>
    </div>`);
  f.frecuencia.addEventListener('change', () => { f.querySelector('[data-anual]').hidden = f.frecuencia.value !== 'anual'; });
  f.querySelectorAll('input[name="moneda"]').forEach(r => r.addEventListener('change', () => { $('.simbolo', f).textContent = r.value === 'USD' ? '$' : '₡'; }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const monto = leerMontoCampo(f.monto.value), dia = Math.round(Number(f.dia_cobro.value));
    if (!f.nombre.value.trim()) { f.nombre.classList.add('mal-campo'); f.nombre.focus(); return; }
    if (!monto) { f.monto.classList.add('mal-campo'); f.monto.focus(); return; }
    if (!(dia >= 1 && dia <= 31)) { f.dia_cobro.classList.add('mal-campo'); f.dia_cobro.focus(); return; }
    const fila = {
      nombre: f.nombre.value.trim(), monto, moneda: valorRadio(f, 'moneda'), frecuencia: f.frecuencia.value, dia_cobro: dia,
      mes_cobro: f.frecuencia.value === 'anual' ? Number(f.mes_cobro.value) : null, sobre_id: valorRadio(f, 'sobre') || null,
      activa: s ? f.activa.checked : true,
    };
    if (s) Object.assign(s, await api.actualizar('suscripciones', s.id, fila));
    else S.subs.push(await api.insertar('suscripciones', fila));
    await cobrarSuscripciones();
    cerrarHoja(); render(); toast('Suscripción guardada');
  });
}

function hojaAhorro(a = null) {
  const f = abrirHoja(a ? 'Editar sobre de ahorro' : 'Nuevo sobre de ahorro', `
    <div class="campos">
      <label class="campo"><span>Nombre</span><input name="nombre" value="${esc(a?.nombre || '')}" placeholder="Viaje, emergencias…" autofocus></label>
      <label class="campo"><span>Meta</span><input name="meta" inputmode="decimal" value="${a?.meta || ''}" placeholder="Opcional"></label>
      <label class="campo"><span>Moneda</span><select name="moneda"><option value="CRC">Colones ₡</option><option value="USD" ${a?.moneda === 'USD' ? 'selected' : ''}>Dólares $</option></select></label>
    </div>
    <div class="etiqueta">Ícono</div>${rejilla('icono', ICONOS_AHORRO, a?.icono || 'meta')}
    <div class="acciones">
      ${a ? `<button type="button" class="btn peligro" data-accion="borrar-ahorro" data-id="${a.id}" aria-label="Eliminar ahorro">${ico('basura')}</button>` : ''}
      <button type="submit" class="btn primario">Guardar</button>
    </div>`);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!f.nombre.value.trim()) { f.nombre.classList.add('mal-campo'); f.nombre.focus(); return; }
    const fila = { nombre: f.nombre.value.trim(), meta: leerMontoCampo(f.meta.value), moneda: f.moneda.value, icono: valorRadio(f, 'icono') || 'meta' };
    if (a) Object.assign(a, await api.actualizar('ahorros', a.id, fila));
    else S.ahorros.push(await api.insertar('ahorros', { ...fila, ahorrado: 0, orden: S.ahorros.length }));
    cerrarHoja(); render(); toast('Ahorro guardado');
  });
}

function hojaPresupuesto(s) {
  const f = abrirHoja(`Presupuesto de ${s.nombre}`, `
    <div class="monto-grande">
      <div class="fila-monto"><span class="simbolo">${s.moneda === 'USD' ? '$' : '₡'}</span>
        <input name="monto" inputmode="decimal" placeholder="0" value="${s.presupuesto > 0 ? s.presupuesto : ''}" autofocus aria-label="Presupuesto mensual"></div>
      <small class="nota" style="margin:6px 0 0">por mes · dejalo en 0 para no tener presupuesto</small>
    </div>
    <div class="acciones"><button type="submit" class="btn primario">Guardar</button></div>`);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    Object.assign(s, await api.actualizar('sobres', s.id, { presupuesto: leerMontoCampo(f.monto.value) }));
    cerrarHoja(); render(); toast('Presupuesto guardado');
  });
}

// El sobrante sale del sobre como un movimiento y entra al sobre de ahorro elegido
function hojaPasarAhorro(s) {
  const e = estadoSobre(s, gastadoSobre(s, enCiclo(ciclo())));
  if (!S.ahorros.length) { toast('Primero creá un sobre de ahorro en la pestaña Ahorros'); return; }
  const f = abrirHoja('Pasar a ahorro', `
    <p class="nota" style="text-align:center;margin:0 0 4px">Sobrante de ${esc(s.nombre)}: <b class="bien">${fmt(e.monto, s.moneda)}</b></p>
    <div class="monto-grande">
      <div class="fila-monto"><span class="simbolo">${s.moneda === 'USD' ? '$' : '₡'}</span>
        <input name="monto" inputmode="decimal" value="${Math.round(e.monto * 100) / 100}" autofocus aria-label="Monto"></div>
    </div>
    <div class="etiqueta">A qué ahorro</div>
    <div class="chips" role="radiogroup">${S.ahorros.map((a, i) => `<label><input type="radio" name="ahorro" value="${a.id}" ${i === 0 ? 'checked' : ''}><span>${ico(a.icono)}${esc(a.nombre)}</span></label>`).join('')}</div>
    <div class="acciones"><button type="submit" class="btn primario">Pasar</button></div>`);
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const monto = leerMontoCampo(f.monto.value);
    if (!monto) { f.monto.classList.add('mal-campo'); f.monto.focus(); return; }
    const a = S.ahorros.find(x => x.id === valorRadio(f, 'ahorro'));
    S.gastos.push(await api.insertar('gastos', {
      sobre_id: s.id, monto, moneda: s.moneda, comercio: 'Ahorro: ' + a.nombre, fuente: 'ahorro',
      fecha: new Date().toISOString(), nota: 'ahorro:' + a.id,
    }));
    S.gastos.sort((x, y) => y.fecha.localeCompare(x.fecha));
    Object.assign(a, await api.actualizar('ahorros', a.id, { ahorrado: Math.round((Number(a.ahorrado) + conv(monto, s.moneda, a.moneda)) * 100) / 100 }));
    cerrarHoja(); render(); toast(`${fmt(monto, s.moneda)} pasados a ${a.nombre}`);
  });
}

function hojaMoverAhorro(a) {
  const f = abrirHoja(a.nombre, `
    <p class="nota" style="text-align:center;margin:0 0 4px">Ahorrado: <b class="bien">${fmt(a.ahorrado, a.moneda)}</b>${a.meta ? ` de ${fmt(a.meta, a.moneda)}` : ''}</p>
    <div class="monto-grande">
      <div class="fila-monto"><span class="simbolo">${a.moneda === 'USD' ? '$' : '₡'}</span><input name="monto" inputmode="decimal" placeholder="0" autofocus aria-label="Monto"></div>
      <div class="alternar" role="radiogroup"><label><input type="radio" name="tipo" value="1" checked><span>Agregar</span></label><label><input type="radio" name="tipo" value="-1"><span>Retirar</span></label></div>
    </div>
    <div class="acciones">
      <button type="button" class="btn" data-accion="editar-ahorro" data-id="${a.id}">Editar</button>
      <button type="submit" class="btn primario">Guardar</button>
    </div>`);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const monto = leerMontoCampo(f.monto.value);
    if (!monto) { f.monto.classList.add('mal-campo'); f.monto.focus(); return; }
    const nuevo = Math.max(0, Number(a.ahorrado) + monto * Number(valorRadio(f, 'tipo')));
    Object.assign(a, await api.actualizar('ahorros', a.id, { ahorrado: nuevo }));
    cerrarHoja(); render(); toast('Ahorro actualizado');
  });
}

function abrirMenu() {
  const n = S.gastos.filter(g => !g.sobre_id).length;
  const capa = document.createElement('div');
  capa.innerHTML = `<div class="capa-menu" data-accion="cerrar-menu"></div><div class="menu" role="menu">
    <button role="menuitem" data-accion="nuevo-sobre">Nuevo sobre ${ico('mas')}</button>
    <button role="menuitem" data-accion="ir" data-v="movimientos">Movimientos del mes ${ico('lista')}</button>
    <button role="menuitem" data-accion="ir" data-v="historial">Historial ${ico('historial')}</button>
    <button role="menuitem" data-accion="ir" data-v="sinsobre">Sin sobre${n ? ` (${n})` : ''} ${ico('bandeja')}</button>
    <button role="menuitem" data-accion="ir" data-v="avisos">Pegar aviso del banco ${ico('mensaje')}</button></div>`;
  capa.id = 'menu'; document.body.appendChild(capa);
}
const cerrarMenu = () => $('#menu')?.remove();

async function guardarCfg(cambios) {
  Object.assign(S.cfg, await api.actualizar('config', S.cfg.user_id, cambios, 'user_id') || cambios);
  aplicarTema();
}

// ---------- descargas (con rango de fechas) ----------
const aISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const deISO = (s, fin = false) => { const [y, m, d] = s.split('-').map(Number); return fin ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d); };
const fechaCorta = (d) => `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;

function rangoPreset(k) {
  const hoy = new Date(), c = ciclo();
  if (k === 'pasado') { const p = ciclo(-1); return { desde: aISO(p.ini), hasta: aISO(new Date(p.fin - 864e5)) }; }
  if (k === 'anio') return { desde: `${hoy.getFullYear()}-01-01`, hasta: aISO(hoy) };
  if (k === 'todo') { const u = S.gastos[S.gastos.length - 1]; return { desde: aISO(u ? new Date(u.fecha) : hoy), hasta: aISO(hoy) }; }
  return { desde: aISO(c.ini), hasta: aISO(hoy) };
}
function rangoDescarga() {
  if (!S.desc) S.desc = { ...rangoPreset('mes'), preset: 'mes' };
  let desde = deISO(S.desc.desde), hasta = deISO(S.desc.hasta, true);
  if (desde > hasta) [desde, hasta] = [deISO(S.desc.hasta), deISO(S.desc.desde, true)];
  return { desde, hasta, texto: `${fechaCorta(desde)} al ${fechaCorta(hasta)}`, archivo: `${aISO(desde)} a ${aISO(hasta)}` };
}
const gastosRango = (r) => S.gastos.filter(g => { const f = new Date(g.fecha); return f >= r.desde && f <= r.hasta; });

function vistaDescargas() {
  const r = rangoDescarga(), n = gastosRango(r).length;
  const chip = (k, txt) => `<label><input type="radio" name="preset" value="${k}" data-desc-preset ${S.desc.preset === k ? 'checked' : ''}><span>${txt}</span></label>`;
  return `${top('Descargar datos', { atras: true })}
  <div class="titulo">Fechas</div>
  <div class="chips" role="radiogroup" style="margin-bottom:12px">${chip('mes', 'Este mes')}${chip('pasado', 'Mes pasado')}${chip('anio', 'Este año')}${chip('todo', 'Todo')}</div>
  <div class="campos">
    <label class="campo"><span>Desde</span><input type="date" value="${S.desc.desde}" data-desc="desde"></label>
    <label class="campo"><span>Hasta</span><input type="date" value="${S.desc.hasta}" data-desc="hasta"></label>
  </div>
  <p class="nota">${n} ${n === 1 ? 'gasto' : 'gastos'} del ${r.texto}.</p>
  <div class="titulo" style="margin-top:26px">Descargar</div>
  <div class="grupo">
    <button class="fila" data-accion="excel">${ico('lista')}<span class="txt"><b>Excel</b><small>Resumen por mes y sobre, gastos, sobres, ahorros y suscripciones</small></span>${ico('descargar', 'fin')}</button>
    <button class="fila" data-accion="informe">${ico('recibo')}<span class="txt"><b>Informe en PDF</b><small>Totales, tabla por sobre y detalle de gastos</small></span>${ico('descargar', 'fin')}</button>
    <button class="fila" data-accion="exportar">${ico('copiar')}<span class="txt"><b>CSV</b><small>Solo los gastos, en una tabla</small></span>${ico('descargar', 'fin')}</button>
  </div>
  <p class="nota">Para el PDF se abre la ventana de impresión: en el iPhone tocá Compartir → Guardar en Archivos.</p>`;
}

function exportar() {
  const r = rangoDescarga();
  const filas = [['fecha', 'comercio', 'monto', 'moneda', 'sobre', 'metodo', 'origen', 'nota']];
  for (const g of gastosRango(r)) filas.push([g.fecha.slice(0, 16).replace('T', ' '), g.comercio || '', g.monto, g.moneda,
    sobreDe(g.sobre_id)?.nombre || '', metodoDe(g.metodo_id)?.nombre || '', FUENTES[g.fuente], /^(sub|ahorro):/.test(g.nota || '') ? '' : g.nota || '']);
  const csv = '﻿' + filas.map(f => f.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${NOMBRE_APP} gastos ${r.archivo}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Una fila por mes y sobre, contando solo los gastos dentro del rango
function filasResumen(r) {
  const filas = [];
  for (let d = 0; d >= -14; d--) {
    const c = ciclo(d);
    if (c.fin <= r.desde || c.ini > r.hasta) continue;
    const lista = enCiclo(c).filter(g => { const f = new Date(g.fecha); return f >= r.desde && f <= r.hasta; });
    for (const s of S.sobres) {
      const g = gastadoSobre(s, lista), e = estadoSobre(s, g);
      if (!g && !e.conPres) continue;
      filas.push({ mes: nombreCiclo(c.ini), inicio: c.ini, s, gastado: g, e, n: lista.filter(x => x.sobre_id === s.id).length });
    }
  }
  return filas;
}

async function descargarExcel() {
  if (!window.XLSX) {
    toast('Preparando Excel…');
    await new Promise((ok, mal) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      sc.onload = ok; sc.onerror = () => mal(new Error('no se pudo cargar el generador de Excel (¿sin internet?)'));
      document.head.appendChild(sc);
    });
  }
  const r = rangoDescarga();
  const X = window.XLSX, libro = X.utils.book_new();
  const hoja = (nombre, filas, anchos) => {
    const h = X.utils.json_to_sheet(filas, { cellDates: true });
    h['!cols'] = anchos.map(w => ({ wch: w }));
    X.utils.book_append_sheet(libro, h, nombre);
  };
  hoja('Resumen', filasResumen(r).map(f => ({
    'Mes': f.mes, 'Inicio': f.inicio, 'Sobre': f.s.nombre, 'Moneda': f.s.moneda,
    'Presupuesto': f.e.conPres ? Number(f.s.presupuesto) : null, 'Gastado': Math.round(f.gastado * 100) / 100,
    'Sobrante (+) / Sobregiro (−)': f.e.conPres ? Math.round((f.s.presupuesto - f.gastado) * 100) / 100 : null,
    'Estado': f.e.conPres ? f.e.etiqueta : 'sin presupuesto', 'Cantidad de gastos': f.n,
  })), [22, 12, 20, 8, 14, 14, 26, 16, 10]);
  hoja('Gastos', gastosRango(r).map(g => {
    const s = sobreDe(g.sobre_id);
    return {
      'Fecha': new Date(g.fecha), 'Comercio': g.comercio || '', 'Monto': Number(g.monto), 'Moneda': g.moneda,
      'Monto en moneda del sobre': s ? Math.round(conv(g.monto, g.moneda, s.moneda) * 100) / 100 : null,
      'Sobre': s?.nombre || 'Sin sobre', 'Método de pago': metodoDe(g.metodo_id)?.nombre || '', 'Tarjeta': g.tarjeta || '',
      'Origen': FUENTES[g.fuente] || g.fuente, 'Estado': g.estado || 'pagado', 'Nota': /^(sub|ahorro):/.test(g.nota || '') ? '' : g.nota || '',
    };
  }), [18, 26, 12, 8, 14, 18, 16, 8, 14, 24]);
  hoja('Ingresos', S.ingresos.filter(i => { const f = new Date(i.fecha); return f >= r.desde && f <= r.hasta; }).map(i => ({
    'Fecha': new Date(i.fecha), 'De': i.origen || '', 'Monto': Number(i.monto), 'Moneda': i.moneda,
    'Origen': i.fuente === 'fijo' ? 'Ingreso fijo' : i.fuente === 'manual' ? 'A mano' : 'Aviso del banco',
    'Nota': /^fijo:/.test(i.nota || '') ? '' : i.nota || '',
  })), [18, 30, 14, 8, 16, 24]);
  hoja('Sobres', S.sobres.map(s => ({ 'Sobre': s.nombre, 'Moneda': s.moneda, 'Presupuesto mensual': s.presupuesto > 0 ? Number(s.presupuesto) : null })), [22, 8, 20]);
  hoja('Ahorros', S.ahorros.map(a => ({
    'Sobre de ahorro': a.nombre, 'Moneda': a.moneda, 'Meta': a.meta > 0 ? Number(a.meta) : null, 'Ahorrado': Number(a.ahorrado),
    'Avance %': a.meta > 0 ? Math.round(a.ahorrado / a.meta * 1000) / 10 : null,
  })), [24, 8, 14, 14, 10]);
  hoja('Suscripciones', S.subs.map(s => ({
    'Suscripción': s.nombre, 'Monto': Number(s.monto), 'Moneda': s.moneda, 'Frecuencia': s.frecuencia,
    'Día de cobro': s.dia_cobro, 'Próximo cobro': proximoCobro(s), 'Sobre': sobreDe(s.sobre_id)?.nombre || '', 'Activa': s.activa ? 'Sí' : 'No',
  })), [22, 12, 8, 12, 12, 14, 18, 8]);
  X.writeFile(libro, `${NOMBRE_APP} ${r.archivo}.xlsx`, { cellDates: true });
  toast('Excel descargado');
}

function informe() {
  const r = rangoDescarga(), lista = gastosRango(r), mv = S.cfg.moneda_vista;
  // meses que toca el rango: el presupuesto del período es el mensual por esa cantidad
  let meses = 0; for (let d = 0; d >= -14; d--) { const c = ciclo(d); if (c.fin > r.desde && c.ini <= r.hasta) meses++; }
  meses = Math.max(1, meses);
  const filas = S.sobres.map(s => {
    const g = gastadoSobre(s, lista), pres = Number(s.presupuesto) * meses;
    return { s, g, pres, conPres: pres > 0, dif: pres - g };
  }).filter(f => f.g || f.conPres);
  const totPres = filas.filter(f => f.conPres).reduce((a, f) => a + conv(f.pres, f.s.moneda, mv), 0);
  const totGast = lista.reduce((a, g) => a + conv(g.monto, g.moneda, mv), 0);
  const neto = totPres - filas.filter(f => f.conPres).reduce((a, f) => a + conv(f.g, f.s.moneda, mv), 0);
  const el = $('#informe') || Object.assign(document.body.appendChild(document.createElement('div')), { id: 'informe' });
  el.innerHTML = `
    <h1>Informe de gastos</h1>
    <p class="sub">Del ${r.texto} · generado el ${new Date().toLocaleDateString('es-CR')}</p>
    <div class="cifras">
      <div><small>Presupuesto${meses > 1 ? ` (${meses} meses)` : ''}</small><b>${fmt(totPres, mv)}</b></div>
      <div><small>Gastado</small><b>${fmt(totGast, mv)}</b></div>
      <div><small>${neto < 0 ? 'Sobregiro' : 'Sobrante'}</small><b class="${neto < 0 ? 'mal' : 'bien'}">${fmt(Math.abs(neto), mv)}</b></div>
    </div>
    <h2>Por sobre</h2>
    <table><thead><tr><th>Sobre</th><th>Presupuesto${meses > 1 ? ` (${meses} meses)` : ''}</th><th>Gastado</th><th>Sobrante / sobregiro</th></tr></thead><tbody>
      ${filas.map(f => `<tr><td>${esc(f.s.nombre)}</td><td>${f.conPres ? fmt(f.pres, f.s.moneda) : '—'}</td><td>${fmt(f.g, f.s.moneda)}</td>
        <td class="${f.conPres ? (f.dif < 0 ? 'mal' : 'bien') : ''}">${f.conPres ? fmt(f.dif, f.s.moneda) : '—'}</td></tr>`).join('')}
    </tbody></table>
    ${S.ahorros.length ? `<h2>Sobres de ahorro</h2><table><thead><tr><th>Ahorro</th><th>Meta</th><th>Ahorrado</th><th>Avance</th></tr></thead><tbody>
      ${S.ahorros.map(a => `<tr><td>${esc(a.nombre)}</td><td>${a.meta > 0 ? fmt(a.meta, a.moneda) : '—'}</td><td>${fmt(a.ahorrado, a.moneda)}</td><td>${a.meta > 0 ? Math.round(a.ahorrado / a.meta * 100) + '%' : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>Detalle de gastos</h2>
    <table class="detalle"><thead><tr><th>Fecha</th><th>Comercio</th><th>Sobre</th><th>Método</th><th>Monto</th></tr></thead><tbody>
      ${[...lista].reverse().map(g => `<tr><td>${new Date(g.fecha).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })}</td><td>${esc(g.comercio || '')}</td>
        <td>${esc(sobreDe(g.sobre_id)?.nombre || 'Sin sobre')}</td><td>${esc(metodoDe(g.metodo_id)?.nombre || FUENTES[g.fuente])}</td><td>${fmt(g.monto, g.moneda)}</td></tr>`).join('')}
    </tbody></table>`;
  setTimeout(() => window.print(), 50);
}

function leerAvisoPegado() {
  const txt = $('#aviso-txt').value, res = $('#aviso-res');
  const a = leerAviso({ texto: txt });
  if (!a.ok) { res.innerHTML = `<div class="resultado error">No lo pude leer: ${esc(a.motivo)}.</div>`; return; }
  if (a.tipo === 'ingreso') {
    S.avisoLeido = { ingreso: true, monto: a.monto, moneda: a.moneda, origen: a.origen, fuente: 'sms', referencia: a.referencia };
    res.innerHTML = `<div class="resultado"><b>Ingreso de ${fmt(a.monto, a.moneda)}</b>${a.origen ? ' de ' + esc(a.origen) : ''}</div>
      <div class="acciones"><button class="btn primario" data-accion="registrar-aviso">Revisar y registrar</button></div>`;
    return;
  }
  const m = S.metodos.find(x => x.ultimos4 && x.ultimos4 === a.tarjeta);
  const regla = a.comercio && S.reglas.find(r => r.comercio === normalizarComercio(a.comercio));
  const sobre = m?.sobre_id || S.cfg.atajo_sobre_id || (S.cfg.atajo_recordar && regla ? regla.sobre_id : '');
  S.avisoLeido = { monto: a.monto, moneda: a.moneda, comercio: a.comercio, tarjeta: a.tarjeta, metodo_id: m?.id, sobre_id: sobre, fuente: 'sms' };
  res.innerHTML = `<div class="resultado"><b>${fmt(a.monto, a.moneda)}</b>${a.comercio ? ' en ' + esc(a.comercio) : ''}${a.tarjeta ? ' · tarjeta •••• ' + a.tarjeta : ''}
    <br><small>${sobre ? 'Va al sobre ' + esc(sobreDe(sobre)?.nombre || '') : 'Elegí el sobre al registrarlo'}</small></div>
    <div class="acciones"><button class="btn primario" data-accion="registrar-aviso">Revisar y registrar</button></div>`;
}

// ================= acciones =================
const ir = (v, extra = {}) => { S.pila.push({ v, ...extra }); render(true); scrollTo(0, 0); };

async function accion(el) {
  const a = el.dataset.accion, id = el.dataset.id;
  if (a !== 'menu' && a !== 'menu-sobre') cerrarMenu();
  switch (a) {
    case 'tab': S.tab = el.dataset.v; S.pila = []; render(true); scrollTo(0, 0); break;
    case 'panel': abrirPanel(); break;
    case 'est-mover': S.est.d = Math.min(0, S.est.d + Number(el.dataset.d)); S.est.sel = 5; render(); break;
    case 'est-mes': S.est.sel = Number(el.dataset.k); render(); break;
    case 'cerrar-panel': cerrarPanel(); break;
    case 'nuevo-ingreso': hojaIngreso(); break;
    case 'editar-ingreso': hojaIngreso(S.ingresos.find(i => i.id === id)); break;
    case 'editar-fijo': hojaFijo(S.fijos.find(x => x.id === id)); break;
    case 'borrar-ingreso':
      if (!confirm('¿Borrar este ingreso?')) return;
      await api.borrar('ingresos', id); S.ingresos = S.ingresos.filter(i => i.id !== id); cerrarHoja(); render(); toast('Ingreso borrado'); break;
    case 'borrar-fijo':
      if (!confirm('¿Eliminar este ingreso fijo? Los ingresos ya registrados se quedan.')) return;
      await api.borrar('ingresos_fijos', id); S.fijos = S.fijos.filter(x => x.id !== id); cerrarHoja(); render(); break;
    case 'filtro-mov': {
      S.mov.filtro = el.dataset.valor;
      const seg = $('#seg-mov');
      seg.style.setProperty('--i', FILTROS_MOV.findIndex(x => x[0] === S.mov.filtro));
      seg.querySelectorAll('button').forEach(b => { const on = b.dataset.valor === S.mov.filtro; b.classList.toggle('activo', on); b.setAttribute('aria-selected', on); });
      $('#res-movs').innerHTML = resMovs();
      break;
    }
    case 'ir': cerrarHoja(); cerrarPanel(); ir(el.dataset.v); break;
    case 'atras': S.pila.pop(); render(true); break;
    case 'menu': $('#menu') ? cerrarMenu() : abrirMenu(); break;
    case 'cerrar-menu': break;
    case 'abrir-sobre': ir('sobre', { id }); break;
    case 'seg': vistaActual().seg = el.dataset.seg; render(); break;
    case 'menu-sobre': $('#menu') ? cerrarMenu() : abrirMenuSobre(sobreDe(id)); break;
    case 'nuevo': {
      const v = vistaActual().v;
      if (v === 'ahorros') hojaAhorro(); else if (v === 'suscripciones') hojaSub(); else if (v === 'fijos') hojaFijo(); else hojaGasto();
      break;
    }
    case 'nuevo-sobre': hojaSobre(); break;
    case 'editar-sobre': hojaSobre(sobreDe(id)); break;
    case 'presupuesto': hojaPresupuesto(sobreDe(id)); break;
    case 'sobrante-ahorro': hojaPasarAhorro(sobreDe(id)); break;
    case 'excel': await descargarExcel(); break;
    case 'informe': informe(); break;
    case 'editar-gasto': hojaGasto(S.gastos.find(g => g.id === id)); break;
    case 'editar-sub': hojaSub(S.subs.find(s => s.id === id)); break;
    case 'nuevo-metodo': hojaMetodo(); break;
    case 'metodo-rapido':
      S.metodos.push(await api.insertar('metodos_pago', { nombre: el.dataset.nombre, tipo: el.dataset.tipo, ultimos4: null, sobre_id: null, orden: S.metodos.length }));
      render(); toast(el.dataset.nombre + ' agregado'); break;
    case 'editar-metodo': hojaMetodo(metodoDe(id)); break;
    case 'mover-ahorro': hojaMoverAhorro(S.ahorros.find(x => x.id === id)); break;
    case 'editar-ahorro': hojaAhorro(S.ahorros.find(x => x.id === id)); break;
    case 'cerrar': cerrarHoja(); break;
    case 'cambiar-moneda': await guardarCfg({ moneda_vista: S.cfg.moneda_vista === 'CRC' ? 'USD' : 'CRC' }); render(); break;
    case 'cfg-moneda': await guardarCfg({ moneda_vista: el.dataset.valor }); render(); break;
    case 'cfg-tema': await guardarCfg({ tema: el.dataset.valor }); render(); break;
    case 'cfg-atajo-sobre': await guardarCfg({ atajo_sobre_id: el.dataset.valor || null }); render(); toast('Guardado'); break;
    case 'borrar-gasto':
      if (!confirm('¿Borrar este gasto?')) return;
      await api.borrar('gastos', id); S.gastos = S.gastos.filter(g => g.id !== id); cerrarHoja(); render(); toast('Gasto borrado'); break;
    case 'borrar-sobre': {
      if (!confirm('¿Eliminar este sobre? Sus gastos se quedan en el historial.')) return;
      await api.actualizar('sobres', id, { archivado: true }); S.sobres = S.sobres.filter(s => s.id !== id);
      if (vistaActual().v === 'sobre') S.pila.pop();
      cerrarHoja(); render(); toast('Sobre eliminado'); break;
    }
    case 'borrar-sub':
      if (!confirm('¿Eliminar esta suscripción? Los cobros ya registrados se quedan.')) return;
      await api.borrar('suscripciones', id); S.subs = S.subs.filter(s => s.id !== id); cerrarHoja(); render(); break;
    case 'borrar-metodo':
      if (!confirm('¿Eliminar este método de pago?')) return;
      await api.borrar('metodos_pago', id); S.metodos = S.metodos.filter(m => m.id !== id); cerrarHoja(); render(); break;
    case 'borrar-ahorro':
      if (!confirm('¿Eliminar este ahorro?')) return;
      await api.borrar('ahorros', id); S.ahorros = S.ahorros.filter(x => x.id !== id); cerrarHoja(); render(); break;
    case 'copiar':
      try { await navigator.clipboard.writeText(el.dataset.texto); toast('Copiado'); } catch { toast('No se pudo copiar'); }
      break;
    case 'exportar': exportar(); break;
    case 'leer-aviso': leerAvisoPegado(); break;
    case 'registrar-aviso': S.avisoLeido?.ingreso ? hojaIngreso(null, S.avisoLeido) : hojaGasto(null, S.avisoLeido); break;
    case 'salir': await api.salir(); location.reload(); break;
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el) return;
  if (el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  e.preventDefault();
  accion(el).catch(err => toast('Error: ' + err.message));
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.desc) { if (t.value) { S.desc[t.dataset.desc] = t.value; S.desc.preset = ''; render(); } return; }
  if (t.hasAttribute('data-desc-preset')) { S.desc = { ...rangoPreset(t.value), preset: t.value }; render(); return; }
  try {
    if (t.dataset.cfg) {
      let v = t.dataset.cfg === 'tipo_cambio' ? leerMontoCampo(t.value) : Number(t.value);
      if (!(v > 0)) { toast('Valor no válido'); return; }
      await guardarCfg({ [t.dataset.cfg]: v }); toast('Guardado');
    } else if (t.dataset.cfgBool) {
      await guardarCfg({ [t.dataset.cfgBool]: t.checked }); render(); toast('Guardado');
    } else if (t.hasAttribute('data-cfg-acento')) {
      await guardarCfg({ acento: t.value }); toast('Guardado');
    }
  } catch (err) { toast('Error: ' + err.message); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.matches || !t.matches(SEL_MONTO)) return;
  const nuevo = formatoVivo(t.value, e.data);
  if (nuevo !== t.value) { t.value = nuevo; try { t.setSelectionRange(nuevo.length, nuevo.length); } catch { /* tipo sin selección */ } }
}, true);
document.addEventListener('focusout', (e) => {
  const t = e.target;
  // en los campos chicos, al salir se completan los decimales
  if (t.matches && t.matches(SEL_MONTO) && !t.closest('.monto-grande') && t.value) { const n = leerMontoCampo(t.value); t.value = n ? numATexto(n) + (t.value.includes(',') ? '' : ',00') : ''; if (/,\d$/.test(t.value)) t.value += '0'; }
});
document.addEventListener('input', (e) => {
  if (!e.target.matches || !e.target.matches('[data-buscar]')) return;
  S.mov.q = e.target.value;
  $('#res-movs').innerHTML = resMovs();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('#menu')) cerrarMenu(); else if (!$('#hoja').hidden) cerrarHoja(); else cerrarPanel();
});

// ================= acceso =================
function pantallaAcceso(msg = '') {
  $('#app').hidden = true;
  const a = $('#acceso'); a.hidden = false;
  a.innerHTML = `<form class="acceso" novalidate>
    <h1 class="marca">${NOMBRE_APP}</h1><p>Tu presupuesto, sobre por sobre.</p>
    <div class="campos">
      <label class="campo"><span>Correo</span><input name="email" type="email" autocomplete="email"></label>
      <label class="campo"><span>Contraseña</span><input name="clave" type="password" autocomplete="current-password"></label>
    </div>
    ${msg ? `<p class="msg">${esc(msg)}</p>` : ''}
    <button class="btn primario">Entrar</button>
    <button class="btn" type="button" name="crear">Crear cuenta</button></form>`;
  const f = a.querySelector('form');
  const entrar = async (crear) => {
    const email = f.email.value.trim(), clave = f.clave.value;
    if (!email || clave.length < 8) return pantallaAcceso('Correo y contraseña de al menos 8 caracteres.');
    try {
      const u = crear ? await api.registrarse(email, clave) : await api.entrar(email, clave);
      if (!u) return pantallaAcceso('Te llegó un correo para confirmar la cuenta. Confirmala y entrá.');
      iniciar();
    } catch (err) { pantallaAcceso(/Invalid login/i.test(err.message) ? 'Correo o contraseña incorrectos.' : err.message); }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); entrar(false); });
  f.crear.addEventListener('click', () => entrar(true));
}

async function iniciar() {
  const u = await api.sesion();
  if (!u) return pantallaAcceso();
  S.usuario = u;
  $('#acceso').hidden = true; $('#app').hidden = false;
  try { await cargarTodo(); render(); }
  catch (err) { $('#vista').innerHTML = `<div class="vacio">No pude cargar tus datos.<br><small>${esc(err.message)}</small></div>`; }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
let toqueX = null;
document.addEventListener('touchstart', (e) => { toqueX = e.target.closest && e.target.closest('.cajon') ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener('touchend', (e) => { if (toqueX != null && e.changedTouches[0].clientX - toqueX < -50) cerrarPanel(); toqueX = null; }, { passive: true });
iniciar();
