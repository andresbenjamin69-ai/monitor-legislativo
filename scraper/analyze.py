#!/usr/bin/env python3
"""
EcoLey Alert — Monitor Legislativo Industrial (Argentina)
Script principal de scraping y análisis legislativo.

Fuentes de datos verificadas:
  - Diputados:     https://datos.hcdn.gob.ar/       (API CKAN oficial)
  - Senado:        https://api.argentinadatos.com/   (API REST pública de terceros)
  - BORA:          https://www.boletinoficial.gob.ar/ (Scraping HTML — sin API oficial)

Uso:
  # Actualización diaria (ayer → hoy):
  python analyze.py

  # Backfill histórico de un mes completo:
  python analyze.py --backfill --start-date 2026-07-01 --end-date 2026-07-31
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup
import google.generativeai as genai

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURACIÓN
# ══════════════════════════════════════════════════════════════════════════════

BASE_DIR = Path(__file__).parent.parent
DATA_FILE = BASE_DIR / "data" / "data.json"
PROMPT_CONFIG_FILE = BASE_DIR / "config" / "prompt_config.json"

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
THROTTLE_SECONDS = 5  # Respetar límite gratuito de 15 RPM de Gemini

HEADERS = {
    "User-Agent": "EcoLeyAlert/1.0 (Monitor Legislativo Argentina; academic research)",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "es-AR,es;q=0.9",
}

# ══════════════════════════════════════════════════════════════════════════════
# CARGA Y GUARDADO DE DATOS
# ══════════════════════════════════════════════════════════════════════════════

def load_data() -> list:
    """Carga data.json existente o devuelve array vacío."""
    if DATA_FILE.exists():
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if not content:
                    return []
                return json.loads(content)
        except (json.JSONDecodeError, IOError) as e:
            print(f"⚠️  data.json ilegible: {e}. Iniciando con lista vacía.")
            return []
    return []


def validate_and_save(records: list) -> bool:
    """
    Valida que el resultado sea JSON válido ANTES de escribir.
    Si la validación falla, NO modifica el archivo existente.
    """
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        json_str = json.dumps(records, ensure_ascii=False, indent=2)
        # Validación de integridad (equivalente a python -m json.tool)
        json.loads(json_str)
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            f.write(json_str)
        print(f"✅ data.json guardado: {len(records)} registros totales.")
        return True
    except (json.JSONDecodeError, IOError, TypeError) as e:
        print(f"❌ VALIDACIÓN FALLIDA — data.json NO modificado: {e}")
        return False


def load_prompt_config() -> dict:
    """Carga prompt_config.json con todas las directrices del Cerebro Economista."""
    try:
        with open(PROMPT_CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"❌ No se encontró {PROMPT_CONFIG_FILE}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"❌ prompt_config.json inválido: {e}")
        sys.exit(1)


def get_existing_ids(records: list) -> set:
    return {r.get("id", "") for r in records if r.get("id")}

# ══════════════════════════════════════════════════════════════════════════════
# CONCILIACIÓN (DEBATE → APROBADO)
# ══════════════════════════════════════════════════════════════════════════════

def _similarity_score(title_a: str, title_b: str) -> float:
    """Calcula similitud entre dos títulos por palabras clave de 4+ caracteres."""
    words_a = set(re.findall(r'\b\w{4,}\b', title_a.lower()))
    words_b = set(re.findall(r'\b\w{4,}\b', title_b.lower()))
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    return len(intersection) / max(len(words_a), len(words_b))


def reconcile_bora_item(records: list, item: dict) -> bool:
    """
    Intenta conciliar una norma del BORA con un proyecto En Debate.

    Nivel 1 (vinculacion: 'confirmada'):
      Coincidencia exacta de expediente parlamentario citado en el BORA.

    Nivel 2 (vinculacion: 'pendiente'):
      Similitud de título > 70%. Requiere verificación manual del analista.

    Devuelve True si concilió y actualizó el registro existente.
    """
    exp_parl = item.get("exp_parlamentario", "")
    bora_titulo = item.get("titulo", "")
    fecha = item.get("fecha", "")
    link_bora = item.get("link", "")
    numero_norma = item.get("numero_norma", "")

    # Nivel 1: coincidencia por expediente parlamentario exacto
    if exp_parl:
        for record in records:
            if record.get("id") == exp_parl and record.get("estado") == "En Debate":
                record.update({
                    "estado": "Aprobado",
                    "link_boletin_oficial": link_bora,
                    "numero_ley": numero_norma,
                    "fecha_aprobacion": fecha,
                    "vinculacion": "confirmada",
                })
                print(f"  ✅ Nivel 1 — Vinculación confirmada: {exp_parl} → Aprobado")
                return True

    # Nivel 2: similitud de título (fallback para decretos del PEN con exp. interno)
    best_record = None
    best_score = 0.0

    for record in records:
        if record.get("estado") != "En Debate":
            continue
        score = _similarity_score(bora_titulo, record.get("titulo_original", ""))
        if score > best_score:
            best_score = score
            best_record = record

    if best_record and best_score >= 0.70:
        best_record.update({
            "estado": "Aprobado",
            "link_boletin_oficial": link_bora,
            "numero_ley": numero_norma,
            "fecha_aprobacion": fecha,
            "vinculacion": "pendiente",  # ⚠️ Requiere verificación manual en la web
        })
        print(f"  ⚠️  Nivel 2 — Vinculación heurística ({best_score:.0%}): "
              f"'{best_record['id']}' ↔ BORA '{bora_titulo[:50]}'")
        return True

    return False

# ══════════════════════════════════════════════════════════════════════════════
# SCRAPING DE FUENTES
# ══════════════════════════════════════════════════════════════════════════════

def scrape_diputados(start_date: str, end_date: str) -> list:
    """
    Fuente: https://datos.hcdn.gob.ar/ (API CKAN oficial HCDN)
    Fallback: scraping HTML del buscador de proyectos.
    """
    items = []
    year = start_date[:4]
    # Mapping de año a período parlamentario argentino
    period_map = {"2023": "141", "2024": "142", "2025": "143", "2026": "144"}
    period = period_map.get(year, "144")

    print(f"  → API CKAN (período {period})...")
    try:
        # Endpoint de búsqueda del portal de datos abiertos de Diputados
        url = "https://datos.hcdn.gob.ar/api/3/action/datastore_search"
        params = {
            "resource_id": f"expedientes-{period}",
            "limit": 500,
            "sort": "fecha_entrada desc",
        }
        r = requests.get(url, params=params, headers=HEADERS, timeout=30)

        if r.status_code == 200:
            data = r.json()
            for rec in data.get("result", {}).get("records", []):
                fecha = (rec.get("fecha_entrada") or "")[:10]
                if not (start_date <= fecha <= end_date):
                    continue
                exp = rec.get("expediente", rec.get("numero_expediente", ""))
                items.append({
                    "id_raw": exp,
                    "titulo": rec.get("titulo", rec.get("sumario", "")),
                    "autor": rec.get("autor", rec.get("firmante", "")),
                    "bloque": rec.get("bloque", rec.get("partido", "")),
                    "fecha": fecha,
                    "origen": "Cámara de Diputados",
                    "link": (
                        f"https://www.hcdn.gob.ar/proyectos/proyectoTP.jsp?exp={exp}"
                        if exp else "https://datos.hcdn.gob.ar/"
                    ),
                    "texto": rec.get("resumen", rec.get("titulo", ""))[:3000],
                    "es_aprobado": False,
                    "exp_parlamentario": "",
                })
        else:
            raise ValueError(f"HTTP {r.status_code}")

    except Exception as e:
        print(f"  ⚠️  CKAN falló ({e}). Fallback scraping web...")
        items.extend(_scrape_diputados_html(start_date, end_date))

    print(f"  📋 Diputados: {len(items)} proyectos en el rango.")
    return items


def _scrape_diputados_html(start_date: str, end_date: str) -> list:
    """Fallback HTML del buscador de Diputados."""
    items = []
    try:
        url = "https://www.hcdn.gob.ar/proyectos/resultados-buscador.html"
        params = {
            "fechaDesde": start_date.replace("-", "/"),
            "fechaHasta": end_date.replace("-", "/"),
            "tipo": "todos",
        }
        r = requests.get(url, params=params, headers=HEADERS, timeout=30)
        if r.status_code != 200:
            return items

        soup = BeautifulSoup(r.text, "lxml")
        for row in soup.select("table.table tbody tr")[:100]:
            cols = row.find_all("td")
            if len(cols) < 3:
                continue
            link_el = cols[0].find("a")
            exp = cols[0].get_text(strip=True)
            href = (f"https://www.hcdn.gob.ar{link_el['href']}"
                    if link_el and link_el.get("href") else "")
            items.append({
                "id_raw": exp,
                "titulo": cols[1].get_text(strip=True) if len(cols) > 1 else "",
                "autor": cols[2].get_text(strip=True) if len(cols) > 2 else "",
                "bloque": cols[3].get_text(strip=True) if len(cols) > 3 else "",
                "fecha": cols[4].get_text(strip=True) if len(cols) > 4 else start_date,
                "origen": "Cámara de Diputados",
                "link": href,
                "texto": cols[1].get_text(strip=True) if len(cols) > 1 else "",
                "es_aprobado": False,
                "exp_parlamentario": "",
            })
    except Exception as e:
        print(f"  ❌ Fallback Diputados HTML falló: {e}")
    return items


def scrape_senado(start_date: str, end_date: str) -> list:
    """
    Fuente: https://api.argentinadatos.com/v1/senado/proyectos
    API pública de terceros que estructura datos del Senado en JSON.
    El portal oficial del Senado (senado.gob.ar) no tiene API pública.
    """
    items = []
    print(f"  → ArgentinaDatos API...")
    try:
        # Endpoint principal de proyectos del Senado
        r = requests.get(
            "https://api.argentinadatos.com/v1/senado/proyectos",
            headers=HEADERS,
            timeout=30,
        )

        if r.status_code == 200:
            data = r.json()
            # La API puede devolver un array directo o un objeto con clave "data"
            records_list = data if isinstance(data, list) else data.get("data", [])

            for item in records_list:
                fecha = (item.get("fecha") or item.get("fecha_entrada") or "")[:10]
                if not (start_date <= fecha <= end_date):
                    continue
                exp = item.get("expediente") or item.get("numero") or ""
                items.append({
                    "id_raw": exp,
                    "titulo": item.get("titulo") or item.get("descripcion") or "",
                    "autor": (item.get("autor") or item.get("senador") or
                              item.get("firmante") or ""),
                    "bloque": (item.get("bloque") or item.get("partido") or
                               item.get("grupo") or ""),
                    "fecha": fecha,
                    "origen": "Cámara de Senadores",
                    "link": (item.get("url") or item.get("link") or
                             f"https://www.senado.gob.ar/parlamentario/proyectos/"),
                    "texto": (item.get("resumen") or item.get("titulo") or "")[:3000],
                    "es_aprobado": False,
                    "exp_parlamentario": "",
                })
        else:
            print(f"  ⚠️  ArgentinaDatos respondió HTTP {r.status_code}.")

    except Exception as e:
        print(f"  ❌ Error scraping Senado: {e}")

    print(f"  📋 Senado: {len(items)} proyectos en el rango.")
    return items


def scrape_bora(start_date: str, end_date: str) -> list:
    """
    Fuente: https://www.boletinoficial.gob.ar/
    BORA no tiene API ni RSS oficial. Se realiza scraping HTML por fecha.
    Notas:
      - El BORA carga parte del contenido con JavaScript, pero el sumario
        del día es accesible mediante la URL de búsqueda por fecha.
      - Los decretos del PEN frecuentemente citan expedientes internos
        (EX-YYYY-NNNNN-APN-...) en lugar del expediente parlamentario.
      - Se implementa regex para capturar expedientes parlamentarios cuando
        están explícitamente mencionados en los considerandos.
    """
    items = []
    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date, "%Y-%m-%d")
    current = start_dt

    while current <= end_dt:
        if current.weekday() >= 5:  # Saltar sábado (5) y domingo (6)
            current += timedelta(days=1)
            continue

        fecha_str = current.strftime("%d/%m/%Y")
        fecha_iso = current.strftime("%Y-%m-%d")

        try:
            # URL del sumario de búsqueda diaria del BORA
            search_url = (
                "https://www.boletinoficial.gob.ar/busqueda/publicaciones"
                f"?seccion=&palabras=&desde={fecha_str}&hasta={fecha_str}"
            )
            r = requests.get(search_url, headers=HEADERS, timeout=30)

            if r.status_code == 200:
                soup = BeautifulSoup(r.text, "lxml")

                # El BORA estructura las normas en distintos contenedores según versión
                norms = (soup.select(".aviso-sumario") or
                         soup.select(".item-norma") or
                         soup.select("article.norma") or
                         soup.select(".resultado-busqueda"))

                for norm in norms[:30]:  # Máx 30 normas por día
                    titulo_el = (norm.select_one("h2") or
                                 norm.select_one("h3") or
                                 norm.select_one(".titulo-norma") or
                                 norm.select_one("strong"))
                    link_el = norm.select_one("a[href]")
                    numero_el = (norm.select_one(".numero-norma") or
                                 norm.select_one(".nro-norma"))

                    titulo = titulo_el.get_text(strip=True) if titulo_el else ""
                    link = (
                        f"https://www.boletinoficial.gob.ar{link_el['href']}"
                        if link_el else
                        f"https://www.boletinoficial.gob.ar/#!DetalleAviso/primera/{current.strftime('%Y%m%d')}"
                    )
                    numero = numero_el.get_text(strip=True) if numero_el else ""
                    texto_completo = norm.get_text(separator=" ", strip=True)

                    # Solo procesar resoluciones, decretos y leyes (no edictos ni avisos)
                    tipo_keywords = ["resolución", "decreto", "ley ", "disposición", "decisión administrativa"]
                    if not any(kw in titulo.lower() for kw in tipo_keywords):
                        continue

                    # Buscar referencia a expediente parlamentario en el texto
                    exp_match = re.search(
                        r'(?:Expediente|Exp\.?)\s*[NnNº°#]*\s*'
                        r'(\d{1,5}-[DS]-\d{4})',
                        texto_completo,
                        re.IGNORECASE,
                    )
                    exp_parlamentario = exp_match.group(1).upper() if exp_match else ""

                    bora_id = f"BORA-{fecha_iso}-{numero or str(len(items) + 1).zfill(3)}"

                    items.append({
                        "id_raw": exp_parlamentario or bora_id,
                        "bora_id": bora_id,
                        "titulo": titulo,
                        "autor": "Poder Ejecutivo Nacional",
                        "bloque": "Poder Ejecutivo",
                        "fecha": fecha_iso,
                        "origen": "Boletín Oficial",
                        "link": link,
                        "texto": texto_completo[:3000],
                        "numero_norma": numero,
                        "es_aprobado": True,
                        "exp_parlamentario": exp_parlamentario,
                    })

        except Exception as e:
            print(f"  ⚠️  BORA {fecha_iso}: {e}")

        current += timedelta(days=1)
        time.sleep(1)  # Pausa cortés para no saturar el servidor del BORA

    print(f"  📋 BORA: {len(items)} normas encontradas en el período.")
    return items

# ══════════════════════════════════════════════════════════════════════════════
# ANÁLISIS CON GEMINI 1.5 FLASH
# ══════════════════════════════════════════════════════════════════════════════

def build_prompt(item: dict, config: dict) -> str:
    """Construye el prompt completo para analizar un ítem legislativo."""
    return f"""{config.get('system_instruction', '')}

