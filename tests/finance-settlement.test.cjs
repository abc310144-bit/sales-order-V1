const {test}=require('node:test');const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
function source(n){const a=html.search(new RegExp('    (?:async )?function '+n+'\\('));assert(a>=0,n);return html.slice(a,html.indexOf('\n    }',a)+6);}
function setup(){const els={},alerts=[];const c=vm.createContext({Number,String,Math,Date,Array,Set,console,
 channelProfiles:{USD:{currency:'USD',contractCurrency:'USD',monthlySettle:false,invoiceMethod:'system'},TWD:{currency:'TWD',monthlySettle:true,invoiceMethod:'finance'}},
 channelContractCurrency:n=>n==='USD'?'USD':'TWD',channelCurrency:n=>n==='USD'?'USD':'TWD',isOverseasChannel:n=>n==='USD',
 exportDeclReady:f=>!!f?.data,settleBillTaxedTotal:()=>99999,STAMP_MAX_BYTES:2097152,
 document:{getElementById:id=>els[id]||(els[id]={value:'',textContent:'',innerHTML:'',disabled:false,title:'',classList:{toggle(){},add(){},remove(){}}})},
 pdfMoney:(n,d)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}),
 escapeHtml:x=>String(x??''),formatBillSettlePeriod:()=> '2026年11月',statusTag:x=>x,
 isFinanceRole:()=>true,alert:x=>alerts.push(x),persistDemoData:()=>{throw Error('must not persist');},
 settlementRecords:[],monthlyBillViewId:'B',currentRole:'財務',
 settleLineTaxFields:line=>({untaxed:line.price,taxed:line.priceTaxed,tax:line.tax,amount:line.amount}),
 });
 vm.runInContext(['moneyCurrency','currencyMoneyDigits','roundCurrencyMoney','roundDetailMoney','currencyMoneyText','financeAmountText','financeSettlementTwd','financeBillBasis','financeLineTaxFields','channelInvoiceMethod','billRequiresFinanceInvoice','validateSettlementInvoiceFile','renderMonthlyBillTable','confirmNonMonthlySettle'].map(source).join('\n'),c);
 return {c,els,alerts};
}
test('finance reads the saved TWD total and displays an integer without recomputing order prices',()=>{
 const {c}=setup();const b={channelName:'USD',currency:'USD',settlementAmountTwd:23189.92,originalSettlementAmount:721.9,exchangeRate:999};
 assert.equal(c.financeSettlementTwd(b),23190);assert.equal(c.financeAmountText(c.financeSettlementTwd(b)),'23,190');
 assert.equal(c.financeSettlementTwd({channelName:'USD',currency:'USD',total:721.9,exchangeRate:32.123456}),23190);
 assert.equal(c.financeSettlementTwd({channelName:'USD',currency:'USD',total:721.9}),null);
 assert.equal(c.financeSettlementTwd({channelName:'TWD',currency:'TWD',total:1635}),1635);
});
test('list places one TWD total only in the applicable taxed or untaxed column',()=>{
 const {c,els}=setup();
 const a={id:'A',channelName:'TWD',priceBasis:'taxed',settlementAmountTwd:100.5,invoiceNo:'INV-A'};
 c.renderMonthlyBillTable([a]);assert.match(els.monthlyBillBody.innerHTML,/<td class="num">101<\/td>\s*<td class="num">-<\/td>/);
 const b={id:'B',channelName:'USD',priceBasis:'untaxed',settlementAmountTwd:23189.92,invoiceNo:'INV-B'};
 c.renderMonthlyBillTable([b]);assert.match(els.monthlyBillBody.innerHTML,/<td class="num">-<\/td>\s*<td class="num">23,190<\/td>/);
 assert(els.monthlyBillBody.innerHTML.includes('INV-B'));assert(!els.monthlyBillBody.innerHTML.includes('INV-A'));
 assert(html.includes('<th class="num">總結算金額(含稅)</th>'));assert(html.includes('<th class="num">總結算金額(未稅)</th>'));
});
test('invoice source is per settlement record and no longer duplicated from shipment invoices',()=>{
 const {c,els}=setup();c.billShipInvoices=()=>{throw Error('shipment invoices must not be read');};
 c.isSystemInvoiceChannel=()=>true;
 c.renderMonthlyBillTable([{id:'A',channelName:'USD',settlementAmountTwd:400,invoiceNo:'OWN-1'}]);
 assert.equal((els.monthlyBillBody.innerHTML.match(/OWN-1/g)||[]).length,1);
 assert(!source('renderMonthlyBillDetailLines').includes('const systemInvoice = isSystemInvoiceChannel'));
});
test('invoice operation follows explicit channel configuration rather than channel names or monthly flag',()=>{
 const {c}=setup();c.channelProfiles.USD.invoiceMethod='finance';
 assert.equal(c.billRequiresFinanceInvoice({channelName:'USD',monthly:false}),true);
 assert.equal(c.billRequiresFinanceInvoice({channelName:'TWD',invoiceMethod:'system',monthly:true}),false);
});
test('nonmonthly confirmation is blocked even when its handler is invoked directly',()=>{
 const {c,alerts}=setup();const b={id:'B',channelName:'USD',monthly:false,status:'待結算'};c.settlementRecords=[b];
 c.confirmNonMonthlySettle();assert.equal(b.status,'待結算');assert.equal(alerts.at(-1),'非月結通路確認結算暫不開放');
 assert(source('openMonthlyBillDetail').includes('confirmBtn.disabled = true'));
});
test('invoice attachments must be PDF or an image and smaller than 2 MB',()=>{
 const {c}=setup();assert.equal(c.validateSettlementInvoiceFile({name:'a.pdf',type:'application/pdf',size:2097151}),'');
 assert(c.validateSettlementInvoiceFile({name:'a.pdf',type:'application/pdf',size:2097152}));
 assert(c.validateSettlementInvoiceFile({name:'a.xlsx',type:'application/octet-stream',size:10}));
});
test('finance detail conversion keeps two decimals and does not modify saved source lines',()=>{
 const {c}=setup(),line={price:1.1,priceTaxed:1.16,tax:.06,amount:3.48};
 const original=JSON.stringify(line),d=c.financeLineTaxFields({channelName:'USD',currency:'USD',exchangeRate:32.123456},line);
 assert.equal(d.taxed,37.26);assert.equal(d.untaxed,35.34);assert.equal(d.amount,111.79);assert.equal(JSON.stringify(line),original);
 assert.equal(c.financeLineTaxFields({channelName:'USD',currency:'USD',exchangeRate:32},{...line,gift:true}).amount,0);
});
test('zero-total and gift-only confirmations cannot save or submit a settlement',()=>{
 const {c,alerts}=setup();let persisted=0;
 Object.assign(c,{settleRows:[{checked:true,settleQty:1,remain:1,gift:true}],channelBillTotal:()=>0,
 invalidateChannelBillPreview:()=>{c.channelBillPreviewReady=false;},channelBillPreviewReady:true,
 clearChannelBillPreview:()=>{},persistChannelBillPreview:()=>{persisted++;},renderChannelBillPreview:()=>{},syncChannelBillActionButtons:()=>{}});
 vm.runInContext(source('confirmChannelBillPreview'),c);c.confirmChannelBillPreview();
 assert.equal(persisted,0);assert.equal(c.channelBillPreviewReady,false);assert.equal(alerts.at(-1),'本次總結算金額須大於 0');
 Object.assign(c,{channelBillWizard:{channel:'USD',currency:'USD'},channelBillContractCurrency:()=> 'USD',
 channelBillCurrentRate:()=>32,channelBillExportDecl:{data:'pdf'}});
 vm.runInContext(source('channelBillSubmissionAmounts'),c);
 assert.equal(c.channelBillSubmissionAmounts([],false).error,'本次總結算金額須大於 0');
 c.channelBillTotal=()=>.01;c.channelBillCurrentRate=()=>.1;
 assert.equal(c.channelBillSubmissionAmounts([],true).error,'換算後台幣總結算金額須大於 0');
});

