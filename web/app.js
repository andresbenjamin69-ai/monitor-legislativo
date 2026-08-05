/* ==========================================================================
   EcoLey Alert — Lógica Frontend (Glassmorphism UI)
   ========================================================================== */

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
  const navItems = document.querySelectorAll(".nav-item");
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

  // ── 1. Carga de Datos
  async function loadData() {
    try {
      const response = await fetch("../data/data.json?t=" + new Date().getTime());
      if (!response.ok) throw new Error("No se pudo cargar data.json");
      
      const rawData = await response.json();
      
      // Parser Defensivo
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
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:3rem; color:var(--accent-rose);">
        ⚠️ No se encontró la base de datos (data.json).<br>Ve a Configuración y dispara la Importación Histórica.
      </td></tr>`;
    }
  }

  function updateHeaderStats() {
    const today = new Date().toLocaleDateString("es-AR", { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    headerDate.textContent = today.toUpperCase();
    
    const enDebate = allData.filter(d => d.estado === "En Debate").length;
    const aprobados = allData.filter(d => d.estado === "Aprobado").length;
    const absurdos = allData.filter(d => d.es_absurdo).length;
    
    headerStats.textContent = `${allData.length} proyectos | ${aprobados} leyes | ${absurdos} observados`;
  }

  // ── 2. Filtrado y Renderizado
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
      if (currentFilterEstado && item.estado !== currentFilterEstado) return false;
      if (valCamara && item.origen !== valCamara) return false;
      if (valDoctrina && item.clasificacion_doctrinal.doctrina !== valDoctrina) return false;
      if (valIndustria && !item.industrias_afectadas.includes(valIndustria)) return false;
      
      if (valTexto) {
        const str = `${item.id} ${item.titulo_sintesis} ${item.titulo_original} ${item.autor} ${item.bloque_politico}`.toLowerCase();
        if (!str.includes(valTexto)) return false;
      }
      return true;
    });

    renderTable(filtered);
    
    let statusParts = [];
    if (currentFilterEstado) statusParts.push(`Estado: ${currentFilterEstado}`);
    if (valCamara) statusParts.push(valCamara);
    if (valDoctrina) statusParts.push(valDoctrina);
    if (valIndustria) statusParts.push(valIndustria);
    if (valTexto) statusParts.push(`"${valTexto}"`);
    
    if (statusParts.length > 0) {
      filterStatus.textContent = `Mostrando ${filtered.length} proyectos (${statusParts.join(' • ')})`;
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

      const badgeCriticidad = getCriticidadClass(item.criticidad);
      const badgeImpacto = getImpactoClass(item.impacto);
      const estadoCls = item.estado === "Aprobado" ? "status-aprobado" : "status-debate";
      
      const indHTML = item.industrias_afectadas.slice(0,2).map(ind => 
        `<span class="tag" style="background:rgba(255,255,255,0.6);">${ind}</span>`
      ).join('');
      const indMore = item.industrias_afectadas.length > 2 ? 
        `<span class="tag" style="background:rgba(255,255,255,0.6);">+${item.industrias_afectadas.length - 2}</span>` : '';

      const iconPendiente = item.vinculacion === "pendiente" ? `<span title="Requiere revisión BORA">⚠️</span>` : '';
      const flagAbsurdo = item.es_absurdo ? `<div class="mt-2"><span class="badge" style="background:rgba(225, 29, 72, 0.1); color:var(--accent-rose);">🚨 Observatorio</span></div>` : '';

      tr.innerHTML = `
        <td><span class="exp-badge">${item.id}</span> ${iconPendiente}</td>
        <td><div class="date-text">${formatDate(item.fecha_inicio)}</div></td>
        <td><div class="camara-text">${item.origen.replace("Cámara de ", "")}</div></td>
        <td>
          <div class="title-text">${item.titulo_sintesis}</div>
          <div style="display:flex; gap:0.25rem; margin-top:0.25rem;">${indHTML}${indMore}</div>
          ${flagAbsurdo}
        </td>
        <td><span class="doc-badge">${item.clasificacion_doctrinal?.doctrina || "N/D"}</span></td>
        <td><span class="${badgeCriticidad}">${item.criticidad}</span></td>
        <td><span class="${badgeImpacto}">${item.impacto}</span></td>
        <td><span class="status-badge ${estadoCls}">${item.estado}</span></td>
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
        <div class="obs-header">
          <span class="exp-badge">${item.id}</span>
          <span class="date-text">${formatDate(item.fecha_inicio)}</span>
        </div>
        <h3 class="obs-title">${item.titulo_sintesis}</h3>
        <div class="obs-crit">
          <strong>Contradicción detectada:</strong>
          ${item.critica_observatorio}
        </div>
      `;
      obsGrid.appendChild(card);
    });
  }

  // ── 3. Panel Memorándum (Drawer)
  let currentItemMinuta = "";

  function openMemo(item) {
    const estadoEl = document.getElementById("memo-badge");
    estadoEl.textContent = item.estado;
    estadoEl.className = "badge " + (item.estado === "Aprobado" ? "" : ""); // TODO: adjust class
    
    const vincEl = document.getElementById("memo-vinculacion");
    if (item.vinculacion === "pendiente") vincEl.classList.remove("hidden");
    else vincEl.classList.add("hidden");

    document.getElementById("memo-id").textContent = item.id;
    document.getElementById("memo-origen").textContent = item.origen;
    document.getElementById("memo-autor").textContent = item.autor || "N/D";
    document.getElementById("memo-bloque").textContent = item.bloque_politico || "N/D";
    document.getElementById("memo-fecha").textContent = formatDate(item.fecha_inicio);
    
    const linkBoraEl = document.getElementById("memo-link-bora");
    const rowBora = document.getElementById("row-boletin");
    const rowAprobacion = document.getElementById("row-aprobacion");
    const rowLey = document.getElementById("row-ley");

    if (item.estado === "Aprobado") {
      rowAprobacion.classList.remove("hidden");
      rowLey.classList.remove("hidden");
      document.getElementById("memo-fecha-aprobacion").textContent = formatDate(item.fecha_aprobacion) || "N/D";
      document.getElementById("memo-ley").textContent = item.numero_ley || "N/D";
      
      if (item.link_boletin_oficial) {
        rowBora.classList.remove("hidden");
        linkBoraEl.href = item.link_boletin_oficial;
      } else {
        rowBora.classList.add("hidden");
      }
    } else {
      rowAprobacion.classList.add("hidden");
      rowLey.classList.add("hidden");
      rowBora.classList.add("hidden");
    }

    document.getElementById("memo-link").href = item.link_fuente;
    document.getElementById("memo-titulo").textContent = item.titulo_sintesis;
    document.getElementById("memo-sintesis").textContent = item.titulo_original;

    const tagsContainer = document.getElementById("memo-tags");
    tagsContainer.innerHTML = item.industrias_afectadas.map(i => `<span class="tag">${i}</span>`).join("");
    
    const macro = item.analisis_macro || {};
    document.getElementById("memo-macro-tipo").textContent = macro.tipo_politica || "N/D";
    document.getElementById("memo-macro-resumen").textContent = macro.resumen || "N/D";
    document.getElementById("memo-macro-recaudacion").textContent = macro.efectos_sobre_recaudacion || "N/D";
    document.getElementById("memo-macro-empleo").textContent = macro.efectos_sobre_empleo || "N/D";

    const micro = item.analisis_micro || {};
    document.getElementById("memo-micro-costos").textContent = micro.impacto_costos_operativos || "N/D";
    document.getElementById("memo-micro-barreras").textContent = micro.barreras_de_entrada || "N/D";
    document.getElementById("memo-micro-pymes").textContent = micro.impacto_pymes || "N/D";

    const doct = item.clasificacion_doctrinal || {};
    document.getElementById("memo-doctrina").textContent = doct.doctrina || "N/D";
    document.getElementById("memo-doctrina-desc").textContent = doct.descripcion || "N/D";
    document.getElementById("memo-rumbo").textContent = doct.rumbo_economico_proyectado || "N/D";

    const puntosEl = document.getElementById("memo-puntos");
    puntosEl.innerHTML = item.resumen_puntos.map(p => `<li>${p}</li>`).join("");

    currentItemMinuta = item.minuta;
    document.getElementById("memo-minuta").textContent = item.minuta;

    const obsSection = document.getElementById("memo-observatorio");
    if (item.es_absurdo) {
      obsSection.classList.remove("hidden");
      document.getElementById("memo-critica").textContent = item.critica_observatorio;
    } else {
      obsSection.classList.add("hidden");
    }

    memoPanel.classList.remove("hidden");
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
      // alert("Minuta copiada");
    } catch (err) {
      console.error(err);
    }
  });

  btnPrint.addEventListener("click", () => window.print());

  // ── 4. Eventos de Navegación
  navItems.forEach(tab => {
    tab.addEventListener("click", () => {
      navItems.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      currentSection = tab.dataset.section;
      currentFilterEstado = tab.dataset.estado || null;

      Object.keys(sections).forEach(k => sections[k].classList.add("hidden"));
      sections[currentSection].classList.remove("hidden");

      const filterBar = document.getElementById("filter-bar");
      if (currentSection === "configuracion") {
        filterBar.classList.add("hidden");
        loadStoredConfig();
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
    backfillStatus.textContent = "✅ Guardado localmente.";
    backfillStatus.style.color = "var(--accent-green)";
  });

  btnTriggerBackfill.addEventListener("click", async () => {
    const owner = cfgOwner.value.trim();
    const repo = cfgRepo.value.trim();
    const token = cfgToken.value.trim();
    const start = cfgStart.value;
    const end = cfgEnd.value;

    if (!owner || !repo || !token || !start || !end) {
      backfillStatus.textContent = "❌ Faltan datos.";
      backfillStatus.style.color = "var(--accent-rose)";
      return;
    }

    if (!confirm(`¿Disparar análisis desde ${start} hasta ${end}?`)) return;

    btnTriggerBackfill.disabled = true;
    backfillStatus.textContent = "⏳ Enviando solicitud...";

    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/run_analysis.yml/dispatches`, {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({ ref: "main", inputs: { start_date: start, end_date: end, backfill: "true" } })
      });

      if (res.ok) {
        backfillStatus.textContent = "✅ Tarea iniciada en GitHub Actions.";
        backfillStatus.style.color = "var(--accent-green)";
      } else {
        const err = await res.json();
        throw new Error(err.message || res.status);
      }
    } catch (e) {
      backfillStatus.textContent = `❌ Falló: ${e.message}`;
      backfillStatus.style.color = "var(--accent-rose)";
    } finally {
      btnTriggerBackfill.disabled = false;
    }
  });

  // Editor de Prompt
  let currentFileSha = null;

  btnLoadPrompt.addEventListener("click", async () => {
    const owner = localStorage.getItem("ecoley_gh_owner");
    const repo = localStorage.getItem("ecoley_gh_repo");
    const token = localStorage.getItem("ecoley_gh_token");

    if (!owner || !repo) {
      try {
        const res = await fetch("../config/prompt_config.json?t=" + new Date().getTime());
        promptEditor.value = JSON.stringify(await res.json(), null, 2);
        promptStatus.textContent = "✅ Prompt cargado (Solo lectura local).";
      } catch (e) {
        promptStatus.textContent = "❌ Falló carga local.";
      }
      return;
    }

    btnLoadPrompt.disabled = true;
    promptStatus.textContent = "⏳ Obteniendo...";

    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/config/prompt_config.json`, {
        headers: { "Accept": "application/vnd.github+json", ...(token && { "Authorization": `Bearer ${token}` }) }
      });
      
      if (res.ok) {
        const data = await res.json();
        currentFileSha = data.sha;
        promptEditor.value = decodeURIComponent(escape(atob(data.content)));
        promptStatus.textContent = "✅ Cargado desde GitHub.";
        promptStatus.style.color = "var(--accent-green)";
      } else {
        throw new Error("HTTP " + res.status);
      }
    } catch (e) {
      promptStatus.textContent = `❌ Error: ${e.message}`;
      promptStatus.style.color = "var(--accent-rose)";
    } finally {
      btnLoadPrompt.disabled = false;
    }
  });

  btnSavePrompt.addEventListener("click", async () => {
    const owner = localStorage.getItem("ecoley_gh_owner");
    const repo = localStorage.getItem("ecoley_gh_repo");
    const token = localStorage.getItem("ecoley_gh_token");

    if (!owner || !repo || !token || !currentFileSha) return;

    let jsonStr = promptEditor.value.trim();
    try { JSON.parse(jsonStr); } catch (e) {
      promptStatus.textContent = `❌ JSON Inválido.`;
      return;
    }

    btnSavePrompt.disabled = true;
    promptStatus.textContent = "⏳ Guardando...";

    try {
      const b64Content = btoa(unescape(encodeURIComponent(jsonStr)));
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/config/prompt_config.json`, {
        method: "PUT",
        headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ message: "Update prompt config", content: b64Content, sha: currentFileSha, branch: "main" })
      });

      if (res.ok) {
        const data = await res.json();
        currentFileSha = data.content.sha;
        promptStatus.textContent = "✅ Guardado.";
        promptStatus.style.color = "var(--accent-green)";
      } else {
        throw new Error(await res.text());
      }
    } catch (e) {
      promptStatus.textContent = `❌ Error: ${e.message}`;
    } finally {
      btnSavePrompt.disabled = false;
    }
  });

  // ── Utils
  function formatDate(isoStr) {
    if (!isoStr) return "";
    const parts = isoStr.split("-");
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return isoStr;
  }

  function getCriticidadClass(crit) {
    if (crit === "Alta") return "crit-alta";
    if (crit === "Media") return "crit-media";
    return "crit-baja";
  }

  function getImpactoClass(imp) {
    return "crit-media"; // default
  }

  // ── Inicio
  loadData();
});