━━━ OUTPUT SCHEMA ━━━
{json.dumps(config.get('output_schema', {}), ensure_ascii=False, indent=2)}

━━━ CATEGORÍAS DOCTRINALES ━━━
{json.dumps(config.get('doctrinal_categories', {}), ensure_ascii=False, indent=2)}

━━━ REGLAS DEL OBSERVATORIO ━━━
{json.dumps(config.get('observatorio_rules', {}), ensure_ascii=False, indent=2)}

━━━ PALABRAS CLAVE POR INDUSTRIA ━━━
{json.dumps(config.get('industry_keywords', {}), ensure_ascii=False, indent=2)}

━━━ PROYECTO A ANALIZAR ━━━
Expediente/ID:    {item.get('id_raw', 'N/D')}
Origen:           {item.get('origen', 'N/D')}
Título Original:  {item.get('titulo', 'N/D')}
Autor:            {item.get('autor', 'N/D')}
Bloque Político:  {item.get('bloque', 'N/D')}
Fecha:            {item.get('fecha', 'N/D')}
Link Fuente:      {item.get('link', 'N/D')}

Texto del Proyecto (extracto):
{item.get('texto', '')[:3000]}

━━━ INSTRUCCIÓN FINAL ━━━
Devuelve ÚNICAMENTE un objeto JSON válido con exactamente los campos del output_schema.
No incluyas texto, markdown ni explicaciones fuera del JSON.
"""


def analyze_with_gemini(item: dict, config: dict) -> dict | None:
    """Envía el ítem a Gemini API y devuelve el análisis estructurado."""
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-1.5-flash")

        response = model.generate_content(
            build_prompt(item, config),
            generation_config=genai.GenerationConfig(
                temperature=0.15,          # Baja temperatura = mayor rigor
                response_mime_type="application/json",
            ),
        )

        result = json.loads(response.text)
        return result

    except json.JSONDecodeError as e:
        print(f"  ❌ Gemini devolvió JSON inválido: {e}")
        return None
    except Exception as e:
        print(f"  ❌ Error Gemini API: {e}")
        return None

# ══════════════════════════════════════════════════════════════════════════════
# CONSTRUCCIÓN DEL REGISTRO FINAL
# ══════════════════════════════════════════════════════════════════════════════

def _normalize_id(item: dict) -> str:
    """Normaliza el ID del expediente según el formato del maestro."""
    raw = item.get("id_raw", "").strip().upper()

    # Formato parlamentario: NNN-D-YYYY o NNN-S-YYYY
    if re.match(r'^\d+-[DS]-\d{4}$', raw):
        return raw

    # Si es BORA: usar bora_id
    if item.get("bora_id"):
        return item["bora_id"]

    # Fallback
    return raw or f"UNK-{item.get('fecha','0000-00-00')}-{abs(hash(item.get('titulo','')))%9999:04d}"


def build_record(item: dict, analysis: dict) -> dict:
    """Construye el registro completo combinando metadatos y análisis de la IA."""
    rec_id = _normalize_id(item)
    estado = "Aprobado" if item.get("es_aprobado") else "En Debate"

    # Defaults defensivos: si la IA devolvió campos vacíos o inválidos, usar valores por defecto
    def safe(key, default):
        v = analysis.get(key, default)
        return v if v is not None else default

    return {
        "id":                  rec_id,
        "origen":              item.get("origen", ""),
        "estado":              estado,
        "link_fuente":         item.get("link", ""),
        "link_boletin_oficial": item.get("link", "") if estado == "Aprobado" else "",
        "numero_ley":          item.get("numero_norma", "") if estado == "Aprobado" else "",
        "titulo_original":     item.get("titulo", ""),
        "titulo_sintesis":     safe("titulo_sintesis", item.get("titulo", "")[:80]),
        "autor":               item.get("autor", ""),
        "bloque_politico":     item.get("bloque", ""),
        "fecha_inicio":        item.get("fecha", ""),
        "fecha_aprobacion":    item.get("fecha", "") if estado == "Aprobado" else "",
        "comisiones":          safe("comisiones", []),
        "industrias_afectadas": safe("industrias_afectadas", []),
        "analisis_macro":      safe("analisis_macro", {
            "tipo_politica": "", "resumen": "",
            "efectos_sobre_recaudacion": "", "efectos_sobre_empleo": "",
        }),
        "analisis_micro":      safe("analisis_micro", {
            "impacto_costos_operativos": "",
            "barreras_de_entrada": "", "impacto_pymes": "",
        }),
        "clasificacion_doctrinal": safe("clasificacion_doctrinal", {
            "doctrina": "Neutro / Procedimental",
            "descripcion": "", "rumbo_economico_proyectado": "",
        }),
        "criticidad":          safe("criticidad", "Baja"),
        "impacto":             safe("impacto", "Neutral"),
        "resumen_puntos":      safe("resumen_puntos", []),
        "minuta":              safe("minuta", ""),
        "es_absurdo":          bool(safe("es_absurdo", False)),
        "critica_observatorio": safe("critica_observatorio", ""),
        "vinculacion":         "no_aplica" if estado == "Aprobado" else "confirmada",
    }

# ══════════════════════════════════════════════════════════════════════════════
# PIPELINE PRINCIPAL
# ══════════════════════════════════════════════════════════════════════════════

def run_pipeline(start_date: str, end_date: str, is_backfill: bool = False):
    """Orquesta el pipeline completo: scraping → análisis → conciliación → guardado."""
    print(f"\n{'═'*62}")
    print(f"  🇦🇷  EcoLey Alert — Monitor Legislativo Industrial")
    print(f"{'═'*62}")
    print(f"  Rango:  {start_date} → {end_date}")
    print(f"  Modo:   {'Backfill histórico' if is_backfill else 'Actualización diaria'}")
    print(f"{'═'*62}\n")

    if not GEMINI_API_KEY:
        print("❌ Variable de entorno GEMINI_API_KEY no configurada. Saliendo.")
        sys.exit(1)

    # ── Paso 1: Cargar datos existentes y configuración
    config = load_prompt_config()
    records = load_data()
    existing_ids = get_existing_ids(records)
    print(f"📂 Base de datos actual: {len(records)} registros.")

    # ── Paso 2: Scraping de las tres fuentes
    print("\n📡 Scraping de fuentes legislativas...")
    all_items: list[dict] = []

    print("\n[1/3] Cámara de Diputados (datos.hcdn.gob.ar):")
    all_items.extend(scrape_diputados(start_date, end_date))
    time.sleep(2)

    print("\n[2/3] Cámara de Senadores (api.argentinadatos.com):")
    all_items.extend(scrape_senado(start_date, end_date))
    time.sleep(2)

    print("\n[3/3] Boletín Oficial (boletinoficial.gob.ar):")
    all_items.extend(scrape_bora(start_date, end_date))

    print(f"\n📊 Total ítems scrapeados: {len(all_items)}")

    # ── Paso 3: Filtrar ítems del BORA para conciliación primero
    bora_items = [i for i in all_items if i.get("es_aprobado")]
    new_items   = [i for i in all_items if not i.get("es_aprobado")
                   and i.get("id_raw") not in existing_ids]

    print(f"\n🔗 Conciliando {len(bora_items)} normas del BORA con expedientes En Debate...")
    conciliated = 0
    remaining_bora = []
    for item in bora_items:
        if reconcile_bora_item(records, item):
            conciliated += 1
        else:
            remaining_bora.append(item)  # No concilió → registrar como aprobado nuevo
    print(f"  Conciliados: {conciliated} | Sin match: {len(remaining_bora)}")

    # Los BORA que no conciliaron también pasan por Gemini y se guardan como nuevos
    items_to_analyze = new_items + remaining_bora
    print(f"\n✨ Ítems nuevos a analizar con Gemini: {len(items_to_analyze)}")

    if not items_to_analyze:
        print("✅ Sin novedades nuevas. Guardando estado actual.")
        validate_and_save(records)
        return

    # ── Paso 4: Análisis con Gemini (con throttling)
    print(f"\n🧠 Análisis con Gemini 1.5 Flash (throttling: {THROTTLE_SECONDS}s entre llamadas)...")
    new_records = []

    for i, item in enumerate(items_to_analyze, 1):
        titulo_display = item.get("titulo", "")[:65]
        print(f"\n[{i:03d}/{len(items_to_analyze):03d}] {titulo_display}...")
        print(f"         Origen: {item.get('origen')} | Fecha: {item.get('fecha')}")

        analysis = analyze_with_gemini(item, config)
        if not analysis:
            print(f"         ⚠️  Análisis fallido. Saltando.")
            time.sleep(THROTTLE_SECONDS)
            continue

        record = build_record(item, analysis)
        new_records.append(record)

        # Log resumido
        doctrina = record.get("clasificacion_doctrinal", {}).get("doctrina", "N/D")
        obs = "🚨 OBSERVATORIO" if record.get("es_absurdo") else ""
        print(f"         ✅ {record['id']} | {record['criticidad']} | "
              f"{record['impacto']} | {doctrina[:30]} {obs}")

        time.sleep(THROTTLE_SECONDS)

    # ── Paso 5: Guardar con validación de integridad
    final_records = records + new_records
    success = validate_and_save(final_records)

    print(f"\n{'═'*62}")
    if success:
        print(f"  🎉 Pipeline completado.")
        print(f"     Nuevos registros:  {len(new_records)}")
        print(f"     Conciliados BORA:  {conciliated}")
        print(f"     Total en base:     {len(final_records)}")
        print(f"  🔍 Observatorio:     "
              f"{sum(1 for r in new_records if r.get('es_absurdo'))} proyectos inconsistentes.")
    else:
        print("  ❌ ERROR: data.json NO fue modificado (JSON inválido detectado).")
        sys.exit(1)
    print(f"{'═'*62}\n")

# ══════════════════════════════════════════════════════════════════════════════
# PUNTO DE ENTRADA
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="EcoLey Alert — Monitor Legislativo Industrial Argentina",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  # Actualización diaria (ayer → hoy):
  python analyze.py

  # Backfill histórico de Julio 2026:
  python analyze.py --backfill --start-date 2026-07-01 --end-date 2026-07-31

  # Backfill de Junio 2026:
  python analyze.py --backfill --start-date 2026-06-01 --end-date 2026-06-30
        """,
    )
    parser.add_argument(
        "--backfill", action="store_true",
        help="Modo backfill: procesa un rango histórico completo.",
    )
    parser.add_argument(
        "--start-date", type=str,
        default=(datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d"),
        help="Fecha de inicio (YYYY-MM-DD). Defecto: ayer.",
    )
    parser.add_argument(
        "--end-date", type=str,
        default=datetime.now().strftime("%Y-%m-%d"),
        help="Fecha de fin (YYYY-MM-DD). Defecto: hoy.",
    )
    args = parser.parse_args()

    # Validaciones
    try:
        sd = datetime.strptime(args.start_date, "%Y-%m-%d")
        ed = datetime.strptime(args.end_date, "%Y-%m-%d")
    except ValueError:
        print("❌ Formato de fecha inválido. Use YYYY-MM-DD.")
        sys.exit(1)

    if sd > ed:
        print("❌ La fecha de inicio debe ser anterior o igual a la fecha de fin.")
        sys.exit(1)

    delta_days = (ed - sd).days
    if delta_days > 366:
        print("❌ El rango máximo es de 366 días por ejecución para respetar los rate limits.")
        sys.exit(1)

    run_pipeline(args.start_date, args.end_date, is_backfill=args.backfill)


if __name__ == "__main__":
    main()
