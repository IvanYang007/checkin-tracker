'use strict';

const STORAGE_KEY = 'checkin-tracker:v1';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const cronCache = new Map();
const periodStartCache = new Map();
const descriptionCache = new Map();

let checkins = loadCheckins();
let editingId = null;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeCheckin(checkin) {
  if (!checkin || typeof checkin !== 'object' || Array.isArray(checkin)) return null;

  const id = typeof checkin.id === 'string' && checkin.id ? checkin.id : makeId();
  const name = typeof checkin.name === 'string' && checkin.name.trim() ? checkin.name.trim() : 'Untitled';

  // Count-up items don't need a cron schedule; they just track time since the last check-in.
  if (checkin.type === 'countup' || checkin.mode === 'countup') {
    let lastCheckInAt = null;
    if (typeof checkin.lastCheckInAt === 'string' || typeof checkin.lastCheckInAt === 'number') {
      const date = new Date(checkin.lastCheckInAt);
      if (!Number.isNaN(date.getTime())) {
        lastCheckInAt = date.toISOString();
      }
    }
    return { id, name, type: 'countup', lastCheckInAt, cron: null, mode: 'countup', donePeriodStart: null };
  }

  let cron = typeof checkin.cron === 'string' && checkin.cron.trim() ? checkin.cron.trim() : '0 18 * * *';
  let cronWasInvalid = false;
  try {
    parseCron(cron);
  } catch (err) {
    cron = '0 18 * * *';
    cronWasInvalid = true;
  }
  let mode = typeof checkin.mode === 'string' ? checkin.mode : inferMode(cron);
  if (cronWasInvalid || !['daily', 'weekly', 'monthly', 'custom'].includes(mode)) {
    mode = inferMode(cron);
  }
  const inferredMode = inferMode(cron);
  if (mode !== 'custom' && inferredMode !== mode) {
    mode = inferredMode;
  }
  if (!cronWasInvalid && mode === 'custom' && !nextOccurrence(cron, new Date())) {
    cron = '0 18 * * *';
    mode = inferMode(cron);
  }
  const donePeriodStart = typeof checkin.donePeriodStart === 'string' && !Number.isNaN(Date.parse(checkin.donePeriodStart))
    ? checkin.donePeriodStart
    : null;

  return { id, name, type: 'checkin', cron, mode, donePeriodStart };
}

function loadCheckins() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const seen = new Set();
        return parsed.map(normalizeCheckin).filter(Boolean).filter((checkin) => {
          if (seen.has(checkin.id)) return false;
          seen.add(checkin.id);
          return true;
        });
      }
    }
  } catch (err) {
    console.warn('Could not load saved check-ins', err);
  }

  return [
    {
      id: makeId(),
      name: 'Evening Medicine (example)',
      type: 'checkin',
      cron: '0 18 * * *',
      mode: 'daily',
      donePeriodStart: null
    }
  ];
}

function saveCheckins() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checkins));
  } catch (err) {
    console.warn('Could not save check-ins', err);
    alert('Could not save changes. Please use a local web server (see README).');
  }
}

// ---------------------------------------------------------------------------
// Mini cron parser (5 fields: minute hour day-of-month month day-of-week)
// ---------------------------------------------------------------------------

function parseCronField(field, min, max) {
  const values = new Set();
  const parts = field.split(',');

  for (let rawPart of parts) {
    let part = rawPart.trim();
    if (!part) continue;

    let step = 1;
    let low;
    let high;

    if (part.includes('/')) {
      const [rangePart, stepPart] = part.split('/');
      step = parseInt(stepPart, 10);
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`Invalid step in cron field: ${part}`);
      }
      part = rangePart.trim();

      if (part === '*') {
        low = min;
        high = max;
      } else if (part.includes('-')) {
        const [a, b] = part.split('-').map((s) => parseInt(s.trim(), 10));
        low = a;
        high = b;
      } else {
        // Standard cron: "N/step" means from N to the end of the field.
        low = parseInt(part, 10);
        high = max;
      }
    } else if (part === '*') {
      low = min;
      high = max;
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map((s) => parseInt(s.trim(), 10));
      low = a;
      high = b;
    } else {
      low = parseInt(part, 10);
      high = low;
    }

    if (!Number.isInteger(low) || !Number.isInteger(high)) {
      throw new Error(`Invalid cron field: ${part}`);
    }

    for (let i = low; i <= high; i += step) {
      if (i >= min && i <= max) values.add(i);
    }
  }

  if (values.size === 0) {
    throw new Error(`Cron field has no valid values: ${field}`);
  }

  return values;
}

