/**
 * CFM Scraper — Playwright Bot
 *
 * Extrai dados de médicos diretamente do DOM após você clicar em BUSCAR.
 * Navega automaticamente pelas páginas clicando nos botões de paginação.
 *
 * Uso: npm run scrape:bot
 * Ou:  npm run scrape:bot -- SP
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "../data");

const UF = process.argv[2] || "AC";
const DELAY_BETWEEN_PAGES_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extrai dados dos médicos do DOM da página atual.
 */
async function extractMedicos(page) {
  return await page.evaluate(() => {
    const results = [];
    // Cada card está dentro de .busca-resultado como div.resultado-item
    const cards = document.querySelectorAll(".busca-resultado .card-body");

    cards.forEach((card) => {
      const nome = card.querySelector("h4")?.textContent?.trim() || "";
      if (!nome) return;

      // Pegar todo o texto do card e parsear por labels
      const fullText = card.innerText;
      
      const getField = (label) => {
        const regex = new RegExp(label + "\\s*(.+?)(?:\\n|$)", "i");
        const match = fullText.match(regex);
        return match ? match[1].trim() : "";
      };

      results.push({
        nome,
        crm: getField("CRM:"),
        dataInscricao: getField("Data de Inscrição:"),
        primeiraInscricao: getField("Primeira inscrição na UF:"),
        inscricao: getField("Inscrição:"),
        situacao: getField("Situação:"),
        especialidade: getField("Especialidades/Áreas de Atuação:") || "Sem especialidade",
        outroEstado: getField("Inscrições em outro estado:"),
        endereco: getField("Endereço:"),
        telefone: getField("Telefone:"),
        instituicao: getField("Instituição de Graduação:"),
        anoFormatura: getField("Ano de Formatura:"),
      });
    });

    return results;
  });
}

async function run() {
  console.log("═══════════════════════════════════════════════");
  console.log("  CFM Scraper — Playwright");
  console.log(`  UF: ${UF}`);
  console.log("═══════════════════════════════════════════════\n");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // ─── 1. Navegar ──────────────────────────────────────────────────────────
  console.log("🌐 Abrindo portal CFM...");
  await page.goto("https://portal.cfm.org.br/busca-medicos", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  console.log("  ✓ Página carregada\n");

  // ─── 2. Selecionar UF ───────────────────────────────────────────────────
  console.log(`🗺️  Selecionando UF: ${UF}...`);
  await page.selectOption("#uf", UF);
  console.log("  ✓ UF selecionado\n");

  // ─── 3. Aguardar BUSCAR ─────────────────────────────────────────────────
  console.log("══════════════════════════════════════════════════════════");
  console.log("  🔐 CLIQUE EM BUSCAR (resolve captcha se necessário)");
  console.log("══════════════════════════════════════════════════════════\n");
  console.log("  ⏳ Aguardando resultados...");

  // Esperar até que ".busca-resultado" tenha conteúdo visível
  await page.waitForSelector(".busca-resultado .card-body", { timeout: 120000 });
  console.log("  ✓ Resultados detectados!\n");

  // Pegar total de registros
  const totalText = await page.textContent("#resultados");
  const totalMatch = totalText.match(/(\d+)\s*registros/);
  const totalRegistros = totalMatch ? parseInt(totalMatch[1], 10) : 0;
  const totalPages = Math.ceil(totalRegistros / 10);

  console.log(`🎯 ${totalRegistros} registros em ${totalPages} páginas.`);
  console.log("🔄 Extraindo dados...\n");

  // ─── 4. Capturar página a página ────────────────────────────────────────
  const allMedicos = [];

  // Página 1
  const firstPage = await extractMedicos(page);
  allMedicos.push(...firstPage);
  console.log(`  ✓ Página 1: ${firstPage.length} médicos`);

  if (firstPage.length === 0) {
    console.log("  ⚠️  Nenhum dado extraído da página 1. Debug:");
    const buscaRes = await page.locator(".busca-resultado").count();
    const cardBodyCount = await page.locator(".busca-resultado .card-body").count();
    const h4Count = await page.locator(".busca-resultado .card-body h4").count();
    console.log(`     .busca-resultado: ${buscaRes}`);
    console.log(`     .card-body: ${cardBodyCount}`);
    console.log(`     h4: ${h4Count}`);
    
    // Última tentativa: pegar o innerText do primeiro card-body
    if (cardBodyCount > 0) {
      const firstCardText = await page.locator(".busca-resultado .card-body").first().innerText();
      console.log(`     Primeiro card text: ${firstCardText.substring(0, 200)}`);
    }
  }

  // Páginas seguintes
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  for (let pg = 2; pg <= totalPages; pg++) {
    await sleep(DELAY_BETWEEN_PAGES_MS);

    try {
      // Tentar clicar na página via seletor direto
      const pageButton = page.locator(
        `#paginacao .paginationjs-page[data-num="${pg}"] a`
      );

      if ((await pageButton.count()) > 0) {
        await pageButton.click({ force: true, timeout: 10000 });
      } else {
        // Botão não visível no DOM — usar JS para disparar a paginação
        const clicked = await page.evaluate((pageNum) => {
          // O plugin paginationjs usa callback — simular clique via jQuery
          if (window.jQuery && window.jQuery('#paginacao').data('pagination')) {
            window.jQuery('#paginacao').pagination('go', pageNum);
            return true;
          }
          // Fallback: procurar e clicar qualquer elemento com data-num
          const el = document.querySelector(`[data-num="${pageNum}"] a`);
          if (el) { el.click(); return true; }
          return false;
        }, pg);

        if (!clicked) {
          console.log(`  ⚠️  Página ${pg} não acessível — tentando próxima...`);
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.log(`  ❌ ${MAX_CONSECUTIVE_ERRORS} erros seguidos — parando.`);
            break;
          }
          continue;
        }
      }

      // Esperar carregamento
      try {
        await sleep(2000);
        await page.waitForSelector(".busca-resultado .card-body", { timeout: 15000 });
        await sleep(1000);
      } catch {
        console.log(`  ⚠️  Timeout carregando página ${pg} — pulando...`);
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log(`  ❌ ${MAX_CONSECUTIVE_ERRORS} erros seguidos — parando.`);
          break;
        }
        continue;
      }

      const pageData = await extractMedicos(page);

      if (pageData.length === 0) {
        console.log(`  ⚠️  Página ${pg} sem dados — pulando...`);
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.log(`  ❌ ${MAX_CONSECUTIVE_ERRORS} erros seguidos — parando.`);
          break;
        }
        continue;
      }

      // Sucesso — resetar contador de erros
      consecutiveErrors = 0;
      allMedicos.push(...pageData);

      if (pg % 10 === 0 || pg <= 3) {
        console.log(`  ✓ Página ${pg}/${totalPages} — ${allMedicos.length} total`);
      }

      // Salvar progresso a cada 10 páginas
      if (pg % 10 === 0) {
        const partial = path.join(OUTPUT_DIR, `medicos_${UF}_partial.json`);
        fs.writeFileSync(partial, JSON.stringify(allMedicos, null, 2), "utf-8");
      }
    } catch (err) {
      console.log(`  ⚠️  Erro na página ${pg}: ${err.message.substring(0, 60)} — continuando...`);
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log(`  ❌ ${MAX_CONSECUTIVE_ERRORS} erros seguidos — parando.`);
        break;
      }
      continue;
    }
  }

  // ─── 5. Salvar ──────────────────────────────────────────────────────────
  const outputFile = path.join(OUTPUT_DIR, `medicos_${UF}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(allMedicos, null, 2), "utf-8");

  const partial = path.join(OUTPUT_DIR, `medicos_${UF}_partial.json`);
  if (fs.existsSync(partial)) fs.unlinkSync(partial);

  console.log("\n═══════════════════════════════════════════════");
  console.log("  ✅ Concluído!");
  console.log(`  📊 Total: ${allMedicos.length} médicos`);
  console.log(`  📁 Salvo: ${outputFile}`);
  console.log("═══════════════════════════════════════════════\n");

  await sleep(3000);
  await browser.close();
}

run().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
