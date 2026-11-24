const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace(/\r\n/g,'\n');
function source(name){const a=html.indexOf(`    function ${name}(`);assert(a>=0,name);return html.slice(a,html.indexOf('\n    }',a)+6);}
function setup(currency='USD'){
 const elements={},alerts=[];let reader;
 const c=vm.createContext({Number,String,Array,JSON,Math,Date,console,
  channelProfiles:{overseas:{currency,contractCurrency:currency},general:{currency:'TWD'}},
  channelBillWizard:{on:true,channel:'overseas',currency,editId:'',settleYear:2026,settleMonth:11},settleDetailMode:'edit',
  channelBillExchangeRate:null,channelBillExportDecl:null,channelBillDeclReading:false,channelBillDeclReadVersion:0,
  channelBillPreviewReady:true,STAMP_MAX_BYTES:2*1024*1024,SETTLE_FILE_STORE_LIMIT:1500000,
  isOverseasChannel:x=>x==='overseas',channelBillTotal:()=>721.9,exportDeclReady:f=>!!f?.data,
  channelBillExportDeclEditing:()=>true,channelBillCheckedShipCount:()=>1,
  onChannelBillDeclarationChanged:()=>{c.channelBillPreviewReady=false;},nowStamp:()=> '2026-11-20',
  alert:x=>alerts.push(x),confirm:()=>true,
  document:{getElementById:id=>elements[id]||(elements[id]={value:'',textContent:'',disabled:false,files:[],
   classList:{add(){},remove(){},toggle(){}},focus(){}})},
  FileReader:class {constructor(){reader=this;}readAsDataURL(file){this.result='data:application/pdf;base64,TEST';}},
 });
 const names=['moneyCurrency','currencyMoneyDigits','roundCurrencyMoney','roundDetailMoney','channelContractCurrency',
  'channelBillContractCurrency','channelBillCurrentRate','channelBillSubmissionAmounts','validateChannelBillDeclInput',
  'showChannelBillDeclError','openChannelBillExportDeclPicker','closeChannelBillExportDeclModal',
  'confirmChannelBillExportDecl','deleteChannelBillExportDecl','sanitizeSettlementForStore'];
 vm.runInContext(names.map(source).join('\n'),c);
 return {c,elements,alerts,reader:()=>reader};
}
const pdf={name:'出口報單.pdf',type:'application/pdf',size:1024};
test('original contract currency remains authoritative when current channel currency changes',()=>{
 const {c}=setup();c.channelProfiles.overseas.currency='TWD';
 assert.equal(c.channelContractCurrency('overseas'),'USD');assert.equal(c.channelBillContractCurrency(),'USD');
 c.channelBillWizard.currency='EUR';assert.equal(c.channelBillContractCurrency(),'EUR');
});
test('foreign submission requires one declaration and a finite positive rate before conversion',()=>{
 const {c}=setup();assert(c.channelBillSubmissionAmounts([],true).error);
 c.channelBillExportDecl={data:'pdf'};
 for(const rate of [null,'',0,-1,NaN,Infinity]){c.channelBillExchangeRate=rate;assert(c.channelBillSubmissionAmounts([],true).error);}
 c.channelBillExchangeRate=32.123456;
 const result=c.channelBillSubmissionAmounts([],true);
 assert.equal(result.currency,'USD');assert.equal(result.originalAmount,721.9);
 assert.equal(result.amountTwd,23190);assert.equal(result.exchangeRate,32.123456);
 c.channelBillExchangeRate=1e308;assert(c.channelBillSubmissionAmounts([],true).error);
});
test('TWD overseas rate is forced to one and submission without a declaration is allowed',()=>{
 const {c}=setup('TWD');c.channelBillExchangeRate=33;
 assert.equal(c.channelBillCurrentRate(),1);
 const result=c.channelBillSubmissionAmounts([],true);assert.equal(result.amountTwd,722);assert.equal(result.exchangeRate,1);assert(!result.error);
 c.openChannelBillExportDeclPicker();assert.equal(c.document.getElementById('channelBillExportRate').readOnly,true);
 assert.equal(c.document.getElementById('channelBillExportRateBase').textContent,'1 TWD ＝');
});
test('modal validates file count, supported formats, size, replacement and rate',()=>{
 const {c}=setup();const v=(rate,files,existing)=>c.validateChannelBillDeclInput('USD',rate,files,existing);
 assert(v('',[pdf]).error);assert(v('0',[pdf]).error);assert(v('-2',[pdf]).error);assert(v('Infinity',[pdf]).error);
 assert(v('32',[]).error);assert(v('32',[pdf,pdf]).error);
 assert(v('32',[{...pdf,name:'bad.xlsx',type:'application/octet-stream'}]).error);
 assert(v('32',[{...pdf,type:'text/html'}]).error);
 assert(v('32',[{...pdf,size:2*1024*1024}]).error);assert(v('32',[{...pdf,size:0}]).error);
 assert.equal(v('32.123456',[pdf]).rate,32.123456);
 assert.equal(v('33',[],{data:'old'}).rate,33);
 assert.equal(c.validateChannelBillDeclInput('TWD','bad',[pdf]).rate,1);
});
test('cancel and file read failure preserve accepted file/rate; confirmed replacement invalidates preview',()=>{
 const {c,reader}=setup();c.channelBillExportDecl={data:'old',name:'old.pdf'};c.channelBillExchangeRate=31;
 c.openChannelBillExportDeclPicker();c.document.getElementById('channelBillExportRate').value='99';c.closeChannelBillExportDeclModal();
 assert.equal(c.channelBillExchangeRate,31);assert.equal(c.channelBillExportDecl.name,'old.pdf');
 c.openChannelBillExportDeclPicker();c.document.getElementById('channelBillExportRate').value='32';
 c.document.getElementById('exportDeclFileInput').files=[pdf];c.confirmChannelBillExportDecl({preventDefault(){}});
 reader().onerror();assert.equal(c.channelBillExchangeRate,31);assert.equal(c.channelBillExportDecl.name,'old.pdf');
 c.confirmChannelBillExportDecl({preventDefault(){}});reader().onload();
 assert.equal(c.channelBillExchangeRate,32);assert.equal(c.channelBillExportDecl.name,pdf.name);assert.equal(c.channelBillPreviewReady,false);
 c.channelBillPreviewReady=true;c.deleteChannelBillExportDecl();
 assert.equal(c.channelBillExportDecl,null);assert.equal(c.channelBillCurrentRate(),null);assert.equal(c.channelBillPreviewReady,false);
});
test('closing during file read prevents late callback from replacing accepted data',()=>{
 const {c,reader}=setup();c.channelBillExportDecl={data:'old'};c.channelBillExchangeRate=31;
 c.openChannelBillExportDeclPicker();c.document.getElementById('channelBillExportRate').value='32';
 c.document.getElementById('exportDeclFileInput').files=[pdf];c.confirmChannelBillExportDecl({preventDefault(){}});
 c.closeChannelBillExportDeclModal();reader().onload();assert.equal(c.channelBillExchangeRate,31);assert.equal(c.channelBillExportDecl.data,'old');
});
test('valid declaration attachments survive persistence rather than being silently discarded',()=>{
 const {c}=setup();const file={data:'x'.repeat(2100000)};
 assert.equal(c.sanitizeSettlementForStore({exportDeclFile:file}).exportDeclFile.data.length,2100000);
});
