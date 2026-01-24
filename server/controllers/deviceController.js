const DeviceInStocker = require('../models/DeviceInStocker');
const DeviceGrinder = require('../models/DeviceGrinder');
const DeviceOutStocker = require('../models/DeviceOutStocker');
const DeviceConveyor = require('../models/DeviceConveyor');

const SLOT_SIDES = ['L', 'R'];
const SLOT_INDEXES = [1, 2, 3, 4, 5, 6];
const GRINDER_INDEXES = [1, 2, 3, 4, 5, 6];
const OUT_SIDES = ['L1', 'L2', 'R1', 'R2'];
const OUT_ROWS = [1, 2, 3, 4, 5, 6];
const CONVEYOR_INDEXES = [1, 2];
const POSITIONS = ['L', 'R'];
const SIGNAL_KEYS = [
  'input_ready_id',
  'output_ready_id',
  'safe_pos_id',
  'input_in_progress_id',
  'input_done_id',
  'output_in_progress_id',
  'output_done_id',
];
const CONVEYOR_FIELDS = [
  'stop_id',
  'input_ready_id',
  'input_qty_1_id',
  'input_qty_4_id',
  'stop_request_id',
  'input_in_progress_id',
  'input_done_id',
  'product_no',
  'amr_pos',
  'mani_pos',
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
        product_type_id: null,
        amr_pos: null,
        mani_pos: null,
      };
    }
  }
  return slots;
}

function buildDefaultSideSignals() {
  const signals = {};
  for (const side of SLOT_SIDES) {
    signals[side] = {
      work_available_id: null,
      done_id: null,
      error_id: null,
      safe_id: null,
    };
  }
  return signals;
}

function buildDefaultGrinders() {
  return GRINDER_INDEXES.map((index) => {
    const positions = {};
    for (const pos of POSITIONS) {
      const signals = {};
      for (const key of SIGNAL_KEYS) {
        signals[key] = null;
      }
      positions[pos] = {
        ...signals,
        amr_pos: null,
        mani_pos: null,
      };
    }
    return {
      index,
      product_type_id: null,
      bypass_id: null,
      positions,
    };
  });
}

function buildDefaultOutStocker() {
  const sides = {};
  for (const side of OUT_SIDES) {
    const rows = {};
    for (const row of OUT_ROWS) {
      rows[row] = {
        load_ready_id: null,
        jig_state_id: null,
        model_no_id: null,
      };
    }
    sides[side] = {
      amr_pos: null,
      bypass_id: null,
      rows,
    };
  }
  return sides;
}

function buildDefaultConveyors() {
  return CONVEYOR_INDEXES.map((index) => {
    const item = { index };
    for (const key of CONVEYOR_FIELDS) {
      item[key] = null;
    }
    return item;
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
      product_type_id: normalizeText(item.product_type_id),
      amr_pos: normalizeText(item.amr_pos),
      mani_pos: normalizeText(item.mani_pos),
    };
  }
  return base;
}

function normalizeSideSignals(input) {
  const base = buildDefaultSideSignals();
  if (!input || typeof input !== 'object') return base;
  for (const side of SLOT_SIDES) {
    const item = input[side] || {};
    base[side] = {
      work_available_id: normalizeText(item.work_available_id),
      done_id: normalizeText(item.done_id),
      error_id: normalizeText(item.error_id),
      safe_id: normalizeText(item.safe_id),
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
      positions[pos] = {
        ...signals,
        amr_pos: normalizeText(sourceSignals.amr_pos),
        mani_pos: normalizeText(sourceSignals.mani_pos),
      };
    }
    return {
      index: defaultItem.index,
      product_type_id: normalizeText(item.product_type_id ?? item.product_no),
      bypass_id: normalizeText(item.bypass_id),
      positions,
    };
  });
}

