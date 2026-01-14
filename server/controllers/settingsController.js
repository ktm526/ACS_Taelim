// controllers/settingsController.js
const Settings = require('../models/Settings');

async function ensureSingleton() {
  const [row] = await Settings.findOrCreate({
    where: { id: 1 },
    defaults: { id: 1 },
  });
  return row;
}

exports.get = async (req, res) => {
  try {
    const row = await ensureSingleton();
    res.json({ success: true, data: row });
  } catch (e) {
    console.error('[Settings.get]', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const row = await ensureSingleton();
    const patch = { ...req.body };

    if (patch.id != null) delete patch.id;
    if (patch.charge_threshold_percent != null) patch.charge_threshold_percent = Number(patch.charge_threshold_percent);
    if (patch.charge_complete_percent != null) patch.charge_complete_percent = Number(patch.charge_complete_percent);
    if (patch.grinder_wait_ms != null) patch.grinder_wait_ms = Number(patch.grinder_wait_ms);

    await row.update(patch);
    res.json({ success: true, data: row });
  } catch (e) {
    console.error('[Settings.update]', e);
    res.status(400).json({ success: false, message: e.message });
  }
};

