import React, { useState, useEffect, useRef, useMemo } from "react";
// fix: use react-leaflet, not "react-g"
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import EditProfile from "./EditProfile";
import InfoDelete from "./info_delete";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  onSnapshot,
} from "firebase/firestore";
import { db, auth } from "./firebase";
import "./profile.css";
import { v4 as uuidv4 } from "uuid"; // Install with: npm install uuid
import { useUser } from "./UserContext";
import { emitAchievement } from "./achievementsBus";
import { onAuthStateChanged } from "firebase/auth";
import { getUserDashboardStats } from "./dashboard-stats-row"; // <-- Add this import
import { getUserCompletionStats } from './itinerary_Stats';

export const CLOUDINARY_CONFIG = {
  cloudName: "dxvewejox",
  uploadPreset: "dxvewejox",
};

// Helper: fix EXIF orientation + square crop for Cloudinary assets
const transformCloudinary = (url, { w = 120, h = 120 } = {}) => {
  if (!url) return "/placeholder.png";
  if (typeof url !== "string") return url;                   // guard against objects
  if (!url.includes("res.cloudinary.com")) return url;
  return url.replace(
    "/upload/",
    `/upload/c_fill,w_${w},h_${h},q_auto,f_auto,a_auto,g_auto/`
  );
};

const LABELS = {
  ALL_PHOTOS: "All Photos",
};

