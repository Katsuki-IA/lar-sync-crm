import type { JourneyFunnelCounts } from "@/lib/journey-funnel";

type JourneyReportImageInput = {
  companyName: string;
  empreendimentoName: string;
  typeLabel: string;
  dateFrom: string;
  dateTo: string;
  counts: JourneyFunnelCounts;
};

const WIDTH = 1200;
const HEIGHT = 860;
const ORANGE = "#C14F21";
const GREEN = "#2D7D52";
const TRACK = "#F2F3F5";

function brDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function crop(value: string, max = 48) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Produz um PNG simples e consistente, sem capturar a tela do usuário. */
export async function createJourneyFunnelReportImage(input: JourneyReportImageInput) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível gerar a imagem do relatório.");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, 0, WIDTH, 12);

  ctx.fillStyle = "#121212";
  ctx.font = "700 42px Arial, sans-serif";
  ctx.fillText("Análise de Funil", 72, 92);
  ctx.fillStyle = "#59636E";
  ctx.font = "400 24px Arial, sans-serif";
  ctx.fillText(crop(`${input.companyName} · ${input.empreendimentoName} · ${input.typeLabel}`), 72, 132);
  ctx.fillText(`${brDate(input.dateFrom)} a ${brDate(input.dateTo)}`, 72, 166);

  const metrics = [
    ["Leads recebidos", input.counts.received, ORANGE],
    ["Interagiram com a IA", input.counts.engaged, ORANGE],
    ["Leads quentes", input.counts.hot, ORANGE],
    ["Enviados ao corretor / CRM", input.counts.sentToCrm, GREEN],
    ["Visitas agendadas", input.counts.scheduled, GREEN],
  ] as const;
  const total = input.counts.received;
  const startX = 72;
  const endX = WIDTH - 72;
  const trackWidth = endX - startX;
  const startY = 250;
  const rowHeight = 112;

  metrics.forEach(([label, value, color], index) => {
    const y = startY + index * rowHeight;
    const percent = total ? Math.round((value / total) * 100) : 0;
    ctx.fillStyle = "#171717";
    ctx.font = "600 27px Arial, sans-serif";
    ctx.fillText(label, startX, y);
    ctx.textAlign = "right";
    ctx.font = "600 26px Arial, sans-serif";
    ctx.fillText(`${value} · ${percent}%`, endX, y);
    ctx.textAlign = "left";

    const barY = y + 34;
    ctx.fillStyle = TRACK;
    ctx.beginPath();
    ctx.roundRect(startX, barY, trackWidth, 12, 6);
    ctx.fill();
    if (percent) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(startX, barY, Math.max(12, trackWidth * Math.min(percent, 100) / 100), 12, 6);
      ctx.fill();
    }
  });

  ctx.strokeStyle = "#E8EAED";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(72, 786);
  ctx.lineTo(WIDTH - 72, 786);
  ctx.stroke();
  ctx.fillStyle = "#737B84";
  ctx.font = "400 20px Arial, sans-serif";
  ctx.fillText("Relatório gerado pelo Katsuki HUB", 72, 824);

  return canvas.toDataURL("image/png");
}
