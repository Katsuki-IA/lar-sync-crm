import {useQuery} from '@tanstack/react-query';
import {db,inputClass,Notice,secondaryClass} from './modules';
import {RelatorioAtendimento,RelatorioComportamento,type RelatorioLinha} from './report-ia-renderer';
export function IAReport({companyId,tab,from,to,onPeriodChange}:{companyId:number;tab:'raio-x'|'comportamento';from:string;to:string;onPeriodChange:(from:string,to:string)=>void}) {
 const valid=!!from&&!!to&&from<=to&&(Date.parse(to)-Date.parse(from))/86400000<=3660;
 const query=useQuery({queryKey:['report-ia',companyId,from,to],enabled:valid,queryFn:async()=>{
  const {data,error}=await db.rpc('hub_report_ia',{p_company_id:companyId,p_from:from,p_to:to});if(error)throw error;
  return data as {cliente:RelatorioLinha;carteira:RelatorioLinha|null;updated_at:string}|null;
 }});
 return <div className="space-y-5"><h1 className="text-2xl font-semibold">{tab==='raio-x'?'Raio-X do Atendimento':'Comportamento do Lead'}</h1>
 <div className="flex flex-wrap items-end gap-3"><label className="text-sm">De<input aria-label="De" type="date" className={inputClass} value={from} onChange={e=>onPeriodChange(e.target.value,to)}/></label><label className="text-sm">Até<input aria-label="Até" type="date" className={inputClass} value={to} onChange={e=>onPeriodChange(from,e.target.value)}/></label><button className={secondaryClass} disabled={!valid||query.isFetching} onClick={()=>query.refetch()}>Atualizar</button></div>
 <p className="text-sm text-muted-foreground">Análise dos leads que entraram no período selecionado.</p>
 <Notice title="Cópia de validação">Nesta homologação, as análises são cópias de períodos específicos. O botão Atualizar consulta a cópia disponível; não recalcula o relatório nem gera uma nova síntese de IA.</Notice>
 {!valid?<Notice title="Confira o período">Informe datas em ordem, com intervalo máximo de 10 anos.</Notice>:query.isError?<Notice title="Não foi possível carregar a análise">{query.error.message}</Notice>:query.isPending?<p role="status">Carregando análise…</p>:!query.data?<Notice title="Análise ainda não disponível">Não há análise carregada na homologação para esta empresa e período. Isso não significa que a empresa não tenha leads.</Notice>:<><p className="text-xs text-muted-foreground">Atualizado em {new Date(query.data.updated_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · Homologação</p>{tab==='raio-x'?<RelatorioAtendimento cliente={query.data.cliente} carteira={query.data.carteira}/>:<RelatorioComportamento cliente={query.data.cliente} carteira={query.data.carteira}/>}</>}
 </div>;
}

