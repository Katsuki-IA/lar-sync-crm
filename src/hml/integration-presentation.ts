export const crmNames:Record<string,string>={katsuki:'Katsuki',cv:'CV',c2s:'C2S',kommo:'Kommo',rd:'RD Station',loft:'Loft / Vista',facilita:'Facilita'};
export function integrationPresentation(data:{provider:string|null;crmModule:boolean;configured:boolean}) {
 const legacyKatsuki=data.provider==='katsuki'&&!data.crmModule;
 return {
  label:data.provider==='katsuki'?(legacyKatsuki?'Katsuki — CRM atual':'Katsuki'):(data.provider?(crmNames[data.provider]??data.provider):'Não configurado'),
  description:legacyKatsuki
   ?'Destino Katsuki cadastrado. O módulo CRM comercial está desabilitado nesta empresa.'
   :data.provider==='katsuki'?'Consulte o destino interno e o mapeamento das etapas em Envio ao CRM.':data.configured?'Dados necessários cadastrados. Este resumo não realiza um teste de envio.':'Há dados obrigatórios ausentes ou o destino está indisponível.',
 };
}

