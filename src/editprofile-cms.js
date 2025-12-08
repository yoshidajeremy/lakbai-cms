import React, { useEffect, useMemo, useState, useRef } from 'react';
import { getFirestore, collection, query, where, getCountFromServer, getDocs, doc, getDoc, collectionGroup, orderBy, limit, addDoc, setDoc } from 'firebase/firestore'
import { listenUserStats } from './user-stats-cms';
import './Styles/contentManager.css';

// Cloudinary (unsigned) – same keys used elsewhere in the app
const CLOUDINARY_UPLOAD_PRESET = process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET || 'lakbai_preset';
const CLOUDINARY_CLOUD_NAME = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME || 'dxvewejox';

async function uploadToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const body = new FormData();
  body.append('file', file);
  body.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(url, { method: 'POST', body });
  if (!res.ok) throw new Error('Upload failed');
  const json = await res.json();
  return json.secure_url || json.url;
}

// Resolve provider from Firebase-like user object
const resolveAuthProvider = (u) => {
  // Firebase Auth: providerData[].providerId or providerId like 'google.com'
  const fromArray = Array.isArray(u?.providerData) && u.providerData.find(Boolean)?.providerId;
  const raw = String(fromArray || u?.providerId || u?.authProvider || u?.provider || '').toLowerCase();
  if (raw.includes('google')) return 'Google';
  if (raw.includes('facebook')) return 'Facebook';
  if (raw.includes('apple')) return 'Apple';
  if (raw.includes('password') || raw.includes('email')) return 'Email';
  return 'Email';
};

// Map stored status -> UI label and back (keeps legacy values working)
const toUiStatus = (stored) => {
  const s = String(stored || '').toLowerCase();
  if (s === 'disabled' || s === 'inactive') return 'inactive';
  if (s === 'banned' || s === 'suspended') return 'suspended';
  return 'active';
};
const toStoredStatus = (ui) => {
  const s = String(ui || '').toLowerCase();
  if (s === 'inactive') return 'disabled';   // keep existing CMS filters working
  if (s === 'suspended') return 'banned';
  return 'active';
};

const SmallTagInput = ({ value = [], onChange, placeholder }) => {
    const [val, setVal] = useState(''); const add = (t) => {
        const v = String(t || '').trim();
        if (!v) return;
        if (!value.includes(v)) onChange([...(value || []), v]);
        setVal('');
    };
    return (
        <div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {(value || []).map((t, i) => (
            <span key={i} style={{
                background: '#e0f2fe', color: '#2563eb', fontWeight: 600, fontSize: 13,
                padding: '4px 10px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6
            }}>
                {t}
                <button type="button" onClick={() => onChange((value || []).filter((_, idx) => idx !== i))}
                style={{ background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 700 }}>×</button>
            </span>
            ))}
        </div>
        <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault(); add(val);
            }
            }}
            onBlur={() => val && add(val)}
            className="form-input"
            placeholder={placeholder}
            style={{ width: '100%' }}
        />
        </div>
    );
};

// Add a read-only chips renderer
const InterestsChips = ({ items = [], emptyText = 'No interests set' }) => (
  <div>
    {(!items || items.length === 0) ? (
      <div className="muted small" style={{ padding: 10, border: '1px dashed #e5e7eb', borderRadius: 8, background: '#fafafa' }}>
        {emptyText}
      </div>
    ) : (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {items.map((t, i) => (
          <span key={`${t}-${i}`} style={{
            background: '#e0f2fe',
            color: '#2563eb',
            fontWeight: 600,
            fontSize: 13,
            padding: '6px 12px',
            borderRadius: 9999,
            display: 'inline-flex',
            alignItems: 'center'
          }}>
            {t}
          </span>
        ))}
      </div>
    )}
  </div>
);

const rowBox = {
    display: 'grid',
    gridTemplateColumns: '40px 1.2fr 1.2fr 1fr 110px',
    gap: 12,
    alignItems: 'center',
    background: '#f8fafc',
    borderRadius: 8,
    padding: '10px 12px'
};

const IconPicker = ({ value, onChange }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="form-input" style={{ width: 40, padding: 4 }}>
        {['🌐','🖼️','⭐','🏆','📸','✍️','📍','👥'].map((i) => <option key={i} value={i}>{i}</option>)}
    </select>
);

// Static emoji resolver for achievements (fallback to 🏆 if unmatched)
function getAchievementEmoji(a = {}) {
  const title = String(a.title || '').trim();
  const match = Object.values(ACHIEVEMENTS_CATALOG).find((m) => m.title === title);
  return a.icon || match?.icon || '🏆';
}

// Replace normalizeInterests with a more robust version (add likes sources)
const normalizeInterests = (src) => {
  const seen = new Set();
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  };
  const from = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      v.forEach((item) => {
        if (typeof item === 'string') push(item);
        else if (item && typeof item === 'object')
          push(item.name ?? item.label ?? item.title ?? item.value ?? item.tag ?? item.interest ?? item.like ?? '');
      });
      return;
    }
    if (typeof v === 'string') { v.split(',').forEach(push); return; }
    if (typeof v === 'object') {
      Object.entries(v).forEach(([k, val]) => {
        if (val === true || (typeof val === 'number' && val > 0)) push(k);
      });
    }
  };

  const candidates = [
    src?.interests,
    src?.travelInterests,
    src?.tags,
    src?.likes,                 // <-- added
    src?.interestTags,
    src?.interestList,
    src?.interest_list,
    src?.profile?.interests,
    src?.profile?.tags,
    src?.profile?.likes,        // <-- added
    src?.profile?.travelInterests,
    src?.preferences?.interests,
    src?.preferences?.likes     // <-- added
  ];
  candidates.forEach(from);
  return out;
};

