'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

let passed = 0;
let failed = 0;

function assert(actual, expected, name) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson === expectedJson) {
    passed++;
    console.log(`PASS: ${name}`);
  } else {
    failed++;
    console.error(`FAIL: ${name} — expected ${expectedJson}, got ${actualJson}`);
  }
}

function assertDate(actual, expected, name) {
  const ok = actual instanceof Date && expected instanceof Date && actual.getTime() === expected.getTime();
  if (ok) {
    passed++;
    console.log(`PASS: ${name}`);
  } else {
    failed++;
    console.error(`FAIL: ${name} — expected ${expected}, got ${actual}`);
  }
}

function createContext(overrides = {}) {
  const context = {
    console,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { addEventListener: () => {} },
    window: { addEventListener: () => {} },
    crypto: { randomUUID: () => 'test-id' },
    Date,
    Math,
    JSON,
    Set,
    Map,
    Number,
    String,
    RegExp,
    Error,
    parseInt,
    isNaN,
    Array,
    Object,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    alert: () => {},
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(appCode, context);
  return context;
}

// ---------------------------------------------------------------------------
// Core + count-up logic tests
// ---------------------------------------------------------------------------
const ctx = createContext();
const {
  parseCron,
  nextOccurrence,
  previousOccurrence,
  currentPeriodStart,
  inferMode,
  cronToDescription,
  isDone,
  isCountUp,
  countUpDays,
  countUpStatus,
  countUpLastLabel,
  hasLastCheckIn,
  normalizeCheckin,
} = ctx;

assert(parseCron('0 18 * * *').minute.has(0), true, 'parseCron minute 0');
assertDate(
  nextOccurrence('0 18 * * *', new Date(2025, 0, 1, 12, 0, 0)),
  new Date(2025, 0, 1, 18, 0, 0),
  'nextOccurrence daily'
);
assertDate(
  previousOccurrence('0 18 * * *', new Date(2025, 0, 1, 12, 0, 0)),
  new Date(2024, 11, 31, 18, 0, 0),
  'previousOccurrence daily'
);
assertDate(
  currentPeriodStart({ cron: '0 18 * * *' }, new Date(2025, 0, 1, 12, 0, 0)),
  new Date(2025, 0, 1, 0, 0, 0),
  'daily period start'
);
assertDate(
  currentPeriodStart({ cron: '0 18 * * *', mode: 'custom' }, new Date(2025, 0, 1, 12, 0, 0)),
  new Date(2024, 11, 31, 18, 0, 0),
  'custom period start'
);
assert(inferMode('0 18 * * *'), 'daily', 'inferMode daily');
assert(cronToDescription('0 18 * * *'), 'Daily at 6:00 PM', 'cronToDescription');

const realNow = new Date();
const daily = {
  cron: '0 18 * * *',
  donePeriodStart: currentPeriodStart({ cron: '0 18 * * *' }, realNow).toISOString(),
};
assert(isDone(daily, realNow), true, 'isDone current daily');

const cuNow = new Date(2025, 0, 5, 12, 0, 0);
const cuDay1 = new Date(2025, 0, 1, 0, 0, 0).toISOString();
const cuToday = new Date(2025, 0, 5, 6, 0, 0).toISOString();
const cuYesterday = new Date(2025, 0, 4, 23, 0, 0).toISOString();

assert(hasLastCheckIn({ lastCheckInAt: 0 }), true, 'hasLastCheckIn numeric zero');
assert(hasLastCheckIn({ lastCheckInAt: null }), false, 'hasLastCheckIn null');
assert(isCountUp({ type: 'countup' }), true, 'isCountUp true');
assert(isCountUp({ type: 'checkin' }), false, 'isCountUp false');
assert(countUpDays({ lastCheckInAt: cuDay1 }, cuNow), 4, 'countUpDays 4');
assert(countUpDays({ lastCheckInAt: cuToday }, cuNow), 0, 'countUpDays today');
assert(countUpDays({ lastCheckInAt: cuYesterday }, cuNow), 1, 'countUpDays yesterday');
assert(countUpDays({ lastCheckInAt: null }, cuNow), null, 'countUpDays null');
assert(countUpStatus({ lastCheckInAt: cuDay1 }, cuNow), '4 days', 'countUpStatus days');
assert(countUpStatus({ lastCheckInAt: cuToday }, cuNow), '0 days', 'countUpStatus today');
assert(countUpStatus({ lastCheckInAt: null }, cuNow), 'No check-in yet', 'countUpStatus never');
assert(
  countUpLastLabel({ lastCheckInAt: cuDay1 }).startsWith('Last check-in:'),
  true,
  'countUpLastLabel prefix'
);
assert(countUpDays({ lastCheckInAt: 'not-a-date' }, cuNow), null, 'countUpDays invalid date');
assert(countUpStatus({ lastCheckInAt: 'not-a-date' }, cuNow), 'No check-in yet', 'countUpStatus invalid date');
assert(countUpLastLabel({ lastCheckInAt: 'not-a-date' }), 'Last check-in: never', 'countUpLastLabel invalid date');

const normalizedCountUp = normalizeCheckin({
  id: 'cu1',
  name: 'Streak',
  type: 'countup',
  lastCheckInAt: cuDay1,
});
assert(normalizedCountUp.type, 'countup', 'normalize countup type');
assert(normalizedCountUp.lastCheckInAt, cuDay1, 'normalize countup timestamp');

const numericTimestamp = new Date(2025, 0, 2, 0, 0, 0).getTime();
const normalizedNumericCountUp = normalizeCheckin({
  id: 'cu2',
  name: 'Numeric Counter',
  type: 'countup',
  lastCheckInAt: numericTimestamp,
});
assert(normalizedNumericCountUp.type, 'countup', 'normalize numeric countup type');
assert(
  normalizedNumericCountUp.lastCheckInAt,
  new Date(numericTimestamp).toISOString(),
  'normalize numeric countup timestamp'
);

// ---------------------------------------------------------------------------
// Fake-DOM end-to-end tests
// ---------------------------------------------------------------------------
function makeElement(id) {
  return {
    id,
    value: '',
    textContent: '',
    hidden: false,
    addEventListener() {},
    close() {},
    showModal() {
      this.modalOpened = true;
    },
  };
}

const ids = [
  'nameInput',
  'scheduleType',
  'simpleScheduleFields',
  'cronField',
  'dayOfWeekField',
  'dayOfMonthField',
  'timeInput',
  'dayOfWeek',
  'dayOfMonth',
  'cronInput',
  'editorTitle',
  'deleteButton',
  'editorDialog',
  'checkinList',
  'emptyMessage',
  'addButton',
  'addCountUpButton',
  'cancelButton',
  'editorForm',
];

const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
elements.scheduleType.value = 'daily';
elements.timeInput.value = '18:00';
elements.dayOfWeek.value = '1';
elements.dayOfMonth.value = '1';
elements.cronInput.value = '0 18 * * *';
elements.checkinList.appendChild = () => {};
elements.checkinList.innerHTML = '';

let savedRaw = null;
const uiCtx = createContext({
  localStorage: {
    getItem: () => '[]',
    setItem: (key, value) => {
      savedRaw = value;
    },
  },
  document: {
    getElementById: (id) => elements[id] || null,
    addEventListener: () => {},
    createDocumentFragment: () => ({ appendChild() {} }),
    createElement: () => ({
      append() {},
      appendChild() {},
      addEventListener() {},
      set className(value) {},
      set textContent(value) {},
      set hidden(value) {},
      set dataset(value) {},
      get dataset() {
        return {};
      },
    }),
  },
});

uiCtx.render = () => {};
uiCtx.closeEditor = () => {};

uiCtx.openNewCountUp();
assert(elements.scheduleType.value, 'countup', 'openNewCountUp selects countup');
assert(elements.editorDialog.modalOpened, true, 'openNewCountUp opens dialog');

elements.nameInput.value = 'My Counter';
uiCtx.saveEditor();
let saved = JSON.parse(savedRaw);
assert(saved.length, 1, 'saveEditor creates one item');
assert(saved[0].type, 'countup', 'saved item is countup');
assert(saved[0].lastCheckInAt, null, 'new countup starts with no check-in');

uiCtx.toggleDone(saved[0].id);
const afterCheckIn = JSON.parse(savedRaw);
assert(afterCheckIn[0].lastCheckInAt !== null, true, 'toggleDone resets countup timestamp');

// Conversion: countup -> checkin
const id = saved[0].id;
uiCtx.openEditor(id);
elements.scheduleType.value = 'daily';
elements.timeInput.value = '07:30';
elements.nameInput.value = 'Morning Med';
uiCtx.saveEditor();
saved = JSON.parse(savedRaw);
assert(saved[0].type, 'checkin', 'countup -> checkin conversion');
assert(saved[0].cron, '30 7 * * *', 'countup -> checkin cron');
assert(saved[0].lastCheckInAt, null, 'countup -> checkin clears countup timestamp');

// Conversion: checkin -> countup
uiCtx.openEditor(id);
elements.scheduleType.value = 'countup';
elements.nameInput.value = 'Counter Again';
uiCtx.saveEditor();
saved = JSON.parse(savedRaw);
assert(saved[0].type, 'countup', 'checkin -> countup conversion');
assert(saved[0].cron, null, 'checkin -> countup clears cron');
assert(saved[0].lastCheckInAt, null, 'checkin -> countup starts fresh');

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
