import type { ReactNode } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RelatorioLinha {
  id_empresa: number;
  nome: string | null;
  periodo: string | null;
  gerado_em: string | null;
  payload: any;
  updated_at?: string;
}

const C = {
  ink: "hsl(var(--kr-ink))",
  mag: "hsl(var(--kr-mag))",
  blue: "hsl(var(--kr-blue))",
  green: "hsl(var(--kr-green))",
  muted: "hsl(var(--kr-muted))",
  line: "hsl(var(--kr-line))",
};

const ND = "n/d";
const isNum = (v: any): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: any, dec = 1) => (isNum(v) ? v.toLocaleString("pt-BR", { maximumFractionDigits: dec }) : ND);
const pct = (v: any, dec = 1) => (isNum(v) ? `${num(v, dec)}%` : ND);
const minutos = (v: any) => {
  if (!isNum(v)) return ND;
  if (v < 60) return `${num(v, 0)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return m ? `${h}h ${m}min` : `${h}h`;
};
const dataBR = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ND);
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const mesExtenso = (m: string | null | undefined) => {
  if (!m) return ND;
  const i = Number(m.slice(5, 7)) - 1;
  return MESES[i] ? `${MESES[i]} ${m.slice(0, 4)}` : m;
};
const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const FAIXAS: Record<string, string> = { "1": "Madrugada (0 a 6h)", "2": "Manhã (6 a 12h)", "3": "Tarde (12 a 18h)", "4": "Noite (18 a 24h)" };
const FAIXA_VISITA = ["Manhã", "12h às 15h", "15h às 18h", "Noite"];
const ordinal = (n: number) => `${n}º`;
const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

function origemLabel(o: string) {
  if (o === "inicial") return "Respondeu à abordagem";
  if (o === "sem resposta") return "Nunca respondeu";
  const m = /^FU(\d)$/i.exec(o);
  return m ? `Respondeu no ${ordinal(Number(m[1]))} FU` : o;
}
function origemCurta(o: string) {
  if (o === "inicial") return "abordagem";
  const m = /^FU(\d)$/i.exec(o);
  return m ? `${ordinal(Number(m[1]))} FU` : o;
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t pt-8" style={{ borderColor: C.line }}>
      <h2 className="kr-serif text-3xl leading-tight">{titulo}</h2>
      {children}
    </section>
  );
}
function Texto({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{children}</p>;
}
function Nota({ children }: { children: ReactNode }) {
  return <p className="text-xs" style={{ color: C.muted }}>{children}</p>;
}
function SubTitulo({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold uppercase tracking-wide">{children}</h3>;
}

function Tabela({ cab, linhas, alinharPrimeira = true }: { cab: string[]; linhas: ReactNode[][]; alinharPrimeira?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border bg-white" style={{ borderColor: C.line }}>
      <table className="kr-num w-full min-w-max text-sm">
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.line}` }}>
            {cab.map((c, i) => (
              <th key={i} className={`px-3 py-2 text-xs font-semibold ${i === 0 && alinharPrimeira ? "text-left" : "text-right"}`} style={{ color: C.muted }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, r) => (
            <tr key={r} style={{ borderTop: r ? `1px solid ${C.line}` : undefined }}>
              {l.map((c, i) => <td key={i} className={`px-3 py-2 ${i === 0 && alinharPrimeira ? "text-left" : "text-right"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Barras({ titulo, itens }: { titulo: string; itens: { label: string; valor: number | null; cor?: string }[] }) {
  const max = Math.max(1, ...itens.map((i) => (isNum(i.valor) ? i.valor : 0)));
  return (
    <div className="space-y-2 rounded-md border bg-white p-4" style={{ borderColor: C.line }}>
      <SubTitulo>{titulo}</SubTitulo>
      {itens.length === 0 && <Nota>{ND}</Nota>}
      {itens.map((i) => (
        <div key={i.label} className="space-y-1">
          <div className="flex justify-between text-xs"><span>{i.label}</span><span className="kr-num font-semibold" style={{ color: i.cor ?? C.blue }}>{pct(i.valor)}</span></div>
          <div className="h-2 rounded-full" style={{ background: C.line }}>
            <div className="h-2 rounded-full" style={{ width: `${isNum(i.valor) ? (i.valor / max) * 100 : 0}%`, background: i.cor ?? C.blue }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Kpi({ valor, legenda, carteira }: { valor: string; legenda: string; carteira: string }) {
  return (
    <div className="rounded-md border bg-white p-4" style={{ borderColor: C.line }}>
      <div className="kr-num kr-serif text-4xl" style={{ color: C.blue }}>{valor}</div>
      <p className="mt-1 text-sm">{legenda}</p>
      <p className="kr-num mt-2 text-xs" style={{ color: C.muted }}>Carteira: {carteira}</p>
    </div>
  );
}

const corTaxa = (v: any, ref: any) => {
  if (!isNum(v) || !isNum(ref)) return undefined;
  if (v >= ref) return C.green;
  if (v < ref * 0.8) return C.mag;
  return undefined;
};
const Colorido = ({ children, cor }: { children: ReactNode; cor?: string }) => (
  <span style={{ color: cor, fontWeight: cor ? 600 : undefined }}>{children}</span>
);

export function RelatorioAtendimento({ cliente, carteira }: { cliente: RelatorioLinha; carteira: RelatorioLinha | null }) {
  const p = cliente.payload ?? {};
  const k = carteira?.payload ?? {};
  const kp = p.kpis ?? {};
  const kk = k.kpis ?? {};
  const periodo = cliente.periodo ?? p.periodo;
  const gerado = cliente.gerado_em ?? p.gerado_em;
  const baseP = isNum(p.tempo_agendamento?.visitas) && p.tempo_agendamento.visitas < 10;

  const fuCart = new Map(arr(k.followup).map((f) => [f.etapa, f]));
  const followup = arr(p.followup).sort((a, b) => a.etapa - b.etapa);

  const mensagens = arr(p.mensagens).slice().sort((a, b) => (a.etapa - b.etapa) || String(a.var).localeCompare(String(b.var)) || ((b.taxa ?? 0) - (a.taxa ?? 0)));
  const porEtapa = new Map<number, any[]>();
  mensagens.forEach((m) => porEtapa.set(m.etapa, [...(porEtapa.get(m.etapa) ?? []), m]));
  const corMsg = (m: any) => {
    const g = porEtapa.get(m.etapa) ?? [];
    const taxas = g.map((x) => x.taxa).filter(isNum);
    if (!isNum(m.taxa) || taxas.length === 0) return undefined;
    if (m.taxa === Math.max(...taxas)) return C.green;
    if (g.length > 1 && m.taxa === Math.min(...taxas)) return C.mag;
    return undefined;
  };

  const origem = arr(p.origem).sort((a, b) => a.ordem - b.ordem);
  const fp = p.funil ?? {};
  const fk = k.funil ?? {};
  const horas = arr(p.mensagens_hora);
  const foraComercial = horas.reduce((s, v, h) => (h >= 8 && h <= 17 ? s : s + (isNum(v) ? v : 0)), 0);
  const maxHora = Math.max(1, ...horas.map((v) => (isNum(v) ? v : 0)));
  const tp = p.tempo_agendamento ?? {};
  const tk = k.tempo_agendamento ?? {};
  const vp = p.visitas ?? {};
  const diaSemana = arr(vp.dia_semana);
  const maxDia = Math.max(...diaSemana.map((v) => (isNum(v) ? v : 0)));
  const ap = p.antecedencia ?? {};
  const ak = k.antecedencia ?? {};
  const lp = p.lembrete ?? {};
  const lk = k.lembrete ?? {};

  return (
    <div className="relatorio-ia min-h-full rounded-lg px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-[980px] space-y-10">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.mag }}>Katsuki IA · Relatório de atendimento</p>
          <h1 className="kr-serif text-5xl leading-none">Raio-X do Atendimento IA</h1>
          <p className="text-sm" style={{ color: C.muted }}>
            {cliente.nome ?? ND} · Leads de {periodo ?? ND} · Leitura de {dataBR(gerado)}
          </p>
          {baseP && <p className="inline-block rounded border px-2 py-1 text-xs" style={{ borderColor: C.mag, color: C.mag }}>Base ainda pequena: use os números como referência.</p>}
        </header>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi valor={pct(kp.resp_outbound)} legenda="dos leads abordados pela IA respondem" carteira={pct(kk.resp_outbound)} />
          <Kpi valor={pct(kp.resp_fu1)} legenda="respondem ao 1º follow-up" carteira={pct(kk.resp_fu1)} />
          <Kpi valor={pct(kp.pct_visitas_fu)} legenda="das visitas vêm de leads que responderam depois de um follow-up" carteira={pct(kk.pct_visitas_fu)} />
          <Kpi valor={isNum(kp.antecedencia_mediana_d) ? `${num(kp.antecedencia_mediana_d)} dias` : ND} legenda="entre o agendamento e a visita (mediana)" carteira={isNum(kk.antecedencia_mediana_d) ? `${num(kk.antecedencia_mediana_d)} dias` : ND} />
        </div>

        <Secao titulo="Taxa de resposta por follow-up">
          <Texto>Cada etapa tem três versões, conforme o momento do lead: A para quem ainda não respondeu, B para quem respondeu e parou, C para quem estava marcando visita. Conta como resposta qualquer mensagem do lead antes do follow-up seguinte, em até 7 dias.</Texto>
          {followup.length === 0 ? <Nota>Sem follow-ups no período ({ND}).</Nota> : (
            <Tabela
              cab={["Etapa", "Enviados", "Responderam", "A", "B", "C", "Tempo até responder", "Respostas negativas", "Carteira"]}
              linhas={[
                ...followup.map((f) => {
                  const ref = fuCart.get(f.etapa)?.taxa;
                  return [
                    `${ordinal(f.etapa)} follow-up`, num(f.enviados, 0),
                    <Colorido key="t" cor={corTaxa(f.taxa, ref)}>{pct(f.taxa)}</Colorido>,
                    pct(f.a), pct(f.b), pct(f.c), minutos(f.med_min), pct(f.negativas), pct(ref),
                  ];
                }),
                [<b key="t">Total</b>, <b key="e">{num(p.followup_total?.enviados, 0)}</b>,
                  <b key="r"><Colorido cor={corTaxa(p.followup_total?.taxa, k.followup_total?.taxa)}>{pct(p.followup_total?.taxa)}</Colorido></b>,
                  "", "", "", "", <b key="n">{pct(p.followup_total?.negativas)}</b>, <b key="c">{pct(k.followup_total?.taxa)}</b>],
              ]}
            />
          )}
          {mensagens.length > 0 && (
            <div className="space-y-2 pt-2">
              <SubTitulo>Mensagens e resposta</SubTitulo>
              <Tabela
                cab={["Etapa", "Mensagem", "Enviadas", "Resposta"]}
                linhas={mensagens.map((m) => [
                  `${ordinal(m.etapa)} · ${m.var ?? ND}`,
                  <span key="m" className="block min-w-[260px] max-w-[460px] whitespace-normal text-left">{m.texto ?? ND}</span>,
                  num(m.enviadas, 0),
                  <Colorido key="t" cor={corMsg(m)}>{pct(m.taxa)}</Colorido>,
                ])}
              />
              <Nota>Mensagens com ao menos 15 envios no período.</Nota>
            </div>
          )}
        </Secao>

        <Secao titulo="Em que momento o lead que agenda respondeu">
          <Texto>Leads abordados pela IA (sem contar os que mandaram a primeira mensagem), classificados pelo momento da primeira resposta.</Texto>
          <div className="grid gap-4 md:grid-cols-2">
            <Barras titulo="Participação nos leads" itens={origem.map((o) => ({ label: origemLabel(o.origem), valor: o.leads_pct, cor: o.origem === "sem resposta" ? C.mag : undefined }))} />
            <Barras titulo="Participação nas visitas agendadas" itens={origem.filter((o) => o.origem !== "sem resposta").map((o) => ({ label: origemLabel(o.origem), valor: o.visitas_pct }))} />
          </div>
          {origem.some((o) => o.origem !== "sem resposta") && (
            <Nota>Taxa de agendamento: {origem.filter((o) => o.origem !== "sem resposta").map((o) => `${origemCurta(o.origem)} ${pct(o.taxa_agendamento)}`).join(", ")}.</Nota>
          )}
        </Secao>

        <Secao titulo="Funil do atendimento">
          <Tabela
            cab={["", "Cliente", "Carteira"]}
            linhas={[
              ["Leads", num(fp.leads, 0), num(fk.leads, 0)],
              ["Leads que iniciaram a conversa", pct(fp.inbound_pct), pct(fk.inbound_pct)],
              ["Responderam", pct(fp.resp_outbound), pct(fk.resp_outbound)],
              ["Responderam à abordagem", pct(fp.resp_abordagem), pct(fk.resp_abordagem)],
              ["Tempo até a 1ª resposta", minutos(fp.mediana_1a_resposta_min), minutos(fk.mediana_1a_resposta_min)],
              ["Engajados, 3+ mensagens", pct(fp.engajados), pct(fk.engajados)],
              ["Qualificados", pct(fp.qualificados), pct(fk.qualificados)],
              ["Agendaram visita", pct(fp.agendaram), pct(fk.agendaram)],
              ["Primeira mensagem não entregue", pct(fp.nao_entregue), pct(fk.nao_entregue)],
            ]}
          />
          <Nota>Primeira mensagem não entregue: número inválido, sem WhatsApp ou bloqueio da Meta.</Nota>
        </Secao>

        <Secao titulo="Quando os leads chegam e conversam">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <SubTitulo>Hora de entrada do lead</SubTitulo>
                <Tabela
                  cab={["Faixa", "Leads", "Responderam", "1ª resposta", "Agendaram"]}
                  linhas={arr(p.horario_entrada).slice().sort((a, b) => Number(a.faixa) - Number(b.faixa)).map((h) => [
                    FAIXAS[String(h.faixa)] ?? String(h.faixa), pct(h.leads_pct), pct(h.resp), minutos(h.mediana_min), pct(h.agendaram),
                  ])}
                />
              </div>
              <div className="space-y-2">
                <SubTitulo>Dia de entrada do lead</SubTitulo>
                <Tabela
                  cab={["Dia", "Leads", "Responderam", "Agendaram"]}
                  linhas={arr(p.dia_entrada).slice().sort((a, b) => a.dow - b.dow).map((d) => [
                    DIAS[d.dow - 1] ?? String(d.dow), num(d.leads, 0), pct(d.resp), pct(d.agendaram),
                  ])}
                />
              </div>
            </div>
            <div className="space-y-2 rounded-md border bg-white p-4" style={{ borderColor: C.line }}>
              <SubTitulo>Mensagens dos leads por hora do dia</SubTitulo>
              {horas.length === 0 ? <Nota>{ND}</Nota> : (
                <>
                  <div className="flex h-48 items-end gap-[2px]">
                    {horas.map((v, h) => (
                      <div key={h} className="flex h-full flex-1 flex-col justify-end" title={`${h}h: ${pct(v)}`}>
                        <div style={{ height: `${isNum(v) ? (v / maxHora) * 100 : 0}%`, background: h >= 8 && h <= 17 ? C.blue : C.mag }} />
                      </div>
                    ))}
                  </div>
                  <div className="kr-num flex justify-between text-[10px]" style={{ color: C.muted }}>
                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>
                  <div className="flex flex-wrap gap-4 pt-1 text-xs">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-3" style={{ background: C.blue }} />8h às 18h</span>
                    <span className="kr-num flex items-center gap-1"><span className="inline-block h-2 w-3" style={{ background: C.mag }} />fora do horário comercial ({pct(foraComercial)})</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </Secao>

        <Secao titulo="Agendamento, antecedência e comparecimento">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi valor={minutos(tp.mediana_min)} legenda={`mediana entre a entrada do lead e o agendamento (média de ${isNum(tp.media_h) ? `${num(tp.media_h)}h` : ND})`} carteira={minutos(tk.mediana_min)} />
            <Kpi valor={num(p.msgs_ate_agendar_mediana)} legenda="mensagens do lead até agendar (mediana)" carteira={num(k.msgs_ate_agendar_mediana)} />
            <Kpi valor={pct(vp.cancelados_pct)} legenda="dos agendamentos foram cancelados no sistema" carteira={pct(k.visitas?.cancelados_pct)} />
            <Kpi valor={pct(vp.reagendaram_pct)} legenda="dos leads com visita reagendaram ao menos uma vez" carteira={pct(k.visitas?.reagendaram_pct)} />
          </div>

          <div className="space-y-2">
            <SubTitulo>Tempo da entrada do lead até o agendamento da visita</SubTitulo>
            <Texto>Tempo entre o cadastro do lead e a mensagem da IA confirmando o agendamento; conta o primeiro agendamento de cada lead, presencial ou online. A média é puxada por poucos leads que agendam dias depois; a mediana mostra o caso típico.</Texto>
            <Tabela
              cab={["", "Visitas", "Média (h)", "Mediana (min)", "Até 1h", "Até 24h", "7 dias ou mais"]}
              linhas={[tp, tk].map((t, i) => [i ? "Carteira" : "Cliente", num(t.visitas, 0), num(t.media_h), num(t.mediana_min, 0), pct(t.ate_1h), pct(t.ate_24h), pct(t.mais_7d)])}
            />
          </div>

          {arr(p.tempo_agendamento_mes).length > 0 && (
            <div className="space-y-2">
              <SubTitulo>Evolução por mês de entrada do lead</SubTitulo>
              <Tabela
                cab={["Mês", "Visitas", "Média (h)", "Mediana (min)", "Até 1h", "Até 24h"]}
                linhas={arr(p.tempo_agendamento_mes).slice().sort((a, b) => String(a.mes).localeCompare(String(b.mes))).map((m) => [
                  mesExtenso(m.mes), num(m.visitas, 0), num(m.media_h), num(m.mediana_min, 0), pct(m.ate_1h), pct(m.ate_24h),
                ])}
              />
              <Nota>Os meses mais recentes ainda podem subir: leads novos não tiveram tempo de agendar tarde.</Nota>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-4">
              <Barras titulo="Dia da visita" itens={diaSemana.map((v, i) => ({ label: DIAS[i] ?? String(i + 1), valor: v, cor: isNum(v) && v > 0 && v === maxDia ? C.mag : undefined }))} />
              <Barras titulo="Horário da visita" itens={arr(vp.faixa_hora).map((v, i) => ({ label: FAIXA_VISITA[i] ?? String(i + 1), valor: v }))} />
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <SubTitulo>Antecedência entre o agendamento e a visita</SubTitulo>
                <Tabela
                  cab={["", "Visitas", "Mediana (dias)", "Mesmo dia", "Até 2 dias", "Mais de 7 dias"]}
                  linhas={[ap, ak].map((a, i) => [i ? "Carteira" : "Cliente", num(a.visitas, 0), num(a.mediana_d), pct(a.mesmo_dia), pct(a.ate_2d), pct(a.mais_7d)])}
                />
              </div>
              <div className="space-y-2">
                <SubTitulo>Resposta ao lembrete da véspera</SubTitulo>
                <Tabela
                  cab={["", "Lembretes", "Responderam", "Confirmaram", "Remarcar ou cancelar"]}
                  linhas={[lp, lk].map((l, i) => [i ? "Carteira" : "Cliente", num(l.enviados, 0), pct(l.responderam), pct(l.confirmaram), pct(l.remarcar_cancelar)])}
                />
                <Nota>Confirmaram e remarcar ou cancelar são percentuais de quem respondeu ao lembrete.</Nota>
              </div>
            </div>
          </div>
        </Secao>

        {arr(p.sugestoes).length > 0 && (
          <Secao titulo="Sugestões de melhoria">
            <div className="space-y-3">
              {arr(p.sugestoes).map((s, i) => (
                <div key={i} className="rounded-md border border-l-4 bg-white p-4" style={{ borderColor: C.line, borderLeftColor: C.mag }}>
                  <p className="font-semibold">{s.titulo}</p>
                  {s.texto && <p className="mt-1 text-sm">{s.texto}</p>}
                </div>
              ))}
            </div>
          </Secao>
        )}

        <footer className="space-y-1 border-t pt-6" style={{ borderColor: C.line }}>
          <p className="text-xs font-semibold uppercase tracking-wide">Como foi medido</p>
          <Nota>Base de atendimento da Plataforma Katsuki IA. Entram os leads criados no período indicado. Follow-ups identificados pelo texto cadastrado em cada etapa; mensagens repetidas em menos de 30 minutos contam uma vez. Confirmação e pedido de remarcação no lembrete classificados por palavras-chave.</Nota>
        </footer>
      </div>
    </div>
  );
}
