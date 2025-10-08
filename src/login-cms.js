import React, { useState } from "react";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, setDoc, getDoc, doc, collection, addDoc, serverTimestamp, query, where, getDocs } from "firebase/firestore";
import ContentManagement from "./ContentManagement";
import "./Styles/login-cms.css";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { useNavigate } from "react-router-dom";

export default function LoginCMS() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [emailError, setEmailError] = useState("");

    const auth = getAuth();
    const db = getFirestore();
    const navigate = useNavigate();

    // Only check admin after login
    const handleSignIn = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        setEmailError("");
        try {
            const userCred = await signInWithEmailAndPassword(auth, email, password);
            const user = userCred.user;
            const adminDoc = await getDoc(doc(db, "Admin", user.uid));
            if (!adminDoc.exists() || adminDoc.data().role !== "admin") {
                setError("Access denied: You are not an admin.");
                setLoading(false);
                return;
            }

            // --- Preserve existing user profile fields ---
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);
            let existingData = {};
            if (userSnap.exists()) {
                existingData = userSnap.data();
            }
            await setDoc(userRef, {
                ...existingData,
                email: user.email,
                displayName: user.displayName || existingData.displayName || "",
                role: "admin",
                lastLogin: new Date().toISOString()
            }, { merge: true });
            // --------------------------------------------

            // Log this admin login event
            await addDoc(collection(db, "auditLogs"), {
                uid: user.uid,
                email: user.email,
                action: "admin_login",
                timestamp: serverTimestamp()
            });
            
            localStorage.setItem('adminToken', user.uid); // <-- ADD THIS LINE
            setIsAdmin(true);
            navigate("/admin/ContentManagement", { replace: true }); // Redirect after successful login
        } catch (err) {
            setError(
                err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credentials"
                    ? "Error Logging In: Invalid Credential."
                    : err.message
            );
            setLoading(false);
        }
    };

    if (isAdmin) {
        return <ContentManagement />;
    }

    return (
        <div className="login-cms-container">
            <div className="login-cms-bg">
                <div className="login-cms-title">LakbAI</div>
                <div className="login-cms-subtitle">Content Management System</div>
                <div className="login-cms-card">
                    <h2>Admin Login</h2>
                    <form className="login-cms-form" autoComplete="off" onSubmit={handleSignIn}>
                        <label className="login-cms-label" htmlFor="email">Email Address</label>
                        <input
                            className="login-cms-input"
                            id="email"
                            type="email"
                            placeholder="admin@gmail.com"
                            autoComplete="username"
                            value={email}
                            onChange={e => {
                                setEmail(e.target.value);
                                setEmailError("");
                            }}
                            onBlur={e => {
                                if (e.target.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.target.value)) {
                                    setEmailError("Please enter a valid email address.");
                                }
                            }}
                            required
                        />
                        {emailError && (
                            <div style={{
                                color: "#d32f2f",
                                marginTop: 4,
                                marginBottom: 2,
                                fontSize: "0.98rem",
                                textAlign: "left",
                                width: "100%"
                            }}>
                                {emailError}
                            </div>
                        )}
                        <label className="login-cms-label" htmlFor="password">Password</label>
                        <div className="login-cms-password-wrapper">
                            <input
                                className="login-cms-input"
                                id="password"
                                type={showPassword ? "text" : "password"}
                                placeholder="Enter your password"
                                autoComplete="current-password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                            />
                            <button
                                type="button"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                onClick={() => setShowPassword((v) => !v)}
                                className="login-cms-password-eye-btn"
                                tabIndex={-1}
                            >
                                {showPassword ? <FaEyeSlash /> : <FaEye />}
                            </button>
                        </div>
                        <button className="login-cms-btn" type="submit" disabled={loading}>
                            <span role="img" aria-label="lock">🔒</span> {loading ? "Signing In..." : "Sign In"}
                        </button>
                        {error && (
                            <div style={{ color: "#d32f2f", marginTop: 8, textAlign: "center", fontSize: "1rem" }}>
                                {error}
                            </div>
                        )}
                    </form>
                </div>
                <div className="login-cms-footer">
                    © 2025 LakbAI. All rights reserved.<br />
                    <span style={{ color: "#bdb6e2" }}>Secure Admin Portal v2.1</span>
                </div>
            </div>
        </div>
    );
}