function parseCronUncached(expression) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error('Cron must have 5 fields: minute hour day-of-month month day-of-week');
  }

  const dowValues = parseCronField(fields[4], 0, 7);
  if (dowValues.has(7)) {
    dowValues.add(0);
    dowValues.delete(7);
  }

  return {
    expression: expression.trim(),
    minute: parseCronField(fields[0], 0, 59),
    hour: parseCronField(fields[1], 0, 23),
    dom: parseCronField(fields[2], 1, 31),
    month: parseCronField(fields[3], 1, 12),
    dow: dowValues,
    domWild: fields[2].trim() === '*',
    dowWild: fields[4].trim() === '*'
  };
}

function parseCron(expression) {
  const key = expression.trim();
  if (cronCache.has(key)) {
    return cronCache.get(key);
  }
  const parsed = parseCronUncached(key);
  cronCache.set(key, parsed);
  return parsed;
}

function matchesCronDate(cron, year, monthIndex, day) {
  if (!cron.month.has(monthIndex + 1)) return false;

  const date = new Date(year, monthIndex, day);
  const domMatch = cron.dom.has(day);
  const dowMatch = cron.dow.has(date.getDay());

  // Standard cron behavior: if both day-of-month and day-of-week are restricted,
  // a match on either one is enough. If one is wildcard, both must match.
  if (!cron.domWild && !cron.dowWild) {
    return domMatch || dowMatch;
  }
  return domMatch && dowMatch;
}

function nextOccurrence(expression, after) {
  const cron = parseCron(expression);
  const start = new Date(after);
  const startYear = start.getFullYear();
  const startMonth = start.getMonth();
  const startDay = start.getDate();
  const startHour = start.getHours();
  const startMinute = start.getMinutes();

  for (let year = startYear; year <= startYear + 5; year++) {
    const firstMonth = year === startYear ? startMonth : 0;
    for (let month = firstMonth; month < 12; month++) {
      if (!cron.month.has(month + 1)) continue;

      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const firstDay = (year === startYear && month === startMonth) ? startDay : 1;
      for (let day = firstDay; day <= daysInMonth; day++) {
        if (!matchesCronDate(cron, year, month, day)) continue;

        const firstHour = (year === startYear && month === startMonth && day === startDay) ? startHour : 0;
        for (let hour = firstHour; hour < 24; hour++) {
          if (!cron.hour.has(hour)) continue;

          const firstMinute = (year === startYear && month === startMonth && day === startDay && hour === startHour) ? startMinute : 0;
          for (let minute = firstMinute; minute < 60; minute++) {
            if (!cron.minute.has(minute)) continue;

            const candidate = new Date(year, month, day, hour, minute);
            // Skip local times that DST shifts make nonexistent.
            if (candidate.getFullYear() !== year ||
                candidate.getMonth() !== month ||
                candidate.getDate() !== day ||
                candidate.getHours() !== hour ||
                candidate.getMinutes() !== minute) {
              continue;
            }
            if (candidate.getTime() > after.getTime()) {
              return candidate;
            }
          }
        }
      }
    }
  }

  return null;
}

