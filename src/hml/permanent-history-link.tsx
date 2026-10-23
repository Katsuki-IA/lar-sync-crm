import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {db,inputClass} from './modules';

export function PermanentHistoryLink({companyId,leadId,onClose}:{companyId:number;leadId:number;onClose:()=>void}){
 const [copyStatus,setCopyStatus]=useState('');
 const query=useQuery({
  queryKey:['permanent-history-link',companyId,leadId],gcTime:0,retry:false,
  queryFn:async()=>{
   const {data,error}=await db.from('crm_leads').select('historico_token').eq('id_empresa',companyId).eq('id',leadId).single();
   if(error)throw error;
   if(!data?.historico_token)throw new Error('Este lead ainda não possui um link de histórico.');
   return `${window.location.origin}/historico/${encodeURIComponent(data.historico_token)}`;
  }
 });
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent><DialogHeader>
  <DialogTitle>Link do histórico</DialogTitle>
  <DialogDescription>Link permanente do lead. Para abrir a conversa, é necessário informar o código da empresa. Enquanto o site estiver local, o endereço funciona apenas neste computador.</DialogDescription>
 </DialogHeader>
 {query.isPending?<p role="status">Carregando link…</p>:query.isError?<p role="alert">Não foi possível obter o link. Verifique seu acesso e o cadastro do lead.</p>:<>
  <label>Endereço do histórico<input aria-label="Endereço permanente do histórico" className={inputClass} readOnly value={query.data} onFocus={e=>e.target.select()}/></label>
  <Button onClick={async()=>{
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    await Promise.race([navigator.clipboard.writeText(query.data!),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Clipboard timeout')),2500);})]);
    setCopyStatus('Link copiado');toast.success('Link copiado');
   }catch{setCopyStatus('Selecione e copie o endereço acima.');}
   finally{clearTimeout(timer);}
  }}>Copiar link</Button>
  {copyStatus&&<p role="status">{copyStatus}</p>}
 </>}
 </DialogContent></Dialog>;
}

