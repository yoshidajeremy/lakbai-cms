import React from 'react';
import { filesApi } from './api';
import './FileManager.css';

// ADD: commit cache + helper (above component to avoid scope issues)
const gitCommitCache = {};
async function fetchGitCommitDate(path) {
  const owner = process.env.REACT_APP_GH_OWNER;
  const repo  = process.env.REACT_APP_GH_REPO;
  if (!owner || !repo || !path) return null;
  if (gitCommitCache[path]) return gitCommitCache[path];
  try {
    // GitHub expects repo-relative paths, not absolute
    const repoPath = path.replace(/^\/+/, '');
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(repoPath)}&per_page=1`;
    const headers = { Accept: 'application/vnd.github.v3+json' };
    const token = process.env.REACT_APP_GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    // Defensive: check if array and has at least one commit
    if (Array.isArray(data) && data.length > 0) {
      const iso = data[0]?.commit?.committer?.date || data[0]?.commit?.author?.date || null;
      if (iso) gitCommitCache[path] = iso;
      return iso;
    }
    return null;
  } catch (e) {
    console.warn('GitHub commit fetch failed:', e);
    return null;
  }
}

function bytes(n) {
if (n == null) return '';
const u = ['B','KB','MB','GB']; let i=0; while(n>=1024 && i<u.length-1){n/=1024;i++} return `${n.toFixed(1)} ${u[i]}`;
}

// Pretty date for the "Last Modified" column (handles seconds/ms/date/string)
function formatLastModified(v) {
    if (!v) return '—';
    let d = null;
    if (v instanceof Date) d = v;
    else if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
    else if (typeof v === 'string') {
        const n = Number(v);
        d = isNaN(n) ? new Date(v) : new Date(n < 1e12 ? n * 1000 : n);
    } else if (v?.toDate) {
        d = v.toDate();
    }
    if (!d || isNaN(d.getTime())) return '—';
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// Pick best available modified field from an item
function getItemLastModified(item) {
  // Common API shapes: mtimeMs, mtime, lastModified, updatedAt, modified
  return (
    item?.mtimeMs ??
    item?.mtime ??
    item?.lastModified ??
    item?.updatedAt ??
    item?.modified ??
    null
  );
}

async function blobToBase64(blob) {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
        const res = String(reader.result || '');
        // data:<mime>;base64,<payload>
        const idx = res.indexOf(',');
        resolve(idx >= 0 ? res.slice(idx + 1) : '');
        };
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsDataURL(blob);
    });
}

function parseCsv(text) {
// Simple CSV parser (no quoted commas)
return text
    .split('\n')
    .map(row => row.split(','));
}

function toCsv(rows) {
    return rows.map(row =>
        row.map(cell => (cell.includes(',') ? `"${cell}"` : cell)).join(',')
    ).join('\n');
}

// Pad rows so all have the same number of columns
function normalizeCsvRows(rows, minCols = 1) {
    const maxCols = Math.max(minCols, ...rows.map(r => r.length || 0));
    return rows.map(r => [...r, ...Array(maxCols - r.length).fill('')]);
}

export default function FileManager({ root = process.env.REACT_APP_FILES_ROOT || '' }) {
    const [cwd, setCwd] = React.useState(root);           // e.g. "public", "public/images"
    const [items, setItems] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');
    const [preview, setPreview] = React.useState(null);   // { path, contentBase64, mediaType }
    const [csvEdit, setCsvEdit] = React.useState(null);
    const [modal, setModal] = React.useState({ open: false, type: '', value: '' });
    const [renameModal, setRenameModal] = React.useState({ open: false, item: null, value: '' });
    const [modalFile, setModalFile] = React.useState(null);
    const [creatingFile, setCreatingFile] = React.useState(false);
    const [modalFiles, setModalFiles] = React.useState([]);

    // ADD: git commit meta state
    const [gitMeta, setGitMeta] = React.useState({});

// Lightweight confirm dialog state
const [confirmState, setConfirmState] = React.useState({ open: false, message: '', resolve: null });
const askConfirm = React.useCallback((message) => {
    return new Promise((resolve) => setConfirmState({ open: true, message, resolve }));
}, []);
const closeConfirm = (result) => {
    if (confirmState.resolve) confirmState.resolve(result);
    setConfirmState({ open: false, message: '', resolve: null });
};

const segments = cwd.split('/').filter(Boolean);


const refresh = React.useCallback(async () => {
setLoading(true); setError('');
try {
    const data = await filesApi.list(cwd);
    const list = Array.isArray(data) ? data : []; // guard
    // normalize: directories first
    list.sort((a, b) => (a.type === b.type) ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1));
    setItems(list);
} catch (e) {
    setItems([]);
    setError(e?.message || String(e));
} finally {
    setLoading(false);
}
}, [cwd]);

React.useEffect(() => { refresh(); }, [refresh]);

const go = (next) => setCwd(next.replace(/\/+/g, '/'));
const up = () => { if (cwd === root) return; go(segments.slice(0, -1).join('/')); };

const onUpload = async (file) => {
    // ...existing code...
    const b64 = await blobToBase64(file);
    const path = `${cwd}/${file.name}`.replace(/\/+/g,'/');
    await filesApi.upload({
        path,
        contentBase64: b64,
        message: `Upload ${file.name} to ${cwd}`,
    });
    await refresh();
};

  // Open "Upload files" modal (keeps function name to avoid breaking other code)
const onCreateFile = () => {
    setCreatingFile(false);
    setModalFile(null);
    setModalFiles([]); // reset new multi-file state
    setModal({ open: true, type: 'file', value: '' });
};

const onDownload = async (item) => {
try {
    const { contentBase64, mediaType } = await filesApi.get(item.path);
    const blob = new Blob([Uint8Array.from(atob(contentBase64), c => c.charCodeAt(0))],
                            { type: mediaType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = item.name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
} catch (e) {
    setError(e?.message || String(e));
}
};

const onMkdir = () => setModal({ open: true, type: 'folder', value: '' });
const handleCreateFolder = async () => {
try {
    const name = modal.value.trim();
    if (!name) return;
    setModal({ open: false, type: '', value: '' });
    const path = `${cwd}/${name}`.replace(/\/+/g, '/');
    await filesApi.mkdir({ path, message: `Create folder ${path}` });
    await refresh();
} catch (e) {
    setError(e?.message || String(e));
}
};

const onRename = (item) => {
    setRenameModal({ open: true, item, value: item.name });
};
const handleRename = async () => {
try {
    const name = renameModal.value.trim();
    if (!name || name === renameModal.item.name) {
        setRenameModal({ open: false, item: null, value: '' });
        return;
    }
    const fromPath = renameModal.item.path;
    const toPath = `${cwd}/${name}`.replace(/\/+/g, '/');
    setRenameModal({ open: false, item: null, value: '' });
    await filesApi.rename({ fromPath, toPath, message: `Rename ${fromPath} -> ${toPath}` });
    await refresh();
} catch (e) {
    setError(e?.message || String(e));
}
};
const handleCreateFile = async () => {
try {
    if (!modalFiles || modalFiles.length === 0) return;
    setModal({ open: false, type: '', value: '' });

    await Promise.all(
        modalFiles.map(async (file) => {
        const b64 = await blobToBase64(file);
        const path = `${cwd}/${file.name}`.replace(/\/+/g, '/');
        await filesApi.upload({
            path,
            contentBase64: b64,
            message: `Upload ${file.name} to ${cwd}`,
            });
        })
        );

        setModalFiles([]);
        await refresh();
    } catch (e) {
        setError(e?.message || String(e));
    }
};

const onDelete = async (item) => {
try {
    const ok = await askConfirm(`Delete ${item.path}?`);
    if (!ok) return;
    await filesApi.delete({ path: item.path, message: `Delete ${item.path}` });
    await refresh();
} catch (e) {
    setError(e?.message || String(e));
}
};

const openPreview = async (item) => {
try {
    if (item.type !== 'file') return;
    const { contentBase64, mediaType, sha } = await filesApi.get(item.path);
    const raw = (() => {
        try { return decodeURIComponent(escape(atob(contentBase64))); } catch { return ''; }
    })();
    if (item.name.toLowerCase().endsWith('.csv')) {
        const rows = normalizeCsvRows(parseCsv(raw));
        setCsvEdit({ path: item.path, rows, raw, sha, mediaType });
        setPreview(null);
    } else {
        setPreview({ path: item.path, contentBase64, mediaType });
        setCsvEdit(null);
    }
} catch (e) {
    setError(e?.message || String(e));
}
};

  // Update a single cell (kept as-is)
const handleCsvCellChange = (rowIdx, colIdx, value) => {
    setCsvEdit(edit => {
    const rows = edit.rows.map((row, r) =>
        r === rowIdx ? row.map((cell, c) => (c === colIdx ? value : cell)) : row
        );
        return { ...edit, rows };
    });
};

  // New: grid helpers
const csvColCount = React.useMemo(
    () => Math.max(1, ...(csvEdit?.rows || []).map(r => r.length || 0)),
    [csvEdit]
);

const padCsvGrid = () =>
    setCsvEdit(edit => ({ ...edit, rows: normalizeCsvRows(edit.rows) }));

const addCsvRow = () =>
    setCsvEdit(edit => {
        const cols = Math.max(1, ...(edit.rows || []).map(r => r.length || 0));
        return { ...edit, rows: [...edit.rows, Array(cols).fill('')] };
    });

const addCsvColumn = () =>
    setCsvEdit(edit => ({ ...edit, rows: edit.rows.map(r => [...r, '']) }));

const removeCsvRow = (rIdx) =>
    setCsvEdit(edit => ({ ...edit, rows: edit.rows.filter((_, i) => i !== rIdx) }));

const removeCsvColumn = (cIdx) =>
    setCsvEdit(edit => ({ ...edit, rows: edit.rows.map(r => r.filter((_, i) => i !== cIdx)) }));

  // Save (kept as-is)
const handleCsvSave = async () => {
    if (!csvEdit) return;
    // ensure grid is rectangular before saving
    const csvString = toCsv(normalizeCsvRows(csvEdit.rows));
    const b64 = btoa(unescape(encodeURIComponent(csvString)));
    await filesApi.upload({
        path: csvEdit.path,
        contentBase64: b64,
        message: `Edit CSV ${csvEdit.path}`,
    });
    setCsvEdit(null);
    await refresh();
};

const toolbar = (
    <div className="fm-toolbar">
        <button className='btn-secondary' onClick={up} disabled={cwd === root}>Up</button>
        <div className="fm-path">{cwd}</div>
        <div style={{ flex:1 }} />
        {/* Text changed only; handler unchanged */}
        <button className='btn-primary-cms' onClick={onCreateFile}>Upload files</button>
        <button className='btn-primary-cms' onClick={onMkdir}>New folder</button>
        <button className='btn-primary-cms' onClick={refresh} disabled={loading}>Refresh</button>
    </div>
);

return (
    <div className="fm">
        {toolbar}
        {error && <div style={{ color:'#b91c1c', marginTop:8 }}>{error}</div>}
        {renameModal.open && (
    <div className="fm-confirm" style={{ zIndex: 3000 }}>
        <div className="box" style={{ minWidth: 340, maxWidth: '90vw', textAlign: 'center' }}>
        <h3 style={{ marginBottom: 16 }}>Rename to</h3>
        <input
            autoFocus
            style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            fontSize: 16,
            marginBottom: 18,
            outline: 'none',
            }}
            value={renameModal.value}
            onChange={e => setRenameModal(m => ({ ...m, value: e.target.value }))}
            onKeyDown={e => {
            if (e.key === 'Enter') handleRename();
            }}
            placeholder="Enter new name"
        />
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <button
            className="btn-primary-cms"
            style={{ minWidth: 90 }}
            onClick={handleRename}
            >
            OK
            </button>
            <button
            className="btn-danger"
            style={{ minWidth: 90 }}
            onClick={() => setRenameModal({ open: false, item: null, value: '' })}
            >
            Cancel
            </button>
        </div>
        </div>
    </div>
    )}
        {modal.open && (
            <div className="fm-confirm" style={{ zIndex: 3000 }}>
            <div className="box" style={{ minWidth: 340, maxWidth: '90vw', textAlign: 'center' }}>
                <h3 style={{ marginBottom: 16 }}>
                {modal.type === 'file' ? 'Upload files' : 'New folder name'}
            </h3>

            {/* For folder modal, keep the name input. For file modal, no name field (upload only). */}
            {modal.type === 'folder' && (
                <input
                    autoFocus
                    style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    fontSize: 16,
                    marginBottom: 12,
                    outline: 'none',
                    }}
                    value={modal.value}
                    onChange={e => setModal(m => ({ ...m, value: e.target.value }))}
                    onKeyDown={e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateFolder();
                    }
                    }}
                    placeholder="e.g. my-folder"
                />
            )}

            {modal.type === 'file' && (
                <div style={{ marginBottom: 18 }}>
                    <input
                    type="file"
                    multiple
                    onChange={e => setModalFiles(Array.from(e.target.files || []))}
                    />
                    {modalFiles.length > 0 && (
                    <div style={{ fontSize: 13, marginTop: 6, maxHeight: 150, overflow: 'auto', textAlign: 'left' }}>
                        {modalFiles.map(f => <div key={f.name}>{f.name}</div>)}
                    </div>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                <button
                    className="btn-primary-cms"
                    style={{ minWidth: 90 }}
                    onClick={modal.type === 'file' ? handleCreateFile : handleCreateFolder}
                    disabled={modal.type === 'file' && modalFiles.length === 0}
                >
                OK
                </button>
                <button
                    className="btn-danger"
                    style={{ minWidth: 90 }}
                    onClick={() => { setModal({ open: false, type: '', value: '' }); setModalFile(null); setModalFiles([]); }}
                >
                Cancel
                </button>
            </div>
        </div>
        </div>
    )}
    <div className="fm-table-wrap">
        <table className="fm-table">
        <thead>
            <tr>
            <th style={{ textAlign:'left' }}>Name</th>
            <th style={{ textAlign:'left' }}>Last Modified</th>
            <th style={{ textAlign:'left', width:120 }}>Type</th>
            <th style={{ textAlign:'right', width:120 }}>Size</th>
            <th style={{ width:240 }}></th>
            </tr>
        </thead>
        <tbody>
            {loading ? (
            <tr><td colSpan={4} className="fm-empty">Loading…</td></tr>
            ) : items.length === 0 ? (
            <tr><td colSpan={4} className="fm-empty">Empty</td></tr>
            ) : items.map(item => (
            <tr key={item.path}>
                <td>
                {item.type === 'dir' ? (
                    <a href="#" onClick={(e)=>{e.preventDefault(); go(item.path);}}>{item.name}</a>
                ) : (
                    <a href="#" onClick={(e)=>{e.preventDefault(); openPreview(item);}}>{item.name}</a>
                )}
                </td>
                {/* Prefer Git commit time if available */}
                <td>{formatLastModified(gitMeta[item.path] || getItemLastModified(item))}</td>
                <td>{item.type}</td>
                <td style={{ textAlign:'right' }}>
                    {item.type === 'file' ? bytes(item.size) : ''}
                </td>
                <td className="actions" style={{ textAlign:'right' }}>
                <button className="btn-primary-cms" onClick={()=>onDownload(item)} >Download</button>
                <button className="btn-edit" onClick={()=>onRename(item)}>Rename</button>
                <button className="btn-danger" onClick={()=>onDelete(item)}>Delete</button>
                </td>
            </tr>
            ))}
        </tbody>
        </table>
    </div>

    {/* CSV Modal */}
    {csvEdit && (
        <div className="fm-confirm" style={{ zIndex: 2000 }}>
            <div className="box" style={{ minWidth: 600, maxWidth: '95vw', height: '90vh', overflow: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <strong>Preview & Edit: {csvEdit.path}</strong>
                <button className="btn-danger" onClick={() => setCsvEdit(null)}>Close</button>
                </div>

                {/* Grid tools */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <button className="btn-primary-cms" onClick={addCsvRow}>Add Row</button>
                <button className="btn-primary-cms" onClick={addCsvColumn}>Add Column</button>
                <button className="btn-secondary" onClick={padCsvGrid}>Complete Grid</button>
                <div style={{ marginLeft: 'auto', opacity: 0.7, fontSize: 12 }}>
                    Rows: {csvEdit.rows.length} · Cols: {csvColCount}
                </div>
                </div>

                <div style={{ overflow: 'auto', height: 660, marginBottom: 16 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                    <thead>
                    <tr>
                        <th style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 1, borderBottom: '1px solid #e5e7eb' }}>#</th>
                        {Array.from({ length: csvColCount }).map((_, cIdx) => (
                        <th key={cIdx} style={{ borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap', padding: 4 }}>
                            C{cIdx + 1}
                            <button
                            title="Delete column"
                            className="btn-danger"
                            style={{ marginLeft: 8, padding: '2px 6px', fontSize: 12 }}
                            onClick={() => removeCsvColumn(cIdx)}
                            >
                            −
                            </button>
                        </th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {csvEdit.rows.map((row, rIdx) => (
                        <tr key={rIdx}>
                        <td style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 1, borderRight: '1px solid #e5e7eb' }}>
                            <button
                            title="Delete row"
                            className="btn-danger"
                            style={{ padding: '2px 6px', fontSize: 12 }}
                            onClick={() => removeCsvRow(rIdx)}
                            >
                            −
                            </button>
                        </td>
                        {normalizeCsvRows([row], csvColCount)[0].map((cell, cIdx) => (
                            <td key={cIdx} style={{ border: '1px solid #e5e7eb', padding: 4 }}>
                            <input
                                style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 13 }}
                                value={cell}
                                onChange={e => handleCsvCellChange(rIdx, cIdx, e.target.value)}
                                onKeyDown={e => {
                                if (e.key === 'Enter' && rIdx === csvEdit.rows.length - 1 && cIdx === csvColCount - 1) {
                                    e.preventDefault();
                                    addCsvRow();
                                }
                                }}
                            />
                            </td>
                        ))}
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn-danger" onClick={() => setCsvEdit(null)}>Cancel</button>
                <button className="btn-primary-cms" onClick={handleCsvSave}>Save</button>
            </div>
            </div>
        </div>
    )}

      {/* File preview modal */}
        {preview && (
        <div className="fm-confirm" style={{ zIndex: 2000 }}>
        <div className="box" style={{ minWidth: 400, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Preview: {preview.path}</strong>
            <button className="btn-danger"onClick={()=>setPreview(null)}>Close</button>
            </div>
            <div style={{ marginTop:12 }}>
            {preview.mediaType?.startsWith('image/') ? (
                <img
                src={`data:${preview.mediaType};base64,${preview.contentBase64}`}
                alt={preview.path}
                style={{ maxWidth:'100%', height:'auto' }}
                />
            ) : (
                <pre style={{ overflow:'auto', maxHeight:360, background:'#f9fafb', padding:12, borderRadius:8 }}>
                {(() => {
                    try {
                    return decodeURIComponent(escape(atob(preview.contentBase64)));
                    } catch {
                    return '[binary file]';
                    }
                })()}
                </pre>
            )}
            </div>
        </div>
        </div>
    )}

    {/* Confirm dialog */}
    {confirmState.open && (
        <div className="fm-confirm">
        <div className="box">
            <div style={{ marginBottom: 12, fontWeight: 600 }}>Confirm</div>
            <div style={{ marginBottom: 16 }}>{confirmState.message}</div>
            <div className="actions">
            <button className="btn-primary-cms" onClick={() => closeConfirm(false)}>Cancel</button>
            <button className="btn-danger" onClick={() => closeConfirm(true)}>Delete</button>
            </div>
        </div>
        </div>
    )}
    </div>
);
}