const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPayroll() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', innerHTML: '', disabled: false,
      style: {}, classList: {add() {}, remove() {}},
      addEventListener() {}, click() {}
    });
    return elements.get(id);
  };
  const storage = new Map();
  const context = {
    console,
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      createElement: () => element(Symbol())
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    window: {scrollTo() {}, print() {}, open() {}},
    URL, Blob, fetch: async () => { throw new Error('unexpected fetch'); },
    setTimeout, clearTimeout
  };
  vm.runInNewContext(`${script}\n;globalThis.payrollTestApi={\n` +
    `setData:(a,s)=>{attendance=a;staffRows=s},summarize,dailyTransportCost};`, context);
  element('periodMonth').value = '2026-08'; // 2026-08-21 through 2026-09-20
  return {api: context.payrollTestApi, element};
}

function punches(date, transportCost) {
  return [
    {staff_name: 'テスト', work_date: date, punch_type: '出勤', punch_time: '09:00', transport_cost: transportCost},
    {staff_name: 'テスト', work_date: date, punch_type: '退勤', punch_time: '17:00', transport_cost: transportCost}
  ];
}

function summarize(costs, extraRows = []) {
  const {api} = loadPayroll();
  const rows = [
    ...punches('2026-09-03', costs[0]),
    ...punches('2026-09-10', costs[1]),
    ...extraRows
  ];
  api.setData(rows, [{name: 'テスト', active: true, hourly_wage: 1000, transport_per_day: 9999}]);
  return api.summarize('テスト');
}

test('NULL + 1500 is 1500 and does not fall back to normal transport cost', () => {
  const result = summarize([null, 1500]);
  assert.equal(result.transport, 1500);
  assert.deepEqual(Array.from(result.daily, d => d.transport), [0, 1500]);
});

test('0 + 1500 is 1500 and zero remains a saved daily value', () => {
  const result = summarize([0, 1500]);
  assert.equal(result.transport, 1500);
  assert.deepEqual(Array.from(result.daily, d => d.transport), [0, 1500]);
});

test('1500 + 1500 is 3000 without counting duplicate punch rows', () => {
  assert.equal(summarize([1500, 1500]).transport, 3000);
});

test('transport costs outside the payroll period are excluded', () => {
  const result = summarize([null, 1500], punches('2026-09-21', 7000));
  assert.equal(result.transport, 1500);
  assert.equal(result.daily.length, 2);
});

test('daily transport is excluded from taxable pay and included in gross and net pay', () => {
  const withoutTransport = summarize([null, 0]);
  const withTransport = summarize([null, 1500]);

  assert.equal(withTransport.taxable, withTransport.base + withTransport.otPremium + withTransport.nightPremium);
  assert.equal(withTransport.taxable, withoutTransport.taxable);
  assert.equal(withTransport.total, withoutTransport.total + 1500);
  assert.equal(withTransport.withholding, withoutTransport.withholding);
  assert.equal(withTransport.net, withoutTransport.net + 1500);
});
