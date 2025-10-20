import React, { useState } from "react";
import axios from "axios";
import "./EditProfile.css";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db } from './firebase'; // ensure available
import { doc as fsDoc, getDoc, updateDoc as fsUpdateDoc, arrayRemove } from 'firebase/firestore';

const interestsList = [
  { icon: "🏄‍♂️", label: "Surfer", color: "#e0f7fa" },
  { icon: "🎒", label: "Backpacker", color: "#f3e8ff" },
  { icon: "🍜", label: "Foodie Traveler", color: "#fffbe6" },
  { icon: "🏛️", label: "Culture Seeker", color: "#ede9fe" },
  { icon: "⚡", label: "Adventure Junkie", color: "#fee2e2" },
  { icon: "🌿", label: "Nature Enthusiast", color: "#e7fbe7" },
  { icon: "💻", label: "Digital Nomad", color: "#e0f2fe" },
  { icon: "🚗", label: "Road Tripper", color: "#fef3c7" },
  { icon: "🏖️", label: "Beach Lover", color: "#e0e7ff" },
  { icon: "🏙️", label: "City Explorer", color: "#f7f8fa" },
  { icon: "📸", label: "Photographer", color: "#f3f4f6" },
  { icon: "🏺", label: "Historian", color: "#e6fffa" },
  { icon: "🎉", label: "Festival Hopper", color: "#ffe4e6" },
  { icon: "🥾", label: "Hiker", color: "#dcfce7" },
  { icon: "💎", label: "Luxury Traveler", color: "#f0f5ff" },
  { icon: "🌱", label: "Eco-Traveler", color: "#e6fffa" },
  { icon: "🛳️", label: "Cruise Lover", color: "#e0e7ff" },
  { icon: "⛷️", label: "Winter Sports Enthusiast", color: "#e0f2fe" },
  { icon: "🧳", label: "Solo Wanderer", color: "#fef3c7" }
];

const MAX_BIO = 300;

