export const crmNames:Record<string,string>={katsuki:'Katsuki',cv:'CV',c2s:'C2S',kommo:'Kommo',rd:'RD Station',loft:'Loft / Vista',facilita:'Facilita'};
export function integrationPresentation(data:{provider:string|null;crmModule:boolean;configured:boolean}) {
 const legacyKatsuki=data.provider==='katsuki'&&!data.crmModule;
 return {
  label:data.provider==='katsuki'?(legacyKatsuki?'Katsuki — CRM atual':'Katsuki — CRM interno'):(data.provider?(crmNames[data.provider]??data.provider):'Não configurado'),
  description:legacyKatsuki
   ?'Destino Katsuki atual mantido. O novo módulo CRM está desabilitado. A conexão deve ser validada pelo envio ao CRM.'
   :data.configured?'Campos necessários presentes. A conexão real ainda deve ser validada.':'Configuração incompleta ou destino indisponível.',
 };
}

