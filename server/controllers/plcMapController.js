// controllers/plcMapController.js
const { Op } = require('sequelize');
const PLCMap = require('../models/PLCMap');

exports.list = async (req, res) => {
  try {
    const { class: cls, product_type, amr_station, mani_id, q } = req.query;
    const where = {};

    if (cls) where.class = cls;
    if (product_type != null) where.product_type = Number(product_type);
    if (amr_station) where.amr_station = amr_station;
    if (mani_id) where.mani_id = mani_id;
    if (q) {
      where[Op.or] = [
        { amr_station: { [Op.like]: `%${q}%` } },
        { mani_id: { [Op.like]: `%${q}%` } },
        { description: { [Op.like]: `%${q}%` } },
      ];
    }

    const rows = await PLCMap.findAll({ where, order: [['id', 'ASC']] });
    res.json(rows);
  } catch (e) {
    console.error('[PLCMap.list]', e);
    res.status(500).json({ message: e.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const row = await PLCMap.findByPk(Number(req.params.id));
    if (!row) return res.sendStatus(404);
    res.json(row);
  } catch (e) {
    console.error('[PLCMap.getById]', e);
    res.status(500).json({ message: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { id, amr_station, mani_id = null, class: cls, product_type = null, description = null } = req.body;
    if (id == null) return res.status(400).json({ message: 'id(plc bit) is required' });
    if (!amr_station) return res.status(400).json({ message: 'amr_station is required' });
    if (!cls) return res.status(400).json({ message: 'class is required' });

    const row = await PLCMap.create({
      id: Number(id),
      amr_station,
      mani_id,
      class: cls,
      product_type: product_type == null ? null : Number(product_type),
      description,
    });
    res.status(201).json(row);
  } catch (e) {
    console.error('[PLCMap.create]', e);
    res.status(400).json({ message: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await PLCMap.findByPk(id);
    if (!row) return res.sendStatus(404);

    const patch = { ...req.body };
    if (patch.id != null) delete patch.id; // pk 변경 방지
    if (patch.product_type != null) patch.product_type = Number(patch.product_type);
    await row.update(patch);
    res.json(row);
  } catch (e) {
    console.error('[PLCMap.update]', e);
    res.status(400).json({ message: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const count = await PLCMap.destroy({ where: { id } });
    if (!count) return res.sendStatus(404);
    res.json({ success: true });
  } catch (e) {
    console.error('[PLCMap.remove]', e);
    res.status(500).json({ message: e.message });
  }
};

