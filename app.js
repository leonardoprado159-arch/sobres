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
const TIPOS_METODO = { tarjeta: ['Tarjeta', 'tarjeta'], efectivo: ['Efectivo', 'efectivo'], sinpe: ['SINPE Móvil', 'sinpe'], otro: ['Otro', 'billete'] };
const ACENTOS = { verde: '#7ee8a3', azul: '#8cc8ff', morado: '#c4a8ff', naranja: '#ffc078' };
const leerMontoCampo = (v) => {
  let t = String(v || '').replace(/[^\d.,]/g, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  const n = Number(t); return n > 0 ? Math.round(n * 100) / 100 : 0;
};

// ================= estado =================
const S = {
  cfg: null, sobres: [], metodos: [], gastos: [], reglas: [], subs: [], ahorros: [], usuario: null,
  tab: 'gastos', pila: [],
};
const vistaActual = () => S.pila[S.pila.length - 1] || { v: S.tab };

async function cargarTodo() {
  const [config, sobres, metodos, gastos, reglas, subs, ahorros] = await Promise.all(
    ['config', 'sobres', 'metodos_pago', 'gastos', 'reglas_comercio', 'suscripciones', 'ahorros'].map(t => api.listar(t)));
  S.cfg = config[0];
  const orden = (a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.creado).localeCompare(String(b.creado));
  S.sobres = sobres.filter(s => !s.archivado).sort(orden);
  S.metodos = metodos.sort(orden);
  S.gastos = gastos.sort((a, b) => b.fecha.localeCompare(a.fecha));
  S.reglas = reglas; S.subs = subs; S.ahorros = ahorros.sort(orden);
  aplicarTema();
  await cobrarSuscripciones();
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
function vistaGastos() {
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
  ${top('Suscripciones')}
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
  ${top('Ajustes')}
  <div class="titulo">Cuenta</div>
  <div class="grupo">${filaAjuste('usuario', 'Cuenta', 'cuenta')}</div>
  <div class="titulo">Sobres</div>
  <div class="grupo">
    ${filaAjuste('moneda', 'Monedas', 'monedas', S.cfg.moneda_vista)}
    ${filaAjuste('tarjeta', 'Métodos de pago', 'metodos', S.metodos.length || '')}
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
function vistaSobre(p) {
  const s = sobreDe(p.id);
  if (!s) { S.pila.pop(); return render(); }
  const c = ciclo(), lista = enCiclo(c).filter(g => g.sobre_id === s.id);
  const g = gastadoSobre(s, lista), e = estadoSobre(s, g);
  const seg = p.seg || 'mes';
  return `
  ${top(s.nombre, { atras: true, derecha: `<button class="redondo" data-accion="editar-sobre" data-id="${s.id}" aria-label="Editar sobre">${ico('puntos')}</button>` })}
  <div class="resumen">
    <small class="${e.cls}" style="font-weight:600;text-transform:capitalize">${e.etiqueta}</small>
    <div class="grande ${e.cls === 'mal' ? 'mal' : ''}">${fmt(e.monto, s.moneda)}</div>
    <p>${e.conPres ? `${fmt(g, s.moneda)} gastado de ${fmt(s.presupuesto, s.moneda)}` : 'Este sobre no tiene presupuesto'} · ${nombreCiclo(c.ini)}</p>
    ${e.conPres ? `<div class="barra ${e.cls === 'mal' ? 'excedido' : ''}"><span style="width:${Math.min(100, e.frac * 100).toFixed(1)}%"></span></div>` : ''}
    <div class="botones-resumen">
      <button class="btn chico" data-accion="presupuesto" data-id="${s.id}">${e.conPres ? 'Cambiar presupuesto' : 'Poner presupuesto'}</button>
      ${e.cls === 'bien' && e.monto > 0 ? `<button class="btn chico" data-accion="sobrante-ahorro" data-id="${s.id}">${ico('alcancia')} Pasar a ahorro</button>` : ''}
    </div>
  </div>
  <div class="segmento" role="tablist">
    <button class="${seg === 'mes' ? 'activo' : ''}" data-accion="seg" data-seg="mes" role="tab" aria-selected="${seg === 'mes'}">Este mes</button>
    <button class="${seg === 'hist' ? 'activo' : ''}" data-accion="seg" data-seg="hist" role="tab" aria-selected="${seg === 'hist'}">Historial</button>
  </div>
  ${seg === 'mes' ? listaPorDia(lista, false) : bloqueHistorial(s)}`;
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
    <input type="text" inputmode="decimal" value="${S.cfg.tipo_cambio}" data-cfg="tipo_cambio"></label></div>
  <p class="nota">Cada sobre tiene su moneda. Un gasto en dólares que cae en un sobre en colones se convierte con este tipo de cambio.</p>`;
}

function vistaMetodos() {
  return `${top('Métodos de pago', { atras: true })}
  <div class="grupo">
    ${S.metodos.map(m => `<button class="fila" data-accion="editar-metodo" data-id="${m.id}">${ico(TIPOS_METODO[m.tipo][1])}
      <span class="txt"><b>${esc(m.nombre)}</b><small>${[m.ultimos4 ? '•••• ' + m.ultimos4 : TIPOS_METODO[m.tipo][0], m.sobre_id ? 'Sobre: ' + esc(sobreDe(m.sobre_id)?.nombre || '') : ''].filter(Boolean).join(' · ')}</small></span>${ico('derecha', 'fin')}</button>`).join('')}
    <button class="fila" data-accion="nuevo-metodo" style="color:var(--bien)">${ico('mas')}<span class="txt"><b>Agregar método de pago</b></span></button>
  </div>
  <p class="nota">Poné el nombre igual que en Wallet o los últimos 4 dígitos para que el atajo reconozca la tarjeta. Si le asignás un sobre, todo lo que pagués con ella cae ahí sin preguntar.</p>`;
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
  <p class="nota">${id ? 'Todo lo que pagués con Apple Pay cae en este sobre.' : 'El pago se registra solo. Si la app ya conoce el comercio o la tarjeta tiene sobre propio, cae ahí; si no, queda en "Sin sobre" para que lo asignés con un toque, y la próxima vez ese comercio entra solo.'}</p>
  <div class="titulo" style="margin-top:26px">Configurar el atajo (una sola vez)</div>
  ${datosAtajo()}
  <div class="pasos" style="margin-top:12px">
    <div class="paso"><b>Creá la automatización</b>App Atajos → Automatización → ＋ → <b style="display:inline">Wallet</b> (en iOS 18 o anterior: Transacción). Marcá <b style="display:inline">todas</b> tus tarjetas, elegí "Ejecutar inmediatamente" y tocá Siguiente → Nueva automatización en blanco.</div>
    <div class="paso"><b>Agregá una sola acción</b>Buscá <code>Obtener contenido de URL</code>. En URL pegá la dirección de arriba. Tocá la flecha para ver más: Método <code>POST</code>; en Encabezados agregá <code>x-token</code> y pegá tu token.</div>
    <div class="paso"><b>Decile qué mandar</b>En Cuerpo de la solicitud (JSON) agregá tres campos de texto: <code>monto</code> → Entrada del atajo → Importe; <code>comercio</code> → Comercio; <code>tarjeta</code> → Tarjeta o pase. Tocá OK. Ya está: cada pago queda registrado.</div>
  </div>
  <div class="titulo" style="margin-top:26px">Opcional</div>
  <div class="pasos">
    <div class="paso"><b>Ver un aviso al pagar</b>Después de la acción agregá <code>Obtener valor del diccionario</code> con la clave <code>mensaje</code> y luego <code>Mostrar notificación</code>. Te dice el sobre y cuánto queda.</div>
    <div class="paso"><b>Que pregunte el sobre</b>Agregá al cuerpo el campo <code>preguntar</code> = 1. La respuesta trae <code>opciones</code>: usá <code>Elegir de la lista</code> y repetí la acción agregando <code>sobre</code> = Elemento seleccionado.</div>
  </div>`;
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
  <div class="titulo" style="margin-top:26px">SMS</div>
  <div class="pasos">
    <div class="paso"><b>Automatización de Mensaje</b>Remitente: el número del BAC. Ejecutar inmediatamente.</div>
    <div class="paso"><b>Mandá el texto</b><code>Obtener contenido de URL</code> (POST, encabezado <code>x-token</code>) con JSON: <code>fuente</code> = sms, <code>texto</code> = Entrada del atajo. Si querés aviso, agregá lo de "Ver un aviso al pagar" de Apple Pay.</div>
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
  <div class="grupo sin-icono"><div class="fila"><span class="txt"><b>Sobres</b><small>Presupuesto personal por sobres · versión 2</small></span></div></div>
  <p class="nota">Tus datos se guardan en tu propia base de datos. Nadie más tiene acceso.</p>`;

// ================= render =================
const VISTAS = {
  gastos: vistaGastos, ahorros: vistaAhorros, suscripciones: vistaSuscripciones, ajustes: vistaAjustes,
  sobre: vistaSobre, movimientos: vistaMovimientos, sinsobre: vistaSinSobre, historial: vistaHistorialGeneral,
  cuenta: vistaCuenta, monedas: vistaMonedas, metodos: vistaMetodos, reinicio: vistaReinicio, applepay: vistaApplePay,
  avisos: vistaAvisos, personalizacion: vistaPersonalizacion, acerca: vistaAcerca, descargas: vistaDescargas,
};
const TABS = [['gastos', 'carrito', 'Gastos'], ['ahorros', 'billete', 'Ahorros'], ['suscripciones', 'calendario', 'Suscripciones'], ['ajustes', 'ajustes', 'Ajustes']];

function render(animar = false) {
  const v = vistaActual();
  const el = $('#vista');
  el.innerHTML = VISTAS[v.v](v);
  if (animar) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
  $('.tabs').innerHTML = TABS.map(([k, i, t]) => `<button class="${S.tab === k ? 'activa' : ''}" data-accion="tab" data-v="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${ico(i)}${t}</button>`).join('');
  const fab = $('.fab');
  const fabVisible = ['gastos', 'ahorros', 'suscripciones', 'sobre', 'movimientos'].includes(v.v);
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
  if (m) { const ajustar = () => { m.style.width = Math.max(1, (m.value || m.placeholder).length) + 0.6 + 'ch'; }; m.addEventListener('input', ajustar); ajustar(); }
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
  const f = abrirHoja(g ? 'Editar gasto' : 'Nuevo gasto', `
    <div class="monto-grande">
      <div class="fila-monto"><span class="simbolo">${base.moneda === 'USD' ? '$' : '₡'}</span>
        <input name="monto" inputmode="decimal" placeholder="0" value="${base.monto ?? ''}" autofocus aria-label="Monto"></div>
      ${alternarMoneda('moneda', base.moneda)}
    </div>
    <div class="etiqueta">Sobre</div>${chipsSobre('sobre', base.sobre_id)}
    ${S.metodos.length ? `<div class="etiqueta">Método de pago</div><div class="chips" role="radiogroup">
      <label><input type="radio" name="metodo" value="" ${!base.metodo_id ? 'checked' : ''}><span>Ninguno</span></label>
      ${S.metodos.map(m => `<label><input type="radio" name="metodo" value="${m.id}" ${base.metodo_id === m.id ? 'checked' : ''}><span>${ico(TIPOS_METODO[m.tipo][1])}${esc(m.nombre)}</span></label>`).join('')}</div>` : ''}
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
      sobre_id: valorRadio(f, 'sobre') || null, metodo_id: valorRadio(f, 'metodo') || null,
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

function exportar() {
  const filas = [['fecha', 'comercio', 'monto', 'moneda', 'sobre', 'metodo', 'origen', 'nota']];
  for (const g of S.gastos) filas.push([g.fecha.slice(0, 16).replace('T', ' '), g.comercio || '', g.monto, g.moneda,
    sobreDe(g.sobre_id)?.nombre || '', metodoDe(g.metodo_id)?.nombre || '', FUENTES[g.fuente], /^(sub|ahorro):/.test(g.nota || '') ? '' : g.nota || '']);
  const csv = '﻿' + filas.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `Sobres gastos ${hoyLocal()}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- descargas ----------
function vistaDescargas() {
  return `${top('Descargar datos', { atras: true })}
  <div class="titulo">Para analizar</div>
  <div class="grupo">
    <button class="fila" data-accion="excel">${ico('lista')}<span class="txt"><b>Excel completo</b><small>Resumen por mes y sobre, gastos, sobres, ahorros y suscripciones</small></span>${ico('descargar', 'fin')}</button>
    <button class="fila" data-accion="exportar">${ico('recibo')}<span class="txt"><b>Gastos en CSV</b><small>Una sola tabla, para cualquier programa</small></span>${ico('descargar', 'fin')}</button>
  </div>
  <div class="titulo" style="margin-top:26px">Informe en PDF</div>
  <div class="campos"><label class="campo"><span>Mes</span><select id="informe-ciclo">
    ${Array.from({ length: 12 }, (_, i) => `<option value="${-i}">${nombreCiclo(ciclo(-i).ini)}</option>`).join('')}</select></label></div>
  <div class="acciones"><button class="btn primario" data-accion="informe">Generar informe</button></div>
  <p class="nota">Se abre la ventana de impresión: en el iPhone tocá Compartir → Guardar en Archivos para tenerlo en PDF.</p>`;
}

function filasResumen(desde = -11) {
  const filas = [];
  for (let d = 0; d >= desde; d--) {
    const c = ciclo(d), lista = enCiclo(c);
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
  const X = window.XLSX, libro = X.utils.book_new();
  const hoja = (nombre, filas, anchos) => {
    const h = X.utils.json_to_sheet(filas, { cellDates: true });
    h['!cols'] = anchos.map(w => ({ wch: w }));
    X.utils.book_append_sheet(libro, h, nombre);
  };
  hoja('Resumen', filasResumen().map(r => ({
    'Mes': r.mes, 'Inicio': r.inicio, 'Sobre': r.s.nombre, 'Moneda': r.s.moneda,
    'Presupuesto': r.e.conPres ? Number(r.s.presupuesto) : null, 'Gastado': Math.round(r.gastado * 100) / 100,
    'Sobrante (+) / Sobregiro (−)': r.e.conPres ? Math.round((r.s.presupuesto - r.gastado) * 100) / 100 : null,
    'Estado': r.e.conPres ? r.e.etiqueta : 'sin presupuesto', 'Cantidad de gastos': r.n,
  })), [22, 12, 20, 8, 14, 14, 26, 16, 10]);
  hoja('Gastos', S.gastos.map(g => {
    const s = sobreDe(g.sobre_id);
    return {
      'Fecha': new Date(g.fecha), 'Comercio': g.comercio || '', 'Monto': Number(g.monto), 'Moneda': g.moneda,
      'Monto en moneda del sobre': s ? Math.round(conv(g.monto, g.moneda, s.moneda) * 100) / 100 : null,
      'Sobre': s?.nombre || 'Sin sobre', 'Método de pago': metodoDe(g.metodo_id)?.nombre || '', 'Tarjeta': g.tarjeta || '',
      'Origen': FUENTES[g.fuente] || g.fuente, 'Nota': /^(sub|ahorro):/.test(g.nota || '') ? '' : g.nota || '',
    };
  }), [18, 26, 12, 8, 14, 18, 16, 8, 14, 24]);
  hoja('Sobres', S.sobres.map(s => ({ 'Sobre': s.nombre, 'Moneda': s.moneda, 'Presupuesto mensual': s.presupuesto > 0 ? Number(s.presupuesto) : null })), [22, 8, 20]);
  hoja('Ahorros', S.ahorros.map(a => ({
    'Sobre de ahorro': a.nombre, 'Moneda': a.moneda, 'Meta': a.meta > 0 ? Number(a.meta) : null, 'Ahorrado': Number(a.ahorrado),
    'Avance %': a.meta > 0 ? Math.round(a.ahorrado / a.meta * 1000) / 10 : null,
  })), [24, 8, 14, 14, 10]);
  hoja('Suscripciones', S.subs.map(s => ({
    'Suscripción': s.nombre, 'Monto': Number(s.monto), 'Moneda': s.moneda, 'Frecuencia': s.frecuencia,
    'Día de cobro': s.dia_cobro, 'Próximo cobro': proximoCobro(s), 'Sobre': sobreDe(s.sobre_id)?.nombre || '', 'Activa': s.activa ? 'Sí' : 'No',
  })), [22, 12, 8, 12, 12, 14, 18, 8]);
  X.writeFile(libro, `Sobres ${hoyLocal()}.xlsx`, { cellDates: true });
  toast('Excel descargado');
}

function informe(desplazar = 0) {
  const c = ciclo(desplazar), lista = enCiclo(c), mv = S.cfg.moneda_vista;
  const filas = filasResumen(desplazar).filter(r => r.inicio.getTime() === c.ini.getTime());
  const conPres = filas.filter(r => r.e.conPres);
  const totPres = conPres.reduce((a, r) => a + conv(r.s.presupuesto, r.s.moneda, mv), 0);
  const totGast = lista.reduce((a, g) => a + conv(g.monto, g.moneda, mv), 0);
  const totGastPres = conPres.reduce((a, r) => a + conv(r.gastado, r.s.moneda, mv), 0);
  const neto = totPres - totGastPres;
  const el = $('#informe') || Object.assign(document.body.appendChild(document.createElement('div')), { id: 'informe' });
  el.innerHTML = `
    <h1>Informe de gastos</h1>
    <p class="sub"><span style="text-transform:capitalize">${nombreCiclo(c.ini)}</span> · generado el ${new Date().toLocaleDateString('es-CR')}</p>
    <div class="cifras">
      <div><small>Presupuesto</small><b>${fmt(totPres, mv)}</b></div>
      <div><small>Gastado</small><b>${fmt(totGast, mv)}</b></div>
      <div><small>${neto < 0 ? 'Sobregiro' : 'Sobrante'}</small><b class="${neto < 0 ? 'mal' : 'bien'}">${fmt(Math.abs(neto), mv)}</b></div>
    </div>
    <h2>Por sobre</h2>
    <table><thead><tr><th>Sobre</th><th>Presupuesto</th><th>Gastado</th><th>Sobrante / sobregiro</th></tr></thead><tbody>
      ${filas.map(r => `<tr><td>${esc(r.s.nombre)}</td><td>${r.e.conPres ? fmt(r.s.presupuesto, r.s.moneda) : '—'}</td><td>${fmt(r.gastado, r.s.moneda)}</td>
        <td class="${r.e.cls}">${r.e.conPres ? (r.e.etiqueta === 'sobregiro' ? '−' : '') + fmt(r.e.monto, r.s.moneda) : '—'}</td></tr>`).join('')}
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
  const m = S.metodos.find(x => x.ultimos4 && x.ultimos4 === a.tarjeta);
  const regla = a.comercio && S.reglas.find(r => r.comercio === normalizarComercio(a.comercio));
  const sobre = m?.sobre_id || S.cfg.atajo_sobre_id || (S.cfg.atajo_recordar && regla ? regla.sobre_id : '');
  S.avisoLeido = { monto: a.monto, moneda: a.moneda, comercio: a.comercio, tarjeta: a.tarjeta, metodo_id: m?.id, sobre_id: sobre, fuente: 'sms' };
  res.innerHTML = `<div class="resultado"><b>${fmt(a.monto, a.moneda)}</b>${a.comercio ? ' en ' + esc(a.comercio) : ''}${a.tarjeta ? ' · tarjeta •••• ' + a.tarjeta : ''}
    <br><small>${sobre ? 'Va al sobre ' + esc(sobreDe(sobre)?.nombre || '') : 'Te va a preguntar el sobre'}</small></div>
    <div class="acciones"><button class="btn primario" data-accion="registrar-aviso">Revisar y registrar</button></div>`;
}

// ================= acciones =================
const ir = (v, extra = {}) => { S.pila.push({ v, ...extra }); render(true); scrollTo(0, 0); };

async function accion(el) {
  const a = el.dataset.accion, id = el.dataset.id;
  if (a !== 'menu') cerrarMenu();
  switch (a) {
    case 'tab': S.tab = el.dataset.v; S.pila = []; render(true); scrollTo(0, 0); break;
    case 'ir': cerrarHoja(); ir(el.dataset.v); break;
    case 'atras': S.pila.pop(); render(true); break;
    case 'menu': $('#menu') ? cerrarMenu() : abrirMenu(); break;
    case 'cerrar-menu': break;
    case 'abrir-sobre': ir('sobre', { id }); break;
    case 'seg': vistaActual().seg = el.dataset.seg; render(); break;
    case 'nuevo': {
      const v = vistaActual().v;
      if (v === 'ahorros') hojaAhorro(); else if (v === 'suscripciones') hojaSub(); else hojaGasto();
      break;
    }
    case 'nuevo-sobre': hojaSobre(); break;
    case 'editar-sobre': hojaSobre(sobreDe(id)); break;
    case 'presupuesto': hojaPresupuesto(sobreDe(id)); break;
    case 'sobrante-ahorro': hojaPasarAhorro(sobreDe(id)); break;
    case 'excel': await descargarExcel(); break;
    case 'informe': informe(Number($('#informe-ciclo')?.value || 0)); break;
    case 'editar-gasto': hojaGasto(S.gastos.find(g => g.id === id)); break;
    case 'editar-sub': hojaSub(S.subs.find(s => s.id === id)); break;
    case 'nuevo-metodo': hojaMetodo(); break;
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
    case 'registrar-aviso': hojaGasto(null, S.avisoLeido); break;
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
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('#menu')) cerrarMenu(); else if (!$('#hoja').hidden) cerrarHoja();
});

// ================= acceso =================
function pantallaAcceso(msg = '') {
  $('#app').hidden = true;
  const a = $('#acceso'); a.hidden = false;
  a.innerHTML = `<form class="acceso" novalidate>
    <h1 class="marca">Sobres</h1><p>Tu presupuesto, sobre por sobre.</p>
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
iniciar();
