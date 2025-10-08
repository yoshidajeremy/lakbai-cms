import React, { useEffect, useState, useRef } from 'react';
import './Styles/contentManager.css';
import { db, auth, storage } from './firebase';
import { collection, getDocs, doc, setDoc, updateDoc, addDoc, deleteDoc, getCountFromServer, onSnapshot, query, where, orderBy, limit, serverTimestamp, collectionGroup, documentId, getDoc, startAfter } from 'firebase/firestore';
import { CloudinaryContext, Image } from './cloudinary';
import EditProfileCMS from './editprofile-cms'; // NEW
import { getFunctions, httpsCallable } from 'firebase/functions';
import ViewProfileCMS from './viewprofile-cms'; // NEW
import AddUserCMS from './adduser-cms'; // NEW
import DestinationForm from './adddestination-cms'; // NEW 
import AddFromCsvCMS from './addfromcsv-cms'; // NEW
import ReportDetailModal from './reportdetails-cms'; //NEW
import TakeActionModal from './takeaction-cms'; // NEW
import AuditLogsCMS from './auditlogs-cms'; // NEW
import { getAuth, signOut } from "firebase/auth";
import { publishAllDrafts } from './publishAllDrafts';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ImagesCMS from './images-cms';
import NotFoundCMS from './notfound-cms';
import destImages from './dest-images.json';

// Cloudinary config
const CLOUDINARY_UPLOAD_PRESET = process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET || 'lakbai_preset';
const CLOUDINARY_CLOUD_NAME = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME || 'dxvewejox';

// Helper to get Cloudinary publicId from URL
function getCloudinaryPublicId(url) {
    if (!url || typeof url !== 'string') return null;
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;
    let publicId = parts[1].split('?')[0];
    // Remove file extension
    publicId = publicId.replace(/\.[^/.]+$/, "");
    return publicId;
}

// Helper to delete image from Cloudinary
async function deleteCloudinaryImage(publicId) {
    if (!publicId) return;
    const base = window.location.origin;
    const endpoints = [
        'http://localhost:3002/api/cloudinary/delete', // <-- direct to backend port
        '/api/cloudinary/delete',
    ];
    let lastErr;
    for (const url of endpoints) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ publicId })
            });
            if (res.ok) return; // success on first working endpoint
            lastErr = new Error((await res.text()) || `HTTP ${res.status}`);
        } catch (e) {
            lastErr = e;
        }
    }
    // If we got here, none of the endpoints worked
    alert('Cloudinary image delete failed: ' + (lastErr?.message || 'Unknown error'));
    console.warn('Cloudinary image delete failed:', lastErr);
}

const TagInput = ({ tags, onChange, placeholder }) => {
const [val, setVal] = useState('');
const add = (t) => {
    const v = t.trim();
    if (!v) return;
    if (!tags.includes(v)) onChange([...tags, v]);
    setVal('');
};
return (
    <div className="tag-input">
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {tags.map((t) => (
        <span key={t} className="tag-item">
            {t}
            <button type="button" className="tag-remove" onClick={() => onChange(tags.filter((x) => x !== t))}>
            ×
            </button>
        </span>
        ))}
    </div>
    <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(val);
        }
        }}
        onBlur={() => val && add(val)}
        placeholder={placeholder}
        className="form-input"
    />
    </div>
    );
};


const RichTextEditor = ({ value, onChange, placeholder }) => {
const ref = useRef(null);
useEffect(() => {
    if (ref.current && value !== ref.current.innerHTML) ref.current.innerHTML = value || '';
}, [value]);
return (
    <div>
    <div className="rich-controls" style={{ marginBottom: 8 }}>
        <button type="button" onClick={() => document.execCommand('bold')} className="btn-small">B</button>
        <button type="button" onClick={() => document.execCommand('italic')} className="btn-small">I</button>
        <button type="button" onClick={() => document.execCommand('underline')} className="btn-small">U</button>
    </div>
    <div
        ref={ref}
        contentEditable
        className="rich-editor"
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        data-placeholder={placeholder}
        style={{ minHeight: 140, borderRadius: 6, background: '#fff', padding: 12, border: '1px solid #eef2f7' }}
    />
    </div>
);
};

/* DestinationForm used in modal - TRANSFERED TO NEW FILE - adddestination-cms.js */


function fmtDate(v) {
  const d = toDateSafe(v);
  return d ? d.toLocaleDateString() : '—';
}
function fmtDateTime(v) {
  const d = toDateSafe(v);
  return d ? d.toLocaleString() : '—';
}

// Helper date formatters (fixes fmtDate / fmtDateTime no-undef)
const toDateSafe = (v) => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));

// REPLACE normalizeInterests with a more robust version
const normalizeInterests = (src) => {
  // turn any supported shape into a string array
  const toList = (val) => {
    if (!val && val !== 0) return [];
    if (Array.isArray(val)) return val.map((x) => String(x).trim()).filter(Boolean);
    if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
    if (typeof val === 'object') {
      // boolean map -> keys with truthy values
      return Object.keys(val || {})
        .filter((k) => !!val[k])
        .map((k) => String(k).trim())
        .filter(Boolean);
    }
    return [];
  };

  // collect from many possible fields/paths
  const candidates = [
    src?.interests,
    src?.travelInterests,
    src?.interestTags,
    src?.tags,
    src?.badges,
    src?.traits,
    src?.roles,
    src?.personas,
    src?.interestMap,
    src?.interest_map,

    // nested
    src?.profile?.interests,
    src?.profile?.tags,
    src?.profile?.badges,
    src?.preferences?.interests,
    src?.preferences?.tags,
    src?.settings?.interests,
    src?.settings?.tags,
  ];

  // flatten + dedupe case-insensitively
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    for (const s of toList(c)) {
      const key = s.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(s);
      }
    }
  }
  return out;
};

// Helper: try alternate docs if top-level users/{uid} has no interests
async function loadAdditionalUserInterests(db, uid) {
  const tryDocs = [
    doc(db, 'users', uid, 'profile', 'meta'),
    doc(db, 'users', uid, 'settings', 'profile'),
    doc(db, 'profiles', uid),
    doc(db, 'userProfiles', uid),
    doc(db, 'userSettings', uid),
    doc(db, 'userPreferences', uid),
  ];
  let merged = {};
  for (const ref of tryDocs) {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) merged = { ...merged, ...(snap.data() || {}) };
    } catch {}
  }
  return normalizeInterests(merged);
}

// Helper to update a user's password via admin function or HTTP fallback
async function adminUpdatePassword(uid, newPassword) {
  if (!uid || !newPassword) return;

  // Try Firebase Callable Function first
  try {
    const functions = getFunctions();
    const fn = httpsCallable(functions, 'adminUpdateUserPassword');
    await fn({ uid, newPassword });
    return;
  } catch (err) {
    console.warn('Callable password update failed, falling back to HTTP:', err?.message);
  }

  // Fallback to your API endpoints if available
  const base = window.location.origin;
  const endpoints = [
    `${base}/admin/api/auth/updatePassword`,
    `${base}/api/auth/updatePassword`,
  ];
  let lastErr;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ uid, newPassword }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('All password update endpoints failed.');
}