// Try multiple collection/field combos until one returns a count
async function tryCounts(db, attempts) {
  for (const a of attempts) {
    try {
      const base = collection(db, a.coll);
      const cond = a.arrayContains
        ? where(a.field, 'array-contains', a.value)
        : where(a.field, '==', a.value);
      const q = query(base, cond);
      try {
        const snap = await getCountFromServer(q);
        const c = snap.data()?.count;
        if (typeof c === 'number') return c;
      } catch {
        const snap = await getDocs(q);
        return snap.size;
      }
    } catch {
      // ignore and try next attempt
    }
  }
  return null;
}

// NEW: try counting docs in user subcollections (users/{uid}/subcoll)
async function trySubcollectionCounts(db, paths) {
  for (const path of paths) {
    try {
      const snap = await getDocs(collection(db, path));
      return snap.size;
    } catch {
      // ignore and try next path
    }
  }
  return null;
}

// Load stats from Firebase (uses user.stats as baseline if counts unavailable)
async function loadUserStatsFromFirebase(userObj) {
  if (!userObj) return null;
  const uid = userObj.id || userObj.uid;

  const db = getFirestore();

  // Top-level attempts
  const placesTop = await tryCounts(db, [
    { coll: 'visits', field: 'userId', value: uid },
    { coll: 'visits', field: 'uid', value: uid },
    { coll: 'checkins', field: 'userId', value: uid },
    { coll: 'travel_logs', field: 'userId', value: uid },
    { coll: 'visitedPlaces', field: 'userId', value: uid },
  ]);
  const photosTop = await tryCounts(db, [
    { coll: 'photos', field: 'userId', value: uid },
    { coll: 'photos', field: 'ownerId', value: uid },
    { coll: 'userPhotos', field: 'userId', value: uid },
    { coll: 'media', field: 'userId', value: uid },
    { coll: 'uploads', field: 'userId', value: uid },
  ]);
  const reviewsTop = await tryCounts(db, [
    { coll: 'reviews', field: 'userId', value: uid },
    { coll: 'reviews', field: 'authorId', value: uid },
    { coll: 'userReviews', field: 'userId', value: uid },
    { coll: 'destinationReviews', field: 'userId', value: uid },
  ]);
  const friendsTop = await tryCounts(db, [
    { coll: 'friends', field: 'userId', value: uid },
    { coll: 'friendships', field: 'userId', value: uid },
    { coll: 'connections', field: 'userId', value: uid },
    { coll: 'friendships', field: 'members', value: uid, arrayContains: true },
    { coll: 'connections', field: 'members', value: uid, arrayContains: true },
  ]);

  // Subcollection fallbacks (users/{uid}/...)
  const placesSub = await trySubcollectionCounts(db, [
    `users/${uid}/visits`,
    `users/${uid}/checkins`,
    `users/${uid}/visited`,
    `users/${uid}/visitedPlaces`,
    `users/${uid}/travel_logs`,
  ]);
  const photosSub = await trySubcollectionCounts(db, [
    `users/${uid}/photos`,
    `users/${uid}/media`,
    `users/${uid}/uploads`,
  ]);
  const reviewsSub = await trySubcollectionCounts(db, [
    `users/${uid}/reviews`,
    `users/${uid}/destinationReviews`,
  ]);
  const friendsSub = await trySubcollectionCounts(db, [
    `users/${uid}/friends`,
    `users/${uid}/friendships`,
    `users/${uid}/connections`,
  ]);

  // NEW: fallback to array length on the user doc
  const placesArrayLen = Array.isArray(userObj?.places) ? userObj.places.length : null;

  const places  = placesTop  ?? placesSub  ?? placesArrayLen ?? (userObj?.stats?.places  ?? userObj?.placesCount  ?? 0);
  const photos  = photosTop  ?? photosSub  ?? (userObj?.stats?.photos  ?? userObj?.photosCount ?? 0);
  const reviews = reviewsTop ?? reviewsSub ?? (userObj?.stats?.reviews ?? userObj?.reviewsCount ?? 0);
  const friends = friendsTop ?? friendsSub ?? (userObj?.stats?.friends ?? userObj?.friendsCount ?? 0);

  return { places, photos, reviews, friends };
}

// Fetch interests from Firebase across common locations (now includes likes)
async function loadUserInterestsFromFirebase(userObj) {
  if (!userObj) return null;
  const uid = userObj.id || userObj.uid;
  if (!uid) return null;

  const db = getFirestore();
  const set = new Set();
  const addAll = (listish) => {
    if (listish == null) return;
    const items = normalizeInterests({ interests: listish });
    for (const s of items) set.add(s);
  };

  // 1) Primary users/{uid} doc
  try {
    const ds = await getDoc(doc(db, 'users', uid));
    if (ds.exists()) {
      const data = ds.data() || {};
      addAll(data.travelInterests);
      addAll(data.interests);
      addAll(data.tags);
      addAll(data.likes);                 // <-- added
      addAll(data.profile?.interests);
      addAll(data.profile?.tags);
      addAll(data.profile?.likes);        // <-- added
      addAll(data.profile?.travelInterests);
      if (data.preferences?.interests && typeof data.preferences.interests === 'object') {
        addAll(data.preferences.interests);
      }
      if (data.preferences?.likes && typeof data.preferences.likes === 'object') {
        addAll(data.preferences.likes);   // <-- added
      }
    }
  } catch {}

  // 2) Alternate profile docs
  for (const collName of ['profiles', 'userProfiles', 'user_profile']) {
    try {
      const ds = await getDoc(doc(db, collName, uid));
      if (ds.exists()) addAll(ds.data());
    } catch {}
  }

  // 3) Subcollections under users/{uid}
  for (const sub of ['interests', 'tags', 'likes']) { // <-- include likes subcollection
    try {
      const snap = await getDocs(collection(db, `users/${uid}/${sub}`));
      snap.forEach((d) => {
        const v = d.data() || {};
        const name = v.name || v.label || v.value || v.title || v.tag || v.interest || v.like || d.id; // <-- include v.like
        if (name) set.add(String(name).trim());
      });
    } catch {}
  }

  // 4) Top-level mapping collections
  for (const attempt of [
    { coll: 'userInterests', field: 'userId' },
    { coll: 'userInterests', field: 'uid' },
    { coll: 'likes', field: 'userId' },   // <-- added
    { coll: 'likes', field: 'uid' },      // <-- added
    { coll: 'userLikes', field: 'userId' }, // <-- added
    { coll: 'userLikes', field: 'uid' },    // <-- added
  ]) {
    try {
      const q = query(collection(db, attempt.coll), where(attempt.field, '==', uid));
      const snap = await getDocs(q);
      snap.forEach((d) => {
        const v = d.data() || {};
        const name = v.name || v.label || v.value || v.title || v.tag || v.interest || v.like; // <-- include v.like
        if (name) set.add(String(name).trim());
      });
    } catch {}
  }

  return Array.from(set);
}

