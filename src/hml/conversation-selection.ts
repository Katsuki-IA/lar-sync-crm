// Deep links must never fall back to another lead when absent from the first inbox page.
export function parseConversationLead(value:unknown): string|undefined {
  if(typeof value!=='string'&&typeof value!=='number')return undefined;
  const text=String(value);
  return /^\d+$/.test(text)&&Number.isSafeInteger(Number(text))&&Number(text)>0?String(Number(text)):undefined;
}
export function selectNativeConversation<T extends {lead_id:number}>(rows:T[],selectedId:number|null,requestedLead:string|undefined,detail:T|null):T|null {
  if(selectedId!==null)return rows.find(r=>r.lead_id===selectedId)??null;
  if(requestedLead!==undefined)return detail;
  return rows[0]??null;
}

