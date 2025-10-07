import React, { useState } from 'react';
import { Routes, Route, BrowserRouter, useLocation, useInRouterContext, Navigate, Outlet } from 'react-router-dom';
import StickyHeader from './header';
import Login from './login';
import Register from './register';
import Dashboard from './dashboard';
import Bookmark from './bookmark';
import Bookmarks2 from './bookmarks2';
import Community from './community';
import Profile from './profile';
import { ChatbaseAIModal } from './Ai';
import './App.css';
import { UserProvider } from "./UserContext";
import AchievementToast from "./AchievementToast";
import Itinerary from "./Itinerary";
import Footer from './Footer';
import LoginCMS from './login-cms';
import ContentManagement from './ContentManagement';
import ProtectedRoute from "./ProtectedRoute";
import { ToastContainer } from 'react-toastify';

// Authentication helpers (unchanged)
function isAuthenticated() {
  const token = localStorage.getItem('token');
  return typeof token === 'string' && token.trim().length > 0;
}
function isAdminAuthenticated() {
  const adminToken = localStorage.getItem('adminToken');
  return typeof adminToken === 'string' && adminToken.trim().length > 0;
}

function AppInner() {
  const [showAIModal, setShowAIModal] = useState(false);
  const location = useLocation();

  // MainLayout used only for pages that should have header + footer.
  // Footer is keyed by location so it remounts on navigation.
  function MainLayout() {
    const loc = useLocation();
    return (
      <>
        <StickyHeader setShowAIModal={setShowAIModal} />
        <main id="main-content">
          <Outlet />
        </main>
        <Footer key={loc.pathname + (loc.search || '')} />
      </>
    );
  }

  return (
    <UserProvider>
      <Routes>
        {/* Public / auth routes (no header/footer) */}
        <Route
          path="/"
          element={
            <Navigate to="/admin/login" replace />
          }
        />

        {/* Admin routes (no main header/footer) */}
        <Route path="/admin/login" element={<LoginCMS />} />
        <Route
          path="/admin/ContentManagement"
          element={
            <ProtectedRoute>
              <ContentManagement />
            </ProtectedRoute>
          }
        />
        <Route path="/admin/*" element={<Navigate to="/admin/login" replace />} />

        {/* Protected routes that should include header + footer */}
        <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<Dashboard setShowAIModal={setShowAIModal} />} />
          <Route path="/bookmark" element={<Bookmark />} />
          <Route path="/bookmarks2" element={<Bookmarks2 />} />
          <Route path="/community" element={<Community />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/itinerary" element={<Itinerary />} />
        </Route>

  {/* Fallback */}
  <Route path="*" element={<Navigate to="/admin/login" replace />} />
      </Routes>

      {showAIModal && <ChatbaseAIModal onClose={() => setShowAIModal(false)} />}
      <AchievementToast />
      <ToastContainer />
    </UserProvider>
  );
}

// Export wrapped by BrowserRouter if not already in a Router context
export default function App() {
  const inRouter = useInRouterContext();
  if (inRouter) return <AppInner />;

  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}


