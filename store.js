// Capa de datos. Con config.js lleno usa Supabase; vacío, un modo demo en este navegador.
const CFG = window.SOBRES_CONFIG || {};
// En la compu de desarrollo, ?demo abre el modo demo aunque haya servidor configurado
const forzarDemo = ['localhost', '127.0.0.1'].includes(location.hostname) && location.search.includes('demo');
export const modoDemo = forzarDemo || !(CFG.url && CFG.anonKey);

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

// ---------- cola sin conexión ----------
// Lo que no se pudo mandar por falta de señal queda aquí y se sube solo, en orden, al volver la conexión.
const CLAVE_COLA = 'whiplash-cola-v1';
const leerCola = () => { try { return JSON.parse(localStorage.getItem(CLAVE_COLA)) || []; } catch { return []; } };
const guardarCola = (c) => { try { localStorage.setItem(CLAVE_COLA, JSON.stringify(c)); } catch { /* sin espacio */ } };
const sinRed = (err) => (typeof navigator !== 'undefined' && navigator.onLine === false)
  || /failed to fetch|load failed|networkerror|network request failed|fetch failed|la conexión/i.test(String(err?.message || err));

// ---------- Demo (localStorage) ----------
const CLAVE = 'sobres-demo-v2';
export const TABLAS = ['config', 'sobres', 'metodos_pago', 'gastos', 'reglas_comercio', 'suscripciones', 'ahorros', 'ingresos', 'ingresos_fijos', 'traslados'];
function leerDemo() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) || null; } catch { return null; }
}
function guardarDemo(d) { try { localStorage.setItem(CLAVE, JSON.stringify(d)); } catch { /* sin storage */ } }
let memoria = null;
function demo() {
  if (memoria) return memoria;
  memoria = leerDemo() || {};
  memoria.config ||= [];
  if (!memoria.config.length) memoria.config.push({ user_id: 'demo', token_atajos: 'demo-token-sin-servidor' });
  // valores por defecto, igual que en la base de datos
  memoria.config[0] = { dia_cierre: 1, tipo_cambio: 510, moneda_vista: 'CRC', atajo_sobre_id: null,
    atajo_recordar: true, tema: 'auto', acento: 'verde', grupos: {}, ...memoria.config[0] };
  for (const t of TABLAS) memoria[t] ||= [];
  return memoria;
}
const persistir = () => guardarDemo(memoria);

const backendDemo = {
  async sesion() { return { email: 'demo' }; },
  async entrar() { return { email: 'demo' }; },
  async registrarse() { return { email: 'demo' }; },
  async salir() {},
  async listar(tabla) { return structuredClone(demo()[tabla]); },
  async insertar(tabla, fila) {
    const f = { id: uid(), user_id: 'demo', creado: new Date().toISOString(), ...fila };
    if (tabla === 'reglas_comercio') {
      demo()[tabla] = demo()[tabla].filter(r => r.comercio !== f.comercio);
    }
    demo()[tabla].push(f); persistir(); return structuredClone(f);
  },
  async actualizar(tabla, id, cambios, campo = 'id') {
    const f = demo()[tabla].find(r => r[campo] === id);
    if (f) Object.assign(f, cambios); persistir(); return structuredClone(f);
  },
  async borrar(tabla, id) {
    demo()[tabla] = demo()[tabla].filter(r => r.id !== id); persistir();
  },
  async sincronizar() { return { subidos: 0, fallidos: 0 }; },
  pendientes() { return 0; },
  vaciarCola() {},
  alEncolar: null,
  urlFuncion: '',
};

// ---------- Supabase ----------
function backendSupabase() {
  const sb = window.supabase.createClient(CFG.url, CFG.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const chk = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const mandar = async (o) => {
    if (o.op === 'insertar') {
      if (o.tabla === 'reglas_comercio') return chk(await sb.from(o.tabla).upsert(o.fila).select().single());
      return chk(await sb.from(o.tabla).insert(o.fila).select().single());
    }
    if (o.op === 'actualizar') return chk(await sb.from(o.tabla).update(o.cambios).eq(o.campo, o.id).select())[0];
    chk(await sb.from(o.tabla).delete().eq('id', o.id));
  };
  // Sube lo pendiente en orden. Se detiene si sigue sin señal; lo que el servidor rechaza se descarta.
  let subiendo = null;
  function sincronizar() {
    if (subiendo) return subiendo;
    subiendo = (async () => {
      let subidos = 0, fallidos = 0;
      for (;;) {
        const cola = leerCola();
        if (!cola.length) break;
        try { await mandar(cola[0]); subidos++; }
        catch (e) { if (sinRed(e)) break; fallidos++; }
        guardarCola(leerCola().slice(1));
      }
      return { subidos, fallidos };
    })().finally(() => { subiendo = null; });
    return subiendo;
  }
  // Intenta mandar; sin señal, lo deja en la cola y devuelve la fila como quedaría
  async function conCola(o, local) {
    if (leerCola().length) await sincronizar();   // primero lo anterior, para no cruzar el orden
    if (!leerCola().length) {
      try { return await mandar(o); } catch (e) { if (!sinRed(e)) throw e; }
    }
    guardarCola([...leerCola(), o]);
    try { backend.alEncolar && backend.alEncolar(); } catch { /* nada */ }
    return local();
  }
  const backend = {
    async sesion() { const { data } = await sb.auth.getSession(); return data.session?.user || null; },    async entrar(email, clave) { return chk(await sb.auth.signInWithPassword({ email, password: clave })).user; },
    async registrarse(email, clave) {
      const d = chk(await sb.auth.signUp({ email, password: clave, options: { emailRedirectTo: location.href } }));
      return d.session ? d.user : null; // null = hay que confirmar el correo
    },
    async salir() { await sb.auth.signOut(); },
    async listar(tabla) {
      // de los gastos no se baja el texto original del aviso del banco: pesa y la app no lo muestra
      let q = sb.from(tabla).select(tabla === 'gastos' ? 'id,user_id,sobre_id,metodo_id,monto,moneda,comercio,tarjeta,fuente,fecha,nota,creado,referencia,estado' : '*');
      if (tabla === 'gastos' || tabla === 'ingresos' || tabla === 'traslados') {
        const desde = new Date(); desde.setMonth(desde.getMonth() - 14);
        q = q.gte('fecha', desde.toISOString()).order('fecha', { ascending: false });
      }
      return chk(await q);
    },
    async insertar(tabla, fila) {
      // el id se pone aquí para que la fila exista igual aunque se guarde sin conexión
      const f = tabla === 'reglas_comercio' || fila.id ? fila : { id: uid(), ...fila };
      return conCola({ op: 'insertar', tabla, fila: f }, () => ({ creado: new Date().toISOString(), ...f }));
    },
    async actualizar(tabla, id, cambios, campo = 'id') {
      return conCola({ op: 'actualizar', tabla, id, cambios, campo }, () => ({ ...cambios }));
    },
    async borrar(tabla, id) { await conCola({ op: 'borrar', tabla, id }, () => undefined); },
    sincronizar, pendientes: () => leerCola().length, vaciarCola: () => guardarCola([]), alEncolar: null,
    urlFuncion: CFG.url.replace(/\/$/, '') + '/functions/v1/registrar',
  };
  return backend;
}

export const api = modoDemo ? backendDemo : backendSupabase();
