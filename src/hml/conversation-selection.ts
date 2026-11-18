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

// The URL deep link drives the selection only until the user picks a list item.
// Once dismissed it stays dismissed for that lead value, even if a filter resets selectedId.
export function activeDeepLink(lead:string|undefined,selectedId:number|null,dismissedLead:string|null):string|undefined {
  return lead && selectedId===null && dismissedLead!==lead ? lead : undefined;
}
// Only report a context error when it belongs to the deep link currently being shown.
export function shouldReportDeepLinkError(active:string|undefined,isError:boolean):boolean {
  return !!active && isError;
}