// Helper date parsing/formatting for activity rows
function toDateSafe(v) {
  try {
    if (!v) return null;
    if (typeof v?.toDate === 'function') return v.toDate();
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  } catch {}
  return null;
}
function fmtDMY(v) {
  const d = toDateSafe(v) || new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Helper: check if a Firestore doc belongs to a specific user
function belongsToUser(uid, d) {
  const U = String(uid || '');
  const vals = [
    d?.userId, d?.userID, d?.uid, d?.ownerId, d?.authorId, d?.createdBy,
    d?.user?.id, d?.user?.uid, d?.owner?.id, d?.author?.id,
  ].map((v) => (v == null ? '' : String(v)));
  if (vals.includes(U)) return true;
  if (Array.isArray(d?.members) && d.members.map(String).includes(U)) return true;
  return false;
}

// Robust UID resolver (handles id, uid, userId, nested shapes)
function getUserIdFrom(obj) {
  return (
    obj?.uid ||
    obj?.id ||
    obj?.userId ||
    obj?.userID ||
    obj?.auth?.uid ||
    obj?.auth?.userId ||
    obj?.profile?.uid ||
    obj?.profile?.id ||
    ''
  );
}

// Build activity list from photos, comments, and activities (subcollections only)
async function loadUserRecentActivityFromFirebase(userObj, maxItems = 20) {
  if (!userObj) return [];
  const uid = getUserIdFrom(userObj);
  if (!uid) return [];

  const db = getFirestore();
  const items = [];
  const seen = new Set();
  const push = (type, text, when, refPath) => {
    if (!refPath || seen.has(refPath)) return;
    seen.add(refPath);
    items.push({ type, text, date: toDateSafe(when) || new Date(0) });
  };

  try {
    // Query subcollections using collectionGroup; support both userId and userID
    const [
      photosA, photosB,
      commentsA, commentsB,
      activitiesA, activitiesB
    ] = await Promise.all([
      getDocs(query(collectionGroup(db, 'photos'), where('userId', '==', uid))),
      getDocs(query(collectionGroup(db, 'photos'), where('userID', '==', uid))),
      getDocs(query(collectionGroup(db, 'comments'), where('userId', '==', uid))),
      getDocs(query(collectionGroup(db, 'comments'), where('userID', '==', uid))),
      getDocs(query(collectionGroup(db, 'activities'), where('userId', '==', uid))),
      getDocs(query(collectionGroup(db, 'activities'), where('userID', '==', uid))),
    ]);

    const handlePhotos = (snap) => snap.forEach((docSnap) => {
      const d = docSnap.data() || {};
      if (!belongsToUser(uid, d)) return;
      const when = d.timestamp || d.createdAt || d.created_at || d.date;
      const text = d.caption || d.title || d.description || 'You have uploaded a photo.';
      push('Photo', text, when, docSnap.ref.path);
    });
    const handleComments = (snap) => snap.forEach((docSnap) => {
      const d = docSnap.data() || {};
      if (!belongsToUser(uid, d)) return;
      const when = d.createdAt || d.timestamp || d.created_at || d.date;
      const body = d.text || d.body || d.comment || d.message || 'Left a comment';
      push('Review', String(body).slice(0, 120), when, docSnap.ref.path);
    });
    const handleActivities = (snap) => snap.forEach((docSnap) => {
      const d = docSnap.data() || {};
      if (!belongsToUser(uid, d)) return;
      const when = d.timestamp || d.createdAt || d.created_at || d.date;
      const t = String(d.type || d.activityType || '').toLowerCase();
      let type = 'Activity';
      if (t.includes('visit') || t.includes('check')) type = 'Visit';
      else if (t.includes('friend') || t.includes('connect')) type = 'Friend';
      else if (t.includes('photo') || t.includes('upload')) type = 'Photo';
      else if (t.includes('review') || t.includes('comment')) type = 'Review';
      const text = d.text || d.title || d.message || d.description || (type === 'Visit' ? 'Visited a place' : 'New activity');
      push(type, text, when, docSnap.ref.path);
    });

    handlePhotos(photosA); handlePhotos(photosB);
    handleComments(commentsA); handleComments(commentsB);
    handleActivities(activitiesA); handleActivities(activitiesB);
  } catch (e) {
    console.warn('Recent activity (collectionGroup) failed, using fallback:', e?.message);

    // Fallback: top-level collections (keeps previous behavior if indexes/permissions block CG queries)
    for (const attempt of [
      { coll: 'photos', fields: ['userId','userID'] },
      { coll: 'comments', fields: ['userId','userID'] },
      { coll: 'activities', fields: ['userId','userID'] },
    ]) {
      for (const field of attempt.fields) {
        try {
          const snap = await getDocs(query(collection(db, attempt.coll), where(field, '==', uid)));
          snap.forEach((docSnap) => {
            const d = docSnap.data() || {};
            if (!belongsToUser(uid, d)) return;
            const refPath = docSnap.ref.path;
            if (seen.has(refPath)) return;

            if (attempt.coll === 'photos') {
              const when = d.timestamp || d.createdAt || d.created_at || d.date;
              const text = d.caption || d.title || d.description || 'You have uploaded a photo.';
              push('Photo', text, when, refPath);
            } else if (attempt.coll === 'comments') {
              const when = d.createdAt || d.timestamp || d.created_at || d.date;
              const body = d.text || d.body || d.comment || d.message || 'Left a comment';
              push('Review', String(body).slice(0, 120), when, refPath);
            } else {
              const when = d.timestamp || d.createdAt || d.created_at || d.date;
              const t = String(d.type || d.activityType || '').toLowerCase();
              let type = 'Activity';
              if (t.includes('visit') || t.includes('check')) type = 'Visit';
              else if (t.includes('friend') || t.includes('connect')) type = 'Friend';
              else if (t.includes('photo') || t.includes('upload')) type = 'Photo';
              else if (t.includes('review') || t.includes('comment')) type = 'Review';
              const text = d.text || d.title || d.message || d.description || (type === 'Visit' ? 'Visited a place' : 'New activity');
              push(type, text, when, refPath);
            }
          });
        } catch {}
      }
    }
  }

  // Newest first, then map to UI format
  items.sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0));
  return items.slice(0, maxItems).map((it) => ({
    type: it.type,
    text: it.text,
    date: fmtDMY(it.date),
  }));
}

