import React, { useEffect, useMemo, useState } from 'react';
import './Styles/bookmark2.css';
import { db, auth } from './firebase';
import { useNavigate } from 'react-router-dom';
import { unlockAchievement } from './profile';
import {
  collection,
  serverTimestamp,
  setDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query as fsQuery,
  where as fsWhere,
  arrayUnion,
  arrayRemove,
  deleteDoc,
  addDoc,
} from 'firebase/firestore';
import { addTripForCurrentUser } from './Itinerary';
import { fetchCloudinaryImages, getImageForDestination } from "./image-router";
import { trackDestinationAdded } from './itinerary_Stats';

// ADD logActivity function HERE at the top
async function logActivity(text, icon = "🔵") {
  try {
    const user = auth.currentUser;
    if (!user) return;

    await addDoc(collection(db, "activities"), {
      userId: user.uid,
      text,
      icon,
      timestamp: new Date().toISOString(),
    });
    console.log("Activity logged:", text); // Debug log
  } catch (error) {
    console.error("Error logging activity:", error);
  }
}
// Helper to get image URL for a destination
export async function fetchAllCloudinaryImages() {
  const snap = await getDocs(collection(db, "cloudinaryImages"));
  const map = {};
  snap.forEach(doc => {
    map[doc.id] = doc.data().url;
  });
  return map; // { "Bat-ongan Cave": "https://...", ... }
}

