// The list of councils, kept in the repository as index/councils.json.
// Every council runs exactly the same meeting. What sets one apart is its Awareness: the outlook its owner wrote when
// creating it, which every seat reads as the council's soul. Each council keeps its own portfolio, ledger and meetings
// in its own folder under index/ (the first one, "council", keeps the folder it always had).
'use strict';

const FIRST = { id: 'council', name: 'Oazy Council', awareness: '', color: '#ffd76a', createdAt: '2026-11-04T00:00:00.000Z' };
const COLORS = ['#33c3ff', '#2fd6a8', '#ff8a5c', '#b58cff', '#ff6aa2', '#9ad94a', '#5b8cff', '#ffb547', '#3ddc97', '#ff5c7a'];
const LIMITS = { name: 40, awareness: 4000 };

/* The councils in the file, with the first council always present and first. */
function parse(text) {
  let list = [];
  try { const j = text ? JSON.parse(text) : null; list = Array.isArray(j?.councils) ? j.councils : []; } catch {}
  list = list.filter((c) => c && typeof c.id === 'string' && /^council(-[a-z0-9-]+)?$/.test(c.id));
  const first = list.find((c) => c.id === FIRST.id);
  return [{ ...FIRST, ...(first || {}) }, ...list.filter((c) => c.id !== FIRST.id)];
}
const serialize = (list) => JSON.stringify({ councils: list }, null, 2) + '\n';

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'new';

/* A new council's entry. Throws a plain-English error when the name or Awareness is missing or too long. */
function make(list, { name, awareness }) {
  name = String(name || '').trim().replace(/\s+/g, ' '); awareness = String(awareness || '').trim();
  if (!name) throw new Error('Give the council a name.');
  if (name.length > LIMITS.name) throw new Error(`Keep the name under ${LIMITS.name} characters.`);
  if (!awareness) throw new Error('Write the council\'s Awareness. It is what makes this council different.');
  if (awareness.length > LIMITS.awareness) throw new Error(`Keep the Awareness under ${LIMITS.awareness} characters.`);
  if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error('There is already a council with this name.');
  let id = 'council-' + slug(name), n = 2;
  while (list.some((c) => c.id === id)) id = 'council-' + slug(name) + '-' + n++;
  const color = COLORS.find((c) => !list.some((x) => x.color === c)) || COLORS[list.length % COLORS.length];
  return { id, name, awareness, color, createdAt: new Date().toISOString() };
}

module.exports = { FIRST, COLORS, LIMITS, parse, serialize, make, slug };
