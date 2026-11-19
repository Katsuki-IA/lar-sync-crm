// Guard determinístico de agenda (Retorna Data válida, versão 42eeaf3d), adaptado
// a TypeScript sem mudar a lógica. Só servidor. Nenhuma mutação aqui: o resultado
// apenas autoriza (ou não) a chamada a web_chat_schedule com dia/hora resolvidos.
/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const */

export type Turn = { type: "human" | "ai"; text: string; at: string };
export type GuardContext = {
  recent_turns?: Turn[]; server_now: string; booking_rules: { tz: string; slot_minutes: number };
  last_assistant?: string; last_assistant_at?: string;
};

export function nowInTZ(tz = "America/Sao_Paulo", clock = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(clock);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const yyyy = get("year"), mm = get("month"), dd = get("day");
  const hh = get("hour"), mi = get("minute"), ss = get("second");
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`);
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function formatYMD(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(d: Date, days: number) { const x = new Date(d); x.setDate(x.getDate() + days); return x; }
function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

export function normalizePt(s: unknown) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function dowFromPtWord(sNorm: string) {
  const map = [
    { re: /\b(domingo|dom)\b/, dow: 0 },
    { re: /\b(seg(unda)?(-feira)?|segunda(-feira)?)\b/, dow: 1 },
    { re: /\b(ter(ca)?(-feira)?|terca(-feira)?|ter)\b/, dow: 2 },
    { re: /\b(qua(rta)?(-feira)?|quarta(-feira)?|qua)\b/, dow: 3 },
    { re: /\b(qui(nta)?(-feira)?|quinta(-feira)?|qui)\b/, dow: 4 },
    { re: /\b(sex(ta)?(-feira)?|sexta(-feira)?|sex)\b/, dow: 5 },
    { re: /\b(sab(ado)?|sabado)\b/, dow: 6 },
  ];
  for (const x of map) if (x.re.test(sNorm)) return x.dow;
  return null;
}
function hasQualifierNextWeek(s: string) { return /\b(semana que vem|proxima semana|da proxima|na proxima|proxima|que vem)\b/.test(s); }
function hasQualifierThisWeek(s: string) { return /\b(dessa semana|esta semana|nessa semana|da semana)\b/.test(s); }
function hasQualifierTwoWeeks(s: string) { return /\b(daqui\s*(a\s*)?(duas|2)\s*semanas?|duas\s*semanas)\b/.test(s); }

function nextOccurrenceFrom(now: Date, targetDow: number, { allowToday = true } = {}) {
  const today = startOfDay(now);
  const dow = today.getDay();
  let delta = (targetDow - dow + 7) % 7;
  if (!allowToday && delta === 0) delta = 7;
  return addDays(today, delta);
}

export function parseHoraRaw(horaRaw: unknown, nowForAgora: Date | null = null): { hh: number; mm: number; hhmm: string } | null {
  if (!horaRaw) return null;
  let s = String(horaRaw).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  s = s.replace(/^(as|para as|pelas?)\s+/i, "");
  if (/\b(agora|agorinha|ja|já)\b/.test(s) && nowForAgora) {
    const hh = nowForAgora.getHours(); const mm = nowForAgora.getMinutes();
    return { hh, mm, hhmm: `${pad2(hh)}:${pad2(mm)}` };
  }
  if (/^meio[- ]?dia$/.test(s)) return { hh: 12, mm: 0, hhmm: "12:00" };
  if (/^meia[- ]?noite$/.test(s)) return { hh: 0, mm: 0, hhmm: "00:00" };
  let periodo: string | null = null;
  const periodoMatch = s.match(/\b(da\s+)?(manha|tarde|noite|madrugada)\b/);
  if (periodoMatch) periodo = periodoMatch[2];
  s = s.replace(/\b(da\s+)?(manha|tarde|noite|madrugada)\b/g, "").replace(/\s+/g, " ").trim();
  let hh: number | null = null; let mm = 0;
  let m = s.match(/^(\d{1,2}):(\d{2})\s*(h|hs|hr|hrs|horas?)?$/);
  if (m) { hh = Number(m[1]); mm = Number(m[2]); }
  if (hh === null) { m = s.match(/^(\d{1,2})\s*h\s*(\d{2})$/); if (m) { hh = Number(m[1]); mm = Number(m[2]); } }
  if (hh === null) { m = s.match(/^(\d{1,2})\s*(h|hs|hr|hrs|horas?)$/); if (m) { hh = Number(m[1]); mm = 0; } }
  if (hh === null) { m = s.match(/^(\d{1,2})$/); if (m) { hh = Number(m[1]); mm = 0; } }
  if (hh === null || !Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (periodo && hh >= 1 && hh <= 12) {
    if (periodo === "tarde" && hh >= 1 && hh <= 6) hh += 12;
    else if (periodo === "noite") { if (hh >= 7 && hh <= 11) hh += 12; else if (hh === 12) hh = 0; }
    else if (periodo === "madrugada" && hh === 12) hh = 0;
  }
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm, hhmm: `${pad2(hh)}:${pad2(mm)}` };
}

function diaSemanaIndexFromYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function parseDataRawToYMD(dataRaw: unknown, now: Date): string | null {
  if (!dataRaw) return null;
  const sNorm = normalizePt(dataRaw);
  const sClean = sNorm
    .replace(/\b(próximo|proximo|próxima|proxima|que vem|da proxima|na proxima)\b/g, "")
    .replace(/\b(desse mes|deste mes|do mes|neste mes|nesse mes)\b/g, "desse mes")
    .replace(/\s+/g, " ").trim();
  const base = startOfDay(now);
  const mk = (yy: number, mm: number, dd: number) => new Date(yy, mm - 1, dd);
  function validDateParts(yy: number, mm: number, dd: number) {
    const dt = mk(yy, mm, dd);
    return dt.getFullYear() === yy && dt.getMonth() + 1 === mm && dt.getDate() === dd;
  }
  function resolveDayMonthYear(day: number, monthMaybe: number | null, yearMaybe: number | null) {
    if (day < 1 || day > 31) return null;
    if (monthMaybe != null && (monthMaybe < 1 || monthMaybe > 12)) return null;
    let y = yearMaybe ?? base.getFullYear();
    let m = monthMaybe ?? base.getMonth() + 1;
    if (monthMaybe == null && yearMaybe == null) {
      let dt = mk(y, m, day);
      if (!validDateParts(y, m, day)) return null;
      if (dt < base) {
        m += 1; if (m === 13) { m = 1; y += 1; }
        dt = mk(y, m, day);
        if (!validDateParts(y, m, day)) return null;
      }
      return formatYMD(dt);
    }
    if (monthMaybe != null && yearMaybe == null) {
      let dt = mk(y, m, day);
      if (!validDateParts(y, m, day)) return null;
      if (dt < base) { y += 1; dt = mk(y, m, day); if (!validDateParts(y, m, day)) return null; }
      return formatYMD(dt);
    }
    if (monthMaybe != null && yearMaybe != null) {
      if (!validDateParts(y, m, day)) return null;
      return formatYMD(mk(y, m, day));
    }
    return null;
  }
  let m = sClean.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (!validDateParts(y, mo, d)) return null;
    const resolved = formatYMD(mk(y, mo, d));
    const statedDow = dowFromPtWord(sNorm);
    if (statedDow !== null && diaSemanaIndexFromYMD(resolved) !== statedDow) return null;
    return resolved;
  }
  m = sClean.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (m) {
    const resolved = resolveDayMonthYear(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null);
    if (!resolved) return null;
    const statedDow = dowFromPtWord(sNorm);
    if (statedDow !== null && diaSemanaIndexFromYMD(resolved) !== statedDow) return null;
    return resolved;
  }
  if (/\b(agora|agorinha|ja|já)\b/.test(sClean)) return formatYMD(base);
  if (sClean === "hoje") return formatYMD(base);
  if (sClean === "amanha") return formatYMD(addDays(base, 1));
  if (sClean === "depois de amanha") return formatYMD(addDays(base, 2));
  m = sClean.match(/^(?:dia\s*)?(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{4}))?)?(?:\s+desse\s+mes)?$/);
  if (m) return resolveDayMonthYear(Number(m[1]), m[2] !== undefined ? Number(m[2]) : null, m[3] !== undefined ? Number(m[3]) : null);
  const monthMap: Record<string, number> = {
    jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, março: 3, marco: 3, abr: 4, abril: 4, mai: 5, maio: 5,
    jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8, set: 9, setembro: 9, out: 10, outubro: 10,
    nov: 11, novembro: 11, dez: 12, dezembro: 12,
  };
  m = sClean.match(/^(?:dia\s*)?(\d{1,2})\s*(?:de\s+)?([a-zç]+)(?:\s+de\s+(\d{4}))?$/);
  if (m) {
    const mo = monthMap[m[2]];
    if (!mo) return null;
    return resolveDayMonthYear(Number(m[1]), mo, m[3] !== undefined ? Number(m[3]) : null);
  }
  const targetDow = dowFromPtWord(sNorm);
  if (targetDow !== null) {
    const thisWeek = hasQualifierThisWeek(sNorm);
    const nextWeek = hasQualifierNextWeek(sNorm);
    let dt = nextOccurrenceFrom(now, targetDow, { allowToday: true });
    const twoWeeks = hasQualifierTwoWeeks(sNorm);
    if (twoWeeks) {
      const today = startOfDay(now); const todayDow = today.getDay();
      const daysToNextMonday = todayDow === 0 ? 1 : 8 - todayDow;
      const mondayIn2Weeks = addDays(today, daysToNextMonday + 7);
      dt = addDays(mondayIn2Weeks, targetDow === 0 ? 6 : targetDow - 1);
    } else if (nextWeek) {
      const today = startOfDay(now); const todayDow = today.getDay();
      const daysToNextMonday = todayDow === 0 ? 1 : 8 - todayDow;
      dt = addDays(addDays(today, daysToNextMonday), targetDow === 0 ? 6 : targetDow - 1);
    } else if (thisWeek) {
      dt = nextOccurrenceFrom(now, targetDow, { allowToday: true });
    }
    return formatYMD(dt);
  }
  return null;
}

function validateScheduleInput(input: any) {
  const x = { ...input, empresa: Number(input.empresa), lead_id: Number(input.lead_id), booking: Number(input.booking || 0), revision: Number(input.revision || 0) };
  if (!Number.isSafeInteger(x.empresa) || x.empresa <= 0 || [35, 36].includes(x.empresa) || !Number.isSafeInteger(x.lead_id) || x.lead_id <= 0) throw Error("COMMERCIAL_SCHEDULE_SCOPE");
  if (!["consultar", "agendar", "reagendar", "cancelar"].includes(x.acao)) throw Error("COMMERCIAL_SCHEDULE_ACTION");
  const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (x.acao === "consultar") { if (x.dia && !validDate(x.dia)) throw Error("COMMERCIAL_SCHEDULE_DATE"); return x; }
  if (x.acao !== "cancelar" && (!validDate(x.dia) || !/^([01]\d|2[0-3]):00$/.test(x.hora))) throw Error("COMMERCIAL_SCHEDULE_SLOT");
  if (["reagendar", "cancelar"].includes(x.acao) && (!Number.isSafeInteger(x.booking) || x.booking <= 0 || !Number.isSafeInteger(x.revision) || x.revision <= 0)) throw Error("COMMERCIAL_SCHEDULE_REVISION");
  if (!String(x.request || "").trim()) throw Error("COMMERCIAL_SCHEDULE_REQUEST");
  x.request_key = JSON.stringify([x.request, x.acao, x.dia || null, x.hora || null, x.booking, x.revision]);
  if (x.request_key.length > 500) throw Error("COMMERCIAL_SCHEDULE_REQUEST");
  return x;
}

// Mensagem crua e respostas anteriores vêm do servidor, nunca do modelo.
function naturalSlots(text: string, tz: string, at: string) {
  const normalized = normalizePt(text);
  const dateTokens = [...normalized.matchAll(/\b\d{1,2}\/\d{1,2}(?:\/\d{4})?\b(?!\/)|\b\d{4}-\d{2}-\d{2}\b|\bdepois de amanha\b|\bamanha\b|\bhoje\b/g)].map((m) => m[0]);
  const now = nowInTZ(tz, new Date(at));
  const dates = [...new Set(dateTokens.map((d) => parseDataRawToYMD(d, now)).filter(Boolean))] as string[];
  const times = [...normalized.matchAll(/\b((?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?))(?!\d)/g)].map((m) => parseHoraRaw(m[1], now)?.hhmm).filter(Boolean) as string[];
  if (dates.length !== 1) return [];
  return [...new Set(times)].map((time) => ({ date: dates[0], time }));
}

function lastAssistantGroup(context: GuardContext, currentMessage: string) {
  const turns = Array.isArray(context.recent_turns) ? context.recent_turns.slice() : [];
  while (turns.at(-1)?.type === "human" && String(turns.at(-1)!.text).trim() === String(currentMessage).trim()) turns.pop();
  const group: Turn[] = [];
  while (turns.at(-1)?.type === "ai") {
    const t = turns.pop()!, age = Date.parse(context.server_now) - Date.parse(t.at);
    if (!Number.isFinite(age) || age < 0 || age > 86400000) break;
    group.unshift(t);
  }
  return group.length ? { text: group.map((t) => t.text).join("\n\n"), at: group[0].at } : null;
}

function resumeSlotAfterEmail(input: any, context: GuardContext): any {
  if (Number(input.empresa) !== 38 || input.acao !== "agendar") return null;
  const email = String(input.mensagem_atual || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const turns = Array.isArray(context.recent_turns) ? context.recent_turns.slice() : [];
  while (turns.at(-1)?.type === "human" && turns.at(-1)?.text.trim() === email) turns.pop();
  const requests: Turn[] = []; while (turns.at(-1)?.type === "ai") requests.unshift(turns.pop()!);
  const request = requests.length ? { type: "ai", text: requests.map((t) => t.text).join("\n\n") } : null;
  const choice = turns.pop();
  if (request?.type !== "ai" || choice?.type !== "human" || !/e-?mail/i.test(request.text)
    || !/\?/.test(request.text) || !/\b(convite|reuniao|meet)\b/.test(normalizePt(request.text))) return null;
  const age = Date.parse(context.server_now) - Date.parse(choice.at);
  if (!Number.isFinite(age) || age < 0 || age > 86400000) return null;
  const previous = turns.at(-1);
  const replay = resolveScheduleRequest({ ...input, mensagem_atual: choice.text, data_raw: "", hora_raw: "" }, {
    ...context, recent_turns: turns, server_now: choice.at,
    last_assistant: previous?.type === "ai" ? previous.text : "",
    last_assistant_at: previous?.at || choice.at,
  });
  if (!replay.valid) return null;
  return { ...replay, request: input.request, confirmation_source: "prior_customer_choice_before_email" };
}

export function resolveScheduleRequest(input: any, context: GuardContext): any {
  const fail = (reason: string, message: string) => ({ valid: false, outcome: "needs_clarification", reason, customer_message: message, notify: false });
  const x: any = { ...input };
  if (Number(x.empresa) === 38) x.acao = ({ create: "agendar", criar: "agendar" } as Record<string, string>)[x.acao] || x.acao;
  if (Number(input.empresa) === 38 && Array.isArray(context?.recent_turns)) {
    const lastAI = lastAssistantGroup(context, input.mensagem_atual);
    if (lastAI) context = { ...context, last_assistant: lastAI.text, last_assistant_at: lastAI.at };
  }
  const rules = context?.booking_rules;
  if (!rules?.tz || Number(rules.slot_minutes) !== 60) return fail("not_configured", "Preciso confirmar os horários com a equipe.");
  const resumed = resumeSlotAfterEmail(input, context);
  if (resumed) return resumed;
  const now = nowInTZ(rules.tz, new Date(context.server_now));
  const message = String(input.mensagem_atual || "").trim();
  let normalized = normalizePt(Number(x.empresa) === 38 ? message.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim() : message);
  if (Number(x.empresa) === 38) normalized = normalized
    .replace(/\b([01]?\d|2[0-3]):\s*h(?=\s|[.!]|$)/g, "$1h")
    .replace(/\s+(?:fica bom para mim|fica bom pra mim|fica bom|esta bom para mim|funciona para mim)[.!]*$/, "");
  const last = String(context.last_assistant || "");
  const offerDate = Number(x.empresa) === 38 ? "\\d{2}/\\d{2}(?:/\\d{4})?" : "\\d{2}/\\d{2}/\\d{4}";
  const yes = /^(sim|confirmo|confirmado|pode confirmar|pode agendar|pode marcar|fechado|combinado|isso|perfeito)(\b|[,.!])/i.test(normalized);
  const negative = /\b(nao|cancel|desmarc|mas|porem|talvez)\b/.test(normalized);
  let rawDate = String(x.data_raw || "").trim(), rawTime = String(x.hora_raw || "").trim();
  const literal = (span: string, text: string) => {
    if (!span) return false;
    const needle = normalizePt(span).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9/:])" + needle + "($|[^a-z0-9/:])").test(normalizePt(text));
  };
  if (x.acao === "cancelar") {
    if (!/\b(cancelar|cancela|cancele|desmarcar|desmarca|desmarque)\b/.test(normalized) || /\b(nao|talvez)\b/.test(normalized)) return fail("confirmation_required", "Você confirma que deseja cancelar a reunião?");
  } else if (x.acao !== "consultar") {
    let selected = false;
    if (Number(x.empresa) === 38 && !negative) {
      const direct = normalized.match(/^(?:(?:pode ser|quero|prefiro|escolho|pode agendar|pode marcar|confirmo|vamos agendar|vamos marcar)\s+)?(?:para\s+)?(amanha|hoje|depois de amanha|\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s*(?:as|,)?\s*((?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?))[.!]*$/);
      if (direct) { rawDate = direct[1]; rawTime = direct[2]; selected = true; }
    }
    if (Number(x.empresa) === 38 && !negative) {
      const command = normalized.match(/^(?:pode agendar|pode marcar|pode confirmar|quero agendar|quero marcar|confirmo|vamos agendar|vamos marcar)\s+(?:(?:para|no|o)\s+)?(?:dia\s+)?(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s+(?:as\s+)?((?:[01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?|\s+horas?))[.!]*$/);
      if (command) { rawDate = command[1]; rawTime = command[2]; selected = true; }
      const offers = naturalSlots(last, rules.tz, context.last_assistant_at || context.server_now);
      const clearOffer = /\b(tenho|disponiv|opcoes|funciona|prefere|confirm|posso|ofereco)/.test(normalizePt(last));
      const choice = normalized.replace(/[.!?]+$/, "").trim();
      const ordinal = choice.match(/^(?:(?:quero|prefiro|pode ser|escolho)\s+)?(?:a\s+)?(primeira|segunda|1|2)(?:\s+opcao)?$/);
      if (selected) { /* comando exato acima define data e hora */
      } else if (clearOffer && ordinal && offers.length === 2) {
        const slot = offers[["primeira", "1"].includes(ordinal[1]) ? 0 : 1]; rawDate = slot.date; rawTime = slot.time; selected = true;
      } else if (literal(rawDate, message) && literal(rawTime, message)) {
        const rest = normalizePt(message).replace(normalizePt(rawDate), "@data").replace(normalizePt(rawTime), "@hora");
        selected = /^(?:(?:pode ser|quero|prefiro|escolho|vamos marcar|vamos agendar)\s+)?(?:para\s+)?@data\s*(?:as|,)?\s*@hora[.!?]*$/.test(rest);
      } else if (clearOffer && offers.length) {
        const timeText = choice.replace(/^(?:(?:quero|prefiro|pode ser|escolho)\s+)?(?:(?:o horario das?|as)\s+)?/, "");
        const time = parseHoraRaw(timeText, now);
        if (time && new Set(offers.map((o) => o.date)).size === 1) { rawDate = offers[0].date; rawTime = time.hhmm; selected = true; }
      }
    }
    if ((!yes && !selected) || negative) return fail("confirmation_required", "Qual data e horário você escolhe para a reunião?");
    if (!selected && !(literal(rawDate, message) && literal(rawTime, message))) {
      if (!/^(sim|confirmo|confirmado|pode confirmar|pode agendar|pode marcar|fechado|combinado|isso|perfeito)[\s,.!]*$/.test(normalized))
        return fail("ambiguous_confirmation", "Pode confirmar a data completa e o horário da reunião?");
      const natural = Number(x.empresa) === 38 ? naturalSlots(last, rules.tz, context.last_assistant_at || context.server_now) : null;
      const dates = natural ? natural.map((o) => o.date) : [...last.matchAll(new RegExp("\\b" + offerDate + "\\b(?!/)", "g"))].map((m) => m[0]);
      const times = natural ? natural.map((o) => o.time) : [...last.matchAll(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)].map((m) => m[0]);
      if (new Set(dates).size !== 1 || new Set(times).size !== 1 || !/\b(confirm|posso agendar|posso marcar)/i.test(normalizePt(last)))
        return fail("ambiguous_confirmation", "Qual data e horário você confirma para a reunião?");
      rawDate = dates[0]; rawTime = times[0];
    }
  } else {
    if (rawDate && !literal(rawDate, message) && !literal(rawDate, last)) return fail("date_evidence", "Qual dia você prefere?");
  }
  if (x.acao !== "cancelar") {
    if (rawDate) {
      if (/\b(nao|menos|exceto|entre)\b/.test(normalizePt(rawDate)) || (rawDate.match(/\d{1,2}\/\d{1,2}/g) || []).length > 1)
        return fail("ambiguous_date", "Pode confirmar uma única data para a reunião?");
      x.dia = parseDataRawToYMD(rawDate, now);
      if (literal(rawDate, message) && /\b(?:\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})\b/.test(rawDate)) {
        if ((message.match(/\b(?:\d{1,2}\/\d{1,2}(?:\/\d{4})?|\d{4}-\d{2}-\d{2})\b/g) || []).length > 1 || parseDataRawToYMD(message, now) !== x.dia)
          return fail("date_mismatch", "Pode confirmar uma única data, com o dia da semana correto?");
      }
      if (!x.dia) return fail("invalid_date", "Essa data não é válida ou não corresponde ao dia da semana informado. Qual data você prefere?");
    } else x.dia = "";
    if (x.acao !== "consultar") {
      const time = parseHoraRaw(rawTime, now);
      if (!time || time.mm !== 0) return fail("invalid_time", "As reuniões começam em horas cheias. Qual horário você prefere?");
      x.hora = time.hhmm;
    }
  }
  x.periodo = normalizePt(x.periodo || "");
  if (!["", "manha", "tarde"].includes(x.periodo)) return fail("invalid_period", "Para a reunião, fica melhor de manhã ou à tarde?");
  try { return { valid: true, ...validateScheduleInput(x) }; }
  catch { return fail("invalid_request", "Preciso confirmar a data e o horário antes de continuar."); }
}
