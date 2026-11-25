// Capa de datos. Con config.js lleno usa Supabase; vacío, un modo demo en este navegador.
const CFG = window.SOBRES_CONFIG || {};
export const modoDemo = !(CFG.url && CFG.anonKey);

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

// ---------- Demo (localStorage) ----------
const CLAVE = 'sobres-demo-v2';
export const TABLAS = ['config', 'sobres', 'metodos_pago', 'gastos', 'reglas_comercio', 'suscripciones', 'ahorros'];
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
    atajo_recordar: true, tema: 'auto', acento: 'verde', ...memoria.config[0] };
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
  urlFuncion: '',
};

// ---------- Supabase ----------
function backendSupabase() {
  const sb = window.supabase.createClient(CFG.url, CFG.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const chk = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  return {
    async sesion() { const { data } = await sb.auth.getSession(); return data.session?.user || null; },    async entrar(email, clave) { return chk(await sb.auth.signInWithPassword({ email, password: clave })).user; },
    async registrarse(email, clave) {
      const d = chk(await sb.auth.signUp({ email, password: clave, options: { emailRedirectTo: location.href } }));
      return d.session ? d.user : null; // null = hay que confirmar el correo
    },
    async salir() { await sb.auth.signOut(); },
    async listar(tabla) {
      let q = sb.from(tabla).select('*');
      if (tabla === 'gastos') {
        const desde = new Date(); desde.setMonth(desde.getMonth() - 14);
        q = q.gte('fecha', desde.toISOString()).order('fecha', { ascending: false });
      }
      return chk(await q);
    },
    async insertar(tabla, fila) {
      if (tabla === 'reglas_comercio') return chk(await sb.from(tabla).upsert(fila).select().single());
      return chk(await sb.from(tabla).insert(fila).select().single());
    },
    async actualizar(tabla, id, cambios, campo = 'id') {
      const d = chk(await sb.from(tabla).update(cambios).eq(campo, id).select());
      return d[0];
    },
    async borrar(tabla, id) { chk(await sb.from(tabla).delete().eq('id', id)); },
    urlFuncion: CFG.url.replace(/\/$/, '') + '/functions/v1/registrar',
  };
}

export const api = modoDemo ? backendDemo : backendSupabase();
