const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
function source(name){const a=html.indexOf(`    function ${name}(`);assert(a>=0,name);return html.slice(a,html.indexOf('\n    }',a)+6);}
function setup(){
 const stored=new Map(),alerts=[],saves=[],buttons={channelBillSaveDraft:{},channelBillSubmit:{}};
 const c=vm.createContext({console:{error:()=>{}},JSON,Number,Math,
  DEMO_STORE_KEY:'demo',localStorage:{setItem:(k,v)=>stored.set(k,v)},alert:x=>alerts.push(x),
  channelBillWizard:{on:true,channel:'general',settleYear:2026,settleMonth:11},settleDetailMode:'edit',
  channelBillPreviewReady:false,channelBillPreviewSnapshot:[],channelBillGroupRemarks:{},channelBillExportDecl:null,
  settleRows:[{id:'A',sku:'A',orderNo:'SO',checked:true,settleQty:3,remain:6,price:280}],
  document:{getElementById:id=>buttons[id]},nowStamp:()=> '2026-11-20',
  channelBillContractCurrency:()=> 'TWD',channelBillCurrentRate:()=>1,
  channelBillUsesUntaxed:()=>false,channelBillTotal:rows=>rows.reduce((sum,r)=>sum+r.settleQty*r.price,0),
  renderChannelBillPreview:()=>{},
  channelBillCheckedSelection:()=>c.settleRows.filter(r=>r.checked),
  saveChannelBillRecord:(rows,draft)=>{saves.push({rows:JSON.parse(JSON.stringify(rows)),draft});return {id:'B'};},
  persistDemoData:()=>{},leaveChannelBillWizard:()=>{},
 });
 vm.runInContext(['cloneChannelBillPreviewRow','syncChannelBillActionButtons','invalidateChannelBillPreview',
  'clearChannelBillPreview','persistChannelBillPreview','confirmChannelBillPreview','saveChannelBillDraft','submitChannelBill'].map(source).join('\n'),c);
 return {c,stored,alerts,saves,buttons};
}
test('confirm saves a detached preview without submitting; edits block both actions until reconfirmed',()=>{
 const {c,stored,alerts,saves,buttons}=setup();
 c.syncChannelBillActionButtons();assert.equal(buttons.channelBillSubmit.disabled,false);
 c.confirmChannelBillPreview();assert.equal(c.channelBillPreviewReady,true);assert.equal(saves.length,0);
 assert.equal(JSON.parse(stored.get('demo:bill-preview')).rows[0].settleQty,3);
 c.settleRows[0].settleQty=4;c.invalidateChannelBillPreview();
 assert.equal(c.channelBillPreviewSnapshot[0].settleQty,3);
 assert.equal(buttons.channelBillSaveDraft.disabled,false);assert.equal(buttons.channelBillSubmit.disabled,false);
 c.submitChannelBill();c.saveChannelBillDraft();
 assert.deepEqual(alerts,['請先點擊確定按鈕','請先點擊確定按鈕']);assert.equal(saves.length,0);
 c.confirmChannelBillPreview();assert.equal(c.channelBillPreviewSnapshot[0].settleQty,4);
 assert.equal(JSON.parse(stored.get('demo:bill-preview')).total,1120);
 c.submitChannelBill();assert.equal(saves.length,1);assert.equal(saves[0].draft,false);assert.equal(saves[0].rows[0].settleQty,4);
});
test('failed preview storage cannot mark data confirmed or permit submission',()=>{
 const {c,alerts,saves}=setup();c.localStorage.setItem=()=>{throw Error('quota');};
 c.confirmChannelBillPreview();assert.equal(c.channelBillPreviewReady,false);assert.equal(c.channelBillPreviewSnapshot.length,0);
 c.submitChannelBill();assert.deepEqual(alerts,['資料暫存失敗，請重新點擊確定按鈕','請先點擊確定按鈕']);assert.equal(saves.length,0);
});
test('invalid quantities do not save a preview; saving a confirmed draft remains a draft',()=>{
 const {c,stored,saves}=setup();c.settleRows[0].settleQty=7;c.confirmChannelBillPreview();
 assert.equal(stored.size,0);assert.equal(c.channelBillPreviewReady,false);
 c.settleRows[0].settleQty=2;c.confirmChannelBillPreview();c.saveChannelBillDraft();
 assert.equal(saves.length,1);assert.equal(saves[0].draft,true);
});
