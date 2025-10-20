import React, { useEffect, useMemo, useState } from 'react';
import { db } from './firebase';
import { addDoc, collection, serverTimestamp, setDoc, doc } from 'firebase/firestore'; // Add setDoc and doc imports
import { getDocs } from 'firebase/firestore';
import AddFromCsvToggle, { IgnoreColumnsDropdown } from './addfromcsv-toggle';
import { logDestinationImport } from './addfromcsv-audit';



async function getExistingDestinationNames() {
  const snap = await getDocs(collection(db, 'destinations'));
  const names = new Set();
  snap.forEach(doc => {
    const data = doc.data();
    if (data?.name) names.add(String(data.name).trim().toLowerCase());
  });
  return names;
}

// ---- Parsing helpers ----
function parseCsv(text) {
  // Robust CSV parser with quotes support
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      } else {
        field += ch; i++; continue;
      }
    } else {
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { pushField(); i++; continue; }
      if (ch === '\n') { pushField(); pushRow(); i++; continue; }
      if (ch === '\r') { // handle CRLF
        if (text[i + 1] === '\n') i++;
        pushField(); pushRow(); i++; continue;
      }
      field += ch; i++;
    }
  }
  // last field/row
  pushField();
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) pushRow();

  return rows;
}

const XLSX_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

function loadXlsxLib() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement('script');
    s.src = XLSX_CDN;
    s.async = true;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Failed to load XLSX library'));
    document.head.appendChild(s);
  });
}

function fileExt(name = '') {
  const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/i);
  return m ? m[1] : '';
}