// Fetch bio from users/{uid}.bio (with gentle fallbacks)
async function loadUserBioFromFirebase(userObj) {
  if (!userObj) return null;
  const uid = userObj.id || userObj.uid;
  if (!uid) return null;

  const db = getFirestore();
  try {
    const ds = await getDoc(doc(db, 'users', uid));
    if (ds.exists()) {
      const data = ds.data() || {};
      // Prefer top-level users/{uid}.bio, then fallback to profile.bio
      const bio = (data.bio ?? data.profile?.bio ?? '');
      return typeof bio === 'string' ? bio : String(bio || '');
    }
  } catch {}
  return null;
}
async function saveUserBioToFirebase(userObj, bio) {
  try {
    const uid = userObj?.id || userObj?.uid;
    if (!uid) return;
    const db = getFirestore();
    await setDoc(
      doc(db, 'users', uid),
      { bio: typeof bio === 'string' ? bio : String(bio || '') },
      { merge: true }
    );
  } catch (e) {
    console.warn('Failed to save bio to Firestore:', e?.message);
  }
}

// Fetch traveler name from users/{uid}.displayName (with gentle fallbacks)
async function loadTravelerNameFromFirebase(userObj) {
  if (!userObj) return null;
  const uid = userObj.id || userObj.uid;
  if (!uid) return null;

  const db = getFirestore();
  try {
    const ds = await getDoc(doc(db, 'users', uid));
    if (ds.exists()) {
      const data = ds.data() || {};
      const name =
        data.travelerName ??
        '';
      return typeof name === 'string' ? name : String(name || '');
    }
  } catch {}
  return null;
}

// Catalog: id -> title/description/icon
const ACHIEVEMENTS_CATALOG = {
  '1': { icon: '📍', title: 'First Step',        desc: 'Create your very first itinerary.' },
  '2': { icon: '⭐', title: 'First Bookmark',    desc: 'Save your first place to your favorites.' },
  '3': { icon: '📸', title: 'Say Cheese!',       desc: 'Upload your first travel photo.' },
  '4': { icon: '✍️', title: 'Hello, World!',     desc: 'Post your first comment on any itinerary or location.' },
  '5': { icon: '👥', title: 'Profile Pioneer',   desc: 'Complete your profile with a photo and bio.' },
  '6': { icon: '🌐', title: 'Mini Planner',      desc: 'Add at least 3 places to a single itinerary.' },
  '7': { icon: '🌐', title: 'Explorer at Heart', desc: 'View 10 different destinations in the app.' },
  '8': { icon: '🏆', title: 'Checklist Champ',   desc: 'Mark your first place as "visited".' },
};

// Build UI item from id + source fields
function achievementItemFrom(id, data = {}) {
  const meta = ACHIEVEMENTS_CATALOG[String(id)];
  if (!meta) return null;
  const when = data.unlockedAt || data.timestamp || data.createdAt || data.date || data.time;
  const date = when ? fmtDMY(when) : '';
  return { icon: meta.icon, title: meta.title, desc: meta.desc, date };
}

// Load unlocked achievements for a user (boolean map / subcollection / mapping)
async function loadUserAchievementsFromFirebase(userObj) {
  if (!userObj) return [];
  const uid = getUserIdFrom(userObj);
  if (!uid) return [];

  const db = getFirestore();
  const added = new Set();
  const out = [];
  const addById = (id, data) => {
    const k = String(id);
    if (!ACHIEVEMENTS_CATALOG[k] || added.has(k)) return;
    const item = achievementItemFrom(k, data);
    if (item) { out.push(item); added.add(k); }
  };

  // 1) users/{uid} document fields
  try {
    const ds = await getDoc(doc(db, 'users', uid));
    if (ds.exists()) {
      const data = ds.data() || {};
      for (const src of [data.achievements, data.profile?.achievements, data.badges, data.profile?.badges]) {
        if (src && typeof src === 'object') {
          Object.entries(src).forEach(([id, v]) => {
            const unlocked = v === true || v === 'true' || v === 1 || v?.unlocked === true || v?.achieved === true || v?.value === true;
            if (unlocked) addById(id, typeof v === 'object' ? v : {});
          });
        }
      }
    }
  } catch {}

  // 2) users/{uid}/achievements subcollection (doc id = number)
  try {
    const snap = await getDocs(collection(db, `users/${uid}/achievements`));
    snap.forEach((d) => {
      const data = d.data() || {};
      const unlocked = data?.unlocked === true || data?.achieved === true || data?.value === true || Object.keys(data).length === 0;
      if (unlocked) addById(d.id, data);
    });
  } catch {}

  // 3) top-level mapping collections
  for (const attempt of [
    { coll: 'userAchievements', userField: 'userId', achField: 'achievementId' },
    { coll: 'userAchievements', userField: 'uid',    achField: 'achievementId' },
    { coll: 'achievements',     userField: 'userId', achField: 'id' },
  ]) {
    try {
      const q = query(collection(db, attempt.coll), where(attempt.userField, '==', uid));
      const snap = await getDocs(q);
      snap.forEach((d) => {
        const data = d.data() || {};
        const id = data[attempt.achField] ?? d.id;
        const unlocked = data?.unlocked === true || data?.achieved === true || data?.value === true || !('unlocked' in data || 'achieved' in data || 'value' in data);
        if (unlocked) addById(id, data);
      });
    } catch {}
  }

  // Order by id number
  out.sort((a, b) => {
    const ai = Object.entries(ACHIEVEMENTS_CATALOG).find(([_, m]) => m.title === a.title)?.[0] ?? '999';
    const bi = Object.entries(ACHIEVEMENTS_CATALOG).find(([_, m]) => m.title === b.title)?.[0] ?? '999';
    return Number(ai) - Number(bi);
  });

  return out;
}

