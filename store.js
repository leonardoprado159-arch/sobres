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
const guardarCola = (c) => { try { localStorage.setItem(CLAVE_COLA, JSON.stringify(c)); return true; } catch { return false; } };
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
  atascado() { return false; },
  vaciarCola() {},
  alEncolar: null,
  urlFuncion: '', urlAvisos: '', async token() { return ''; },
};

// ---------- Supabase ----------
function backendSupabase() {
  const sb = window.supabase.createClient(CFG.url, CFG.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const chk = ({ data, error }) => {
    if (error) { const e = new Error(error.message); e.codigo = String(error.code || ''); throw e; }
    return data;
  };
  // Rechazo definitivo: el dato mismo no sirve (repetido, rompe una regla, formato o columna que no existe).
  // Cualquier otro error del servidor puede ser pasajero y se vuelve a intentar.
  const definitivo = (e) => /^(22|23)/.test(e?.codigo || '') || ['42703', 'PGRST204'].includes(e?.codigo);
  const mandar = async (o) => {
    if (o.op === 'insertar') {
      if (o.tabla === 'reglas_comercio') return chk(await sb.from(o.tabla).upsert(o.fila).select().single());
      return chk(await sb.from(o.tabla).insert(o.fila).select().single());
    }
    if (o.op === 'actualizar') return chk(await sb.from(o.tabla).update(o.cambios).eq(o.campo, o.id).select())[0];
    chk(await sb.from(o.tabla).delete().eq('id', o.id));
  };
  // Sube lo pendiente en orden. Se detiene si no hay señal, si no hay sesión válida o si el servidor falla
  // por algo pasajero. Solo se descarta lo que el servidor rechaza de forma definitiva o lo que es de otra cuenta.
  // Lo que falla muchas veces no se borra solo: queda "atascado" y la app le pregunta a la persona.
  let uidActual = '';
  let subiendo = null;
  function sincronizar() {
    if (subiendo) return subiendo;
    const subir = async () => {
      let subidos = 0, fallidos = 0;
      const c0 = leerCola();
      if (!c0.length) return { subidos, fallidos };
      if (c0.some(x => !x.k)) guardarCola(c0.map(x => (x.k ? x : { ...x, k: uid() })));
      const { data } = await sb.auth.getSession().catch(() => ({ data: {} }));
      if (!data?.session) return { subidos, fallidos };   // sin sesión no se manda: el servidor lo rechazaría todo
      // lo que quedó pendiente de otra cuenta en este teléfono no se sube a esta
      const mio = data.session.user.id, ajenos = leerCola().filter(x => x.u && x.u !== mio).length;
      if (ajenos) { guardarCola(leerCola().filter(x => !x.u || x.u === mio)); fallidos += ajenos; }
      for (;;) {
        const o = leerCola()[0];
        if (!o) break;
        try { await mandar(o); subidos++; }
        catch (e) {
          if (sinRed(e)) break;
          if (definitivo(e)) fallidos++;
          else { guardarCola(leerCola().map(x => (x.k === o.k ? { ...x, n: (x.n || 0) + 1 } : x))); break; }
        }
        guardarCola(leerCola().filter(x => x.k !== o.k));
      }
      return { subidos, fallidos };
    };
    // con dos pestañas abiertas, solo una sube a la vez
    subiendo = (navigator.locks ? navigator.locks.request('whiplash-cola', subir) : subir()).finally(() => { subiendo = null; });
    return subiendo;
  }
  // Intenta mandar; sin señal, lo deja en la cola y devuelve la fila como quedaría
  async function conCola(o, local) {
    if (leerCola().length) await sincronizar();   // primero lo anterior, para no cruzar el orden
    if (!leerCola().length) {
      try { return await mandar(o); } catch (e) { if (!sinRed(e)) throw e; }
    }
    // si el teléfono no tiene dónde guardarlo, se dice: no se da por guardado algo que se perdería
    if (!guardarCola([...leerCola(), { ...o, k: uid(), u: uidActual }])) throw new Error('no hay señal y el teléfono no tiene espacio para guardarlo');
    try { backend.alEncolar && backend.alEncolar(); } catch { /* nada */ }
    return local();
  }
  const backend = {
    async sesion() {
      const { data } = await sb.auth.getSession().catch(() => ({ data: {} }));
      if (data?.session?.user) { uidActual = data.session.user.id; return data.session.user; }
      // Sin señal no se puede renovar el permiso vencido, pero la sesión sigue guardada en el teléfono:
      // se entra con ella para poder ver lo último y anotar sin conexión. Si la sesión se cerró de verdad, ya no está guardada.
      try {
        const k = Object.keys(localStorage).find(x => /^sb-.+-auth-token$/.test(x));
        const u = k && JSON.parse(localStorage.getItem(k))?.user;
        if (u?.id) { uidActual = u.id; return u; }
      } catch { /* sin storage */ }
      return null;
    },
    async entrar(email, clave) { return chk(await sb.auth.signInWithPassword({ email, password: clave })).user; },
    async registrarse(email, clave) {
      const d = chk(await sb.auth.signUp({ email, password: clave, options: { emailRedirectTo: location.href } }));
      return d.session ? d.user : null; // null = hay que confirmar el correo
    },
    async salir() { await sb.auth.signOut(); },
    async listar(tabla) {
      // de los gastos no se baja el texto original del aviso del banco: pesa y la app no lo muestra
      const campos = tabla === 'gastos' ? 'id,user_id,sobre_id,metodo_id,monto,moneda,comercio,tarjeta,fuente,fecha,nota,creado,referencia,estado' : '*';
      if (tabla === 'gastos' || tabla === 'ingresos' || tabla === 'traslados') {
        // el servidor entrega como máximo 1000 filas por pedido: se piden por páginas para no perder las más viejas
        const desde = new Date(); desde.setMonth(desde.getMonth() - 14);
        const filas = [];
        for (let i = 0; i < 50; i++) {
          const d = chk(await sb.from(tabla).select(campos).gte('fecha', desde.toISOString())
            .order('fecha', { ascending: false }).order('id').range(i * 1000, i * 1000 + 999));
          filas.push(...d);
          if (d.length < 1000) break;
        }
        return filas;
      }
      return chk(await sb.from(tabla).select(campos));
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
    atascado: () => (leerCola()[0]?.n || 0) >= 5,   // el primero de la fila ya falló 5 veces por algo que no es la señal
    urlFuncion: CFG.url.replace(/\/$/, '') + '/functions/v1/registrar',
    urlAvisos: CFG.url.replace(/\/$/, '') + '/functions/v1/avisar',
    async token() { const { data } = await sb.auth.getSession(); return data.session?.access_token || ''; },
  };
  return backend;
}

export const api = modoDemo ? backendDemo : backendSupabase();
