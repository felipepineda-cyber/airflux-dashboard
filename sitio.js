/* ============================================================
   SenFePin · configuración compartida del sitio
   - Analítica privada y agregada (Vercel Web Analytics, sin cookies)
   - Espacio de patrocinio directo (desactivado por defecto)
   - Google AdSense (desactivado: falta aprobación y plan comercial)
   Se carga en index.html, privacidad.html y uso-datos.html.
   NO se carga en restablecer.html (recuperación de contraseña).
   ============================================================ */
window.SENFEPIN_CONFIG = {
  // 1) Analítica: activar en Vercel → proyecto → Analytics → Enable y pegar aquí
  //    la ruta del script que muestra el panel (por ejemplo "/_vercel/insights/script.js").
  analitica: { activa: false, script: "/_vercel/insights/script.js" },

  // 2) Patrocinio directo: imagen local (subida al repositorio), texto corto y enlace HTTPS.
  //    No carga nada del patrocinador: la imagen se sirve desde este mismo sitio.
  patrocinio: { activo: false, nombre: "", texto: "", imagen: "", enlace: "" },

  // 3) Google AdSense: dejar en false hasta tener (a) sitio aprobado, (b) plan de hosting
  //    que permita uso comercial y (c) política de privacidad publicada y completa.
  adsense: { activo: false, cliente: "" },
};

(function () {
  "use strict";
  const CFG = window.SENFEPIN_CONFIG;
  const CLAVE_NO_MEDIR = "senfepin_no_medir";
  const PAGINAS_EXCLUIDAS = /\/restablecer(\.html)?$/;   // nunca se mide la recuperación de contraseña

  // ── Preferencia del visitante: no medir sus visitas (también respeta Global Privacy Control) ──
  function medicionPermitida() {
    try { if (localStorage.getItem(CLAVE_NO_MEDIR) === "1") return false; } catch (e) { /* sin almacenamiento */ }
    return navigator.globalPrivacyControl !== true;
  }
  window.senfepinMedicion = {
    permitida: medicionPermitida,
    fijar(medir) {
      try { medir ? localStorage.removeItem(CLAVE_NO_MEDIR) : localStorage.setItem(CLAVE_NO_MEDIR, "1"); } catch (e) {}
    },
    gpc: () => navigator.globalPrivacyControl === true,
  };

  // ── Cola de Vercel Web Analytics + filtro antes de enviar ──
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  window.va("beforeSend", function (ev) {
    if (!medicionPermitida()) return null;
    try {
      const u = new URL(ev.url);
      if (PAGINAS_EXCLUIDAS.test(u.pathname)) return null;
      u.search = ""; u.hash = "";                      // sin parámetros: pueden llevar tokens
      return Object.assign({}, ev, { url: u.toString() });
    } catch (e) { return null; }
  });

  // ── Eventos permitidos y valores acotados (nada de datos personales) ──
  const EVENTOS = {
    ver_estacion: { estacion: /^\d{1,3}$/ },
    descargar_csv: { tipo: /^(punto|todos|comparacion|disponibilidad|centro_datos|centro_estadisticas)$/ },
    cambiar_periodo: { periodo: /^(24|48|168|720|2160|hist)$/ },
    abrir_vista: { vista: /^(resumen|estadisticas|variacion|descargas|powerbi)$/ },
    clic_patrocinio: {},
  };
  window.senfepinMedir = function (nombre, datos) {
    const reglas = EVENTOS[nombre];
    if (!reglas || !CFG.analitica.activa || !medicionPermitida()) return;
    const limpio = {};
    for (const [clave, patron] of Object.entries(reglas)) {
      const v = String((datos || {})[clave] ?? "");
      if (!patron.test(v)) return;                     // valor fuera de la lista: no se envía
      limpio[clave] = v;
    }
    window.va("event", { name: nombre, data: limpio });
  };

  // ── Carga del script de analítica (solo si está activa y permitida) ──
  if (CFG.analitica.activa && medicionPermitida() && !PAGINAS_EXCLUIDAS.test(location.pathname)) {
    const s = document.createElement("script");
    s.defer = true; s.src = CFG.analitica.script;
    document.head.appendChild(s);
  }

  // ── Patrocinio directo: tarjeta etiquetada «Patrocinado», sin rastreadores ──
  window.senfepinPintarPatrocinio = function (contenedor) {
    const p = CFG.patrocinio;
    if (!contenedor || !p.activo || !p.texto || !/^https:\/\//.test(p.enlace)) return;
    const a = document.createElement("a");
    a.className = "patrocinio";
    a.href = p.enlace; a.target = "_blank"; a.rel = "sponsored noopener noreferrer";
    a.innerHTML = '<span class="patrocinio-etq">Patrocinado</span>';
    if (p.imagen && /^\/?[\w./-]+$/.test(p.imagen)) {   // solo imágenes locales
      const img = document.createElement("img"); img.src = p.imagen; img.alt = p.nombre || ""; img.loading = "lazy";
      a.appendChild(img);
    }
    const t = document.createElement("span"); t.className = "patrocinio-txt";
    t.textContent = p.texto; a.appendChild(t);
    a.addEventListener("click", () => window.senfepinMedir("clic_patrocinio", {}));   // conteo agregado, sin datos
    contenedor.appendChild(a); contenedor.hidden = false;
  };

  // ── AdSense: no se carga nada mientras esté desactivado ──
  if (CFG.adsense.activo && /^ca-pub-\d{10,20}$/.test(CFG.adsense.cliente) && medicionPermitida()) {
    const s = document.createElement("script");
    s.async = true; s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + CFG.adsense.cliente;
    document.head.appendChild(s);
  }
})();
