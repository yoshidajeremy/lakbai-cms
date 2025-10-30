import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp, addDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import {
  deleteDoc, collection, getDocs,
  orderBy, query as fsQuery, onSnapshot
} from 'firebase/firestore';
import './Styles/bookmark.css';
import { unlockAchievement } from './profile';
import { addTripForCurrentUser } from './Itinerary';
import { trackDestinationAdded } from './itinerary_Stats';
import destImages from './dest-images.json';
import { fetchCloudinaryImages, getImageForDestination } from "./image-router";
import { breakdown } from './rules';

// Add this helper function after the imports
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

function Bookmark() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('recent');
  const [selectedFares, setSelectedFares] = useState([]); // For fare checkboxes
  const [selectedCard, setSelectedCard] = useState(null);

  // Add-to-Trip state
  const [addingTripId, setAddingTripId] = useState(null);
  const [addedTripId, setAddedTripId] = useState(null);
  const [inTripCount, setInTripCount] = useState(0);

  // NEW: details modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [userRating, setUserRating] = useState(0);
  const [savingRating, setSavingRating] = useState(false);

  // NEW: average ratings loaded from destinations/{id}/ratings
  const [ratingsByDest, setRatingsByDest] = useState({});

  // Confirm "unbookmark"
  const [confirmingUnbookmark, setConfirmingUnbookmark] = useState(false);
  const confirmTimerRef = useRef(null);

  // NEW: UI confirm modal for "Clear All"
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);

  const [reviewsByDest, setReviewsByDest] = useState({});
  const [ratingsCountByDest, setRatingsCountByDest] = useState({});
  const [cloudImages, setCloudImages] = useState([]);
  const [firebaseImages, setFirebaseImages] = useState([]);
  const [userReviewsCountByDest, setUserReviewsCountByDest] = useState({});

  // NEW: app-themed error toast state
  const [errorMsg, setErrorMsg] = useState('');
  const errorTimerRef = useRef(null);
  const showError = (msg) => {
    setErrorMsg(String(msg || 'Something went wrong.'));
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMsg(''), 4000);
  };

  // clear pending confirm timer on unmount
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current); // NEW: clear toast timer
    };
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
    
    const formatPackingSuggestions = (text) => {
    if (!text) return "No packing suggestions available.";
    
    // Split by bullet points (•, -, or *)
    const lines = text
      .split(/[•\-*]/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (lines.length === 0) return "No packing suggestions available.";
    
    return lines;
  };

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

  useEffect(() => {
    fetchCloudinaryImages().then(setCloudImages);
  }, []);

  useEffect(() => {
    setLoading(true);
    const unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
      setCurrentUser(user || null);
      if (user) {
        await fetchBookmarkedDestinations(user.uid);
      } else {
        setItems([]);
      }
      setLoading(false);
    });
    return () => {
      if (typeof unsubscribeAuth === "function") {
        unsubscribeAuth();
      }
    };
  }, []);

  // NEW: live count of itinerary items for current user
  useEffect(() => {
    if (!currentUser) { setInTripCount(0); return; }
    const colRef = collection(db, 'itinerary', currentUser.uid, 'items');
    const unsubscribeSnapshot = onSnapshot(
      colRef,
      (snap) => setInTripCount(snap.size),
      () => setInTripCount(0)
    );
    return () => {
      if (typeof unsubscribeSnapshot === "function") {
        unsubscribeSnapshot();
      }
    };
  }, [currentUser]);

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

    function parseFareRange(str) {
    // Example: "₱2,500 - ₱5,000+ (long routes)"
    const match = str.match(/₱([\d,]+)\s*-\s*₱([\d,]+)/);
    if (!match) return 0;
    // Return the higher value as number
    return Number(match[2].replace(/,/g, ''));
  }
  const getTotalPrice = (basePrice) => {
    let base = 0;
    if (typeof basePrice === 'number') base = basePrice;
    else if (typeof basePrice === 'string') {
      const digits = basePrice.replace(/[^\d]/g, '');
      base = digits ? Number(digits) : 0;
    }
    return base + totalSelectedFare;
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

  function getBreakdown(price) {
    if (!price) return [];
    // Remove non-digits and leading ₱, commas, spaces
    const digits = String(price).replace(/[^\d]/g, '');
    if (!digits) return [];
    const key = `P${digits}`;
    return breakdown[key] || [];
  }


  // Read ONLY current user's bookmarks collection and merge with destination data if needed
  const fetchBookmarkedDestinations = async (uid) => {
    try {
      const colRef = collection(db, 'users', uid, 'bookmarks');
      const snap = await getDocs(fsQuery(colRef, orderBy('createdAt', 'desc')));
      const rows = await Promise.all(
        snap.docs.map(async (b) => {
          const data = b.data() || {};
          // Prefer data stored on the bookmark doc
          let merged = {};
          if (data.name && data.description) {
            merged = {
              id: b.id,
              ...data,
              savedAt: toDateSafe(data.createdAt || data.updatedAt),
            };
          } else {
            // Fallback: merge with source destination doc
            const dref = doc(db, 'destinations', b.id);
            const ddoc = await getDoc(dref);
            merged = {
              id: b.id,
              ...(ddoc.exists() ? ddoc.data() : {}),
              ...data,
              savedAt: toDateSafe(data.createdAt || data.updatedAt),
            };
          }
          // Attach image from dest-images.json if available and not already present
          if (!merged.image) {
            merged.image = getImageForDestination(merged.name);
          }
          return merged;
        })
      );
      
      const validRows = rows.filter(Boolean);
      
      setItems(validRows);
    } catch (e) {
      // console.error('Error fetching current user bookmarks:', e);
      showError('Failed to load your bookmarks.');
      setItems([]);
    }
  };

  const toDateSafe = (ts) => {
    try {
      // Firestore Timestamp -> Date
      if (ts && typeof ts.toDate === 'function') return ts.toDate();
      // ISO string
      if (typeof ts === 'string') return new Date(ts);
    } catch {}
    return null;
  };

  const handleExploreClick = () => navigate('/bookmarks2'); // ensure this exists

  // Remove bookmark (include userId to satisfy your rules)
  const removeBookmark = async (destinationId) => {
    try {
      if (!currentUser) { alert('Please login to manage bookmarks'); return; }
      
      // Get destination name before removing for activity log
      const dest = items.find(item => item.id === destinationId);
      const destName = dest?.name || "destination";
      
      await deleteDoc(doc(db, 'users', currentUser.uid, 'bookmarks', destinationId)).catch(() => {});
      const legacyRef = doc(db, 'userBookmarks', currentUser.uid);
      const legacyDoc = await getDoc(legacyRef);
      if (legacyDoc.exists()) {
        const list = legacyDoc.data().bookmarks || [];
        const updated = list.filter((id) => id !== destinationId);
        await setDoc(
          legacyRef,
          { userId: currentUser.uid, bookmarks: updated, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }
      
      // Log activity after successful removal
      await logActivity(`Removed "${destName}" from bookmarks`, "💔");
      
      setItems((prev) => prev.filter((d) => d.id !== destinationId));
    } catch (error) {
      showError('Failed to remove bookmark.');
      alert('Failed to remove bookmark. Please try again.');
    }
  };

  // Change Clear All to open modal instead of window.confirm
  const clearAllBookmarks = async () => {
    if (!currentUser) { alert('Please login to manage bookmarks'); return; }
    setConfirmClearOpen(true);
  };

  // NEW: run actual clear when user confirms in the modal
  const handleConfirmClear = async () => {
    if (!currentUser) { setConfirmClearOpen(false); alert('Please login to manage bookmarks'); return; }
    setIsClearingAll(true);
    try {
      const colRef = collection(db, 'users', currentUser.uid, 'bookmarks');
      const snap = await getDocs(colRef);
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      await setDoc(
        doc(db, 'userBookmarks', currentUser.uid),
        { userId: currentUser.uid, bookmarks: [], updatedAt: serverTimestamp() },
        { merge: true }
      );
      setItems([]);
      setConfirmClearOpen(false);
    } catch (e) {
      // console.error(e);
      showError('Failed to clear bookmarks.');
      alert('Failed to clear bookmarks.');
    } finally {
      setIsClearingAll(false);
    }
  };
  

  // Derived stats
  const stats = useMemo(() => {
    const total = items.length;
    const regions = new Set(items.map((d) => d.region || d.locationRegion || '').filter(Boolean));
    // Compute average rating from ratingsByDest for all bookmarks that have a rating
    const rated = items
      .map((d) => ratingsByDest[d.id]?.avg)
      .filter((v) => typeof v === 'number' && !isNaN(v));
    const avgRating = rated.length === 0 ? 0 : rated.reduce((s, v) => s + v, 0) / rated.length;
    return {
      total,
      regions: regions.size,
      avgRating: Number(avgRating.toFixed(1)),
      inTrip: inTripCount
    };
  }, [items, inTripCount, ratingsByDest]);

  // Sorting
  const sorted = useMemo(() => {
    const list = [...items];
    if (sortBy === 'name') return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (sortBy === 'rating') return list.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
    // recent: sort by savedAt desc
    return list.sort((a, b) => {
      const at = a.savedAt ? a.savedAt.getTime() : 0;
      const bt = b.savedAt ? b.savedAt.getTime() : 0;
      return bt - at;
    });
  }, [items, sortBy]);

  const fmtSaved = (d) => {
    if (!d) return 'Unknown';
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  };

  // sanitize object before Firestore write
  const clean = (obj) => {
    const out = {};
    Object.entries(obj || {}).forEach(([k, v]) => {
      if (v === undefined) return;              // Firestore rejects undefined
      if (Array.isArray(v)) out[k] = v.filter((x) => x !== undefined && x !== null && x !== '');
      else out[k] = v;
    });
    return out;
  };

  // Add to Trip — write via Itinerary helper to itinerary/{uid}/items
  const onAddToTrip = async (dest) => {
    const u = auth.currentUser;
    if (!u) { alert('Please sign in to add to My Trips.'); return; }
    setAddingTripId(dest.id);
    try {
      // Prepare the destination object with all required fields INCLUDING LOCATION
      const destinationData = {
        id: dest.id,
        name: dest.name || '',
        display_name: dest.name || '', // Itinerary expects display_name
        region: dest.region || dest.locationRegion || '',
        location: dest.location || '', // ADD THIS - Include location
        description: dest.description || '',
        lat: dest.lat || dest.latitude,
        lon: dest.lon || dest.longitude,
        place_id: dest.place_id || dest.id,
        rating: dest.rating || 0,
        price: dest.price || '',
        priceTier: dest.priceTier || null,
        tags: Array.isArray(dest.tags) ? dest.tags : [],
        categories: Array.isArray(dest.categories) ? dest.categories : [],
        bestTime: dest.bestTime || dest.best_time || '',
        image: dest.image || '',
      };

      console.log("[Bookmark] Adding to trip with location:", destinationData.location); // DEBUG

      await addTripForCurrentUser(destinationData);
      
      // Track destination added to itinerary
      await trackDestinationAdded(u.uid, {
        id: dest.id,
        name: dest.name,
        region: dest.region || dest.locationRegion,
        location: dest.location, // ADD THIS
        latitude: dest.lat || dest.latitude,
        longitude: dest.lon || dest.longitude,
      });
      
      // Log activity for adding to trip
      await logActivity(`Added "${dest.name}" to your trip itinerary`, "🗺️");
      
      setAddedTripId(dest.id);
      setTimeout(() => setAddedTripId(null), 1200);

      // parse estimated expenditure from price and save to users/{uid}/trips
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
          doc(db, 'users', u.uid, 'trips', String(dest.id)),
          {
            destId: String(dest.id),
            name: dest.name || '',
            region: dest.region || dest.locationRegion || '',
            location: dest.location || '', // ADD THIS - Save location to trips collection
            rating: dest.rating ?? null,
            price: dest.price || '',
            priceTier: dest.priceTier || null,
            estimatedExpenditure: estimated,
            tags: Array.isArray(dest.tags) ? dest.tags : [],
            categories: Array.isArray(dest.categories) ? dest.categories : [],
            bestTime: dest.bestTime || dest.best_time || '',
            image: dest.image || '',
            addedBy: u.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        console.log("[Bookmark] Saved to trips with location:", dest.location); // DEBUG
      } catch (e) {
        console.warn('users/{uid}/trips write skipped:', e.code || e.message);
      }
    } catch (e) {
      console.error('Failed to add to My Trips:', e);
      showError(`Failed to add to My Trips: ${e.message || 'Unknown error'}`);
    } finally {
      setAddingTripId(null);
    }
  };

  const openDetails = async (dest) => {
    setSelected(dest);
    setModalOpen(true);

    // Load user's rating for this destination from destinations/{id}/ratings/{uid}
    try {
      const u = auth.currentUser;
      if (!u) { setUserRating(0); return; }
      const rref = doc(db, 'destinations', dest.id, 'ratings', u.uid);
      const rsnap = await getDoc(rref);
      setUserRating(Number(rsnap.data()?.value || 0));
    } catch {
      setUserRating(0);
    }

    // Ensure we have average for the selected item
    if (!ratingsByDest[dest.id]) {
      try {
        const rsnap = await getDocs(collection(db, 'destinations', dest.id, 'ratings'));
        let sum = 0, count = 0;
        rsnap.forEach((r) => {
          const v = Number(r.data()?.value) || 0;
          if (v > 0) { sum += v; count += 1; }
        });
        const avg = count ? sum / count : 0;
        setRatingsByDest((m) => ({ ...m, [dest.id]: { avg, count } }));
      } catch (e) {
        // console.error('Load selected avg failed', e);
        showError('Failed to load ratings.');
      }
    }
  };

  const closeDetails = () => {
    setModalOpen(false);
    setSelected(null);
    // reset confirm state when modal closes
    setConfirmingUnbookmark(false);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  };

  const saveRating = async (value) => {
    const u = auth.currentUser;
    if (!u || !selected) return;
    setSavingRating(true);
    try {
      const v = Math.max(1, Math.min(5, Number(value) || 0));

      // Save under the destination's ratings subcollection (canonical for averages)
      await setDoc(
        doc(db, 'destinations', String(selected.id), 'ratings', u.uid),
        { value: v, userId: u.uid, updatedAt: serverTimestamp(), name: selected.name || '' }, // <-- add name
        { merge: true }
      );

      // Also keep a user copy (for user profile/achievements)
      await setDoc(
        doc(db, 'users', u.uid, 'ratings', String(selected.id)),
        {
          value: v,
          updatedAt: serverTimestamp(),
          name: selected.name || '', // <-- add name
          destId: String(selected.id)
        },
        { merge: true }
      );

      setUserRating(v);

      // Recompute and update the average for this destination
      const rsnap = await getDocs(collection(db, 'destinations', String(selected.id), 'ratings'));
      let sum = 0, count = 0;
      rsnap.forEach((r) => {
        const val = Number(r.data()?.value) || 0;
        if (val > 0) { sum += val; count += 1; }
      });
      const avg = count ? sum / count : 0;

      setRatingsByDest((m) => ({ ...m, [selected.id]: { avg, count } }));
    } catch (e) {
      showError('Failed to save rating.');
      alert('Failed to save rating.');
    } finally {
      setSavingRating(false);
    }
  };
  

  // Two-step confirm remove for Bookmarked button
  const handleBookmarkedClick = async () => {
    if (!currentUser) { alert('Please login to manage bookmarks'); return; }
    if (!selected) return;
    if (!confirmingUnbookmark) {
      setConfirmingUnbookmark(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmingUnbookmark(false), 2500);
      return;
    }
    
    // Get destination name for activity log BEFORE removing
    const destName = selected.name || "destination";
    
    try {
      await removeBookmark(selected.id);
      // Activity is already logged inside removeBookmark
      setConfirmingUnbookmark(false);
      closeDetails();
    } catch (e) {
      showError('Failed to remove bookmark.');
      setConfirmingUnbookmark(false);
      alert('Failed to remove bookmark. Please try again.');
    }
  };

  // Add bookmark or toggle bookmark status
  const toggleBookmark = async (destinationId) => {
    try {
      if (!currentUser) {
        alert('Please login to manage bookmarks');
        return;
      }
      
      const userRef = doc(db, 'userBookmarks', currentUser.uid);
      const docSnap = await getDoc(userRef);
      const isFirstBookmark = !docSnap.exists() || !(docSnap.data()?.bookmarks || []).length;
      
      const bookmarks = new Set(docSnap.data()?.bookmarks || []);
      const isRemoving = bookmarks.has(destinationId);
      
      // Get destination name for activity log
      const dest = items.find(item => item.id === destinationId);
      const destName = dest?.name || "destination";

      if (isRemoving) {
        bookmarks.delete(destinationId);
        await logActivity(`Removed "${destName}" from bookmarks`, "💔");
      } else {
        bookmarks.add(destinationId);
        await logActivity(`Bookmarked "${destName}"`, "⭐");
        
        // If this is the first bookmark, unlock achievement
        if (isFirstBookmark) {
          await unlockAchievement(2, "First Bookmark");
        }
      }

      // Update Firestore
      await setDoc(
        userRef,
        {
          userId: currentUser.uid,
          bookmarks: Array.from(bookmarks),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      // Update local state
      setItems(prev => prev.filter(item => item.id !== destinationId || !isRemoving));
      
    } catch (error) {
      console.error('Error toggling bookmark:', error);
      showError('Failed to update bookmark.');
    }
  };

  // NEW: transient pop animation state per card
  const [popIds, setPopIds] = useState({});
  const triggerCardPop = (id, duration = 180) => {
    setPopIds((m) => ({ ...m, [id]: true }));
    setTimeout(() => {
      setPopIds((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
    }, duration);
  };

  // NEW: track cards being removed while waiting for server
  const [removingIds, setRemovingIds] = useState({});
  const beginRemove = (id) => setRemovingIds((m) => ({ ...m, [id]: true }));
  const endRemove = (id) =>
    setRemovingIds((m) => {
      const n = { ...m };
      delete n[id];
      return n;
    });

  // Helper to get image URL by destination name
const getImageForDestination = (name) => {
  if (typeof name !== "string") return undefined;
  const found = destImages.find(
    img =>
      typeof img.name === "string" &&
      img.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  return found ? found.url : undefined;
};

  // Fetch and attach ratings for all bookmarks after loading items
  useEffect(() => {
    // Only run if there are items and not all ratings loaded
    const fetchAllRatings = async () => {
      const idsToFetch = items
        .map((d) => d.id)
        .filter((id) => !(ratingsByDest[id] && typeof ratingsByDest[id].avg === 'number'));
      if (idsToFetch.length === 0) return;
      const updates = {};
      for (const id of idsToFetch) {
        try {
          const rsnap = await getDocs(collection(db, 'destinations', id, 'ratings'));
          let sum = 0, count = 0;
          rsnap.forEach((r) => {
            const v = Number(r.data()?.value) || 0;
            if (v > 0) { sum += v; count += 1; }
          });
          const avg = count ? sum / count : 0;
          updates[id] = { avg, count };
        } catch {
          updates[id] = { avg: 0, count: 0 };
        }
      }
      if (Object.keys(updates).length > 0) {
        setRatingsByDest((prev) => ({ ...prev, ...updates }));
      }
    };
    if (items.length > 0) fetchAllRatings();
    // eslint-disable-next-line
  }, [items]);

  // Add this useEffect after your other useEffect hooks (around line 180, after the ratings fetch effect)
  useEffect(() => {
    const cardsContainer = document.querySelector('.bookmarks-grid');
    if (cardsContainer) {
      cardsContainer.style.zoom = '100%';
    }
    
    return () => {
      if (cardsContainer) {
        cardsContainer.style.zoom = '100%';
      }
    };
  }, [sorted]); // Re-run when sorted changes

  function getFirebaseImageForDestination(firebaseImages, destName) {
    if (!destName) return null;
    const normalized = destName.trim().toLowerCase();
    const found = firebaseImages.find(img =>
      (img.name && img.name.trim().toLowerCase() === normalized) ||
      (img.publicId && img.publicId.trim().toLowerCase() === normalized)
    );
    return found && found.url ? found.url : null;
  }

  return (
    <div className="App bm-page" aria-busy={loading}>
      {loading && (
        <div className="bm-loading-backdrop">
          <div className="bm-loading-container">
            <div className="bm-loading-icon-wrapper">
              <svg className="bm-pushpin-svg" viewBox="0 0 100 100" aria-hidden="true">
                <defs>
                  <radialGradient id="pinHeadGradient" cx="0.3" cy="0.3" r="0.7">
                    <stop offset="0%" stopColor="#ff8a8a" />
                    <stop offset="100%" stopColor="#e52e2e" />
                  </radialGradient>
                  <linearGradient id="pinNeedleGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#d1d5db" />
                    <stop offset="50%" stopColor="#9ca3af" />
                    <stop offset="100%" stopColor="#d1d5db" />
                  </linearGradient>
                </defs>
                <g className="bm-pushpin-group">
                  <path fill="url(#pinNeedleGradient)" d="M48 45 L48 85 L52 85 L52 45 Z" />
                  <path fill="#e52e2e" d="M40 20 C25 20 25 45 40 45 L60 45 C75 45 75 20 60 20 Z" />
                  <path fill="url(#pinHeadGradient)" d="M40 20 C25 20 25 45 40 45 L60 45 C75 45 75 20 60 20 Z" />
                  <path fill="rgba(255,255,255,0.3)" d="M42 25 C35 25 35 35 42 35 L58 35 C65 35 65 25 58 25 Z" />
                </g>
              </svg>
              <div className="bm-icon-shadow"></div>
            </div>
            <div className="bm-loading-text">
              Loading Bookmarks
              <span className="bm-loading-dots">...</span>
            </div>
            <div className="bm-loading-bar">
              <div className="bm-loading-progress"></div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bm-header">
        <div className="bm-title-wrap">
          <div className="bm-title-icon">❤️</div>
          <div>
            <h1 className="bm-title">Bookmarks</h1>
            <p className="bm-subtitle">Your saved destinations with quick previews and actions</p>
          </div>
        </div>

        <div className="bm-controls">
          <select className="bm-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="recent">Recently Added</option>
            <option value="name">Name</option>
            <option value="rating">Rating</option>
          </select>
          <button className="bm-clear-btn" onClick={clearAllBookmarks}>
            <span className="bm-clear-icon">🗑️</span>
            Clear All
          </button>
        </div>
      </header>

      {/* Stats */}
      <section className="bm-stats">
        <article className="bm-stat-card">
          <div className="bm-stat-icon heart">❤️</div>
          <div>
            <div className="bm-stat-label">Total Bookmarks</div>
            <div className="bm-stat-value">{stats.total}</div>
          </div>
        </article>
        <article className="bm-stat-card">
          <div className="bm-stat-icon pin">📍</div>
          <div>
            <div className="bm-stat-label">Regions Covered</div>
            <div className="bm-stat-value">{stats.regions}</div>
          </div>
        </article>
        <article className="bm-stat-card">
          <div className="bm-stat-icon star">⭐</div>
          <div>
            <div className="bm-stat-label">Avg Rating</div>
            <div className="bm-stat-value">{stats.avgRating.toFixed(1)}</div>
          </div>
        </article>
        <article className="bm-stat-card">
          <div className="bm-stat-icon route">🔗</div>
          <div>
            <div className="bm-stat-label">In Trip Plan</div>
            <div className="bm-stat-value">{stats.inTrip}</div>
          </div>
        </article>
      </section>

      {/* Grid */}
      {sorted.length === 0 ? (
        <section className="bm-empty" style={{ backdropFilter: 'blur(10px)', background: 'rgba(255, 255, 255, 0.6)', borderRadius: '12px', padding: '16px' }}>
          <div className="bm-empty-heart">
            <span>❤️</span>
          </div>
          <h2 className="bm-empty-title">No bookmarks yet</h2>
          <p className="bm-empty-text">
            Start exploring amazing Philippine destinations and bookmark your favorites to see them here with detailed previews!
          </p>
          <button className="bm-primary" onClick={handleExploreClick}>
            <span className="bm-primary-icon">🔎</span>
            Start Exploring
          </button>
        </section>
      ) : (
        <div className="bookmarks-grid">
          {sorted.map((d) => (
            <article
              key={d.id}
              className={`bm-card ${popIds[d.id] ? 'pop-anim' : ''} ${removingIds[d.id] ? 'removing' : ''}`}
            >
              {/* Top art */}
              <div className="bm-card-hero">
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
                    className="bm-card-img"
                    style={{
                      width: '100%',
                      height: 180,
                      objectFit: 'cover',
                      borderTopLeftRadius: 16,
                      borderTopRightRadius: 16,
                      marginBottom: 8,
                      background: '#eee'
                    }}
                  />
                ) : null;
            })()
            )}
            </div>
            <div className="bm-saved-badge">Saved {fmtSaved(d.savedAt)}</div>
              <button
                className="bm-heart-bubble"
                onClick={async (e) => {
                  e.stopPropagation();
                  triggerCardPop(d.id);
                  beginRemove(d.id);
                  
                  // Get destination name for activity log BEFORE removing
                  const destName = d.name || "destination";
                  
                  try {
                    await removeBookmark(d.id);
                    // Activity is already logged inside removeBookmark
                  } finally {
                    endRemove(d.id);
                  }
                }}
                aria-label="Remove from bookmarks"
                title="Remove"
              >
                ❤️
              </button>

              {/* Content */}
              <div className="bm-card-body">
                <div className="bm-card-head">
                  <h3 className="bm-card-title">{d.name}</h3>
                  <div className="bm-card-rating" title="Average Rating">
                    <span>⭐</span> {Number(d.rating || 0) > 0 ? Number(d.rating).toFixed(1) : '0'}
                  </div>
                </div>

                <a href="https://maps.google.com" className="bm-region-link" onClick={(e) => e.preventDefault()} title="Region">
                  {d.region || d.locationRegion}
                </a>

                <p className="bm-card-desc">{d.description}</p>

                <div className="bm-info-box">
                  <div className="bm-info-item">
                    <div className="bm-info-label">Best Time:</div>
                    <div className="bm-pill">{d.bestTime || d.best_time || '—'}</div>
                  </div>
                  <div className="bm-info-item">
                    <div className="bm-info-label1">Price:</div>
                    <div className="bm-pill">{d.price ?? '—'}</div>
                  </div>
                  {/* REMOVED LOCATION FROM CARD - Only shows in details modal */}
                </div>

                <div className="bm-tags">
                  {(d.tags || d.categories || []).slice(0, 8).map((t, i) => (
                    <span key={i} className="bm-tag">{t}</span>
                  ))}
                </div>

                <div className="bm-actions">
                  <button className="itn-btn primary" onClick={() => openDetails(d)}>
                    <span>🔎</span> View Details
                  </button>
                  <button
                    className={`itn-btn success ${addedTripId === d.id ? 'btn-success' : ''}`}
                    onClick={() => onAddToTrip(d)}
                    disabled={addingTripId === d.id}
                    aria-busy={addingTripId === d.id}
                  >
                    Add to Trip
                  </button>
                  <button
                    className="itn-btn danger"
                    onClick={async () => {
                      triggerCardPop(d.id);
                      beginRemove(d.id);
                      
                      const destName = d.name || "destination";
                      
                      try {
                        await removeBookmark(d.id);
                      } finally {
                        endRemove(d.id);
                      }
                    }}
                    disabled={removingIds[d.id] === true}
                    aria-busy={removingIds[d.id] === true}
                  >
                    <span className="bm-trash-responsive">🗑️</span> <span className='bm-remove-text'>Remove</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* NEW: Details modal */}
      {modalOpen && selected && (
        <div className="bm-modal-backdrop" onClick={closeDetails}>
          <div className="bm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="bm-modal-close" onClick={closeDetails} aria-label="Close">✕</button>

              <div className="bm-modal-hero">
              {cloudImages.length === 0 ? (
                <div style={{ width: "100%", background: "#e0e7ef", borderRadius: 16  }} />
              ) : (
                (() => {
                const cloudUrl = getImageForDestination(cloudImages, selected.name);
                const firebaseUrl = getFirebaseImageForDestination(firebaseImages, selected.name);
                const imgUrl = cloudUrl || firebaseUrl;
                return imgUrl ? (
                  <img
                    src={imgUrl}
                    alt={selected.name}
                    className="bm-modal-img"
                    style={{
                      width: '100%',
                      maxHeight: 300,
                      objectFit: 'cover',
                      borderTopLeftRadius: 10,
                      borderTopRightRadius: 10,
                      background: '#eee'
                    }}
                  />
                ) : (
                  <div className="bm-modal-sky" />
                );
            })()
            )}
          </div>

            <div className="bm-modal-body">
              <div className="bm-modal-main">
                <h2 className="bm-modal-title">{selected.name}</h2>

                <a className="bm-modal-region" href="https://maps.google.com" onClick={(e) => e.preventDefault()}>
                  {selected.region || selected.locationRegion}
                </a>

                <div className="bm-modal-ratings">
                  <div className="bm-avg-rating">
                    <span className="star">⭐</span>
                    {(ratingsByDest[selected.id]?.count ?? 0) > 0
                      ? ratingsByDest[selected.id].avg.toFixed(1)
                      : '0'} <span className="muted">(Average Rating)</span>
                  </div>
                    <span className="muted">
                      ({ratingsCountByDest[selected.id] !== undefined
                        ? ratingsCountByDest[selected.id]
                        : 0} ratings)
                    </span>
                    <span className="label">
                      Reviews: {
                        userReviewsCountByDest[selected.id] !== undefined
                          ? userReviewsCountByDest[selected.id]
                          : 0
                      }
                    </span>

                  <div className="bm-user-rating">
                    <span className="label">Rating:</span>
                    <div className="bm-stars" aria-label="Your Rating">
                      {[1,2,3,4,5].map((v) => (
                        <button
                          key={v}
                          className={`bm-star ${userRating >= v ? 'filled' : ''}`}
                          onClick={() => saveRating(v)}
                          disabled={savingRating}
                          title={`${v} star${v>1?'s':''}`}
                        >★</button>
                      ))}
                    </div>
                  </div>
                </div>

                <section>
                  <h3 className="bm-section-title">Description</h3>
                  <p className="bm-modal-desc">{selected.description}</p>
                </section>

                <section>
                  <h3 className="bm-section-title">Tags</h3>
                  <div className="bm-tags">
                    {(selected.tags || selected.categories || []).map((t, i) => (
                      <span key={i} className="bm-chip">{t}</span>
                    ))}
                  </div>
                </section>
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

                <section>
                  <h3 className="bm-section-title">Packing Suggestions</h3>
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
                </section>
              </div>
              

              <aside className="bm-modal-aside">
                <div className="bm-info-panel">
                  <h3 className="bm-info-title">Trip Information</h3>

                  <div className="bm-info-row">
                    <div className="bm-info-key">Price:</div>
                    <div className="bm-info-val">
                      <span className="chip-green">
                        {selectedFares.length > 0
                        ? `₱${getTotalPrice(selected.price).toLocaleString()}`
                        : formatPeso(selected.price)}</span>
                    </div>
                  </div>

                  <div className="bm-info-row">
                    <div className="bm-info-key">Best Time to Visit:</div>
                    <div className="bm-info-val">{selected.bestTime || selected.best_time || '—'}</div>
                  </div>

                  {/* ADD THIS NEW SECTION FOR LOCATION */}
                  {selected.location && (
                    <div className="bm-info-row">
                      <div className="bm-info-key">Location:</div>
                      <div className="bm-info-val">
                        <span className="badge blue">{selected.location}</span>
                      </div>
                    </div>
                  )}

                  <div className="bm-info-row">
                    <div className="bm-info-key">Categories:</div>
                    <div className="bm-info-val">
                      {selected.category ? (
                        <span className="badge purple">{selected.category}</span>
                      ) : (
                        <span className="badge purple">No category</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bm-modal-actions">
                  <button
                    className={`bm-bookmarked ${confirmingUnbookmark ? 'confirm' : ''}`}
                    onClick={handleBookmarkedClick}
                    aria-pressed="true"
                    title={confirmingUnbookmark ? 'Click again to remove' : 'Bookmarked'}
                  >
                    <span className="bm-heart">💗</span>
                    {confirmingUnbookmark ? 'Click again to remove' : 'Bookmarked'}
                  </button>
                  <button
                    className={`itn-btn success ${addedTripId === selected.id ? 'btn-success' : ''}`}
                    onClick={() => onAddToTrip(selected)}
                    disabled={addingTripId === selected.id}
                    aria-busy={addingTripId === selected.id}
                  >
                    <span>{addedTripId === selected.id ? '✔' : '+'}</span>
                    {addingTripId === selected.id ? ' Adding…' : addedTripId === selected.id ? ' Added!' : ' Add to Trip'}
                  </button>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}

      {/* NEW: Confirm Clear All modal (matches existing modal theme) */}
      {confirmClearOpen && (
        <div className="bm-modal-backdrop" onClick={() => setConfirmClearOpen(false)}>
          <div
            className="bm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-all-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 560,
              background: '#ffffff' // removed glass effect
            }}
          >
            <button className="bm-modal-close" onClick={() => setConfirmClearOpen(false)} aria-label="Close">✕</button>
            <div
              className="bm-modal-body"
              // make it a vertical stack: title -> text -> actions
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <h2
                id="clear-all-title"
                className="bm-modal-title"
                style={{ fontSize: '1.25rem', margin: '0 0 4px', lineHeight: 1.2 }}
              >
                Clear all bookmarks?
              </h2>

              <p className="bm-modal-desc" style={{ margin: 0 }}>
                This will remove all saved destinations from your bookmarks. You can add them again later from Explore.
              </p>

              <div className="bm-modal-actions" style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button className="itn-btn" onClick={() => setConfirmClearOpen(false)} disabled={isClearingAll}>
                  Cancel
                </button>
                <button
                  className="itn-btn danger"
                  onClick={handleConfirmClear}
                  disabled={isClearingAll}
                  aria-busy={isClearingAll}
                >
                  {isClearingAll ? 'Clearing…' : 'Clear All'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEW: themed error toast (click to dismiss) */}
      {errorMsg && (
        <div
          role="alert"
          className="bm-toast bm-toast-error"
          onClick={() => setErrorMsg('')}
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 14px',
            borderRadius: 12,
            // glass effect for toast
            background: 'rgba(255, 255, 255, 1)',

            color: '#1f2937',
            border: '1px solid rgba(255,255,255,0.35)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
            zIndex: 1000,
            cursor: 'pointer',
            fontWeight: 500
          }}
          title="Dismiss"
        >
          <span aria-hidden="true">⚠️</span>
          <span>Error:</span>
          <span style={{ opacity: 0.95 }}>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}

export default Bookmark;

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