export default function Bookmarks2() {
  // Firestore-backed destinations and bookmarks
  const [destinations, setDestinations] = useState([]);
  const navigate = useNavigate();
  const [bookmarks, setBookmarks] = useState(new Set());
  const [currentUser, setCurrentUser] = useState(null);
  // NEW: page loading state
  const [isLoading, setIsLoading] = useState(true);
  const [cloudImages, setCloudImages] = useState([]);
  const [categories, setCategories] = useState([]);

  // UI state
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name'); // name | rating | price
  const [selectedRegions, setSelectedRegions] = useState(new Set());
  const [selectedPrice, setSelectedPrice] = useState(null); // less | expensive | null
  const [selectedCats, setSelectedCats] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [addingTripId, setAddingTripId] = useState(null);
  const [addedTripId, setAddedTripId] = useState(null); // NEW: show ✔ after success

  // NEW: ratings state
  const [ratingsByDest, setRatingsByDest] = useState({}); // { [destId]: { avg, count } }
  const [userRating, setUserRating] = useState(0);        // current user's rating for selected
  const [savingRating, setSavingRating] = useState(false);

  // NEW: bookmark toggle pending (modal)
  const [bookmarking, setBookmarking] = useState(false);

  // NEW: pagination
  const [page, setPage] = useState(1);
  const pageSize = 12;

  // NEW: destinations viewed by the user (for achievement tracking)
  const [viewedDestinations, setViewedDestinations] = useState(new Set());

  // 1) Load only CMS-published destinations (status in ['published','PUBLISHED'])
  useEffect(() => {
    setIsLoading(true);
    const q = fsQuery(
      collection(db, 'destinations'),
      fsWhere('status', 'in', ['published', 'PUBLISHED'])
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((x) => ({
          id: x.id,
          ...x.data(),
          category: x.data().category || '', // Always use category string
          // categories: undefined, // Optionally remove categories if present
        }));
        setDestinations(items);
        setIsLoading(false);
      },
      (err) => {
        console.error('Failed to load published destinations:', err);
        setDestinations([]);
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [setCurrentUser]);

  // 2) Listen to auth and the current user's bookmarks
  useEffect(() => {
    let unsubUserDoc = null;
    let unsubAuth = () => {}; // <-- ensure unsubAuth is always a function
    unsubAuth = auth.onAuthStateChanged(async (user) => {
      setCurrentUser(user || null);
      if (user) {
        const userRef = doc(db, 'userBookmarks', user.uid);

            try {
              const snap = await getDoc(userRef);
              if (!snap.exists()) {
                await setDoc(
                  userRef,
                  {
                    userId: user.uid,
                    bookmarks: [],
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true }
                );
              }
            } catch (e) {
              console.warn('userBookmarks bootstrap skipped:', e.code || e.message);
            }

            unsubUserDoc = onSnapshot(
              userRef,
              (s) => {
                const ids = (s.exists() ? s.data().bookmarks : []) || [];
                setBookmarks(new Set(ids));
              },
              (err) => {
                console.warn('userBookmarks listener error:', err.code || err.message);
                setBookmarks(new Set());
              }
            );
          } else {
            setBookmarks(new Set());
            if (unsubUserDoc) unsubUserDoc();
          }
        });
      // fallback no-op if not a function

    return () => {
      if (unsubUserDoc) unsubUserDoc();
      if (typeof unsubAuth === 'function') unsubAuth();
      if (typeof unsubAuth === 'function') unsubAuth();
    };
  }, [setCurrentUser]);

  // Regions/Categories derived from Firestore data
const regions = useMemo(
  () => [...new Set(destinations.map((d) => d.region || '').filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b))),
  [destinations]
);

const categoriesMemo = useMemo(() => {
  const s = new Set();
  destinations.forEach((d) => (d.categories || []).forEach((c) => s.add(c || '')));
  return [...s].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
}, [destinations]);

const allCategories = useMemo(() => {
  const set = new Set();
  categories.forEach((c) => set.add(c));
  (categoriesMemo || []).forEach((c) => set.add(c));
  return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
}, [categories, categoriesMemo]);
  
  // Filter + sort
  const filtered = useMemo(() => {
    // Guard: keep only truly published docs
    let list = destinations.filter(
      (d) => String(d.status || '').toUpperCase() === 'PUBLISHED'
    );
    
    // FIX: Change 'q' to 'query.toLowerCase()' 
    list = list.filter((d) => {
      const q = query.toLowerCase();
      const matchesQ =
        !query ||
        d.name?.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q) ||
        d.region?.toLowerCase().includes(q);
      const matchesRegion = !selectedRegions.size || selectedRegions.has(d.region);
      const matchesPrice = !selectedPrice || selectedPrice === d.priceTier;
      const matchesCat = !selectedCats.size || (d.categories || []).some((c) => selectedCats.has(c));
      return matchesQ && matchesRegion && matchesPrice && matchesCat;
    });

    if (sortBy === 'name') list = [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (sortBy === 'rating') list = [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (sortBy === 'price-asc') {
      const n = (x) => parseInt(String(x.price || '0').replace(/[^\d]/g, ''), 10) || 0;
      list = [...list].sort((a, b) => n(a) - n(b));
    }
    if (sortBy === 'price-desc') {
      const n = (x) => parseInt(String(x.price || '0').replace(/[^\d]/g, ''), 10) || 0;
      list = [...list].sort((a, b) => n(b) - n(a));
    }
    return list;
  }, [destinations, query, selectedRegions, selectedPrice, selectedCats, sortBy]);

  // NEW: clamp/reset page when filters/sort change
  useEffect(() => {
    setPage(1);
  }, [query, selectedRegions, selectedPrice, selectedCats, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, filtered.length);
  const pageItems = useMemo(() => filtered.slice(start, end), [filtered, start, end]);

  const canPrev = page > 1;
  const canNext = page < totalPages;

  // NEW: helper to navigate pages and reliably scroll to top
  const goToPage = (target) => {
    setPage(target);

    // Desired top position
    const top = 0;

    // Try multiple scroll targets (window, document, main app container)
    try {
      if (typeof window !== 'undefined' && window.scrollTo) {
        // smooth when possible
        try {
          window.scrollTo({ top, behavior: 'smooth' });
        } catch {
          window.scrollTo(0, top);
        }
      }

      // Also try documentElement/body (some setups use these)
      if (document.documentElement && 'scrollTop' in document.documentElement) {
        document.documentElement.scrollTop = top;
      }
      if (document.body && 'scrollTop' in document.body) {
        document.body.scrollTop = top;
      }

      // If your app uses a scrollable container, scroll that too
      const appEl = document.querySelector('.App') || document.querySelector('#root') || null;
      if (appEl && typeof appEl.scrollTo === 'function') {
        try {
          appEl.scrollTo({ top, behavior: 'smooth' });
        } catch {
          appEl.scrollTop = top;
        }
      }
    } catch (e) {
      // final fallback
      try { window.scrollTo(0, 0); } catch {}
    }

    // Remove focus from the pager button so the browser won't keep it visible
    // (do after a short delay so we don't interrupt the click)
    try {
      setTimeout(() => {
        const active = document.activeElement;
        if (active && typeof active.blur === 'function') active.blur();
      }, 50);const n = (x) => parseInt((x.price || '0').replace(/[^\d]/g, ''), 10) || 0;
    } catch {}
  };

  // REPLACE existing Pager with one that uses goToPage
  const Pager = () => (
    <div className="bp2-pager" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', margin: '12px 0' }}>
      <div className="bp2-pager-info" style={{ color: '#475569', fontSize: 14 }}>
        {filtered.length ? `Showing ${start + 1}–${end} of ${filtered.length}` : 'No destinations found'}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="next-page-btn" onClick={() => goToPage(1)} disabled={!canPrev} aria-label="First page">« First</button>
        <button className="next-page-btn" onClick={() => goToPage(Math.max(1, page - 1))} disabled={!canPrev} aria-label="Previous page">‹ Prev</button>
        <span style={{ padding: '6px 10px', fontSize: 14 }}>{page} / {totalPages}</span>
        <button className="next-page-btn" onClick={() => goToPage(Math.min(totalPages, page + 1))} disabled={!canNext} aria-label="Next page">Next ›</button>
        <button className="next-page-btn" onClick={() => goToPage(totalPages)} disabled={!canNext} aria-label="Last page">Last »</button>
      </div>
    </div>
  );

  // All categories (from Firestore + CMS) for filter list
  

  // Helpers
  const toggleSet = (setter, value) =>
    setter((prev) => {
      const n = new Set(prev);
      n.has(value) ? n.delete(value) : n.add(value);
      return n;
    });

  // 3) Toggle bookmark in Firestore for current user
  const toggleBookmark = async (dest) => {
    const user = auth.currentUser;
    if (!user) {
      alert('Please sign in to bookmark destinations.');
      return;
    }
    
    const listRef = doc(db, 'userBookmarks', user.uid);
    const userDocRef = doc(db, 'users', user.uid);
    const bookmarkDocRef = doc(db, 'users', user.uid, 'bookmarks', dest.id);

    const isBookmarked = bookmarks.has(dest.id);

    try {
      await setDoc(
        listRef,
        {
          userId: user.uid,
          updatedAt: serverTimestamp(),
          bookmarks: isBookmarked ? arrayRemove(dest.id) : arrayUnion(dest.id),
        },
        { merge: true }
      );

      try {
        await setDoc(userDocRef, { updatedAt: serverTimestamp() }, { merge: true });
      } catch (e) {
        console.warn('users/{uid} timestamp write skipped:', e.code || e.message);
      }

      if (isBookmarked) {
        try {
          await deleteDoc(bookmarkDocRef);
          // Log activity for removing bookmark
          await logActivity(`Removed "${dest.name}" from bookmarks`, "💔");
          console.log('✅ Activity logged: Removed bookmark');
        } catch (e) {
          console.warn('delete users/{uid}/bookmarks/{destId} skipped:', e.code || e.message);
        }
      } else {
        try {
          await setDoc(
            bookmarkDocRef,
            {
              destId: dest.id,
              name: dest.name,
              region: dest.region || '',
              rating: dest.rating ?? null,
              price: dest.price || '',
              priceTier: dest.priceTier || null,
              tags: dest.tags || [],
              category: dest.category || [],
              bestTime: dest.bestTime || '',
              image: dest.image || '',
              description: dest.description || '',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          
          // Log activity for adding bookmark
          await logActivity(`Bookmarked "${dest.name}"`, "⭐");
          console.log('✅ Activity logged: Added bookmark');
          
          // Check if this is the first bookmark
          const userBookmarksSnap = await getDoc(listRef);
          const bookmarksList = userBookmarksSnap.data()?.bookmarks || [];
          if (bookmarksList.length === 1) {
            await unlockAchievement(2, "First Bookmark");
          }
        } catch (e) {
          console.warn('upsert users/{uid}/bookmarks/{destId} skipped:', e.code || e.message);
        }
      }
    } catch (e) {
      console.error('Toggle bookmark failed:', e.code || e.message);
      alert('Could not update bookmark. Please try again.');
    }
  };

  // Average ratings loader for current page
  useEffect(() => {
    let cancelled = false;
    async function loadAverages() {
      try {
        const entries = await Promise.all(
          pageItems.map(async (d) => {
            try {
              const rsnap = await getDocs(collection(db, 'destinations', d.id, 'ratings'));
              let sum = 0, count = 0;
              rsnap.forEach((r) => {
                const v = Number(r.data()?.value) || 0;
                if (v > 0) { sum += v; count += 1; }
              });
              const avg = count ? sum / count : 0;
              return [d.id, { avg, count }];
            } catch (err) {
              // Permission denied -> treat as no ratings
              console.warn('ratings read skipped for', d.id, err.code || err.message);
              return [d.id, { avg: 0, count: 0 }];
            }
          })
        );
        if (!cancelled) setRatingsByDest((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      } catch (e) {
        console.error('Load averages failed', e.code || e.message);
        console.error('Load averages failed', e.code || e.message);
      }
    }
    if (pageItems.length) loadAverages();
    return () => { cancelled = true; };
  }, [pageItems]);

  const avgText = (id) => {
    const r = ratingsByDest[id];
    return r && r.count > 0 ? r.avg.toFixed(1) : '—';
  };

  // Add this useEffect to load viewed destinations from Firestore when user logs in
useEffect(() => {
  if (!currentUser) {
    setViewedDestinations(new Set());
    return;
  }

  const loadViewedDestinations = async () => {
    try {
      const viewedRef = doc(db, 'users', currentUser.uid, 'viewedDestinations', 'data');
      const viewedSnap = await getDoc(viewedRef);
      
      if (viewedSnap.exists()) {
        const viewedIds = viewedSnap.data().destinationIds || [];
        setViewedDestinations(new Set(viewedIds));
      }
    } catch (error) {
      console.warn('Could not load viewed destinations:', error);
    }
  };

  loadViewedDestinations();
}, [currentUser]);

  const openDetails = async (d) => {
    setSelected(d);
    setModalOpen(true);

    // Track this destination as viewed
    const newViewed = new Set(viewedDestinations);
    const wasNew = !newViewed.has(d.id);
    newViewed.add(d.id);
    setViewedDestinations(newViewed);

    // Save to Firestore if user is logged in and this is a new view
    if (currentUser && wasNew) {
      try {
        const viewedRef = doc(db, 'users', currentUser.uid, 'viewedDestinations', 'data');
        await setDoc(
          viewedRef,
          {
            destinationIds: Array.from(newViewed),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (error) {
        console.warn('Could not save viewed destination:', error);
      }
    }

    // Check if user has viewed 10 different destinations
    if (newViewed.size >= 10) {
      try {
        await unlockAchievement(7, "Explorer at Heart");
      } catch (error) {
        console.error("Error unlocking Explorer at Heart achievement:", error);
      }
    }

    // Load user's rating for this destination
    try {
      const u = auth.currentUser;
      if (!u) { setUserRating(0); return; }
      const rref = doc(db, 'destinations', d.id, 'ratings', u.uid);
      const rsnap = await getDoc(rref);
      setUserRating(Number(rsnap.data()?.value || 0));
    } catch {
      setUserRating(0);
    }

    // Ensure we have averages for this selected item
    if (!ratingsByDest[d.id]) {
      try {
        const rsnap = await getDocs(collection(db, 'destinations', d.id, 'ratings'));
        let sum = 0, count = 0;
        rsnap.forEach((r) => {
          const v = Number(r.data()?.value) || 0;
          if (v > 0) { sum += v; count += 1; }
        });
        const avg = count ? sum / count : 0;
        setRatingsByDest((m) => ({ ...m, [d.id]: { avg, count } }));
      } catch (e) {
        console.error('Load selected avg failed', e);
      }
    }

    // Fetch packingSuggestions from Firestore if available
    try {
      const destSnap = await getDoc(doc(db, 'destinations', d.id, 'packingSuggestions'));
      if (destSnap.exists()) {
        const data = destSnap.data();
        if (data.packingSuggestions) {
          setSelected(prev => ({ ...prev, packingSuggestions: data.packingSuggestions }));
        }
      }
    } catch (e) {
      console.warn('Could not fetch packingSuggestions:', e.message);
    }
  };

  const closeDetails = () => {
    setModalOpen(false);
    setSelected(null);
    setUserRating(0);
  };

// NEW: modal bookmark click with optimistic UI + rollback on error
  const handleModalBookmarkClick = async () => {
    const user = auth.currentUser;
    if (!user) { alert('Please sign in to bookmark destinations.'); return; }
    if (!selected) return;

    const id = selected.id;
    const wasBookmarked = bookmarks.has(id);
    
    // Check if this will be the first bookmark
    const isFirstBookmark = !wasBookmarked && bookmarks.size === 0;

    // Optimistic UI
    setBookmarks((prev) => {
      const n = new Set(prev);
      wasBookmarked ? n.delete(id) : n.add(id);
      return n;
    });

    setBookmarking(true);
    try {
      await toggleBookmark(selected); // This will log the activity
      
      // If adding first bookmark, unlock achievement
      if (isFirstBookmark) {
        await unlockAchievement(2, "First Bookmark");
      }
      
    } catch (e) {
      // Rollback on failure
      setBookmarks((prev) => {
        const n = new Set(prev);
        wasBookmarked ? n.add(id) : n.delete(id);
        return n;
      });
      console.error('Bookmark toggle from modal failed:', e);
      alert('Could not update bookmark. Please try again.');
    } finally {
      setBookmarking(false);
    }
  };

  // NEW: save rating for current user and refresh average
  const rateSelected = async (value) => {
    const u = auth.currentUser;
    if (!u) { alert('Please sign in to rate.'); return; }
    if (!selected) return;
    const v = Math.max(1, Math.min(5, Number(value) || 0));
    setSavingRating(true);
    try {
      const ref = doc(db, 'destinations', String(selected.id), 'ratings', u.uid);
      await setDoc(ref, {
        value: v,
        userId: u.uid,
        updatedAt: serverTimestamp(),
        name: selected.name || '', // <-- add name
      }, { merge: true });

      setUserRating(v);

      // --- Write user's rating to users/{uid}/ratings/{destId} ---
      const userRatingRef = doc(db, 'users', u.uid, 'ratings', String(selected.id));
      await setDoc(
        userRatingRef,
        {
          destId: String(selected.id),
          value: v,
          updatedAt: serverTimestamp(),
          name: selected.name || '', // <-- add name
        },
        { merge: true }
      );
      // --- END NEW ---

      // Recompute average
      const rsnap = await getDocs(collection(db, 'destinations', String(selected.id), 'ratings'));
      let sum = 0, count = 0;
      rsnap.forEach((r) => { const val = Number(r.data()?.value) || 0; if (val > 0) { sum += val; count += 1; } });
      const avg = count ? sum / count : 0;

      setRatingsByDest((m) => ({ ...m, [selected.id]: { avg, count } }));
      setDestinations((prev) => prev.map((x) => (x.id === selected.id ? { ...x, rating: avg } : x)));
    } catch (e) {
      console.error('Save rating failed:', e.code, e.message);
      alert('Failed to save rating.');
    } finally {
      setSavingRating(false);
    }
  };

  // Add to Trip handler (stub implementation)
  const addToTripFromBookmarks = async (dest) => {
    setAddingTripId(dest.id);
    try {
      const user = auth.currentUser;
      if (!user) {
        alert('Please sign in to add to My Trips.');
        return;
      }

      // Existing behavior: write to itinerary collection using helper
      await addTripForCurrentUser(dest);

      // Track destination added to itinerary
      await trackDestinationAdded(user.uid, {
        id: dest.id,
        name: dest.name,
        region: dest.region,
      });

      // small parser reused here to store same estimatedExpenditure in users/{uid}/trips
      const parseEstimatedFromPrice = (p) => {
        if (p == null) return 0;
        if (typeof p === "number") return p;
        const s = String(p).replace(/\s/g, "").replace(/₱/g, "").replace(/,/g, "");
        const nums = s.match(/\d+/g);
        if (!nums || nums.length === 0) return 0;
        const numbers = nums.map(Number).filter(Number.isFinite);
        const sum = numbers.reduce((a, b) => a + b, 0);
        return Math.round(sum / numbers.length);
      };
      const estimated = parseEstimatedFromPrice(dest?.price ?? dest?.priceTier ?? dest?.estimatedExpenditure ?? dest?.budget);

      // NEW: also save to users/{uid}/trips/{destId} with estimatedExpenditure
      try {
        await setDoc(
          doc(db, 'users', user.uid, 'trips', String(dest.id)),
          {
            destId: String(dest.id),
            name: dest.name || '',
            region: dest.region || '',
            rating: dest.rating ?? null,
            price: dest.price || '',
            priceTier: dest.priceTier || null,
            estimatedExpenditure: estimated,
            tags: Array.isArray(dest.tags) ? dest.tags : [],
            categories: Array.isArray(dest.categories) ? dest.categories : [],
            bestTime: dest.bestTime || '',
            image: dest.image || '',
            addedBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn('users/{uid}/trips write skipped:', e.code || e.message);
      }

      setAddedTripId(dest.id);
      setTimeout(() => {
        setAddedTripId(null);
        navigate('/itinerary'); // Route for "My Trips"
      }, 600);
    } catch (e) {
      if (e?.message === 'AUTH_REQUIRED') {
        alert('Please sign in to add to My Trips.');
      } else {
        console.error('Add to My Trips failed:', e);
        alert('Failed to add to trip. Please try again.');
      }
    } finally {
      setAddingTripId(null);
    }
  };

  // NEW: peso formatter (non-destructive)
  const formatPeso = (v) => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') return '₱' + v.toLocaleString();
    if (typeof v === 'string') {
      if (v.trim().startsWith('₱')) return v;            // already formatted
      const digits = v.replace(/[^\d]/g, '');
      return digits ? '₱' + Number(digits).toLocaleString() : v;
    }
    return '—';
  };

  useEffect(() => {
    fetchCloudinaryImages().then(setCloudImages);
  }, []);

  // Fetch categories from Firestore (collection: 'categories')
  useEffect(() => {
    async function fetchCategories() {
      try {
        const snap = await getDocs(collection(db, 'categories'));
        const cats = snap.docs.map(doc => doc.data().name).filter(Boolean);
        setCategories(cats.sort((a, b) => a.localeCompare(b)));
      } catch (e) {
        console.warn('Failed to load categories:', e.message);
        setCategories([]);
      }
    }
    fetchCategories();
  }, []);

  return (
    <div className="App">
      {isLoading && (
        <div className="bm2-loading-backdrop" role="status" aria-live="polite">
          <div className="lb-card">
            <div className="lb-scene">
              <svg className="lb-globe" viewBox="0 0 200 200" aria-hidden="true">
                <defs>
                  <radialGradient id="lbOcean" cx="50%" cy="45%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="100%" stopColor="#e8f1ff" />
                  </radialGradient>
                  <linearGradient id="lbIsland" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#22c55e" />
                    <stop offset="100%" stopColor="#16a34a" />
                  </linearGradient>
                  <filter id="lbShadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="rgba(2,6,23,.25)" />
                  </filter>
                </defs>

                <circle cx="100" cy="100" r="92" fill="url(#lbOcean)" />
                <circle cx="100" cy="100" r="92" fill="none" stroke="#fff" strokeWidth="8" />
                <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(2,6,23,.06)" strokeWidth="1" />

                {/* Stylized PH islands (vector, no image) */}
                <g filter="url(#lbShadow)" fill="url(#lbIsland)">
                  <path d="M70 40 l18 -10 18 8 -6 22 -14 10 -16 -8 z" />
                  <path d="M92 63 l6 -6 8 2 5 6 -6 6 -9 -2 z" />
                  <path d="M102 82 l8 -6 10 2 6 10 -8 8 -12 -3 z" />
                  <circle cx="96" cy="96" r="3.2" />
                  <circle cx="108" cy="96" r="3.2" />
                  <circle cx="100" cy="108" r="3" />
                  <path d="M120 120 l20 -10 22 12 2 14 -10 12 -22 4 -12 -10 z" />
                </g>

                <g className="lb-sheen">
                  <path d="M12,128 C60,152 140,152 188,128" stroke="rgba(37,99,235,.18)" strokeWidth="12" fill="none" strokeLinecap="round" />
                </g>
              </svg>

              <div className="lb-orbit" />
              <div className="lb-plane" />
            </div>

            <h2 className="lb-title">Discover Philippines</h2>
            <p className="lb-sub">Loading destinations…</p>
            <div className="lb-progress"><span /></div>
          </div>
        </div>
      )}

      <div className="bp2-page-layout">
        {/* Filters */}
        <aside className="bp2-filters">
          <div className="bp2-filters-header">Filters</div>

          <div className="bp2-filter-group">
            <label className="bp2-label">Search Destinations</label>
            <input
              type="text"
              className="bp2-input"
              placeholder="Search by name..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="bp2-filter-group">
            <div className="bp2-group-title">Region</div>
            <div className="bp2-checklist">
              {regions.map((r) => (
                <label key={r} className="bp2-check">
                  <input
                    type="checkbox"
                    checked={selectedRegions.has(r)}
                    onChange={() => toggleSet(setSelectedRegions, r)}
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="bp2-filter-group">
            <div className="bp2-group-title">Price Range</div>
            <label className="bp2-radio">
              <input
                type="radio"
                name="priceTier"
                checked={selectedPrice === 'less'}
                onChange={() => setSelectedPrice(selectedPrice === 'less' ? null : 'less')}
              />
              <span>Less Expensive (₱500–2,000)</span>
            </label>
            <label className="bp2-radio">
              <input
                type="radio"
                name="priceTier"
                checked={selectedPrice === 'expensive'}
                onChange={() =>
                  setSelectedPrice(selectedPrice === 'expensive' ? null : 'expensive')
                }
              />
              <span>Expensive (₱2,000+)</span>
            </label>
          </div>
                
          <div className="bp2-filter-group">
            <div className="bp2-group-title">Category</div>
            <div className="bp2-checklist">
              {allCategories.map((c) => (
                <label key={c} className="bp2-check">
                  <input
                    type="checkbox"
                    checked={selectedCats.has(c)}
                    onChange={() => toggleSet(setSelectedCats, c)}
                  />
                  <span>{c}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            className="bp2-clear-btn"
            onClick={() => {
              setQuery('');
              setSelectedRegions(new Set());
              setSelectedPrice(null);
              setSelectedCats(new Set());
              setSortBy('name');
            }}
          >
            Clear All Filters
          </button>
        </aside>

        {/* Main Content */}
        <main className="bp2-content">
          <div className="bp2-header-row">
            <h1 className="bp2-title">
              Discover Philippines <span className="bp2-count-link">({filtered.length} destinations)</span>
            </h1>
            <div className="bp2-sort">
              <label htmlFor="bp2-sort-select">Sort by</label>
              <select
                id="bp2-sort-select"
                className="bp2-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="name">Name</option>
                <option value="rating">Rating</option>
                <option value="price-asc">Price (Lowest to Highest)</option>
                <option value="price-desc">Price (Highest to Lowest)</option>
              </select>
            </div>
          </div>

          {/* NEW: top pager */}
          <Pager />

          <div className="grid-container">
            {pageItems.map((d) => (
              <div className="grid-card" key={d.id}>
                <div className="card-image">
                  {cloudImages.length === 0 ? (
                    <div style={{ width: "100%", height: 150, background: "#e0e7ef" }}>Loading...</div>
                  ) : getImageForDestination(cloudImages, d.name) ? (
                    <img
                      src={getImageForDestination(cloudImages, d.name)}
                      alt={d.name}
                      className="destination-img"
                      style={{
                        width: "100%",
                        height: 200,
                        objectFit: "cover",
                        borderRadius: "12px 12px 0 0",
                        marginBottom: 6,
                        background: "#e0e7ef"
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: 180,
                        borderRadius: "12px 12px 0 0",
                        background: "#e0e7ef",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#94a3b8",
                        fontSize: 32,
                        marginBottom: 6
                      }}
                    >
                      🏝️
                    </div>
                  )}
                  <button
                    className={`bookmark-bubble ${bookmarks.has(d.id) ? 'active' : ''}`}
                    onClick={() => toggleBookmark(d)}
                    aria-label="Toggle bookmark"
                    title="Bookmark"
                  >
                    {bookmarks.has(d.id) ? '❤️' : '🤍'}
                  </button>
                </div>

                <div className="card-header">
                  <h2>{d.name}</h2>
                  <div className="mini-rating" title="Average Rating">
                    <span>⭐</span> {avgText(d.id)}
                    </div>
                </div>

                <div className="bp2-region-line">{d.region}</div>
                <p className="description">{d.description}</p>

                <div className="tag-container">
                  {(d.tags || []).map((t, i) => (
                    <span key={i} className="tag">
                      {t}
                    </span>
                  ))}
                </div>

                <div className="card-footer">
                  <div
                    className={`price-pill ${d.priceTier === 'less' ? 'pill-green' : 'pill-gray'}`}
                    title={d.priceTier === 'less' ? 'Less Expensive tier' : 'Expensive tier'}
                  >
                    {formatPeso(d.price)} {/* CHANGED: show actual price */}
                  </div>
                  <button className="details-btn" onClick={() => openDetails(d)}>
                    View Details
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* NEW: bottom pager */}
          <Pager />
        </main>
      </div>

      {/* Details Modal */}
      {modalOpen && selected && (
        <div
          className="modal-overlay active"
          onClick={(e) => e.target.classList.contains('modal-overlay') && closeDetails()}
        >
          <div className="modal-content details-modal">
            <button className="modal-close-floating" onClick={closeDetails} aria-label="Close">
              ✕
            </button>

            <div className="details-hero">
                      <div className="details-hero-image">
                      {cloudImages.length === 0 ? (
                        <div style={{ width: "100%", height: 240, background: "#e0e7ef", borderRadius: 16  }} />
                      ) : getImageForDestination(cloudImages, selected.name) ? (
                        <img
                        src={getImageForDestination(cloudImages, selected.name)}
                        alt={selected.name}
                        style={{
                          width: "100%",
                          height: 240,
                          objectFit: "cover",
                          objectPosition: "center", // always show bottom part
                          borderRadius: "16px 16px 0 0",
                          marginBottom: 8,
                          background: "#e0e7ef"
                        }}
                        />
                      ) : (
                        <div
                        style={{
                          width: "100%",
                          height: 180,
                          borderRadius: 12,
                          background: "#e0e7ef",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#94a3b8",
                          fontSize: 48,
                          marginBottom: 8
                        }}
                        >
                        🏝️
                        </div>
                      )}
                      </div>
                    </div>

                    <div className="details-body">
                      <div className="details-head-row">
                      <div className="details-title-col">
                        <h2 className="details-title">{selected.name}</h2>
                        <a href="https://maps.google.com" className="details-region" onClick={(e) => e.preventDefault()}>
                        {selected.region}
                        </a>

                        <div className="details-rating-row">
                        <span className="star">⭐</span>
                        <span className="avg">
                          {(ratingsByDest[selected.id]?.count ?? 0) > 0
                          ? (ratingsByDest[selected.id].avg).toFixed(1)
                          : '—'}
                        </span>
                        <span className="muted"> (Average Rating)</span>
                        <span className="muted sep">Your Rating:</span>
                        <div className="your-stars">
                          {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            className={`star-btn ${userRating >= n ? 'filled' : ''}`}
                            onClick={() => rateSelected(n)}
                            disabled={savingRating}
                            aria-label={`${n} star${n > 1 ? 's' : ''}`}
                            title={`${n} star${n > 1 ? 's' : ''}`}
                          >
                            ★
                          </button>
                          ))}
                        </div>
                      </div>
                      </div>
                      <div className="details-actions">
                        <button
                        className={`btn-outline ${bookmarks.has(selected.id) ? 'active' : ''}`}
                        onClick={handleModalBookmarkClick}
                        disabled={bookmarking}
                        aria-pressed={bookmarks.has(selected.id)}
                        aria-label={bookmarks.has(selected.id) ? 'Remove bookmark' : 'Add bookmark'}
                        >
                        <span className="icon">{bookmarks.has(selected.id) ? '❤️' : '🤍'}</span>
                        {bookmarks.has(selected.id) ? 'Bookmarked' : 'Bookmark'}
                        </button>
                        <button
                        className={`btn-green ${addedTripId === selected.id ? 'btn-success' : ''}`}  // NEW: success style 
                    onClick={() => addToTripFromBookmarks(selected)}
                    disabled={addingTripId === selected.id}
                    aria-busy={addingTripId === selected.id}
                  >
                    <span className="icon">
                      {addedTripId === selected.id ? '✔' : '＋'}  {/* NEW: + -> ✔ */}
                    </span>
                    {addingTripId === selected.id
                      ? 'Adding…'
                      : addedTripId === selected.id
                      ? 'Added!'
                      : 'Add to Trip'}
                  </button>
                </div>
              </div>

              <div className="details-grid">
                <div className="details-left">
                  <div className="section-title">Description</div>
                  <p className="details-paragraph">{selected.description}</p>

                  <div className="section-title">Tags</div>
                  <div className="badge-row">
                    {(selected.tags || []).map((t, i) => (
                      <span key={i} className="badge">
                        {t}
                      </span>
                    ))}
                  </div>

                  <div className="section-title">Packing Suggestions</div>
                  <div className="packing-box">
                    {selected.packingSuggestions || "No packing suggestions available."}
                  </div>
                </div>

                <aside className="trip-info-box">
                  <div className="trip-title">Trip Information</div>

                  <div className="trip-item">
                    <div className="trip-label">Price</div>
                    <span
                      className={`pill small ${
                        selected.priceTier === 'less' ? 'pill-green' : 'pill-gray'
                      }`}
                      title={selected.priceTier === 'less' ? 'Less Expensive tier' : 'Expensive tier'}
                    >
                      {formatPeso(selected.price)} {/* CHANGED: actual price */}
                    </span>
                  </div>

                  <div className="trip-item">
                    <div className="trip-label">Best Time to Visit</div>
                    <div className="trip-text">{selected.bestTime}</div>
                  </div>

                  <div className="trip-item">
                    <div className="trip-label">Category</div>
                    <div className="badge-row">
                      {selected.category ? (
                        <span className="badge purple">{selected.category}</span>
                      ) : (
                        <span className="badge purple">No category</span>
                      )}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

