import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";

function isAdminAuthenticated() {
  const adminToken = localStorage.getItem("adminToken");
  return typeof adminToken === "string" && adminToken.trim().length > 0;
}

export default function ProtectedRoute({ children }) {
  const isAdmin = isAdminAuthenticated();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const location = useLocation();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (window.location.hash) {
      const clean = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", clean);
    }
  }, [location.pathname, location.search]);

  if (loading) {
    return null; // or a loader
  }

  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  return isAdmin ? children : <Navigate to="/admin/login" replace />;
}