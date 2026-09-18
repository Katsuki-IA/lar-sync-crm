import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAlert,classifyAlertResponse} from './qualified-whatsapp-alert.mjs';
const row={alert_id:'test',claim_token:'token',group_id:'120363000000000000@g.us',lead_name:'Teste',lead_phone:'5500000000000',project_name:'Residencial Teste',lead_id:123};
test('same configured group and concise qualified message',()=>{const r=prepareAlert(row);assert.equal(r.number,row.group_id);assert.match(r.text,/Novo lead qualificado/);assert.match(r.text,/Envio ao CRM confirmado/);assert.match(r.text,/\/leads\/123/);});
test('invalid or missing group never becomes a customer message',()=>{assert.throws(()=>prepareAlert({...row,group_id:'5500000000000'}));assert.throws(()=>prepareAlert({...row,group_id:null}));});
test('only explicit Evolution receipt confirms sent',()=>{assert.equal(classifyAlertResponse({statusCode:201,body:{key:{id:'message-123',fromMe:true},status:'PENDING'}}).status,'sent');assert.equal(classifyAlertResponse({statusCode:200,body:{}}).status,'uncertain');});
test('HTTP failure and timeout cannot trigger blind duplicate delivery',()=>{assert.equal(classifyAlertResponse({statusCode:401}).status,'failed');assert.equal(classifyAlertResponse({statusCode:500}).status,'uncertain');assert.equal(classifyAlertResponse({error:'timeout'}).status,'uncertain');});
