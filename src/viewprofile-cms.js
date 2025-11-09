import React, { useEffect, useMemo, useState } from 'react';
import { collectionGroup, getDocs, query, where, orderBy, limit, getDoc, doc, collection } from 'firebase/firestore';
import { db } from './firebase';
import { CloudinaryContext, Image } from './cloudinary';
import { useUserDashboardStats } from './dashboard-stats-row';
import { getUserStats, listenUserStats } from './user-stats-cms';

// Cloudinary (same defaults as elsewhere)
const CLOUDINARY_CLOUD_NAME = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME || 'dxvewejox';

// Helpers
const toDateSafe = (v) => (v?.toDate ? v.toDate() : (v ? new Date(v) : null));
const fmtDate = (v) => { const d = toDateSafe(v); return d ? d.toLocaleDateString() : '—'; };
const fmtDateTime = (v) => { const d = toDateSafe(v); return d ? d.toLocaleString() : '—'; };

function getCloudinaryPublicId(url) {
  if (!url || typeof url !== 'string') return null;
  const parts = url.split('/upload/');
  if (parts.length < 2) return null;
  let publicId = parts[1].split('?')[0];
  publicId = publicId.replace(/\.[^/.]+$/, '');
  return publicId;
}

// Optional: delete via your backend endpoints (safe no-op if none available)
async function deleteCloudinaryImage(publicId) {
  if (!publicId) return;
  const base = window.location.origin;
  const endpoints = [`${base}/admin/api/cloudinary/delete`, `${base}/api/cloudinary/delete`];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ publicId })
      });
      if (res.ok) return;
    } catch {}
  }
}

