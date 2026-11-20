const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
test('settlement eligibility follows cooperation mode with no named-channel exceptions',()=>{
 const c=vm.createContext({channelProfiles:{online:{acceptFlow:'轉單'},overseas:{acceptFlow:'轉單'},consign:{acceptFlow:'寄倉'}},
  isOverseasChannel:n=>n==='overseas',validShipsOfPo:()=>c.ships,ships:[]});
 vm.runInContext(['channelAcceptFlow','isTransferAcceptFlow','isTransferSettleShip','isSettlementSourceOrder','channelBillSettleShips'].map(source).join('\n'),c);
 assert.equal(c.channelAcceptFlow('overseas'),'買斷');
 for(const channelName of ['online','overseas','consign']){
  const order={orderNo:'SO',channelName};c.ships=[{online:channelName==='online',shipped:'2026-11-19',status:'已出貨'}];
  assert.equal(c.isSettlementSourceOrder(order),false);assert.equal(c.channelBillSettleShips(order).length,0);
  c.ships[0].status=channelName==='online'?'已配達':'已驗收';
  assert.equal(c.isSettlementSourceOrder(order),true);assert.equal(c.channelBillSettleShips(order).length,1);
 }
});
function source(name){const a=html.indexOf(`    function ${name}(`);assert(a>=0,name);return html.slice(a,html.indexOf('\n    }',a)+6);}
function setup(overseas=false){
 const order={orderNo:'SO1',channelName:overseas?'overseas':'general',kind:overseas?'overseas':'general',items:[]};
 const c=vm.createContext({console,Number,String,Math,Date,JSON,CHANNEL_SUPPLY_TAX_RATE:.05,SETTLE_TAX_RATE:.05,
  order,salesOrders:[order],supply:{taxed:105,untaxed:100,tax:5},channelSupplyByChannel:{general:[],overseas:[]},
  getWorkspaceOrder:()=>order,isOverseasPo:o=>o?.kind==='overseas',isOnlineTransferPo:()=>false,
  channelSupplyChannelName:'',channelCurrency:n=>n==='overseas'?'USD':'TWD',
  isOverseasChannel:name=>name==='overseas',channelProductPriceOf:()=>c.supply,
  parsePositiveMoney:x=>x!==''&&x!=null&&Number(x)>0?Number(x):null,
  normalizeSku:x=>String(x||'').trim(),settleSourceItems:o=>o.items,itemKey:i=>i.sku,
  settleDetailMode:'edit',channelBillWizard:{on:true,channel:order.channelName,editId:'',viewId:''},
  channelBillExportDecl:null,settlementRecords:[],exportDeclReady:f=>!!f?.data,
  channelBillGroupRemarks:{},normalizeSettleRemark:x=>x||'',settleBillTypeOfRows:()=> '買斷',
  recipientListOf:o=>o.recipients||[],buildChannelSupplyRows:()=>[],
 });
 const names=['roundDetailMoney','documentTaxTotals','orderTaxTotals','billTaxTotals','channelBillTotals','channelBillTotal','settleBillTaxedTotal','limitManualMoneyInput','moneyCurrency','currencyMoneyDigits','roundCurrencyMoney','activeFinanceCurrency','roundChannelSupplyMoney','calcChannelSupplyQuote','hasLinePriceSnapshot','saveLinePriceParts',
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
for(const overseas of [false,true])test(`detail conversions and line amounts use two decimals for ${overseas?'foreign currency':'TWD'}`,()=>{
 const c=setup(overseas),i={sku:'A',qty:3};
 c.saveLinePriceParts(i,c.calcChannelSupplyQuote(20.123,'untaxed'),true);
 assert.equal(i.unitUntaxed,20.12);assert.equal(i.unitTaxed,21.13);assert.equal(i.unitTax,1.01);
 const money=c.lineMoneyOf(c.order,i);
 assert.equal(money.quote,21.13);assert.equal(money.other,20.12);
 assert.equal(money.amount,overseas?60.36:63.39);assert.equal(money.taxTotal,3.03);
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
test('declaration can change on drafts and rejected bills, but not pending or settled bills',()=>{
 const c=setup(true);assert.equal(c.channelBillExportDeclEditing(),true);
 c.channelBillWizard.editId='B';const bill={id:'B',status:'草稿'};c.settlementRecords=[bill];
 assert.equal(c.channelBillExportDeclEditing(),true);
 for(const status of ['待結算','已結算','已作廢']){bill.status=status;assert.equal(c.channelBillExportDeclEditing(),false);}
 for(const status of ['草稿','財務駁回']){bill.status=status;bill.submittedAt='2026-11-19';assert.equal(c.channelBillExportDeclEditing(),true);}
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

test('whole-document totals reverse tax from gross, allowing a difference from summed detail net',()=>{
 const c=setup(true),i={sku:'A',qty:100};c.saveLinePriceParts(i,c.calcChannelSupplyQuote(.1,'untaxed'),true);c.order.items=[i];
 assert.equal(c.lineMoneyOf(c.order,i).amount,10);
 const row={orderNo:'SO1',channelName:'overseas',sku:'A',key:'A',settleQty:100};
 assert.equal(c.channelBillTotal([row]),11);c.channelBillExportDecl={data:'file'};
 assert.equal(c.channelBillTotal([row]),10.48);assert.equal(c.channelBillLinesFromRows([row]).total,10.48);
 const totals=c.orderTaxTotals(c.order);assert.equal(totals.taxed,11);assert.equal(totals.untaxed,10.48);assert.equal(totals.tax,.52);
 const saved={channelName:'overseas',priceBasis:'untaxed',lines:c.channelBillLinesFromRows([row]).lines};
 assert.equal(c.settleBillTaxedTotal(saved),10.48);
 saved.priceBasis='taxed';assert.equal(c.settleBillTaxedTotal(saved),11);
});
test('TWD totals round once after summing two-decimal details; foreign totals retain cents',()=>{
 const c=setup();
 for(const [currency,gross,net,tax] of [['TWD',21,20,1],['USD',21.2,20.19,1.01],['EUR',21.2,20.19,1.01]]){
  const total=c.documentTaxTotals([10.6,10.6],currency);
  assert.equal(total.taxed,gross);assert.equal(total.untaxed,net);assert.equal(total.tax,tax);
 }
 c.channelCurrency=()=> 'TWD';c.channelBillWizard.channel='overseas';
 const r={orderNo:'SO1',key:'A',sku:'A',settleQty:2};c.order.items=[{sku:'A',unitTaxed:10.6,unitUntaxed:10.1}];
 assert.equal(c.channelBillTotal([r]),21);
 assert.equal(c.roundDetailMoney(1.005),1.01);assert.equal(c.roundCurrencyMoney(10.5,'TWD'),11);
});
test('manual entry truncates extra decimal digits rather than rounding; system conversion rounds',()=>{
 const c=setup(),el={value:'10.129'};c.limitManualMoneyInput(el);assert.equal(el.value,'10.12');
 assert.equal(c.calcChannelSupplyQuote(10.12,'untaxed').taxed,10.63);
 el.value='5';c.limitManualMoneyInput(el);assert.equal(el.value,'5');
});
test('gift detail is retained in orders but excluded from settlement gross and reverse tax',()=>{
 const c=setup(true);c.order.items=[{sku:'A',unitTaxed:10.6,unitUntaxed:10.1}];
 const row={orderNo:'SO1',key:'A',sku:'A',settleQty:2};c.channelBillExportDecl={data:'file'};
 assert.equal(c.channelBillTotal([row,{...row,gift:true}]),20.19);
});

for(const overseas of [false,true])test(`actual ${overseas?'English overseas':'Chinese dealer'} PO renders all reverse-calculated totals`,()=>{
 const c=setup(overseas);
 Object.assign(c,{isDealerPo:()=>!overseas,partyRecord:()=>({}),channelTaxId:()=>'',
  hydratePoItemCatalogFields:()=>{},pcsPerCartonOf:()=>10,orderCartonQty:(q,p)=>q/p,
  remarksForPdfItem:()=>'',bestBeforeOfItem:()=>'',usesCollectionTerms:()=>false,
  salesDateOnly:()=> '2026-11-20',nowStamp:()=>'',formatQtyTotal:String,
  escapeHtml:x=>String(x??''),VENDOR_COMPANY:'測試公司',VENDOR_TAX_ID:'12345678',VENDOR_TEL:'',VENDOR_ADDRESS:''});
 vm.runInContext(['pdfMoney','detailMoneyText','currencyMoneyText','unitMoneyText','pdfLinesFromOrder'].map(source).join('\n'),c);
 const start=html.indexOf('    function buildPartyPoPrintHtml('),end=html.indexOf('    function pad2(',start);
 vm.runInContext(html.slice(start,end),c);
 c.order.items=[{sku:'A',qty:100,unitTaxed:.11,unitUntaxed:.1}];
 const result=c.buildPartyPoPrintHtml(c.order);
 assert(result.includes('data-po-tax-totals'));
 if(overseas){assert(result.includes('Total Including Tax：11.00'));assert(result.includes('Total Excluding Tax：10.48'));assert(result.includes('Total Tax：0.52'));}
 else {assert(result.includes('含稅合計金額：11'));assert(result.includes('未稅合計金額：10'));assert(result.includes('合計稅額：1'));}
});