function ContentManagement() {
  const [analytics, setAnalytics] = useState({
    totalDestinations: 0,
    totalUsers: 0,
    totalArticles: 0,
    publishedContent: 0,
    recentActivity: [],
  });
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState('dashboard');

  // DESTINATIONS state + fetch
  const [destinations, setDestinations] = useState([]);
  const [searchDest, setSearchDest] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loadingDest, setLoadingDest] = useState(false);

  // USERS state + fetch (added)
  const [users, setUsers] = useState([]);
  const [searchUser, setSearchUser] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userStatusFilter, setUserStatusFilter] = useState('all');

  // DELETE User confirmation modal state
  const [deleteUserConfirmOpen, setDeleteUserConfirmOpen] = useState(false);
  const [deleteUserTarget, setDeleteUserTarget] = useState(null);

  // NEW: per-user travel stats loaded from Firestore
  const [userStats, setUserStats] = useState({});

  // NEW: User Profile modal state
  const [userProfileOpen, setUserProfileOpen] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [userProfileTab, setUserProfileTab] = useState('overview');

  // Audit Logs modal state
  const [showAuditLogs, setShowAuditLogs] = useState(false);

  // Sign-out confirmation modal state
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  // Activity state for User Profile
  const [userActivity, setUserActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // NEW: Photos state for User Profile
  const [userPhotos, setUserPhotos] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  // ADD: Activity state for User Profile (fixes no-undef)

  // Modal state (was missing -> caused no-undef ESLint errors)
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  // NEW: Edit User modal state
  const [userEditOpen, setUserEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userEditTab, setUserEditTab] = useState('profile'); // active tab for Edit User modal

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [addCsvOpen, setAddCsvOpen] = useState(false);
  
  // DELETE confirmation modal state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Travel tab local state
  const [editInterests, setEditInterests] = useState([]);
  const [editPlaces, setEditPlaces] = useState([]);
  const [placeInput, setPlaceInput] = useState('');
  const [editStatus, setEditStatus] = useState('active'); // NEW: settings tab state
  const [interestInput, setInterestInput] = useState('');  // NEW: inline input for Travel Interests

  // NEW: total images count from dest-images.json
  const totalImages = Array.isArray(destImages) ? destImages.length : 0;

  // Settings state (persisted to localStorage)
  const [cmsSettings, setCmsSettings] = useState(() => {
    const s = localStorage.getItem('cms-settings');
    return s
    ? JSON.parse(s)
    : {
        siteName: 'LakbAI CMS',
        siteDescription: 'Professional Travel Content Management System',
        contactEmail: 'admin@travelcms.com',
        socialMedia: { facebook: '', twitter: '', instagram: '' },
        seo: {
            defaultMetaTitle: 'TravelCMS Pro',
            defaultMetaDescription: 'Discover amazing travel destinations',
            googleAnalytics: '',
        },
        notifications: { emailNotifications: true, pushNotifications: false },
        };
});

const saveSettings = () => {
    localStorage.setItem('cms-settings', JSON.stringify(cmsSettings));
    alert('Settings saved');
};

// Add these at the top of ContentManagement function:
const [actionOpen, setActionOpen] = useState(false);
const [actionReport, setActionReport] = useState(null);
const [actionSubmitting, setActionSubmitting] = useState(false);

// Define userNameCache as a React state (used by Reports -> Reported User names)
const [userNameCache, setUserNameCache] = useState({});

const openActionModal = (report) => {
  setActionReport(report);
  setActionOpen(true);
};

// NEW: Publish All Drafts handler
const handlePublishAll = async () => {
  try {
    const count = await publishAllDrafts();
    if (count > 0) {
      toast.success(`Published ${count} draft destination(s).`, {
        position: "top-right",
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
      });
    } else {
      toast.info('No draft destinations to publish.', {
        position: "top-right",
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "colored",
      });
    }
    // Optionally refresh your list here
  } catch (e) {
    toast.error('Failed to publish drafts.', {
      position: "top-right",
      autoClose: 5000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      progress: undefined,
      theme: "colored",
    });
  }
};

// ADD: handleTakeAction (used by TakeActionModal)
const handleTakeAction = async ({ actionType, reason, notes }) => {
  if (!actionReport) return;
  setActionSubmitting(true);
  try {
    const actorUid = auth.currentUser?.uid || 'system';
    const targetUserId = actionReport?.reportedUser?.id || null;
    const reportId = actionReport?.id || null;

    // 1) Log moderation action
    await addDoc(collection(db, 'moderationActions'), {
      reportId,
      targetUserId,
      contentType: actionReport?.contentType || 'Post',
      actionType,
      reason,
      notes: notes || '',
      actorUid,
      createdAt: serverTimestamp(),
      status: 'queued',
    });

    const act = (actionType || '').toLowerCase();

    // 2) Remove Content Only
    if (act === 'remove content only') {
      const contentId = actionReport?.contentId || actionReport?.reportedContent?.id || null;
      if (contentId) {
        try { await deleteDoc(doc(db, 'posts', contentId)); } catch {}
        try { await deleteDoc(doc(db, 'communityPosts', contentId)); } catch {}
        try { await updateDoc(doc(db, 'content', contentId), { removed: true, removedAt: serverTimestamp(), removedBy: actorUid }); } catch {}
      }
    }

    // 3) Account actions (Suspend, Ban, Permanently Delete)
    if (targetUserId && (act === 'suspend account' || act === 'ban account' || act === 'permanently delete account')) {
      const userRef = doc(db, 'users', targetUserId);
      try {
        if (act === 'suspend account') {
          await updateDoc(userRef, { status: 'disabled', statusReason: reason, statusUpdatedAt: serverTimestamp(), statusBy: actorUid });
        } else if (act === 'ban account') {
          await updateDoc(userRef, { status: 'banned', statusReason: reason, statusUpdatedAt: serverTimestamp(), statusBy: actorUid });
        } else if (act === 'permanently delete account') {
          await updateDoc(userRef, { status: 'deleted', deletedAt: serverTimestamp(), deletedBy: actorUid, deleteReason: reason });
          await addDoc(collection(db, 'accountDeletionRequests'), { userId: targetUserId, requestedBy: actorUid, reason, createdAt: serverTimestamp() });
        }
      } catch {}
    }

    // 4) Mark report resolved
    try { if (reportId) await updateDoc(doc(db, 'reports', reportId), { status: 'resolved', resolvedAt: serverTimestamp() }); } catch {}
    try { if (reportId) await updateDoc(doc(db, 'report',  reportId), { status: 'resolved', resolvedAt: serverTimestamp() }); } catch {}

    setActionOpen(false);
    setActionReport(null);
    alert('Action submitted.');
  } catch (e) {
    console.error('Take action failed:', e);
    alert('Failed to submit action.');
  } finally {
    setActionSubmitting(false);
  }
};

  useEffect(() => {
    (async () => {
      try {
        const countReports = async () => {
          let total = 0;
          // report (singular)
          try {
            const c1 = await getCountFromServer(collection(db, 'report'));
            total += c1.data().count || 0;
          } catch {
            try { const s1 = await getDocs(collection(db, 'report')); total += s1.size || 0; } catch {}
          }
          // reports (plural)
          try {
            const c2 = await getCountFromServer(collection(db, 'reports'));
            total += c2.data().count || 0;
          } catch {
            try { const s2 = await getDocs(collection(db, 'reports')); total += s2.size || 0; } catch {}
          }
          return total;
        };

        const [dSnap, uSnap, aSnap, reportsCount] = await Promise.all([
          getDocs(collection(db, 'destinations')),
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'articles')), // kept for compatibility
          countReports(),
        ]);
        const destinations = dSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const users = uSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const articles = aSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const publishedDestinations =
          destinations.filter((x) => String(x.status || '').toLowerCase() === 'published').length;

        const recent = [
          ...destinations.slice(-5).map((d) => ({ ...d, type: 'destination' })),
          ...articles.slice(-5).map((a) => ({ ...a, type: 'article' })),
        ]
          .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
          .slice(0, 10);

        setAnalytics((a) => ({
          ...a,
          totalArticles: reportsCount,          // show number of submitted reports
          publishedContent: publishedDestinations,
          recentActivity: recent,
        }));

        setDestinations(destinations);
        setUsers(users);
      } catch (e) {
        // fallback to local caches + best-effort report count
        let reportsCount = 0;
        try { const s1 = await getDocs(collection(db, 'report')); reportsCount += s1.size || 0; } catch {}
        try { const s2 = await getDocs(collection(db, 'reports')); reportsCount += s2.size || 0; } catch {}

        const localDest = JSON.parse(localStorage.getItem('destinations') || '[]');
        const localUsers = JSON.parse(localStorage.getItem('users') || '[]');
        const localArticles = JSON.parse(localStorage.getItem('articles') || '[]');

        setAnalytics((a) => ({
          ...a,
          totalArticles: reportsCount // reports from Firestore (or 0)
          ,
          publishedContent: localDest.filter((d) => String(d.status || '').toLowerCase() === 'published').length,
          recentActivity: [...localDest.slice(-5), ...localArticles.slice(-5)].slice(0, 10),
        }));

        setDestinations(localDest);
        setUsers(localUsers);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // LIVE: dashboard counters from Firestore (destinations + users + published destinations)
  useEffect(() => {
    if (active !== 'dashboard') return;

    let unsubDest = null;
    let unsubUsers = null;
    let unsubPubDest = null;
    let unsubRep1 = null;
    let unsubRep2 = null;
    let r1 = 0, r2 = 0; // live sizes for report/reports

    const destColl = collection(db, 'destinations');
    const usersColl = collection(db, 'users');
    const pubQ = query(destColl, where('status', 'in', ['published', 'PUBLISHED']));

    (async () => {
      try {
        const [dc, uc, pc] = await Promise.all([
          getCountFromServer(destColl),
          getCountFromServer(usersColl),
          getCountFromServer(pubQ),
        ]);

        // count reports from both collections
        const sumCounts = async () => {
          let total = 0;
          try { const c = await getCountFromServer(collection(db, 'report')); total += c.data().count || 0; } catch {
            try { const s = await getDocs(collection(db, 'report')); total += s.size || 0; } catch {}
          }
          try { const c = await getCountFromServer(collection(db, 'report')); total += c.data().count || 0; } catch {
            try { const s = await getDocs(collection(db, 'report')); total += s.size || 0; } catch {}
          }
          return total;
        };
        const reportsCount = await sumCounts();

        setAnalytics((a) => ({
          ...a,
          totalDestinations: dc.data().count || 0,
          totalUsers: uc.data().count || 0,
          publishedContent: pc.data().count || 0,
          totalArticles: reportsCount // live number of reports
        }));
      } catch {
        // keep previous values
      }

      // Real-time updates
      try {
        unsubDest = onSnapshot(destColl, (snap) =>
          setAnalytics((a) => ({ ...a, totalDestinations: snap.size }))
        );
        unsubUsers = onSnapshot(usersColl, (snap) =>
          setAnalytics((a) => ({ ...a, totalUsers: snap.size }))
        );
        unsubPubDest = onSnapshot(pubQ, (snap) =>
          setAnalytics((a) => ({ ...a, publishedContent: snap.size }))
        );

        // Listen to both collections for reports
        try {
          unsubRep1 = onSnapshot(collection(db, 'report'), (snap) => {
            r1 = snap.size; setAnalytics((a) => ({ ...a, totalArticles: r1 + r2 }));
          });
        } catch {}
        try {
          unsubRep2 = onSnapshot(collection(db, 'report'), (snap) => {
            r2 = snap.size; setAnalytics((a) => ({ ...a, totalArticles: r1 + r2 }));
          });
        } catch {}
      } catch (e) {
        console.warn('onSnapshot counters error:', e);
      }
    })();

    return () => {
      if (typeof unsubDest === 'function') unsubDest();
      if (typeof unsubUsers === 'function') unsubUsers();
      if (typeof unsubPubDest === 'function') unsubPubDest();
      if (typeof unsubRep1 === 'function') unsubRep1();
      if (typeof unsubRep2 === 'function') unsubRep2();
    };
  }, [active]);
  
useEffect(() => {
  if (active !== 'users' || !users?.length) return;
  let cancelled = false;

  const safeCount = async (refOrQuery) => {
    try {
      const c = await getCountFromServer(refOrQuery);
      return c.data().count || 0;
    } catch {
      try {
        const snap = await getDocs(refOrQuery);
        return snap.size || 0;
      } catch {
        return 0;
      }
    }
  };
  const tallyDestinationsFromTripDocs = async (tripDocs) => {
    let total = 0;
    for (const d of tripDocs) {
      const data = d.data();
      if (Array.isArray(data?.destinations)) {
        total += data.destinations.length;
      } else if (typeof data?.destinationsCount === 'number') {
        total += data.destinationsCount;
      } else {
        // subcollection users/{uid}/(myTrips|trips)/{tripId}/destinations
        try {
          const sub = collection(d.ref, 'destinations');
          total += await safeCount(sub);
        } catch {}
      }
    }
    return total;
  };

  const countPlaces = async (uid) => {
    // Try top-level myTrips with userId, then trips, then user subcollections, then itinerary items
    // 1) myTrips (top-level)
    try {
      const q1 = query(collection(db, 'myTrips'), where('userId', '==', uid));
      const s1 = await getDocs(q1);
      if (!s1.empty) return await tallyDestinationsFromTripDocs(s1.docs);
    } catch {}

    // 2) trips (top-level)
    try {
      const q2 = query(collection(db, 'trips'), where('userId', '==', uid));
      const s2 = await getDocs(q2);
      if (!s2.empty) return await tallyDestinationsFromTripDocs(s2.docs);
    } catch {}

    // 3) users/{uid}/myTrips
    try {
      const s3 = await getDocs(collection(db, 'users', uid, 'myTrips'));
      if (!s3.empty) return await tallyDestinationsFromTripDocs(s3.docs);
    } catch {}

    // 4) users/{uid}/trips
    try {
      const s4 = await getDocs(collection(db, 'users', uid, 'trips'));
      if (!s4.empty) return await tallyDestinationsFromTripDocs(s4.docs);
    } catch {}

    // 5) itinerary/{uid}/items
    try {
      const s5 = await safeCount(collection(db, 'itinerary', uid, 'items'));
      if (s5) return s5;
    } catch {}

    return 0;
  };

  const countPhotos = async (uid) => {
    // Prefer top-level photos with userId
    const cTop = await (async () => {
      try {
        const qref = query(collection(db, 'photos'), where('userId', '==', uid));
        return await safeCount(qref);
      } catch { return 0; }
    })();
    if (cTop) return cTop;

    // Fallback: users/{uid}/photos
    try {
      return await safeCount(collection(db, 'users', uid, 'photos'));
    } catch { return 0; }
  };

  const countReviews = async (uid) => {
    // Preferred: collection group over destinations/*/ratings with userId
    try {
      const q1 = query(collectionGroup(db, 'ratings'), where('userId', '==', uid));
      const c1 = await safeCount(q1);
      if (c1) return c1;
    } catch {}

    // If ratings docs are keyed by UID (no userId field), match by documentId
    try {
      const q2 = query(collectionGroup(db, 'ratings'), where(documentId(), '==', uid));
      const c2 = await safeCount(q2);
      if (c2) return c2;
    } catch {}

    // Fallbacks: top-level reviews or users/{uid}/reviews
    try {
      const q3 = query(collection(db, 'reviews'), where('userId', '==', uid));
      const c3 = await safeCount(q3);
      if (c3) return c3;
    } catch {}
    try {
      return await safeCount(collection(db, 'users', uid, 'reviews'));
    } catch { return 0; }
  };

  // NEW: count friends
  const countFriends = async (uid) => {
    // Try collectionGroup 'friends' with userId field
    try {
      const q1 = query(collectionGroup(db, 'friends'), where('userId', '==', uid));
      const c1 = await safeCount(q1);
      if (c1) return c1;
    } catch {}
    // Top-level friendships with array-contains uid
    try {
      const q2 = query(collection(db, 'friendships'), where('participants', 'array-contains', uid));
      const c2 = await safeCount(q2);
      if (c2) return c2;
    } catch {}
    // Fallback: users/{uid}/friends
    try {
      return await safeCount(collection(db, 'users', uid, 'friends'));
    } catch { return 0; }
  };

  (async () => {
    const ids = users.map(u => u.id).filter(Boolean);
    const pending = ids.filter(id => userStats[id] === undefined);
    if (!pending.length) return;

    const entries = await Promise.all(pending.map(async (uid) => {
      const [places, photos, reviews, friends] = await Promise.all([
        countPlaces(uid),
        countPhotos(uid),
        countReviews(uid),
        countFriends(uid),
      ]);
      return [uid, { places, photos, reviews, friends }];
    }));

    if (!cancelled) {
      setUserStats((prev) => {
        const next = { ...prev };
        for (const [uid, stats] of entries) next[uid] = stats;
        return next;
      });
    }
  })();

  return () => { cancelled = true; };
}, [active, users, userStats]);

  // Handlers for Destination modal (fixes openCreate/closeForm/handleSaveDestination)
  const openCreate = () => {
    setEditing(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleSaveDestination = async (payload) => {
    try {
      if (editing?.id) {
        await updateDoc(doc(db, 'destinations', editing.id), payload);
        setDestinations((prev) => prev.map((d) => (d.id === editing.id ? { ...d, ...payload, id: editing.id } : d)));
      } else {
        const ref = await addDoc(collection(db, 'destinations'), payload);
        const newDoc = { ...payload, id: ref.id };
        setDestinations((prev) => [...prev, newDoc]);
        setAnalytics((a) => ({ ...a, totalDestinations: (a.totalDestinations || 0) + 1 }));
      }
      // optional localStorage fallback sync
      try {
        localStorage.setItem('destinations', JSON.stringify((prev => prev)(destinations)));
      } catch {}
      closeForm();
    } catch (err) {
      console.error('Save destination failed:', err);
      alert('Failed to save destination.');
    }
  };

  // User Profile modal handlers (fixes openUserProfile/closeUserProfile)
  const openUserProfile = (u) => {
    const seeded = { ...u, interests: normalizeInterests(u) };
    setUserProfile(seeded);
    setUserProfileTab('overview');
    setUserProfileOpen(true);
  };
  const closeUserProfile = () => { setUserProfileOpen(false); setUserProfile(null); };

  // LIVE: hydrate userProfile from Firestore while modal is open (ensures interests match)
  useEffect(() => {
    if (!userProfileOpen || !userProfile?.id) return;
    const ref = doc(db, 'users', userProfile.id);
    const unsub = onSnapshot(ref, async (snap) => {
      if (!snap.exists()) return; // FIX: early return when no doc
      const data = snap.data() || {};
      const normalized = normalizeInterests(data);
      setUserProfile((prev) => ({
        ...(prev || {}),
        ...data,
        interests: normalized.length ? normalized : (prev?.interests || []),
      }));

      // If still empty, probe alternate docs once
      if (!normalized.length) {
        try {
          const extra = await loadAdditionalUserInterests(db, userProfile.id);
          if (extra.length) {
            setUserProfile((prev) => ({ ...(prev || {}), interests: extra }));
          }
        } catch {}
      }
    });
    return () => unsub();
  }, [userProfileOpen, userProfile?.id]);

  // Edit User modal handler (fixes openEditUserModal)
  const openEditUserModal = (u, tab = 'basic') => { // <-- default to 'profile'
    setEditingUser(u);
    setUserEditOpen(true);
    setUserEditTab(tab);
    // seed from normalized interests
    setEditInterests(normalizeInterests(u));
    setEditPlaces(Array.isArray(u?.places) ? u.places : []);
    setEditStatus((u?.status || 'active').toLowerCase());
  };

  // Save handler for EditProfileCMS
  const handleSaveUser = async (payload) => {
    const uid = editingUser.id;

    // separate password from profile update
    const { password, ...profile } = {
      email: payload.email ?? editingUser.email ?? '',
      travelerName: payload.travelerName ?? editingUser.travelerName ?? '',
      provider: payload.provider ?? editingUser.provider ?? 'Email',
      photoURL: payload.photoURL ?? editingUser.photoURL ?? '',
      travelerBio: payload.travelerBio ?? editingUser.travelerBio ?? editingUser.bio ?? '',
      status: payload.status ?? editingUser.status ?? 'active',
      stats: { ...(editingUser.stats || {}), ...(payload.stats || {}) },
      interests: Array.isArray(payload.interests) ? payload.interests : [],
      updatedAt: serverTimestamp(),
    };

    try {
      // update Firestore profile first
      await updateDoc(doc(db, 'users', uid), profile);

      // optionally update password via admin
      if (password && typeof password === 'string') {
        await adminUpdatePassword(uid, password);
      }

      // reflect changes locally (never store password in state)
      setUsers((prev) =>
        prev.map((u) => (u.id === uid ? { ...u, ...profile, id: uid } : u))
      );
      setUserEditOpen(false);
      setEditingUser(null);
    } catch (e) {
      console.error('Update user failed:', e);
      alert('Failed to update user.');
    }
  };

  // NEW/UPDATE: handler to create a user doc for AddUserCMS (ensures Join Date is shown)
  const handleAddUserSave = async (payload) => {
    try {
      const {
        travelerName = '',
        email = '',
        provider = 'Email',
        status = 'active',
        travelerBio = '',
        photoURL = ''
      } = payload || {};

      const now = new Date(); // for immediate UI display

      const ref = await addDoc(collection(db, 'users'), {
        travelerName,
        email,
        provider,
        status: (status || 'active').toLowerCase(),
        travelerBio,
        photoURL: photoURL || '',
        createdAt: serverTimestamp(),   // persisted timestamp
        updatedAt: serverTimestamp(),
      });

      // Also reflect createdAt in local state so the date shows without refresh
      setUsers((prev) => [
        ...prev,
        {
          id: ref.id,
          travelerName,
          email,
          provider,
          status: (status || 'active').toLowerCase(),
          travelerBio,
          photoURL: photoURL || '',
          createdAt: now,               // UI-friendly date
          updatedAt: now,
        },
      ]);

      setAddUserOpen(false);
    } catch (e) {
      console.error('Add user failed:', e);
      alert('Failed to add user.');
    }
  };

  // NEW: Reports state + fetch
  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportSearch, setReportSearch] = useState('');
  const [reportStatus, setReportStatus] = useState('all');     // all | pending | under_review | resolved | escalated
  const [reportPriority, setReportPriority] = useState('all'); // all | low | medium | high
  const [reportType, setReportType] = useState('all');         // all | Post | Comment | Review | Message
  const [viewReport, setViewReport] = useState(null);

  // Helpers for badges (styles match screenshot)
  const PriorityBadge = ({ v }) => {
    const t = (v || '').toString().toLowerCase();
    const map = {
      low:    { bg: '#dcfce7', fg: '#166534', text: 'LOW' },
      medium: { bg: '#fef3c7', fg: '#b45309', text: 'MEDIUM' },
      high:   { bg: '#fee2e2', fg: '#b91c1c', text: 'HIGH' },
    };
    const s = map[t] || map.low;
    return (
      <span style={{ background: s.bg, color: s.fg, fontWeight: 700, fontSize: 12, padding: '6px 10px', borderRadius: 999 }}>
        {s.text}
      </span>
    );
  };
  const StatusBadge = ({ v }) => {
    const t = (v || '').toString().toLowerCase();
    const map = {
      pending:      { bg: '#fef9c3', fg: '#a16207', text: 'PENDING' },
      under_review: { bg: '#dbeafe', fg: '#1d4ed8', text: 'UNDER REVIEW' },
      resolved:     { bg: '#dcfce7', fg: '#166534', text: 'RESOLVED' },
      escalated:    { bg: '#fee2e2', fg: '#b91c1c', text: 'ESCALATED' },
    };
    const s = map[t] || map.pending;
    return (
      <span style={{ background: s.bg, color: s.fg, fontWeight: 700, fontSize: 12, padding: '6px 10px', borderRadius: 999 }}>
        {s.text}
      </span>
    );
  };

  // NEW: normalize the "reportedContent" payload from Firestore without templates
  const normalizeReportedContent = (report) => {
    const d = report?.reportedContent || {};
    const type = String(report?.contentType || d.contentType || d.type || '').toLowerCase();

    const toDate = (v) => (v?.toDate?.() ? v.toDate() : (v ? new Date(v) : null));
    const createdAt =
      toDate(d.contentCreatedAt) ||
      toDate(d.createdAt) ||
      toDate(d.timestamp) ||
      toDate(d.date) ||
      null;

    const title =
      d.contentTitle ||
      d.title ||
      d.postTitle ||
      d.subject ||
      null;

    const body =
      d.contentBody ||
      d.body ||
      d.text ||
      d.caption ||
      d.message ||
      null;

    const location =
      report.location ||
      report.place ||
      report.city ||
      report.address ||
      null;

    const images = Array.isArray(report.images)
      ? report.images
      : Array.isArray(report.photos)
      ? report.photos
      : Array.isArray(report.mediaUrls)
      ? report.mediaUrls
      : Array.isArray(report.media)
      ? report.media
      : report.image
      ? [report.image]
      : [];

    return { type, title, body, location, createdAt, images };
  };

  // NEW: Report Details modal (shows only Firestore content; no templates)


  // Filtered reports (used by count + table)
  const filteredReports = React.useMemo(() => {
    const q = (reportSearch || '').trim().toLowerCase();
    return reports.filter((r) => {
      const okQ = !q || [r.title, r.reporterName, r.reportedUser?.name, r.reason]
        .some((v) => (v || '').toString().toLowerCase().includes(q));
      const okStatus   = reportStatus === 'all'   || (r.status || '').toLowerCase() === reportStatus;
      const okPriority = reportPriority === 'all' || (r.priority || '').toLowerCase() === reportPriority;
      const okType     = reportType === 'all'     || (r.contentType || '').toLowerCase() === reportType.toLowerCase();
      return okQ && okStatus && okPriority && okType;
    });
  }, [reports, reportSearch, reportStatus, reportPriority, reportType]);

  // NEW: helper to normalize a report document
  const normalizeReportDoc = (d) => {
    const data = typeof d.data === 'function' ? d.data() : d;

    const rep = data.reporter || {};
    const rawReported = data.reportedUser;
    const statusRaw = (data.status || 'pending').toString().toLowerCase().replace(/\s+/g, '_');
    const priorityRaw = (data.priority || 'low').toString().toLowerCase();

    const created =
      data.createdAt?.toDate?.() ||
      data.date?.toDate?.() ||
      data.timestamp?.toDate?.() ||
      data.createdAt || data.date || data.timestamp || null;

    // NEW: resolve reporter's user ID from common fields
    const reporterId =
      data.reporterId ||
      data.reporterID ||                // added alias
      rep.id ||
      rep.uid ||
      data.userId ||
      data.user ||
      data.reportedBy ||
      data.ownerId ||
      data.authorId ||
      null;

    return {
      id: d.id || data.id,
      title: data.title || data.subject || data.reason || 'Report',
      // UPDATED: broaden reporter name fallbacks
      reporterName:
        data.reporterName ||
        data.reporter_name ||
        rep.name ||
        rep.displayName ||
        data.userName ||
        data.name ||
        null,
      reporterId, // keep id for enrichment fallback
      reportedUser:
        typeof rawReported === 'string'
          ? { id: rawReported || data.reportedUserId || '—', name: data.reportedUserName || '—', avatarUrl: null }
          : {
              id: rawReported?.id || data.reportedUserId || '—',
              name: rawReported?.name || rawReported?.displayName || data.reportedUserName || '—',
              avatarUrl: rawReported?.avatarUrl || rawReported?.photoURL || null,
            },
      contentType: data.contentType || data.type || 'Post',
      reason: data.reason || '—',
      priority: priorityRaw,
      status: statusRaw,
      createdAt: created ? new Date(created) : null,
      reportedContent: data.reportedContent || null,
      contentId: data.contentId || data.postId || null,
      __coll: d.ref?.parent?.id || null,
    };
  };

  // NEW: the id of the report currently viewed
  const [viewReportId, setViewReportId] = useState(null);

  // Subscribe to the selected report doc while the modal is open

  useEffect(() => {
    if (!viewReportId) return;
    let unsub;

    const trySub = (collName) => {
      try {
      
        const ref = doc(db, collName, viewReportId);
        return onSnapshot(ref, (snap) => {
          if (snap.exists()) setViewReport(normalizeReportDoc(snap));
        });
      } catch {
        return null;
      }
    };

    unsub = trySub('report') || trySub('reports');

    return () => { if (typeof unsub === 'function') unsub(); };
  }, [viewReportId]);

  // Seed cache from loaded Users list
  useEffect(() => {
    if (!Array.isArray(users) || users.length === 0) return;
    const updates = {};
    for (const u of users) {
      if (!u?.id || userNameCache[u.id]) continue;
      updates[u.id] = u.travelerName || u.name || u.displayName || u.username || u.email || '—';
    }
    if (Object.keys(updates).length) {
      setUserNameCache((prev) => ({ ...prev, ...updates }));
      }
  }, [users, userNameCache]);

  // Resolve missing names for Reported User IDs from Firestore
  useEffect(() => {
    if (!Array.isArray(reports) || reports.length === 0) return;

    // UPDATED: fetch names for both reportedUser ids and reporter ids
    const ids = Array.from(
      new Set(
        [
          // reported users
          ...reports.map((r) =>
            typeof r?.reportedUser === 'string' ? r.reportedUser : r?.reportedUser?.id
          ),
          // reporters
          ...reports.map((r) => r?.reporterId),
        ].filter(Boolean)
      )
    ).filter((id) => !userNameCache[id]);

    if (ids.length === 0) return;

    const chunks = (arr, size = 10) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    (async () => {
      const updates = {};
      for (const group of chunks(ids, 10)) {
        try {
          const qref = query(collection(db, 'users'), where(documentId(), 'in', group));
          const snap = await getDocs(qref);
          snap.forEach((ds) => {
            const data = ds.data() || {};
            updates[ds.id] =
              data.travelerName ||
              data.name ||
              data.displayName ||
              data.username ||
              data.email ||
              '—';
          });
        } catch {
          for (const uid of group) {
            try {
              const ds = await getDoc(doc(db, 'users', uid));
              if (ds.exists()) {
                const data = ds.data() || {};
                updates[uid] =
                  data.travelerName ||
                  data.name ||
                  data.displayName ||
                  data.username ||
                  data.email ||
                  '—';
              }
            } catch {}
          }
        }
      }
      if (Object.keys(updates).length) setUserNameCache((prev) => ({ ...prev, ...updates }));
    })();
  }, [reports, userNameCache]);

  const filteredDestinations = destinations.filter((d) => {
  // Status filter
  const statusMatch =
    !statusFilter ||
    (d.status && d.status.toLowerCase() === statusFilter.toLowerCase());

  // Category filter (support both category and categories array)
  const categoryMatch =
    !categoryFilter ||
    (d.category && d.category.toLowerCase() === categoryFilter.toLowerCase()) ||
    (Array.isArray(d.categories) && d.categories.some(cat => cat.toLowerCase() === categoryFilter.toLowerCase()));

  // Search filter
  const searchMatch =
    !searchDest ||
    (d.name && d.name.toLowerCase().includes(searchDest.toLowerCase())) ||
    (d.description && d.description.toLowerCase().includes(searchDest.toLowerCase()));  

  return statusMatch && categoryMatch && searchMatch;
});

// Pagination for Destinations
const DEST_PAGE_SIZE = 12;
const [destPage, setDestPage] = useState(1);
const [lastDestDoc, setLastDestDoc] = useState(null);
const [hasMoreDest, setHasMoreDest] = useState(true);

useEffect(() => {
  if (active !== 'destinations') return;
  setLoadingDest(true);

  // Try cache for first page
  if (destPage === 1) {
    const cached = JSON.parse(localStorage.getItem('destinations_page1') || '[]');
    if (cached.length) setDestinations(cached);
  }

  let q = query(collection(db, 'destinations'), orderBy('updatedAt', 'desc'), limit(DEST_PAGE_SIZE));
  if (lastDestDoc) {
    q = query(collection(db, 'destinations'), orderBy('updatedAt', 'desc'), startAfter(lastDestDoc), limit(DEST_PAGE_SIZE));
  }

  getDocs(q).then((snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (destPage === 1) {
      setDestinations(items);
      localStorage.setItem('destinations_page1', JSON.stringify(items));
    } else {
      setDestinations((prev) => [...prev, ...items]);
    }
    setHasMoreDest(items.length === DEST_PAGE_SIZE);
    setLastDestDoc(snap.docs[snap.docs.length - 1]);
  }).finally(() => setLoadingDest(false));
}, [active, destPage]);

// Pagination for Reports
const REPORT_PAGE_SIZE = 20;
const [reportPage, setReportPage] = useState(1);
const [lastReportDoc, setLastReportDoc] = useState(null);
const [hasMoreReports, setHasMoreReports] = useState(true);

useEffect(() => {
  if (active !== 'reports') return;
  setLoadingReports(true);

  if (reportPage === 1) {
    const cached = JSON.parse(localStorage.getItem('reports_page1') || '[]');
    if (cached.length) setReports(cached);
  }

  let q = query(collection(db, 'report'), orderBy('createdAt', 'desc'), limit(REPORT_PAGE_SIZE));
  if (lastReportDoc) {
    q = query(collection(db, 'report'), orderBy('createdAt', 'desc'), startAfter(lastReportDoc), limit(REPORT_PAGE_SIZE));
  }

  getDocs(q).then((snap) => {
    const items = snap.docs.map((doc) => normalizeReportDoc(doc));
    if (reportPage === 1) {
      setReports(items);
      localStorage.setItem('reports_page1', JSON.stringify(items));
    } else {
      setReports((prev) => [...prev, ...items]);
    }
    setHasMoreReports(items.length === REPORT_PAGE_SIZE);
    setLastReportDoc(snap.docs[snap.docs.length - 1]);
  }).finally(() => setLoadingReports(false));
}, [active, reportPage]);

// Pagination for Audit Logs
const LOG_PAGE_SIZE = 50;
const [logPage, setLogPage] = useState(1);
const [lastLogDoc, setLastLogDoc] = useState(null);
const [hasMoreLogs, setHasMoreLogs] = useState(true);
const [logs, setLogs] = useState([]);

useEffect(() => {
  if (active !== 'audit-logs') return;
  setLoading(true);

  if (logPage === 1) {
    const cached = JSON.parse(localStorage.getItem('logs_page1') || '[]');
    if (cached.length) setLogs(cached);
  }

  let q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(LOG_PAGE_SIZE));
  if (lastLogDoc) {
    q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), startAfter(lastLogDoc), limit(LOG_PAGE_SIZE));
  }

  getDocs(q).then((snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (logPage === 1) {
      setLogs(items);
      localStorage.setItem('logs_page1', JSON.stringify(items));
    } else {
      setLogs((prev) => [...prev, ...items]);
    }
    setHasMoreLogs(items.length === LOG_PAGE_SIZE);
    setLastLogDoc(snap.docs[snap.docs.length - 1]);
  }).finally(() => setLoading(false));
}, [active, logPage]);

// Pagination for Users
const USER_PAGE_SIZE = 20;
const [userPage, setUserPage] = useState(1);
const [lastUserDoc, setLastUserDoc] = useState(null);
const [hasMoreUsers, setHasMoreUsers] = useState(true);

useEffect(() => {
  if (active !== 'users') return;
  setLoadingUsers(true);

  if (userPage === 1) {
    const cached = JSON.parse(localStorage.getItem('users_page1') || '[]');
    if (cached.length) setUsers(cached);
  }

  let q = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(USER_PAGE_SIZE));
  if (lastUserDoc) {
    q = query(collection(db, 'users'), orderBy('createdAt', 'desc'), startAfter(lastUserDoc), limit(USER_PAGE_SIZE));
  }

  getDocs(q).then((snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (userPage === 1) {
      setUsers(items);
      localStorage.setItem('users_page1', JSON.stringify(items));
    } else {
      setUsers((prev) => [...prev, ...items]);
    }
    setHasMoreUsers(items.length === USER_PAGE_SIZE);
    setLastUserDoc(snap.docs[snap.docs.length - 1]);
  }).finally(() => setLoadingUsers(false));
}, [active, userPage]);

  return (
    <div className="cms-root">
      <aside className="sidebar">
        <div className="brand">
          <h2>LakbAI</h2>
          <div className="muted">Content Management System</div>
        </div>

        <nav>
          <button className={`sidebar-item ${active === 'dashboard' ? 'active' : ''}`} onClick={() => setActive('dashboard')}>
            <span className="icon">📊</span> <span>Dashboard</span>
          </button>
          <button className={`sidebar-item ${active === 'audit-logs' ? 'active' : ''}`} onClick={() => setActive('audit-logs')}>
            <span className="icon">📜</span> <span>Audit Logs</span>
          </button>
          <button className={`sidebar-item ${active === 'destinations' ? 'active' : ''}`} onClick={() => setActive('destinations')}>
            <span className="icon">🏖️</span> <span>Destinations</span>
          </button>
          <button className={`sidebar-item ${active === 'reports' ? 'active' : ''}`} onClick={() => setActive('reports')}>
            <span className="icon">📝</span> <span>Reports</span>
          </button>
          <button className={`sidebar-item ${active === 'users' ? 'active' : ''}`} onClick={() => setActive('users')}>
            <span className="icon">👥</span> <span>Users</span>
          </button>
          <button className={`sidebar-item ${active === 'images' ? 'active' : ''}`} onClick={() => setActive('images')}>
            <span className="icon">🖼️</span> <span>Images</span>
          </button>
          <button className={`sidebar-item ${active === 'settings' ? 'active' : ''}`} onClick={() => setActive('settings')}>
            <span className="icon">⚙️</span> <span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-footer">
        <div className="muted small">{auth.currentUser?.email || 'Not signed in'}</div>
        <button
          className="btn-danger-signout"
          style={{ marginTop: 8 }}
          onClick={() => {
            console.log('Sign Out clicked');
            setShowSignOutConfirm(true);
          }}
        >
          Sign Out
        </button>

          </div>
          </aside>
          <main className="main-content">
          <div className="page-wrap">
          
          {active === 'dashboard' && (
            <div className="dashboard">
            <header style={{ marginBottom: 18, textAlign: 'left', alignItems: 'flex-start', justifyContent: 'flex-start' }}>
              <h1 className='title' style={{ textAlign: 'left' }}>Dashboard</h1>
              <p className="muted" style={{ textAlign: 'left', marginTop: 4 }}>LakbAI - content management overview</p>
            </header>

            <div className="stats-grid" style={{ marginBottom: 20 }}>
              <div className="stat-card content-card gradient-1" style={{ padding: 20 }}>
                <div style={{ fontWeight: 700, color: '#fff' }}>Total Destinations</div>
                <div className="stat-value" style={{ color: '#fff' }}>
                  {loading
                    ? <span className="loading-spinner" />
                    : Number(analytics.totalDestinations || 0).toLocaleString()}
                </div>
                <div className="muted" style={{ opacity: 0.9 }}>Active travel destinations</div>
              </div>

              <div className="stat-card content-card gradient-2" style={{ padding: 20 }}>
                <div style={{ fontWeight: 700, color: '#fff' }}>Total Users</div>
                <div className="stat-value" style={{ color: '#fff' }}>
                  {loading
                    ? <span className="loading-spinner" />
                    : Number(analytics.totalUsers || 0).toLocaleString()}
                </div>
                <div className="muted" style={{ opacity: 0.9 }}>Registered travelers</div>
              </div>

              <div className="stat-card content-card gradient-3" style={{ padding: 20 }}>
                <div style={{ fontWeight: 700, color: '#fff' }}>Total Reports</div>
                <div className="stat-value" style={{ color: '#fff' }}>
                  {loading
                    ? <span className="loading-spinner" />
                    : analytics.totalArticles}
                </div>
                <div className="muted" style={{ opacity: 0.9 }}>Reported Contents</div>
              </div>

              <div className="stat-card content-card gradient-4" style={{ padding: 20 }}>
                <div style={{ fontWeight: 700, color: '#fff' }}>Total Images</div>
                <div className="stat-value" style={{ color: '#fff', minHeight: 38 }}>
                  {loading
                    ? <span className="loading-spinner" />
                    : totalImages}
                </div>
                <div className="muted" style={{ opacity: 0.9 }}>Available Images</div>
              </div>

              </div>
              <div style={{ marginTop: 8 }}>
                <AuditLogsCMS useFirestore={true} pageSize={50} />
              </div>
            </div>
          )}
          </div>

          {active === 'audit-logs' && (
              <div className="content-section">
              <AuditLogsCMS useFirestore={true} pageSize={200} />
            </div>
          )}
          
          {active === 'destinations' && (
            <div className="content-section">
              <div className="section-header" style={{ alignItems: 'flex-start' }}>
                <div>
                  <h2 className="title">Destinations</h2>
                  <p className="muted">Manage destinations content</p>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {/* NEW: Add from CSV button (left of Add New destination) */}
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ padding: '8px 18px', borderRadius: 8 }}
                          onClick={handlePublishAll}
                        >
                          Publish All
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => setAddCsvOpen(true)}
                          style={{ padding: '10px 16px', borderRadius: 12, background: '#e0f2fe', color: '#0369a1', fontWeight: 700 }}
                        >
                          + Add from CSV
                        </button>

                        <button className="btn-primary-cms" onClick={openCreate} style={{ padding: '10px 16px', borderRadius: 12 }}>
                            + Add New destination
                        </button>
                        {hasMoreDest && (
                          <button className="btn-secondary" onClick={() => setDestPage(destPage + 1)}>
                            Load More
                          </button>
                        )}
                    </div>
                </div>

                {/* Destination modal */}
                {showForm && (
                  <div
                    role="dialog"
                    aria-modal="true"
                    style={{
                      position: 'fixed',
                      inset: 0,
                      background: 'rgba(0,0,0,0.55)',
                      zIndex: 1000,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    onClick={(e) => { if (e.target === e.currentTarget) closeForm(); }}
                  >
                    <div
                      style={{
                        width: 'min(980px, 98vw)',
                        background: '#fff',
                        borderRadius: 16,
                        boxShadow: '0 20px 60px rgba(0,0,0,.25)',
                        maxHeight: '92vh',
                        overflow: 'auto',
                        padding: 20
                      }}
                    >
                      <DestinationForm
                        initial={editing}
                        onCancel={closeForm}
                        onSave={handleSaveDestination}
                        // Pass current destination names (excluding the record being edited)
                        existingNames={(destinations || [])
                          .filter((d) => d?.id !== (editing?.id || null))
                          .map((d) => ((d?.name || '').trim().toLowerCase()))
                          .filter(Boolean)}
                        ignoreId={editing?.id || null}
                      />
                    </div>
                  </div>
                )}

                <div className="filters content-card" style={{ display: 'flex', gap: 12, padding: 16, alignItems: 'center', marginBottom: 18 }}>
                    <div className="content-reports-filters">
                    <div className="search-bar" style={{ position: 'relative', flex: 1, border: 'none' }}>
                    <span className="search-icon">🔎</span>
                    <input
                        className="form-input"
                        style={{ width: '100%', paddingLeft: 40 }}
                        placeholder="Search content..."
                        value={searchDest}
                        onChange={(e) => setSearchDest(e.target.value)}
                    />
                    </div>

                    <select className="form-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 160 }}>
                    <option value="">All Status</option>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                    </select>

                    <select className="form-input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ width: 200 }}>
                    <option value="">All Categories</option>
                    <option>Beach</option>
                    <option>Mountain</option>
                    <option>Tourist</option>
                    <option>Waterfalls</option>
                    <option>Historical</option>
                    <option>Parks</option>
                    <option>Museums</option>
                    <option>Natural</option>
                    <option>Landmarks</option>
                    <option>Cultural</option>
                    <option>Caves</option>
                    <option>Islands</option>
                    <option>Lakes</option>
                    <option>Heritage</option>
                    </select>
                    
                    </div>
                </div>
                

                <div className="content-card" style={{ padding: 40, borderRadius: 12, minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                    {loadingDest ? (
                        <div className="centered"><div className="loading-spinner" /></div>
                    ) : destinations.length === 0 ? (
                        <NotFoundCMS text="Destination not found" />
                    ) : filteredDestinations.length === 0 ? (
                        <NotFoundCMS text="Destination not found" />
                    ) : (
                        <div style={{ width: '100%' }}>
                            <table style={{
                                width: '100%',
                                borderCollapse: 'separate',
                                borderSpacing: 0,
                                background: 'transparent',
                                fontSize: 15,
                                color: '#222',
                                borderRadius: 12,
                                overflow: 'hidden',
                                boxShadow: 'none'
                            }}>
                              
                                <thead>
                                    <tr style={{ background: '#f6f8fa', color: '#6b7280', fontWeight: 600, gap: 15 }}>
                                        <th style={{ padding: '14px 16px', textAlign: 'left', borderTopLeftRadius: 12 }}>Title</th>
                                        <th className="category-col" style={{ padding: '14px 16px', textAlign: 'center' }}>Category</th>
                                        <th style={{ padding: '14px 16px 14px 1px', textAlign: 'center', width: '140px' }}>Status</th>
                                        <th className="updated-col" style={{ padding: '14px 16px', textAlign: 'center'}}>Updated</th>
                                        <th style={{ padding: '14px 16px', textAlign: 'center', borderTopRightRadius: 12}}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredDestinations.map((d, i) => (
                                        <tr key={d.id || i} style={{
                                            background: i % 2 === 0 ? '#fff' : '#f9fafb',
                                            borderBottom: '1px solid #f1f5f9'
                                        }}>
                                            <td style={{ padding: '14px 16px', verticalAlign: 'top', minWidth: 120 }}>
                                                <div style={{ fontWeight: 600 }}>{d.name}</div>
                                                <div style={{ color: '#6b7280', fontSize: 13 }}>{d.description}</div>
                                            </td>
                                            <td className="category-col" style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                                                <span style={{
                                                    background: '#e0f2fe',
                                                    color: '#2563eb',
                                                    fontWeight: 600,
                                                    fontSize: 13,
                                                    padding: '4px 14px',
                                                    borderRadius: 8,
                                                    display: 'inline-block'
                                                }}>
                                                    {d.category || 'Adventure'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                                                <span style={{
                                                    background: '#fef3c7',
                                                    color: '#b45309',
                                                    fontWeight: 600,
                                                    fontSize: 13,
                                                    padding: '4px 14px',
                                                    borderRadius: 8,
                                                    display: 'inline-block'
                                                }}>
                                                    {(d.status || 'draft').toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="updated-col" style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                                              {d.updatedAt?.toDate
                                                ? d.updatedAt.toDate().toLocaleDateString()
                                                : d.updatedAt instanceof Date
                                                  ? d.updatedAt.toLocaleDateString()
                                                  : typeof d.updatedAt === 'string'
                                                    ? (() => {
                                                        const dt = new Date(d.updatedAt);
                                                        return isNaN(dt) ? 'Invalid Date' : dt.toLocaleDateString();
                                                      })()
                                                    : '—'
                                              }
                                            </td>
                                            <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                                              <div style={{ display: 'flex', gap: 12 }}>
                                                <button
                                                    className="btn-primary-cms-edit"
                                                    style={{
                                                        background: '#dcfce7',      // same as Users "Edit"
                                                        color: '#166534',
                                                        border: 'none',
                                                        padding: '6px 18px',
                                                        borderRadius: 8,
                                                        fontWeight: 700,
                                                        fontSize: 14,
                                                        boxShadow: 'none'
                                                    }}
                                                    onClick={() => {
                                                        setEditing(d);
                                                        setShowForm(true);
                                                    }}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    className="btn-danger"
                                                    style={{
                                                        background: '#fee2e2',     // same as Users "Delete"
                                                        color: '#b91c1c',
                                                        border: 'none',
                                                        padding: '6px 18px',
                                                        borderRadius: 8,
                                                        fontWeight: 700,
                                                        fontSize: 14,
                                                        boxShadow: 'none'
                                                    }}
                                                    onClick={() => {
                                                        setDeleteTarget(d);
                                                        setDeleteConfirmOpen(true);
                                                    }}
                                                >
                                                    Delete
                                                </button>
                                              </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
          
        )}
        {active === 'reports' && (
          <div className="content-section">
            <div className="section-header" style={{ alignItems: 'center' }}>
              <div>
                <h2 className="title" style={{ margin: 0 }}>Content Reports</h2>
                <p className="muted" style={{ marginTop: 4 }}>Review and moderate reported community content</p>
              </div>

              <div className="muted small" style={{ marginLeft: 'auto' }}>{filteredReports.length} reports</div>
              {hasMoreReports && (
                <button className="btn-secondary" onClick={() => setReportPage(reportPage + 1)}>
                  Load More
                </button>
              )}
            </div>
              
            {/* Filters row */}
            <div className="content-card" style={{ padding: 16, borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <div className="content-reports-filters">
                <div style={{ position: 'relative', flex: 1}}>
                  <span className="search-icon" style={{ position: 'absolute', left: 14, top: 22, opacity: 0.6 }}>🔎</span>
                  <input
                    className="form-input"
                    style={{ width: '100%', paddingLeft: 40 }}
                    placeholder="Search reports..."
                    value={reportSearch}
                    onChange={(e) => setReportSearch(e.target.value)}
                  />
                </div>

                <select className="form-input" value={reportStatus} onChange={(e) => setReportStatus(e.target.value)} style={{ width: 160 }}>
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="under_review">Under Review</option>
                  <option value="resolved">Resolved</option>
                  <option value="escalated">Escalated</option>
                </select>

                <select className="form-input" value={reportPriority} onChange={(e) => setReportPriority(e.target.value)} style={{ width: 160 }}>
                  <option value="all">All Priority</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>

                <select className="form-input" value={reportType} onChange={(e) => setReportType(e.target.value)} style={{ width: 160 }}>
                  <option value="all">All Types</option>
                  <option value="Post">Post</option>
                  <option value="Comment">Comment</option>
                  <option value="Review">Review</option>
                  <option value="Message">Message</option>
                </select>
              </div>
            </div>

            {/* Table */}
 <div className="content-card reports-table-responsive" style={{ padding: 0, borderRadius: 12, overflow: 'hidden' }}>
  {/* Header */}
  <div className="reports-table-header">
    {['Report Details', 'Reported User', 'Content Type', 'Reason', 'Priority', 'Status', 'Reported Date', 'Actions'].map((h) => (
      <div key={h} className="reports-table-cell" style={{ fontWeight: 700, color: '#6b7280', background: '#f6f8fa', fontSize: 14, borderBottom: '1px solid #eef2f7' }}>
        {h}
      </div>
    ))}
  </div>
  {loadingReports ? (
    <div className="centered" style={{ padding: 40 }}><div className="loading-spinner" /></div>
  ) : filteredReports.length === 0 ? (
    <div className="muted" style={{ padding: 24 }}>No reports found</div>
  ) : (
    filteredReports.map((r, i) => (
      <div
        key={r.id || i}
        className="reports-table-row"
        style={{
          background: i % 2 ? '#fff' : '#fafbfc',
          borderBottom: '1px solid #eef2f7'
        }}
      >
        {/* Report Details */}
        <div className="reports-table-cell" data-label="Report Details">
                   <div style={{ fontWeight: 700 }}>{r.title}</div>
          <div className="muted small">By: {r.reporterName || (r.reporterId ? userNameCache[r.reporterId] : '') || '—'}</div>
        </div>
        {/* Reported User */}
        <div className="reports-table-cell" data-label="Reported User">
          {(() => {
            const ruId = typeof r.reportedUser === 'string'
              ? r.reportedUser
              : r?.reportedUser?.id || '';
            const ruName = (typeof r.reportedUserName === 'object' && r.reportedUserName?.name)
              ? r.reportedUserName.name
              : (ruId ? userNameCache[ruId] : null) || '—';
            const initial = (ruName || 'U').trim().charAt(0).toUpperCase();
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600 }}>
                  {initial}
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{ruName}</div>
                  <div className="muted small">ID: {ruId || '—'}</div>
                </div>
              </div>
            );
          })()}
        </div>
        {/* Content Type */}
        <div className="reports-table-cell" data-label="Content Type">{r.contentType}</div>
        {/* Reason */}
        <div className="reports-table-cell" data-label="Reason">{r.reason}</div>
        {/* Priority */}
        <div className="reports-table-cell" data-label="Priority"><PriorityBadge v={r.priority} /></div>
        {/* Status */}
        <div className="reports-table-cell" data-label="Status"><StatusBadge v={r.status} /></div>
        {/* Date */}
        <div className="reports-table-cell" data-label="Reported Date">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''}</div>
        {/* Actions */}
        <div className="reports-table-cell" data-label="Actions" style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-view"
            style={{ background: '#e0e7ff', color: '#2563eb', border: 'none', padding: '6px 18px', borderRadius: 8, fontWeight: 700, fontSize: 14 }}
            onClick={() => { setViewReport(r); setViewReportId(r.id); }}
          >
            View
          </button>
          <button
            className="btn-secondary"
            style={{ background: '#fee2e2', color: '#b91c1c', border: 'none', padding: '6px 18px', borderRadius: 8, fontWeight: 700, fontSize: 14 }}
            onClick={() => openActionModal(r)}
          >
            Action
          </button>
        </div>
      </div>
    ))
  )}
</div>

            {/* View modal */}
            {viewReport && (
              <ReportDetailModal
                report={viewReport}
                onClose={() => { setViewReport(null); setViewReportId(null); }}
                onTakeAction={(r) => { setViewReport(null); setViewReportId(null); openActionModal(r); }}
              />
            )}
          </div>
        )}

        {/* NEW: Take Action modal mount */}
        {actionOpen && actionReport && (
          <TakeActionModal
            report={actionReport}
            onClose={() => { if (!actionSubmitting) { setActionOpen(false); setActionReport(null); } }}
          />
        )}

        {active === 'users' && (
          <div className="content-section">
            <div className="section-header" style={{ alignItems: 'center' }}>
              <div>
                <h2 className="title" style={{ margin: 0 }}>User Management</h2>
                <p className="muted" style={{ marginTop: 4 }}>Manage traveler accounts and profiles</p>
              </div>
              <button
                className="btn-primary-cms"
                style={{ padding: '10px 16px', borderRadius: 12, background: 'linear-gradient(90deg,#2563eb,#3b82f6)' }}
                onClick={() => setAddUserOpen(true)}   // CHANGED: open modal
              >
                + Add New User
              </button>
              {hasMoreUsers && (
                <button className="btn-secondary" onClick={() => setUserPage(userPage + 1)}>
                  Load More
                </button>
              )}
            </div>

            {/* Search + Status filter row */}
            <div className="content-card" style={{ padding: 16, borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span className="search-icon" style={{ position: 'absolute', left: 14, top: 22, opacity: 0.6 }}>🔎</span>
                <input
                  className="form-input"
                  style={{ width: '100%', paddingLeft: 40 }}
                  placeholder="Search users by name or email..."
                  value={searchUser}
                  onChange={(e) => setSearchUser(e.target.value)}
                />
              </div>
              <select
                className="form-input"
                value={userStatusFilter}
                onChange={(e) => setUserStatusFilter(e.target.value)}
                style={{ width: 160 }}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="banned">Banned</option>
              </select>
            </div>

            <div className="content-card" style={{ padding: 0, borderRadius: 12, overflow: 'hidden' }}>
              {/* Define a consistent 6-column grid (User, Email, Provider, Status, Join Date, Actions) */}
              {(() => {
                const userGridCols = '2.6fr 2fr 1.2fr 1.2fr 1.4fr 1.6fr';

                // Table header
                const header = (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: userGridCols,
                      gap: 0,
                      background: '#f6f8fa',
                      color: '#6b7280',
                      fontWeight: 700,
                      fontSize: 14,
                      justifyItems: 'start',
                      textAlign: 'left'
                    }}
                  >
                    {['User', 'Email', 'Provider', 'Status', 'Join Date', 'Actions'].map((h) => (
                      <div key={h} style={{ padding: '14px 16px', borderBottom: '1px solid #eef2f7' }}>
                        {h}
                      </div>
                    ))}
                  </div>
                );

                if (loadingUsers) {
                  return (
                    <>
                      {header}
                      <div className="centered" style={{ padding: 40 }}>
                        <div className="loading-spinner" />
                      </div>
                    </>
                  );
                }

                const q = searchUser.trim().toLowerCase();
                const filtered = (users || []).filter((u) => {
                  if (!u) return false; // guard against null entries
                  const okQ =
                    !q || ((u.travelerName || u.name || '') + ' ' + (u.email || '')).toLowerCase().includes(q);
                  const s = (u.status || 'active').toLowerCase();
                  const okS = userStatusFilter === 'all' || userStatusFilter === '' || s === userStatusFilter;
                  return okQ && okS;
                });

                if (!filtered.length) {
                  return (
                    <>
                      {header}
                      <div className="muted" style={{ padding: 24 }}>
                        No users found
                      </div>
                    </>
                  );
                }

                const rowStyle = {
                  display: 'grid',
                  gridTemplateColumns: userGridCols,
                  alignItems: 'center',
                  justifyItems: 'start',
                  textAlign: 'left'
                };

                return (
                  <>
                    {header}
                    {filtered.map((u, i) => {
                      const name = u.travelerName || u.name || 'Unnamed';
                      const initial = name.charAt(0).toUpperCase();
                      const provider = u.provider || u.providerId || 'Email';
                      const status = (u.status || 'ACTIVE').toUpperCase();
                      const createdAt = u.createdAt?.toDate
                        ? u.createdAt.toDate()
                        : u.createdAt
                        ? new Date(u.createdAt)
                        : null;
                      const joinDate = createdAt ? createdAt.toLocaleDateString() : '';
                      const pUrl =
                        u.profilePictureUrl ||
                        u.photoURL ||
                        u.photoUrl ||
                        u.avatarUrl ||
                        u.avatar ||
                        u.photo;
                      const pid = getCloudinaryPublicId(pUrl);

                      return (
                        <div
                          key={u.id || i}
                          style={{
                            ...rowStyle,
                            background: i % 2 ? '#fff' : '#fafbfc',
                            borderBottom: '1px solid #eef2f7'
                          }}
                        >
                          {/* User */}
                          <div
                            style={{
                              padding: '14px 16px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12
                            }}
                          >
                            {pid ? (
                              <CloudinaryContext cloudName={CLOUDINARY_CLOUD_NAME}>
                                <Image
                                  publicId={pid}
                                  width="36"
                                  height="36"
                                  crop="fill"
                                  gravity="face"
                                  radius="max"
                                  alt=""
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: '50%',
                                    objectFit: 'cover'
                                  }}
                                />
                              </CloudinaryContext>
                            ) : pUrl ? (
                              <img
                                src={pUrl}
                                alt=""
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: '50%',
                                  objectFit: 'cover'
                                }}
                              />
                            ) : (
                              <div style={{
                                width: 36, height: 36, borderRadius: '50%',
                                background: '#6366f1', color: '#fff',
                                display: 'grid', placeItems: 'center',
                                fontWeight: 700, fontSize: 16
                              }}>
                                {initial} {/* use current row's initial, not userProfile */}
                              </div>
                            )}
                            <div>
                              <div style={{ fontWeight: 700 }}>{name}</div>
                              <div className="muted small">ID: {u.id}</div>
                            </div>
                          </div>

                          {/* Email */}
                          <div style={{ padding: '14px 16px' }}>{u.email || '—'}</div>

                          {/* Provider */}
                          <div style={{ padding: '14px 16px' }}>{provider}</div>

                          {/* Status */}
                          <div style={{ padding: '14px 16px' }}>
                            <span
                              style={{
                                background: '#dcfce7',
                                color: '#166534',
                                borderRadius: 999,
                                padding: '4px 10px',
                                fontWeight: 700,
                                fontSize: 12
                              }}
                            >
                              {status}
                            </span>
                          </div>

                          {/* Join Date */}
                          <div style={{ padding: '14px 16px' }}>{joinDate}</div>

                          {/* Actions */}
                          <div
                            style={{
                              padding: '14px 16px',
                              display: 'flex',
                              gap: 8,
                              justifyContent: 'flex-start'
                            }}
                          >
                            <button
                              className="btn-view"
                              style={{
                                background: '#e0e7ff',
                                color: '#2563eb',
                                border: 'none',
                                padding: '6px 18px',
                                borderRadius: 8,
                                fontWeight: 700,
                                fontSize: 14
                              }}
                              onClick={() => openUserProfile(u)}
                            >
                              View
                            </button>

                            <button
                              className="btn-primary-cms"
                              style={{
                                background: '#dcfce7',
                                color: '#166534',
                                border: 'none',
                                padding: '6px 18px',
                                borderRadius: 8,
                                fontWeight: 700,
                                marginRight: 8,
                                fontSize: 14,
                                boxShadow: 'none'
                              }}
                              onClick={() => openEditUserModal(u, 'basic')}
                            >
                              Edit
                            </button>

                            <button
                              className="btn-danger"
                              style={{
                                background: '#fee2e2',
                                color: '#b91c1c',
                                border: 'none',
                                padding: '6px 18px',
                                borderRadius: 8,
                                fontWeight: 700,
                                fontSize: 14,
                                boxShadow: 'none'
                              }}
                              onClick={() => {
                                setDeleteUserTarget(u);
                                setDeleteUserConfirmOpen(true);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>
        )} {/* end users tab */}

        {/* images tab - placeholder for now */}
        {active === 'images' && <ImagesCMS />}
      {showSignOutConfirm && (
          <div className="modal-overlay signout-modal" onClick={e => { if (e.target === e.currentTarget) setShowSignOutConfirm(false); }}>
            <div className="modal-box signout-modal-content">
              <div className="modal-header">
                <span className="modal-title">Confirm Sign Out</span>
                <button className="modal-close" onClick={() => setShowSignOutConfirm(false)}>&times;</button>
              </div>
              <div className="modal-body">
                <div style={{ textAlign: 'center', marginBottom: 18 }}>
                  <img src="/warning%20(1).png" alt="Warning" style={{ width: 48, marginBottom: 12, animation: "shake 0.5s" }} />
                  <h3 style={{ margin: 0, fontWeight: 600 }}>Are you sure you want to sign out?</h3>
                  <div className="muted" style={{ marginTop: 8 }}>You will be redirected to the admin login page.</div>
                </div>
                <div className="form-actions" style={{ justifyContent: 'center', marginTop: 18 }}>
                  <button
                    className="btn-danger"
                    style={{ minWidth: 120, fontWeight: 700, fontSize: 15 }}
                    onClick={async () => {
                      console.log('Yes, Sign Out');
                      setShowSignOutConfirm(false);
                      try {
                        await signOut(auth);
                        console.log('Sign out successful');
                        window.location.href = "/admin/login";
                      } catch (err) {
                        console.error('Sign out failed:', err);
                        alert('Sign out failed: ' + err.message);
                      }
                    }}
                  >
                    Yes, Sign Out
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ minWidth: 120, fontWeight: 700, fontSize: 15 }}
                    onClick={() => setShowSignOutConfirm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

  {deleteConfirmOpen && deleteTarget && (
  <div
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.45)',
      zIndex: 2000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}
    onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirmOpen(false); }}
  >
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        padding: 32,
        minWidth: 340,
        maxWidth: '90vw',
        textAlign: 'center'
      }}
    >
      <h3 style={{ marginBottom: 16 }}>Delete Destination</h3>
      <div style={{ marginBottom: 18 }}>
        Are you sure you want to delete <b>{deleteTarget.name}</b>?
      </div>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
        <button
          className="btn-danger"
          style={{ padding: '8px 22px', borderRadius: 8, fontWeight: 700 }}
          onClick={async () => {
            // Delete from Firestore
            try {
              await import('firebase/firestore').then(({ deleteDoc, doc }) =>
                deleteDoc(doc(db, 'destinations', deleteTarget.id))
              );
            } catch (err) {
              console.error('Firestore delete failed:', err);
            }
            // Delete featured image from Cloudinary
            const featuredId = getCloudinaryPublicId(deleteTarget.media?.featuredImage);
            if (featuredId) await deleteCloudinaryImage(featuredId);

            // Delete gallery images from Cloudinary
            if (Array.isArray(deleteTarget.media?.gallery)) {
              for (const img of deleteTarget.media.gallery) {
                const imgId = getCloudinaryPublicId(img);
                if (imgId) await deleteCloudinaryImage(imgId);
              }
            }
            // Remove from local state
            setDestinations((s) => s.filter((x) => x.id !== deleteTarget.id));
            // Remove from localStorage fallback
            const stored = JSON.parse(localStorage.getItem('destinations') || '[]');
            localStorage.setItem('destinations', JSON.stringify(stored.filter((x) => x.id !== deleteTarget.id)));
            // set analytics state
            setAnalytics((a) => ({ ...a, totalDestinations: Math.max(0, (a.totalDestinations || 1) - 1) }));
            setDeleteConfirmOpen(false);
            setDeleteTarget(null);
          }}
        >
          Yes
        </button>
        <button
          className="btn-secondary"
          style={{ padding: '8px 22px', borderRadius: 8, fontWeight: 700 }}
          onClick={() => {
            setDeleteConfirmOpen(false);
            setDeleteTarget(null);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
)}
{deleteUserConfirmOpen && deleteUserTarget && (
  <div
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.45)',
      zIndex: 2000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}
    onClick={(e) => { if (e.target === e.currentTarget) setDeleteUserConfirmOpen(false); }}
  >
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        padding: 32,
        minWidth: 340,
        maxWidth: '90vw',
        textAlign: 'center'
      }}
    >
      <h3 style={{ marginBottom: 16 }}>Delete User</h3>
      <div style={{ marginBottom: 18 }}>
        Are you sure you want to delete <b>{deleteUserTarget.travelerName || deleteUserTarget.name || 'this user'}</b>?
      </div>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
        <button
          className="btn-danger"
          style={{ padding: '8px 22px', borderRadius: 8, fontWeight: 700 }}
          onClick={async () => {
            // Delete user from Firestore
            try {
              await deleteDoc(doc(db, 'users', deleteUserTarget.id));
            } catch (err) {
              console.error('Firestore user delete failed:', err);
            }
            // Remove from local state
            setUsers((s) => s.filter((x) => x.id !== deleteUserTarget.id));
            // Remove from localStorage fallback
            const stored = JSON.parse(localStorage.getItem('users') || '[]');
            localStorage.setItem('users', JSON.stringify(stored.filter((x) => x.id !== deleteUserTarget.id)));
            setDeleteUserConfirmOpen(false);
            setDeleteUserTarget(null);
          }}
        >
          Yes
        </button>
        <button
          className="btn-secondary"
          style={{ padding: '8px 22px', borderRadius: 8, fontWeight: 700 }}
          onClick={() => {
            setDeleteUserConfirmOpen(false);
            setDeleteUserTarget(null);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
)}
    {/* Modals mounted at the root to avoid nesting/adjacent JSX issues */}
    <EditProfileCMS
      open={userEditOpen}
      user={editingUser}
      initialTab={userEditTab || 'basic'}
      onClose={() => { setUserEditOpen(false); setEditingUser(null); }}
      onSave={handleSaveUser}
    />
    <ViewProfileCMS
      open={userProfileOpen}
      user={userProfile}
      onClose={closeUserProfile}
      onEdit={(tab) => openEditUserModal(userProfile, tab || 'basic')}
      stats={userStats}
    />
    <AddUserCMS
      open={addUserOpen}
      onClose={() => setAddUserOpen(false)}
      onSave={handleAddUserSave}
    />
    <AddFromCsvCMS
      open={addCsvOpen}
      onClose={() => setAddCsvOpen(false)}
      onImported={(saved) => {
        if (!Array.isArray(saved) || saved.length === 0) return;
        // Add newly created docs to local state for instant UI
        setDestinations((prev) => [...prev, ...saved]);
        // Bump dashboard counter
        setAnalytics((a) => ({ ...a, totalDestinations: (a.totalDestinations || 0) + saved.length }));
      }}
    />
  </div>
  );
}
export default ContentManagement;