const EditProfile = ({ onClose, onProfileUpdate, initialData = {} }) => {
  const [photo, setPhoto] = useState(null);
  const [photoFile, setPhotoFile] = useState(null); // <-- store file
  const [name, setName] = useState(initialData.name || "");
  const [bio, setBio] = useState(initialData.bio || "");
  // if initialData.interests is an empty array, fall back to default interestsList
  const [interests, setInterests] = useState(
    Array.isArray(initialData.interests) && initialData.interests.length
      ? initialData.interests
      : interestsList.map(i => ({ ...i, status: null }))
  );

  // ADD: active interests from Firestore (used only for border + one-click removal)
  const [activeInterests, setActiveInterests] = useState(() => {
    const arr = Array.isArray(initialData.interests) ? initialData.interests : [];
    const labels = arr.map(v => (typeof v === 'string' ? v : v?.label)).filter(Boolean);
    return new Set(labels);
  });
  const [saving, setSaving] = useState(false);

  // Toggle status: null -> like -> dislike -> null
  // UPDATED: if the clicked interest is already active (has border), remove it from Firestore
  const handleInterestClick = async (idx) => {
    const clicked = interests[idx];
    const label = clicked?.label;
    if (!label) return;

    // If this interest is active from Firestore, clicking removes it
    if (activeInterests.has(label)) {
      try {
        const u = auth.currentUser;
        if (!u) throw new Error('No user');
        await fsUpdateDoc(fsDoc(db, 'users', u.uid), { interests: arrayRemove(label) });
        setActiveInterests(prev => {
          const next = new Set(prev);
          next.delete(label);
          return next;
        });
      } catch (err) {
        console.error('Remove interest failed:', err);
        alert('Failed to remove interest. Please try again.');
      }
      return; // do not alter like/dislike when removing active
    }

    // Otherwise keep your existing like/dislike cycling
    setInterests(cur =>
      cur.map((i, iIdx) => {
        if (iIdx !== idx) return i;
        if (i.status === null) return { ...i, status: 'like' };
        if (i.status === 'like') return { ...i, status: 'dislike' };
        return { ...i, status: null };
      })
    );
  };

  // Update handlePhotoChange to store file
  const handlePhotoChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setPhoto(URL.createObjectURL(e.target.files[0]));
      setPhotoFile(e.target.files[0]);
    }
  };

  // Cloudinary upload function
  const uploadToCloudinary = async (file) => {
    const url = "https://api.cloudinary.com/v1_1/dxvewejox/image/upload";
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", "dxvewejox"); // use your unsigned preset name

    const response = await fetch(url, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Upload failed");
    return data.secure_url;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("No user logged in");

      // Likes and dislikes from the UI
      const likes = interests.filter(i => i.status === "like").map(i => i.label);
      const dislikes = interests.filter(i => i.status === "dislike").map(i => i.label);

      // FINAL interests to store:
      // - keep what is already active in Firestore (activeInterests)
      // - plus any newly liked items from the UI
      const finalInterests = Array.from(new Set([
        ...Array.from(activeInterests),  // already in users/{uid}.interests (after any removals)
        ...likes                         // new additions from this edit
      ]));

      const updateData = {};

      // travelerName and bio (unchanged)
      if (name && name.trim() !== (initialData.name || "")) {
        updateData.travelerName = name.trim();
      }
      if (bio !== (initialData.bio || "")) {
        updateData.bio = bio;
      }

      // profile picture (unchanged)
      if (photoFile) {
        updateData.profilePicture = await uploadToCloudinary(photoFile);
      }

      // WRITE TO 'interests' (not 'likes')
      // Only update if changed
      const initialInterests = Array.isArray(initialData.interests) ? initialData.interests : [];
      if (JSON.stringify(finalInterests) !== JSON.stringify(initialInterests)) {
        updateData.interests = finalInterests;
      }

      // Keep storing dislikes if you already use it elsewhere (non-breaking)
      if (JSON.stringify(dislikes) !== JSON.stringify(initialData.dislikes || [])) {
        updateData.dislikes = dislikes;
      }

      if (Object.keys(updateData).length === 0) {
        if (onClose) onClose();
        setSaving(false);
        return;
      }

      await updateDoc(doc(db, "users", user.uid), updateData);

      if (onProfileUpdate) onProfileUpdate();
      if (onClose) onClose();
    } catch (err) {
      alert("Failed to save profile: " + err.message);
    }
    setSaving(false);
  };

  // ADD: load the current user's interests once (keeps other logic untouched)
  React.useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) return;
      try {
        const snap = await getDoc(fsDoc(db, 'users', u.uid));
        const raw = Array.isArray(snap.data()?.interests) ? snap.data().interests : [];
        const labels = raw.map(v => (typeof v === 'string' ? v : v?.label)).filter(Boolean);
        setActiveInterests(new Set(labels));
      } catch (e) {
        console.warn('Failed to load interests:', e);
      }
    });
    return () => typeof unsub === 'function' && unsub();
  }, []);

  return (
    <div className="edit-profile-backdrop">
      <div className="edit-profile-modal">
        <div className="edit-profile-header">
          <span>Edit Travel Profile</span>
          <div className="edit-profile-sub">Customize your adventure identity</div>
        </div>
        <div className="edit-profile-content">
          <div className="edit-profile-left">
            <div className="edit-profile-avatar">
              <label htmlFor="profile-photo-upload" className="edit-profile-avatar-label">
                {photo ? (
                  <img 
                    src={photo} 
                    alt="Profile" 
                    className="edit-profile-avatar-img"
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: "50%",
                      objectFit: "cover",
                      background: "#f3f4f6",
                      border: "3px solid #e5e7eb",
                      cursor: "pointer"
                    }}
                  />
                ) : initialData.profilePicture && initialData.profilePicture !== "/user.png" ? (
                  <img
                    src={initialData.profilePicture}
                    alt="Profile"
                    className="edit-profile-avatar-img"
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: "50%",
                      objectFit: "cover",
                      background: "#f3f4f6",
                      border: "3px solid #e5e7eb",
                      cursor: "pointer"
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: "50%",
                      background: "#a084ee",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "2.5rem",
                      fontWeight: "700",
                      border: "3px solid #e5e7eb",
                      cursor: "pointer"
                    }}
                  >
                    {(initialData.name || "U").charAt(0).toUpperCase()}
                  </div>
                )}
                <input
                  data-testid="photo-input"
                  id="profile-photo-upload"
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handlePhotoChange}
                />
              </label>
              <div className="edit-profile-avatar-change">Click to change photo</div>
            </div>
            <label className="edit-profile-label">
              Traveler Name
              <input
                type="text"
                className="edit-profile-input"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={40}
                placeholder="John Doe"
              />
            </label>
            <label className="edit-profile-label">
              Travel Bio
              <textarea
                className="edit-profile-textarea"
                value={bio}
                onChange={e => setBio(e.target.value.slice(0, MAX_BIO))}
                maxLength={MAX_BIO}
                rows={4}
                placeholder="Share something about your travel style..."
              />
              <div className="edit-profile-bio-count">
                {bio.length}/{MAX_BIO} characters
              </div>
            </label>
          </div>
          <div className="edit-profile-right">
            <div style={{ height: 12 }} /> {/* spacing between left and right */}
            <div className="edit-profile-interests-title">
              Travel Interests
              <div className="edit-profile-interests-sub">
                Click each interest to like (green) or dislike (red)
              </div>
            </div>
            <div className="edit-profile-interests-list" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', overflowX: 'hidden' }}>
              {interests.map((interest, idx) => {
                const isActive = activeInterests.has(interest.label); // active from Firestore
                let bgColor = interest.color;
                if (interest.status === 'like') bgColor = '#d1fae5';
                if (interest.status === 'dislike') bgColor = '#fee2e2';
                return (
                  <div
                    key={interest.label}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleInterestClick(idx)}
                    onKeyPress={(e) => { if (e.key === 'Enter' || e.key === ' ') handleInterestClick(idx); }}
                    title={isActive ? 'Click to remove from your interests' : 'Click to like (green) or dislike (red)'}
                    style={{
                      background: bgColor,
                      border: isActive ? '2px solid #6c63ff' : '2px solid transparent', // ADD border for active
                      borderRadius: '12px',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      cursor: 'pointer',
                      transition: 'border-color .2s, background .2s',
                      minHeight: 48,
                      boxShadow: '0 2px 8px rgba(108,99,255,0.07)'
                    }}
                  >
                    <span>{interest.icon}</span>
                    <span>{interest.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="edit-profile-actions">
          <button className="edit-profile-cancel" onClick={onClose}>Cancel</button>
          <button className="edit-profile-save" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditProfile;