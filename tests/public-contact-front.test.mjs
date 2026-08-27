import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WHATSAPP_NUMBER = "5537998300516";
const INDEX_PATH = new URL("../index.html", import.meta.url);
const CAREERS_PATH = new URL("../trabalhe-conosco.html", import.meta.url);
const CONTACT_SCRIPT_PATH = new URL("../assets/public-contact.js", import.meta.url);
const CONTACT_STYLES_PATH = new URL("../assets/public-contact.css", import.meta.url);
const ACCOUNT_SCRIPT_PATH = new URL("../assets/public-account.js", import.meta.url);

async function read(path) {
  return readFile(path, "utf8");
}

test("pagina inicial troca o cadastro publico por contato direto no WhatsApp", async () => {
  const html = await read(INDEX_PATH);
  const contactSection = html.match(/<section\b[^>]*\bid=["']contato["'][^>]*>([\s\S]*?)<\/section>/i);

  assert.ok(contactSection, "a secao de contato deve continuar presente");
  assert.doesNotMatch(contactSection[1], /<form\b|openLeadForm|leadFormBox/i);
  assert.match(contactSection[1], /Entrar em contato via WhatsApp/i);
  assert.match(contactSection[1], new RegExp(`href=["']https:\\/\\/wa\\.me\\/${WHATSAPP_NUMBER}(?:\\?[^"']*)?["']`, "i"));
  assert.match(contactSection[1], /aria-label=["'][^"']*WhatsApp[^"']*["']/i);
});

test("Trabalhe Conosco oferece somente area e historico profissional", async () => {
  const html = await read(CAREERS_PATH);
  const form = html.match(/<form\b[^>]*\bid=["']careerForm["'][^>]*>([\s\S]*?)<\/form>/i);

  assert.ok(form, "o formulario profissional deve continuar presente");
  assert.match(form[1], /<label\b[^>]*for=["']careerArea["'][^>]*>\s*Área de atuação\s*<\/label>/i);
  assert.match(form[1], /<select\b[^>]*\bid=["']careerArea["'][^>]*\brequired\b/i);
  assert.match(form[1], /<label\b[^>]*for=["']careerHistory["'][^>]*>\s*Histórico de atuação profissional\s*<\/label>/i);
  assert.match(form[1], /<textarea\b[^>]*\bid=["']careerHistory["'][^>]*\brequired\b/i);
  assert.equal((form[1].match(/<(?:input|select|textarea)\b/gi) || []).length, 2);
  assert.match(form[1], /Entrar em contato via WhatsApp/i);
});

test("paginas publicas compartilham os recursos responsivos de contato", async () => {
  const [index, careers, styles, accountScript] = await Promise.all([
    read(INDEX_PATH),
    read(CAREERS_PATH),
    read(CONTACT_STYLES_PATH),
    read(ACCOUNT_SCRIPT_PATH),
  ]);

  for (const html of [index, careers]) {
    assert.match(html, /assets\/public-contact\.css/i);
    assert.match(html, /assets\/public-contact\.js/i);
    assert.match(html, /portal\/vendor\/msal-browser-5\.19\.0\.min\.js/i);
    assert.match(html, /assets\/public-account\.js/i);
    assert.doesNotMatch(html, /supabase|cdn\.jsdelivr\.net/i);
  }

  assert.match(styles, /@media\s*\([^)]*max-width/i);
  assert.match(styles, /:focus-visible/i);
  assert.match(styles, /\.public-account\b/i);
  assert.match(accountScript, /createPublicAccountController/);
});

test("cabecalho reserva uma conta Microsoft discreta sem substituir o acesso administrativo", async () => {
  const pages = await Promise.all([read(INDEX_PATH), read(CAREERS_PATH)]);

  for (const html of pages) {
    assert.match(html, /data-public-account[^>]*\bhidden\b/i);
    assert.match(html, /data-public-account-name/i);
    assert.match(html, /data-public-account-email/i);
    assert.match(html, /data-public-account-signout[^>]*>\s*Sair\s*</i);
    assert.match(html, /href=["']admin\.html["'][^>]*>\s*Área administrativa\s*</i);
  }
});

test("agrupamentos rotulados declaram semantica acessivel", async () => {
  const pages = await Promise.all([read(INDEX_PATH), read(CAREERS_PATH)]);

  for (const html of pages) {
    const invalidGroups = html.match(/<div\b(?=[^>]*\baria-label=)(?![^>]*\brole=)[^>]*>/gi) || [];
    assert.deepEqual(invalidGroups, []);
  }
});

test("mensagem profissional usa o numero institucional e preserva texto livre", async () => {
  const source = await read(CONTACT_SCRIPT_PATH);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const { buildCareerWhatsAppUrl, COMPANY_WHATSAPP_NUMBER } = await import(moduleUrl);

  assert.equal(COMPANY_WHATSAPP_NUMBER, WHATSAPP_NUMBER);
  const url = buildCareerWhatsAppUrl({
    area: "Engenharia / obras",
    history: "Atuei 4 anos em planejamento e controle de obras.",
  });
  const parsed = new URL(url);
  const message = parsed.searchParams.get("text");

  assert.equal(`${parsed.hostname}${parsed.pathname}`, `wa.me/${WHATSAPP_NUMBER}`);
  assert.match(message, /Área de atuação: Engenharia \/ obras/);
  assert.match(message, /Histórico de atuação profissional: Atuei 4 anos em planejamento e controle de obras\./);
});
