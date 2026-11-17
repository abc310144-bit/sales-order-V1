// Run: node --test tests/po-revisions.test.cjs (no dependencies).
// Execute the prototype's real functions in a VM; DOM/rendering boundaries are stubbed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function source(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, name);
  const end = html.indexOf('\n    }', start) + 6;
  return html.slice(start, end);
}
const functions = ['getWorkspaceOrder', 'validShipsOfPo', 'giftFingerprint', 'giftReviseComparable', 'giftReviseDirty',
  'poRevisionDirty', 'confirmLeavePoRevision', 'savePoRevision', 'revisionOrderAllowed',
  'canOverseasGiftRevise', 'orderHasCreatedShips', 'canExchangeOnPo', 'isExchangeLockMode',
  'submitExchangeRevise', 'submitGiftRevise', 'validateGiftReviseLines', 'normalizeExchangeItems',
  'validateRecvExchangeItems', 'syncEditFooter', 'canSubmitPo', 'canApprovePo',
  'overseasGiftExportReady', 'overseasGiftStampReady', 'overseasNeedsFirstShipDocs',
  'overseasFirstShipExportReady', 'overseasFirstShipStampReady', 'canCreateShipFromPo',
  'canShipFromPo', 'hasStampFile', 'canStampPo', 'canViewStampFile', 'rememberGiftExport'];
function setup(kind = 'online', status = '未開立出貨單', role = '主管') {
  const order = { orderNo: 'TEST', kind, status, channelName: 'test', items: [
    {sku:'A', qty:2, quoteFrozen:10}, {sku:'B',qty:1,gift:true,quoteFrozen:5,batch:''}
  ], stampFile:{data:'stamp',uploadedAt:1}, overseasExportedAt:1,
  giftExportedAt:1, giftExportedFingerprint:'' };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {textContent:'', disabled:false,
      classList:{contains:cls=>cls==='active'&&id==='page-order-edit',toggle(){},add(){},remove(){}}});
    return elements.get(id);
  };
  const c = vm.createContext({console, JSON, Number, String, Date,
    salesOrders:[order], workspaceOrder:JSON.parse(JSON.stringify(order)), currentEditOrderNo:'TEST',
    currentRole:role, orderFormMode:'edit', poWizardSessionNew:false, poExchangeCommit:false,
    EXCHANGE_PO_STATUSES:['草稿','待審核','未開立出貨單'],
    poLineItems:JSON.parse(JSON.stringify(order.items)), poGiftReviseBase:'',
    ships:[], alerts:[], writes:[], success:true, changed:true, validExchange:true,
    document:{getElementById:element,querySelectorAll:()=>[]},
    alert:msg=>c.alerts.push(msg), confirm:()=>false,
    isOverseasPo:o=>o?.kind==='overseas', isOnlineTransferPo:o=>o?.kind==='online',
    isDealerPo:()=>false, needsStampPo:o=>o.kind==='overseas', needsMarkFile:()=>false,
    remainingOnlineShipGroups:()=>[{}], shipsOfPo:()=>c.ships,
    normalizeSku:s=>String(s||'').trim(),clipPoRemark:s=>String(s||''),
    channelBoundSkuMap:()=>({a:{sku:'A'},b:{sku:'B'}}),allShipBatches:()=>['batch'],
    exchangeDirty:()=>c.changed,validateVisibleExchanges:()=>c.validExchange,
    applyRecipientForm:o=>{o.recipients=[{items:[{sku:'B',qty:2,batch:''}]}];o.items=[{sku:'B',qty:2}];},
    collectEditGoods:()=>JSON.parse(JSON.stringify(c.poLineItems)),
    persistDemoData:()=>{if(c.success)c.writes.push(JSON.stringify(c.salesOrders)); return c.success;},
    renderSalesTable(){},getSalesFiltered:()=>[],history:{replaceState(){}},poWorkspaceUrl:()=>'',
    fillOrderEdit:o=>{c.workspaceOrder=o;c.orderFormMode='view';}, setPoTab(){},
    isGiftReviseEdit:()=>c.orderFormMode==='edit'&&c.canOverseasGiftRevise(c.workspaceOrder),
    syncPoShipTab(){},setBtnEnabled:(id,on)=>{element(id).disabled=!on;},
    syncStampButton(){},syncCopyButton(){},canExportPoPdf:()=>false,canConfirmPoComplete:()=>false
  });
  vm.runInContext(functions.map(source).join('\n'),c);
  c.poGiftReviseBase=c.giftReviseComparable(order.items);
  order.giftExportedFingerprint=c.giftFingerprint(order);
  c.workspaceOrder.giftExportedFingerprint=order.giftExportedFingerprint;
  c.element=element;
  return c;
}

