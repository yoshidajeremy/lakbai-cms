import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import { isAdminAuthenticated } from "./App"; // or wherever it's defined

export default function ProtectedRoute({ children }) {
  const isAdmin = isAdminAuthenticated(); // or your logic
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const location = useLocation();

  // track real auth state (handles async init)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // remove hash fragment from URL so `/#/dashboard` can't be used to bypass routes
  useEffect(() => {
    if (window.location.hash) {
      const clean = window.location.pathname + window.location.search;
      // replaceState avoids a navigation and cleans the URL shown to user
      window.history.replaceState(null, "", clean);
    }
    // run only once when route changes
  }, [location.pathname, location.search]);

  if (loading) {
    // render nothing (or a small loader) while auth initializes to avoid flashes
    return null;
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  return isAdmin ? children : <Navigate to="/admin/login" replace />;
}