// Arranque: carga supabase-js solo si hay servidor configurado, y después la app.
// La librería va fijada a una versión y con su huella: si el archivo de la CDN cambiara, el navegador no lo ejecuta.
(function () {
  var c = window.SOBRES_CONFIG || {};
  function arrancar() { var s = document.createElement('script'); s.type = 'module'; s.src = 'app.js'; document.body.appendChild(s); }
  function fallo() {
    var a = document.getElementById('acceso');
    a.hidden = false;
    a.innerHTML = '<div class="acceso"><h1 class="marca">Whiplash</h1><p>No se pudo cargar la app. Revis\u00e1 la conexi\u00f3n y volv\u00e9 a intentar.</p><button class="btn primario" type="button">Reintentar</button></div>';
    a.querySelector('button').addEventListener('click', function () { location.reload(); });
  }
  if (c.url && c.anonKey) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
    s.integrity = 'sha384-GFr3yTh5lJznCbZfpTtXnwboFsxqtTQoeTZCRHhE0579KrRmlCzen5AA8ohaB5ug';
    s.crossOrigin = 'anonymous';
    s.onload = arrancar; s.onerror = fallo;
    document.head.appendChild(s);
  } else arrancar();
})();