export default function ViewProfileCMS({
  open = false,
  user = null,
  onClose,
  onEdit,
  // optional stats map or object; if map passed, we’ll pick by user.id
  stats,
}) {
  const [tab, setTab] = useState('overview');
  const uid = user?.id || user?.uid || user?.userId || null;

  const { stats: dashboardStats } = useUserDashboardStats(uid);

  // Local state for Activity + Photos
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [userActivity, setUserActivity] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [userPhotos, setUserPhotos] = useState([]);
  const [likes, setLikes] = useState(null); // interests from Firestore
  const [bio, setBio] = useState(null);     // NEW: bio from Firestore
  const [likesLoading, setLikesLoading] = useState(false); // NEW: loading for interests

  // Add missing state variables
  const [userEditOpen, setUserEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userEditTab, setUserEditTab] = useState('overview');
  const [achievements, setAchievements] = useState([]);
  const [achievementsLoading, setAchievementsLoading] = useState(false);
  const [userTrips, setUserTrips] = useState([]);
  const [userTripsLoading, setUserTripsLoading] = useState(false);
  const [userStats, setUserStats] = useState({
    placesOnTrips: 0,
    photosShared: 0,
    ratedDestinations: 0,
    friends: 0,
  });

  useEffect(() => { if (open) setTab('overview'); }, [open]);

  // Load Photos from collectionGroup('photos') where userId == uid
  useEffect(() => {
    let alive = true;
    if (!open || !uid) return;
    (async () => {
      try {
        setLoadingPhotos(true);
        const qref = query(
          collectionGroup(db, 'photos'),
          where('userId', '==', uid),
          orderBy('timestamp', 'desc')
        );
        const snap = await getDocs(qref).catch(async () => {
          // Fallback if no index: just un-ordered
          return await getDocs(query(collectionGroup(db, 'photos'), where('userId', '==', uid)));
        });
        const list = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          if (data?.url) list.push(data.url);
        });
        if (alive) setUserPhotos(list);
      } catch {
        if (alive) setUserPhotos([]);
      } finally {
        if (alive) setLoadingPhotos(false);
      }
    })();
    return () => { alive = false; };
  }, [open, uid]);

  // Load Activity from subcollections: photos, comments, activities
  useEffect(() => {
    let alive = true;
    if (!open || !uid) return;
    (async () => {
      try {
        setLoadingActivity(true);

        const [pSnap, cSnap, aSnap] = await Promise.all([
          getDocs(query(collectionGroup(db, 'photos'), where('userId', '==', uid), orderBy('timestamp', 'desc'), limit(30))).catch(() =>
            getDocs(query(collectionGroup(db, 'photos'), where('userId', '==', uid)))
          ),
          getDocs(query(collectionGroup(db, 'comments'), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(30))).catch(() =>
            getDocs(query(collectionGroup(db, 'comments'), where('userId', '==', uid)))
          ),
          getDocs(query(collectionGroup(db, 'activities'), where('userId', '==', uid), orderBy('timestamp', 'desc'), limit(30))).catch(() =>
            getDocs(query(collectionGroup(db, 'activities'), where('userId', '==', uid)))
          ),
        ]);

        const items = [];

        pSnap.forEach((doc) => {
          const d = doc.data() || {};
          items.push({
            type: 'photo',
            title: 'Shared a photo',
            description: d.caption || d.title || d.description || '',
            createdAt: d.timestamp || d.createdAt || d.date || null,
            status: 'completed'
          });
        });
        cSnap.forEach((doc) => {
          const d = doc.data() || {};
          items.push({
            type: 'comment',
            title: 'Left a comment',
            description: d.text || d.body || d.comment || d.message || '',
            createdAt: d.createdAt || d.timestamp || d.date || null,
            status: 'completed'
          });
        });
        aSnap.forEach((doc) => {
          const d = doc.data() || {};
          const t = String(d.type || d.activityType || '').toLowerCase();
          const title =
            d.title || d.text || d.message ||
            (t.includes('visit') ? 'Visited a place' :
              t.includes('friend') ? 'Connected with a friend' :
              t.includes('upload') || t.includes('photo') ? 'Uploaded a photo' : 'New activity');
        items.push({
          type: t || 'activity',
          title,
          description: d.description || '',
          createdAt: d.timestamp || d.createdAt || d.date || null,
          status: 'completed'
        });
        });

        // newest first
        items.sort((a, b) => (toDateSafe(b.createdAt)?.getTime?.() || 0) - (toDateSafe(a.createdAt)?.getTime?.() || 0));
        if (alive) setUserActivity(items.slice(0, 30));
      } catch {
        if (alive) setUserActivity([]);
      } finally {
        if (alive) setLoadingActivity(false);
      }
    })();
    return () => { alive = false; };
  }, [open, uid]);

  // Load Travel Interests from Firestore: users/{uid}.likes
  useEffect(() => {
    let alive = true;
    if (!open) return;
    const uid = user?.id || user?.uid || user?.userId;
    if (!uid) return;

    (async () => {
      try {
        setLikesLoading(true); // NEW
        const ref = doc(db, 'users', uid);
        const snap = await getDoc(ref);
        if (!alive) return;
        if (snap.exists()) {
          const data = snap.data() || {};
          // supports likes as array or object map { interest: true }
          let arr = [];
          if (Array.isArray(data.likes)) {
            arr = data.likes;
          } else if (data.likes && typeof data.likes === 'object') {
            arr = Object.entries(data.likes)
              .filter(([, v]) => !!v)
              .map(([k]) => k);
          }
          setLikes(Array.isArray(arr) ? arr : null);
        } else {
          setLikes(null);
        }
      } catch {
        setLikes(null);
      } finally {
        setLikesLoading(false); // NEW
      }
    })();

    return () => { alive = false; };
  }, [open, user]);

  // NEW: Load Bio from Firestore: users/{uid}.bio
  useEffect(() => {
    let alive = true;
    if (!open) return;
    const uid = user?.id || user?.uid || user?.userId;
    if (!uid) return;

    (async () => {
      try {
        const ref = doc(db, 'users', uid);
        const snap = await getDoc(ref);
        if (!alive) return;
        const data = snap.exists() ? (snap.data() || {}) : {};
        const fbBio = typeof data.bio === 'string' ? data.bio : null;
        setBio(fbBio);
      } catch {
        setBio(null);
      }
    })();

    return () => { alive = false; };
  }, [open, user]);

  // ...after other effects; load achievements when modal opens...
  useEffect(() => {
    let alive = true;
    if (!open || !uid) return;
    (async () => {
      try {
        setAchievementsLoading(true);
        const list = await loadUserAchievementsFromFirebase(uid);
        if (alive) setAchievements(Array.isArray(list) ? list : []);
      } catch {
        if (alive) setAchievements([]);
      } finally {
        if (alive) setAchievementsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, uid]);

  // Load Trips from Firestore: itinerary/{uid}/items
  useEffect(() => {
    let alive = true;
    if (!open || !uid) return;
    (async () => {
      try {
        setUserTripsLoading(true);
        const snap = await getDocs(collection(db, 'itinerary', uid, 'items'));
        const list = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          const name = data.name || data.display_name || data.title || d.id;
          const region = data.region || data.country || data.location || '';
          if (name) list.push({ id: d.id, name, region });
        });
        if (alive) setUserTrips(list);
      } catch {
        if (alive) setUserTrips([]);
      } finally {
        if (alive) setUserTripsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, uid]);

  // NEW: Load User Stats from backend
  useEffect(() => {
    let unsubscribe;
    const userId = user?.id || user?.uid || user?.userId;
    if (open && userId) {
      unsubscribe = listenUserStats(userId, setUserStats);
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [open, user]);

  const resolvedStats = useMemo(() => {
    if (!stats) return { places: 0, photos: 0, reviews: 0, friends: 0 };
    // allow either map-by-user or direct object
    if (stats && (stats.places !== undefined || stats.photos !== undefined)) return stats;
    if (user?.id && stats[user.id]) return stats[user.id];
    return { places: 0, photos: 0, reviews: 0, friends: 0 };
  }, [stats, user]);

  // Resolve interests to show: likes from Firestore first, then user.interests
  const travelInterests = useMemo(() => {
    const base =
      (Array.isArray(likes) && likes.length > 0 && likes) ||
      (Array.isArray(user?.interests) && user.interests) ||
      [];
    return base
      .filter(Boolean)
      .map((x) => (typeof x === 'string' ? x : x?.name || x?.title || String(x)));
  }, [likes, user]);

  const tripChips = useMemo(() => {
    if (Array.isArray(userTrips) && userTrips.length > 0) {
      return userTrips.map((t) => t.name).filter(Boolean);
    }
    // Fallback to any legacy user.places array if present
    if (Array.isArray(user?.places) && user.places.length > 0) {
      return user.places;
    }
    return [];
  }, [userTrips, user]);

  if (!open || !user) return null;

  const pUrl =
    user.profilePictureUrl || user.photoURL || user.photoUrl || user.avatarUrl || user.avatar || user.photo;
  const pid = getCloudinaryPublicId(pUrl);
  const avatarInitial = (user.travelerName || user.name || user.email || 'U').toString().trim().charAt(0).toUpperCase();

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div style={{ width: 'min(980px, 96vw)', background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '22px 28px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 26, fontWeight: 600, color: '#111827' }}>User Profile</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 28, cursor: 'pointer', color: '#111' }}>×</button>
        </div>

        {/* Profile Section */}
        <div style={{ background: 'linear-gradient(90deg,#4f46e5,#3b82f6)', padding: '24px 28px', display: 'flex', alignItems: 'center', gap: 22 }}>
          {pid ? (
            <CloudinaryContext cloudName={CLOUDINARY_CLOUD_NAME}>
              <Image publicId={pid} width="56" height="56" crop="fill" gravity="face" radius="max" alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 2px 10px rgba(0,0,0,.08)' }} />
            </CloudinaryContext>
          ) : pUrl ? (
            <img src={pUrl} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 2px 10px rgba(0,0,0,.08)' }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 16 }}>
              {avatarInitial}
            </div>
          )}
          <div style={{ color: '#fff', flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 500 }}>{user.travelerName || user.name || 'Unnamed'}</div>
            <div style={{ opacity: .95, fontWeight: 400 }}>{user.email || ''}</div>
            {/* Show UID below email */}
            <div style={{ opacity: .7, fontWeight: 400, fontSize: 13, marginTop: 2 }}>
              UID: {uid}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center' }}>
              <span style={{ background: '#34d399', color: '#fff', fontSize: 13, fontWeight: 500, borderRadius: 999, padding: '7px 18px' }}>
                {(user.status || 'active').toString().toUpperCase()}
              </span>
              <span style={{ color: '#e0e7ff', fontWeight: 400 }}>Joined {fmtDate(user.createdAt)}</span>
            </div>
          </div>
          <button
            style={{ background: '#22c55e', color: '#fff', border: 'none', padding: '10px 22px', fontWeight: 500, borderRadius: 8, fontSize: 16, boxShadow: '0 2px 8px rgba(34,197,94,.15)' }}
            onClick={() => onEdit?.('basic')}
          >
            Edit Profile
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 40, padding: '0 28px', borderBottom: '1px solid #e5e7eb', marginBottom: 0 }}>
          {['overview', 'achievements'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: '24px 0 12px 0',
                color: tab === t ? '#2563eb' : '#6b7280', fontWeight: 500, fontSize: 15,
                borderBottom: tab === t ? '3px solid #2563eb' : '3px solid transparent'
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Body */}
        {tab === 'overview' && (
          <div style={{ padding: '28px', background: '#f8fafc' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
              {/* Profile Information card */}
              <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.04)', padding: 18 }}>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 16 }}>Profile Information</div>
                <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 4 }}>Bio:</div>
                <div style={{ marginBottom: 12, fontWeight: 400 }}>
                  {(bio ?? user.travelerBio) || user.bio || '—'}
                </div>
                <div style={{ color: '#6b7280', fontSize: 13 }}>Sign Provider:</div>
                <div style={{ marginBottom: 10, fontWeight: 400 }}>{user.provider || user.providerId || 'Email'}</div>
                <div style={{ color: '#6b7280', fontSize: 13 }}>Last Login:</div>
                <div style={{ fontWeight: 400 }}>{fmtDateTime(user.lastLogin)}</div>
              </div>

              {/* Travel Stats card (from Firestore) */}
              <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.04)', padding: 18 }}>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 16 }}>Travel Stats</div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4,1fr)',
                  gap: 12,
                  alignItems: 'center'
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#2563eb' }}>{userStats.placesOnTrips}</div>
                    <div className="muted small" style={{ marginTop: 4 }}>Places on Trips</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#16a34a' }}>{userStats.photosShared}</div>
                    <div className="muted small" style={{ marginTop: 4 }}>Photos Shared</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#7c3aed' }}>{userStats.ratedDestinations}</div>
                    <div className="muted small" style={{ marginTop: 4 }}>Rated Destinations</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#f97316' }}>{userStats.friends}</div>
                    <div className="muted small" style={{ marginTop: 4 }}>Friends</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18
            }}>
              {/* Travel Interests */}
              <div style={{
                background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.04)', padding: 18,
                position: 'relative' // NEW: to anchor loading overlay
              }}>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 16 }}>Travel Interests</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {travelInterests.length > 0 ? (
                    travelInterests.map((t, idx) => (
                      <span key={idx} style={{
                        background: '#e0f2fe',
                        color: '#2563eb',
                        fontWeight: 600,
                        fontSize: 13,
                        padding: '4px 14px',
                        borderRadius: 8,
                        display: 'inline-block'
                      }}>
                        {t}
                      </span>
                    ))
                  ) : (
                    <span className="muted" style={{ fontSize: 13 }}>No interests set</span>
                  )}
                </div>
                {likesLoading && ( // NEW: circular loading overlay
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 12,
                    background: 'rgba(255,255,255,0.6)', display: 'grid', placeItems: 'center'
                  }}>
                    <div className="loading-spinner" />
                  </div>
                )}
              </div>

              {/* Trips */}
              <div style={{
                background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.04)', padding: 18,
                position: 'relative' // NEW: to anchor loading overlay
              }}>
                <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 16 }}>Trips</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {userTripsLoading ? (
                    <div className="muted" style={{ fontSize: 13 }}>Loading...</div>
                  ) : tripChips.length > 0 ? (
                    tripChips.map((p, idx) => (
                      <span key={idx} style={{
                        background: '#e0f2fe',
                        color: '#2563eb',
                        fontWeight: 600,
                        fontSize: 13,
                        padding: '4px 14px',
                        borderRadius: 8,
                        display: 'inline-block'
                      }}>
                        {p}
                      </span>
                    ))
                  ) : (
                    <div className="muted" style={{ fontSize: 13 }}>No places on Trips</div>
                  )}
                </div>
                {userTripsLoading && ( // NEW: circular loading overlay
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 12,
                    background: 'rgba(255,255,255,0.6)', display: 'grid', placeItems: 'center'
                  }}>
                    <div className="loading-spinner" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ACHIEVEMENTS tab (matches screenshot) */}
        {tab === 'achievements' && (
          <div style={{ padding: '28px', background: '#f8fafc' }}>
            <div style={{ fontSize: 17, marginBottom: 18 }}>Achievements</div>

            {achievementsLoading ? (
              <div className="centered" style={{ padding: 40 }}><div className="loading-spinner" /></div>
            ) : achievements.length === 0 ? (
              <div className="muted" style={{ padding: 24 }}>No achievements yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {achievements.map((a, idx) => (
                  <div key={idx} style={{ ...rowBox }}>
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
                    <input className="form-input" value={a.title} disabled style={{ background: '#fff' }} />
                    <input className="form-input" value={a.desc || ''} disabled style={{ background: '#fff' }} />
                  </div>
                ))}
              </div>
            )}
            {/* No remove or add buttons in the view modal */}
          </div>
        )}

        {/* Recent Activity (moved from Travel to match screenshot) */}
        {userEditOpen && editingUser && userEditTab === 'travel' && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 17, marginBottom: 12 }}>Recent Activity</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1.2fr 1.2fr 1fr 110px', gap: 12, alignItems: 'center', background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                <select className="form-input" disabled style={{ width: 38 }}>
                  <option>Photo</option>
                </select>
                <input className="form-input" value="Shared photos from Bali sunset" disabled style={{ background: '#fff' }} />
                <input className="form-input" value="15/11/2023" disabled style={{ background: '#fff' }} />
                <button type="button" className="btn-danger" style={{ padding: '8px 16px', borderRadius: 8 }}>Remove</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1.2fr 1.2fr 1fr 110px', gap: 12, alignItems: 'center', background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                <select className="form-input" disabled style={{ width: 38 }}>
                  <option>Review</option>
                </select>
                <input className="form-input" value='Reviewed "Sunset Villa Resort"' disabled style={{ background: '#fff' }} />
                <input className="form-input" value="14/11/2023" disabled style={{ background: '#fff' }} />
                <button type="button" className="btn-danger" style={{ padding: '8px 16px', borderRadius: 8 }}>Remove</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1.2fr 1.2fr 1fr 110px', gap: 12, alignItems: 'center', background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                <select className="form-input" disabled style={{ width: 38 }}>
                  <option>Visit</option>
                </select>
                <input className="form-input" value="Checked in at Ubud, Bali" disabled style={{ background: '#fff' }} />
                <input className="form-input" value="13/11/2023" disabled style={{ background: '#fff' }} />
                <button type="button" className="btn-danger" style={{ padding: '8px 16px', borderRadius: 8 }}>Remove</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1.2fr 1.2fr 1fr 110px', gap: 12, alignItems: 'center', background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                <select className="form-input" disabled style={{ width: 38 }}>
                  <option>Friend</option>
                </select>
                <input className="form-input" value="Connected with Mike Chen" disabled style={{ background: '#fff' }} />
                <input className="form-input" value="12/11/2023" disabled style={{ background: '#fff' }} />
                <button type="button" className="btn-danger" style={{ padding: '8px 16px', borderRadius: 8 }}>Remove</button>
              </div>
            </div>
            <button type="button" style={{
              marginTop: 14,
              background: '#22c55e',
              color: '#fff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: 8,
              fontWeight: 500,
              fontSize: 15
            }}>+ Add Activity</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Achievements catalog and helpers (copied to match editprofile-cms.js)
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

