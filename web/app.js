/* ════════════════════════════════════════════════════════════════
   EcoLey Alert — Lógica Frontend (app.js)
   ════════════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  // ── Elementos del DOM
  const tableBody = document.getElementById("table-body");
  const tableEmpty = document.getElementById("table-empty");
  const dataTable = document.getElementById("data-table");
  
  const obsGrid = document.getElementById("observatorio-grid");
  const obsEmpty = document.getElementById("observatorio-empty");

  const filterCamara = document.getElementById("filter-camara");
  const filterDoctrina = document.getElementById("filter-doctrina");
  const filterIndustria = document.getElementById("filter-industria");
  const filterTexto = document.getElementById("filter-texto");
  const filterReset = document.getElementById("filter-reset");
  const emptyReset = document.getElementById("empty-reset");
  const filterStatus = document.getElementById("filter-status");

  const headerDate = document.getElementById("header-date");
  const headerStats = document.getElementById("header-stats");

  // Secciones y Navegación
  const tabs = document.querySelectorAll(".nav-tab");
  const sections = {
    "legislativo": document.getElementById("section-legislativo"),
    "observatorio": document.getElementById("section-observatorio"),
    "configuracion": document.getElementById("section-configuracion")
  };

  // Configuración
  const promptEditor = document.getElementById("prompt-editor");
  const btnLoadPrompt = document.getElementById("btn-load-prompt");
  const btnSavePrompt = document.getElementById("btn-save-prompt");
  const promptStatus = document.getElementById("prompt-status");

  const btnTriggerBackfill = document.getElementById("btn-trigger-backfill");
  const btnSaveConfig = document.getElementById("btn-save-config");
  const cfgOwner = document.getElementById("cfg-owner");
  const cfgRepo = document.getElementById("cfg-repo");
  const cfgToken = document.getElementById("cfg-token");
  const cfgStart = document.getElementById("cfg-start");
  const cfgEnd = document.getElementById("cfg-end");
  const backfillStatus = document.getElementById("backfill-status");

  // Drawer (Panel Memorándum)
  const memoPanel = document.getElementById("memo-panel");
  const memoOverlay = document.getElementById("memo-overlay");
  const btnCloseMemo = document.getElementById("btn-close-memo");
  const btnCopyMinuta = document.getElementById("btn-copy-minuta");
  const btnPrint = document.getElementById("btn-print");
  const memoAccordionTitles = document.querySelectorAll(".memo-accordion-title");

  // ── Estado Global
  let allData = [];
  let currentFilterEstado = null; // null = todos, "En Debate", "Aprobado"
  let currentSection = "legislativo";

  // Inicializar fechas por defecto en config (ayer y hoy)
  const hoy = new Date();
  const ayer = new Date(hoy);
  ayer.setDate(ayer.getDate() - 1);
  cfgEnd.value = hoy.toISOString().split("T")[0];
  cfgStart.value = ayer.toISOString().split("T")[0];

  // ── 1. Carga de Datos (Parser Defensivo)
  async function loadData() {
    try {
      const response = await fetch("../data/data.json?t=" + new Date().getTime());
      if (!response.ok) throw new Error("No se pudo cargar data.json");
      
      const rawData = await response.json();
      
      // Parser Defensivo: asegura estructura y defaults
      allData = rawData.map(item => ({
        id: item.id || "N/D",
        origen: item.origen || "",
        estado: item.estado || "En Debate",
        link_fuente: item.link_fuente || "#",
        link_boletin_oficial: item.link_boletin_oficial || "",
        numero_ley: item.numero_ley || "",
        titulo_original: item.titulo_original || "",
        titulo_sintesis: item.titulo_sintesis || item.titulo_original || "Sin título",
        autor: item.autor || "",
        bloque_politico: item.bloque_politico || "",
        fecha_inicio: item.fecha_inicio || "",
        fecha_aprobacion: item.fecha_aprobacion || "",
        comisiones: Array.isArray(item.comisiones) ? item.comisiones : [],
        industrias_afectadas: Array.isArray(item.industrias_afectadas) ? item.industrias_afectadas : [],
        analisis_macro: item.analisis_macro || {},
        analisis_micro: item.analisis_micro || {},
        clasificacion_doctrinal: item.clasificacion_doctrinal || {},
        criticidad: item.criticidad || "Baja",
        impacto: item.impacto || "Neutral",
        resumen_puntos: Array.isArray(item.resumen_puntos) ? item.resumen_puntos : [],
        minuta: item.minuta || "Sin minuta generada.",
        es_absurdo: Boolean(item.es_absurdo),
        critica_observatorio: item.critica_observatorio || "",
        vinculacion: item.vinculacion || "no_aplica"
      }));

      // Ordenar por fecha_inicio descendente
      allData.sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio));

      updateHeaderStats();
      applyFilters();

    } catch (error) {
      console.error(error);
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:3rem; color:var(--color-burdeos);">
        ⚠️ No se encontró la base de datos (data.json).<br>Si es la primera ejecución, realiza la Importación Histórica desde la sección Configuración.
      </td></tr>`;
    }
  }

  function updateHeaderStats() {
    const today = new Date().toLocaleDateString("es-AR", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    headerDate.textContent = today.charAt(0).toUpperCase() + today.slice(1);
    
    const enDebate = allData.filter(d => d.estado === "En Debate").length;
    const aprobados = allData.filter(d => d.estado === "Aprobado").length;
    const absurdos = allData.filter(d => d.es_absurdo).length;
    
    headerStats.textContent = `${allData.length} registros | ${enDebate} en debate | ${aprobados} leyes | ${absurdos} observados`;
  }

  // ── 2. Filtrado y Renderizado (Lógica AND)
  function applyFilters() {
    if (currentSection === "configuracion") return;

    if (currentSection === "observatorio") {
      renderObservatorio();
      return;
    }

    const valCamara = filterCamara.value;
    const valDoctrina = filterDoctrina.value;
    const valIndustria = filterIndustria.value;
    const valTexto = filterTexto.value.toLowerCase().trim();

    const filtered = allData.filter(item => {
      // Filtro Estado (Tabs)
      if (currentFilterEstado && item.estado !== currentFilterEstado) return false;
      
      // Filtro Cámara
      if (valCamara && item.origen !== valCamara) return false;
      
      // Filtro Doctrina
      if (valDoctrina && item.clasificacion_doctrinal.doctrina !== valDoctrina) return false;
      
      // Filtro Industria
      if (valIndustria && !item.industrias_afectadas.includes(valIndustria)) return false;
      
      // Filtro Texto (ID, Título, Autor)
      if (valTexto) {
        const str = `${item.id} ${item.titulo_sintesis} ${item.titulo_original} ${item.autor} ${item.bloque_politico}`.toLowerCase();
        if (!str.includes(valTexto)) return false;
      }
      
      return true;
    });

    renderTable(filtered);
    
    // Status text
    let statusParts = [];
    if (currentFilterEstado) statusParts.push(`Estado: ${currentFilterEstado}`);
    if (valCamara) statusParts.push(`Cámara: ${valCamara}`);
    if (valDoctrina) statusParts.push(`Doctrina: ${valDoctrina}`);
    if (valIndustria) statusParts.push(`Industria: ${valIndustria}`);
    if (valTexto) statusParts.push(`Búsqueda: "${valTexto}"`);
    
    if (statusParts.length > 0) {
      filterStatus.textContent = `Mostrando ${filtered.length} proyecto${filtered.length !== 1 ? 's' : ''} (${statusParts.join(' + ')})`;
    } else {
      filterStatus.textContent = `Mostrando todos los proyectos (${allData.length})`;
    }
  }

  function renderTable(data) {
    tableBody.innerHTML = "";
    
    if (data.length === 0) {
      dataTable.classList.add("hidden");
      tableEmpty.classList.remove("hidden");
      return;
    }
    
    dataTable.classList.remove("hidden");
    tableEmpty.classList.add("hidden");

    data.forEach(item => {
      const tr = document.createElement("tr");
      tr.addEventListener("click", () => openMemo(item));

      // Badges
      const badgeDoctrina = getDoctrinaColor(item.clasificacion_doctrinal?.doctrina);
      const badgeCriticidad = getCriticidadClass(item.criticidad);
      const badgeImpacto = getImpactoClass(item.impacto);
      const badgeEstado = item.estado === "Aprobado" ? "badge--aprobado" : "badge--debate";
      
      // Industria tags
      const indHTML = item.industrias_afectadas.slice(0,2).map(ind => 
        `<span class="badge badge--industria">${ind}</span>`
      ).join('');
      const indMore = item.industrias_afectadas.length > 2 ? 
        `<span class="badge badge--industria" title="${item.industrias_afectadas.slice(2).join(', ')}">+${item.industrias_afectadas.length - 2}</span>` : '';

      // Alertas visuales
      const iconPendiente = item.vinculacion === "pendiente" ? `<span class="ico-pendiente" title="Vinculación BORA heurística. Requiere revisión.">⚠️</span>` : '';
      const flagAbsurdo = item.es_absurdo ? `<div style="margin-top:4px;"><span class="badge badge--absurdo">🚨 Observado</span></div>` : '';

      tr.innerHTML = `
        <td class="cell-expediente">${item.id} ${iconPendiente}</td>
        <td>${formatDate(item.fecha_inicio)}</td>
        <td>${item.origen.replace("Cámara de ", "")}</td>
        <td class="cell-sintesis">
          <strong>${item.titulo_sintesis}</strong>
          <div class="cell-industries">${indHTML}${indMore}</div>
          ${flagAbsurdo}
        </td>
        <td class="cell-doctrina"><span style="color:${badgeDoctrina}; font-weight:600;">■</span> ${item.clasificacion_doctrinal?.doctrina || "N/D"}</td>
        <td style="text-align:center;"><span class="badge ${badgeCriticidad}">${item.criticidad}</span></td>
        <td style="text-align:center;"><span class="badge ${badgeImpacto}">${item.impacto}</span></td>
        <td style="text-align:center;"><span class="badge ${badgeEstado}">${item.estado}</span></td>
      `;
      tableBody.appendChild(tr);
    });
  }

  function renderObservatorio() {
    obsGrid.innerHTML = "";
    const absurdos = allData.filter(item => item.es_absurdo);
    
    if (absurdos.length === 0) {
      obsGrid.classList.add("hidden");
      obsEmpty.classList.remove("hidden");
      return;
    }

    obsGrid.classList.remove("hidden");
    obsEmpty.classList.add("hidden");

    absurdos.forEach(item => {
      const card = document.createElement("div");
      card.className = "obs-card";
      card.addEventListener("click", () => openMemo(item));

      card.innerHTML = `
        <div class="obs-card-id">${item.id} | ${item.origen} | ${formatDate(item.fecha_inicio)}</div>
        <h3 class="obs-card-titulo">${item.titulo_sintesis}</h3>
        <p class="obs-card-critica"><strong>Crítica:</strong> ${item.critica_observatorio}</p>
        <div style="margin-top: 0.75rem;">
          <span class="badge badge--absurdo">🚨 Observatorio C1-C5</span>
        </div>
      `;
      obsGrid.appendChild(card);
    });
  }

  // ── 3. Panel Memorándum (Drawer)
  let currentItemMinuta = "";

  function openMemo(item) {
    // Header
    const estadoEl = document.getElementById("memo-badge");
    estadoEl.textContent = item.estado;
    estadoEl.className = "memo-badge " + (item.estado === "Aprobado" ? "badge--aprobado" : "badge--debate");
    
    const vincEl = document.getElementById("memo-vinculacion");
    if (item.vinculacion === "pendiente") {
      vincEl.classList.remove("hidden");
    } else {
      vincEl.classList.add("hidden");
    }

    // Datos básicos
    document.getElementById("memo-id").textContent = item.id;
    document.getElementById("memo-origen").textContent = item.origen;
    document.getElementById("memo-autor").textContent = item.autor;
    document.getElementById("memo-bloque").textContent = item.bloque_politico;
    document.getElementById("memo-fecha").textContent = formatDate(item.fecha_inicio);
    
    const linkBoraEl = document.getElementById("memo-link-bora");
    const rowBora = document.getElementById("row-boletin");
    const rowAprobacion = document.getElementById("row-aprobacion");
    const rowLey = document.getElementById("row-ley");

    if (item.estado === "Aprobado") {
      rowAprobacion.style.display = "flex";
      rowLey.style.display = "flex";
      document.getElementById("memo-fecha-aprobacion").textContent = formatDate(item.fecha_aprobacion) || "N/D";
      document.getElementById("memo-ley").textContent = item.numero_ley || "N/D";
      
      if (item.link_boletin_oficial) {
        rowBora.style.display = "flex";
        linkBoraEl.href = item.link_boletin_oficial;
      } else {
        rowBora.style.display = "none";
      }
    } else {
      rowAprobacion.style.display = "none";
      rowLey.style.display = "none";
      rowBora.style.display = "none";
    }

    document.getElementById("memo-link").href = item.link_fuente;
    document.getElementById("memo-titulo").textContent = item.titulo_sintesis;
    document.getElementById("memo-sintesis").textContent = item.titulo_original;

    // Tags
    const tagsContainer = document.getElementById("memo-tags");
    tagsContainer.innerHTML = item.industrias_afectadas.map(i => `<span class="badge badge--industria">${i}</span>`).join("");
    
    // Macro
    const macro = item.analisis_macro || {};
    document.getElementById("memo-macro-tipo").textContent = macro.tipo_politica || "N/D";
    document.getElementById("memo-macro-resumen").textContent = macro.resumen || "N/D";
    document.getElementById("memo-macro-recaudacion").textContent = macro.efectos_sobre_recaudacion || "N/D";
    document.getElementById("memo-macro-empleo").textContent = macro.efectos_sobre_empleo || "N/D";

    // Micro
    const micro = item.analisis_micro || {};
    document.getElementById("memo-micro-costos").textContent = micro.impacto_costos_operativos || "N/D";
    document.getElementById("memo-micro-barreras").textContent = micro.barreras_de_entrada || "N/D";
    document.getElementById("memo-micro-pymes").textContent = micro.impacto_pymes || "N/D";

    // Doctrina
    const doct = item.clasificacion_doctrinal || {};
    document.getElementById("memo-doctrina").textContent = doct.doctrina || "N/D";
    document.getElementById("memo-doctrina-desc").textContent = doct.descripcion || "N/D";
    document.getElementById("memo-rumbo").textContent = doct.rumbo_economico_proyectado || "N/D";

    // Puntos
    const puntosEl = document.getElementById("memo-puntos");
    puntosEl.innerHTML = item.resumen_puntos.map(p => `<li>${p}</li>`).join("");

    // Minuta
    currentItemMinuta = item.minuta;
    document.getElementById("memo-minuta").textContent = item.minuta;

    // Observatorio
    const obsSection = document.getElementById("memo-observatorio");
    if (item.es_absurdo) {
      obsSection.classList.remove("hidden");
      document.getElementById("memo-critica").textContent = item.critica_observatorio;
    } else {
      obsSection.classList.add("hidden");
    }

    memoPanel.classList.remove("hidden");
    
    // Reset scroll inside drawer
    document.getElementById("memo-body").scrollTop = 0;
  }

  function closeMemo() {
    memoPanel.classList.add("hidden");
  }

  memoOverlay.addEventListener("click", closeMemo);
  btnCloseMemo.addEventListener("click", closeMemo);

  btnCopyMinuta.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentItemMinuta);
      const originalText = btnCopyMinuta.textContent;
      btnCopyMinuta.textContent = "✅ Copiada";
      setTimeout(() => btnCopyMinuta.textContent = originalText, 2000);
    } catch (err) {
      alert("Error al copiar al portapapeles.");
    }
  });

  btnPrint.addEventListener("click", () => {
    window.print();
  });

  // Toggle accordions programmatically if needed (native HTML details tag handles clicks)
  memoAccordionTitles.forEach(title => {
    title.addEventListener('click', (e) => {
      // Evitar que el acordeón se cierre si está en modo impresión
      // (El comportamiento nativo ya es bueno, esto es solo por si necesitamos interceptar)
    });
  });

  // ── 4. Eventos de Navegación y Filtros
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      // Activar tab
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      // Setear variables
      currentSection = tab.dataset.section;
      currentFilterEstado = tab.dataset.estado || null;

      // Mostrar sección
      Object.keys(sections).forEach(k => sections[k].classList.add("hidden"));
      sections[currentSection].classList.remove("hidden");

      // Mostrar/ocultar barra de filtros
      const filterBar = document.getElementById("filter-bar");
      if (currentSection === "configuracion") {
        filterBar.classList.add("hidden");
        loadStoredConfig(); // Cargar config al entrar a la tab
      } else {
        filterBar.classList.remove("hidden");
        applyFilters();
      }
    });
  });

  [filterCamara, filterDoctrina, filterIndustria, filterTexto].forEach(el => {
    el.addEventListener("input", applyFilters);
    el.addEventListener("change", applyFilters);
  });

  const resetFilters = () => {
    filterCamara.value = "";
    filterDoctrina.value = "";
    filterIndustria.value = "";
    filterTexto.value = "";
    applyFilters();
  };

  filterReset.addEventListener("click", resetFilters);
  emptyReset.addEventListener("click", resetFilters);

  // ── 5. Configuración y API de GitHub

  function loadStoredConfig() {
    cfgOwner.value = localStorage.getItem("ecoley_gh_owner") || "";
    cfgRepo.value = localStorage.getItem("ecoley_gh_repo") || "";
    cfgToken.value = localStorage.getItem("ecoley_gh_token") || "";
  }

  btnSaveConfig.addEventListener("click", () => {
    localStorage.setItem("ecoley_gh_owner", cfgOwner.value.trim());
    localStorage.setItem("ecoley_gh_repo", cfgRepo.value.trim());
    localStorage.setItem("ecoley_gh_token", cfgToken.value.trim());
    backfillStatus.textContent = "✅ Configuración guardada en este navegador.";
    backfillStatus.className = "config-status success";
    setTimeout(() => backfillStatus.textContent = "", 3000);
  });

  // Disparar workflow dispatch
  btnTriggerBackfill.addEventListener("click", async () => {
    const owner = cfgOwner.value.trim();
    const repo = cfgRepo.value.trim();
    const token = cfgToken.value.trim();
    const start = cfgStart.value;
    const end = cfgEnd.value;

    if (!owner || !repo || !token || !start || !end) {
      backfillStatus.textContent = "❌ Faltan datos (Owner, Repo, Token o fechas).";
      backfillStatus.className = "config-status error";
      return;
    }

    if (!confirm(`¿Estás seguro de disparar el análisis desde ${start} hasta ${end}?\nEsto consumirá minutos de GitHub Actions.`)) {
      return;
    }

    btnTriggerBackfill.disabled = true;
    backfillStatus.textContent = "⏳ Enviando solicitud a GitHub API...";
    backfillStatus.className = "config-status";

    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/run_analysis.yml/dispatches`, {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            start_date: start,
            end_date: end,
            backfill: "true"
          }
        })
      });

      if (res.ok) {
        backfillStatus.textContent = "✅ Tarea iniciada con éxito. Revisa la pestaña 'Actions' en GitHub.";
        backfillStatus.className = "config-status success";
      } else {
        const err = await res.json();
        throw new Error(err.message || "Error HTTP " + res.status);
      }
    } catch (e) {
      backfillStatus.textContent = `❌ Falló la solicitud: ${e.message}`;
      backfillStatus.className = "config-status error";
    } finally {
      btnTriggerBackfill.disabled = false;
    }
  });

  // Editor de Prompt (Commit via API)
  let currentFileSha = null;

  btnLoadPrompt.addEventListener("click", async () => {
    const owner = localStorage.getItem("ecoley_gh_owner");
    const repo = localStorage.getItem("ecoley_gh_repo");
    const token = localStorage.getItem("ecoley_gh_token");

    if (!owner || !repo) {
      // Fallback: intentar cargar archivo local para lectura
      try {
        const res = await fetch("../config/prompt_config.json?t=" + new Date().getTime());
        const data = await res.json();
        promptEditor.value = JSON.stringify(data, null, 2);
        promptStatus.textContent = "✅ Prompt cargado en modo de solo lectura (Falta config GitHub).";
        promptStatus.className = "config-status";
      } catch (e) {
        promptStatus.textContent = "❌ No se pudo cargar prompt_config.json local.";
        promptStatus.className = "config-status error";
      }
      return;
    }

    btnLoadPrompt.disabled = true;
    promptStatus.textContent = "⏳ Obteniendo de GitHub...";
    promptStatus.className = "config-status";

    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/config/prompt_config.json`, {
        headers: {
          "Accept": "application/vnd.github+json",
          ...(token && { "Authorization": `Bearer ${token}` })
        }
      });
      
      if (res.ok) {
        const data = await res.json();
        currentFileSha = data.sha;
        // El contenido viene en base64
        const contentStr = decodeURIComponent(escape(atob(data.content)));
        promptEditor.value = contentStr;
        promptStatus.textContent = "✅ Prompt cargado desde el repositorio.";
        promptStatus.className = "config-status success";
      } else {
        throw new Error("Error HTTP " + res.status);
      }
    } catch (e) {
      promptStatus.textContent = `❌ Fallo: ${e.message}`;
      promptStatus.className = "config-status error";
    } finally {
      btnLoadPrompt.disabled = false;
    }
  });

  btnSavePrompt.addEventListener("click", async () => {
    const owner = localStorage.getItem("ecoley_gh_owner");
    const repo = localStorage.getItem("ecoley_gh_repo");
    const token = localStorage.getItem("ecoley_gh_token");

    if (!owner || !repo || !token) {
      promptStatus.textContent = "❌ Configura tu Usuario, Repo y Token primero.";
      promptStatus.className = "config-status error";
      return;
    }

    if (!currentFileSha) {
      promptStatus.textContent = "❌ Primero debes cargar el archivo desde el repositorio.";
      promptStatus.className = "config-status error";
      return;
    }

    let jsonStr = promptEditor.value.trim();
    
    // Validar JSON
    try {
      JSON.parse(jsonStr);
    } catch (e) {
      promptStatus.textContent = `❌ JSON Inválido: ${e.message}`;
      promptStatus.className = "config-status error";
      return;
    }

    btnSavePrompt.disabled = true;
    promptStatus.textContent = "⏳ Guardando (haciendo commit) en GitHub...";
    promptStatus.className = "config-status";

    try {
      // utf-8 a base64
      const b64Content = btoa(unescape(encodeURIComponent(jsonStr)));
      
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/config/prompt_config.json`, {
        method: "PUT",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({
          message: "⚙️ EcoLey Alert: actualiza prompt_config.json desde Web UI",
          content: b64Content,
          sha: currentFileSha,
          branch: "main"
        })
      });

      if (res.ok) {
        const data = await res.json();
        currentFileSha = data.content.sha;
        promptStatus.textContent = "✅ Cambios guardados. El Cerebro Economista usará estas reglas en el próximo análisis.";
        promptStatus.className = "config-status success";
      } else {
        const err = await res.json();
        throw new Error(err.message);
      }
    } catch (e) {
      promptStatus.textContent = `❌ Error al guardar: ${e.message}`;
      promptStatus.className = "config-status error";
    } finally {
      btnSavePrompt.disabled = false;
    }
  });


  // ── Utils
  function formatDate(isoStr) {
    if (!isoStr) return "";
    const parts = isoStr.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return isoStr;
  }

  function getCriticidadClass(crit) {
    if (crit === "Alta") return "badge--alta";
    if (crit === "Media") return "badge--media";
    return "badge--baja";
  }

  function getImpactoClass(imp) {
    if (imp === "Positivo") return "badge--positivo";
    if (imp === "Negativo") return "badge--negativo";
    return "badge--neutral";
  }

  function getDoctrinaColor(doctrina) {
    const colors = {
      "Liberal / Desregulador": "#0284C7",
      "Keynesiano / Intervencionista": "#DC2626",
      "Desarrollista / Industrialista": "#059669",
      "Populista / Redistributivo": "#9333EA",
      "Neutro / Procedimental": "#64748B"
    };
    return colors[doctrina] || "#0F172A";
  }

  // ── Inicio
  loadData();
});