test('all inline application scripts parse',()=>{
  let count=0;
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if(!/\bsrc=/.test(m[1])) {new vm.Script(m[2]);count++;}
  }
  assert.ok(count>0);
});
for(const kind of ['online','overseas']) {
  for(const role of ['主管','建檔人']) {
    for(const status of kind==='overseas'?['待審核','待回壓文件','未開立出貨單']:['待審核','未開立出貨單']) {
      test(`${kind}/${role}/${status}: explicit save, correct label and state`,()=>{
        const c=setup(kind,status,role);
        c.poLineItems[1].qty=2;
        c.syncEditFooter(c.workspaceOrder,'edit');
        assert.equal(c.element('editSubmit').textContent,role==='主管'?'儲存變更':'送出申請');
        assert.equal(c.writes.length,0);
        assert.equal(c.salesOrders[0].items[1].qty,1);
        if(kind==='online') c.submitExchangeRevise(); else c.submitGiftRevise();
        assert.equal(c.writes.length,1);
        const expected=role==='建檔人'?'待審核':(kind==='overseas'&&status!=='待審核'?'待回壓文件':status);
        assert.equal(c.salesOrders[0].status,expected);
        assert.equal(c.alerts.at(-1),role==='主管'?'儲存成功':kind==='online'&&status==='未開立出貨單'?'已送出申請。狀態改為待審核。主管審核通過後才能新增出貨單。':'已送出申請');
        assert.equal(JSON.parse(c.writes[0])[0].status,expected);
      });
    }
  }
  test(`${kind}: persistence failure preserves form, saved order and retry`,()=>{
    const c=setup(kind);c.poLineItems[1].qty=2;c.success=false;
    const original=JSON.stringify(c.salesOrders);
    const save=()=>kind==='online'?c.submitExchangeRevise():c.submitGiftRevise();
    save();assert.equal(JSON.stringify(c.salesOrders),original);
    assert.equal(c.orderFormMode,'edit');assert.equal(c.poLineItems[1].qty,2);
    assert.deepEqual(c.alerts,['儲存失敗，請重試']);assert.equal(c.writes.length,0);
    c.success=true;save();assert.equal(c.writes.length,1);assert.equal(c.alerts.at(-1),'儲存成功');
  });
  test(`${kind}: cancel or confirm leaving never persists`,()=>{
    const c=setup(kind);c.poLineItems[1].qty=2;
    const original=JSON.stringify(c.salesOrders);
    assert.equal(c.confirmLeavePoRevision(),false);assert.ok(c.workspaceOrder);
    c.confirm=()=>true;assert.equal(c.confirmLeavePoRevision(),true);
    assert.equal(c.workspaceOrder,null);assert.equal(JSON.stringify(c.salesOrders),original);assert.equal(c.writes.length,0);
  });
  test(`${kind}: a newly created valid shipment blocks saving regardless of status label`,()=>{
    const c=setup(kind);c.poLineItems[1].qty=2;c.ships=[{status:'待拋單'}];
    if(kind==='online')c.submitExchangeRevise();else c.submitGiftRevise();
    assert.equal(c.writes.length,0);assert.match(c.alerts.at(-1),/已建立出貨單/);
    c.ships=[{status:'訂單取消'},{status:'訂單取消'}];
    if(kind==='online')c.submitExchangeRevise();else c.submitGiftRevise();
    assert.equal(c.writes.length,1);
  });
}
test('overseas PO invalidation includes removal of every gift; fresh export AND stamp required',()=>{
  const c=setup('overseas');c.poLineItems=c.poLineItems.filter(i=>!i.gift);
  c.submitGiftRevise();const o=c.salesOrders[0];
  assert.equal(o.status,'待回壓文件');assert.equal(c.canCreateShipFromPo(o),false);
  assert.equal(c.canViewStampFile(o),false);assert.equal(c.canStampPo(o),false);
  o.overseasExportedAt=Date.now();c.rememberGiftExport(o);
  assert.equal(c.canStampPo(o),true);assert.equal(c.canCreateShipFromPo(o),false);
  o.stampFile={data:'new stamp',uploadedAt:Date.now()+1};o.status='未開立出貨單';
  assert.equal(c.canCreateShipFromPo(o),true);
});
for(const bad of [{sku:''},{qty:0},{qty:-1},{qty:1.5},{quoteFrozen:''},{quoteFrozen:NaN},{quoteFrozen:0},{batch:'unknown'}]) {
  test(`gift validation rejects ${JSON.stringify(bad)}`,()=>{
    const c=setup('overseas');Object.assign(c.poLineItems[1],bad);
    assert.equal(c.validateGiftReviseLines(),false);assert.equal(c.writes.length,0);
  });
}
test('gift optional batch uses FIFO and incomplete added gift enables validation',()=>{
  const c=setup('overseas');assert.equal(c.validateGiftReviseLines(),true);
  c.poLineItems.push({gift:true,giftDraft:true,sku:'',qty:0});
  assert.equal(c.giftReviseDirty(),true);assert.equal(c.validateGiftReviseLines(),false);
});
test('exchange rejects invalid additional rows instead of silently discarding them',()=>{
  const c=setup();const good={sku:'A',qty:1,batch:''};
  assert.ok(c.validateRecvExchangeItems([good],'test'));
  for(const bad of [{sku:'',qty:1},{sku:'A',qty:0},{sku:'A',qty:-1},{sku:'A',qty:1.5},{sku:'unknown',qty:1}])
    assert.equal(c.validateRecvExchangeItems([good,bad],'test'),null);
});
test('same PO gift content keeps existing stamp and approved state',()=>{
  const c=setup('overseas');c.poLineItems[1].quoteFrozen=6;
  c.submitGiftRevise();assert.equal(c.salesOrders[0].status,'未開立出貨單');
  assert.ok(c.salesOrders[0].stampFile);assert.equal(c.canCreateShipFromPo(c.salesOrders[0]),true);
});
test('changed live status blocks save without losing edits',()=>{
  const c=setup();c.salesOrders[0].status='已作廢';c.submitExchangeRevise();
  assert.equal(c.writes.length,0);assert.equal(c.orderFormMode,'edit');
});
test('gift validation checks displayed fractional quantity before normalization',()=>{
  const c=setup('overseas');let focused=false;
  const input={value:'1.5',classList:{toggle(){}},setAttribute(){},focus(){focused=true;}};
  c.document.querySelectorAll=()=>[{querySelector:selector=>selector.includes('qty')?input:null}];
  assert.equal(c.validateGiftReviseLines(),false);assert.equal(focused,true);assert.equal(c.writes.length,0);
});
test('visible exchange row with zero quantity is rejected with field error',()=>{
  const c=setup();let focused=false;
  const sku={value:'A',setAttribute(){}};
  const qty={value:'0',setAttribute(){},focus(){focused=true;}};
  const row={querySelector:selector=>selector.includes('sku')?sku:qty};
  const block={querySelectorAll:()=>[row]};
  const item={getAttribute:()=> 'item1'};
  const body={querySelectorAll:()=>[item],querySelector:()=>block};
  c.document.getElementById=()=>body;c.CSS={escape:s=>s};
  vm.runInContext(source('validateVisibleExchanges'),c);
  assert.equal(c.validateVisibleExchanges(),false);assert.equal(focused,true);
});
test('role switching preserves edit mode and changes the revision label',()=>{
  const c=setup('overseas','待審核','建檔人');
  c.changed=false;c.onAcceptanceRoleChange=()=>{};
  let renderedMode;
  c.fillOrderEdit=(order,mode)=>{renderedMode=mode;c.orderFormMode=mode;c.workspaceOrder=order;c.syncEditFooter(order,mode);};
  const start=html.indexOf('document.getElementById("operatorRole").addEventListener("change", (e) => {');
  const bodyStart=html.indexOf('\n',start)+1;
  const bodyEnd=html.indexOf('\n    });',bodyStart);
  vm.runInContext(`(function(e){${html.slice(bodyStart,bodyEnd)}})({target:{value:'主管'}})`,c);
  assert.equal(renderedMode,'edit');assert.equal(c.element('editSubmit').textContent,'儲存變更');
});
