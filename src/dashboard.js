import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { addTripForCurrentUser } from './Itinerary';
import { trackDestinationAdded } from './itinerary_Stats';
import { 
  collection, getDocs, orderBy, query as fsQuery, limit, doc, getDoc, onSnapshot, deleteDoc, serverTimestamp,
  where as fsWhere // ADD
} from 'firebase/firestore';
import { fetchCloudinaryImages, getImageForDestination as getCloudImageForDestination } from "./image-router";

import { signOut } from 'firebase/auth';
import { updateDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import './dashboardBanner.css';
import useUserDashboardStats from './dashboard-stats-row'; // <-- Add this import at the top
import destImages from './dest-images.json'; // Add this import at the top

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

// Interest → category rules (case-sensitive keys as in your profile)
const INTEREST_RULES = {
  "Surfer": ["Beach"],
  "Backpacker": ["Mountain", "Tourist", "Natural"],
  "Foodie Traveler": ["Cultural", "Tourist", "Heritage"],
  "Culture Seeker": ["Cultural", "Heritage", "Museums"],
  "Adventure Junkie": ["Mountain", "Waterfalls", "Caves"],
  "Nature Enthusiast": ["Natural", "Parks", "Lakes"],
  "Digital Nomad": ["City Explorer", "Tourist", "Landmarks"],
  "Road Tripper": ["Landmarks", "Tourist", "Natural"],
  "Beach Lover": ["Beach", "Islands", "Natural"],
  "City Explorer": ["Tourist", "Museums", "Cultural"],
  "Photographer": ["Landmarks", "Natural", "Heritage"],
  "Historian": ["Historical", "Heritage", "Museums"],
  "Festival Hopper": ["Cultural", "Tourist", "Heritage"],
  "Hiker": ["Mountain"],
  "Luxury Traveler": ["Islands", "Beach", "Heritage"],
  "Eco-Traveler": ["Parks", "Natural", "Caves"],
  "Cruise Lover": ["Islands", "Beach", "Lakes"],
  "Winter Sports Enthusiast": ["Mountain", "Natural", "Parks"],
  "Solo Wanderer": ["Tourist", "Cultural", "Landmarks"]
};

const INTEREST_RULES_LC = Object.fromEntries(
  Object.entries(INTEREST_RULES).map(([k, v]) => [k.toLowerCase(), v])
);


// Helper to prefer cloud -> firebase -> local -> placeholder (same strategy as bookmarks2)
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
  const navigate = useNavigate();

  // Fetch trips from Firestore (itinerary/{userId}/items) for the current user, real-time
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

  // Modal state for personalized details
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);

  // Handler for toggling bookmark for personalized cards
  const handlePersonalizedBookmark = (id) => {
    setPersonalizedBookmarks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Handler for view details (open modal)
  const handlePersonalizedDetails = (card) => {
    setSelectedCard(card);
    setDetailsModalOpen(true);
  };

  // Handler to close modal
  const closeDetailsModal = () => {
    setDetailsModalOpen(false);
    setSelectedCard(null);
  };

  const personalizedCards = [
    {
      id: 'banaue',
      name: 'Banaue Rice Terraces',
      region: 'CAR - Cordillera Administrative Region',
      rating: 5.0,
      price: '₱1,800',
      priceTier: 'less',
      description: 'Ancient rice terraces carved into mountains, often called the "Eighth Wonder of the World."',
      tags: ['UNESCO', 'Cultural', 'Hiking'],
      image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=400&q=80'
    },
    {
      id: 'el-nido',
      name: 'El Nido',
      region: 'Region IV-B - MIMAROPA',
      rating: 4.8,
      price: '₱3,200',
      priceTier: 'expensive',
      description: 'Dramatic limestone cliffs and turquoise lagoons.',
      tags: ['Islands', 'Snorkeling', 'Boat Tour'],
      image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=400&q=80'
    },
    {
      id: 'mayon',
      name: 'Mayon Volcano',
      region: 'Region V - Bicol Region',
      rating: 4.5,
      price: '₱1,200',
      priceTier: 'less',
      description: 'Perfect cone-shaped active volcano, considered the most beautiful volcano in the Philippines.',
      tags: ['Volcano', 'Hiking', 'Photography'],
      image: 'https://images.unsplash.com/photo-1519125323398-675f0ddb6308?auto=format&fit=crop&w=400&q=80'
    }
  ];

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
        categories: Array.isArray(dest.categories) ? dest.categories : [],
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
  const [recommendedDestinations, setRecommendedDestinations] = useState([]);

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
    // ADD: generate plural/singular + case variants for Firestore (case-sensitive) matches
    const expandForQuery = (values) => {
      const set = new Set();
      const cap = (t) => t.replace(/\b\w/g, (m) => m.toUpperCase());
      const singularize = (t) => t.endsWith('s') ? t.slice(0, -1) : t;
      const pluralize = (t) => t.endsWith('s') ? t : t + 's';

      const synonyms = {
        Mountain: ['Mountains', 'Volcano', 'Highland', 'Highlands', 'Trail', 'Trails', 'Hiking', 'Hike'],
        Mountains: ['Mountain', 'Volcano', 'Highland', 'Highlands', 'Trail', 'Trails', 'Hiking', 'Hike'],
        Park: ['Parks'],
        Parks: ['Park'],
        Island: ['Islands', 'Beach'],
        Islands: ['Island'],
        Beach: ['Beaches', 'Coast'],
        Museum: ['Museums'],
        Museums: ['Museum'],
        Waterfall: ['Waterfalls'],
        Waterfalls: ['Waterfall'],
        Lake: ['Lakes'],
        Lakes: ['Lake'],
        Landmark: ['Landmarks'],
        Landmarks: ['Landmark'],
        Cultural: [],
        Heritage: [],
        Tourist: [],
        Natural: [],
        Hiking: ['Hike', 'Trail', 'Trails']
      };

      for (const v of values) {
        if (!v) continue;
        const base = String(v).trim();
        const lc = base.toLowerCase();
        const title = cap(lc);
        const sing = singularize(title);
        const plur = pluralize(title);

        [base, lc, title, sing, plur].forEach(x => set.add(x));
        (synonyms[title] || []).forEach(x => {
          set.add(x);
          set.add(x.toLowerCase());
          set.add(cap(x));
        });
      }
      return Array.from(set);
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

        // USE expanded variants for querying (covers Mountain/Mountains and case)
        const queryTerms = expandForQuery(targetCatsExact);

        const all = new Map();
        const chunkSize = 10;

        const fetchByField = async (field) => {
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

        await Promise.all([
          fetchByField('categories'),
          fetchByField('tags'),
          fetchByField('Categories')
        ]);

        // Score overlap vs expanded normalized set
        const targetSet = new Set(expandForQuery(targetCatsExact).map(norm));
        const scored = Array.from(all.values()).map((d) => {
          const cats = Array.isArray(d.categories) ? d.categories : (Array.isArray(d.Categories) ? d.Categories : []);
          const tags = Array.isArray(d.tags) ? d.tags : [];
          const combined = [...cats, ...tags].map(norm);
          const score = combined.reduce((acc, c) => acc + (targetSet.has(c) ? 1 : 0), 0);
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
            categories: Array.isArray(d.categories) ? d.categories : (Array.isArray(d.Categories) ? d.Categories : []),
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
        <div className="personalized-title">Personalized for You</div>

        {recoLoading && (
          <div className="dashboard-preview-empty">Finding destinations based on your interests…</div>
        )}

        {!recoLoading && recommendedDestinations.length === 0 && (
          <div className="dashboard-preview-empty">
            No personalized destinations yet. Add interests on your profile to get recommendations.
          </div>
        )}

        <div className="personalized-cards-grid">
          {recommendedDestinations.map((d) => (
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
                    <span>⭐</span> {Number(d.rating || 0) > 0 ? Number(d.rating).toFixed(1) : '—'}
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

            <div className="details-hero">
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

            <div className="details-body">
              <div className="details-head-row">
                <div className="details-title-col">
                  <h2 className="details-title">{selectedCard.name}</h2>
                  <a href="#" className="details-region" onClick={(e) => e.preventDefault()}>
                    {selectedCard.region}
                  </a>

                  <div className="details-rating-row">
                    <span className="star">⭐</span>
                    <span className="avg">
                      {Number(selectedCard.rating || 0) > 0 ? Number(selectedCard.rating).toFixed(1) : '—'}
                    </span>
                    <span className="muted"> (Average Rating)</span>
                    <span className="muted sep">Your Rating:</span>
                    <div className="your-stars">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} className="star-btn" disabled aria-label={`${n} star${n>1?'s':''}`}>★</button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="details-actions">
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

                  <div className="section-title">Packing Suggestions</div>
                  <div className="packing-box">
                    {selectedCard.packingSuggestions || "No packing suggestions available."}
                  </div>
                </div>

                <aside className="trip-info-box">
                  <div className="trip-title">Trip Information</div>

                  <div className="trip-item">
                    <div className="trip-label">Price</div>
                    <span
                      className={`pill small ${selectedCard.priceTier === 'less' ? 'pill-green' : 'pill-gray'}`}
                      title={selectedCard.priceTier === 'less' ? 'Less Expensive tier' : 'Expensive tier'}
                    >
                      {formatPeso(selectedCard.price)}
                    </span>
                  </div>

                  <div className="trip-item">
                    <div className="trip-label">Best Time to Visit</div>
                    <div className="trip-text">{selectedCard.bestTime || '—'}</div>
                  </div>

                  <div className="trip-item">
                    <div className="trip-label">Categories</div>
                    <div className="badge-row">
                      {(selectedCard.categories || selectedCard.tags || []).slice(0, 6).map((c, i) => (
                        <span key={i} className="badge purple">{c}</span>
                      ))}
                    </div>
                  </div>

                  {selectedCard.location && (
                    <div className="trip-item">
                      <div className="trip-label">Location</div>
                      <div className="badge-row">
                        <span className="badge blue">{selectedCard.location}</span>
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