function pad(text, width, align = "left") {
  const s = text === null || text === undefined ? "-" : String(text);
  if (s.length >= width) return s.slice(0, width);
  const space = " ".repeat(width - s.length);
  return align === "right" ? space + s : s + space;
}

function nowTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * rows: [{ group, label, plcId, desired, current, action, note }]
 */
function printAmrPlcCompareTable({ robotName, rows, tookMs, onlyDiff = false }) {
  const filtered = onlyDiff
    ? rows.filter((r) => r && Number(r.current) !== Number(r.desired) || r.action || r.note)
    : rows;
  if (!filtered.length) return;

  const header =
    `[AMR-PLC-CMP] ${nowTime()}  ${robotName || "-"}  rows=${filtered.length}` +
    (tookMs != null ? `  tookMs=${tookMs}` : "");

  const cols = {
    group: 6,
    label: 12,
    plc: 12,
    desired: 7,
    current: 7,
    action: 8,
  };

  let out = "";
  out += `${header}\n`;
  out +=
    `${pad("GROUP", cols.group)} ` +
    `${pad("KEY", cols.label)} ` +
    `${pad("PLC", cols.plc)} ` +
    `${pad("DES", cols.desired, "right")} ` +
    `${pad("CUR", cols.current, "right")} ` +
    `${pad("ACTION", cols.action)} ` +
    `NOTE\n`;
  out += `${"-".repeat(66)}\n`;

  for (const r of filtered) {
    out +=
      `${pad(r.group, cols.group)} ` +
      `${pad(r.label, cols.label)} ` +
      `${pad(r.plcId, cols.plc)} ` +
      `${pad(r.desired, cols.desired, "right")} ` +
      `${pad(r.current, cols.current, "right")} ` +
      `${pad(r.action, cols.action)} ` +
      `${r.note || ""}\n`;
  }
  out += "\n";
  process.stdout.write(out);
}

module.exports = { printAmrPlcCompareTable };