async function readGridFromFile(file) {
  const ext = fileExt(file.name);
  const isExcel = /xlsx|xls/.test(ext) || /sheet|excel/.test(file.type);
  if (!isExcel) {
    // CSV
    const text = await file.text();
    return parseCsv(text);
  }
  // Excel
  const ab = await file.arrayBuffer();
  const XLSX = await loadXlsxLib();
  const wb = XLSX.read(ab, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  return grid;
}

function toCamelKey(s) {
  return String(s || '')
    .trim()
    .replace(/^[\W_]+|[\W_]+$/g, '')
    .toLowerCase()
    .replace(/[\W_]+(\w)/g, (_, c) => (c || '').toUpperCase());
}

// ---- Validation helpers ----

// Canonical required columns and their user-facing labels
const REQUIRED = {
  name: 'Destination Name',
  region: 'Region',
  category: 'Category',
  description: 'Description',
  tags: 'Tags',
  location: 'Location',
  price: 'Price',              // NEW
  bestTime: 'Best Time to Visit',
  image: 'Image URL',        // not strictly required, but recommended
  reviews: 'Reviews',
  rating: 'Rating',
};



// Aliases that map incoming headers to canonical keys
const ALIASES = {
  name: ['name', 'destinationname', 'destination', 'title'],
  region: ['region', 'province', 'area', 'state'],
  categories: ['category', 'type', 'segment'],
  description: ['description', 'summary', 'details'],
  tags: ['tags', 'keywords', 'labels'],
  location: ['location', 'city', 'place'],
  price: ['price', 'pricerange', 'budget', 'cost', 'amount'], // NEW
  bestTime: ['besttime', 'besttimetovisit', 'season'],
  image: ['image', 'imageurl', 'featuredimage', 'cover', 'photo', 'picture'],
  reviews: ['review', 'reviews'], // <-- add plural here
  rating: ['rating', 'stars'],
};

// Build a quick lookup set of normalized header keys
function headerKeySet(headers) {
  const set = new Set();
  for (const h of headers) set.add(toCamelKey(h).toLowerCase());
  return set;
}

// For a given row object and an alias list, return the first non-empty value
function getFirstValue(row, aliases) {
  for (const k of aliases) {
    const v = row[k];
    if (v !== undefined && String(v).trim() !== '') return v;
  }
  return '';
}

function normalizeRowObject(rowArray, headersRaw) {
  const obj = {};
  headersRaw.forEach((h, idx) => {
    obj[toCamelKey(h).toLowerCase()] = rowArray[idx] ?? '';
  });
  return obj;
}

// ---- Row -> Destination mapping ----
function rowToDestination(raw) {

  // Helper: read using aliases and defaults
  const g = (keys, def = '') => {
    const v = getFirstValue(raw, keys);
    return v === '' ? def : v;
  };

  const name = g(ALIASES.name);
  if (!name) return null;

  const tagsRaw = g(ALIASES.tags, '');
  const tags = String(tagsRaw)
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const galleryRaw = raw.gallery || raw.galleryImages || raw.mediaGallery || '';
  const gallery = String(galleryRaw)
    .split(/[|,; ]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const ratingStr = raw.rating || raw.stars || '0';
  const rating = Math.max(0, Math.min(5, Number(ratingStr) || 0));

  const status = String(raw.status ?? 'draft').toLowerCase();

  // NEW: robust price parsing
  const parsePrice = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const cleaned = String(v)
      .replace(/[^0-9.,]/g, '')
      .replace(/,/g, '')
      .trim();
    if (!cleaned) return null;
    const num = Number(cleaned);
    return isFinite(num) ? num : null;
  };

  const priceRaw =
    raw.price ??
    raw.pricerange ??
    raw.budget ??
    raw.cost ??
    raw.amount ??
    '';

  const priceNum = parsePrice(priceRaw);

  const categoriesRaw = g(ALIASES.categories, '');
  const categories = String(categoriesRaw)
    .split(/[|,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const dest = {
    name: String(name).trim(),
    categories, // now an array
    description: g(ALIASES.description, ''),
    content: raw.content || raw.body || raw.html || '',
    tags,
    location: g(ALIASES.location, ''),
    region: g(ALIASES.region, ''),
    priceRange: priceRaw,
    price: priceNum,
    bestTime: g(ALIASES.bestTime, ''),
    rating,
    media: {
      // Use aliases to get the image URL from the CSV/excel file
      featuredImage: getFirstValue(raw, ALIASES.image),
      gallery
    },
    status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const featured = String(raw.featured ?? raw.isfeatured ?? '').toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(featured)) dest.featured = true;

  return dest;
}


const AddFromCsvCMS = ({ open, onClose, onImported }) => {
  const [importProgress, setImportProgress] = useState({ imported: 0, failed: 0, total: 0 });
  const [rows, setRows] = useState([]);           // array of normalized row objects (keys = normalized headers)
  const [headers, setHeaders] = useState([]);     // raw headers as strings
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [missingColumns, setMissingColumns] = useState([]); // array of user-facing labels
  const [rowIssues, setRowIssues] = useState([]);           // [{ row: 2, missing: ['Destination Name', ...] }]
  // State for existing names check
  const [allExist, setAllExist] = useState(false);
  const [existingRowsSummary, setExistingRowsSummary] = useState('');
  const [importedFilePath, setImportedFilePath] = useState('');
  // NEW: track if any imported name already exists
  const [anyExist, setAnyExist] = useState(false);

  const [existingNameLocation, setExistingNameLocation] = useState([]);

  // State for imported file path
useEffect(() => {
  let ignore = false;
  async function checkExisting() {
    if (!rows.length) {
      setAllExist(false);
      setAnyExist(false);
      setExistingRowsSummary('');
      setExistingNameLocation([]); // <-- clear when no rows
      return;
    }
    const existingNames = await getExistingDestinationNames();
    const importedNames = rows.map(r =>
      String(r.name || r.destinationname || r.title || '').trim().toLowerCase()
    ).filter(Boolean);

    // Fetch all existing destinations with name and location
    const snap = await getDocs(collection(db, 'destinations'));
    const nameLocArr = [];
    snap.forEach(doc => {
      const data = doc.data();
      if (data?.name) {
        nameLocArr.push({
          name: String(data.name).trim().toLowerCase(),
          location: String(data.location || '').trim().toLowerCase()
        });
      }
    });
    if (!ignore) setExistingNameLocation(nameLocArr);

    const alreadyExist = importedNames.filter(n => existingNames.has(n));
    if (!ignore) {
      setAllExist(alreadyExist.length === importedNames.length && importedNames.length > 0);
      setAnyExist(alreadyExist.length > 0);
      if (alreadyExist.length) {
        setExistingRowsSummary(
          `Already exists: ${alreadyExist.slice(0, 5).join(', ')}${alreadyExist.length > 5 ? `, and ${alreadyExist.length - 5} more` : ''}`
        );
      } else {
        setExistingRowsSummary('');
      }
    }
  }
  checkExisting();
  return () => { ignore = true; };
}, [rows]);


  // NEW: helper to reset modal state when it closes
  const resetModal = () => {
    setRows([]);
    setHeaders([]);
    setError('');
    setMissingColumns([]);
    setRowIssues([]);
    setBusy(false);
    setImportedFilePath('');
  };

  // NEW: alert message state
  const [alertMsg, setAlertMsg] = useState('');
  const [alertType, setAlertType] = useState('success'); // 'success' or 'error'

  // NEW: when modal closes (open -> false), clear previous content
  useEffect(() => {
    if (!open) resetModal();
  }, [open]);

  // Replace the preview memo to show ALL rows (scrollable container will limit the height)
  const preview = useMemo(() => rows, [rows]);

  // NEW: close on Esc key while open
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!busy) onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  
  // Add this constant for the columns that can be ignored
  const IGNORABLE_COLUMNS = [
    { key: 'name', label: 'Destination Name' },
    { key: 'region', label: 'Region' },
    { key: 'category', label: 'Category' },
    { key: 'description', label: 'Description' },
    { key: 'tags', label: 'Tags' },
    { key: 'location', label: 'Location' },
    { key: 'bestTime', label: 'Best Time to Visit' },
    { key: 'price', label: 'Price' },
    { key: 'image', label: 'Image URL' },
    { key: 'reviews', label: 'Reviews' },
    { key: 'rating', label: 'Rating' },
  ];

  // State for ignored columns
  const [ignoredCols, setIgnoredCols] = useState({});

  // Handler for toggling ignore state
  const handleIgnoreToggle = (key, checked) => {
    setIgnoredCols(prev => ({ ...prev, [key]: checked }));
  };

  // Only show toggles for columns that are missing in at least one row (always show, even if ignored)
  const missingLabels = useMemo(() => {
    // Collect all missing labels from rowIssues
    const labels = new Set();
    rowIssues.forEach(issue => {
      issue.missing.forEach(label => labels.add(label));
    });
    return Array.from(labels);
  }, [rowIssues]);

  // Columns that have at least one missing cell (independent of ignore state)
  const columnsWithMissingCells = useMemo(() => {
    if (!rows.length) return [];
    const labels = [];
    for (const [canon, label] of Object.entries(REQUIRED)) {
      // respect current ignore selections when validating header presence later,
      // but for the dropdown we only care about cell-missing status in data
      const aliases = ALIASES[canon] || [canon];
      const hasMissing = rows.some(r => String(getFirstValue(r, aliases)).trim() === '');
      if (hasMissing) labels.push(label);
    }
    return labels;
  }, [rows]);

  // Filter rowIssues to remove ignored columns from missing warnings
  const filteredRowIssues = useMemo(() => {
    if (!rowIssues.length) return [];
    return rowIssues
      .map(issue => ({
        ...issue,
        missing: issue.missing.filter(label => {
          const col = IGNORABLE_COLUMNS.find(c => c.label === label);
          return !(col && ignoredCols[col.key]);
        })
      }))
      .filter(issue => issue.missing.length > 0);
  }, [rowIssues, ignoredCols]);

  // Filter REQUIRED and ALIASES based on ignoredCols
  const effectiveRequired = useMemo(() => {
    const req = { ...REQUIRED };
    Object.keys(ignoredCols).forEach(key => {
      if (ignoredCols[key]) delete req[key];
    });
    return req;
  }, [ignoredCols]);

  const effectiveAliases = useMemo(() => {
    const aliases = { ...ALIASES };
    Object.keys(ignoredCols).forEach(key => {
      if (ignoredCols[key]) delete aliases[key];
    });
    return aliases;
  }, [ignoredCols]);

  useEffect(() => {
    if (!headers.length) {
      setMissingColumns([]);
      setRowIssues([]);
      return;
    }
    // Header validation
    const setKeys = headerKeySet(headers);
    const missing = [];
    for (const [canon, label] of Object.entries(effectiveRequired)) {
      const aliases = effectiveAliases[canon] || [canon];
      const present = aliases.some((k) => setKeys.has(k));
      if (!present) missing.push(label);
    }
    setMissingColumns(missing);

    // Row validation
    if (rows.length) {
      const issues = [];
      rows.forEach((r, idx) => {
        const miss = [];
        for (const [canon, label] of Object.entries(effectiveRequired)) {
          const aliases = effectiveAliases[canon] || [canon];
          const val = getFirstValue(r, aliases);
          if (String(val).trim() === '') miss.push(label);
        }
        if (miss.length) issues.push({ row: idx + 2, missing: miss }); // +2 to account for header row
      });
      setRowIssues(issues);
    } else {
      setRowIssues([]);
    }
  }, [headers, rows, effectiveRequired, effectiveAliases]);
  // Add before your return statement
  
  if (!open) return null;

  const handleGrid = (grid) => {
    if (!grid || !grid.length) throw new Error('No data found in file.');
    const hdrs = grid[0];
    const body = grid.slice(1).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''));
    const normalizedRows = body.map((r) => normalizeRowObject(r, hdrs));
    setHeaders(hdrs);
    setRows(normalizedRows);
  };

  const handleFile = async (file) => {
    setError('');
    setImportedFilePath(file?.name || ''); // Set the file name (or path if available)
    try {
      const grid = await readGridFromFile(file);
      handleGrid(grid);
    } catch (e) {
      console.error(e);
      setRows([]);
      setHeaders([]);
      setError(e?.message || 'Failed to read file.');
    }
  };

  const handlePaste = (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (!text) return;
    e.preventDefault();
    try {
      const grid = parseCsv(text);
      handleGrid(grid);
      setError('');
    } catch {
      setError('Failed to parse pasted CSV.');
    }
  };

  
  // Pass effectiveAliases to rowToDestination
  function rowToDestinationWithIgnore(raw) {
    // Helper: read using aliases and defaults
    const g = (keys, def = '') => {
      const v = getFirstValue(raw, keys);
      return v === '' ? def : v;
    };

    // Use effectiveAliases for all lookups
    const name = g(effectiveAliases.name || [], '');
    if (!name && !ignoredCols.name) return null;

    const tagsRaw = g(effectiveAliases.tags || [], '');
    const tags = String(tagsRaw)
      .split(/[|,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const galleryRaw = raw.gallery || raw.galleryImages || raw.mediaGallery || '';
    const gallery = String(galleryRaw)
      .split(/[|,; ]/)
      .map((s) => s.trim())
      .filter(Boolean);

    // Parse rating
    const ratingStr = raw.rating || raw.stars || '0';
    const rating = Math.max(0, Math.min(5, Number(ratingStr) || 0));

    // Parse review (allow decimals, fallback to 0)
    const reviewStr = raw.review || raw.reviews || '0';
    const review = Number(reviewStr) || 0;

    const status = String(raw.status ?? 'draft').toLowerCase();

    // NEW: robust price parsing
    const parsePrice = (v) => {
      if (v == null) return null;
      if (typeof v === 'number') return isFinite(v) ? v : null;
      const cleaned = String(v)
        .replace(/[^0-9.,]/g, '')
        .replace(/,/g, '')
        .trim();
      if (!cleaned) return null;
      const num = Number(cleaned);
      return isFinite(num) ? num : null;
    };

    const priceRaw =
      raw.price ??
      raw.pricerange ??
      raw.budget ??
      raw.cost ??
      raw.amount ??
      '';

    const priceNum = parsePrice(priceRaw);

    const categoriesRaw = g(effectiveAliases.categories || [], '');
    const categories = String(categoriesRaw)
      .split(/[|,;]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const dest = {
      ...(ignoredCols.name ? {} : { name: String(name).trim() }),
      ...(ignoredCols.categories ? {} : { categories }),
      ...(ignoredCols.description ? {} : { description: g(effectiveAliases.description || [], '') }),
      content: raw.content || raw.body || raw.html || '',
      ...(ignoredCols.tags ? {} : { tags }),
      ...(ignoredCols.location ? {} : { location: g(effectiveAliases.location || [], '') }),
      ...(ignoredCols.region ? {} : { region: g(effectiveAliases.region || [], '') }),
      ...(ignoredCols.price ? {} : { priceRange: priceRaw, price: priceNum }),
      ...(ignoredCols.bestTime ? {} : { bestTime: g(effectiveAliases.bestTime || [], '') }),
      ...(ignoredCols.rating ? {} : { rating }),
      ...(ignoredCols.reviews ? {} : { review }),
      media: {
        // Use aliases to get the image URL from the CSV/excel file
        ...(ignoredCols.image ? {} : { featuredImage: getFirstValue(raw, effectiveAliases.image || []) }),
        gallery
      },
      status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const featured = String(raw.featured ?? raw.isfeatured ?? '').toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(featured)) dest.featured = true;

    return dest;
  }
  

  const importNow = async () => {
    if (!rows.length) return;
    if (missingColumns.length) return alert('Please include all required columns before importing.');
    if (rowIssues.length) return alert('Please fill all required cells before importing.');

    const duplicateNames = findDuplicateNames(rows);
    if (duplicateNames.length && !ignoredCols.name) {
      setAlertType('error');
      setAlertMsg(`Duplicate destination names found: ${duplicateNames.join(', ')}`);
      setTimeout(() => setAlertMsg(''), 3500);
      return;
    }

    setBusy(true);
    try {
      // Firebase duplicate check
      const existingNames = await getExistingDestinationNames();
      const importedNames = rows.map(r =>
        String(r.name || r.destinationname || r.title || '').trim().toLowerCase()
      ).filter(Boolean);

      // --- NEW: Check for same name AND same location ---
      const importedNameLocation = rows.map(r => ({
      name: String(r.name || r.destinationname || r.title || '').trim().toLowerCase(),
      location: String(r.location || '').trim().toLowerCase()
      }));

      // Fetch all existing destinations with name and location
      const snap = await getDocs(collection(db, 'destinations'));
      const existingNameLocation = [];
      snap.forEach(doc => {
        const data = doc.data();
        if (data?.name) {
          existingNameLocation.push({
            name: String(data.name).trim().toLowerCase(),
            location: String(data.location || '').trim().toLowerCase()
          });
        }
      });

          // Find duplicates: same name AND same location
    const duplicates = importedNameLocation.filter(imported =>
      existingNameLocation.some(existing =>
        imported.name === existing.name && imported.location === existing.location
      )
    );

    if (duplicates.length && !ignoredCols.name) {
      setAlertType('error');
      setAlertMsg(
        `Destination(s) already exist with same name and location: ${duplicates
          .map(d => `${d.name} (${d.location})`)
          .slice(0, 5)
          .join(', ')}${duplicates.length > 5 ? `, and ${duplicates.length - 5} more` : ''}`
      );
      setTimeout(() => setAlertMsg(''), 3500);
      setBusy(false);
      return;
    }

    // Continue with previous duplicate name check (name only, not location)
    const firebaseDuplicates = importedNames.filter(n => existingNames.has(n));
    if (firebaseDuplicates.length && !ignoredCols.name) {
      setAlertType('error');
      setAlertMsg(`Destination names already exist: ${firebaseDuplicates.join(', ')}`);
      setTimeout(() => setAlertMsg(''), 3500);
      setBusy(false);
      return;
    }
      // Map rows to destination docs
      const toCreate = [];
      for (const raw of rows) {
        const dest = rowToDestinationWithIgnore(raw);
        if (dest) toCreate.push(dest);
      }
      setImportProgress({ imported: 0, failed: 0, total: toCreate.length }); // before import loop

      if (!toCreate.length) {
        alert('No valid rows to import.');
        return;
      }

      // Create in Firestore (destinations) using name as ID
      const now = new Date();
      const created = [];
      for (const item of toCreate) {
        try {
          // Set packingSuggestions based on category if not present
          let packingSuggestions = item.packingSuggestions;
          // Use only the first category for storage
          const cat = Array.isArray(item.categories) && item.categories.length
            ? String(item.categories[0]).toLowerCase()
            : (item.category ? String(item.category).toLowerCase() : '');
          packingSuggestions = packingSuggestions || PACKING_SUGGESTIONS_BY_CATEGORY[cat] || '';
          item.packingSuggestions = packingSuggestions;

          // Store only 'category' as string, not 'categories' array
          item.category = cat;
          // Always remove categories field to avoid undefined/null
          if ('categories' in item) delete item.categories;

          // Use destination name as ID (slugify for safety)
          const id = item.name
            ? String(item.name)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-') // replace non-alphanumeric with dash
                .replace(/^-+|-+$/g, '')    // trim dashes
            : Math.random().toString(36).slice(2, 10); // fallback if name is ignored
          await setDoc(doc(db, 'destinations', id), cleanFirestoreDoc(item));
          // Log audit
          await logDestinationImport(
            cleanFirestoreDoc ({
              destination: cleanFirestoreDoc(item),
              userId: 'cuuEceXHEmOMa37xQeSTFbixeqt2',
              userEmail: 'aclanjeremy432@gmail.com',
              userRole: 'admin',
              sessionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              device: 'Desktop',
              browser: getBrowserInfo(),
              os: getOSInfo(),
              userAgent: navigator.userAgent,
              outcome: `success (${created.length > 0 ? 200 : 204})`
            })
          );
          created.push({ ...item, id, createdAt: now, updatedAt: now });
          setImportProgress(prev => ({ ...prev, imported: prev.imported + 1 }));
        } catch (e) {
          setImportProgress(prev => ({ ...prev, failed: prev.failed + 1 }));
        }
      }

      // Add error handling for existing name and url in dest-images.json
      const checkExistingInDestImages = async (images) => {
        try {
          const res = await fetch('http://localhost:4000/src/dest-images.json');
          if (!res.ok) return { existingNames: [], existingUrls: [] };
          const destImages = await res.json();
          const existingNames = [];
          const existingUrls = [];
          images.forEach(img => {
            if (destImages.some(d => d.name.trim().toLowerCase() === img.name.trim().toLowerCase())) {
              existingNames.push(img.name);
            }
            if (destImages.some(d => d.url === img.url)) {
              existingUrls.push(img.url);
            }
          });
          return { existingNames, existingUrls };
        } catch {
          return { existingNames: [], existingUrls: [] };
        }
      };

      if (created.length) {
        // Collect new images
        const newImages = created.map(d => ({
          name: d.name,
          url: d.media?.featuredImage || ''
        })).filter(img => img.name && img.url);

        // --- Error handling for existing name/url in dest-images.json ---
        const { existingNames, existingUrls } = await checkExistingInDestImages(newImages);

        // Filter out images that already exist by name or url
        const filteredImages = newImages.filter(
          img =>
            !existingNames.includes(img.name) &&
            !existingUrls.includes(img.url)
        );

        // Send only new images to backend API
        if (filteredImages.length) {
          fetch('http://localhost:4000/api/appendDestImages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(filteredImages)
          });
        }

        // Show summary alert if any were skipped
        if (existingNames.length || existingUrls.length) {
          setAlertType('error');
          setAlertMsg(
            `Skipped ${existingNames.length} name(s) and ${existingUrls.length} url(s) already in dest-images.json.`
          );
          setTimeout(() => setAlertMsg(''), 3500);
        } else {
          setAlertType('success');
          setAlertMsg(`Imported ${created.length} destination(s).`);
          setTimeout(() => setAlertMsg(''), 2500);
        }

        onImported?.(created);
        setTimeout(() => {
          setAlertMsg('');
          onClose?.();
        }, 2500);
      } else {
        setAlertType('error');
        setAlertMsg('No rows were imported.');
        setTimeout(() => setAlertMsg(''), 2500);
      }
    } catch (e) {
      console.error(e);
      setAlertType('error');
      setAlertMsg('Import failed.');
      setTimeout(() => setAlertMsg(''), 2500);
    } finally {
      setBusy(false);
    }
  };

  function findDuplicateNames(rows) {
    const nameCount = {};
    rows.forEach(r => {
      const name = String(r.name || r.destinationname || r.title || '').trim().toLowerCase();
      if (name) nameCount[name] = (nameCount[name] || 0) + 1;
    });
    return Object.entries(nameCount)
      .filter(([_, count]) => count > 1)
      .map(([name]) => name);
  }

  // Track if all imported rows already exist


  // Check for existing destinations on file import or rows change


  const disableImport =
  busy ||
  rows.length === 0 ||
  missingColumns.some(label => {
    const col = IGNORABLE_COLUMNS.find(c => c.label === label);
    return !(col && ignoredCols[col.key]);
  }) ||
  filteredRowIssues.length > 0 ||
  (!ignoredCols.name && anyExist) ||
  allExist;



  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ width: 'min(2000px,98vw)', height: 'min(900px,95vh)', background: '#fff', borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,.25)', overflow: 'hidden', position: 'relative' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Add Destinations from CSV/Excel</div>
          <button onClick={() => !busy && onClose?.()} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }} aria-label="Close">×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, display: 'grid', gap: 12 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Required columns: Destination Name, Region, Categories, Description, Tags, Location, Best Time to Visit, Price, Image URL
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              id="import-file-input"
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFile(e.target.files[0]);
              }}
              disabled={busy}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => !busy && document.getElementById('import-file-input').click()}
              disabled={busy}
              style={{
                padding: '8px 18px',
                borderRadius: 8,
                border: '1px solid #10b981',
                background: busy ? '#f3f4f6' : 'linear-gradient(90deg,#10b981,#059669)',
                color: '#fff',
                fontSize: 15,
                fontWeight: 600,
                cursor: busy ? 'not-allowed' : 'pointer',
                outline: 'none',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                transition: 'border 0.2s, box-shadow 0.2s',
                marginRight: 8,
                minWidth: 170,
                maxWidth: 260,
              }}
            >
              Import File
            </button>
            {/* Address bar for imported file path */}
            <input
              type="text"
              value={importedFilePath}
              readOnly
              placeholder="No file selected"
              style={{
                minWidth: 220,
                maxWidth: 400,
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#f9fafb',
                color: '#374151',
                fontSize: 15,
                fontWeight: 500,
                outline: 'none',
                marginRight: 8,
                flex: 1,
                // Remove marginBottom to keep inline
              }}
              tabIndex={-1}
              aria-label="Imported file path"
            />
            {/* Inline Ignore columns dropdown */}
            <div style={{ marginBottom: 0 }}>
              <IgnoreColumnsDropdown
                columns={columnsWithMissingCells} // only columns that actually have missing cells
                ignored={columnsWithMissingCells.filter(label => {
                  const col = IGNORABLE_COLUMNS.find(c => c.label === label);
                  return col && ignoredCols[col.key];
                })}
                disabled={rows.length === 0}
                onToggle={label => {
                  const col = IGNORABLE_COLUMNS.find(c => c.label === label);
                  if (col) {
                    handleIgnoreToggle(col.key, !ignoredCols[col.key]);
                  }
                }}
              />
            </div>
              {/* Progress Bar - upper right, inline */}
              {busy && (
                <div style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  marginRight: 20,
                  marginTop: 110,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: '#f3f4f6',
                  borderRadius: 8,
                  padding: '10px 15px',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#059669',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.04)'
                }}>
                  <span>
                    Importing: {importProgress.imported} / {importProgress.total}
                  </span>
                  <span style={{
                    color: '#b91c1c',
                    fontWeight: 500,
                    marginLeft: 8
                  }}>
                    {importProgress.failed > 0 && `Not imported: ${importProgress.failed}`}
                  </span>
                  <div style={{
                    width: 80,
                    height: 8,
                    background: '#e5e7eb',
                    borderRadius: 4,
                    overflow: 'hidden',
                    marginLeft: 8
                  }}>
                    <div style={{
                      width: `${Math.round((importProgress.imported / importProgress.total) * 100)}%`,
                      height: '100%',
                      background: '#10b981',
                      transition: 'width 0.3s'
                    }} />
                  </div>
                </div>
              )}
          </div>

          <div
            onPaste={handlePaste}
            style={{ padding: 12, border: '1px dashed #cbd5e1', borderRadius: 8, color: '#475569', fontSize: 13, background: '#f8fafc' }}
            title="Click here and paste CSV content (Ctrl/Cmd + V)"
            tabIndex={0}
          >
            Click here and paste CSV content (Ctrl/Cmd + V) or use the file picker above.
          </div>

          {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}

          {missingColumns.length > 0 && (
            <div style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: 12, }}>
              Missing required column(s): {missingColumns.join(', ')}
            </div>
          )}

          {filteredRowIssues.length > 0 && (
            <div style={{ background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa', borderRadius: 8, padding: 12,  }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                {filteredRowIssues.length} row{filteredRowIssues.length > 1 ? 's' : ''} have missing required values:
              </div>
              <div style={{ maxHeight: 180, overflow: 'auto', fontSize: 13 }}>
                {filteredRowIssues.slice(0, 100).map((it, i) => (
                  <div key={i}>Row {it.row}: {it.missing.join(', ')}</div>
                ))}
                {filteredRowIssues.length > 100 && <div>…and {filteredRowIssues.length - 100} more</div>}
              </div>
            </div>
          )}

          {rows.length > 0 && (
              <div
                style={{
                  borderTop: '1px solid #eef2f7',
                  paddingTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  flex: (missingColumns.length === 0 && filteredRowIssues.length === 0) ? 1 : 'unset',
                }}
              >
              <div style={{ marginBottom: 8, fontWeight: 700 }}>
                Preview ({rows.length} row{rows.length > 1 ? 's' : ''})
              </div>
                <div
                  style={{
                    overflow: 'auto',
                    border: '1px solid #eef2f7',
                    borderRadius: 8,
                    minHeight: 0,
                    maxHeight: filteredRowIssues.length > 0 ? 310 : 550, // Set to 310px if missing required values
                    transition: 'max-height 0.35s cubic-bezier(.4,0,.2,1)',
                  }}
                >
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f6f8fa', color: '#6b7280', fontWeight: 700 }}>
                      {headers.map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '8px 10px',
                            textAlign: 'left',
                            position: 'sticky',  // keep header visible while scrolling
                            top: 0,
                            background: '#f6f8fa',
                            zIndex: 1,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 ? '#fff' : '#fafbfc' }}>
                        {headers.map((h) => {
                          const k = toCamelKey(h).toLowerCase();
                          return (
                            <td key={h} style={{ padding: '8px 10px', fontSize: 13 }}>
                              {String(r[k] ?? '')}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>
                Scroll to view all rows.
              </div>
            </div>
          )}

          {alertMsg && (
            <div
                style={{
                  position: 'absolute',
                  top: 24,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: alertType === 'success' ? '#d1fae5' : '#fee2e2',
                  color: alertType === 'success' ? '#065f46' : '#991b1b',
                  border: `1px solid ${alertType === 'success' ? '#10b981' : '#f87171'}`,
                  borderRadius: 8,
                  padding: '10px 24px',
                  fontWeight: 600,
                  zIndex: 9999,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.08)'
                }}
              role="alert"
            >
              {alertMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: 16,
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: '100%',
            background: '#fff',
          }}
        >
          {allExist && (
            <span style={{ color: '#b91c1c', fontWeight: 500, margin: '0 12px 0 0', alignSelf: 'center', fontSize: 15 }}>
              All imported destinations already exist. {existingRowsSummary}
            </span>
          )}
          {/* Debug: show why import is disabled */}
          {disableImport && importedFilePath && (
            <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 8 }}>
              Import is disabled because: {
                busy ? 'Busy importing' :
                rows.length === 0 ? 'No rows loaded' :
                missingColumns.some(label => {
                  const col = IGNORABLE_COLUMNS.find(c => c.label === label);
                  return !(col && ignoredCols[col.key]);
                }) ? 'Missing required columns (not ignored)' :
                filteredRowIssues.length > 0 ? 'Rows have missing required values (not ignored)' :
                (!ignoredCols.name && anyExist) ? (
                  // Show duplicates from both CSV and Firebase (name + location)
                  (() => {
                    // Get imported name/location pairs
                    const importedPairs = rows.map(r => ({
                      name: String(r.name || r.destinationname || r.title || '').trim().toLowerCase(),
                      location: String(r.location || '').trim().toLowerCase()
                    }));
                    // Get existing name/location pairs from Firebase (already fetched in useEffect)
                    // You can reuse existingNameLocation if you store it in state, or refetch here:
                    // For performance, you may want to store existingNameLocation in a useState/useRef.
                    // For this inline check, let's assume you have it as a variable:
                    // existingNameLocation = [{ name, location }, ...]
                    // If not, fallback to showing existingRowsSummary.
                    if (typeof existingNameLocation !== 'undefined') {
                      const duplicates = importedPairs.filter(imported =>
                        existingNameLocation.some(existing =>
                          imported.name === existing.name && imported.location === existing.location
                        )
                      );
                      if (duplicates.length) {
                        return `Some destinations already exist: ${duplicates
                          .map(d => `${d.name} (${d.location})`)
                          .slice(0, 5)
                          .join(', ')}${duplicates.length > 5 ? `, and ${duplicates.length - 5} more` : ''}`;
                      }
                    }
                    // Fallback: show summary from name-only check
                    return existingRowsSummary;
                  })()
                ) :
                allExist ? 'All imported destinations already exist' : ''
              }
            </div>
          )}
          <button className="btn-secondary" onClick={() => !busy && onClose?.()} disabled={busy} style={{ padding: '10px 18px', borderRadius: 10 }}>
            Cancel
          </button>

          <button
            className="btn-primary"
            onClick={importNow}
            disabled={disableImport}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              background: disableImport ? '#9ca3af' : 'linear-gradient(90deg,#10b981,#059669)',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              opacity: busy ? 0.85 : 1,
              cursor: disableImport ? 'not-allowed' : 'pointer'
            }}
          >
            
            {busy ? 'Importing...' : `Import ${rows.length} row${rows.length > 1 ? 's' : ''}`}
          </button>
          
        </div>
      </div>
    </div>
  );
};

