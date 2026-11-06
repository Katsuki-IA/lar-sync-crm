import { describe, it, expect } from 'vitest';
import { summarizeConversationLead, matchesCommercialStage, type ConversationCommercialData } from './conversation-commercial-summary';

const data: ConversationCommercialData = {
 opportunities: [{id:'a',lead_id:1,stage_id:10,funnel_id:20},{id:'b',lead_id:1,stage_id:11,funnel_id:21}],
 stages:[{id:10,nome:'Em contato'},{id:11,nome:'Proposta'}],
 funnels:[{id:20,nome:'Vendas'},{id:21,nome:'Locação'}],
 tasks:[{id:'a',lead_id:1,status:'pendente',prazo:'2026-11-07T12:00:00Z'},
 {id:'b',lead_id:1,status:'em_andamento',prazo:'2026-11-05T12:00:00Z'},
 {id:'c',lead_id:1,status:'concluida',prazo:'2026-11-01T12:00:00Z'},
 {id:'d',lead_id:2,status:'pendente',prazo:'2026-11-01T12:00:00Z'}],
};
describe('conversation commercial summary',()=>{
 it('shows every commercial funnel instead of choosing an arbitrary opportunity',()=>{
  expect(summarizeConversationLead(data,1).stages.map(s=>s.label)).toEqual(['Vendas: Em contato','Locação: Proposta']);
 });
 it('counts only this lead and excludes completed tasks from pending/overdue',()=>{
  const summary=summarizeConversationLead(data,1,Date.parse('2026-11-06T12:00:00Z'));
  expect([summary.totalTasks,summary.pendingTasks,summary.overdueTasks]).toEqual([3,2,1]);
 });
 it('keeps a task visible even when the lead has no opportunity',()=>{
  const summary=summarizeConversationLead(data,2,Date.parse('2026-11-06T12:00:00Z'));
  expect(summary.stages).toEqual([]);expect(summary.pendingTasks).toBe(1);
  expect(summarizeConversationLead(data,3).totalTasks).toBe(0);
 });
});

it('filters any commercial opportunity and includes contacts without CRM opportunities', () => {
 expect(matchesCommercialStage(data,1,'11')).toBe(true);
 expect(matchesCommercialStage(data,1,'none')).toBe(false);
 expect(matchesCommercialStage(data,2,'none')).toBe(true);
 expect(matchesCommercialStage(data,null,'none')).toBe(true);
 expect(matchesCommercialStage(data,2,'10')).toBe(false);
});
it('shows the earliest pending task and hides completed-only tasks', () => {
 expect(summarizeConversationLead(data,1).nextTask?.id).toBe('b');
 expect(summarizeConversationLead({...data,tasks:data.tasks.filter(t=>t.status==='concluida')},1).nextTask).toBeUndefined();
});
