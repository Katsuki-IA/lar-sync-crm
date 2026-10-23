import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { deleteSelectedLeads } from "./lead-selection";
import { assertBulkAllowed } from "./lead-row-actions";
import { db, inputClass } from '@/hml/modules';

// RFC4180 quoted cells, escaped quotes and embedded newlines; comma or semicolon.
export function parseLeadCsv(text: string): string[][] {
 text=text.replace(/^\uFEFF/, '');
 const first=text.split(/\r?\n/)[0];
 const delimiter=(first.match(/;/g)?.length??0)>(first.match(/,/g)?.length??0)?';':',';
 const rows:string[][]=[]; let row:string[]=[]; let cell=''; let quoted=false;
 for(let i=0;i<text.length;i++) { const c=text[i];
  if(c==='"') { if(quoted&&text[i+1]==='"'){cell+='"';i++;} else quoted=!quoted; }
  else if(!quoted&&c===delimiter){row.push(cell);cell='';}
  else if(!quoted&&(c==='\n'||c==='\r')) {if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(quoted)throw new Error('CSV com aspas não fechadas.');
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 if(rows.length<2||rows.length>501)throw new Error('Use um CSV com cabeçalho e até 500 leads.');
 if(rows.some(r=>r.length!==rows[0].length))throw new Error('As linhas do CSV têm quantidades diferentes de colunas.');
 return rows;
}
export function downloadLeads(rows: any[]) {
 const cell=(v:unknown)=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const values=[['ID','Nome','Telefone','Email','Empreendimento','Etapa IA','Responsável IA','Tags','Criado','Oportunidades'],...rows.map(r=>[r.id,r.nome,r.telefone,r.email,r.development_name,r.stage_name,r.owner_name,r.tags.map((t:any)=>t.nome).join(' | '),r.created_at,r.opportunities.map((o:any)=>`${o.title}: ${o.stage_name}`).join(' | ')])];
 const url=URL.createObjectURL(new Blob(['\uFEFF'+values.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='leads.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function LeadOperations({companyId,ia,canEdit,canDelete,canAssign=false,showImport=true,filters,selected,meta,onDone}:{companyId:number;ia:boolean;canEdit:boolean;canDelete:boolean;canAssign?:boolean;showImport?:boolean;filters:Record<string,string>;selected:any[];meta:any;onDone:()=>void}) {
 const [deleting,setDeleting]=useState(false);const [deleteText,setDeleteText]=useState('');
 useEffect(()=>{setDeleting(false);setDeleteText('');},[selected]);
 const [importing,setImporting]=useState(false);const [csv,setCsv]=useState<string[][]>([]);
 const [mapping,setMapping]=useState<Record<string,string>>({});const [preview,setPreview]=useState<any[]|null>(null);
 const [busy,setBusy]=useState(false);const [action,setAction]=useState('tag_add');const [value,setValue]=useState('');const [confirm,setConfirm]=useState(false);
 useEffect(()=>setConfirm(false),[selected]);
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);try{await fn();}catch(e:any){toast.error(e.message??'Falha na operação');}finally{setBusy(false);}};
 const rpc=async(name:string,args:any)=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data;};
 const mapped=()=>csv.slice(1).map(row=>Object.fromEntries(['nome','telefone','email'].map(k=>[k,mapping[k]!==undefined&&mapping[k]!==''?row[Number(mapping[k])]:''])));
 const options=action==='owner'?(meta?.members??[]).filter((m:any)=>m.active):action==='stage'?(meta?.stages??[]).filter((s:any)=>s.module==='ia'&&s.ativo):(meta?.tags??[]);
 return <section className="space-y-3 rounded-xl border bg-card p-4">
 <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy|| (!!filters.from&&!!filters.to&&filters.from>filters.to)} onClick={()=>run(async()=>{const data=await rpc('hub_export_leads',{p_company_id:companyId,p_filters:Object.fromEntries(Object.entries(filters).map(([k,v])=>[k,v||null]))});downloadLeads(data);toast.success(`${data.length} leads exportados`);})}>Exportar resultados filtrados</Button>
 {canEdit&&showImport&&<Button variant="outline" disabled={busy} onClick={()=>setImporting(!importing)}>Importar CSV</Button>}
 <span className="text-xs text-muted-foreground">Exportação completa até 10.000 leads por arquivo.</span></div>
 {importing&&showImport&&<div className="space-y-3 border-t pt-3"><p className="text-sm">CSV com até 500 linhas. Mapeie nome, telefone e email. Telefones iguais após remover a pontuação são ignorados; inclua o DDI. A importação cria apenas o cadastro, sem iniciar atendimento ou oportunidade.</p>
 <input aria-label="Arquivo CSV" type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>{const file=e.target.files?.[0];setCsv([]);setPreview(null);setMapping({});if(file)void run(async()=>{if(file.size>2*1024*1024)throw new Error('Limite de 2 MB.');const parsed=parseLeadCsv(await file.text());setCsv(parsed);setMapping(Object.fromEntries(['nome','telefone','email'].map(k=>[k,String(parsed[0].findIndex(h=>h.trim().toLowerCase().replace(/[^a-z]/g,'')===k))]).filter(([,v])=>v!=='-1')));});}}/>
 {!!csv.length&&<><div className="flex flex-wrap gap-3">{['nome','telefone','email'].map(k=><label key={k} className="text-sm">{k}{k!=='email'?' *':''}<select className={inputClass} disabled={busy} value={mapping[k]??''} onChange={e=>{setMapping({...mapping,[k]:e.target.value});setPreview(null);}}><option value="">Selecionar coluna</option>{csv[0].map((h,i)=><option key={i} value={i}>{h}</option>)}</select></label>)}</div>
 <Button disabled={busy||mapping.nome===undefined||mapping.nome===''||mapping.telefone===undefined||mapping.telefone===''||new Set(Object.values(mapping).filter(v=>v!=='')).size!==Object.values(mapping).filter(v=>v!=='').length} onClick={()=>run(async()=>setPreview(await rpc('hub_import_leads',{p_company_id:companyId,p_rows:mapped(),p_commit:false})))}>Validar e visualizar</Button></>}
 {preview&&<><p className="text-sm">{preview.filter(r=>r.status==='Pronto').length} prontos · {preview.filter(r=>r.status==='Duplicado').length} duplicados · {preview.filter(r=>r.status==='Inválido').length} inválidos · {preview.filter(r=>r.status==='Importado').length} importados</p><div className="max-h-64 overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{['Linha','Nome','Telefone','Email','Resultado'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{preview.map(r=><tr key={r.linha}>{[r.linha,r.nome,r.telefone,r.email,r.status].map((v,i)=><td key={i} className="border-t p-2">{v}</td>)}</tr>)}</tbody></table></div><Button disabled={busy||!preview.some(r=>r.status==='Pronto')} onClick={()=>run(async()=>{setPreview(await rpc('hub_import_leads',{p_company_id:companyId,p_rows:mapped(),p_commit:true}));onDone();toast.success('Importação concluída. Confira o resultado de cada linha.');})}>Importar somente os prontos</Button></>}
 </div>}
 {selected.length>0&&<div className="flex flex-wrap items-center gap-2 border-t pt-3">
 <Button variant="outline" disabled={busy} onClick={()=>downloadLeads(selected)}>Exportar selecionados ({selected.length})</Button>
 {canDelete&&<Button variant="destructive" disabled={busy} onClick={()=>setDeleting(true)}>Excluir selecionados</Button>}
 </div>}
 {deleting&&canDelete&&<div role="alertdialog" aria-label="Excluir leads selecionados" className="space-y-3 rounded-lg border border-destructive p-4">
 <p>Excluir {selected.length} lead(s) selecionado(s)? Esta ação não pode ser desfeita. Digite EXCLUIR para confirmar.</p>
 <input aria-label="Confirmar exclusão" className={inputClass} value={deleteText} disabled={busy} onChange={e=>setDeleteText(e.target.value)}/>
 <Button variant="destructive" disabled={busy||deleteText!=='EXCLUIR'} onClick={()=>run(async()=>{await deleteSelectedLeads(db,companyId,selected);setDeleting(false);onDone();toast.success('Leads excluídos');})}>Confirmar exclusão</Button>
 <Button variant="outline" disabled={busy} onClick={()=>{setDeleting(false);setDeleteText('');}}>Cancelar</Button>
 </div>}
 {canEdit&&selected.length>0&&<div className="flex flex-wrap items-center gap-2 border-t pt-3"><span>{selected.length} selecionados nesta página</span><select aria-label="Ação em lote" className={inputClass+' w-auto'} disabled={busy} value={action} onChange={e=>{setAction(e.target.value);setValue('');setConfirm(false);}}><option value="tag_add">Adicionar tag</option><option value="tag_remove">Remover tag</option>{ia&&canAssign&&<><option value="owner">Responsável IA</option><option value="stage">Etapa IA</option></>}</select><select aria-label="Valor da alteração" className={inputClass+' w-auto'} value={value} disabled={busy} onChange={e=>{setValue(e.target.value);setConfirm(false);}}><option value="">Selecione…</option>{options.map((o:any)=><option key={o.id} value={o.id}>{o.nome}</option>)}</select><Button disabled={busy||!value} onClick={()=>{if(!confirm){setConfirm(true);return;}void run(async()=>{assertBulkAllowed(action,canAssign);await rpc('hub_bulk_leads',{p_company_id:companyId,p_rows:selected.map(r=>({id:r.id,updated_at:r.updated_at})),p_action:action,p_value:value});setConfirm(false);onDone();toast.success('Alterações aplicadas.');});}}>{confirm?`Confirmar em ${selected.length} leads`:'Aplicar em lote'}</Button>{confirm&&<Button variant="ghost" onClick={()=>setConfirm(false)}>Cancelar</Button>}</div>}
 </section>;
}

