const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
function source(name){const a=html.indexOf(`    function ${name}(`);assert(a>=0,name);return html.slice(a,html.indexOf('\n    }',a)+6);}
for(const flow of ['買斷','轉單'])test(`${flow} filters combine fuzzy SKU and actual order creation dates with existing selections`,()=>{
 const fields={};
 const c=vm.createContext({channelBillIsShipFlow:()=>true,document:{getElementById:id=>({value:fields[id]||''})},
  channelBillPickOrders:[],channelBillPickShips:[],salesOrders:[{orderNo:'SO1',createdAt:'2026-01-12 09:00:00'}],
  channelBillRowInShippedRange:()=>true});
 vm.runInContext(['inDateRange','channelBillRowMatchesFilter'].map(source).join('\n'),c);
 const line={orderNo:'SO1',shipNo:'SHIP1',sku:'UM-1002',createdAt:'2026-11-19'};
 fields.channelBillDraftSku='um-10';assert.equal(c.channelBillRowMatchesFilter(line),true);
 fields.channelBillDraftSku='um-99';assert.equal(c.channelBillRowMatchesFilter(line),false);
 fields.channelBillDraftSku='um-10';fields.channelBillDraftOrderFrom='2026-01-12';fields.channelBillDraftOrderTo='2026-01-12';
 assert.equal(c.channelBillRowMatchesFilter(line),true);
 fields.channelBillDraftOrderFrom='2026-11-01';fields.channelBillDraftOrderTo='2026-11-30';
 assert.equal(c.channelBillRowMatchesFilter(line),false);
 fields.channelBillDraftOrderFrom='';fields.channelBillDraftOrderTo='';c.channelBillPickShips=['OTHER'];
 assert.equal(c.channelBillRowMatchesFilter(line),false);c.channelBillPickShips=[];
 assert.equal(c.channelBillRowMatchesFilter(line),true);
});
const header={A:'客戶訂單編號',B:'出貨單編號',C:'通路商品編號',D:'SKU',E:'商品名稱',F:'結算數量'};
function row(values={}){return {A:'SO1',B:'SHIP1',C:'CP1',D:'',E:'不同商品名稱也可以',F:'2',...values};}
function setup(){
 const c=vm.createContext({Number,String,Math,JSON,alerts:[],invalidations:0,
  settleRows:[{id:'1',orderNo:'SO1',shipNo:'SHIP1',productCode:'CP1',sku:'SKU1',remain:5,checked:false,settleQty:0},
   {id:'2',orderNo:'SO1',shipNo:'SHIP2',productCode:'CP1',sku:'SKU1',remain:3,checked:true,settleQty:1},
   {id:'gift',orderNo:'SO1',shipNo:'SHIP1',productCode:'GIFT1',sku:'GIFT-SKU',remain:2,gift:true,checked:false,settleQty:0}],
  normalizeSku:x=>String(x||'').trim(),isPositiveIntQty:x=>Number.isInteger(Number(x))&&Number(x)>0,
  alert:x=>c.alerts.push(x),channelBillApplied:false,channelBillIsShipFlow:()=>true,
  channelBillPickOrders:[],channelBillPickShips:[],refreshChannelBillMultiLabels:()=>{},expandAllChannelBillGroups:()=>{},
  invalidateChannelBillPreview:()=>c.invalidations++,renderChannelBillDraft:()=>{},
 });
 vm.runInContext(['recordsFromHeaderMatrix','settleImportField','applyChannelBillImport'].map(source).join('\n'),c);return c;
}
test('new six-column import locates by order/ship/channel code, permits blank SKU and different name, replaces old picks',()=>{
 const c=setup();assert.equal(c.applyChannelBillImport([header,row()]),true);
 assert.equal(c.settleRows[0].checked,true);assert.equal(c.settleRows[0].settleQty,2);
 assert.equal(c.settleRows[1].checked,false);assert.equal(c.settleRows[1].settleQty,0);
 assert.equal(c.settleRows[2].checked,false);assert.equal(c.invalidations,1);
});
test('filled SKU must match the channel-code target; no fallback to SKU or product name',()=>{
 const c=setup();assert.equal(c.applyChannelBillImport([header,row({D:'WRONG'})]),false);
 assert.match(c.alerts[0],/SKU WRONG/);assert.equal(c.settleRows[1].checked,true);
 assert.equal(c.applyChannelBillImport([header,row({C:'WRONG',D:'SKU1'})]),false);
});
for(const col of ['A','B','C','E','F'])test(`required column ${col} is checked for headers and values`,()=>{
 const c=setup(),missing={...header};delete missing[col];
 assert.equal(c.applyChannelBillImport([missing,row()]),false);assert.match(c.alerts[0],/缺少必要欄位/);
 assert.equal(c.applyChannelBillImport([header,row({[col]:''})]),false);assert.match(c.alerts[1],/為必填/);
});
test('duplicate identity is rejected even when optional SKU differs, and all selections stay untouched',()=>{
 const c=setup();assert.equal(c.applyChannelBillImport([header,row(),row({D:'SKU1'})]),false);
 assert.match(c.alerts[0],/重複/);assert.equal(c.settleRows[0].checked,false);assert.equal(c.settleRows[1].settleQty,1);
});
test('bad row prevents the entire import and reports actual worksheet row after a blank row',()=>{
 const c=setup();assert.equal(c.applyChannelBillImport([header,row(),{},row({B:'OTHER-CHANNEL'})]),false);
 assert.match(c.alerts[0],/第 4 列/);assert.equal(c.settleRows[0].checked,false);assert.equal(c.invalidations,0);
});
test('quantity must be positive integer and within the exact shipment remaining quantity',()=>{
 for(const F of ['0','-1','1.5','NaN','6']){const c=setup();assert.equal(c.applyChannelBillImport([header,row({F})]),false);}
 const c=setup();assert.equal(c.applyChannelBillImport([header,row({B:'SHIP2',F:'3'})]),true);
 assert.equal(c.settleRows[1].settleQty,3);
});
test('gifts are selected only when listed in the file and keep their system gift type',()=>{
 const c=setup();assert.equal(c.applyChannelBillImport([header,row({C:'GIFT1',F:'2'})]),true);
 assert.equal(c.settleRows[2].checked,true);assert.equal(c.settleRows[2].gift,true);assert.equal(c.settleRows[0].checked,false);
});
test('channel catalogue item code is carried into buyout and consignment import rows',()=>{
 const c=setup();c.channelSupplyRowOf=()=>({channelProductNo:'CHANNEL-CODE'});c.metaForSku=()=>({productCode:'MASTER-CODE'});
 vm.runInContext(source('settleChannelProductCode'),c);
 assert.equal(c.settleChannelProductCode({channelName:'C'},{sku:'SKU1',productCode:'MASTER-CODE'}),'CHANNEL-CODE');
 assert(source('channelBillAdjustedLines').includes('productCode: line.productCode'));
 assert(source('buildConsignChannelBillRows').includes('productCode: line.productCode || priced.productCode'));
});
test('reopening rejected bills retains the existing quantity restore and cap behavior',()=>{
 const body=source('openChannelBillEdit');
 assert(body.includes('row.settleQty = Math.min(Number(line.qty) || 0, Number(row.remain) || 0)'));
});