const Profile = () => {
  // Replace this:
  // const { profile } = useUser();

  // With this local state that mirrors context (no context setter needed)
  const userContext = useUser();
  const ctxProfile = userContext?.profile ?? null;
  const [profile, setProfile] = useState(ctxProfile);
  useEffect(() => {
    setProfile(ctxProfile ?? null);
  }, [ctxProfile]);

  // Custom marker icon
  const customIcon = new L.Icon({
    iconUrl: "/placeholder.png",
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });

  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const [showInfoDelete, setShowInfoDelete] = useState(false);
  const [showShareCode, setShowShareCode] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [unlockedAchievements, setUnlockedAchievements] = useState(new Set());
  const [photos, setPhotos] = useState([]);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [activities, setActivities] = useState([]);
  // initialize friends as 0 so UI shows 0 immediately on refresh
  const [stats, setStats] = useState({
    placesVisited: 0,
    photosShared: 0,
    reviewsWritten: 0,
    friends: 0, // show 0 immediately, update later when authoritative count arrives
  });
  const [shareCode, setShareCode] = useState("");
  const [completedDestinations, setCompletedDestinations] = useState([]);

  // Map state - simplified (no search)
  const [mapCenter, setMapCenter] = useState([12.8797, 121.774]);
  const [mapZoom, setMapZoom] = useState(6);

  // Function to fetch profile data
  const fetchProfile = async (uidParam, userObj) => {
    try {
      const uid = uidParam || userObj?.uid || auth.currentUser?.uid;
      if (!uid) return;

      const user = userObj || auth.currentUser || null;

      // Get Firestore profile
      const docRef = doc(db, "users", uid);
      const docSnap = await getDoc(docRef);
      let data = docSnap.exists() ? docSnap.data() : {};

      // Joined date from Auth if available
      const joined =
        user?.metadata?.creationTime
          ? new Date(user.metadata.creationTime).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
            })
          : (data.joined || ""); // fallback to existing

      setProfile((prev) => ({
        ...prev,
        name: data.travelerName ?? prev?.travelerName ?? "",
        bio: data.bio ?? prev?.bio ?? "",
        profilePicture: data.profilePicture ?? prev?.profilePicture ?? "/user.png",
        // LIVE interests from 'interests' (fallback to legacy 'likes')
        interests: Array.isArray(data.interests)
          ? data.interests
          : (Array.isArray(data.likes) ? data.likes : (prev?.interests || [])),
        likes: Array.isArray(data.likes) ? data.likes : prev?.likes || [],
        dislikes: Array.isArray(data.dislikes) ? data.dislikes : prev?.dislikes || [],
      }));

      setShareCode(data.shareCode || "");

      // DON'T set friends from the user doc here (may be stale).
      // Preserve current friends value (initially 0) and update other stats immediately.
      setStats((prev) => ({
        placesVisited: data.stats?.placesVisited || 0,
        photosShared: data.stats?.photosShared || 0,
        reviewsWritten: data.stats?.reviewsWritten || 0,
        friends: prev.friends ?? 0,
      }));

      // Heavy reads in parallel (photos, activities)
      await Promise.all([
        (async () => {
          try {
            const photosQuery = query(collection(db, "photos"), where("userId", "==", uid));
            const photosSnapshot = await getDocs(photosQuery);
            setPhotos(photosSnapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          } catch { setPhotos([]); }
        })(),
        (async () => {
          try {
            const activitiesQuery = query(collection(db, "activities"), where("userId", "==", uid));
            const activitiesSnapshot = await getDocs(activitiesQuery);
            setActivities(
              activitiesSnapshot.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 10)
            );
          } catch { setActivities([]); }
        })(),
      ]);

      // Replace friends count with subcollection size (authoritative)
      let friendsCount = undefined; // <-- define before use to avoid no-undef
      try {
        const friendsSnap = await getDocs(collection(db, "users", uid, "friends"));
        friendsCount = friendsSnap.size;
      } catch (e) {
        console.warn("Failed to read friends subcollection count:", e);
      }

      setStats((prev) => ({
        placesVisited: data.stats?.placesVisited || prev.placesVisited || 0,
        photosShared: data.stats?.photosShared || prev.photosShared || 0,
        reviewsWritten: data.stats?.reviewsWritten || prev.reviewsWritten || 0,
        friends: typeof friendsCount === "number" ? friendsCount : prev.friends ?? 0,
      }));
    } catch (error) {
      console.error("Error fetching profile data:", error);
    }
  };

  // Add userId state and subscribe to auth state (critical for refresh)
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
        fetchProfile(user.uid, user); // initial load as soon as Firebase restores session
      } else {
        setUserId(null);
        setProfile(null);
        setPhotos([]);
        setActivities([]);
        setStats({ placesVisited: 0, photosShared: 0, reviewsWritten: 0, friends: 0 });
        setShareCode("");
      }
    });
    return unsub;
  }, []);

  // Remove the old "Initial load (no overlay)" effect that used auth.currentUser
  // and replace it with a simple refetch whenever userId changes.
  useEffect(() => {
    if (userId) fetchProfile(userId);
  }, [userId]);

  // Real-time listener now depends on userId (not auth.currentUser?.uid)
  useEffect(() => {
    if (!userId) return;
    const userRef = doc(db, "users", userId);
    const unsubscribe = onSnapshot(userRef, (docSnap) => {
      if (!docSnap.exists()) return;
      const data = docSnap.data();

      setProfile((prev) => ({
        ...prev,
        name: data.travelerName ?? prev?.travelerName ?? "",
        bio: data.bio ?? prev?.bio ?? "",
        profilePicture: data.profilePicture ?? prev?.profilePicture ?? "/user.png",
        likes: Array.isArray(data.likes) ? data.likes : prev?.likes || [],
        dislikes: Array.isArray(data.dislikes) ? data.dislikes : prev?.dislikes || [],
      }));

      // do NOT set friends here — preserve null/authoritative value from friends listener
      setStats((prev) => ({
        placesVisited: data.stats?.placesVisited ?? prev.placesVisited,
        photosShared: data.stats?.photosShared ?? prev.photosShared,
        reviewsWritten: data.stats?.reviewsWritten ?? prev.reviewsWritten,
        friends: prev.friends,
      }));
    });

    return () => unsubscribe();
  }, [userId]);

  // authoritative friends count from the friends subcollection
  useEffect(() => {
    if (!userId) return;
    const friendsCol = collection(db, "users", userId, "friends");
    const unsubscribe = onSnapshot(friendsCol, (snap) => {
      setStats((prev) => ({ ...prev, friends: snap.size }));
    });
    return () => unsubscribe();
  }, [userId]);

  // After editing profile, refetch using userId (auth.currentUser may still be null briefly on hard refresh)
  useEffect(() => {
    if (userId) fetchProfile(userId);
  }, [showEditProfile, userId]);

  const navigate = useNavigate();

  // Achievements data
  const achievementsData = [
    {
      id: 1,
      category: "Getting Started",
      title: "First Step",
      description: "Create your very first itinerary.",
      icon: "🎯",
      unlocked: unlockedAchievements.has(1),
    },
    {
      id: 2,
      category: "Getting Started",
      title: "First Bookmark",
      description: "Save your first place to your favorites.",
      icon: "⭐",
      unlocked: unlockedAchievements.has(2),
    },
    {
      id: 3,
      category: "Getting Started",
      title: "Say Cheese!",
      description: "Upload your first travel photo.",
      icon: "📸",
      unlocked: unlockedAchievements.has(3),
    },
    {
      id: 4,
      category: "Getting Started",
      title: "Hello, World!",
      description:
        "Post your first comment on any itinerary or location.",
      icon: "💬",
      unlocked: unlockedAchievements.has(4),
    },
    {
      id: 5,
      category: "Getting Started",
      title: "Profile Pioneer",
      description: "Complete your profile with a photo and bio.",
      icon: "👤",
      unlocked: unlockedAchievements.has(5),
    },
    {
      id: 6,
      category: "Exploration & Planning",
      title: "Mini Planner",
      description: "Add at least 3 places to a single itinerary.",
      icon: "🗺️",
      unlocked: unlockedAchievements.has(6),
    },
    {
      id: 7,
      category: "Exploration & Planning",
      title: "Explorer at Heart",
      description: "View 10 different destinations in the app.",
      icon: "✈️",
      unlocked: unlockedAchievements.has(7),
    },
    {
      id: 8,
      category: "Exploration & Planning",
      title: "Checklist Champ",
      description: 'Mark your first place as "visited".',
      icon: "✅",
      unlocked: unlockedAchievements.has(8),
    },
  ];

  // Notification helper
  const showAchievementNotification = (message) => {
    emitAchievement(message);
  };

  // Unlock achievement (generic)
  const unlockAchievement = async (achievementId, achievementName) => {
    // Get current user
    const user = auth.currentUser;
    if (!user) return;

    // Check if already unlocked
    const snap = await getDoc(doc(db, "users", user.uid));
    const already =
      snap.exists() &&
      snap.data().achievements &&
      snap.data().achievements[achievementId] === true;

    if (!already) {
      // Save to Firestore
      await updateDoc(doc(db, "users", user.uid), {
        [`achievements.${achievementId}`]: true,
      });
      // Optionally show notification
      emitAchievement(`${achievementName} Achievement Unlocked! 🎉`);
    }
  };

  // Ensure an achievement is unlocked (checks Firestore to prevent duplicate toast)
  const ensureAchievementUnlocked = async (achievementId, achievementName) => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const snap = await getDoc(doc(db, "users", user.uid));
      const already =
        snap.exists() &&
        snap.data().achievements &&
        snap.data().achievements[achievementId] === true;

      if (!already) {
        await unlockAchievement(achievementId, achievementName);
      }
    } catch (e) {
      console.error("Error ensuring achievement:", e);
    }
  };

  // Cloudinary upload
  const uploadToCloudinary = async (file) => {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_CONFIG.uploadPreset);

    const response = await fetch(url, { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Upload failed");
    return data.secure_url;
  };

  // Upload photo
  const handlePhotoUpload = async (e) => {
    if (e.target.files && e.target.files[0]) {
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("No user logged in");

        const photoUrl = await uploadToCloudinary(e.target.files[0]);

        const photoData = {
          userId: user.uid,
          url: photoUrl,
          timestamp: new Date().toISOString(),
        };

        const photoDocRef = await addDoc(collection(db, "photos"), photoData);
        const newPhoto = { id: photoDocRef.id, ...photoData };

        // Prepend the new photo so the preview shows the most recent first
        const updatedPhotos = [newPhoto, ...(photos || [])];

        setPhotos(updatedPhotos);
        setStats((prevStats) => ({
          ...prevStats,
          photosShared: prevStats.photosShared + 1,
        }));

        await updateDoc(doc(db, "users", user.uid), {
          "stats.photosShared": updatedPhotos.length,
        });

        // Unlock "Say Cheese!" when uploading a photo (with toast)
        await ensureAchievementUnlocked(3, "Say Cheese!");

        await trackActivity.uploadPhoto();
      } catch (err) {
        console.error("Failed to upload photo: ", err);
        alert("Failed to upload photo: " + err.message);
      }
    }
  };

  // Delete photo
  const handleDeletePhoto = async (photoId) => {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("No user logged in");

      await deleteDoc(doc(db, "photos", photoId));
      const updatedPhotos = photos.filter((photo) => photo.id !== photoId);

      setPhotos(updatedPhotos);
      setStats((prevStats) => ({
        ...prevStats,
        photosShared: Math.max(0, prevStats.photosShared - 1),
      }));

      await updateDoc(doc(db, "users", user.uid), {
        "stats.photosShared": updatedPhotos.length,
      });
    } catch (err) {
      console.error("Failed to delete photo: ", err);
      alert("Failed to delete photo: " + err.message);
    }
  };

  // Photo interactions
  const handlePhotoClick = (photo) => setSelectedPhoto(photo);
  const closePhotoView = () => setSelectedPhoto(null);

  // Activities
  const addActivity = async (text, icon = "🔵") => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const activityData = {
        userId: user.uid,
        text,
        icon,
        timestamp: new Date().toISOString(),
      };

      await addDoc(collection(db, "activities"), activityData);
      setActivities((prev) => [activityData, ...prev.slice(0, 9)]);
    } catch (error) {
      console.error("Error adding activity:", error);
    }
  };

  const trackActivity = {
    uploadPhoto: () => addActivity("You have uploaded a photo.", "📸"),
    uploadVideo: () => addActivity("You have uploaded a video.", "🎥"),
    sharePost: () => addActivity("You have shared a post.", "📤"),
    createItinerary: () => addActivity("You have created a new itinerary.", "🗺️"),
    addLocation: () => addActivity("You have added a location to your itinerary.", "📍"),
    removeLocation: () => addActivity("You have removed a location from your itinerary.", "❌"),
    completeItinerary: () => addActivity("You have completed an itinerary.", "✅"),
    bookmarkPlace: () => addActivity("You have bookmarked a place.", "⭐"),
    removeBookmark: () => addActivity("You have removed a bookmark.", "💔"),
    completeAchievement: (name) => addActivity(`You have completed an achievement: ${name}`, "🏆"),
    unlockBadge: () => addActivity("You have unlocked a new badge.", "🎖️"),
    likePost: () => addActivity("You have liked a post.", "❤️"),
    commentPost: () => addActivity("You have commented on a post.", "💬"),
    updateProfile: () => addActivity("You have updated your profile.", "👤"),
    changePreferences: () => addActivity("You have changed your travel preferences.", "⚙️"),
    followTraveler: () => addActivity("You have followed a traveler.", "👥"),
    unfollowTraveler: () => addActivity("You have unfollowed a traveler.", "👋"),
    shareItinerary: () => addActivity("You have shared an itinerary.", "🔗"),
  };

  // Generate and save share code
  const handleShareProfile = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const code = uuidv4().slice(0, 8).toUpperCase();
      await updateDoc(doc(db, "users", user.uid), { shareCode: code });

      setShareCode(code);
      setShowShareCode(true);
    } catch (error) {
      alert("Failed to generate share code.");
      console.error(error);
    }
  };

  const copyShareCode = async () => {
    try {
      if (!shareCode) return;
      await navigator.clipboard.writeText(shareCode);
      alert("Code copied to clipboard");
    } catch {
      alert("Failed to copy");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  // Only keep newest first and a preview of 6
  const sortedPhotos = useMemo(() => {
    const ts = (p) => {
      if (!p) return 0;
      // Firestore Timestamp
      if (p?.createdAt?.toMillis) return p.createdAt.toMillis();
      // numeric timestamps
      if (typeof p?.createdAt === "number") return p.createdAt;
      if (typeof p?.uploadedAt === "number") return p.uploadedAt;
      // ISO string timestamp (e.g. new Date().toISOString())
      if (p?.timestamp) {
        const parsed = typeof p.timestamp === "number" ? p.timestamp : Date.parse(p.timestamp);
        if (!Number.isNaN(parsed)) return parsed;
      }
      return 0;
    };
    return [...(photos || [])].sort((a, b) => ts(b) - ts(a));
  }, [photos]);

  const previewPhotos = useMemo(() => sortedPhotos.slice(0, 6), [sortedPhotos]);

  // Pick the 2 most recent completed achievements from activities
  const recentCompletedAchievements = useMemo(() => {
    const toMs = (x) =>
      x?.toMillis?.() ??
      (typeof x === "number" ? x : (x ? Date.parse(x) : 0));
    return (activities || [])
      .filter(
        (a) =>
          a?.icon === "🏆" ||
          /completed an achievement/i.test(a?.text || "") ||
          /achievement/i.test(a?.text || "")
      )
      .sort(
        (a, b) =>
          toMs(b.completedAt || b.createdAt || b.timestamp || b.date) -
          toMs(a.completedAt || a.createdAt || a.timestamp || a.date)
      );
  }, [activities]);

  // Helper to extract the achievement name from the activity text
  const extractAchievementName = (text = "") => {
    const m = /completed an achievement:\s*(.+)$/i.exec(text);
    return (m && m[1]?.trim()) || "";
  };

  // Build render-ready cards for the 2 most recent completed achievements
  const recentAchievementCards = useMemo(() => {
    const cards = [];
    const seen = new Set();

    for (const a of recentCompletedAchievements) {
      const name =
        extractAchievementName(a.text) || a.title || a.name || "Achievement";
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const meta =
        achievementsData.find(
          (x) => x.title.toLowerCase() === key
        ) || undefined;

      const when =
        a?.completedAt?.toMillis?.() ||
        a?.createdAt?.toMillis?.() ||
        (a?.timestamp ? Date.parse(a.timestamp) : undefined) ||
        (a?.date ? Date.parse(a.date) : undefined) ||
        Date.now();

      cards.push({
        title: name,
        description: meta?.description || a.text || "Achievement completed",
        icon: meta?.icon || a.icon || "🏆",
        when,
      });

      if (cards.length === 2) break;
    }
    return cards;
  }, [recentCompletedAchievements, achievementsData]);

  // Sync unlocked achievements from Firestore
  useEffect(() => {
    if (!userId) {
      setUnlockedAchievements(new Set());
      return;
    }
    const userRef = doc(db, "users", userId);
    const unsubscribe = onSnapshot(userRef, (docSnap) => {
      if (!docSnap.exists()) {
        setUnlockedAchievements(new Set());
        return;
      }
      const achievements = docSnap.data().achievements || {};
      const unlocked = Object.entries(achievements)
        .filter(([_, v]) => v === true)
        .map(([k]) => Number(k));
      setUnlockedAchievements(new Set(unlocked));
    });
    return () => unsubscribe();
  }, [userId]);

  // Fetch reviews written count for current user
  useEffect(() => {
    const fetchReviewsWritten = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        // Count the number of docs in users/{uid}/ratings
        const ratingsSnap = await getDocs(collection(db, "users", user.uid, "ratings"));
        setStats((prev) => ({
          ...prev,
          reviewsWritten: ratingsSnap.size,
        }));
      } catch (e) {
        // fallback to 0 if error
        setStats((prev) => ({
          ...prev,
          reviewsWritten: 0,
        }));
      }
    };
    fetchReviewsWritten();
  }, [userId]);

  // Add this useEffect in Profile component
  useEffect(() => {
    if (!userId) return;
    const ratingsCol = collection(db, "users", userId, "ratings");
    const unsubscribe = onSnapshot(ratingsCol, (snap) => {
      setStats((prev) => ({
        ...prev,
        reviewsWritten: snap.size,
      }));
    });
    return () => unsubscribe();
  }, [userId]);

  // Fetch user's completed destinations from Stats collection
  useEffect(() => {
    const fetchCompletedDestinations = async () => {
      if (!userId) {
        setCompletedDestinations([]);
        return;
      }

      try {
        const stats = await getUserCompletionStats(userId);
        if (stats && stats.destinations) {
          // Convert destinations object to array with location data
          const destinationsArray = Object.entries(stats.destinations).map(([id, data]) => ({
            id,
            name: data.name || 'Unknown',
            region: data.region || '',
            completedAt: data.completedAt,
            latitude: data.latitude,
            longitude: data.longitude,
          }));

          // Filter out destinations without coordinates
          const withCoordinates = destinationsArray.filter(
            dest => dest.latitude && dest.longitude
          );

          setCompletedDestinations(withCoordinates);

          // Update the Places Visited stat with total completed count
          setStats((prev) => ({
            ...prev,
            placesVisited: destinationsArray.length, // Total completed destinations (with or without coordinates)
          }));

          // Auto-center map if there are completed destinations
          if (withCoordinates.length > 0) {
            // Calculate average position
            const avgLat = withCoordinates.reduce((sum, d) => sum + d.latitude, 0) / withCoordinates.length;
            const avgLng = withCoordinates.reduce((sum, d) => sum + d.longitude, 0) / withCoordinates.length;
            setMapCenter([avgLat, avgLng]);
            setMapZoom(7); // Zoom in a bit to show the cluster
          }
        } else {
          // No completed destinations
          setStats((prev) => ({
            ...prev,
            placesVisited: 0,
          }));
        }
      } catch (error) {
        console.error('Error fetching completed destinations:', error);
        setCompletedDestinations([]);
        setStats((prev) => ({
          ...prev,
          placesVisited: 0,
        }));
      }
    };

    fetchCompletedDestinations();
  }, [userId]);

  // Add this function:
  async function getUserFriendsCount(uid) {
    const snap = await getDocs(collection(db, "users", uid, "friends"));
    return snap.size;
  }

  // In Profile, fetch and display the count:
  useEffect(() => {
    if (userId) {
      getUserFriendsCount(userId).then(count =>
        setStats(prev => ({ ...prev, friends: count }))
      );
    }
  }, [userId]);

  return (
    <>
      {/* Animated background elements - MORE VISIBLE */}
      <div className="profile-bg-circle"></div>
      <div className="profile-bg-circle"></div>
      <div className="profile-bg-circle"></div>
      <div className="profile-bg-circle"></div>
      <div className="profile-bg-dots"></div>
      <div className="profile-bg-wave"></div>
      <div className="profile-bg-shapes">
        <div className="profile-bg-shape"></div>
        <div className="profile-bg-shape"></div>
        <div className="profile-bg-shape"></div>
      </div>

      <div className="profile-main">
        {/* Profile Header */}
        <div className="profile-header">
          <div className="profile-avatar">
            {profile?.profilePicture && profile.profilePicture !== "/user.png" ? (
              <img
                src={profile.profilePicture}
                alt="Profile"
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: "50%",
                  objectFit: "cover", // This ensures the image fills the circle properly
                  objectPosition: "center", // Centers the image within the crop
                  background: "#f3f4f6",
                  border: "4px solid #fff", // Match the EditProfile border
                  boxShadow: "0 2px 12px rgba(108,99,255,0.13)", // Match the CSS
                  display: "block", // Ensure proper display
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
                  border: "4px solid #fff",
                  boxShadow: "0 2px 12px rgba(108,99,255,0.13)",
                }}
              >
                {(profile?.name || "U").charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="profile-info">
            <div className="profile-title-row">
              <h2>{profile?.name || "Your Name"}</h2>
              {/* Make Edit Profile look like the other buttons */}
              <button
                className="btn btn-primary"
                onClick={() => setShowEditProfile(true)}
              >
                Edit Profile
              </button>
            </div>
            <div className="profile-meta">
              <span>🌟 Explorer</span>
              <span>• 🎂 Joined {profile?.joined || ""}</span>   {/* null-safe */}
            </div>
            <div className="profile-badges">
              {( (profile?.interests && profile.interests.length > 0 ? profile.interests : (profile?.likes || [])) ).map((interest) => (
                <div className="profile-interest profile-interest-like" key={interest}>
                  <span className="profile-interest-label">{interest}</span>
                </div>
              ))}
              {(profile?.dislikes || []).map((dislike) => (
                <div className="profile-interest profile-interest-dislike" key={dislike}>
                  <span className="profile-interest-label">{dislike}</span>
                </div>
              ))}
            </div>
            <div className="profile-bio">{profile?.bio || "No bio yet."}</div>
          </div>
        </div>

        {/* Stats */}
        <div className="profile-stats-row">
          <div className="profile-stat">
            <span>{stats.placesVisited}</span>
            <div>Places Visited</div>
          </div>
          <div className="profile-stat">
            <span>{stats.photosShared}</span>
            <div>Photos Shared</div>
          </div>
          <div className="profile-stat">
            <span>{stats.reviewsWritten}</span>
            <div>Rated Destinations</div>
          </div>

          {/* show Friends only after the friends listener has provided a value */}
          {stats.friends !== null && (
            <div className="profile-stat">
              <span>{stats.friends}</span>
              <div>Friends</div>
            </div>
          )}
        </div>

        <div className="profile-content-row">
          {/* Left column */}
          <div className="profile-content-main">
            {/* Travel Map - UPDATED: No search bar, only completed destinations */}
            <div className="profile-card">
              <div className="profile-card-title">🗺️ My Completed Destinations</div>
              <div style={{ height: "300px", position: "relative" }}>
                <MapContainer
                  center={mapCenter}
                  zoom={mapZoom}
                  style={{
                    height: "100%",
                    width: "100%",
                    borderRadius: "12px",
                    zIndex: 1,
                  }}
                  key={`${mapCenter[0]}-${mapCenter[1]}-${mapZoom}`}
                  attributionControl={false}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
                  
                  {/* Only show completed destinations */}
                  {completedDestinations.length > 0 ? (
                    completedDestinations.map((dest) => (
                      <Marker
                        key={`completed-${dest.id}`}
                        position={[dest.latitude, dest.longitude]}
                        icon={customIcon}
                      >
                        <Popup>
                          <div>
                            <h3>✅ {dest.name}</h3>
                            <p>{dest.region}</p>
                            {dest.completedAt && (
                              <p style={{ fontSize: '12px', color: '#666' }}>
                                Completed: {new Date(
                                  dest.completedAt.toMillis ? dest.completedAt.toMillis() : dest.completedAt
                                ).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </Popup>
                      </Marker>
                    ))
                  ) : (
                    // Show message when no completed destinations
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      background: 'white',
                      padding: '20px',
                      borderRadius: '12px',
                      boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
                      textAlign: 'center',
                      zIndex: 1000,
                      pointerEvents: 'none'
                    }}>
                      <div style={{ fontSize: '48px', marginBottom: '12px' }}>🗺️</div>
                      <div style={{ fontWeight: '600', marginBottom: '8px' }}>No completed destinations yet</div>
                      <div style={{ fontSize: '14px', color: '#666' }}>
                        Mark destinations as completed in your itinerary to see them here!
                      </div>
                    </div>
                  )}
                </MapContainer>
              </div>
              {completedDestinations.length > 0 && (
                <div style={{ 
                  marginTop: '12px', 
                  fontSize: '14px', 
                  color: '#666',
                  textAlign: 'center'
                }}>
                  📍 {completedDestinations.length} destination{completedDestinations.length !== 1 ? 's' : ''} completed
                </div>
              )}
            </div>

            {/* Recent Activity */}
            <div className="profile-card">
              <div className="profile-card-title">📝 Recent Activity</div>
              <div
                className="profile-activity-list"
                style={{ maxHeight: "240px", overflowY: "auto" }}
              >
                {activities.length > 0 ? (
                  activities
                    .slice(0, 10)
                    .map((a, i) =>
                      <div
                        className="profile-activity-item"
                        key={a.id || i}
                        style={{
                          background: `linear-gradient(135deg, ${[
                            "#667eea",
                            "#764ba2",
                            "#f093fb",
                            "#f5576c",
                            "#4facfe",
                            "#00f2fe",
                          ][i % 6]} 0%, ${[
                            "#764ba2",
                            "#667eea",
                            "#f5576c",
                            "#f093fb",
                            "#00f2fe",
                            "#4facfe",
                          ][i % 6]} 100%)`,
                          color: "white",
                          padding: "12px 16px",
                          borderRadius: "12px",
                          margin: "8px 0",
                          backdropFilter: "blur(10px)",
                          border: "1px solid rgba(255, 255, 255, 0.2)",
                        }}
                      >
                        <span
                          className="profile-activity-icon"
                          style={{
                            marginRight: "12px",
                            fontSize: "18px",
                          }}
                        >
                          {a.icon}
                        </span>
                        <span
                          className="profile-activity-text"
                          style={{ flex: 1, fontWeight: "500" }}
                        >
                          {a.text}
                        </span>
                        <span
                          className="profile-activity-time"
                          style={{ fontSize: "12px", opacity: 0.6 }}
                        >
                          {new Date(a.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    )
                ) : (
                  <div
                    style={{
                      textAlign: "center",
                      color: "#666",
                      padding: "20px",
                    }}
                  >
                    No recent activities
                  </div>
                )}
              </div>
            </div>

            {/* Photo Gallery */}
            <div className="profile-card">
              <div
                className="profile-card-title"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>📷 Photo Gallery</span>
                <div
                  className="profile-gallery-actions"
                  style={{ display: "flex", gap: 12 }}
                >
                  <label
                    htmlFor="photo-upload"
                    className="btn btn-primary"
                    style={{ cursor: "pointer" }}
                  >
                    Upload Photo
                  </label>
                  <input
                    id="photo-upload"
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handlePhotoUpload}
                  />
                  {photos.length > 0 && (
                    <button
                      className="btn btn-primary"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowAllPhotos(true);
                      }}
                    >
                      View All ({photos.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Single-row, horizontally scrollable preview — ONLY 7 recent */}
              <div
                className="profile-gallery-scroll"
                style={{
                  display: "flex",
                  gap: 12,
                  overflowX: "auto",
                  overflowY: "hidden",
                  padding: "6px 2px 10px",
                  scrollSnapType: "x proximity",
                  flexWrap: "nowrap", // keep a single row
                  maxHeight: 132, // 120 tile + paddings = one line only
                }}
              >
                {previewPhotos.length > 0 ? (
                  previewPhotos.map((photo) => (
                    <div
                      className="profile-gallery-photo"
                      key={photo.id || photo.url}
                      style={{
                        position: "relative",
                        width: 120,
                        height: 120,
                        flex: "0 0 auto",
                        cursor: "pointer",
                        scrollSnapAlign: "start",
                      }}
                      onClick={() => handlePhotoClick(photo)}
                    >
                      <img
                        src={transformCloudinary(photo.url, { w: 120, h: 120 })}
                        alt="Gallery"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          borderRadius: 14,
                          imageOrientation: "from-image",
                          background: "#f3f4f6",
                        }}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePhoto(photo.id);
                        }}
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          background: "rgba(255,255,255,0.85)",
                          border: "none",
                          borderRadius: "50%",
                          width: 24,
                          height: 24,
                          cursor: "pointer",
                          fontSize: 14,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        aria-label="Delete photo"
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  ))
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 120,
                      height: 120,
                      flex: "0 0 auto",
                      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                      borderRadius: 14,
                      color: "white",
                      textAlign: "center",
                      padding: 12,
                      boxSizing: "border-box",
                      border: "2px dashed rgba(255,255,255,0.3)",
                    }}
                  >
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📸</div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        lineHeight: 1.2,
                        whiteSpace: "normal",
                        wordBreak: "break-word",
                        width: "100%",
                        maxWidth: "96px",
                      }}
                    >
                      Upload your first<br />photo!
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="profile-content-side">
            {/* Achievements */}
            <div className="profile-card profile-achievements">
              <div className="profile-card-title">🏆 Achievements</div>
              <div className="profile-achievements-list">
                <button
                  className="btn btn-primary"
                  onClick={() => setShowAchievements(true)}
                  style={{ width: "100%", marginBottom: 16 }}
                >
                  View All Achievements
                </button>

                {/* If we have completed achievements, show the 2 most recent.
                    Otherwise show your default preview tiles. */}
                {recentAchievementCards.length > 0 ? (
                  <div className="achievements-preview">
                    {recentAchievementCards.map((a, i) => (
                      <div
                        key={`${a.title}-${i}`}
                        className="achievement-item achievement-unlocked"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "12px",
                          margin: "6px 0",
                          borderRadius: "12px",
                          background: "#fff",
                          border: "1px solid #6c63ff",
                          minHeight: "50px",
                        }}
                      >
                        <div
                          className="achievement-icon"
                          style={{
                            fontSize: "20px",
                            marginRight: "10px",
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            background:
                              "linear-gradient(135deg, #a084ee 60%, #6c63ff 100%)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            flexShrink: 0,
                          }}
                        >
                          {a.icon || "🏆"}
                        </div>
                        <div className="achievement-details" style={{ flex: 1 }}>
                          <h4
                            className="achievement-title"
                            style={{
                              margin: "0 0 2px 0",
                              fontSize: "14px",
                              fontWeight: 600,
                            }}
                          >
                            {a.title}
                          </h4>
                          <p
                            className="achievement-description"
                            style={{
                              margin: 0,
                              fontSize: "12px",
                              color: "#666",
                              lineHeight: 1.3,
                            }}
                          >
                            {a.description}
                          </p>
                        </div>
                        <div
                          className="achievement-when"
                          style={{ fontSize: 12, color: "#64748b" }}
                        >
                          {new Date(a.when).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="achievements-preview">
                    {/* Default tiles (unchanged) */}
                    <div
                      className={`achievement-item ${
                        unlockedAchievements.has(1)
                          ? "achievement-unlocked"
                          : "achievement-locked"
                      }`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "8px 12px",
                        margin: "6px 0",
                        borderRadius: "8px",
                        background: unlockedAchievements.has(1)
                          ? "#f0f9ff"
                          : "#f9fafb",
                        border: `1px solid ${
                          unlockedAchievements.has(1) ? "#0ea5e9" : "#e5e7eb"
                        }`,
                        minHeight: "50px",
                      }}
                    >
                      <div
                        className="achievement-icon"
                        style={{ fontSize: "20px", marginRight: "10px" }}
                      >
                        🎯
                      </div>
                      <div className="achievement-details" style={{ flex: 1 }}>
                        <h4
                          className="achievement-title"
                          style={{
                            margin: "0 0 2px 0",
                            fontSize: "14px",
                            fontWeight: 600,
                          }}
                        >
                          First Step
                        </h4>
                        <p
                          className="achievement-description"
                          style={{
                            margin: 0,
                            fontSize: "12px",
                            color: "#666",
                            lineHeight: "1.3",
                          }}
                        >
                          Create your very first itinerary
                        </p>
                      </div>
                    </div>

                    <div
                      className={`achievement-item ${
                        unlockedAchievements.has(5)
                          ? "achievement-unlocked"
                          : "achievement-locked"
                      }`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "8px 12px",
                        margin: "6px 0",
                        borderRadius: "8px",
                        background: unlockedAchievements.has(5)
                          ? "#f0f9ff"
                          : "#f9fafb",
                        border: `1px solid ${
                          unlockedAchievements.has(5) ? "#0ea5e9" : "#e5e7eb"
                        }`,
                        minHeight: "50px",
                      }}
                    >
                      <div
                        className="achievement-icon"
                        style={{ fontSize: "20px", marginRight: "10px" }}
                      >
                        👤
                      </div>
                      <div className="achievement-details" style={{ flex: 1 }}>
                        <h4
                          className="achievement-title"
                          style={{
                            margin: "0 0 2px 0",
                            fontSize: "14px",
                            fontWeight: 600,
                          }}
                        >
                          Profile Pioneer
                        </h4>
                        <p
                          className="achievement-description"
                          style={{
                            margin: 0,
                            fontSize: "12px",
                            color: "#666",
                            lineHeight: "1.3",
                          }}
                        >
                          Complete your profile with photo and bio
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="profile-card profile-actions">
              <div className="profile-card-title">⚡ Quick Actions</div>
              <button className="profile-action-btn plan">📌 Plan New Trip</button>
              <button
                className="profile-action-btn share"
                onClick={handleShareProfile}
              >
                🗂️ Share Profile
              </button>
              <button className="profile-action-btn export">💾 Export My Data</button>
              <button
                className="profile-action-btn settings"
                onClick={() => setShowInfoDelete(true)}
              >
                ⚙️ Account Settings
              </button>
              <button
                className="profile-action-btn logout"
                style={{ background: "#3b5fff", marginTop: "8px" }}
                onClick={handleLogout}
              >
                🚪 Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Profile Modal */}
      {showEditProfile && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(44, 44, 84, 0.25)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <EditProfile
            onClose={() => setShowEditProfile(false)}
            onProfileUpdate={() => unlockAchievement(5, "Profile Pioneer")}
            initialData={{
              name: profile?.name || "",
              bio: profile?.bio || "",
              profilePicture: profile?.profilePicture || "/user.png",
              likes: profile?.likes || [],
              dislikes: profile?.dislikes || []
            }}
          />
        </div>
      )}

      {/* Achievements Modal */}
      {showAchievements && (
        <div className="achv-backdrop" onClick={() => setShowAchievements(false)}>
          <div className="achv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="achv-header">
              <div className="achv-title">
                <span className="achv-title-icon">🏆</span>
                Achievements
              </div>
              <button className="achv-close" onClick={() => setShowAchievements(false)} aria-label="Close">×</button>
            </div>

            <div className="achv-body">
              <div className="achv-section">
                <div className="achv-section-title">Getting Started</div>
                <div className="achv-divider" />
                <div className="achv-grid">
                  {achievementsData.map((a) => (
                    <div
                      key={a.id}
                      className={`achv-item ${a.unlocked ? "is-unlocked" : "is-locked"}`}
                    >
                      <div className="achv-item-icon">{a.icon || "🏆"}</div>
                      <div>
                        <div className="achv-item-title">{a.title}</div>
                        <div className="achv-item-desc">{a.description}</div>
                      </div>
                      <div className={`achv-badge ${a.unlocked ? "ok" : ""}`}>
                        {a.unlocked ? "Unlocked" : "Locked"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Info / Delete Modal */}
      {showInfoDelete && <InfoDelete onClose={() => setShowInfoDelete(false)} />}

      {/* Selected Photo Viewer */}
      {selectedPhoto && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0, 0, 0, 0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={closePhotoView}
        >
          <div
            style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={transformCloudinary(selectedPhoto.url, { w: 1600, h: 1600 })}
              alt="Expanded"
              style={{
                maxWidth: "90vw",
                maxHeight: "90vh",
                objectFit: "contain",
                imageOrientation: "from-image",
              }}
            />
            <button
              onClick={closePhotoView}
              style={{
                position: "absolute",
                top: "10px",
                right: "10px",
                background: "rgba(255, 255, 255, 0.8)",
                border: "none",
                borderRadius: "50%",
                width: "32px",
                height: "32px",
                cursor: "pointer",
                fontSize: "20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* All Photos Modal */}
      {showAllPhotos && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0, 0, 0, 0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10001,
          }}
          onClick={() => setShowAllPhotos(false)}
        >
          <div
            style={{
              position: "relative",
              width: "90%",
              height: "90%",
              background: "white",
              borderRadius: "16px",
              padding: "24px",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "24px",
              }}
            >
              <h2 style={{ margin: 0 }}>{LABELS.ALL_PHOTOS}</h2>
              <button
                onClick={() => setShowAllPhotos(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "24px",
                  cursor: "pointer",
                  padding: 0,
                  width: "32px",
                  height: "32px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: "16px",
              }}
            >
              {photos
                .slice()
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .map((photo) => (
                  <div
                    key={photo.id}
                    style={{
                      position: "relative",
                      width: "100%",
                      paddingTop: "100%",
                      borderRadius: "14px",
                      overflow: "hidden",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      setSelectedPhoto(photo);
                      setShowAllPhotos(false);
                    }}
                  >
                    <img
                      src={transformCloudinary(photo.url, { w: 600, h: 600 })}
                      alt="Gallery"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        imageOrientation: "from-image",
                      }}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePhoto(photo.id);
                      }}
                      style={{
                        position: "absolute",
                        top: "4px",
                        right: "4px",
                        background: "rgba(255, 255, 255, 0.8)",
                        border: "none",
                        borderRadius: "50%",
                        width: 24,
                        height: 24,
                        cursor: "pointer",
                        fontSize: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Share Code Popup */}
      {showShareCode && (
        <div
          className="sharecode-backdrop"
          onClick={() => setShowShareCode(false)}
        >
          <div
            className="sharecode-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sharecode-header">
              <div className="sharecode-title">Share Profile Code</div>
              <button
                className="sharecode-close"
                onClick={() => setShowShareCode(false)}
              >
                ×
              </button>
            </div>

            <div className="sharecode-body">
              <div className="sharecode-box">{shareCode || "--------"}</div>
              <div className="sharecode-actions">
                <button
                  className="sharecode-btn primary"
                  onClick={copyShareCode}
                >
                  Copy Code
                </button>
                <button
                  className="sharecode-btn ghost"
                  onClick={handleShareProfile}
                >
                  Regenerate
                </button>
              </div>
              <div className="sharecode-hint">
                Friends can add you by entering this code in Community → Friends.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}; // Profile component ends here

// Add this export function AFTER the Profile component
export async function unlockAchievement(achievementId, achievementName) {
  const user = auth.currentUser;
  if (!user) return;

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  const already =
    snap.exists() &&
    snap.data().achievements &&
    snap.data().achievements[achievementId] === true;

  if (!already) {
    await updateDoc(userRef, {
      [`achievements.${achievementId}`]: true,
    });
    emitAchievement(`${achievementName} Achievement Unlocked! 🎉`);
  }
}

// ADD THIS EXPORT - find the logActivity function and add export keyword
export async function logActivity(text, icon = "🔵") {
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

export default Profile;
