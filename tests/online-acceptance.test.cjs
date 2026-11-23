const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8').replace(/\r\n/g, '\n');
function source(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert(start >= 0, name);
  return html.slice(start, html.indexOf('\n    }', start) + 6);
}
function setup() {
  const controls = new Map();
  const c = vm.createContext({
    rows: [], salesOrders: [], channelBillWizard: { channel: 'consign' },
    channelProfiles: { consign: { acceptFlow: '寄倉' }, buyout: { acceptFlow: '買斷' }, transfer: { acceptFlow: '轉單' } },
    isOverseasChannel: () => false, nowStamp: () => '2026-11-23',
    document: { getElementById(id) {
      if (!controls.has(id)) controls.set(id, { value: '', innerHTML: '', firstChild: {}, classList: { toggle() {}, remove() {} } });
      return controls.get(id);
    } },
    itemKey: line => line.sku, normalizeSku: x => x, escapeHtml: String, statusTag: String,
    pcsPerCartonOf: () => 1, renderShipAcceptTable() {}, showPage() {},
    invoicedQtyByKey: () => ({}), settleSourceItems: order => order.items || [],
    goodsDisplayFields: item => item, accUnitPrice: () => 10,
    settleChannelProductCode: () => 'P', hasPriceWithLabel: () => false,
    accRoundMoney: x => Math.round(x * 100) / 100,
    validShipsOfPo: no => c.rows.filter(ship => ship.salesOrderNo === no && ship.status !== '訂單取消'),
    settleRowKey: (...parts) => parts.join('|'), accLinesOf: () => [],
  });
  vm.runInContext([
    'channelAcceptFlow', 'isTransferAcceptFlow', 'demoActualShipQty', 'normalizeNonOnlineShipStatuses',
    'isTransferSettleShip', 'isSettlementSourceOrder', 'channelBillSettleShips', 'consignAcceptedShips',
    'shipSettleLines', 'buildConsignChannelBillRows', 'openShipAcceptPage', 'shipAcceptanceLink',
  ].map(source).join('\n'), c);
  return { c, controls };
}
test('online delivery branches by cooperation mode and normalization is idempotent', () => {
  const { c } = setup();
  c.rows = ['consign', 'buyout', 'transfer'].map(channel => ({ channel, online: true, status: '已配達', items: [{ sku: 'A', qty: 10 }] }));
  c.normalizeNonOnlineShipStatuses();
  assert.deepEqual(Array.from(c.rows, ship => ship.status), ['待驗收', '待驗收', '已配達']);
  c.rows[0].status = '已驗收';
  c.normalizeNonOnlineShipStatuses();
  assert.equal(c.rows[0].acceptance.items[0].acceptQty, 10);
  c.normalizeNonOnlineShipStatuses();
  assert.equal(c.rows[2].status, '已配達');
});
test('each online shipment accepts its own actual shipped quantities and opens readonly after acceptance', () => {
  const { c, controls } = setup();
  c.salesOrders = [{ orderNo: 'SO', channelName: 'consign', items: [] }];
  c.rows = [{ orderId: 'TRY1', salesOrderNo: 'SO', channel: 'consign', online: true, status: '待驗收',
    items: [{ sku: 'A', qty: 10, actualShippedQty: 8 }] }];
  c.openShipAcceptPage('TRY1');
  assert.equal(c.shipAcceptDraft.online, true);
  assert.equal(c.shipAcceptDraft.lines[0].checked, true);
  assert.equal(c.shipAcceptDraft.lines[0].acceptQty, 8);
  assert.match(controls.get('shipAcceptBack').textContent, /線上/);
  c.rows[0].status = '已驗收';
  c.rows[0].acceptance = { items: [{ key: 'A', acceptQty: 6 }] };
  c.openShipAcceptPage('TRY1');
  assert.equal(c.shipAcceptDraft.readonly, true);
  assert.equal(c.shipAcceptDraft.lines[0].acceptQty, 6);
});
test('online consignment can settle accepted shipments separately and deduct held quantities', () => {
  const { c } = setup();
  const order = { orderNo: 'SO', channelName: 'consign', items: [] };
  c.rows = [
    { salesOrderNo: 'SO', orderId: 'TRY1', online: true, status: '待驗收', items: [{ sku: 'A', qty: 10 }] },
    { salesOrderNo: 'SO', orderId: 'TRY2', online: true, status: '已驗收',
      acceptance: { items: [{ sku: 'A', acceptQty: 8, settledQty: 3 }] }, items: [{ sku: 'A', qty: 10 }] },
  ];
  assert.equal(c.isSettlementSourceOrder(order), true);
  const lines = c.buildConsignChannelBillRows(order);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].shipNo, 'TRY2');
  assert.equal(lines[0].remain, 5);
});
test('exempt shipment retains all shipped items after a partial settlement ledger is created', () => {
  const { c } = setup();
  const order = { orderNo: 'SO', channelName: 'transfer', items: [] };
  const ship = { status: '已配達', shipped: '2026-11-23', orderId: 'TRY1',
    items: [{ sku: 'A', qty: 10, actualShippedQty: 9 }, { sku: 'B', qty: 5 }],
    acceptance: { items: [{ sku: 'A', acceptQty: 3, settledQty: 3 }] } };
  const lines = c.shipSettleLines(order, ship);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].acceptQty, 9);
  assert.equal(lines[0].settledQty, 3);
  assert.equal(lines[1].acceptQty, 5);
});
test('acceptance actions are limited to eligible shipments and states', () => {
  const { c } = setup();
  assert.equal(c.shipAcceptanceLink({ salesOrderNo: 'SO', channel: 'transfer', status: '已配達' }), '');
  assert.match(c.shipAcceptanceLink({ salesOrderNo: 'SO', channel: 'consign', status: '待驗收' }), /mode=accept/);
  assert.match(c.shipAcceptanceLink({ salesOrderNo: 'SO', channel: 'consign', status: '已驗收' }), /aria-disabled/);
});