// Simple browser info function
function getBrowserInfo() {
  const ua = navigator.userAgent;
  if (/chrome|crios|crmo/i.test(ua) && !/edge|edg|opr|opera/i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome|crios|crmo|android/i.test(ua)) return 'Safari';
  if (/edg/i.test(ua)) return 'Edge';
  if (/opr|opera/i.test(ua)) return 'Opera';
  return 'Other';
}

// Simple OS info function
function getOSInfo() {
  const ua = navigator.userAgent;
  if (/windows nt/i.test(ua)) return 'Windows';
  if (/macintosh|mac os x/i.test(ua)) return 'MacOS';
  if (/android/i.test(ua)) return 'Android';
  if (/linux/i.test(ua)) return 'Linux';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  return 'Other';
}

// Packing suggestion templates
function toLines(arr) {
  return arr.join('\n');
}
const PACKING_SUGGESTIONS_BY_CATEGORY = {
  beach: toLines([
    'Swimwear (multiple sets)',
    'Rash guard / quick-dry shirt',
    'Flip-flops or aqua shoes',
    'Beach towel or sarong',
    'Snorkeling gear (optional if not renting)',
    'Waterproof dry bag (phone, wallet, camera)',
    'Reef-safe sunscreen & after-sun (aloe vera)',
    'Sunglasses & hat/cap',
    'Portable hammock or mat',
    'Light cover-up / beach dress / shorts'
  ]),
  caves: toLines([
    'Headlamp / reliable flashlight (extra batteries)',
    'Helmet (if required / available)',
    'Sturdy non-slip footwear',
    'Gloves for grip (optional)',
    'Quick-dry clothes (avoid cotton)',
    'Small waterproof pouch (valuables)',
    'Insect repellent',
    'Drinking water & light snacks'
  ]),
  cultural: toLines([
    'Modest clothing (long pants/skirt, sleeves)',
    'Light scarf / shawl',
    'Comfortable walking sandals / shoes',
    'Reusable shopping bag',
    'Notebook / pen',
    'Small tokens / gifts (optional)',
    'Camera / phone (extra storage)',
    'Offline translation app'
  ]),
  historical: toLines([
    'Lightweight modest clothing',
    'Comfortable walking shoes',
    'Sun protection (cap / umbrella / sunscreen)',
    'Camera / phone (wide-angle if possible)',
    'Guidebook / printed notes',
    'Reusable water bottle'
  ]),
  islands: toLines([
    'Dry bag (boat rides splashy)',
    'Waterproof phone case',
    'Swimwear & rash guard',
    'Snorkeling gear (or rent on site)',
    'Powerbank',
    'Insect repellent (sandflies / mosquitoes)',
    'Cash (small bills, fees/vendors)',
    'Refillable water bottle'
  ]),
  landmarks: toLines([
    'Comfortable casual wear',
    'Walking shoes / sandals',
    'Hat / cap',
    'Camera / phone',
    'Small umbrella (sudden rain)',
    'Notebook / pen'
  ]),
  mountains: toLines([
    'Trekking shoes / trail sandals',
    'Trekking pole (optional)',
    'Quick-dry clothes + extra layer',
    'Cap / hat & sunglasses',
    'Headlamp (sunrise hikes)',
    'Small backpack (10–20L)',
    'Snacks (trail mix, energy bars)',
    'Drinking water (bottles / bladder)',
    'Raincoat / poncho',
    'First aid kit + blister patches'
  ]),
  museums: toLines([
    'Smart casual clothing',
    'Lightweight jacket (strong AC)',
    'Notebook / sketchpad + pen',
    'Smartphone / camera (if allowed)',
    'ID card (entry requirement sometimes)',
    'Reusable water bottle (may stay outside)'
  ]),
  parks: toLines([
    'Sturdy shoes (trek/hike trails)',
    'Hat, sunglasses, sunscreen',
    'Insect repellent',
    'Light raincoat / poncho',
    'Binoculars (birdwatching)',
    'Refillable water bottle & snacks',
    'Camera with zoom lens',
    'Picnic mat',
    'Trash bags (Leave No Trace)'
  ]),
  tourist: toLines([
    'Casual breathable clothing',
    'Comfortable walking shoes',
    'Small backpack / daypack',
    'Sunglasses, hat, sunscreen',
    'Reusable water bottle',
    'Portable fan / handkerchief',
    'Powerbank & cables',
    'Local SIM / pocket WiFi',
    'Copies of ID & travel documents',
    'Cash (small bills) + ATM/credit card'
  ])
};

export default AddFromCsvCMS;

function cleanFirestoreDoc(obj) {
  if (Array.isArray(obj)) {
    return obj.map(cleanFirestoreDoc);
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    Object.entries(obj).forEach(([k, v]) => {
      if (v !== undefined) {
        out[k] = cleanFirestoreDoc(v);
      }
    });
    return out;
  }
  return obj;
}