function normalizeOutStocker(input) {
  const base = buildDefaultOutStocker();
  if (!input || typeof input !== 'object') return base;
  for (const side of OUT_SIDES) {
    const sourceSide = input[side] || {};
    const rows = {};
    for (const row of OUT_ROWS) {
      const sourceRow = (sourceSide.rows && sourceSide.rows[row]) || {};
      rows[row] = {
        load_ready_id: normalizeText(sourceRow.load_ready_id),
        jig_state_id: normalizeText(sourceRow.jig_state_id),
        model_no_id: normalizeText(sourceRow.model_no_id),
      };
    }
    base[side] = {
      amr_pos: normalizeText(sourceSide.amr_pos),
      bypass_id: normalizeText(sourceSide.bypass_id),
      rows,
    };
  }
  return base;
}

function normalizeConveyors(input) {
  const base = buildDefaultConveyors();
  if (!Array.isArray(input)) return base;
  return base.map((defaultItem, idx) => {
    const item = input[idx] || {};
    const out = { index: defaultItem.index };
    for (const key of CONVEYOR_FIELDS) {
      out[key] = normalizeText(item[key]);
    }
    return out;
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

async function ensureOutStocker() {
  const [row] = await DeviceOutStocker.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1 },
  });
  return row;
}

async function ensureConveyor() {
  const [row] = await DeviceConveyor.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1 },
  });
  return row;
}

exports.getInstocker = async (req, res) => {
  try {
    const row = await ensureInstocker();
    const slots = safeParseJson(row.slots, buildDefaultSlots());
    const sideSignals = safeParseJson(row.side_signals, buildDefaultSideSignals());
    res.json({
      success: true,
      data: {
        id: row.id,
        work_available_signal_id: row.work_available_signal_id,
        slots: normalizeSlots(slots),
        side_signals: normalizeSideSignals(sideSignals),
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
    const sideSignals = normalizeSideSignals(payload.side_signals);
    const patch = {
      work_available_signal_id: normalizeText(payload.work_available_signal_id),
      slots: JSON.stringify(slots),
      side_signals: JSON.stringify(sideSignals),
    };
    await row.update(patch);
    res.json({
      success: true,
      data: {
        id: row.id,
        work_available_signal_id: row.work_available_signal_id,
        slots,
        side_signals: sideSignals,
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

exports.getOutStocker = async (req, res) => {
  try {
    const row = await ensureOutStocker();
    const sides = safeParseJson(row.sides, buildDefaultOutStocker());
    res.json({
      success: true,
      data: {
        id: row.id,
        sides: normalizeOutStocker(sides),
      },
    });
  } catch (e) {
    console.error('[Device.getOutStocker]', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateOutStocker = async (req, res) => {
  try {
    const row = await ensureOutStocker();
    const payload = req.body || {};
    const sides = normalizeOutStocker(payload.sides);
    await row.update({ sides: JSON.stringify(sides) });
    res.json({
      success: true,
      data: {
        id: row.id,
        sides,
      },
    });
  } catch (e) {
    console.error('[Device.updateOutStocker]', e);
    res.status(400).json({ success: false, message: e.message });
  }
};

exports.getConveyor = async (req, res) => {
  try {
    const row = await ensureConveyor();
    const conveyors = safeParseJson(row.conveyors, buildDefaultConveyors());
    res.json({
      success: true,
      data: {
        id: row.id,
        conveyors: normalizeConveyors(conveyors),
      },
    });
  } catch (e) {
    console.error('[Device.getConveyor]', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.updateConveyor = async (req, res) => {
  try {
    const row = await ensureConveyor();
    const payload = req.body || {};
    const conveyors = normalizeConveyors(payload.conveyors);
    await row.update({ conveyors: JSON.stringify(conveyors) });
    res.json({
      success: true,
      data: {
        id: row.id,
        conveyors,
      },
    });
  } catch (e) {
    console.error('[Device.updateConveyor]', e);
    res.status(400).json({ success: false, message: e.message });
  }
};