function getAchievementEmoji(a = {}) {
  const title = String(a.title || '').trim();
  const match = Object.values(ACHIEVEMENTS_CATALOG).find((m) => m.title === title);
  return a.icon || match?.icon || '🏆';
}

function achievementItemFrom(id, data = {}) {
  const meta = ACHIEVEMENTS_CATALOG[String(id)];
  if (!meta) return null;
  return { icon: meta.icon, title: meta.title, desc: meta.desc };
}

// Load unlocked achievements for a user (supports subcollection, arrays, and boolean maps)
async function loadUserAchievementsFromFirebase(uid) {
  if (!uid) return [];

  const added = new Set(); // dedupe by title
  const out = [];

  const pushItem = (item) => {
    if (!item || !item.title) return;
    const key = item.title.trim().toLowerCase();
    if (added.has(key)) return;
    added.add(key);
    out.push({
      icon: item.icon || getAchievementEmoji(item),
      title: item.title,
      desc: item.desc || item.description || ''
    });
  };

  const fromIdAndData = (id, data = {}) => {
    const meta = ACHIEVEMENTS_CATALOG[String(id)];
    if (meta) {
      pushItem({ icon: meta.icon, title: meta.title, desc: meta.desc, ...data });
      return;
    }
    // Fallbacks when ID is not in catalog
    const title =
      (typeof data.title === 'string' && data.title) ||
      (typeof id === 'string' && id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())) ||
      null;
    if (title) pushItem({ title, desc: data.desc || data.description || '', icon: data.icon });
  };

  // 1) users/{uid} document fields
  try {
    const ds = await getDoc(doc(db, 'users', uid));
    if (ds.exists()) {
      const data = ds.data() || {};

      // Array of objects [{title, desc, icon, id}]
      if (Array.isArray(data.achievements)) {
        data.achievements.forEach((it) => {
          if (it && (it.title || it.id)) fromIdAndData(it.id, it);
        });
      }

      // Boolean/object maps { 'Globe Trotter': true } or { '1': true }
      const maps = [data.achievements, data.profile?.achievements, data.badges, data.profile?.badges];
      maps.forEach((m) => {
        if (m && typeof m === 'object' && !Array.isArray(m)) {
          Object.entries(m).forEach(([k, v]) => {
            const unlocked = v === true || v === 'true' || v === 1 || v?.unlocked === true || v?.achieved === true;
            if (unlocked) fromIdAndData(k, typeof v === 'object' ? v : {});
          });
        }
      });
    }
  } catch {}

  // 2) users/{uid}/achievements subcollection (any doc shape)
  try {
    const ref = collection(db, 'users', uid, 'achievements');
    const snap = await getDocs(ref);
    snap.forEach((d) => {
      const data = d.data() || {};
      const unlocked = data.unlocked === undefined ? true : !!data.unlocked;
      if (unlocked) fromIdAndData(d.id, data);
    });
  } catch {}

  return out;
}

// Shared row style for read-only achievements (no Remove column)
const rowBox = {
  display: 'grid',
  gridTemplateColumns: '56px 1.2fr 2.4fr',
  gap: 12,
  alignItems: 'center',
  background: '#f8fafc',
  borderRadius: 8,
  padding: '10px 12px'
};