// Helper to get device/browser info
function getDeviceInfo() {
  let device = "Unknown";
  let browser = "Unknown";
  let os = "Unknown";
  let userAgent = navigator.userAgent || "";

  // Device
  if (/Mobi|Android/i.test(userAgent)) device = "Mobile";
  else if (/Tablet|iPad/i.test(userAgent)) device = "Tablet";
  else device = "Desktop";

  // Browser
  if (/chrome|crios|crmo/i.test(userAgent)) browser = "Chrome";
  else if (/firefox|fxios/i.test(userAgent)) browser = "Firefox";
  else if (/safari/i.test(userAgent) && !/chrome|crios|crmo/i.test(userAgent)) browser = "Safari";
  else if (/edg/i.test(userAgent)) browser = "Edge";
  else if (/opr\//i.test(userAgent)) browser = "Opera";
  else if (/msie|trident/i.test(userAgent)) browser = "IE";

  // OS
  if (/windows nt/i.test(userAgent)) os = "Windows";
  else if (/android/i.test(userAgent)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(userAgent)) os = "iOS";
  else if (/macintosh|mac os x/i.test(userAgent)) os = "MacOS";
  else if (/linux/i.test(userAgent)) os = "Linux";

  return { device, browser, os, userAgent };
}

// Helper to generate a session ID
function generateSessionId() {
  return (
    "sess_" +
    Math.random().toString(36).substr(2, 9) +
    "_" +
    Date.now().toString(36)
  );
}

export default function EditProfileCMS({
  open = false,
  user,
  initialTab = 'basic',
  onClose,
  onSave
}) {
  const providerLabel = useMemo(() => resolveAuthProvider(user), [user]);
  const uid = user?.id || user?.uid || user?.userId || null;

  // Only expose these tabs (Travel removed)
  const TABS = ['basic', 'profile', 'settings'];

  const seeded = useMemo(() => ({
    email: user?.email || '',
    password: '••••••••',
    provider: providerLabel,
    travelerName: user?.travelerName || user?.name || '',
    photoURL: user?.photoURL || user?.avatar || user?.avatarUrl || user?.profilePhoto || '',
    bio: user?.bio || '',
    status: toUiStatus(user?.status || 'active'),
    stats: {
      places: user?.stats?.places ?? user?.placesCount ?? 0,
      photos: user?.stats?.photos ?? user?.photosCount ?? 0,
      reviews: user?.stats?.reviews ?? user?.reviewsCount ?? 0,
      friends: user?.stats?.friends ?? user?.friendsCount ?? 0,
      // Add these for direct Firebase stats
      placesOnTrips: 0,
      photosShared: 0,
      ratedDestinations: 0,
    },
    interests: normalizeInterests(user || {}),
  }), [user, providerLabel]);

  const [tab, setTab] = useState(initialTab || 'basic');
  const [form, setForm] = useState(seeded);
  const [uploading, setUploading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const fileRef = useRef(null);

  // NEW: loading flags
  const [achievementsLoading, setAchievementsLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);

  // Store initial values for audit logging
  const initialValuesRef = useRef({
    travelerName: user?.travelerName || user?.name || '',
    photoURL: user?.photoURL || user?.avatar || user?.avatarUrl || user?.profilePhoto || '',
    bio: user?.bio || '',
  });

  // Keep initial values in sync when user changes
  useEffect(() => {
    initialValuesRef.current = {
      travelerName: user?.travelerName || user?.name || '',
      photoURL: user?.photoURL || user?.avatar || user?.avatarUrl || user?.profilePhoto || '',
      bio: user?.bio || '',
    };
  }, [user]);

  useEffect(() => { 
    setTab(TABS.includes(initialTab) ? initialTab : 'basic'); 
  }, [initialTab]);
  useEffect(() => { setForm(seeded); }, [seeded]);

  // Fetch Travel Statistics directly from Firebase
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!open || !user) return;
      setStatsLoading(true);
      try {
        const db = getFirestore();
        // Places on Trips
        let placesOnTrips = 0;
        try {
          const tripsSnap = await getDocs(collection(db, 'users', uid, 'trips'));
          placesOnTrips = tripsSnap.size;
        } catch {}
        // Photos Shared (sum of photos subcollection and stats.photosShared field)
        let photosShared = 0;
        try {
          const photosSnap = await getDocs(collection(db, 'users', uid, 'photos'));
          photosShared = photosSnap.size;
        } catch {}
        const userDoc = await getDoc(doc(db, 'users', uid));
        const stats = userDoc.exists() ? userDoc.data().stats || {} : {};
        if (typeof stats.photosShared === 'number') {
          photosShared += stats.photosShared;
        }
        // Rated Destinations
        let ratedDestinations = 0;
        try {
          const ratingsSnap = await getDocs(collection(db, 'users', uid, 'ratings'));
          ratedDestinations = ratingsSnap.size;
        } catch {}
        if (alive) {
          setForm((f) => ({
            ...f,
            stats: {
              ...f.stats,
              placesOnTrips,
              photosShared,
              ratedDestinations,
            }
          }));
        }
      } catch (e) {
        console.warn('Failed to load travel statistics:', e?.message);
      } finally {
        if (alive) setStatsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, user, uid]);

  // Load Travel Interests from Firebase when modal opens or user changes
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!open || !user) return;
      try {
        const interests = await loadUserInterestsFromFirebase(user);
        if (alive && interests && Array.isArray(interests)) {
          setForm((f) => ({ ...f, interests }));
        }
      } catch (e) {
        console.warn('Failed to load user interests:', e?.message);
      }
    })();
    return () => { alive = false; };
  }, [open, user]);

  // NEW: Load Recent Activity from photos, comments, activities
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!open || !user) return;
      try {
        setActivityLoading(true);
        const recents = await loadUserRecentActivityFromFirebase(user, 20);
        if (alive && recents?.length) {
          setForm((f) => ({ ...f, activity: recents }));
        }
      } catch (e) {
        console.warn('Failed to load user recent activity:', e?.message);
      } finally {
        if (alive) setActivityLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, user]);

  // Load Achievements from Firebase (unlocked only)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!open || !user) return;
      try {
        setAchievementsLoading(true);
        const unlocked = await loadUserAchievementsFromFirebase(user);
        if (alive && unlocked?.length) {
          setForm((f) => ({ ...f, achievements: unlocked }));
        }
      } catch (e) {
        console.warn('Failed to load achievements:', e?.message);
      } finally {
        if (alive) setAchievementsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, user]);

  // Load Traveler Bio from Firebase when modal opens or user changes
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!open || !user) return;
      try {
        const bio = await loadUserBioFromFirebase(user);
        if (alive && typeof bio === 'string' && bio.length) {
          setForm((f) => ({ ...f, bio: bio }));
        }
      } catch (e) {
        console.warn('Failed to load user bio:', e?.message);
      }
    })();
    return () => { alive = false; };
  }, [open, user]);

  // Load Traveler Name (displayName) from Firebase when modal opens or user changes
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!open || !user) return;
      try {
        const name = await loadTravelerNameFromFirebase(user);
        if (alive && typeof name === 'string' && name.length) {
          setForm((f) => ({ ...f, travelerName: name }));
        }
      } catch (e) {
        console.warn('Failed to load traveler name:', e?.message);
      }
    })();
    return () => { alive = false; };
  }, [open, user]);

  // NEW: Sync travel stats in real-time (listen for changes)
  useEffect(() => {
    let unsubscribe;
    if (open && user?.uid) {
      unsubscribe = listenUserStats(user.uid, (stats) => {
        setForm((f) => ({
          ...f,
          stats: {
            ...f.stats,
            placesOnTrips: stats.placesOnTrips,
            photosShared: stats.photosShared,
            ratedDestinations: stats.ratedDestinations,
            friends: stats.friends,
          }
        }));
      });
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [open, user?.uid]);

  if (!open || !user) return null;

  const save = async () => {
    const payload = {
      email: form.email,
      travelerName: form.travelerName,
      provider: form.provider,
      photoURL: form.photoURL || '',
      bio: form.bio || '',
      status: toStoredStatus(form.status),
      stats: { ...form.stats },
      interests: form.interests,
    };

    // Only send password if admin typed a new one
    const pwd = String(form.password || '');
    if (pwd && pwd !== '••••••••') {
      payload.password = pwd;
    }

    // --- AUDIT LOGGING ---
    const db = getFirestore();
    const changes = {};
    const oldVals = {};
    const newVals = {};

    ["travelerName", "photoURL", "bio"].forEach((field) => {
      if (payload[field] !== initialValuesRef.current[field]) {
        changes[field] = true;
        oldVals[field] = initialValuesRef.current[field];
        newVals[field] = payload[field];
      }
    });

    if (Object.keys(changes).length > 0) {
      const deviceInfo = getDeviceInfo();
      const sessionId = generateSessionId();

      // Ensure no undefined is sent to Firestore
      const safeOld = sanitizeForFirestore(oldVals);
      const safeNew = sanitizeForFirestore(newVals);

      await addDoc(collection(db, "auditLogs"), {
        timestamp: Date.now(),
        userName: user?.travelerName || user?.name || "",
        userEmail: user?.email || "",
        userId: user?.uid || user?.id || "",
        role: user?.role || "user",
        action: "user update",
        category: "user management",
        outcome: "SUCCESS",
        details: "Updated user profile",
        provider: user?.provider || "",
        device: deviceInfo.device,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        userAgent: deviceInfo.userAgent,
        ipAddress: "",
        location: "",
        session: sessionId,
        dataChanges: {
          old: safeOld,
          new: safeNew,
        },
      });
    }

    // Write bio to users/{uid}.bio if changed
    if (payload.bio !== initialValuesRef.current.bio) {
      await saveUserBioToFirebase(user, payload.bio);
    }

    onSave?.(payload);
  };
  const avatarInitial = (form.travelerName || form.email || 'U').trim().charAt(0).toUpperCase();

    const card = (title, children, style = {}) => (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.04)', padding: 18, ...style }}>
            <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 16 }}>{title}</div>
            {children}
        </div>
    );

    return (
        <div role="dialog" aria-modal="true"
            onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div
              style={{
                width: 'min(980px,96vw)',
                background: '#fff',
                borderRadius: 16,
                boxShadow: '0 20px 60px rgba(0,0,0,.25)',
                // make the modal fit viewport and allow internal scroll
                maxHeight: '92vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
            {/* Tabs header */}
            <div style={{ display: 'flex', gap: 14, padding: '10px 16px', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
                {TABS.map((t) => (
                <button key={t} onClick={() => setTab(t)} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: '10px 8px',
                    color: tab === t ? '#2563eb' : '#6b7280', fontWeight: 600,
                    borderBottom: tab === t ? '3px solid #2563eb' : '3px solid transparent'
                }}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
                ))}
                <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>

            {/* Body */}
            <div
              style={{
                padding: 18,
                background: '#f8fafc',
                flex: 1,
                overflowY: 'auto'
              }}
            >
            {tab === 'basic' && (
              <>
                <div style={{ display: 'grid', gap: 16 }}>
                  {/* Personal Information */}
                  {card('Personal Information',  (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Email Address</div>
                        <input className="form-input-dest" value={form.email}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                      </div>

                      {/* Sign-in Provider (read-only, from Firebase) */}
                      <div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Sign-in Provider</div>
                        <input
                          className="form-input-dest"
                          value={providerLabel}
                          disabled
                          style={{ background: '#f9fafb', color: '#111827', fontWeight: 500 }}
                          aria-readonly="true"
                        />
                      </div>

                      <div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Traveler Name</div>
                        <input className="form-input-dest" value={form.travelerName}
                          onChange={(e) => setForm((f) => ({ ...f, travelerName: e.target.value }))} />
                      </div>
                    </div>
                  ))}

                  {/* Travel Statistics */}
                  {card('Travel Statistics', (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                      {/* Places on Trips */}
                      <div>
                        <div className="muted small" style={{ marginBottom: 6 }}>Places on Trips</div>
                        <input className="form-input" min={0}
                          value={form.stats.placesOnTrips}
                          onChange={(e) => setForm((f) => ({ ...f, stats: { ...f.stats, placesOnTrips: Number(e.target.value || 0) } }))}
                        />
                      </div>
                      {/* Photos Shared */}
                      <div>
                        <div className="muted small" style={{ marginBottom: 6 }}>Photos Shared</div>
                        <input className="form-input" min={0}
                          value={form.stats.photosShared}
                          onChange={(e) => setForm((f) => ({ ...f, stats: { ...f.stats, photosShared: Number(e.target.value || 0) } }))}
                        />
                      </div>
                      {/* Rated Destinations */}
                      <div>
                        <div className="muted small" style={{ marginBottom: 6 }}>Rated Destinations</div>
                        <input className="form-input" min={0}
                          value={form.stats.ratedDestinations}
                          onChange={(e) => setForm((f) => ({ ...f, stats: { ...f.stats, ratedDestinations: Number(e.target.value || 0) } }))}
                        />
                      </div>
                      {/* Total Friends */}
                      <div>
                        <div className="muted small" style={{ marginBottom: 6 }}>Total Friends</div>
                        <input className="form-input" min={0}
                          value={form.stats.friends}
                          onChange={(e) => setForm((f) => ({ ...f, stats: { ...f.stats, friends: Number(e.target.value || 0) } }))}
                        />
                      </div>
                    </div>
                  ))}

                  {/* Travel Interests */}
                  {card('Travel Interests', (
                    // Show interests from Firebase as chips (read-only display)
                    <InterestsChips items={form.interests || []} />
                  ))}

                  {/* Achievements */}
                  {card('Achievements', (
                      <>
                      {(form.achievements || []).map((a, idx) => (
                          <div
                            key={idx}
                            style={{
                              ...rowBox,
                              // wider description, no date column
                              gridTemplateColumns: '56px 1.2fr 2.4fr 110px',
                              marginBottom: 10
                            }}
                          >
                            {/* Static emoji badge (no dropdown) */}
                            <div
                              aria-label="Achievement icon"
                              title={a.title}
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: 8,
                                background: '#f1f5f9',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 20
                              }}
                            >
                              {getAchievementEmoji(a)}
                            </div>

                            {/* Title (kept editable) */}
                            <input
                              className="form-input"
                              value={a.title}
                              onChange={(e) => {
                                const v = e.target.value;
                                setForm((f) => {
                                  const next = [...(f.achievements || [])];
                                  next[idx] = { ...next[idx], title: v };
                                  return { ...f, achievements: next };
                                });
                              }}
                            />

                            {/* Description – widened */}
                            <input
                              className="form-input"
                              value={a.desc}
                              onChange={(e) => {
                                const v = e.target.value;
                                setForm((f) => {
                                  const next = [...(f.achievements || [])];
                                  next[idx] = { ...next[idx], desc: v };
                                  return { ...f, achievements: next };
                                });
                              }}
                              style={{ width: '100%' }}
                              placeholder="Description"
                            />
                          </div>
                      ))}
                      <button type="button"
                          onClick={() => setForm((f) => ({ ...f, achievements: [...(f.achievements || []), { icon: '🏆', title: '', desc: '' }] }))}
                          style={{ marginTop: 10, background: '#22c55e', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 500 }}>
                          + Add Achievement
                      </button>
                      </>
                  ))}

                  {/* Recent Activity */}
                  {card('Recent Activity', (
                      <>
                      {activityLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                          <Spinner size={28} />
                        </div>
                      ) : (
                        <>
                        {(form.activity || []).map((a, idx) => {
                            const type = a.type || 'Activity';
                            const abbr = (type === 'Photo' ? 'Ph' :
                                          type === 'Review' ? 'Rv' :
                                          type === 'Visit' ? 'Vi' :
                                          type === 'Friend' ? 'Fr' : 'Ac');
                            const badgeBg = type === 'Photo' ? '#dbeafe'
                                          : type === 'Review' ? '#ede9fe'
                                          : type === 'Visit' ? '#dcfce7'
                                          : type === 'Friend' ? '#fee2e2'
                                          : '#f3f4f6';
                            const badgeColor = type === 'Photo' ? '#1d4ed8'
                                            : type === 'Review' ? '#6d28d9'
                                            : type === 'Visit' ? '#047857'
                                            : type === 'Friend' ? '#b91c1c'
                                            : '#374151';
                            return (
                              <div key={idx} style={{ ...rowBox, marginBottom: 10 }}>
                                <div
                                  title={type}
                                  style={{
                                    width: 40,
                                    textAlign: 'center',
                                    fontWeight: 700,
                                    borderRadius: 8,
                                    padding: '6px 0',
                                    background: badgeBg,
                                    color: badgeColor
                                  }}
                                >
                                  {abbr}
                                </div>
                                <input className="form-input" value={a.text}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setForm((f) => {
                                      const next = [...(f.activity || [])];
                                      next[idx] = { ...next[idx], text: v }; return { ...f, activity: next };
                                    });
                                  }} />
                                <input className="form-input" value={a.date}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setForm((f) => {
                                      const next = [...(f.activity || [])];
                                      next[idx] = { ...next[idx], date: v }; return { ...f, activity: next };
                                    });
                                  }} />
                            </div>
                            );
                        })}
                        <button type="button"
                            onClick={() => setForm((f) => ({ ...f, activity: [...(f.activity || []), { type: 'Photo', text: '', date: '' }] }))}
                            style={{ marginTop: 10, background: '#22c55e', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 8, fontWeight: 500 }}>
                          + Add Activity
                        </button>
                        </>
                      )}
                      </>
                  ))}
                </div>
              </>
            )}

            {tab === 'profile' && (
              // Match the screenshot layout and styles
              <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.04)', padding: 18 }}>
                {/* Title divider like screenshot */}
                <div style={{ borderBottom: '1px solid #e5e7eb', margin: '0 0 18px 0' }} />

                {/* Profile Picture */}
                <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>Profile Picture</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: '50%',
                    background: '#6366f1',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 24, fontWeight: 600, overflow: 'hidden',
                    boxShadow: '0 2px 10px rgba(0,0,0,.08)'
                  }}>
                    {form.photoURL ? (
                      <img src={form.photoURL} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      avatarInitial
                    )}
                  </div>

                  <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        setUploading(true);
                        const url = await uploadToCloudinary(file);
                        setForm((f) => ({ ...f, photoURL: url }));
                      } catch (err) {
                        console.error(err);
                        alert('Upload failed. Please try again.');
                      } finally {
                        setUploading(false);
                        if (fileRef.current) fileRef.current.value = '';
                      }
                    }} />

                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    style={{
                      background: 'linear-gradient(90deg,#10b981,#059669)',
                      color: '#fff',
                      border: 'none',
                      padding: '10px 18px',
                      borderRadius: 8,
                      fontWeight: 600,
                      boxShadow: '0 4px 12px rgba(16,185,129,.25)',
                      cursor: uploading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {uploading ? 'Uploading...' : 'Upload Photo'}
                  </button>
                </div>

                {/* Divider like screenshot */}
                <div style={{ borderTop: '1px solid #e5e7eb', margin: '0 0 18px 0' }} />

                {/* Traveler Bio */}
                <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>Traveler Bio</div>
                <textarea
                  className="form-input"
                  value={form.bio}
                  onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                  placeholder="Tell something about the traveler..."
                  style={{
                    width: '100%',
                    minHeight: 160,
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    resize: 'vertical'
                  }}
                />
                {/* Bottom divider like screenshot */}
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 18 }} />
              </div>
            )}


            {tab === 'settings' && (
                <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.04)', padding: 18 }}>
                {/* top divider under tabs, as in screenshot */}
                <div style={{ borderBottom: '1px solid #e5e7eb', margin: '0 0 18px 0' }} />

                <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>Account Status</div>
                <select
                  className="form-input"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  style={{ width: '100%' }}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>

                {/* bottom divider like screenshot */}
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 18 }} />
                </div>
            )}
            </div>

            {/* Footer */}
            <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn-secondary" onClick={onClose} style={{ padding: '10px 18px', borderRadius: 8 }}>Cancel</button>
            <button className="btn-primary" onClick={save}
                style={{ padding: '10px 18px', borderRadius: 8, background: 'linear-gradient(90deg,#2563eb,#3b82f6)', color: '#fff', border: 'none', fontWeight: 700 }}>
                Update User
            </button>
            </div>
        </div>
        </div>
    );
}