function previousOccurrence(expression, before) {
  const cron = parseCron(expression);
  const start = new Date(before);
  const startYear = start.getFullYear();
  const startMonth = start.getMonth();
  const startDay = start.getDate();
  const startHour = start.getHours();
  const startMinute = start.getMinutes();

  for (let year = startYear; year >= startYear - 8; year--) {
    const lastMonth = year === startYear ? startMonth : 11;
    for (let month = lastMonth; month >= 0; month--) {
      if (!cron.month.has(month + 1)) continue;

      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const lastDay = (year === startYear && month === startMonth) ? startDay : daysInMonth;
      for (let day = lastDay; day >= 1; day--) {
        if (!matchesCronDate(cron, year, month, day)) continue;

        const lastHour = (year === startYear && month === startMonth && day === startDay) ? startHour : 23;
        for (let hour = lastHour; hour >= 0; hour--) {
          if (!cron.hour.has(hour)) continue;

          const lastMinute = (year === startYear && month === startMonth && day === startDay && hour === startHour) ? startMinute : 59;
          for (let minute = lastMinute; minute >= 0; minute--) {
            if (!cron.minute.has(minute)) continue;

            const candidate = new Date(year, month, day, hour, minute);
            // Skip local times that DST shifts make nonexistent.
            if (candidate.getFullYear() !== year ||
                candidate.getMonth() !== month ||
                candidate.getDate() !== day ||
                candidate.getHours() !== hour ||
                candidate.getMinutes() !== minute) {
              continue;
            }
            if (candidate.getTime() <= before.getTime()) {
              return candidate;
            }
          }
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad2(value) {
  return String(value).padStart(2, '0');
}

function isSingleNumber(value) {
  return /^\d+$/.test(value.trim());
}

function inferMode(cron) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length === 5) {
    const minuteField = fields[0].trim();
    const hourField = fields[1].trim();
    const dom = fields[2].trim();
    const month = fields[3].trim();
    const dow = fields[4].trim();

    if (isSingleNumber(minuteField) && isSingleNumber(hourField) && dom === '*' && month === '*' && dow === '*') {
      return 'daily';
    }
    if (isSingleNumber(minuteField) && isSingleNumber(hourField) && dom === '*' && month === '*' && isSingleNumber(dow)) {
      return 'weekly';
    }
    if (isSingleNumber(minuteField) && isSingleNumber(hourField) && isSingleNumber(dom) && month === '*' && dow === '*') {
      return 'monthly';
    }
  }
  return 'custom';
}

function formatTime(hour, minute) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${pad2(minute)} ${period}`;
}

function cronToDescription(expression, mode) {
  const cacheKey = `${mode || ''}|${expression}`;
  if (descriptionCache.has(cacheKey)) {
    return descriptionCache.get(cacheKey);
  }

  let description;
  try {
    const effectiveMode = mode || inferMode(expression);
    if (effectiveMode === 'custom') {
      description = `Cron: ${expression}`;
    } else {
      const fields = expression.trim().split(/\s+/);
      if (fields.length !== 5) {
        description = expression;
      } else {
        const minuteField = fields[0].trim();
        const hourField = fields[1].trim();
        const dom = fields[2].trim();
        const month = fields[3].trim();
        const dow = fields[4].trim();

        if (isSingleNumber(minuteField) && isSingleNumber(hourField) && dom === '*' && month === '*' && dow === '*') {
          description = `Daily at ${formatTime(Number(hourField), Number(minuteField))}`;
        } else if (isSingleNumber(minuteField) && isSingleNumber(hourField) && dom === '*' && month === '*' && isSingleNumber(dow)) {
          const day = DAY_NAMES[Number(dow) % 7];
          description = `Weekly on ${day} at ${formatTime(Number(hourField), Number(minuteField))}`;
        } else if (isSingleNumber(minuteField) && isSingleNumber(hourField) && isSingleNumber(dom) && month === '*' && dow === '*') {
          description = `Monthly on day ${dom} at ${formatTime(Number(hourField), Number(minuteField))}`;
        } else {
          description = `Cron: ${expression}`;
        }
      }
    }
  } catch (err) {
    description = expression;
  }

  if (descriptionCache.size > 500) {
    descriptionCache.clear();
  }
  descriptionCache.set(cacheKey, description);
  return description;
}

function currentPeriodStart(checkin, now) {
  const mode = checkin.mode || inferMode(checkin.cron);

  if (mode === 'daily') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  }

  if (mode === 'weekly') {
    const day = now.getDay();
    const daysSinceMonday = (day + 6) % 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0, 0, 0);
  }

  if (mode === 'monthly') {
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }

  // For custom cron schedules, the period starts at the most recent cron fire time.
  // Cache it per checkin and minute so repeated renders don't re-run the search.
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  const cacheKey = `${checkin.id}|${checkin.cron}|${minuteKey}`;
  if (periodStartCache.has(cacheKey)) {
    return periodStartCache.get(cacheKey);
  }

  const start = previousOccurrence(checkin.cron, now);
  if (periodStartCache.size > 1000) {
    periodStartCache.clear();
  }
  periodStartCache.set(cacheKey, start);
  return start;
}

function isDone(checkin, now = new Date()) {
  if (!checkin.donePeriodStart) return false;
  const start = currentPeriodStart(checkin, now);
  if (!start) return false;
  const doneTime = new Date(checkin.donePeriodStart).getTime();
  return Math.abs(doneTime - start.getTime()) < 60 * 1000;
}

function findCheckin(id) {
  return checkins.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// Count-up helpers
// ---------------------------------------------------------------------------

function isCountUp(checkin) {
  return checkin.type === 'countup' || checkin.mode === 'countup';
}

function hasLastCheckIn(checkin) {
  return checkin.lastCheckInAt !== null && checkin.lastCheckInAt !== undefined && checkin.lastCheckInAt !== '';
}

function countUpDays(checkin, now = new Date()) {
  if (!hasLastCheckIn(checkin)) return null;
  const then = new Date(checkin.lastCheckInAt);
  if (Number.isNaN(then.getTime())) return null;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const checkInDayStart = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const diffMs = todayStart.getTime() - checkInDayStart.getTime();
  return Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)));
}

function countUpStatus(checkin, now = new Date()) {
  const days = countUpDays(checkin, now);
  if (days === null) return 'No check-in yet';
  if (days === 0) return '0 days';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function countUpLastLabel(checkin) {
  if (!hasLastCheckIn(checkin)) return 'Last check-in: never';
  const date = new Date(checkin.lastCheckInAt);
  if (Number.isNaN(date.getTime())) return 'Last check-in: never';
  const label = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `Last check-in: ${label}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const list = document.getElementById('checkinList');
  const empty = document.getElementById('emptyMessage');
  const fragment = document.createDocumentFragment();
  empty.hidden = checkins.length > 0;

  const now = new Date();
  for (const checkin of checkins) {
    const countUp = isCountUp(checkin);
    const done = countUp ? false : isDone(checkin, now);
    const card = document.createElement('article');
    card.className = `checkin-card${done ? ' done' : ''}${countUp ? ' countup' : ''}`;

    const top = document.createElement('div');
    top.className = 'checkin-top';

    const titleWrap = document.createElement('div');
    const name = document.createElement('h2');
    name.className = 'checkin-name';
    name.textContent = checkin.name;

    const schedule = document.createElement('p');
    schedule.className = 'checkin-schedule';
    schedule.textContent = countUp ? countUpLastLabel(checkin) : cronToDescription(checkin.cron, checkin.mode);

    titleWrap.append(name, schedule);

    const status = document.createElement('span');
    status.className = 'checkin-status';
    status.textContent = countUp ? countUpStatus(checkin, now) : (done ? 'Done ✓' : 'Not done');

    top.append(titleWrap, status);

    const actions = document.createElement('div');
    actions.className = 'checkin-actions';

    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.className = countUp ? 'done-button undone' : `done-button${done ? ' done' : ' undone'}`;
    doneButton.textContent = countUp ? 'Check In' : (done ? '✓ Done' : 'Mark Done');
    doneButton.dataset.action = 'toggle';
    doneButton.dataset.id = checkin.id;

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'edit-button';
    editButton.textContent = 'Edit';
    editButton.dataset.action = 'edit';
    editButton.dataset.id = checkin.id;

    actions.append(doneButton, editButton);
    card.append(top, actions);
    fragment.appendChild(card);
  }

  list.innerHTML = '';
  list.appendChild(fragment);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function toggleDone(id) {
  const checkin = findCheckin(id);
  if (!checkin) return;

  const now = new Date();
  if (isCountUp(checkin)) {
    // Count-up items reset the counter every time you check in.
    checkin.lastCheckInAt = now.toISOString();
    saveCheckins();
    render();
    return;
  }

  if (isDone(checkin, now)) {
    checkin.donePeriodStart = null;
  } else {
    const start = currentPeriodStart(checkin, now);
    checkin.donePeriodStart = start ? start.toISOString() : now.toISOString();
  }

  saveCheckins();
  render();
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function getElement(id) {
  return document.getElementById(id);
}

function updateScheduleFields() {
  const type = getElement('scheduleType').value;
  const countUp = type === 'countup';
  getElement('simpleScheduleFields').hidden = type === 'custom' || countUp;
  getElement('cronField').hidden = type !== 'custom';
  getElement('dayOfWeekField').hidden = type !== 'weekly';
  getElement('dayOfMonthField').hidden = type !== 'monthly';
}

function resetEditor() {
  editingId = null;
  getElement('editorTitle').textContent = 'Add Item';
  getElement('deleteButton').hidden = true;
  getElement('nameInput').value = '';
  getElement('scheduleType').value = 'daily';
  getElement('timeInput').value = '18:00';
  getElement('dayOfWeek').value = '1';
  getElement('dayOfMonth').value = '1';
  getElement('cronInput').value = '0 18 * * *';
  updateScheduleFields();
}

function fillEditor(checkin) {
  editingId = checkin.id;
  getElement('editorTitle').textContent = 'Edit Item';
  getElement('deleteButton').hidden = false;
  getElement('nameInput').value = checkin.name;

  if (isCountUp(checkin)) {
    getElement('scheduleType').value = 'countup';
    getElement('cronInput').value = '0 18 * * *';
    getElement('timeInput').value = '18:00';
    getElement('dayOfWeek').value = '1';
    getElement('dayOfMonth').value = '1';
    updateScheduleFields();
    return;
  }

  getElement('cronInput').value = checkin.cron;
  const fields = checkin.cron.trim().split(/\s+/);
  const mode = checkin.mode || inferMode(checkin.cron);

  if (fields.length === 5) {
    const minuteField = fields[0].trim();
    const hourField = fields[1].trim();

    if (isSingleNumber(minuteField) && isSingleNumber(hourField)) {
      getElement('timeInput').value = `${pad2(Number(hourField))}:${pad2(Number(minuteField))}`;
    } else {
      getElement('timeInput').value = '18:00';
    }
  }

  if (mode === 'daily') {
    getElement('scheduleType').value = 'daily';
  } else if (mode === 'weekly') {
    getElement('scheduleType').value = 'weekly';
    const dow = fields.length === 5 ? fields[4].trim() : '1';
    getElement('dayOfWeek').value = String(Number(dow) % 7);
  } else if (mode === 'monthly') {
    getElement('scheduleType').value = 'monthly';
    const dom = fields.length === 5 ? fields[2].trim() : '1';
    getElement('dayOfMonth').value = String(Number(dom));
  } else {
    getElement('scheduleType').value = 'custom';
  }

  updateScheduleFields();
}

function openEditor(id = null) {
  if (id) {
    const checkin = findCheckin(id);
    if (!checkin) return;
    fillEditor(checkin);
  } else {
    resetEditor();
  }
  getElement('editorDialog').showModal();
}

function openNewCountUp() {
  resetEditor();
  getElement('scheduleType').value = 'countup';
  updateScheduleFields();
  getElement('editorDialog').showModal();
}

function closeEditor() {
  getElement('editorDialog').close();
}

function buildCronFromForm() {
  const type = getElement('scheduleType').value;
  if (type === 'countup') {
    throw new Error('Count-up items do not use a cron schedule.');
  }
  const time = getElement('timeInput').value;
  if (!time) throw new Error('Please choose a time.');

  const [hour, minute] = time.split(':').map(Number);

  if (type === 'daily') {
    return `${minute} ${hour} * * *`;
  }

  if (type === 'weekly') {
    const dow = getElement('dayOfWeek').value;
    return `${minute} ${hour} * * ${dow}`;
  }

  if (type === 'monthly') {
    const dom = getElement('dayOfMonth').value;
    return `${minute} ${hour} ${dom} * *`;
  }

  const cron = getElement('cronInput').value.trim();
  if (!cron) throw new Error('Please enter a cron expression.');
  parseCron(cron); // validates syntax
  if (!nextOccurrence(cron, new Date())) {
    throw new Error('Cron expression has no future occurrence in the next 5 years.');
  }
  return cron;
}

function saveEditor() {
  const name = getElement('nameInput').value.trim();
  if (!name) {
    alert('Please enter a name.');
    return;
  }

  const type = getElement('scheduleType').value;

  if (type === 'countup') {
    if (editingId) {
      const item = findCheckin(editingId);
      if (item) {
        const wasCountUp = isCountUp(item);
        item.name = name;
        item.type = 'countup';
        item.mode = 'countup';
        item.cron = null;
        item.donePeriodStart = null;
        if (!wasCountUp || typeof item.lastCheckInAt !== 'string') {
          item.lastCheckInAt = null;
        }
      }
    } else {
      checkins.push({
        id: makeId(),
        name,
        type: 'countup',
        mode: 'countup',
        cron: null,
        donePeriodStart: null,
        lastCheckInAt: null
      });
    }

    saveCheckins();
    closeEditor();
    render();
    return;
  }

  let cron;
  try {
    cron = buildCronFromForm();
  } catch (err) {
    alert(err.message || 'Invalid schedule.');
    return;
  }

  if (editingId) {
    const checkin = findCheckin(editingId);
    if (checkin) {
      checkin.name = name;
      checkin.type = 'checkin';
      checkin.cron = cron;
      checkin.mode = type;
      checkin.lastCheckInAt = null;
      // If schedule changed, the old done marker may not belong to the current period.
      const start = currentPeriodStart(checkin, new Date());
      if (!start || new Date(checkin.donePeriodStart || 0).getTime() !== start.getTime()) {
        checkin.donePeriodStart = null;
      }
    }
  } else {
    checkins.push({
      id: makeId(),
      name,
      type: 'checkin',
      cron,
      mode: type,
      donePeriodStart: null,
      lastCheckInAt: null
    });
  }

  saveCheckins();
  closeEditor();
  render();
}

function deleteEditor() {
  if (!editingId) return;
  checkins = checkins.filter((c) => c.id !== editingId);
  saveCheckins();
  closeEditor();
  render();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  getElement('addButton').addEventListener('click', () => openEditor());
  const addCountUpButton = getElement('addCountUpButton');
  if (addCountUpButton) {
    addCountUpButton.addEventListener('click', openNewCountUp);
  }
  getElement('cancelButton').addEventListener('click', closeEditor);
  getElement('deleteButton').addEventListener('click', deleteEditor);
  getElement('scheduleType').addEventListener('change', updateScheduleFields);

  getElement('editorForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveEditor();
  });

  // One delegated listener for all dynamically rendered card buttons.
  getElement('checkinList').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || !button.dataset.id) return;

    if (button.dataset.action === 'toggle') {
      toggleDone(button.dataset.id);
    } else if (button.dataset.action === 'edit') {
      openEditor(button.dataset.id);
    }
  });

  // Keep multiple open tabs in sync.
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      checkins = loadCheckins();
      render();
    }
  });

  // Re-render at each minute boundary so the status updates while the page is open.
  // A recursive timeout stays aligned to wall-clock minutes better than a fixed interval.
  function scheduleNextMinuteRender() {
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    setTimeout(() => {
      scheduleNextMinuteRender();
      render();
    }, msUntilNextMinute);
  }

  scheduleNextMinuteRender();
  render();
});
