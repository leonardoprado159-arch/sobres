// Lector de avisos de compra (BAC por correo o SMS, y datos de Apple Pay).
// JS puro: lo usa la función de Supabase (Deno) y se prueba en el navegador.

const MONEDAS = [
  // [regex, moneda]
  [/US\$|USD|\$|DOLARES|DÓLARES/i, 'USD'],
  [/₡|CRC|COLONES|¢/i, 'CRC'],
];

// "12,500.00" | "12.500,00" | "12 500" | "25.99" | "5,000" -> número
export function leerNumero(s) {
  if (s == null) return null;
  let t = String(s).replace(/[^\d.,]/g, '');
  if (!t) return null;
  const ultPunto = t.lastIndexOf('.'), ultComa = t.lastIndexOf(',');
  if (ultPunto >= 0 && ultComa >= 0) {
    const dec = ultPunto > ultComa ? '.' : ',';
    const mil = dec === '.' ? ',' : '.';
    t = t.split(mil).join('').replace(dec, '.');
  } else if (ultPunto >= 0 || ultComa >= 0) {
    const sep = ultPunto >= 0 ? '.' : ',';
    const partes = t.split(sep);
    const ultima = partes[partes.length - 1];
    // un solo separador seguido de 1-2 dígitos = decimales; si no, miles
    if (partes.length === 2 && ultima.length <= 2) t = partes[0] + '.' + ultima;
    else t = partes.join('');
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function detectarMoneda(s, porDefecto = 'CRC') {
  for (const [re, m] of MONEDAS) if (re.test(s)) return m;
  return porDefecto;
}

const NUM = String.raw`\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const SIMB = String.raw`US\$|USD|CRC|₡|¢|\$`;

export function leerMonto(texto) {
  const s = String(texto || '');
  const patrones = [
    // "Monto: CRC 12,500.00" / "Monto: 12,500.00 CRC"
    new RegExp(String.raw`(?:monto|total|importe|valor)\s*(?:de la (?:compra|transacci[oó]n))?\s*[:=]?\s*(${SIMB})?\s*(${NUM})\s*(${SIMB}|colones|d[oó]lares)?`, 'i'),
    // "por CRC 12,500.00" / "por ₡5.000"
    new RegExp(String.raw`por\s+(?:un monto de\s+)?(${SIMB})\s*(${NUM})`, 'i'),
    // símbolo pegado al número en cualquier parte
    new RegExp(String.raw`(${SIMB})\s*(${NUM})`, 'i'),
    // número seguido de moneda
    new RegExp(String.raw`()(${NUM})\s*(CRC|USD|colones|d[oó]lares)`, 'i'),
  ];
  for (const re of patrones) {
    const m = s.match(re);
    if (m) {
      const monto = leerNumero(m[2]);
      if (monto) return { monto, moneda: detectarMoneda((m[1] || '') + ' ' + (m[3] || '')) };
    }
  }
  // Atajos de Apple Pay a veces manda solo el número
  const solo = leerNumero(s);
  return solo ? { monto: solo, moneda: detectarMoneda(s) } : null;
}

function limpiarComercio(c) {
  if (!c) return null;
  const t = c.replace(/\s+/g, ' ').replace(/[.,;:\-\s]+$/, '').trim();
  return t ? t.slice(0, 80) : null;
}

export function leerComercio(texto) {
  const s = String(texto || '');
  const patrones = [
    /(?:comercio|establecimiento|lugar|negocio)\s*[:=]\s*([^\n\r]+)/i,
    /\ben\s+([A-Z0-9][A-Z0-9 .&*'\-\/]{2,60}?)(?=\s+(?:por|el|con|monto|tarjeta|\d{2}\/)|[.,\n]|$)/,
  ];
  for (const re of patrones) {
    const m = s.match(re);
    if (m) {
      const c = limpiarComercio(m[1].split(/\s{2,}|\s(?:Monto|Fecha|Tarjeta|Autorizaci)/i)[0]);
      if (c) return c;
    }
  }
  return null;
}

export function leerTarjeta(texto) {
  const s = String(texto || '');
  const m = s.match(/(?:\*{2,}|x{2,}|terminada en|final(?:izada)? en|tarjeta\s*(?:no\.?|#)?\s*\D{0,12})\s*(\d{4})\b/i);
  return m ? m[1] : null;
}

export function normalizarComercio(c) {
  return String(c || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Punto de entrada: texto libre (correo/SMS) o campos sueltos (Apple Pay)
export function leerAviso({ texto, monto, comercio, tarjeta } = {}) {
  const t = String(texto || '');
  if (/rechazad|declinad|no aprobad|denegad/i.test(t)) {
    return { ok: false, motivo: 'transacción rechazada' };
  }
  if (t && /devoluci[oó]n|reverso|reversi[oó]n|cr[eé]dito a su (?:cuenta|tarjeta)|pago recibido/i.test(t)) {
    return { ok: false, motivo: 'no es una compra (devolución, reverso o pago)' };
  }
  const m = monto != null && monto !== '' ? leerMonto(String(monto)) : leerMonto(t);
  if (!m) return { ok: false, motivo: 'no encontré el monto' };
  return {
    ok: true,
    monto: m.monto,
    moneda: m.moneda,
    comercio: limpiarComercio(comercio) || leerComercio(t),
    tarjeta: (tarjeta && (String(tarjeta).match(/\d{4}(?!.*\d{4})/) || [String(tarjeta)])[0]) || leerTarjeta(t),
  };
}