// Lightweight circular spinner (injects its own keyframes once)
function ensureSpinKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cms-spin-kf')) return;
  const s = document.createElement('style');
  s.id = 'cms-spin-kf';
  s.textContent = '@keyframes cmsSpin{to{transform:rotate(360deg)}}';
  document.head.appendChild(s);
}
const Spinner = ({ size = 24, color = '#2563eb', style = {} }) => {
  ensureSpinKeyframes();
  return (
    <span
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        border: `3px solid ${color}22`,
        borderTopColor: color,
        animation: 'cmsSpin 1s linear infinite',
        ...style
      }}
    />
  );
}

/**
 * Fetches travel statistics for all users:
 * - Places on Trips: users/{uid}/trips
 * - Photos Shared: users/{uid}/photos and stats.photosShared
 * - Rated Destinations: users/{uid}/ratings
 * Returns: Array of { uid, placesOnTrips, photosShared, ratedDestinations }
 */
export async function fetchAllUsersTravelStats() {
  const db = getFirestore();
  const usersSnap = await getDocs(collection(db, 'users'));
  const results = [];

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    // Places on Trips
    let placesOnTrips = 0;
    try {
      const tripsSnap = await getDocs(collection(db, 'users', uid, 'trips'));
      placesOnTrips = tripsSnap.size;
    } catch {}

    // Photos Shared (sum of photos subcollection and stats.photosShared field)
    let photosShared = 0;
    try {
      const photosSnap = await getDocs(collection(db, 'users', uid, 'photos'));
      photosShared = photosSnap.size;
    } catch {}
    // Add stats.photosShared field if present
    const stats = userDoc.data().stats || {};
    if (typeof stats.photosShared === 'number') {
      photosShared += stats.photosShared;
    }

    // Rated Destinations
    let ratedDestinations = 0;
    try {
      const ratingsSnap = await getDocs(collection(db, 'users', uid, 'ratings'));
      ratedDestinations = ratingsSnap.size;
    } catch {}

    results.push({
      uid,
      placesOnTrips,
      photosShared,
      ratedDestinations,
    });
  }

  return results;
}

// Deep-sanitize any object so it’s Firestore-safe (no undefined values)
function sanitizeForFirestore(value) {
  if (value === undefined) return null;            // convert undefined -> null
  if (Array.isArray(value)) return value.map(sanitizeForFirestore);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const sv = sanitizeForFirestore(v);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }
  return value;
}