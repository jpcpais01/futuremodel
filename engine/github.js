// The repository is the council's home: jpcpais01/futuremodel, folder index/. Reading needs nothing (the repo is public).
// Saving a meeting needs a fine-grained token for this one repo with Contents set to Read and write, and is one commit.
'use strict';

const REPO = 'jpcpais01/futuremodel', BRANCH = 'main', DIR = 'index';
const API = `https://api.github.com/repos/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${REPO}`;
const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';
let doFetch = (...a) => fetch(...a);
function setFetch(fn) { doFetch = fn; }

const head = (token) => ({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
async function api(path, { token, method = 'GET', body, timeout = 30000 } = {}) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await doFetch(API + path, { method, headers: { ...head(token), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal, cache: 'no-store' });
    const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) throw Object.assign(new Error(data?.message || `GitHub answered ${r.status}`), { status: r.status });
    return data;
  } finally { clearTimeout(t); }
}

/* The newest commit on main, so reads are never served stale from GitHub's cache. Null if the API is unavailable. */
async function latest(token) { try { return (await api(`/commits/${BRANCH}`, { token, timeout: 12000 }))?.sha || null; } catch { return null; } }

/* A file under index/, as text. null when it does not exist yet. */
async function read(rel, { sha, token } = {}) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await doFetch(`${RAW}/${sha || BRANCH}/${DIR}/${rel}`, { signal: ac.signal, cache: sha ? 'default' : 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

/* Checks a token: it must reach this repository and be allowed to write to it. */
async function check(token) {
  if (!token) return { ok: false, why: 'Paste a token first.' };
  try {
    const r = await api('', { token, timeout: 15000 });
    if (!r?.permissions?.push) return { ok: false, why: 'This token can read the repository but not save to it. Set Contents to "Read and write".' };
    return { ok: true };
  } catch (e) {
    if (e.status === 401) return { ok: false, why: 'GitHub does not accept this token. It may be mistyped or expired.' };
    if (e.status === 404 || e.status === 403) return { ok: false, why: 'This token cannot see futuremodel. When you make it, choose "Only select repositories" and pick futuremodel.' };
    return { ok: false, why: 'Could not reach GitHub: ' + e.message };
  }
}

/* Writes several files under index/ in one commit on main. files: { 'council/state.json': text, ... }.
   Fails with code 'MOVED' when main moved on while this was being prepared; the caller rebuilds and tries again. */
async function commit({ token, files, message, parent }) {
  const ref = await api(`/git/ref/heads/${BRANCH}`, { token });
  const base = ref.object.sha;
  if (parent && parent !== base) throw Object.assign(new Error('The repository changed meanwhile.'), { code: 'MOVED', sha: base });
  const baseTree = (await api(`/git/commits/${base}`, { token })).tree.sha;
  const tree = [];
  for (const [rel, text] of Object.entries(files)) {
    const blob = await api('/git/blobs', { token, method: 'POST', body: { content: text, encoding: 'utf-8' }, timeout: 60000 });
    tree.push({ path: `${DIR}/${rel}`, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const t = await api('/git/trees', { token, method: 'POST', body: { base_tree: baseTree, tree } });
  const c = await api('/git/commits', { token, method: 'POST', body: { message, tree: t.sha, parents: [base] } });
  try { await api(`/git/refs/heads/${BRANCH}`, { token, method: 'PATCH', body: { sha: c.sha, force: false } }); }
  catch (e) { if (e.status === 422 || e.status === 409) throw Object.assign(new Error('The repository changed meanwhile.'), { code: 'MOVED' }); throw e; }
  return c.sha;
}

module.exports = { REPO, BRANCH, TOKEN_PAGE, latest, read, check, commit, setFetch, url: `https://github.com/${REPO}/tree/${BRANCH}/${DIR}` };
