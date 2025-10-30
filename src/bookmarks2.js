import React, { useEffect, useMemo, useState, useCallback } from 'react';
import ReactDOM from 'react-dom'; // ADD THIS IMPORT
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
  limit,
  startAfter,
  orderBy,
  getCountFromServer,
  writeBatch, // ADD THIS IMPORT
  updateDoc,  // ADD THIS IMPORT
} from 'firebase/firestore';
import { addTripForCurrentUser } from './Itinerary';
import { fetchCloudinaryImages, getImageForDestination } from "./image-router";
import { trackDestinationAdded } from './itinerary_Stats';
import { breakdown } from './rules';

// ==================== CACHING LAYER ====================
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const destinationCache = {
  data: null,
  timestamp: null,
  totalCount: null, // NEW: Cache for total count
  isValid() {
    return this.data && this.timestamp && (Date.now() - this.timestamp < CACHE_DURATION);
  },
  set(data) {
    this.data = data;
    this.timestamp = Date.now();
    // Also cache to localStorage for persistence across sessions
    try {
      localStorage.setItem('destinations_cache', JSON.stringify({
        data,
        timestamp: this.timestamp
      }));
    } catch (e) {
      console.warn('Failed to cache to localStorage:', e);
    }
  },
  get() {
    // Try memory cache first
    if (this.isValid()) return this.data;
    
    // Try localStorage cache
    try {
      const cached = localStorage.getItem('destinations_cache');
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_DURATION) {
          this.data = data;
          this.timestamp = timestamp;
          return data;
        }
      }
    } catch (e) {
      console.warn('Failed to read cache from localStorage:', e);
    }
    
    return null;
  },
  clear() {
    this.data = null;
    this.timestamp = null;
    try {
      localStorage.removeItem('destinations_cache');
    } catch (e) {}
  }
};

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
  } catch (error) {
    console.error("Error logging activity:", error);
  }
}

// Fix 1: Import 'query' from firebase/firestore (it's already imported as fsQuery)
async function ensureCollectionExists(path) {
  try {
    const colRef = collection(db, path);
    const snap = await getDocs(fsQuery(colRef, limit(1))); // CHANGE: query -> fsQuery
    if (snap.empty) {
      const tempRef = doc(colRef);
      await setDoc(tempRef, { _placeholder: true, createdAt: serverTimestamp() });
      await deleteDoc(tempRef);
    }
  } catch (error) {
    console.warn(`Could not ensure collection ${path} exists:`, error);
  }
}

// ADD THIS HELPER FUNCTION after ensureCollectionExists
async function checkMiniPlannerAchievement(user) {
  try {
    if (!user?.uid) return;
    
    const sharedQuery = fsQuery(
      collection(db, 'sharedItineraries'),
      fsWhere('sharedBy', '==', user.uid)
    );
    
    const snapshot = await getDocs(sharedQuery);
    
    if (snapshot.size >= 1) {
      await unlockAchievement(11, "Mini Planner");
    }
  } catch (error) {
    console.error('Error checking Mini Planner achievement:', error);
  }
}

// Add at the top, after imports (helper for parsing fare ranges)
function parseFareRange(str) {
  // Example: "₱2,500 - ₱5,000+ (long routes)"
  const match = str.match(/₱([\d,]+)\s*-\s*₱([\d,]+)/);
  if (!match) return 0;
  // Return the higher value as number
  return Number(match[2].replace(/,/g, ''));
}

