/**
 * CFM Scraper — Etapa 1: Teste com requests HTTP diretas
 *
 * Tenta buscar médicos do portal CFM usando a API REST diretamente.
 * Se a API bloquear (captcha obrigatório), precisaremos de Puppeteer (Etapa 2).
 *
 * Uso: npm run scrape
 */

import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "../data");

// Configuração
const UF = "AC"; // Estado para buscar
const PAGE_SIZE = 10;
const DELAY_MIN_MS = 3000; // 3s mínimo entre requests
const DELAY_MAX_MS = 6000; // 6s máximo entre requests
const MAX_PAGES = 100; // Limite de segurança

const API_URL =
  "https://portal.cfm.org.br/api_rest_php/api/v2/medicos/buscar_medicos";

const HEADERS = {
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  Connection: "keep-alive",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  Origin: "https://portal.cfm.org.br",
  Referer: "https://portal.cfm.org.br/busca-medicos",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  "sec-ch-ua":
    '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

// Cookies de sessão (pegar do navegador — expira rápido)
const COOKIES =
  "PHPSESSID=85d58c20196ba28f69b8f4470c5e0062; cookie-banner=1";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  return DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
}

function buildPayload(pageNumber, captchaToken = "") {
  return JSON.stringify([
    {
      useCaptchav2: true,
      captcha: captchaToken,
      medico: {
        nome: "",
        ufMedico: UF,
        crmMedico: "",
        municipioMedico: "",
        tipoInscricaoMedico: "",
        situacaoMedico: "",
        detalheSituacaoMedico: "",
        especialidadeMedico: "",
        areaAtuacaoMedico: "",
      },
      page: pageNumber,
      pageNumber: pageNumber,
      pageSize: PAGE_SIZE,
    },
  ]);
}

async function fetchPage(pageNumber, captchaToken = "") {
  const payload = buildPayload(pageNumber, captchaToken);

  try {
    const response = await axios.post(API_URL, payload, {
      headers: {
        ...HEADERS,
        Cookie: COOKIES,
      },
      timeout: 15000,
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      console.error(
        `  ❌ HTTP ${error.response.status}: ${JSON.stringify(error.response.data).substring(0, 200)}`,
      );
    } else {
      console.error(`  ❌ Network error: ${error.message}`);
    }
    return null;
  }
}

async function run() {
  console.log("═══════════════════════════════════════════════");
  console.log("  CFM Scraper — Etapa 1 (Request Direto)");
  console.log(`  UF: ${UF} | PageSize: ${PAGE_SIZE}`);
  console.log("═══════════════════════════════════════════════");
  console.log("");

  // Ensure output dir exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const allMedicos = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= MAX_PAGES) {
    console.log(`📄 Página ${page}...`);

    const data = await fetchPage(page);

    if (!data) {
      console.log("  ⚠️  Sem resposta — parando.");
      break;
    }

    // A resposta pode ser um array ou objeto com dados
    let medicos = [];
    if (Array.isArray(data)) {
      medicos = data;
    } else if (data.dados) {
      medicos = data.dados;
    } else if (data.medicos) {
      medicos = data.medicos;
    } else if (data.resultado) {
      medicos = data.resultado;
    } else {
      // Log para entender a estrutura
      console.log(
        "  📋 Estrutura da resposta:",
        JSON.stringify(data).substring(0, 300),
      );
      break;
    }

    if (medicos.length === 0) {
      console.log("  ✓ Nenhum resultado — fim dos dados.");
      hasMore = false;
      break;
    }

    console.log(`  ✓ ${medicos.length} médicos encontrados`);
    allMedicos.push(...medicos);

    // Se retornou menos que PAGE_SIZE, é a última página
    if (medicos.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      const delay = randomDelay();
      console.log(
        `  ⏳ Aguardando ${(delay / 1000).toFixed(1)}s antes da próxima...`,
      );
      await sleep(delay);
    }
  }

  // Salvar resultados
  const outputFile = path.join(OUTPUT_DIR, `medicos_${UF}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(allMedicos, null, 2), "utf-8");

  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log(`  ✅ Concluído!`);
  console.log(`  📊 Total: ${allMedicos.length} médicos`);
  console.log(`  📁 Salvo em: ${outputFile}`);
  console.log("═══════════════════════════════════════════════");
}

run().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
