const DeviceInStocker = require('../models/DeviceInStocker');
const DeviceGrinder = require('../models/DeviceGrinder');

const SLOT_SIDES = ['L', 'R'];
const SLOT_INDEXES = [1, 2, 3, 4, 5, 6];
const GRINDER_INDEXES = [1, 2, 3, 4, 5, 6];
const POSITIONS = ['L', 'R', 'O', 'I'];
const SIGNAL_KEYS = [
  'input_ready_id',
  'output_ready_id',
  'safe_pos_id',
  'input_in_progress_id',
  'input_done_id',
  'output_in_progress_id',
  'output_done_id',
];

function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function buildDefaultSlots() {
  const slots = {};
  for (const side of SLOT_SIDES) {
    for (const idx of SLOT_INDEXES) {
      slots[`${side}${idx}`] = {
        working_id: null,
        done_id: null,
      };
    }
  }
  return slots;
}

function buildDefaultGrinders() {
  return GRINDER_INDEXES.map((index) => {
    const positions = {};
    for (const pos of POSITIONS) {
      const signals = {};
      for (const key of SIGNAL_KEYS) {
        signals[key] = null;
      }
      positions[pos] = signals;
    }
    return {
      index,
      product_type_id: null,
      positions,
    };
  });
}

function safeParseJson(value, fallback) {
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeSlots(input) {
  const base = buildDefaultSlots();
  if (!input || typeof input !== 'object') return base;
  for (const key of Object.keys(base)) {
    const item = input[key] || {};
    base[key] = {
      working_id: normalizeText(item.working_id),
      done_id: normalizeText(item.done_id),
      product_type_id: normalizeText(item.product_type_id),
    };
  }
  return base;
}

function normalizeGrinders(input) {
  const base = buildDefaultGrinders();
  if (!Array.isArray(input)) return base;
  return base.map((defaultItem, idx) => {
    const item = input[idx] || {};
    const positions = {};
    for (const pos of POSITIONS) {
      const signals = {};
      const sourceSignals = (item.positions && item.positions[pos]) || {};
      for (const key of SIGNAL_KEYS) {
        signals[key] = normalizeText(sourceSignals[key]);
      }
      positions[pos] = signals;
    }
    return {
      index: defaultItem.index,
      product_type_id: normalizeText(item.product_type_id ?? item.product_no),
      positions,
    };
  });
}

async function ensureInstocker() {
  const [row] = await DeviceInStocker.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1 },
  });
  return row;
}

async function ensureGrinder() {
  const [row] = await DeviceGrinder.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1 },
  });
  return row;
}

exports.getInstocker = async (req, res) => {
  try {
    const row = await ensureInstocker();
    const slots = safeParseJson(row.slots, buildDefaultSlots());
    res.json({
      success: true,
      data: {
        id: row.id,
        work_available_signal_id: row.work_available_signal_id,
        slots: normalizeSlots(slots),
      },
    });
  } catch (e) {
    console.error('[Device.getInstocker]', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateInstocker = async (req, res) => {
  try {
    const row = await ensureInstocker();
    const payload = req.body || {};
    const slots = normalizeSlots(payload.slots);
    const patch = {
      work_available_signal_id: normalizeText(payload.work_available_signal_id),
      slots: JSON.stringify(slots),
    };
    await row.update(patch);
    res.json({
      success: true,
      data: {
        id: row.id,
        work_available_signal_id: row.work_available_signal_id,
        slots,
      },
    });
  } catch (e) {
    console.error('[Device.updateInstocker]', e);
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.getGrinder = async (req, res) => {
  try {
    const row = await ensureGrinder();
    const grinders = safeParseJson(row.grinders, buildDefaultGrinders());
    res.json({
      success: true,
      data: {
        id: row.id,
        grinders: normalizeGrinders(grinders),
      },
    });
  } catch (e) {
    console.error('[Device.getGrinder]', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateGrinder = async (req, res) => {
  try {
    const row = await ensureGrinder();
    const payload = req.body || {};
    const grinders = normalizeGrinders(payload.grinders);
    await row.update({ grinders: JSON.stringify(grinders) });
    res.json({
      success: true,
      data: {
        id: row.id,
        grinders,
      },
    });
  } catch (e) {
    console.error('[Device.updateGrinder]', e);
    res.status(400).json({ success: false, message: e.message });
  }
};
