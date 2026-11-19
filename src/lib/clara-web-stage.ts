// Web-only consent gate. Contact capture never advances the conversation to booking.
type Turn = { role: "user" | "assistant"; content: string };
const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const meeting = /\b(reuniao|call|demonstracao|conversa ao vivo)\b/;
const request = /\b(quero|gostaria|podemos|vamos|pode|posso|preciso|prefiro)\b.{0,35}\b(agendar|marcar|reservar|reagendar|remarcar)\b|\b(agende|marque|reagende|remarque)\b/;
const refusal = /\b(nao|nem|depois|talvez|pensar|cancelar|cancela|desmarcar)\b/;
const acceptance = /^(sim|quero|pode ser|pode|vamos|vamos sim|bora|claro|combinado|fechado|tenho interesse)[.!\s]*$/;
const directRequest = (s: string) => request.test(s)
  && !/\b(como|se|cliente|paciente|exemplo)\b/.test(s)
  && (meeting.test(s) || /^(quero|gostaria de|podemos|vamos|pode|posso|preciso|prefiro)\s+(agendar|marcar|reagendar|remarcar)[.!?\s]*$/.test(s));

export function webCancellationRequested(history: Turn[]): boolean {
  const last = history.at(-1);
  return last?.role === "user" && /\b(cancelar|cancela|cancele|desmarcar|desmarca)\b/.test(plain(last.content)) && !/\bnao\b/.test(plain(last.content));
}

function meetingInvitation(text: string): boolean {
  // Only the last question owns a short answer. The opening mentions a future
  // meeting but its question is "Como você se chama?", not a booking invitation.
  const question = plain(text).match(/[^.!?\n]*\?\s*$/)?.[0] ?? "";
  return meeting.test(question) && /\b(quer|gostaria|vamos|podemos|posso|faz sentido|topa|interesse)\b/.test(question);
}

export function webBookingAccepted(history: Turn[]): boolean {
  let accepted = false;
  let previousAssistant = "";
  for (const turn of history) {
    if (turn.role === "assistant") { previousAssistant = turn.content; continue; }
    const message = plain(turn.content);
    if (refusal.test(message) && (meeting.test(message) || request.test(message) || meetingInvitation(previousAssistant) || /^(nao|agora nao|mais tarde|depois)[.!\s]*$/.test(message))) {
      accepted = false;
    } else if (!refusal.test(message) && (directRequest(message) || (acceptance.test(message) && meetingInvitation(previousAssistant)))) {
      accepted = true;
    }
    // Two consecutive user messages cannot both be answers to an old invitation.
    previousAssistant = "";
  }
  return accepted;
}

export function webStageNote(history: Turn[]): string {
  return webBookingAccepted(history)
    ? "Etapa do chat web: visitante pediu/aceitou agendamento. Continue a agenda sem recomeçar qualificação; peça apenas os dados que faltam."
    : "Etapa do chat web: descoberta/demonstração, sem aceite de reunião. Nome, telefone, e-mail e interesse em conhecer a IA NÃO são aceite de reunião. Não consulte nem ofereça horários. Após o nome, pergunte o segmento se ainda faltar. Demonstre a solução no negócio informado e entenda a necessidade antes de convidar para reunião. Se o visitante pedir agenda de forma ambígua, pergunte se quer marcar uma reunião; aguarde a resposta.";
}