export default function Bookmarks2() {
  const [destinations, setDestinations] = useState([]);
  const navigate = useNavigate();
  const [bookmarks, setBookmarks] = useState(new Set());
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cloudImages, setCloudImages] = useState([]);
  const [categories, setCategories] = useState([]);
  const [regions, setRegions] = useState([]);
  const [firebaseImages, setFirebaseImages] = useState([]);

  // UI state
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [selectedRegions, setSelectedRegions] = useState(new Set());
  const [selectedPrice, setSelectedPrice] = useState(null);
  const [selectedCats, setSelectedCats] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [addingTripId, setAddingTripId] = useState(null);
  const [addedTripId, setAddedTripId] = useState(null);

  const [ratingsByDest, setRatingsByDest] = useState({});
  const [userRating, setUserRating] = useState(0);
  const [savingRating, setSavingRating] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [reviewsByDest, setReviewsByDest] = useState({});
  const [ratingsCountByDest, setRatingsCountByDest] = useState({});
  const [selectedFares, setSelectedFares] = useState([]); // For fare checkboxes
  const [selectedCard, setSelectedCard] = useState(null);
  const [userReviewsCountByDest, setUserReviewsCountByDest] = useState({});



  // ==================== PAGINATION STATE ====================
  const [page, setPage] = useState(1);
  const pageSize = 21;
  const [lastVisible, setLastVisible] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  const [viewedDestinations, setViewedDestinations] = useState(new Set());
  const [copyingId, setCopyingId] = useState(null);

  useEffect(() => {
  if (!modalOpen || !selected) return;
  async function fetchUserReviewsCount() {
    try {
      const reviewsSnap = await getDocs(collection(db, 'destinations', selected.id, 'reviews'));
      setUserReviewsCountByDest(prev => ({
        ...prev,
        [selected.id]: reviewsSnap.size || 0
      }));
    } catch (e) {
      setUserReviewsCountByDest(prev => ({
        ...prev,
        [selected.id]: 0
      }));
    }
  }
  fetchUserReviewsCount();
}, [modalOpen, selected]);

  // ==================== OPTIMIZED: Load destinations with caching ====================
  useEffect(() => {
    let unsubscribe = null;

    const loadDestinations = async () => {
      setIsLoading(true);
      
      // Check cache first
      const cached = destinationCache.get();
      if (cached) {
        console.log('✅ Using cached destinations');
        setDestinations(cached);
        setIsLoading(false);
        return;
      }

      console.log('📥 Fetching destinations from Firestore');
      
      // Fetch ALL published destinations (no limit for now since we're caching)
      const q = fsQuery(
        collection(db, 'destinations'),
        fsWhere('status', 'in', ['published', 'PUBLISHED'])
        // REMOVED: orderBy and limit - fetch all at once
      );

      try {
        const snap = await getDocs(q);
        const items = snap.docs.map((x) => ({
          id: x.id,
          ...x.data(),
          category: x.data().category || '',
        }));
        
        console.log(`✅ Loaded ${items.length} destinations from Firestore`);
        
        destinationCache.set(items);
        setDestinations(items);
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to load destinations:', err);
        setDestinations([]);
        setIsLoading(false);
      }
    };

    loadDestinations();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);
  // ==================== OPTIMIZED: Load regions and categories separately ====================
  useEffect(() => {
  loadFiltersData();
}, []);

  useEffect(() => {
    if (!modalOpen || !selected) return;

    async function fetchReviewCount() {
      try {
        const docRef = doc(db, 'destinations', selected.id,);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const review = snap.data().review;
          setReviewsByDest(prev => ({
            ...prev,
            [selected.id]: typeof review === 'number' ? review : 0
          }));
        } else {
          setReviewsByDest(prev => ({
            ...prev,
            [selected.id]: 0
          }));
        }
      } catch (e) {
        setReviewsByDest(prev => ({
          ...prev,
          [selected.id]: 0
        }));
      }
    }

    fetchReviewCount();
  }, [modalOpen, selected]);

    useEffect(() => {
    if (!modalOpen || !selected) return;

    async function fetchRatingsCount() {
      try {
        const ratingsSnap = await getDocs(collection(db, 'destinations', selected.id, 'ratings'));
        setRatingsCountByDest(prev => ({
          ...prev,
          [selected.id]: ratingsSnap.size || 0
        }));
      } catch (e) {
        setRatingsCountByDest(prev => ({
          ...prev,
          [selected.id]: 0
        }));
      }
    }

    fetchRatingsCount();
  }, [modalOpen, selected]);

  function getBreakdown(price) {
  if (!price) return [];
  // Remove non-digits and leading ₱, commas, spaces
  const digits = String(price).replace(/[^\d]/g, '');
  if (!digits) return [];
  const key = `P${digits}`;
  return breakdown[key] || [];
}

  // Fetch regions and categories from Firestore
  useEffect(() => {
    async function fetchFirebaseImages() {
      try {
        const snap = await getDocs(collection(db, 'photos'));
        const imgs = snap.docs.map(doc => ({
          name: doc.data().name,
          publicId: doc.data().publicId, // <-- fetch publicId
          url: doc.data().url
        })).filter(img => img.name && img.url);
        setFirebaseImages(imgs);
      } catch (e) {
        console.warn('Failed to fetch images from Firestore:', e);
        setFirebaseImages([]);
      }
    }
    fetchFirebaseImages();
  }, []);

  // ==================== OPTIMIZED: Load bookmarks (remove real-time listener) ====================
  useEffect(() => {
    const loadUserBookmarks = async (user) => {
      if (!user) {
        setBookmarks(new Set());
        return;
      }

      try {
        const listRef = doc(db, 'userBookmarks', user.uid);
        const [listSnap, subsSnap] = await Promise.all([
          getDoc(listRef),
          getDocs(collection(db, 'users', user.uid, 'bookmarks')).catch(() => ({ empty: true, docs: [] }))
        ]);

        // Merge ids from userBookmarks doc and subcollection
        const merged = new Set();

        if (listSnap.exists()) {
          (listSnap.data().bookmarks || []).forEach(id => merged.add(String(id)));
        }
        subsSnap.docs.forEach(d => merged.add(String(d.id)));

        // Create or backfill the list doc so Dashboard can read it too
        if (!user || !user.uid) {
          console.error("User is not authenticated.");
          return;
        }
        const bookmarkIds = Array.from(merged).filter(id => typeof id === "string" || typeof id === "number");
        await setDoc(
          listRef,
          {
            userId: user.uid,
            bookmarks: bookmarkIds,
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );

        setBookmarks(merged);
      } catch (e) {
        console.warn('Failed to load bookmarks:', e);
        setBookmarks(new Set());
      }
    };

    const unsubAuth = auth.onAuthStateChanged(async (user) => {
      setCurrentUser(user || null);
      await loadUserBookmarks(user);
    });

    return () => {
      if (typeof unsubAuth === 'function') unsubAuth();
    };
  }, []);

  // Regions/Categories derived from Firestore data
  const categoriesMemo = useMemo(() => {
    const s = new Set();
    destinations.forEach((d) => (d.categories || []).forEach((c) => s.add(c || '')));
    return [...s].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
  }, [destinations]);

  const fareOptions = [
  { type: 'sea', label: '₱500 - ₱850+ (Sea Travel: short routes)', value: 'sea-short' },
  { type: 'sea', label: '₱1,100 - ₱7,100+ (Sea Travel: long routes)', value: 'sea-long' },
  { type: 'air', label: '₱1,500 - ₱4,000+ (Air Travel: short routes)', value: 'air-short' },
  { type: 'air', label: '₱2,500 - ₱8,600+ (Air Travel: long routes)', value: 'air-long' },
];

  const getFareLabel = (val) => fareOptions.find(f => f.value === val)?.label || '';

// Compute the highest fare selected
const selectedFareAmounts = selectedFares
  .map(val => {
    const label = getFareLabel(val);
    return parseFareRange(label);
  })
  .filter(Boolean);

const totalSelectedFare = selectedFareAmounts.length > 0
  ? selectedFareAmounts.reduce((sum, v) => sum + v, 0)
  : 0;

// Compute total price (base + max fare)
const getTotalPrice = (basePrice) => {
  let base = 0;
  if (typeof basePrice === 'number') base = basePrice;
  else if (typeof basePrice === 'string') {
    const digits = basePrice.replace(/[^\d]/g, '');
    base = digits ? Number(digits) : 0;
  }
  return base + totalSelectedFare;
};

  const allCategories = useMemo(() => {
    const set = new Set();
    categories.forEach((c) => set.add(c));
    (categoriesMemo || []).forEach((c) => set.add(c));
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b)));
  }, [categories, categoriesMemo]);
  
  // Filter + sort
  const filtered = useMemo(() => {
    let list = destinations.filter(
      (d) => String(d.status || '').toUpperCase() === 'PUBLISHED'
    );
    
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

  useEffect(() => {
    setPage(1);
  }, [query, selectedRegions, selectedPrice, selectedCats, sortBy]);

  const totalPages = totalCount ? Math.max(1, Math.ceil(totalCount / pageSize)) : 999;
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, filtered.length);
  const pageItems = useMemo(() => filtered.slice(start, end), [filtered, start, end]);

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const goToPage = (target) => {
    setPage(target);
    // Immediately scroll to top - use multiple methods for browser compatibility
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    
    // Also force scroll after React renders the new page
    setTimeout(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }, 0);
  };

  const Pager = () => {
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(start + pageSize, filtered.length);
    
    return (
      <div className="bp2-pager" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', margin: '12px 0' }}>
        <div className="bp2-pager-info" style={{ color: '#475569', fontSize: 14 }}>
          {filtered.length > 0 ? `Showing ${start}–${end} results` : 'No destinations found'}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="next-page-btn" onClick={() => goToPage(1)} disabled={!canPrev}>« First</button>
          <button className="next-page-btn" onClick={() => goToPage(page - 1)} disabled={!canPrev}>‹ Prev</button>
          <span style={{ padding: '6px 10px', fontSize: 14 }}>Page {page}</span>
          <button className="next-page-btn" onClick={() => goToPage(page + 1)} disabled={!canNext}>Next ›</button>
          <button className="next-page-btn" onClick={() => goToPage(page + 10)} disabled={!canNext}>Last »</button>
        </div>
      </div>
    );
  };

  const toggleSet = (setter, value) =>
    setter((prev) => {
      const n = new Set(prev);
      n.has(value) ? n.delete(value) : n.add(value);
      return n;
    });

  // ==================== OPTIMIZED: Toggle bookmark (remove listener, use optimistic updates) ====================
  const toggleBookmark = useCallback(async (dest) => {
    const user = auth.currentUser;
    if (!user) {
      alert('Please sign in to bookmark destinations.');
      return;
    }
    
    const listRef = doc(db, 'userBookmarks', user.uid);
    const userDocRef = doc(db, 'users', user.uid);
    const bookmarkDocRef = doc(db, 'users', user.uid, 'bookmarks', dest.id);

    const isBookmarked = bookmarks.has(dest.id);

    // Optimistic update
    setBookmarks(prev => {
      const newSet = new Set(prev);
      if (isBookmarked) {
        newSet.delete(dest.id);
      } else {
        newSet.add(dest.id);
      }
      return newSet;
    });

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
          await logActivity(`Removed "${dest.name}" from bookmarks`, "💔");
        } catch (e) {
          console.warn('delete bookmark skipped:', e.code || e.message);
        }
      } else {
        try {
          await setDoc(
            bookmarkDocRef,
            {
              destId: dest.id,
              name: dest.name,
              region: dest.region || '',
              location: dest.location || '',
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
          
          await logActivity(`Bookmarked "${dest.name}"`, "⭐");
          
          const userBookmarksSnap = await getDoc(listRef);
          const bookmarksList = userBookmarksSnap.data()?.bookmarks || [];
          if (bookmarksList.length === 1) {
            await unlockAchievement(2, "First Bookmark");
          }
        } catch (e) {
          console.warn('upsert bookmark skipped:', e.code || e.message);
        }
      }
    } catch (e) {
      console.error('Toggle bookmark failed:', e);
      // Rollback optimistic update
      setBookmarks(prev => {
        const newSet = new Set(prev);
        if (isBookmarked) {
          newSet.add(dest.id);
        } else {
          newSet.delete(dest.id);
        }
        return newSet;
      });
      alert('Could not update bookmark. Please try again.');
    }
  }, [bookmarks]);

    function getFirebaseImageForDestination(firebaseImages, destName) {
      if (!destName) return null;
      const normalized = destName.trim().toLowerCase();
      const found = firebaseImages.find(img =>
        (img.name && img.name.trim().toLowerCase() === normalized) ||
        (img.publicId && img.publicId.trim().toLowerCase() === normalized)
      );
      return found && found.url ? found.url : null;
    }

  // ==================== OPTIMIZED: Load ratings only for visible items ====================
  useEffect(() => {
    let cancelled = false;
    
    const loadAverages = async () => {
      const itemsNeedingRatings = pageItems.filter(d => !ratingsByDest[d.id]);
      
      if (itemsNeedingRatings.length === 0) return;

      try {
        const entries = await Promise.all(
          itemsNeedingRatings.map(async (d) => {
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
              console.warn('ratings read skipped for', d.id);
              return [d.id, { avg: 0, count: 0 }];
            }
          })
        );
        
        if (!cancelled) {
          setRatingsByDest((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
        }
      } catch (e) {
        console.error('Load averages failed', e);
      }
    };
    
    loadAverages();
    
    return () => { cancelled = true; };
  }, [pageItems]); // Only load for current page

  const avgText = (id) => {
    const r = ratingsByDest[id];
    return r && r.count > 0 ? r.avg.toFixed(1) : '—';
  };

  // Load viewed destinations
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

    const newViewed = new Set(viewedDestinations);
    const wasNew = !newViewed.has(d.id);
    newViewed.add(d.id);
    setViewedDestinations(newViewed);

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

    if (newViewed.size >= 10) {
      try {
        await unlockAchievement(7, "Explorer at Heart");
      } catch (error) {
        console.error("Error unlocking achievement:", error);
      }
    }

    try {
      const u = auth.currentUser;
      if (!u) { setUserRating(0); return; }
      const rref = doc(db, 'destinations', d.id, 'ratings', u.uid);
      const rsnap = await getDoc(rref);
      setUserRating(Number(rsnap.data()?.value || 0));
    } catch {
      setUserRating(0);
    }

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
  };

  const closeDetails = () => {
    setModalOpen(false);
    setSelected(null);
    setUserRating(0);
  };

  const handleModalBookmarkClick = async () => {
    const user = auth.currentUser;
    if (!user) { alert('Please sign in to bookmark destinations.'); return; }
    if (!selected) return;

    setBookmarking(true);
    try {
      await toggleBookmark(selected);
    } catch (e) {
      console.error('Bookmark toggle failed:', e);
      alert('Could not update bookmark. Please try again.');
    } finally {
      setBookmarking(false);
    }
  };

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
        name: selected.name || '',
      }, { merge: true });

      setUserRating(v);

      const userRatingRef = doc(db, 'users', u.uid, 'ratings', String(selected.id));
      await setDoc(
        userRatingRef,
        {
          destId: String(selected.id),
          value: v,
          updatedAt: serverTimestamp(),
          name: selected.name || '',
        },
        { merge: true }
      );

      const rsnap = await getDocs(collection(db, 'destinations', String(selected.id), 'ratings'));
      let sum = 0, count = 0;
      rsnap.forEach((r) => { const val = Number(r.data()?.value) || 0; if (val > 0) { sum += val; count += 1; } });
      const avg = count ? sum / count : 0;

      setRatingsByDest((m) => ({ ...m, [selected.id]: { avg, count } }));
      setDestinations((prev) => prev.map((x) => (x.id === selected.id ? { ...x, rating: avg } : x)));
    } catch (e) {
      console.error('Save rating failed:', e);
      alert('Failed to save rating.');
    } finally {
      setSavingRating(false);
    }
  };

  const addToTripFromBookmarks = async (dest) => {
    setAddingTripId(dest.id);
    try {
      const user = auth.currentUser;
      if (!user) {
        alert('Please sign in to add to My Trips.');
        return;
      }

      const destinationData = {
        id: dest.id,
        name: dest.name || '',
        display_name: dest.name || '',
        region: dest.region || '',
        location: dest.location || '',
        description: dest.description || '',
        lat: dest.lat || dest.latitude,
        lon: dest.lon || dest.longitude,
        place_id: dest.place_id || dest.id,
        rating: dest.rating || 0,
        price: dest.price || '',
        priceTier: dest.priceTier || null,
        tags: Array.isArray(dest.tags) ? dest.tags : [],
        categories: Array.isArray(dest.categories) ? dest.categories : [],
        bestTime: dest.bestTime || '',
        image: dest.image || '',
      };

      await addTripForCurrentUser(destinationData);

      await trackDestinationAdded(user.uid, {
        id: dest.id,
        name: dest.name,
        region: dest.region,
        location: dest.location,
      });

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

      try {
        await setDoc(
          doc(db, 'users', user.uid, 'trips', String(dest.id)),
          {
            destId: String(dest.id),
            name: dest.name || '',
            region: dest.region || '',
            location: dest.location || '',
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
        navigate('/itinerary');
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

  const formatPeso = (v) => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'number') return '₱' + v.toLocaleString();
    if (typeof v === 'string') {
      if (v.trim().startsWith('₱')) return v;
      const digits = v.replace(/[^\d]/g, '');
      return digits ? '₱' + Number(digits).toLocaleString() : v;
    }
    return '—';
  };

  useEffect(() => {
    fetchCloudinaryImages().then(setCloudImages);
  }, []);

  // Replace the loadFiltersData function (around line 285-310) with this optimized version:

  const loadFiltersData = async () => {
    try {
      // DON'T fetch all destinations for regions!
      // Instead, use a hardcoded list or a separate 'regions' collection
      
      // Option 1: Hardcoded regions (BEST - 0 reads)
      const philippineRegions = [
        'CAR - Cordillera Administrative Region',
        'NCR - National Capital Region',
        'Region I - Ilocos Region',
        'Region II - Cagayan Valley',
        'Region III - Central Luzon',
        'Region IV-A - CALABARZON',
        'Region IV-B - MIMAROPA',
        'Region V - Bicol Region',
        'Region VI - Western Visayas',
        'Region VII - Central Visayas',
        'Region VIII - Eastern Visayas',
        'Region IX - Zamboanga Peninsula',
        'Region X - Northern Mindanao',
        'Region XI - Davao Region',
        'Region XII - SOCCSKSARGEN',
        'Region XIII - Caraga',
        'BARMM - Bangsamoro Autonomous Region in Muslim Mindanao'
      ];
      
      setRegions(philippineRegions);

      // Load categories from the 'categories' collection (much smaller, ~10-20 reads)
      const categoriesSnap = await getDocs(collection(db, 'categories'));
      const cats = categoriesSnap.docs.map(doc => doc.data().name).filter(Boolean);
      setCategories(cats.sort((a, b) => a.localeCompare(b)));
      
      console.log(`✅ Loaded ${philippineRegions.length} regions and ${cats.length} categories`);
    } catch (e) {
      console.warn('Failed to load filters:', e);
      setRegions([]);
      setCategories([]);
    }
  };

  // ==================== CACHING: Load total count ====================
  useEffect(() => {
    let cancelled = false;

    const loadTotalCount = async () => {
      // Get total count ONLY when needed
      let count = destinationCache.totalCount;

      // Only fetch total count if we don't have it cached
      if (!count) {
        console.log('📊 Fetching total count (one-time)...');
        
        try {
          // Use aggregation query (1 read instead of 900+)
          const countQuery = fsQuery(
            collection(db, 'destinations'),
            fsWhere('status', 'in', ['published', 'PUBLISHED'])
          );
          
          // Get count without fetching all documents
          const snapshot = await getCountFromServer(countQuery);
          count = snapshot.data().count;
          
          destinationCache.totalCount = count;
          
          // Cache to localStorage
          try {
            localStorage.setItem('destinations_total_count', JSON.stringify({
              count,
              timestamp: Date.now()
            }));
          } catch (e) {
            console.warn('Failed to cache count');
          }
          
          console.log(`📊 Total count: ${count}`);
        } catch (error) {
          console.error('Failed to get count:', error);
          // Fallback: estimate based on page size
          count = pageSize * 50; // Rough estimate
        }
      }

      // When filters are active, estimate count instead of fetching
      if (selectedRegions.size > 0 || selectedPrice || selectedCats.size > 0 || query) {
        // Don't fetch exact count for filtered results
        // Instead, use "Showing X results" without total
        count = null; // Will show "Showing 1-21 of many results"
      }

      if (!cancelled) {
        setTotalCount(count);
      }
    };

    loadTotalCount();

    return () => { cancelled = true; };
  }, [query, selectedRegions, selectedPrice, selectedCats, sortBy]); // Rerun if filters or sort change

  // Add this useEffect after state declarations:
  useEffect(() => {
    // Load cached total count on mount
    try {
      const cached = localStorage.getItem('destinations_total_count');
      if (cached) {
        const { count, timestamp } = JSON.parse(cached);
        // Use cached count if less than 1 day old
        if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
          destinationCache.totalCount = count;
          setTotalCount(count);
          console.log('✅ Loaded cached total count:', count);
        }
      }
    } catch (e) {
      console.warn('Failed to load cached count');
    }
  }, []);

  // MOVE handleCopyToMyItinerary INSIDE the component (before the return statement)
  const handleCopyToMyItinerary = useCallback(async (shared) => {
    const user = auth.currentUser;
    if (!user || !shared) return;
    if (!shared.items || shared.items.length === 0) return;
    
    try {
      setCopyingId(shared.id); // Now this works!
      const batch = writeBatch(db);
      
      for (const it of shared.items) {
        const { id: sharedItemId, ...payload } = it;
        const destRef = doc(collection(db, "itinerary", user.uid, "items"));
        batch.set(destRef, {
          ...payload,
          location: it.location || '',
          importedAt: serverTimestamp(),
          isShared: false,
          sharedFrom: shared.id
        });
      }
      
      await batch.commit();
      await updateDoc(doc(db, "sharedItineraries", shared.id), {
        lastUpdated: serverTimestamp()
      });
      
      alert('Itinerary copied successfully!');
      navigate('/itinerary');
    } catch (e) {
      console.error("Copy to My Itinerary failed:", e);
      alert("Failed to copy. Please try again.");
    } finally {
      setCopyingId(null); // Now this works too!
    }
  }, [navigate]);
  const DETAILS_HERO_HEIGHT = 240;

  // Zoom effect for details modal
  useEffect(() => {
    const detailsModal = document.querySelector('.details-modal');
    if (detailsModal && modalOpen) {
      detailsModal.style.zoom = '100%';
    }
    return () => {
      if (detailsModal) {
        detailsModal.style.zoom = '100%';
      }
    };
  }, [modalOpen]);

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
              <div className="grid-card-anim">
              <div className="grid-card" key={d.id}>
                <div className="card-image">
                  {cloudImages.length === 0 ? (
                    <div style={{ width: "100%", height: 150, background: "#e0e7ef" }}>Loading...</div>
                  ) : (
                    (() => {
                      const cloudUrl = getImageForDestination(cloudImages, d.name);
                      const firebaseUrl = getFirebaseImageForDestination(firebaseImages, d.name);
                      const imgUrl = cloudUrl || firebaseUrl;
                      return imgUrl ? (
                        <img
                          src={imgUrl}
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
                      );
                    })()
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
                    <span>⭐</span> {Number(d.rating || 0) > 0 ? Number(d.rating).toFixed(1) : '0'}
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

            <div className="details-hero1"
              style={{
                // make the hero occupy normal flow with a fixed height so the body starts below it
                minHeight: DETAILS_HERO_HEIGHT,
                position: 'relative',
                zIndex: 1,
              }}>
                    <div className="details-hero-image"
                    style={{ height: DETAILS_HERO_HEIGHT }}>
                      {cloudImages.length === 0 ? (
                        <div style={{ width: "100%", height: DETAILS_HERO_HEIGHT, background: "#e0e7ef", borderRadius: 16  }} />
                      ) : (
                        (() => {
                          const cloudUrl = getImageForDestination(cloudImages, selected.name);
                          const firebaseUrl = getFirebaseImageForDestination(firebaseImages, selected.name);
                          const imgUrl = cloudUrl || firebaseUrl;
                          return imgUrl ? (
                            <img
                              src={imgUrl}
                              alt={selected.name}
                              style={{
                                width: "100%",
                                height: 240,
                                objectFit: "cover",
                                objectPosition: "center",
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
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 48,
                                marginBottom: 8
                              }}
                            >
                              🏝️
                            </div>
                          );
                        })()
                      )}
                    </div>
                  </div>

                    <div className="details-body1">
                      <div className="details-head-row"
                      >
                      <div className="details-title-col">
                        <h2 className="details-title">{selected.name}</h2>
                        <a href="https://maps.google.com" className="details-region" onClick={(e) => e.preventDefault()}>
                        {selected.region}
                        </a>

                        <div className="details-rating-row">
                        <span className="star">⭐</span>
                        <span className="muted">
                          {(ratingsByDest[selected.id]?.count ?? 0) > 0
                          ? (ratingsByDest[selected.id].avg).toFixed(1)
                          : '0'}
                        </span>
                        <span className="muted"> (Average Rating)</span>
                        <span className="muted">
                          ({ratingsCountByDest[selected.id] !== undefined
                            ? ratingsCountByDest[selected.id]
                            : 0} ratings)
                        </span>
                        <span className="muted sep">Rating:</span>
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
                        <span className="muted sep">
                          Reviews: {
                            userReviewsCountByDest[selected.id] !== undefined
                              ? userReviewsCountByDest[selected.id]
                              : 0
                          }
                        </span>
                      </div>
                      </div>
                      <div className="details-actions1">
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

                    <div className="section-title">Price Breakdown:</div>
                    <div style={{ fontWeight: '300', fontStyle: 'italic', justifyContent: 'left', textAlign: 'left', marginBottom: '10px' }}>Price may vary on different factors</div>
                    <div className="breakdown-box">
                    {(() => {
                      // Use budget if available, otherwise use price
                      const budgetOrPrice = selected.budget || selected.price;
                      if (!budgetOrPrice) return null;

                      const breakdownArr = getBreakdown(budgetOrPrice);
                      if (!breakdownArr.length) return <span>No breakdown available.</span>;
                      return (
                        <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.6', justifyContent: 'left', textAlign: 'left' }}>
                          {breakdownArr.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      );
                    })()}
                    </div>
                    <div className="section-title">Additional Fees:</div>
                    <div style={{ fontWeight: '300', fontStyle: 'italic', justifyContent: 'left', textAlign: 'left', marginBottom: '10px' }}>Price may vary on different class</div>
                    <div className="breakdown-box" style={{textAlign: 'left'}}>
                      {/* NEW: Fare checkboxes */}
                      <div style={{ marginBottom: 10 }}>
                        {fareOptions.map(opt => (
                          <label key={opt.value} style={{ display: 'block', marginBottom: 2, fontWeight: 'normal', fontSize: 14 }}>
                            <input
                              type="checkbox"
                              checked={selectedFares.includes(opt.value)}
                              onChange={e => {
                                setSelectedFares(prev => {
                                  if (e.target.checked) return [...prev, opt.value];
                                  return prev.filter(v => v !== opt.value);
                                });
                              }}
                            />
                            <span style={{ marginLeft: 6 }}>{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    
                  {selected && (
                    <div style={{ marginBottom: 24 }}>
                      <div className="section-title" style={{ marginBottom: 8 }}>User Reviews</div>
                      <ReviewsList destId={selected.id} currentUser={currentUser} />
                    </div>
                  )}
                  
                  <div className="section-title">Write a Review</div>
                  <div
                    className="review-box"
                    style={{
                      width: '100%',          // fill available width
                      gridColumn: '1 / -1',   // span all columns of the parent grid
                      marginBottom: 18,
                      zIndex: 1
                    }}
                  >
                  <WriteReview
                    destId={selected.id}
                    user={currentUser}
                    onReviewSaved={() => {
                      // Optionally reload reviews or show a message
                      // Refresh user reviews count after submit
                      (async () => {
                        try {
                          const reviewsSnap = await getDocs(collection(db, 'destinations', selected.id, 'reviews'));
                          setUserReviewsCountByDest(prev => ({
                            ...prev,
                            [selected.id]: reviewsSnap.size || 0
                          }));
                        } catch (e) {}
                      })();
                    }}
                  />
                  </div>

                  <div className="section-title">Packing Suggestions</div>
                  <div className="packing-box">
                    {(() => {
                      if (!selected) return <div className="packing-empty">No packing suggestions available.</div>;

                      let raw = selected.packingSuggestions || selected.packing || "";
                      if (Array.isArray(raw) && raw.length > 0) {
                        return (
                          <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.6', textAlign: 'left' }}>
                            {raw.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        );
                      }
                      if (typeof raw === "string" && raw.trim().length > 0) {
                        // Split by line or bullet for display
                        const lines = raw.split(/[\n•\-*]/).map(l => l.trim()).filter(Boolean);
                        if (lines.length > 0) {
                          return (
                            <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.6', textAlign: 'left' }}>
                              {lines.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                          );
                        }
                      }

                      const { category: packingCategory } = require('./rules');
                      let cats =
                        Array.isArray(selected.category)
                          ? selected.category
                          : Array.isArray(selected.categories)
                          ? selected.categories
                          : typeof selected.category === "string"
                          ? [selected.category]
                          : typeof selected.categories === "string"
                          ? [selected.categories]
                          : [];

                      let found = [];
                      for (let c of cats) {
                        if (!c) continue;
                        const key = c.trim().toLowerCase();
                        if (packingCategory[key]) {
                          found = packingCategory[key];
                          break;
                        }
                        const singular = key.endsWith("s") ? key.slice(0, -1) : key;
                        if (packingCategory[singular]) {
                          found = packingCategory[singular];
                          break;
                        }
                      }
                      if (found.length > 0) {
                        return (
                          <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.6', textAlign: 'left' }}>
                            {found.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        );
                      }

                      return <div className="packing-empty">No packing suggestions available.</div>;
                    })()}
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
                      {/* CHANGED: show total price if fare selected */}
                      {selectedFares.length > 0
                        ? `₱${getTotalPrice(selected.price).toLocaleString()}`
                        : formatPeso(selected.price)}
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
                  
                  <div className="trip-item">
                    <div className="trip-label">Location</div>
                    <div className="badge-row">
                      {selected.location ? (
                        <span className="badge blue">{selected.location}</span>
                      ) : (
                        <span className="badge blue">No location  </span>
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

// Around line 420-450, update SharedEditModal form state to include location:
export function SharedEditModal({ initial, onSave, onClose }) {
  const [notif, setNotif] = useState("");
  const [form, setForm] = useState({
    name: initial?.name || "",
    region: initial?.region || "",
    location: initial?.location || "", // ADD THIS
    status: initial?.status || "Upcoming",
    arrival: initial?.arrival || "",
    departure: initial?.departure || "",
    transport: initial?.transport || "",
    estimatedExpenditure: initial?.estimatedExpenditure ?? initial?.budget ?? 0,
    accomType: initial?.accomType || "",
    accomName: initial?.accomName || "",
    accomNotes: initial?.accomNotes || "",
    activities: initial?.activities || [],
    activityDraft: "",
    transportNotes: initial?.transportNotes || "",
    notes: initial?.notes || "",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setNotif("");
    try {
      await onSave(form);
      setNotif("Saved successfully!");
      setTimeout(onClose, 1000);
    } catch (error) {
      console.error("Save error:", error);
      setNotif("Failed to save. Please try again.");
    }
  };

  const modalContent = (
    <div className="itn-modal-backdrop" onClick={onClose}>
      <form className="itn-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="itn-modal-header">
          <div className="itn-modal-title">Edit Shared Destination</div>
          <button type="button" className="itn-close" onClick={onClose}>×</button>
        </div>

        <div className="itn-modal-body">
          <div className="itn-form-grid">
            <div className="itn-form-col">
              <div className="itn-grid">
                <label className="itn-field">
                  <span className="itn-label">Destination Name</span>
                  <input
                    className="itn-input"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="City or place name"
                  />
                </label>
                <label className="itn-field">
                  <span className="itn-label">Country/Region</span>
                  <input
                    className="itn-input"
                    name="region"
                    value={form.region}
                    onChange={handleChange}
                    placeholder="Region"
                  />
                </label>
                {/* ADD THIS NEW FIELD */}
                <label className="itn-field">
                  <span className="itn-label">Location</span>
                  <input
                    className="itn-input"
                    name="location"
                    value={form.location}
                    onChange={handleChange}
                    placeholder="Specific location"
                  />
                </label>
              </div>

              {/* ...rest of the form stays the same... */}
            </div>

            {/* ...second column stays the same... */}
          </div>
        </div>

        <div className="itn-modal-footer">
          <button type="button" className="itn-btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="itn-btn primary">Save Details</button>
        </div>
        {notif && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "#6c63ff", color: "#fff", padding: "8px 16px", borderRadius: 8, zIndex: 10001 }}>
            {notif}
          </div>
        )}
      </form>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
}

// Around line 700-750, update shareItinerary to include location:
export async function shareItinerary(user, items, itemIds, friendIds) {
  if (!user || !itemIds.length || !friendIds.length) {
    console.error("Missing required data for sharing:", { user: !!user, itemsCount: itemIds.length, friendsCount: friendIds.length });
    return;
  }
  
  console.log("Starting share operation:", { itemIds, friendIds });
  
  try {
    await ensureCollectionExists("sharedItineraries");
    await ensureCollectionExists("notifications");
    
    const itemsToShare = items.filter(item => itemIds.includes(item.id));
    const sharedDocRef = doc(collection(db, "sharedItineraries"));
    const timestamp = serverTimestamp();
    const sharedWithAll = Array.from(new Set([...friendIds, user.uid]));

    await setDoc(sharedDocRef, {
      sharedBy: user.uid,
      sharedWith: sharedWithAll,
      sharedAt: timestamp,
      name: `Shared by ${user.displayName || user.email || 'a friend'}`,
      itemCount: itemIds.length,
      collaborative: true,
      lastUpdated: timestamp,
      owner: {
        uid: user.uid,
        name: user.displayName || user.email || 'Unknown',
        photoURL: user.photoURL || null
      }
    });

    const batch = writeBatch(db);
    const idMap = [];
    for (const item of itemsToShare) {
      const { id: originalId, ...rest } = item;
      const itemRef = doc(collection(db, "sharedItineraries", sharedDocRef.id, "items"));
      idMap.push({ originalId, sharedItemId: itemRef.id });
      batch.set(itemRef, {
        ...rest,
        location: item.location || '', // ADD THIS - Ensure location is included
        originalId,
        sharedAt: timestamp,
        lastEditedBy: user.uid,
        lastEditedByName: user.displayName || user.email || 'Owner',
        updatedAt: timestamp
      });
    }
    await batch.commit();

    const delBatch = writeBatch(db);
    for (const m of idMap) {
      delBatch.delete(doc(db, "itinerary", user.uid, "items", m.originalId));
    }
    await delBatch.commit();
    console.log("Moved items to shared itinerary and removed personal copies");
    
    // Log activity for sharing itinerary
    await logActivity(
      `Shared itinerary with ${friendIds.length} friend${friendIds.length > 1 ? 's' : ''} (${itemIds.length} destination${itemIds.length > 1 ? 's' : ''})`,
      "🔗"
    );
    
    await checkMiniPlannerAchievement(user);
    
    const notificationBatch = writeBatch(db);
    for (const friendId of friendIds) {
      try {
        const notifRef = doc(collection(db, "notifications"));
        notificationBatch.set(notifRef, {
          userId: friendId,
          type: "ITINERARY_SHARED",
          message: `${user.displayName || user.email || 'A friend'} shared an itinerary with you`,
          read: false,
          createdAt: timestamp,
          data: {
            sharedBy: user.uid,
            sharedByName: user.displayName || user.email || 'Friend',
            sharedById: user.uid,
            itemCount: itemIds.length,
            itineraryId: sharedDocRef.id
          }
        });
      } catch (notifErr) {
        console.error(`Error preparing notification: ${notifErr.message}`, notifErr);
      }
    }
    
    await notificationBatch.commit();
    console.log(`Created notifications for ${friendIds.length} friends`);
    console.log("Share operation completed successfully");
    return sharedDocRef.id;
  } catch (err) {
    console.error("Error sharing itinerary:", err);
    throw err;
  }
}

function WriteReview({ destId, user, onReviewSaved }) {
  const [review, setReview] = useState('');
  const [star, setStar] = useState(0); // NEW: star rating state
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function checkExistingReview() {
      if (!user || !destId) {
        setAlreadyReviewed(false);
        return;
      }
      try {
        const reviewDoc = await getDoc(doc(db, "destinations", String(destId), "reviews", user.uid));
        if (!ignore) setAlreadyReviewed(reviewDoc.exists());
      } catch {
        if (!ignore) setAlreadyReviewed(false);
      }
    }
    checkExistingReview();
    return () => { ignore = true; };
  }, [user, destId, success]);

const handleSubmit = async (e) => {
  e.preventDefault();
  setSaving(true);
  setError('');
  setSuccess('');
  try {
    if (!user) throw new Error("You must be signed in to write a review.");
    if (!review.trim()) throw new Error("Review cannot be empty.");
    if (star < 1 || star > 5) throw new Error("Please select a star rating.");
    if (alreadyReviewed) throw new Error("You have already submitted a review for this destination.");
    const reviewData = {
      userId: user.uid,
      userName: user.displayName || user.email || "Anonymous",
      review: review.trim(),
      rating: star, // NEW: save star rating
      createdAt: new Date().toISOString(),
    };
    // Save review
    await setDoc(
      doc(db, "destinations", String(destId), "reviews", user.uid),
      reviewData,
      { merge: true }
    );
    // Save rating in ratings subcollection (for aggregation)
    await setDoc(
      doc(db, "destinations", String(destId), "ratings", user.uid),
      {
        value: star,
        userId: user.uid,
        updatedAt: serverTimestamp(),
        name: user.displayName || user.email || "Anonymous",
      },
      { merge: true }
    );
    setSuccess("Review submitted!");
    setReview('');
    setStar(0);
    if (onReviewSaved) onReviewSaved();
  } catch (err) {
    setError(err.message || "Failed to submit review.");
    console.error("Firestore error:", err);
    console.log("destId:", destId);
    console.log("user:", user);
  } finally {
    setSaving(false);
  }
};

  if (alreadyReviewed && !success) {
    return (
      <div style={{ color: "#0862eaff", fontWeight: 500, marginBottom: 8 }}>
        You have already submitted a review for this destination.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontWeight: 500, fontSize: 13 }}>Your Rating:</span>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            type="button"
            onClick={() => setStar(n)}
            style={{
              background: 'none',
              border: 'none',
              cursor: alreadyReviewed || saving ? 'not-allowed' : 'pointer',
              fontSize: 18,
              color: n <= star ? '#ffb300' : '#d1d5db',
              padding: 0,
              marginRight: 2,
              transition: 'color 0.15s',
              outline: 'none'
            }}
            disabled={alreadyReviewed || saving}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
          >
            ★
          </button>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <textarea
          value={review}
          onChange={e => setReview(e.target.value)}
          placeholder={alreadyReviewed ? "You have already submitted a review." : "Write your review here..."}
          rows={3}
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            padding: 12,
            paddingRight: 50,
            fontSize: 15,
            resize: 'vertical'
          }}
          disabled={saving || alreadyReviewed}
        />
        <button
          type="submit"
          aria-label="Submit review"
          disabled={saving || !review.trim() || alreadyReviewed || star < 1}
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            width: 36,
            height: 36,
            borderRadius: '999px',
            background: 'transparent',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: saving || !review.trim() || alreadyReviewed || star < 1 ? 'not-allowed' : 'pointer',
            opacity: saving || !review.trim() || alreadyReviewed || star < 1 ? 0.6 : 1
          }}
        >
          <img src="send.png" alt="Send" style={{ width: 18, height: 18 }} />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {alreadyReviewed && !success && (
          <span style={{ color: "#0862eaff" }}>You have already submitted a review for this destination.</span>
        )}
        {success && <span style={{ color: "#22c55e" }}>{success}</span>}
        {error && <span style={{ color: "#e74c3c" }}>{error}</span>}
      </div>
    </form>
  );
}

function ReviewsList({ destId, currentUser }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userRating, setUserRating] = useState(null);

  useEffect(() => {
    let ignore = false;
    async function fetchReviews() {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "destinations", String(destId), "reviews"));
        let arr = [];
        snap.forEach(docSnap => {
          const data = docSnap.data();
          arr.push({
            id: docSnap.id,
            userName: data.userName || "Anonymous",
            review: data.review || "",
            createdAt: data.createdAt,
            userId: data.userId,
            rating: typeof data.rating === "number" ? data.rating : undefined,
          });
        });
        // Sort by newest first
        arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        if (!ignore) setReviews(arr);
      } catch {
        if (!ignore) setReviews([]);
      }
      setLoading(false);
    }
    if (destId) fetchReviews();
    return () => { ignore = true; };
  }, [destId]);

  // Fetch current user's star rating for this destination
  useEffect(() => {
    if (!currentUser || !destId) { setUserRating(null); return; }
    let ignore = false;
    async function fetchUserRating() {
      try {
        const ratingDoc = await getDoc(doc(db, "destinations", String(destId), "ratings", currentUser.uid));
        if (!ignore) setUserRating(Number(ratingDoc.data()?.value) || null);
      } catch {
        if (!ignore) setUserRating(null);
      }
    }
    fetchUserRating();
    return () => { ignore = true; };
  }, [currentUser, destId]);

  if (loading) return <div style={{ color: "#888", fontSize: 14 }}>Loading reviews…</div>;
  if (!reviews.length) return <div style={{ color: "#888", fontSize: 14 }}>No user reviews yet.</div>;

  // Separate current user's review if available
  let userReview = null;
  let otherReviews = reviews;
  if (currentUser) {
    userReview = reviews.find(r => r.userId === currentUser.uid);
    otherReviews = reviews.filter(r => r.userId !== currentUser.uid);
  }

  // Star rendering helper
  const renderStars = (rating,) => (
    <span style={{ marginLeft: 8, marginRight: 8 }}>
      {Array.from({ length: 5 }).map((_, idx) => (
        <span
          key={idx}
          style={{
            color: idx < rating ? "#ffb300" : "#d1d5db",
            fontSize: 18,
            marginRight: 2,
            verticalAlign: "middle",
            fontFamily: "Arial, sans-serif", // <-- add this             // <-- and this
          }}
        >
          ★
        </span>
      ))}
    </span>
  );

  // Card style for all reviews
  const cardStyle = {
    background: "#e0f7fa",
    border: "2px solid #38bdf8",
    borderRadius: 16,
    padding: "12px 16px",
    fontSize: 18,
    boxShadow: "0 1px 2px rgba(0,0,0,.03)",
    marginBottom: 0,
    marginTop: 0,
    marginLeft: 0,
    marginRight: 0,
    minWidth: 220,
    maxWidth: 600,
    width: "100%",
    boxSizing: "border-box"
  };

  const nameStyle = {
    fontWeight: 700,
    color: "#2196f3",
    fontSize: 14,
    marginRight: 10,
    marginBottom: 0,
    display: "inline-block"
  };

  const dateStyle = {
    color: "#6b7280",
    fontSize: 12,
    marginBottom: 0,
    display: "block",
    textAlign: "left",
  };

  const reviewTextStyle = {
    marginTop: 10,
    marginLeft: 15,
    marginBottom: 10,
    fontSize: 14,
    color: "#222",
    textAlign: "left",
    fontFamily: "inherit",
    fontWeight: 400,
    wordBreak: "break-word"
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Show current user's review first if available */}
      {userReview && (
        <div key={userReview.id} style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 0, flexWrap: "wrap" }}>
            <span style={nameStyle}>
              {userReview.userName} (You)
            </span>
            {renderStars(userRating ?? userReview.rating ?? 0, 24)}
          </div>
          <span style={dateStyle}>
            {userReview.createdAt ? new Date(userReview.createdAt).toLocaleString() : ""}
          </span>
          <div style={reviewTextStyle}>{userReview.review}</div>
        </div>
      )}
      {/* Show other users' reviews */}
      {otherReviews.map((r) => (
        <div key={r.id} style={{
          ...cardStyle,
          background: "#f8fafc",
          border: "1.5px solid #b6c7d6",
          color: "#222"
        }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 0, flexWrap: "wrap" }}>
            <span style={{ ...nameStyle, color: "#0d47a1" }}>{r.userName}</span>
            {renderStars(r.rating ?? 0, 22)}
          </div>
          <span style={dateStyle}>
            {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
          </span>
          <div style={reviewTextStyle}>{r.review}</div>
        </div>
      ))}
    </div>
  );
}