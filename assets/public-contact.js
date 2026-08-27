export const COMPANY_WHATSAPP_NUMBER = "5537998300516";

export function buildWhatsAppUrl(message) {
  const text = String(message || "").trim();
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${COMPANY_WHATSAPP_NUMBER}${query}`;
}

export function buildCareerWhatsAppUrl({ area, history } = {}) {
  const selectedArea = String(area || "").trim();
  const professionalHistory = String(history || "").trim();
  const message = [
    "Olá, quero entrar em contato sobre oportunidades na Energética Construções.",
    "",
    `Área de atuação: ${selectedArea}`,
    `Histórico de atuação profissional: ${professionalHistory}`,
  ].join("\n");

  return buildWhatsAppUrl(message);
}

function initializeCareerForm() {
  const form = document.getElementById("careerForm");
  if (!form) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const area = document.getElementById("careerArea")?.value;
    const history = document.getElementById("careerHistory")?.value;
    const status = document.getElementById("careerStatus");
    const destination = buildCareerWhatsAppUrl({ area, history });

    if (status) status.textContent = "Abrindo o WhatsApp para continuar seu contato.";
    window.open(destination, "_blank", "noopener,noreferrer");
  });
}

if (typeof document !== "undefined") {
  initializeCareerForm();
}
