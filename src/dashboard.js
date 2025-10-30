import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { addTripForCurrentUser } from './Itinerary';
import { trackDestinationAdded } from './itinerary_Stats';
import { 
  collection, getDocs, orderBy, query as fsQuery, limit, doc, getDoc, onSnapshot, deleteDoc, serverTimestamp,
  where as fsWhere, setDoc, arrayUnion, arrayRemove // ADD
} from 'firebase/firestore';
import { fetchCloudinaryImages, getImageForDestination as getCloudImageForDestination } from "./image-router";

import { signOut } from 'firebase/auth';
import { updateDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import './dashboardBanner.css';
import useUserDashboardStats from './dashboard-stats-row'; // <-- Add this import at the top
import destImages from './dest-images.json'; // Add this import at the top
import './Styles/bookmark2.css';
import { breakdown } from './rules';
import { unlockAchievement } from './profile';
import { runTransaction } from 'firebase/firestore';


// Helper to get image URL by destination name
function getImageForDestination(name) {
  if (!name) return undefined;
  const found = destImages.find(img => img.name.trim().toLowerCase() === name.trim().toLowerCase());
  return found ? found.url : undefined;
}

// DestinationCard Component - moved to top to avoid conflicts
function DestinationCard({ 
  id, 
  name, 
  region, 
  rating, 
  price, 
  priceTier, 
  description, 
  tags, 
  image, 
  isBookmarked, 
  onBookmarkClick, 
  onDetails 
}) {
  return (
    <div className="grid-card">
      <div className="card-image" style={{ backgroundImage: `url(${image})` }}>
        <div className="sun-decoration"></div>
        <div className="wave-decoration"></div>
        <button 
          className={`bookmark-bubble ${isBookmarked ? 'active' : ''}`}
          onClick={onBookmarkClick}
          aria-label="Toggle bookmark"
          title="Bookmark"
        >
          {isBookmarked ? '❤️' : '🤍'}
        </button>
      </div>
      <div className="card-content">
        <div className="card-header">
          <h2>{name}</h2>
          <div className="mini-rating">
            ⭐ {rating}
          </div>
        </div>
        <div className="bp2-region-line">{region}</div>
        <p className="description">{description}</p>
        <div className="tag-container">
          {tags.map((tag, index) => (
            <span key={index} className="tag">{tag}</span>
          ))}
        </div>
        <div className="card-footer">
          <span className={`pill ${priceTier === 'less' ? 'pill-green' : 'pill-gray'}`}>
            {price}
          </span>
          <button className="details-btn" onClick={onDetails}>
            View Details
          </button>
        </div>
      </div>
    </div>
  );
}

// --- COPY: Itinerary's EditDestinationModal (adapted to use createPortal) ---
function EditDestinationModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(() => ({
    name: initial?.display_name?.split(",")[0] || initial?.name || "",
    region: initial?.display_name?.split(",").slice(1).join(",").trim() || initial?.region || "",
    arrival: initial?.arrival || "",
    departure: initial?.departure || "",
    status: initial?.status || "Upcoming",
    estimatedExpenditure: initial?.estimatedExpenditure ?? initial?.budget ?? 0,
    accomType: initial?.accomType || "",
    accomName: initial?.accomName || "",
    accomNotes: initial?.accomNotes || "",
    activities: initial?.activities || [],
    activityDraft: "",
    transport: initial?.transport || "",
    transportNotes: initial?.transportNotes || "",
    notes: initial?.notes || "",
  }));

  const [notif, setNotif] = useState("");

  const addActivity = React.useCallback(() => {
    const v = form.activityDraft.trim();
    if (!v) return;
    setForm((f) => ({ ...f, activities: [...f.activities, v], activityDraft: "" }));
  }, [form.activityDraft]);

  const removeActivity = (i) =>
    setForm((f) => ({ ...f, activities: f.activities.filter((_, idx) => idx !== i) }));

  const handleSave = async () => {
    try {
      await onSave({
        ...initial,
        ...form,
        estimatedExpenditure: Number(form.estimatedExpenditure) || 0,
      });
      setNotif("Itinerary item updated successfully!");
      setTimeout(() => {
        setNotif("");
        onClose();
      }, 1200);
    } catch (e) {
      setNotif("Failed to update itinerary item.");
      setTimeout(() => setNotif(""), 2000);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && document.activeElement?.id === "itn-activity-draft") {
        e.preventDefault();
        addActivity();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addActivity, onClose]);

  const modalContent = (
    <div className="itn-modal-backdrop" onClick={onClose}>
      <div className="itn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="itn-modal-header">
          <div className="itn-modal-title">Edit Destination Details</div>
          <button className="itn-close" onClick={onClose}>×</button>
        </div>

        <div className="itn-modal-body">
          <div className="itn-form-grid">
            <div className="itn-form-col">
              <div className="itn-grid">
                <label className="itn-field">
                  <span className="itn-label">Destination Name</span>
                  <input
                    className="itn-input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="City or place name"
                  />
                </label>
                <label className="itn-field">
                  <span className="itn-label">Country/Region</span>
                  <input
                    className="itn-input"
                    value={form.region}
                    onChange={(e) => setForm({ ...form, region: e.target.value })}
                    placeholder="Region"
                  />
                </label>
              </div>

              <div className="itn-grid">
                <label className="itn-field">
                  <span className="itn-label">Arrival Date</span>
                  <input
                    type="date"
                    className="itn-input"
                    value={form.arrival}
                    onChange={(e) => setForm({ ...form, arrival: e.target.value })}
                  />
                </label>
                <label className="itn-field">
                  <span className="itn-label">Departure Date</span>
                  <input
                    type="date"
                    className="itn-input"
                    value={form.departure}
                    onChange={(e) => setForm({ ...form, departure: e.target.value })}
                  />
                </label>
                <label className="itn-field">
                  <span className="itn-label">Trip Status</span>
                  <select
                    className="itn-input"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <option>Upcoming</option>
                    <option>Ongoing</option>
                    <option>Completed</option>
                    <option>Cancelled</option>
                  </select>
                </label>
              </div>

              <div className="itn-grid">
                <label className="itn-field">
                  <span className="itn-label">Estimated Expenditure ($)</span>
                  <input
                    className="itn-input"
                    type="number"
                    value={form.estimatedExpenditure}
                    onChange={(e) => setForm({ ...form, estimatedExpenditure: e.target.value })}
                  />
                </label>
              </div>

              <div className="itn-field">
                <span className="itn-label">Activities & Things to Do</span>
                <div className="itn-grid-2">
                  <input
                    id="itn-activity-draft"
                    className="itn-input"
                    placeholder="e.g., Snorkeling, Hiking..."
                    value={form.activityDraft}
                    onChange={(e) => setForm({ ...form, activityDraft: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addActivity())}
                  />
                  <button className="itn-btn primary" onClick={addActivity}>
                    Add Activity
                  </button>
                </div>
                {form.activities.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {form.activities.map((act, i) => (
                      <div
                        key={i}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          background: "linear-gradient(90deg, #a084ee 60%, #6c63ff 100%)",
                          color: "#fff",
                          borderRadius: 16,
                          padding: "4px 12px",
                          fontSize: 13,
                          fontWeight: 500,
                        }}
                      >
                        <span>{act}</span>
                        <button
                          onClick={() => removeActivity(i)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#fff",
                            cursor: "pointer",
                            fontSize: 16,
                            lineHeight: 1,
                            padding: 0,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="itn-form-col">
              <div className="itn-field">
                <span className="itn-label">Accommodation Details</span>
                <div className="itn-grid-2">
                  <select
                    className="itn-input"
                    value={form.accomType}
                    onChange={(e) => setForm({ ...form, accomType: e.target.value })}
                  >
                    <option value="">Select type...</option>
                    <option>Hotel</option>
                    <option>Hostel</option>
                    <option>Apartment</option>
                    <option>Resort</option>
                    <option>Homestay</option>
                  </select>
                  <input
                    className="itn-input"
                    placeholder="Hotel/Place name"
                    value={form.accomName}
                    onChange={(e) => setForm({ ...form, accomName: e.target.value })}
                  />
                </div>
                <textarea
                  rows={2}
                  className="itn-input"
                  placeholder="Address, booking details, special notes..."
                  value={form.accomNotes}
                  onChange={(e) => setForm({ ...form, accomNotes: e.target.value })}
                />
              </div>

              <div className="itn-field">
                <span className="itn-label">Transport</span>
                <div className="itn-grid-2">
                  <select
                    className="itn-input"
                    value={form.transport}
                    onChange={(e) => setForm({ ...form, transport: e.target.value })}
                  >
                    <option value="">Select transportation...</option>
                    <option>Flight</option>
                    <option>Train</option>
                    <option>Bus</option>
                    <option>Car</option>
                    <option>Ferry</option>
                  </select>
                </div>
                <textarea
                  rows={2}
                  className="itn-input"
                  placeholder="Transport notes..."
                  value={form.transportNotes}
                  onChange={(e) => setForm({ ...form, transportNotes: e.target.value })}
                />
              </div>

              <div className="itn-field">
                <span className="itn-label">Additional Notes</span>
                <textarea
                  rows={3}
                  className="itn-input"
                  placeholder="Any other important details..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="itn-modal-footer">
          <button className="itn-btn ghost" onClick={onClose}>Cancel</button>
          <button className="itn-btn primary" onClick={handleSave}>Save Details</button>
        </div>

        {notif && (
          <div
            style={{
              position: "fixed",
              top: 20,
              right: 20,
              background: "#6c63ff",
              color: "#fff",
              padding: "12px 20px",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              zIndex: 10000,
            }}
          >
            {notif}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

// --- COPY: Itinerary's ItinerarySummaryModal (adapted to createPortal) ---
function ItinerarySummaryModal({ item, onClose }) {
  const days =
    item && item.arrival && item.departure
      ? Math.max(
          1,
          Math.ceil(
            (new Date(item.departure).getTime() - new Date(item.arrival).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        )
      : 0;

  const modalContent = (
    <div className="itn-modal-backdrop itn-summary-backdrop" onClick={onClose}>
      <div className="itn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="itn-modal-header">
          <div className="itn-modal-title">📋 Trip Summary</div>
          <button className="itn-close" onClick={onClose}>×</button>
        </div>

        <div className="itn-modal-body">
          <div className="itn-summary-content">
            <div className="itn-summary-section">
              <h3 className="itn-summary-heading">📍 Destination</h3>
              <div className="itn-summary-item">
                <strong>{item.name}</strong>
                {item.region && <span className="itn-summary-region">{item.region}</span>}
              </div>
              {item.location && (
                <div className="itn-summary-item" style={{ marginTop: '12px' }}>
                  <span className="itn-summary-label" style={{ color: '#64748b', fontSize: '0.9rem' }}>
                    📌 Location:
                  </span>
                  <span style={{ marginLeft: '8px', color: '#475569' }}>
                    {item.location}
                  </span>
                </div>
              )}
            </div>

            {(item.arrival || item.departure) && (
              <div className="itn-summary-section">
                <h3 className="itn-summary-heading">📅 Travel Dates</h3>
                <div className="itn-summary-grid">
                  {item.arrival && (
                    <div className="itn-summary-item">
                      <span className="itn-summary-label">Arrival:</span>
                      <span>{new Date(item.arrival).toLocaleDateString()}</span>
                    </div>
                  )}
                  {item.departure && (
                    <div className="itn-summary-item">
                      <span className="itn-summary-label">Departure:</span>
                      <span>{new Date(item.departure).toLocaleDateString()}</span>
                    </div>
                  )}
                  {days > 0 && (
                    <div className="itn-summary-item">
                      <span className="itn-summary-label">Duration:</span>
                      <span>{days} day{days !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {item.estimatedExpenditure > 0 && (
              <div className="itn-summary-section">
                <h3 className="itn-summary-heading">💰 Budget</h3>
                <div className="itn-summary-item">
                  <span className="itn-summary-amount">
                    ${Number(item.estimatedExpenditure).toLocaleString()}
                  </span>
                </div>
              </div>
            )}

            {item.activities && item.activities.length > 0 && (
              <div className="itn-summary-section">
                <h3 className="itn-summary-heading">🎯 Activities</h3>
                <div className="itn-summary-tags">
                  {item.activities.map((activity, idx) => (
                    <span key={idx} className="itn-summary-tag">{activity}</span>
                  ))}
                </div>
              </div>
            )}

            {(item.accomType || item.accomName) && (
              <div className="itn-summary-section">
                <h3 className="itn-summary-heading">🏨 Accommodation</h3>
                <div className="itn-summary-item">
                  {item.accomType && <span className="itn-summary-badge">{item.accomType}</span>}
                  {item.accomName && <strong>{item.accomName}</strong>}
                  {item.accomNotes && <p className="itn-summary-notes">{item.accomNotes}</p>}
                </div>
              </div>
            )}

            {item.transport && (
              <div className="itn-summary-section">
                <h3 className="itn-summary-heading">🚗 Transportation</h3>
                <div className="itn-summary-item">
                  <span className="itn-summary-badge">{item.transport}</span>
                  {item.transportNotes && <p className="itn-summary-notes">{item.transportNotes}</p>}
                </div>
              </div>
            )}

            {item.notes && (
              <div className="itn-summary-section">
                <h3 className="itn-summary-heading">📝 Notes</h3>
                <div className="itn-summary-item">
                  <p className="itn-summary-notes">{item.notes}</p>
                </div>
              </div>
            )}

            <div className="itn-summary-section">
              <h3 className="itn-summary-heading">✅ Status</h3>
              <div className="itn-summary-item">
                <span className={`itn-summary-status ${item.status?.toLowerCase()}`}>
                  {item.status}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="itn-modal-footer">
          <button className="itn-btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

const INTEREST_RULES = {
  "Surfer": ["Beach"],
  "Backpacker": ["Mountain", "Tourist", "Natural"],
  "Foodie Traveler": ["Cultural", "Tourist", "Heritage"],
  "Culture Seeker": ["Cultural", "Heritage", "Museums"],
  "Adventure Junkie": ["Mountain", "Waterfalls", "Caves"],
  "Nature Enthusiast": ["Natural", "Parks", "Lakes"],
  "Digital Nomad": ["City Explorer", "Tourist", "Landmarks"],
  "Road Tripper": ["Landmarks", "Tourist", "Natural"],
  "Beach Lover": ["Beach"],
  "City Explorer": ["Tourist", "Museums", "Cultural"],
  "Photographer": ["Landmarks", "Natural", "Heritage"],
  "Historian": ["Historical", "Heritage", "Museums"],
  "Festival Hopper": ["Cultural", "Tourist", "Heritage"],
  "Hiker": ["Mountain"],
  "Luxury Traveler": ["Islands", "Beach", "Heritage"],
  "Eco-Traveler": ["Parks", "Natural", "Caves"],
  "Cruise Lover": ["Islands", "Beach", "Lakes"],
  "Winter Sports Enthusiast": [],
  "Solo Wanderer": ["Tourist", "Cultural", "Landmarks"]
};

const INTEREST_RULES_LC = Object.fromEntries(
  Object.entries(INTEREST_RULES).map(([k, v]) => [k.toLowerCase(), v])
);


function getFirebaseImageForDestination(firebaseImages, destName) {
  if (!destName) return null;
  const normalized = destName.trim().toLowerCase();
  const found = (firebaseImages || []).find(img =>
    (img.name && img.name.trim().toLowerCase() === normalized) ||
    (img.publicId && img.publicId.trim().toLowerCase() === normalized)
  );
  return found && found.url ? found.url : null;
}
function formatPeso(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return '₱' + v.toLocaleString();
  if (typeof v === 'string') {
    if (v.trim().startsWith('₱')) return v;
    const digits = v.replace(/[^\d]/g, '');
    return digits ? '₱' + Number(digits).toLocaleString() : v;
  }
  return '—';
}


function Dashboard({ setShowAIModal }) {
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const navigate = useNavigate();

  const [trips, setTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  useEffect(() => {
    let unsubscribeAuth;
    let unsubscribeTrips;
    setTripsLoading(true);
    unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (user) {
        const colRef = collection(db, 'itinerary', user.uid, 'items');
        unsubscribeTrips = onSnapshot(
          fsQuery(colRef, orderBy('createdAt', 'desc')),
          (snap) => {
            const rows = snap.docs.map((doc) => {
              const data = doc.data() || {};
              return {
                id: doc.id,
                ...data,
              };
            });
            setTrips(rows);
            setTripsLoading(false);
          },
          (error) => {
            setTrips([]);
            setTripsLoading(false);
          }
        );
      } else {
        setTrips([]);
        setTripsLoading(false);
        if (unsubscribeTrips) unsubscribeTrips();
      }
    });
    return () => {
      if (typeof unsubscribeAuth === 'function') unsubscribeAuth();
      if (typeof unsubscribeTrips === 'function') unsubscribeTrips();
    };
  }, []);

  const [bookmarks, setBookmarks] = useState([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(true);
  const [personalizedSort, setPersonalizedSort] = useState('rating-desc');

  // ref to the container that holds the bookmark items (popup will be positioned relative to this)
  const bookmarksContainerRef = useRef(null);
  // trips container ref + trip action popup refs/state (separate classnames to avoid collision)
  const tripsContainerRef = useRef(null);
  const tripActionsRef = useRef(null);
  const tripAnchorRef = useRef(null);
  const [openTripActionsId, setOpenTripActionsId] = useState(null);
  const [tripActionsPos, setTripActionsPos] = useState({ top: 0, left: 0, anchorRect: null });
  // which bookmark's action-bar is open (id or null)
  const actionsRef = useRef(null);
  const anchorRef = useRef(null); // store the anchor button element
  const [openActionsId, setOpenActionsId] = useState(null);
  const [actionsPos, setActionsPos] = useState({ top: 0, left: 0, anchorRect: null });

  // ADD: Rating & modal state for personalized details
  const [ratingsByDest, setRatingsByDest] = useState({});
  const [selected, setSelected] = useState(null);
  const [userRating, setUserRating] = useState(0);
  const [savingRating, setSavingRating] = useState(false);
  const [destinations, setDestinations] = useState([]);
  const [recommendedDestinations, setRecommendedDestinations] = useState([]);
  const [selectedFares, setSelectedFares] = useState([]); // For fare checkboxes
  const [ratingsCountByDest, setRatingsCountByDest] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [reviewsByDest, setReviewsByDest] = useState({});
  const [viewedDestinations, setViewedDestinations] = useState(new Set());
  const [currentUser, setCurrentUser] = useState(null);
  const [personalizedRatingsByDest, setPersonalizedRatingsByDest] = useState({});
  const [personalizedUserRating, setPersonalizedUserRating] = useState(0);
  const [personalizedSavingRating, setPersonalizedSavingRating] = useState(false);
  const [personalizedRatingsCountByDest, setPersonalizedRatingsCountByDest] = useState({});
  const [personalizedReviewsByDest, setPersonalizedReviewsByDest] = useState({});
  const [userReviewsCountByDest, setUserReviewsCountByDest] = useState({});
  
  useEffect(() => {
  const unsub = auth.onAuthStateChanged((u) => setCurrentUser(u));
  return () => typeof unsub === 'function' && unsub();
}, []);


  // compute popup position relative to bookmarksContainerRef so it stays inside that parent
  const computeAndSetPos = (anchorEl) => {
    if (!anchorEl || !bookmarksContainerRef.current) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const parent = bookmarksContainerRef.current;
    const parentRect = parent.getBoundingClientRect();

    // We want the popup to appear on the RIGHT side of the parent container.
    // Compute left as parent.width - popupWidth - margin (relative to parent + scroll)
    const margin = 8;
    const popup = actionsRef.current;

    // provisional left/top relative to parent
    let left = margin + parent.scrollLeft; // will be adjusted once we know popup width
    // vertically center the popup against the anchor by default
    let top = anchorRect.top - parentRect.top + parent.scrollTop;

    if (popup) {
      const popupRect = popup.getBoundingClientRect();
      const popupW = popupRect.width || 160;
      const popupH = popupRect.height || 120;

      // Left positioned so popup's right edge aligns with parent's right edge (inside parent)
      left = Math.max(margin, parentRect.width - popupW - margin) + parent.scrollLeft;

      // center vertically on anchor
      const anchorCenter = anchorRect.top + (anchorRect.height / 2);
      top = Math.round(anchorCenter - parentRect.top - popupH / 2 + parent.scrollTop);

      // clamp top so popup stays inside parent vertically
      const maxTop = Math.max(margin, parentRect.height - popupH - margin) + parent.scrollTop;
      top = Math.min(Math.max(margin + parent.scrollTop, top), maxTop);
    } else {
      // if popup not yet rendered, position top roughly at anchor top (will refine after mount)
      top = anchorRect.top - parentRect.top + parent.scrollTop;
      // left will be adjusted after popup measures
      left = Math.max(margin, parentRect.width - 160 - margin) + parent.scrollLeft;
    }

    setActionsPos({ top, left, anchorRect });
  };
  
    function getBreakdown(price) {
    if (!price) return [];
    // Remove non-digits and leading ₱, commas, spaces
    const digits = String(price).replace(/[^\d]/g, '');
    if (!digits) return [];
    const key = `P${digits}`;
    return breakdown[key] || [];
  }

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

function parseFareRange(str) {
  // Example: "₱2,500 - ₱5,000+ (long routes)"
  const match = str.match(/₱([\d,]+)\s*-\s*₱([\d,]+)/);
  if (!match) return 0;
  // Return the higher value as number
  return Number(match[2].replace(/,/g, ''));
}

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
  
    const closeDetails = () => {
      setModalOpen(false);
      setSelected(null);
      setUserRating(0);
    };

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

useEffect(() => {
  if (!detailsModalOpen || !selectedCard) return;
  async function fetchUserReviewsCount() {
    try {
      const reviewsSnap = await getDocs(collection(db, 'destinations', selectedCard.id, 'reviews'));
      setUserReviewsCountByDest(prev => ({
        ...prev,
        [selectedCard.id]: reviewsSnap.size || 0
      }));
    } catch (e) {
      setUserReviewsCountByDest(prev => ({
        ...prev,
        [selectedCard.id]: 0
      }));
    }
  }
  fetchUserReviewsCount();
}, [detailsModalOpen, selectedCard]);

useEffect(() => {
  if (!detailsModalOpen || !selectedCard) return;

  // Fetch average rating and count
  (async () => {
    try {
      const rsnap = await getDocs(collection(db, 'destinations', selectedCard.id, 'ratings'));
      let sum = 0, count = 0;
      rsnap.forEach((r) => {
        const v = Number(r.data()?.value) || 0;
        if (v > 0) { sum += v; count += 1; }
      });
      const avg = count ? sum / count : 0;
      setPersonalizedRatingsByDest((m) => ({ ...m, [selectedCard.id]: { avg, count } }));
      setPersonalizedRatingsCountByDest((m) => ({ ...m, [selectedCard.id]: count }));
    } catch (e) {
      setPersonalizedRatingsByDest((m) => ({ ...m, [selectedCard.id]: { avg: 0, count: 0 } }));
      setPersonalizedRatingsCountByDest((m) => ({ ...m, [selectedCard.id]: 0 }));
    }
  })();

  // Fetch review count
  (async () => {
    try {
      const docRef = doc(db, 'destinations', selectedCard.id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const review = snap.data().review;
        setPersonalizedReviewsByDest(prev => ({
          ...prev,
          [selectedCard.id]: typeof review === 'number' ? review : 0
        }));
      } else {
        setPersonalizedReviewsByDest(prev => ({
          ...prev,
          [selectedCard.id]: 0
        }));
      }
    } catch (e) {
      setPersonalizedReviewsByDest(prev => ({
        ...prev,
        [selectedCard.id]: 0
      }));
    }
  })();

  // Fetch user's rating
  (async () => {
    try {
      const u = auth.currentUser;
      if (!u) { setPersonalizedUserRating(0); return; }
      const rref = doc(db, 'destinations', selectedCard.id, 'ratings', u.uid);
      const rsnap = await getDoc(rref);
      setPersonalizedUserRating(Number(rsnap.data()?.value || 0));
    } catch {
      setPersonalizedUserRating(0);
    }
  })();
}, [detailsModalOpen, selectedCard]);

// --- Add this function for rating ---
const ratePersonalizedSelected = async (value) => {
  const u = auth.currentUser;
  if (!u) { alert('Please sign in to rate.'); return; }
  if (!selectedCard) return;
  const v = Math.max(1, Math.min(5, Number(value) || 0));
  setPersonalizedSavingRating(true);
  try {
    const ref = doc(db, 'destinations', String(selectedCard.id), 'ratings', u.uid);
    await setDoc(ref, {
      value: v,
      userId: u.uid,
      updatedAt: serverTimestamp(),
      name: selectedCard.name || '',
    }, { merge: true });

    setPersonalizedUserRating(v);

    const userRatingRef = doc(db, 'users', u.uid, 'ratings', String(selectedCard.id));
    await setDoc(
      userRatingRef,
      {
        destId: String(selectedCard.id),
        value: v,
        updatedAt: serverTimestamp(),
        name: selectedCard.name || '',
      },
      { merge: true }
    );

    const rsnap = await getDocs(collection(db, 'destinations', String(selectedCard.id), 'ratings'));
    let sum = 0, count = 0;
    rsnap.forEach((r) => { const val = Number(r.data()?.value) || 0; if (val > 0) { sum += val; count += 1; } });
    const avg = count ? sum / count : 0;

    setPersonalizedRatingsByDest((m) => ({ ...m, [selectedCard.id]: { avg, count } }));
  } catch (e) {
    console.error('Save rating failed:', e);
    alert('Failed to save rating.');
  } finally {
    setPersonalizedSavingRating(false);
  }
};
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

  // compute popup position relative to tripsContainerRef (right-side popup, vertically centered)
  const computeAndSetTripPos = (anchorEl) => {
    if (!anchorEl || !tripsContainerRef.current) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const parent = tripsContainerRef.current;
    const parentRect = parent.getBoundingClientRect();

    const margin = 8;
    const popup = tripActionsRef.current;

    let left = Math.max(margin, parentRect.width - 160 - margin) + parent.scrollLeft;
    let top = anchorRect.top - parentRect.top + parent.scrollTop;

    if (popup) {
      const popupRect = popup.getBoundingClientRect();
      const popupW = popupRect.width || 160;
      const popupH = popupRect.height || 120;
      left = Math.max(margin, parentRect.width - popupW - margin) + parent.scrollLeft;
      const anchorCenter = anchorRect.top + anchorRect.height / 2;
      top = Math.round(anchorCenter - parentRect.top - popupH / 2 + parent.scrollTop);
      const maxTop = Math.max(margin, parentRect.height - popupH - margin) + parent.scrollTop;
      top = Math.min(Math.max(margin + parent.scrollTop, top), maxTop);
    }

    setTripActionsPos({ top, left, anchorRect });
  };
  
  const toggleBookmarkActions = (e, id) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    if (openActionsId === id) {
      setOpenActionsId(null);
      anchorRef.current = null;
      return;
    }
    anchorRef.current = btn; // store anchor element so we can track it
    computeAndSetPos(btn); // initial position inside parent
    setOpenActionsId(id);
  };
  
  const toggleTripActions = (e, id) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    if (openTripActionsId === id) {
      setOpenTripActionsId(null);
      tripAnchorRef.current = null;
      return;
    }
    tripAnchorRef.current = btn;
    computeAndSetTripPos(btn);
    setOpenTripActionsId(id);
  };

  const sortedRecommendedDestinations = [...recommendedDestinations].sort((a, b) => {
  const ra = Number(a.rating) || 0;
  const rb = Number(b.rating) || 0;
  if (personalizedSort === 'rating-asc') return ra - rb;
  return rb - ra;
});
  
  // close popup when clicking outside
  useEffect(() => {
    const handleDocClick = (ev) => {
      // close both bookmark and trip popups if clicked outside
      const clickedInsideBookmark = actionsRef.current?.contains(ev.target) || anchorRef.current?.contains(ev.target);
      const clickedInsideTrip = tripActionsRef.current?.contains(ev.target) || tripAnchorRef.current?.contains(ev.target);
      if (!clickedInsideBookmark) {
        setOpenActionsId(null);
        anchorRef.current = null;
      }
      if (!clickedInsideTrip) {
        setOpenTripActionsId(null);
        tripAnchorRef.current = null;
      }
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);
  
  // recompute position on parent scroll/resize so popup stays attached to anchor inside parent
  useEffect(() => {
    if (!openActionsId) return;
    let raf = null;
    const onChange = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (anchorRef.current) computeAndSetPos(anchorRef.current);
      });
    };
    const parent = bookmarksContainerRef.current || window;
    parent.addEventListener ? parent.addEventListener('scroll', onChange, { passive: true }) : window.addEventListener('scroll', onChange, { passive: true });
    window.addEventListener('resize', onChange);
    const t = setTimeout(() => computeAndSetPos(anchorRef.current), 0);
    return () => {
      clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
      parent.removeEventListener ? parent.removeEventListener('scroll', onChange) : window.removeEventListener('scroll', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [openActionsId]);

  // recompute position on parent scroll/resize so popup stays attached to anchor inside parent
  useEffect(() => {
    if (!openTripActionsId) return;
    let raf = null;
    const onChange = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (tripAnchorRef.current) computeAndSetTripPos(tripAnchorRef.current);
      });
    };
    const parent = tripsContainerRef.current || window;
    parent.addEventListener ? parent.addEventListener('scroll', onChange, { passive: true }) : window.addEventListener('scroll', onChange, { passive: true });
    window.addEventListener('resize', onChange);
    const t = setTimeout(() => computeAndSetTripPos(tripAnchorRef.current), 0);
    return () => {
      clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
      parent.removeEventListener ? parent.removeEventListener('scroll', onChange) : window.removeEventListener('scroll', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [openTripActionsId]);

  // Fetch 2 most recent bookmarks for the current user
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setBookmarksLoading(true);
        try {
          const colRef = collection(db, 'users', user.uid, 'bookmarks');
          const snap = await getDocs(fsQuery(colRef, orderBy('createdAt', 'desc'), limit(2)));
          const rows = await Promise.all(
            snap.docs.map(async (b) => {
              const data = b.data() || {};
              // Prefer data stored on the bookmark doc
              if (data.name && data.description) {
                return {
                  id: b.id,
                  ...data,
                  savedAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
                };
              }
              // Fallback: merge with source destination doc
              const dref = doc(db, 'destinations', b.id);
              const ddoc = await getDoc(dref);
              return {
                id: b.id,
                ...(ddoc.exists() ? ddoc.data() : {}),
                ...data,
                savedAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
              };
            })
          );
          setBookmarks(rows.filter(Boolean));
        } catch (e) {
          setBookmarks([]);
        } finally {
          setBookmarksLoading(false);
        }
      } else {
        setBookmarks([]);
        setBookmarksLoading(false);
      }
    });
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);
  

  // Use the custom hook for live stats
  const { loading: statsLoading, error: statsError, stats } = useUserDashboardStats();

  // Demo: local state for bookmarks for personalized cards
  const [personalizedBookmarks, setPersonalizedBookmarks] = useState({});

  // Sync hearts from Firestore bookmarks so existing saved items show as active
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) { setPersonalizedBookmarks({}); return; }
      try {
        // Merge ids from both the subcollection and the userBookmarks doc
        const [subsSnap, listSnap] = await Promise.all([
          getDocs(collection(db, 'users', u.uid, 'bookmarks')),
          getDoc(doc(db, 'userBookmarks', u.uid)).catch(() => null)
        ]);

        const map = {};
        subsSnap.forEach(d => { map[d.id] = true; });

        if (listSnap && listSnap.exists()) {
          const arr = Array.isArray(listSnap.data()?.bookmarks) ? listSnap.data().bookmarks : [];
          arr.forEach(id => { map[String(id)] = true; });
        }

        setPersonalizedBookmarks(map);
      } catch {
        setPersonalizedBookmarks({});
      }
    });
    return () => typeof unsub === 'function' && unsub();
  }, []);

  // Handler for toggling bookmark for personalized cards
  const handlePersonalizedBookmark = async (id) => {
    const user = auth.currentUser;
    if (!user) { alert('Please sign in to use bookmarks.'); return; }

    const next = !personalizedBookmarks[id];
    // optimistic UI
    setPersonalizedBookmarks(prev => ({ ...prev, [id]: next }));

    try {
      const d = (recommendedDestinations || []).find(x => String(x.id) === String(id)) || {};
      const ref = doc(db, 'users', user.uid, 'bookmarks', String(id));
      const listRef = doc(db, 'userBookmarks', user.uid); // keep Bookmarks2 in sync

      if (next) {
        const payload = {
          id: d.id || String(id),
          name: d.name || '',
          description: d.description || '',
          region: d.region || '',
          rating: d.rating || 0,
          price: d.price || '',
          priceTier: d.priceTier || null,
          tags: Array.isArray(d.tags) ? d.tags : [],
          category: Array.isArray(d.category) ? d.category
            : (typeof d.category === 'string' ? [d.category] : []),
          location: d.location || '',
          image: d.image || pickCardImage(d.name) || getImageForDestination(d.name) || '',
          bestTime: d.bestTime || '',
          createdAt: serverTimestamp()
        };
        await setDoc(ref, payload, { merge: true });

        // Update list doc (used by bookmarks2.js)
        await setDoc(
          listRef,
          {
            userId: user.uid,
            updatedAt: serverTimestamp(),
            bookmarks: arrayUnion(String(id))
          },
          { merge: true }
        );
      } else {
        await deleteDoc(ref);
        await setDoc(
          listRef,
          {
            userId: user.uid,
            updatedAt: serverTimestamp(),
            bookmarks: arrayRemove(String(id))
          },
          { merge: true }
        );
      }
    } catch (e) {
      console.error('bookmark toggle failed', e);
      // rollback UI
      setPersonalizedBookmarks(prev => ({ ...prev, [id]: !next }));
      alert('Failed to update bookmark. Please try again.');
    }
  };

  // Handler for view details (open modal)
  const handlePersonalizedDetails = (card) => {
    setSelectedCard(card);
    setDetailsModalOpen(true);
    setSelected(card);
    setUserRating(0);
  };

  // Handler to close modal
  const closeDetailsModal = () => {
    setDetailsModalOpen(false);
    setSelectedCard(null);
  };

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

  
  // ADD: load all published destinations (for potential future use or stats)
  useEffect(() => {
    const loadDestinations = async () => {
      try {
        const q = fsQuery(
          collection(db, 'destinations'),
          fsWhere('status', 'in', ['published', 'PUBLISHED'])
        );
        const snap = await getDocs(q);
        const items = snap.docs.map((x) => ({
          id: x.id,
          ...x.data(),
          category: x.data().category || '',
        }));
        setDestinations(items);
      } catch (err) {
        console.error('Failed to load destinations:', err);
        setDestinations([]);
      }
    };
    loadDestinations();
  }, []);


  // ADD: Save user rating
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

  // --- Bookmark preview action handlers (add inside Dashboard before return) ---
  const openBookmarkDetails = (bm) => {
    try {
      // set the selected card to the bookmark object and open the details modal
      setSelectedCard(bm);
      setDetailsModalOpen(true);
    } catch (err) {
      console.error('openBookmarkDetails error', err);
    }
  };

  const addBookmarkToTrip = (bm) => {
    try {
      // lightweight: navigate to itinerary and pass bookmark as prefill
      if (typeof navigate === 'function') {
        navigate('/itinerary', { state: { prefill: bm } });
      }
    } catch (err) {
      console.error('addBookmarkToTrip error', err);
    }
  };

  const removeBookmarkPreview = async (id) => {
    try {
      // optimistic UI remove
      if (typeof setBookmarks === 'function') {
        setBookmarks(prev => prev ? prev.filter(b => b.id !== id) : []);
      }

      // try remove from Firestore if user present
      const user = auth && auth.currentUser ? auth.currentUser : null;
      if (user && db && typeof deleteDoc === 'function' && typeof doc === 'function') {
        await deleteDoc(doc(db, 'users', user.uid, 'bookmarks', id));
      }
    } catch (err) {
      console.error('removeBookmarkPreview error', err);
      // ensure UI consistency
      if (typeof setBookmarks === 'function') {
        setBookmarks(prev => prev ? prev.filter(b => b.id !== id) : []);
      }
    }
  };

  // Add-to-trip UI state (to mirror bookmark.js behavior)
  const [addingTripId, setAddingTripId] = useState(null);
  const [addedTripId, setAddedTripId] = useState(null);
  
  // Add-to-trip handler (similar to bookmark.js)
  const onAddToTrip = async (dest) => {
    const u = auth.currentUser;
    if (!u) { alert('Please sign in to add to My Trips.'); return; }
    setAddingTripId(dest.id);
    try {
      const destinationData = {
        id: dest.id,
        name: dest.name || '',
        display_name: dest.name || '',
        region: dest.region || dest.locationRegion || '',
        location: dest.location || '',
        description: dest.description || '',
        lat: dest.lat || dest.latitude,
        lon: dest.lon || dest.longitude,
        place_id: dest.place_id || dest.id,
        rating: dest.rating || 0,
        price: dest.price || '',
        priceTier: dest.priceTier || null,
        tags: Array.isArray(dest.tags) ? dest.tags : [],
        category: Array.isArray(dest.category) ? dest.category : [],
        bestTime: dest.bestTime || dest.best_time || '',
        // prefer explicit image fields, fall back to name-based lookup
        image: dest.image || dest.imageUrl || getImageForDestination(dest.name) || '',
      };

      // add to itinerary (helper from Itinerary.js)
      if (typeof addTripForCurrentUser === 'function') {
        await addTripForCurrentUser(destinationData);
      } else {
        // fallback: navigate to itinerary with prefill
        if (typeof navigate === 'function') navigate('/itinerary', { state: { prefill: destinationData } });
      }

      // optional analytics / stats helper
      try {
        if (typeof trackDestinationAdded === 'function') {
          await trackDestinationAdded(u.uid, {
            id: dest.id,
            name: dest.name,
            region: dest.region || dest.locationRegion,
            location: dest.location,
            latitude: dest.lat || dest.latitude,
            longitude: dest.lon || dest.longitude,
          });
        }
      } catch (e) { /* ignore tracking errors */ }

      setAddedTripId(dest.id);
      setTimeout(() => setAddedTripId(null), 1200);
    } catch (e) {
      console.error('Failed to add to My Trips:', e);
      alert('Failed to add to My Trips.');
    } finally {
      setAddingTripId(null);
    }
  };

  const [showTripSummaryModal, setShowTripSummaryModal] = useState(false);
  const [summaryTrip, setSummaryTrip] = useState(null);
  
  const openTripSummary = (trip) => {
    // show in-place summary modal (do not navigate)
    setSummaryTrip(trip);
    setShowTripSummaryModal(true);
    setOpenTripActionsId(null);
  };
  
  const [showEditTripModal, setShowEditTripModal] = useState(false);
  const [editingTrip, setEditingTrip] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editNotif, setEditNotif] = useState('');
  const editTrip = (trip) => {
    // open in-place edit modal (do not navigate)
    setEditingTrip(trip);
    setShowEditTripModal(true);
    setOpenTripActionsId(null);
  };

  const removeTrip = async (trip) => {
    if (!auth.currentUser) {
      alert('Please sign in to remove trip');
      setOpenTripActionsId(null);
      return;
    }
    if (!window.confirm('Remove this destination from your itinerary?')) {
      return setOpenTripActionsId(null);
    }
    try {
      await deleteDoc(doc(db, 'itinerary', auth.currentUser.uid, 'items', trip.id));
    } catch (err) {
      console.error('remove trip failed', err);
      alert('Failed to remove trip');
    } finally {
      setOpenTripActionsId(null);
    }
  };

  // Save handler used by the copied EditDestinationModal
  const saveTripEdit = async (data) => {
    if (!auth.currentUser) { alert('Please sign in'); return; }
    setEditSaving(true);
    try {
      const ref = doc(db, 'itinerary', auth.currentUser.uid, 'items', String(data.id));
      const payload = {
        name: data.name || '',
        region: data.region || '',
        arrival: data.arrival || '',
        departure: data.departure || '',
        status: data.status || 'Upcoming',
        estimatedExpenditure: Number(data.estimatedExpenditure) || 0,
        accomType: data.accomType || '',
        accomName: data.accomName || '',
        accomNotes: data.accomNotes || '',
        activities: Array.isArray(data.activities) ? data.activities : [],
        transport: data.transport || '',
        transportNotes: data.transportNotes || '',
        notes: data.notes || '',
        updatedAt: serverTimestamp(),
      };
      await updateDoc(ref, payload);
      setEditNotif('Saved');
      setTimeout(() => setEditNotif(''), 1200);
      setShowEditTripModal(false);
    } catch (err) {
      console.error('Edit save failed', err);
      alert('Failed to save trip');
    } finally {
      setEditSaving(false);
    }
  };

  // Images used by grid-card
  const [cloudImages, setCloudImages] = useState([]);
  const [firebaseImages, setFirebaseImages] = useState([]);

  useEffect(() => {
    fetchCloudinaryImages().then(setCloudImages).catch(() => setCloudImages([]));
  }, []);
  useEffect(() => {
    async function fetchFirebaseImages() {
      try {
        const snap = await getDocs(collection(db, 'photos'));
        const imgs = snap.docs.map(doc => ({
          name: doc.data().name,
          publicId: doc.data().publicId,
          url: doc.data().url
        })).filter(img => img.name && img.url);
        setFirebaseImages(imgs);
      } catch {
        setFirebaseImages([]);
      }
    }
    fetchFirebaseImages();
  }, []);
  const pickCardImage = (name) =>
    getCloudImageForDestination(cloudImages, name) ||
    getFirebaseImageForDestination(firebaseImages, name) ||
    getImageForDestination(name) ||
    '/placeholder.png';

  // Personalized recommendations from profile interests
  const [userInterests, setUserInterests] = useState([]);
  const [recoLoading, setRecoLoading] = useState(false);


  // Read current user's interests (normalize to labels)
  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged((u) => {
      if (!u) { setUserInterests([]); return; }
      const uref = doc(db, 'users', u.uid);
      const unsubUser = onSnapshot(uref, (snap) => {
        const raw = Array.isArray(snap.data()?.interests) ? snap.data().interests : [];
        const arr = raw.map(v => (typeof v === 'string' ? v : v?.label)).filter(Boolean);
        setUserInterests(arr);
      });
      return () => typeof unsubUser === 'function' && unsubUser();
    });
    return () => typeof unsubAuth === 'function' && unsubAuth();
  }, []);

  useEffect(() => {
    const norm = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
    const uniqCasePreserve = (arr) => {
      const seen = new Set();
      const out = [];
      for (const v of arr) {
        const k = norm(v);
        if (!seen.has(k)) { seen.add(k); out.push(v); }
      }
      return out;
    };

    // STRICT: only use categories from INTEREST_RULES (no synonyms), but allow case/plural variants
    const expandForQuery = (values) => {
      const set = new Set();
      const cap = (t) => t.replace(/\b\w/g, (m) => m.toUpperCase());
      const singularize = (t) => t.endsWith('s') ? t.slice(0, -1) : t;
      const pluralize = (t) => t.endsWith('s') ? t : t + 's';

      for (const v of values) {
        if (!v) continue;
        const base = String(v).trim();
        const lc = base.toLowerCase();
        const title = cap(lc);
        const sing = singularize(title);
        const plur = pluralize(title);
        [title, lc, sing, plur, sing.toLowerCase(), plur.toLowerCase()].forEach(x => set.add(x));
      }
      return Array.from(set);
    };

    // canonical compare: lowercase singular
    const canon = (s) => {
      let t = (s || '').toString().trim().toLowerCase();
      if (t.endsWith('s')) t = t.slice(0, -1);
      return t;
    };

    const run = async () => {
      try {
        const mappedExact = (userInterests || []).flatMap((i) => {
          if (!i) return [];
          return INTEREST_RULES[i] || INTEREST_RULES_LC[i.toLowerCase()] || [];
        });

        const targetCatsExact = uniqCasePreserve(mappedExact);
        if (targetCatsExact.length === 0) { setRecommendedDestinations([]); return; }

        setRecoLoading(true);

        // STRICT query terms (case/plural variants only)
        const queryTerms = expandForQuery(targetCatsExact);

        const all = new Map();
        const chunkSize = 10;

        // for array fields
        const fetchByArrayField = async (field) => {
          for (let i = 0; i < queryTerms.length; i += chunkSize) {
            const chunk = queryTerms.slice(i, i + chunkSize);
            const q = fsQuery(
              collection(db, 'destinations'),
              fsWhere(field, 'array-contains-any', chunk),
              limit(50)
            );
            const snap = await getDocs(q);
            snap.forEach((d) => { if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() }); });
          }
        };

        // for string field (category is often a string)
        const fetchByStringField = async (field) => {
          for (let i = 0; i < queryTerms.length; i += chunkSize) {
            const chunk = queryTerms.slice(i, i + chunkSize);
            const q = fsQuery(
              collection(db, 'destinations'),
              fsWhere(field, 'in', chunk),
              limit(50)
            );
            const snap = await getDocs(q);
            snap.forEach((d) => { if (!all.has(d.id)) all.set(d.id, { id: d.id, ...d.data() }); });
          }
        };

        await Promise.all([
          fetchByStringField('category'),
          fetchByArrayField('categories'),
          fetchByArrayField('Category'),
          fetchByArrayField('tags')
        ]);

        // STRICT scoring: only categories present in the rules
        const allowedCanon = new Set(targetCatsExact.map(canon));

        const scored = Array.from(all.values()).map((d) => {
          const catsArr = Array.isArray(d.categories) ? d.categories
                        : Array.isArray(d.Category) ? d.Category
                        : Array.isArray(d.category) ? d.category
                        : (typeof d.category === 'string' ? [d.category] : []);

          // score using CATEGORIES ONLY
          const score = catsArr.reduce((acc, c) => acc + (allowedCanon.has(canon(c)) ? 1 : 0), 0);
          return { ...d, _matchScore: score };
        });

        const results = scored
          .filter((d) => d._matchScore > 0)
          .sort((a, b) => {
            if (b._matchScore !== a._matchScore) return b._matchScore - a._matchScore;
            return (b.rating || 0) - (a.rating || 0);
          })
          .map((d) => ({
            id: d.id,
            name: d.name || d.title || '',
            region: d.region || d.locationRegion || '',
            description: d.description || d.desc || '',
            rating: d.rating || 0,
            price: d.price || '',
            priceTier: d.priceTier || null,
            tags: Array.isArray(d.tags) ? d.tags : [],
            // Normalize category to array (string/array variants)
            category: Array.isArray(d.category)
              ? d.category
              : Array.isArray(d.Category)
              ? d.Category
              : Array.isArray(d.categories)
              ? d.categories
              : (typeof d.category === 'string' && d.category.trim())
              ? [d.category.trim()]
              : (typeof d.Category === 'string' && d.Category.trim())
              ? [d.Category.trim()]
              : (typeof d.categories === 'string' && d.categories.trim())
              ? [d.categories.trim()]
              : [],
            location: d.location || '',
            image: d.image || d.imageUrl || '',
            bestTime: d.bestTime || '',
            lat: d.lat || d.latitude,
            lon: d.lon || d.longitude,
            place_id: d.place_id || d.id
          }));

        setRecommendedDestinations(results);
      } catch (e) {
        console.error('recommendation fetch failed', e);
        setRecommendedDestinations([]);
      } finally {
        setRecoLoading(false);
      }
    };

    run();
  }, [userInterests]);

  return (
    <>
      {/* Hero Banner */}
      <div
        className="dashboard-banner"
        style={{
          background: `url("/dashboardBanner.jpg") center/cover no-repeat`
        }}
      >
        <h2>Discover the Philippines with AI-Powered Travel Planning</h2>
        <p>
          Get personalized recommendations, smart packing tips, and connect with fellow travelers to explore the beautiful islands of the Philippines.
        </p>
        <button
          className="dashboard-banner-btn"
          onClick={() => setShowAIModal(true)}
        >
          Start Planning with AI
        </button>
      </div>

      {/* Dashboard Stats */}
      <div className="dashboard-stats-row">
        <div className="dashboard-stat" title={statsError ? String(statsError) : undefined}>
          <span className="dashboard-stat-number blue">
            {statsLoading
              ? <span className={`loading-spinner${!statsLoading ? ' spinner-fade-out' : ''}`} />
              : stats.destinations}
          </span>
          <span className="dashboard-stat-label">Destinations</span>
        </div>
        <div className="dashboard-stat" title={statsError ? String(statsError) : undefined}>
          <span className="dashboard-stat-number green">
            {statsLoading
              ? <span className={`loading-spinner${!statsLoading ? ' spinner-fade-out' : ''}`} />
              : stats.bookmarked}
          </span>
          <span className="dashboard-stat-label">Bookmarked</span>
        </div>
        <div className="dashboard-stat" title={statsError ? String(statsError) : undefined}>
          <span className="dashboard-stat-number purple">
            {statsLoading
              ? <span className={`loading-spinner${!statsLoading ? ' spinner-fade-out' : ''}`} />
              : stats.tripsPlanned}
          </span>
          <span className="dashboard-stat-label">Trips Planned</span>
        </div>
        <div className="dashboard-stat" title={statsError ? String(statsError) : undefined}>
          <span className="dashboard-stat-number orange">
            {statsLoading
              ? <span className={`loading-spinner${!statsLoading ? ' spinner-fade-out' : ''}`} />
              : stats.ratedCount}
          </span>
          <span className="dashboard-stat-label">Rated Destinations</span>
        </div>
      </div>

      {/* Your trips and bookmarks section */}
      <div className="dashboard-preview-row">
        <div className="dashboard-preview-col">
          <div className="dashboard-preview-title">Your trips</div>
          <button 
            className="dashboard-preview-btn"
            onClick={() => setShowAIModal(true)}
          >
            + Plan new trip
          </button>
          <div className="dashboard-preview-list" ref={tripsContainerRef} style={{ position: 'relative' }}>
            {tripsLoading ? (
              <div className="dashboard-preview-empty">Loading trips…</div>
            ) : trips && trips.length > 0 ? (
              trips.slice(0, 2).map(trip => (
                <div className="dashboard-preview-trip" key={trip.id || trip.name}>
                  <img src={trip.image || getImageForDestination(trip.name) || '/placeholder.png'} alt={trip.name || trip.title} className="dashboard-preview-img" />
                  <div className="dashboard-preview-info">
                    {/* removed top "Upcoming" badge; status is shown beside the title */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="dashboard-preview-trip-title">{trip.name || trip.title}</div>
                      {trip.status && (
                        <span className={`dashboard-preview-status ${String(trip.status).toLowerCase()}`}>
                          {trip.status}
                        </span>
                      )}
                    </div>
                    <div className="dashboard-preview-trip-meta">
                        <span>
                          {trip.arrival ? `${trip.arrival}` : ''}
                          {trip.departure ? ` – ${trip.departure}` : ''}
                          {trip.activities && Array.isArray(trip.activities)
                            ? ` • ${trip.activities.length} activit${trip.activities.length === 1 ? 'y' : 'ies'}`
                            : ''}
                        </span>
                      </div>
                  </div>
                  {/* three-dot toggle for trips (separate classname to avoid collision) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      className="dashboard-trip-dots"
                      aria-label="Trip actions"
                      title="Actions"
                      onClick={(e) => toggleTripActions(e, trip.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        fontSize: 20,
                        cursor: 'pointer',
                        padding: '6px'
                      }}
                    >
                      ⋯
                    </button>

                    {/* trip action popup rendered inside trips container */}
                    {openTripActionsId === trip.id && (
                      <div
                        ref={tripActionsRef}
                        className="dashboard-trip-actions dashboard-preview-actions"
                        style={{
                          position: 'absolute',
                          top: tripActionsPos.top,
                          left: tripActionsPos.left,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          background: '#fff',
                          borderRadius: 8,
                          padding: 8,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                          zIndex: 2000,
                          minWidth: 160
                        }}
                      >
                        <button
                          className="dashboard-preview-btn"
                          onClick={() => openTripSummary(trip)}
                          aria-label="View summary"
                          title="View Summary"
                          style={{ padding: '6px 10px', textAlign: 'left' }}
                        >
                          🔎 View Summary
                        </button>
                        <button
                          className="dashboard-preview-btn"
                          onClick={() => editTrip(trip)}
                          aria-label="Edit trip"
                          title="Edit"
                          style={{ padding: '6px 10px', textAlign: 'left' }}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          className="dashboard-preview-btn"
                          onClick={() => removeTrip(trip)}
                          aria-label="Remove trip"
                          title="Remove"
                          style={{ padding: '6px 10px', background: '#ffecec', textAlign: 'left' }}
                        >
                          🗑️ Remove
                        </button>
                      </div>
                    )}
                  </div>
                  </div>
                ))
              ) : (
                <div className="dashboard-preview-empty">No trips found. Start planning your first trip!</div>
              )}
            </div>
          </div>
        <div className="dashboard-preview-col">
          <div className="dashboard-preview-title">Bookmarks</div>
          <button 
            className="dashboard-preview-btn"
            onClick={() => navigate('/bookmarks2')}
          >
            + Add new bookmark
          </button>
          <div className="dashboard-preview-list" ref={bookmarksContainerRef} style={{ position: 'relative' }}>
            {bookmarksLoading ? (
              <div className="dashboard-preview-empty">Loading bookmarks…</div>
            ) : bookmarks.length === 0 ? (
              <div className="dashboard-preview-empty">
                You don't have any bookmarks yet. <span style={{ color: "#e74c3c" }}>Add a new bookmark.</span>
              </div>
            ) : (
              bookmarks.map(bm => (
                <div
                  className="dashboard-preview-bookmark"
                  key={bm.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                    <img
                      src={bm.image || getImageForDestination(bm.name) || '/placeholder.png'}
                      alt={bm.title || bm.name}
                      className="dashboard-preview-img"
                    />
                    <div className="dashboard-preview-bookmark-info">
                      <div className="dashboard-preview-bookmark-title">{bm.title || bm.name}</div>
                      <div className="dashboard-preview-bookmark-desc">{bm.desc || bm.description}</div>
                    </div>
                  </div>

                  {/* three-dot toggle + conditional action bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12 }}>
                    <button
                      className="dashboard-preview-dots"
                      aria-label="Actions"
                      title="Actions"
                      onClick={(e) => toggleBookmarkActions(e, bm.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        fontSize: 20,
                        cursor: 'pointer',
                        padding: '6px'
                      }}
                    >
                      ⋯
                    </button>

                    {/* render popup inside parent so it stays positioned relative to the list */}
                    {openActionsId === bm.id && (
                      <div
                        ref={actionsRef}
                        className="dashboard-preview-actions"
                        style={{
                          position: 'absolute',
                          top: actionsPos.top,
                          left: actionsPos.left,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          background: '#fff',
                          borderRadius: 8,
                          padding: 8,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                          zIndex: 2000,
                          minWidth: 160
                        }}
                      >
                        <button
                          className="dashboard-preview-btn"
                          onClick={() => { openBookmarkDetails(bm); setOpenActionsId(null); }}
                          aria-label="View details"
                          title="View details"
                          style={{ padding: '6px 10px', textAlign: 'left' }}
                        >
                          🔎 View
                        </button>
                        <button
                          className={`itn-btn success ${addedTripId === bm.id ? 'btn-success' : ''}`}
                          onClick={() => { onAddToTrip(bm); setOpenActionsId(null); }}
                          disabled={addingTripId === bm.id}
                          aria-busy={addingTripId === bm.id}
                          title="Add to Trip"
                          style={{ padding: '6px 10px', textAlign: 'left' }}
                        >
                          ＋ Add to Trip
                        </button>
                        <button
                          className="dashboard-preview-btn"
                          onClick={() => { removeBookmarkPreview(bm.id); setOpenActionsId(null); }}
                          aria-label="Remove bookmark"
                          title="Remove"
                          style={{ padding: '6px 10px', background: '#ffecec', textAlign: 'left' }}
                        >
                          🗑️ Remove
                        </button>
                      </div>
                    )}
                  </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      {/* Personalized Section */}
    <div className="personalized-section-dashboard">
      <div className="personalized-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <span>Personalized for You</span>
        {/* Filter: Sort by rating */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label htmlFor="personalized-sort" style={{ fontSize: 15, color: '#64748b' }}>Sort by:</label>
          <select
            id="personalized-sort"
            value={personalizedSort}
            onChange={e => setPersonalizedSort(e.target.value)}
            style={{
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              padding: '4px 10px',
              fontSize: 14,
              background: '#f8fafc',
              color: '#334155'
            }}
          >
            <option value="rating-desc" className='description'>Highest Rating</option>
            <option value="rating-asc" className='description'>Lowest Rating</option>
          </select>
        </div>
      </div>

      {recoLoading && (
        <div className="dashboard-preview-empty">Finding destinations based on your interests…</div>
      )}

      {!recoLoading && sortedRecommendedDestinations.length === 0 && (
        <div className="dashboard-preview-empty">
          No personalized destinations yet. Add interests on your profile to get recommendations.
        </div>
      )}

        <div className="personalized-cards-grid">
          {sortedRecommendedDestinations.map((d) => (
            <div className="grid-card-anim" key={d.id}>
              <div className="grid-card">
                <div className="card-image">
                  {cloudImages.length === 0 ? (
                    <div style={{ width: "100%", height: 150, background: "#e0e7ef" }}>Loading...</div>
                  ) : (
                    <img
                      src={pickCardImage(d.name)}
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
                  )}
                  <button
                    className={`bookmark-bubble ${personalizedBookmarks[d.id] ? 'active' : ''}`}
                    onClick={() => handlePersonalizedBookmark(d.id)}
                    aria-label="Toggle bookmark"
                    title="Bookmark"
                  >
                    {personalizedBookmarks[d.id] ? '❤️' : '🤍'}
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
                  {(d.tags || d.categories || []).slice(0, 8).map((t, i) => (
                    <span key={i} className="tag">{t}</span>
                  ))}
                </div>

                <div className="card-footer">
                  <div
                    className={`price-pill ${d.priceTier === 'less' ? 'pill-green' : 'pill-gray'}`}
                    title={d.priceTier === 'less' ? 'Less Expensive tier' : 'Expensive tier'}
                  >
                    {formatPeso(d.price)}
                  </div>
                  <button className="details-btn" onClick={() => handlePersonalizedDetails(d)}>
                    View Details
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Details Modal for Personalized Cards (bookmarks2 style) */}
      {detailsModalOpen && selectedCard && (
        <div
          className="modal-overlay active"
          onClick={(e) => e.target.classList.contains('modal-overlay') && closeDetailsModal()}
        >
          <div className="modal-content details-modal">
            <button className="modal-close-floating" onClick={closeDetailsModal} aria-label="Close">
              ✕
            </button>

            <div className="details-hero1">
              <div className="details-hero-image">
                {cloudImages.length === 0 ? (
                  <div style={{ width: "100%", height: 240, background: "#e0e7ef", borderRadius: 16 }} />
                ) : (
                  <img
                    src={pickCardImage(selectedCard.name)}
                    alt={selectedCard.name}
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
                )}
              </div>
            </div>

            <div className="details-body1">
              <div className="details-head-row">
                <div className="details-title-col">
                  <h2 className="details-title">{selectedCard.name}</h2>
                  <a href="https://maps.google.com" className="details-region" onClick={(e) => e.preventDefault()}>
                    {selectedCard.region}
                  </a>
                  <div className="details-rating-row">
                    <span className="star">⭐</span>
                    <span className="muted">
                      {(personalizedRatingsByDest[selectedCard.id]?.count ?? 0) > 0
                        ? (personalizedRatingsByDest[selectedCard.id].avg).toFixed(1)
                        : '0'}
                    </span>
                    <span className="muted"> (Average Rating)</span>
                    <span className="muted">
                      ({personalizedRatingsCountByDest[selectedCard.id] !== undefined
                        ? personalizedRatingsCountByDest[selectedCard.id]
                        : 0} ratings)
                    </span>
                    <span className="muted sep">Rating:</span>
                    <div className="your-stars">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          className={`star-btn ${personalizedUserRating >= n ? 'filled' : ''}`}
                          onClick={() => ratePersonalizedSelected(n)}
                          disabled={personalizedSavingRating}
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
                    className={`btn-outline ${personalizedBookmarks[selectedCard.id] ? 'active' : ''}`}
                    onClick={() => handlePersonalizedBookmark(selectedCard.id)}
                  >
                    <span className="icon">{personalizedBookmarks[selectedCard.id] ? '❤️' : '🤍'}</span>
                    {personalizedBookmarks[selectedCard.id] ? 'Bookmarked' : 'Bookmark'}
                  </button>
                  <button
                    className={`btn-green ${addedTripId === selectedCard.id ? 'btn-success' : ''}`}
                    onClick={() => onAddToTrip(selectedCard)}
                    disabled={addingTripId === selectedCard.id}
                    aria-busy={addingTripId === selectedCard.id}
                  >
                    <span className="icon">
                      {addedTripId === selectedCard.id ? '✔' : '＋'}
                    </span>
                    {addingTripId === selectedCard.id
                      ? 'Adding…'
                      : addedTripId === selectedCard.id
                      ? 'Added!'
                      : 'Add to Trip'}
                  </button>
                </div>
              </div>

              <div className="details-grid">
                <div className="details-left">
                  <div className="section-title">Description</div>
                  <p className="details-paragraph">{selectedCard.description}</p>

                  <div className="section-title">Tags</div>
                  <div className="badge-row">
                    {(selectedCard.tags || selectedCard.categories || []).map((t, i) => (
                      <span key={i} className="badge">{t}</span>
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
                      width: '100%',
                      gridColumn: '1 / -1',
                      marginBottom: 18,
                      zIndex: 1
                    }}
                  >
                    <WriteReview
                      destId={selected.id}
                      user={auth.currentUser || currentUser}
                      onReviewSaved={() => {
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

                <aside className="trip-info-box" style={{ textAlign: 'center',alignItems: 'center', justifyContent: 'center'}}>
                  <div className="trip-title" style={{ alignItems: 'center', justifyContent: 'center'}}>Trip Information</div>

                  <div className="trip-item">
                    <div className="trip-label" style={{ textAlign: 'center',alignItems: 'center', justifyContent: 'center'}}>Price</div>
                    <span style={{alignItems: 'center', justifyContent: 'center'}}
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
                    <div className="trip-label" style={{ textAlign: 'center',alignItems: 'center', justifyContent: 'center'}}>Best Time to Visit</div>
                    <div className="trip-text" style={{ textAlign: 'center',alignItems: 'center', justifyContent: 'center'}}>{selectedCard.bestTime || '—'}</div>
                  </div>

                  <div className="trip-item">
                    <div className="trip-label" style={{ textAlign: 'center',alignItems: 'center', justifyContent: 'center'}}>Categories</div>
                    <div className="badge-row">
                      {(
                        Array.isArray(selectedCard.category)
                          ? selectedCard.category
                          : Array.isArray(selectedCard.categories)
                          ? selectedCard.categories
                          : typeof selectedCard.category === 'string'
                          ? [selectedCard.category]
                          : typeof selectedCard.categories === 'string'
                          ? [selectedCard.categories]
                          : []
                      ).slice(0, 6).map((c, i) => (
                        <span key={i} className="badge purple">{c}</span>
                      ))}
                    </div>
                  </div>

                  {selectedCard.location && (
                    <div className="trip-item">
                      <div className="trip-label" style={{ textAlign: 'center',alignItems: 'center', justifyContent: 'center'}}>Location</div>
                      <div className="badge-row">
                        <span className="badge blue" style={{alignItems: 'center', justifyContent: 'center'}}>{selectedCard.location}</span>
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          </div>
        </div>
      )}
      

      {/* Trip Summary Modal (in-place) */}
      {showTripSummaryModal && summaryTrip && (
        <ItinerarySummaryModal item={summaryTrip} onClose={() => setShowTripSummaryModal(false)} />
      )}

      {/* Edit Trip Modal (in-place, saves to itinerary) */}
      {showEditTripModal && editingTrip && (
        <EditDestinationModal
          initial={editingTrip}
          onSave={saveTripEdit}
          onClose={() => setShowEditTripModal(false)}
        />
      )}
    </>
  );
}


export default Dashboard;

function WriteReview({ destId, user, onReviewSaved }) {
  const [review, setReview] = useState('');
  const [star, setStar] = useState(0);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [checkingReview, setCheckingReview] = useState(true); // <-- NEW

  useEffect(() => {
    let ignore = false;
    async function checkExistingReview() {
      if (!user || !destId) {
        if (!ignore) { setAlreadyReviewed(false); setCheckingReview(false); }
        return;
      }
      try {
        setCheckingReview(true);
        const reviewDoc = await getDoc(doc(db, "destinations", String(destId), "reviews", user.uid));
        if (!ignore) setAlreadyReviewed(reviewDoc.exists());
      } catch {
        if (!ignore) setAlreadyReviewed(false);
      } finally {
        if (!ignore) setCheckingReview(false);
      }
    }
    checkExistingReview();
    return () => { ignore = true; };
  }, [user, destId, success]);

  useEffect(() => {
    if (!user || !destId) return;
    let ignore = false;
    async function fetchUserRating() {
      try {
        const ratingDoc = await getDoc(doc(db, "destinations", String(destId), "ratings", user.uid));
        if (!ignore) setStar(Number(ratingDoc.data()?.value) || 0);
      } catch {
        if (!ignore) setStar(0);
      }
    }
    fetchUserRating();
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

      // Hard block in a transaction
      await runTransaction(db, async (tx) => {
        const reviewRef = doc(db, "destinations", String(destId), "reviews", user.uid);
        const snap = await tx.get(reviewRef);
        if (snap.exists()) {
          throw new Error("You have already submitted a review for this destination.");
        }
        const reviewData = {
          userId: user.uid,
          userName: user.displayName || user.email || "Anonymous",
          review: review.trim(),
          rating: star,
          createdAt: new Date().toISOString(),
        };
        tx.set(reviewRef, reviewData); // create only once

        const ratingRef = doc(db, "destinations", String(destId), "ratings", user.uid);
        tx.set(
          ratingRef,
          {
            value: star,
            userId: user.uid,
            updatedAt: serverTimestamp(),
            name: user.displayName || user.email || "Anonymous",
          },
          { merge: true }
        );
      });

      setSuccess("Review submitted!");
      setAlreadyReviewed(true); // block immediately in UI
      setReview('');
      setStar(0);
      if (onReviewSaved) onReviewSaved();
    } catch (err) {
      setError(err.message || "Failed to submit review.");
      console.error("Firestore error:", err);
    } finally {
      setSaving(false);
    }
  };
  
  if (checkingReview) {
    return <div style={{ color: "#64748b", marginBottom: 8 }}>Checking existing review…</div>;
  }
  if (alreadyReviewed && !success) {
    return (
      <div
        role="status"
        style={{
          width: '100%',
          textAlign: 'center',
          color: '#0862ea',     // blue
          fontWeight: 600,
          fontSize: 14,
          lineHeight: 1.35,
          padding: '8px 0',
          margin: '2px 0 10px 0'
        }}
      >
        You have already submitted a review for this destination.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {alreadyReviewed && !success && (
        <div style={{ color: "#0862eaff", fontWeight: 500, marginBottom: 8 }}>
          You have already submitted a review for this destination.
        </div>
      )}
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
          disabled={checkingReview || saving || alreadyReviewed}
        />
        <button
          type="submit"
          aria-label="Submit review"
          disabled={checkingReview || saving || !review.trim() || alreadyReviewed || star < 1}
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
        {success && <span style={{ color: "#22c55e" }}>{success}</span>}
        {error && <span style={{ color: "#e74c3c" }}>{error}</span>}
      </div>
    </form>
  );
}
// ...existing code...
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
          const data = docSnap.data() || {};
          // parse rating even if it is a string; allow legacy fields
          const parsedRating = Number(
            data.rating ?? data.value ?? data.stars ?? data.rate ?? 0
          ) || 0;

          arr.push({
            id: docSnap.id,                  // uid of reviewer
            userName: data.userName || "Anonymous",
            review: data.review || "",
            createdAt: data.createdAt,
            userId: data.userId,
            rating: parsedRating,            // may still be 0 if legacy review
          });
        });

        // backfill rating from /ratings subcollection for legacy reviews
        arr = await Promise.all(
          arr.map(async (r) => {
            if (r.rating > 0) return r;
            try {
              const rSnap = await getDoc(doc(db, "destinations", String(destId), "ratings", r.id));
              const v = Number(rSnap.data()?.value) || 0;
              return { ...r, rating: v };
            } catch {
              return r;
            }
          })
        );

        // newest first
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
    userReview = reviews.find(r => r.id === currentUser.uid); // Use doc ID for review
    otherReviews = reviews.filter(r => r.id !== currentUser.uid);
  }

  // Star rendering helper
  const renderStars = (rating) => (
    <span style={{ marginLeft: 8, marginRight: 8 }}>
      {Array.from({ length: 5 }).map((_, idx) => (
        <span
          key={idx}
          style={{
            color: idx < rating ? "#ffb300" : "#d1d5db",
            fontSize: 18,
            marginRight: 2,
            verticalAlign: "middle",
            fontFamily: "Arial, sans-serif",
          }}
        >
          ★
        </span>
      ))}
    </span>
  );

  const userStars = (userReview && Number(userReview.rating) > 0)
  ? Number(userReview.rating)
  : Number(userRating || 0);

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
      {userReview && (
        <div key={userReview.id} style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 0, flexWrap: "wrap" }}>
            <span style={nameStyle}>
              {userReview.userName} (You)
            </span>
            {renderStars(userStars, 24)}
          </div>
          <span style={dateStyle}>
            {userReview.createdAt ? new Date(userReview.createdAt).toLocaleString() : ""}
          </span>
          <div style={reviewTextStyle}>{userReview.review}</div>
        </div>
      )}
      {otherReviews.map((r) => (
        <div key={r.id} style={{ ...cardStyle, background: "#f8fafc", border: "1.5px solid #b6c7d6", color: "#222" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 0, flexWrap: "wrap" }}>
            <span style={{ ...nameStyle, color: "#0d47a1" }}>{r.userName}</span>
            {renderStars(Number(r.rating) || 0, 22)}
          </div>
          <span style={dateStyle}>{r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}</span>
          <div style={reviewTextStyle}>{r.review}</div>
        </div>
      ))}
    </div>
  );
}