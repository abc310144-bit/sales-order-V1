const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
function source(name){const a=html.indexOf(`    function ${name}(`);assert(a>=0,name);return html.slice(a,html.indexOf('\n    }',a)+6);}
function setup(overseas=false){
 const order={orderNo:'SO1',channelName:overseas?'overseas':'general',kind:overseas?'overseas':'general',items:[]};
 const c=vm.createContext({console,Number,String,Math,Date,JSON,CHANNEL_SUPPLY_TAX_RATE:.05,SETTLE_TAX_RATE:.05,
  order,salesOrders:[order],supply:{taxed:105,untaxed:100,tax:5},channelSupplyByChannel:{general:[],overseas:[]},
  getWorkspaceOrder:()=>order,isOverseasPo:o=>o?.kind==='overseas',isOnlineTransferPo:()=>false,
  isOverseasChannel:name=>name==='overseas',channelProductPriceOf:()=>c.supply,
  parsePositiveMoney:x=>x!==''&&x!=null&&Number(x)>0?Number(x):null,
  normalizeSku:x=>String(x||'').trim(),settleSourceItems:o=>o.items,itemKey:i=>i.sku,
  settleDetailMode:'edit',channelBillWizard:{on:true,channel:order.channelName,editId:'',viewId:''},
  channelBillExportDecl:null,settlementRecords:[],exportDeclReady:f=>!!f?.data,
  channelBillGroupRemarks:{},normalizeSettleRemark:x=>x||'',settleBillTypeOfRows:()=> '買斷',
  recipientListOf:o=>o.recipients||[],buildChannelSupplyRows:()=>[],
 });
 const names=['roundChannelSupplyMoney','calcChannelSupplyQuote','hasLinePriceSnapshot','saveLinePriceParts',
  'storedUnitPrice','supplyMoneyForLine','ensureChannelSupply','stampLineQuote','linePriceParts','lineMoneyOf','goodsQuoteOf',
  'accRoundMoney','accUnitPrice','channelBillPriceParts','channelBillUsesUntaxed','channelBillLineTaxed','channelBillGroupKey',
  'channelBillLinesFromRows','channelBillExportDeclEditing','inferOrderTaxMode','migrateDemoOrderTaxes'];
 vm.runInContext(names.map(source).join('\n'),c);return c;
}
test('tax selectors are removed from creation, import, and order DOM, with no obsolete listeners',()=>{
 for(const id of ['createOrderTaxMode','importOrderTaxMode','editOrderTaxMode'])assert(!html.includes('"'+id+'"'));
 assert(html.includes('id="editGoodsQuoteHead">含稅金額'));
 assert(html.includes('data-field="lineUntaxed"'));
});
test('default price snapshot is retained after catalogue price changes, regardless of manual edit flag',()=>{
 const c=setup(),i={sku:'A',qty:2};c.order.items=[i];c.stampLineQuote(c.order,i);
 assert.equal(i.unitTaxed,105);assert.equal(i.unitUntaxed,100);assert.equal(i.unitTax,5);
 c.supply={taxed:210,untaxed:200,tax:10};c.stampLineQuote(c.order,i);
 assert.equal(c.goodsQuoteOf(i,c.order),105);assert.equal(c.lineMoneyOf(c.order,i).amount,210);
 c.stampLineQuote(c.order,i,{forceSupply:true});assert.equal(i.unitTaxed,210);
});
for(const overseas of [false,true])test(`dual input uses 5% and third decimal; ${overseas?'overseas net':'general gross'} order totals`,()=>{
 const c=setup(overseas),i={sku:'A',qty:3};
 c.saveLinePriceParts(i,c.calcChannelSupplyQuote(20.123,'untaxed'),true);
 assert.equal(i.unitUntaxed,20.123);assert.equal(i.unitTaxed,21.129);assert.equal(i.unitTax,1.006);
 const money=c.lineMoneyOf(c.order,i);
 assert.equal(money.quote,21.129);assert.equal(money.other,20.123);
 assert.equal(money.amount,overseas?60.369:63.387);assert.equal(money.taxTotal,3.018);
 c.saveLinePriceParts(i,c.calcChannelSupplyQuote(105,'taxed'),true);
 assert.equal(i.unitUntaxed,100);assert.equal(i.unitTax,5);
});
test('legacy saved untaxed and taxed orders migrate their saved prices, not current catalogue values',()=>{
 const c=setup();c.supply={taxed:999,untaxed:900,tax:99};
 c.order.orderTaxMode='untaxed';c.order.orderTaxReady=true;c.order.items=[{sku:'A',quoteFrozen:100,qty:1}];
 c.migrateDemoOrderTaxes();assert.equal(c.order.items[0].unitTaxed,105);assert.equal(c.order.items[0].unitUntaxed,100);
 c.supply={taxed:2000,untaxed:1900,tax:100};c.migrateDemoOrderTaxes();assert.equal(c.order.items[0].unitTaxed,105);
});
test('general settlement uses saved gross price without applying tax twice',()=>{
 const c=setup(),i={sku:'A',qty:10};c.saveLinePriceParts(i,c.calcChannelSupplyQuote(105,'taxed'),true);c.order.items=[i];
 c.supply={taxed:999,untaxed:900,tax:99};
 const row={orderNo:'SO1',sku:'A',key:'A',settleQty:2,price:900};
 assert.equal(c.channelBillLineTaxed(row,2),210);
 const bill=c.channelBillLinesFromRows([row]);assert.equal(bill.total,210);assert.equal(bill.lines[0].price,100);assert.equal(bill.lines[0].priceTaxed,105);
});
test('overseas declaration selects saved net/gross for the entire bill, and gifts are always zero',()=>{
 const c=setup(true),i={sku:'A',qty:10};c.saveLinePriceParts(i,c.calcChannelSupplyQuote(100,'untaxed'),true);c.order.items=[i];
 const row={orderNo:'SO1',sku:'A',key:'A',settleQty:2};
 assert.equal(c.channelBillLineTaxed(row,2),210);
 c.channelBillExportDecl={data:'file'};assert.equal(c.channelBillLineTaxed(row,2),200);
 assert.equal(c.channelBillLinesFromRows([row]).total,200);
 assert.equal(c.channelBillLineTaxed({...row,gift:true},2),0);
 c.channelBillExportDecl=null;assert.equal(c.channelBillLineTaxed(row,2),210);
 assert.equal(c.channelBillLineTaxed({...row,gift:true},2),0);
});
test('a saved bill keeps its actual two unit prices and chosen basis when viewed',()=>{
 const c=setup(true);c.settleDetailMode='view';c.channelBillWizard.viewId='B1';c.settlementRecords=[{id:'B1',priceBasis:'taxed'}];
 const row={price:100,priceTaxed:105,orderNo:'SO1',sku:'A'};
 assert.equal(c.channelBillLineTaxed(row,2),210);
 c.settlementRecords[0].priceBasis='untaxed';assert.equal(c.channelBillLineTaxed(row,2),200);
});
test('declaration upload/delete invalidates preview and rerenders amounts',()=>{
 const c=setup(true);let invalid=0,rendered=0,synced=0;
 c.invalidateChannelBillPreview=()=>invalid++;c.renderChannelBillDraft=()=>rendered++;c.syncChannelBillExportDeclUi=()=>synced++;
 vm.runInContext(source('onChannelBillDeclarationChanged'),c);c.onChannelBillDeclarationChanged();
 assert.equal(invalid,1);assert.equal(rendered,1);assert.equal(synced,1);
 assert(html.includes('channelBillExportDecl = null;\n      onChannelBillDeclarationChanged();'));
 assert(html.includes('uploadedAt: nowStamp(),\n        };\n        onChannelBillDeclarationChanged();'));
});
test('declaration cannot be added or deleted after submission, including a rejected bill',()=>{
 const c=setup(true);assert.equal(c.channelBillExportDeclEditing(),true);
 c.channelBillWizard.editId='B';const bill={id:'B',status:'草稿'};c.settlementRecords=[bill];
 assert.equal(c.channelBillExportDeclEditing(),true);
 for(const status of ['待結算','已結算','財務駁回']){bill.status=status;assert.equal(c.channelBillExportDeclEditing(),false);}
 bill.status='草稿';bill.submittedAt='2026-11-19';assert.equal(c.channelBillExportDeclEditing(),false);
});
test('saving a draft after declaration deletion clears the saved old file, without holding quantity',()=>{
 const c=setup(true);const bill={id:'B',status:'草稿',exportDeclFile:{data:'old'}};
 c.channelBillWizard.editId='B';c.settlementRecords=[bill];c.channelBillCanEdit=()=>true;c.releaseBillQty=()=>{};
 c.channelBillLinesFromRows=()=>({type:'轉單',channelName:'overseas',total:105,lines:[],shipNo:'SHIP'});
 c.isMonthlySettleChannel=()=>false;c.currentRole='主管';
 vm.runInContext(source('saveChannelBillRecord'),c);c.saveChannelBillRecord([],true);
 assert.equal(bill.exportDeclFile,null);assert.equal(bill.status,'草稿');assert.equal(bill.qtyHeld,false);assert.equal(bill.priceBasis,'taxed');
});
test('overseas importer accepts SKU/quantity without any price column and defaults to no-label',()=>{
 const c=setup(true);c.overseasHeaderKey=x=>String(x).trim().toLowerCase();c.channelBoundSkuMap=()=>({a:{sku:'A'}});
 c.overseasResolveImportBatch=()=>({batch:''});c.overseasImportedLine=(sku,qty,b,g,basis)=>({sku,qty,basis});
 vm.runInContext(['overseasImportColumns','overseasQuoteBasis','overseasKindGift','overseasOrderPcs','overseasItemsFromMatrix'].map(source).join('\n'),c);
 const result=c.overseasItemsFromMatrix([{A:'SKU',B:'預計出貨數量(下定數量)'},{A:'A',B:3}],'overseas');
 assert(!result.error);assert.equal(result.items[0].qty,3);assert.equal(result.items[0].basis,'noLabel');
});
test('prices survive online-transfer settlement aggregation and exchange normalization',()=>{
 const c=setup();c.isOnlineTransferPo=()=>true;c.normalizeExchangeItems=x=>x||[];
 const item={sku:'A',qty:2,unitTaxed:105,unitUntaxed:100,unitTax:5};c.order.recipients=[{items:[item]}];
 vm.runInContext(source('settleSourceItems'),c);const merged=c.settleSourceItems(c.order);
 assert.equal(merged[0].unitTaxed,105);assert.equal(merged[0].unitUntaxed,100);
 vm.runInContext(source('normalizeExchangeItems'),c);assert.equal(c.normalizeExchangeItems([item])[0].unitTaxed,105);
});


test('copied orders obtain current catalogue prices while original saved orders stay unchanged',()=>{
 const c=setup(),original={sku:'A',qty:2};c.saveLinePriceParts(original,c.calcChannelSupplyQuote(105,'taxed'),true);
 c.supply={taxed:210,untaxed:200,tax:10};
 const recipient={items:[{...original}]};const draft={...c.order,items:[{...original}],recipients:[recipient]};
 vm.runInContext(source('refreshCopiedOrderPrices'),c);c.refreshCopiedOrderPrices(draft);
 assert.equal(original.unitTaxed,105);assert.equal(draft.items[0].unitTaxed,210);
 assert.equal(recipient.items[0].unitUntaxed,200);assert.equal(draft.items[0].quoteEdited,false);
});
