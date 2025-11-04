import React, { useMemo, useRef, useState } from 'react';
import './Styles/contentManager.css';
import { db, auth } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

// Cloudinary (unsigned) for optional photo upload
const CLOUDINARY_UPLOAD_PRESET = process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET || 'lakbai_preset';
const CLOUDINARY_CLOUD_NAME = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME || 'dxvewejox';

async function uploadToCloudinary(file) {
    const url = `https://api.cloudinary.com/v1_1/dxvewejox/image/upload`;
    const body = new FormData();
    body.append('file', file);
    body.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    const res = await fetch(url, { method: 'POST', body });
    if (!res.ok) throw new Error('Upload failed');
    const json = await res.json();
    return json.secure_url || json.url;
}

// Lightweight spinner
function ensureSpinKeyframes() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('cms-spin-kf')) return;
    const s = document.createElement('style');
    s.id = 'cms-spin-kf';
    s.textContent = '@keyframes cmsSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
}
const Spinner = ({ size = 24, color = '#2563eb', style = {} }) => {
    ensureSpinKeyframes();
    return (
    <span
        role="status"
        aria-live="polite"
        aria-busy="true"
        style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        border: `3px solid ${color}22`,
        borderTopColor: color,
        animation: 'cmsSpin 1s linear infinite',
        ...style
        }}
    />
    );
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// NEW: password rules
const PASSWORD_MIN = 8;
const PASSWORD_PATTERN = `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{${PASSWORD_MIN},}$`;

export default function AddUserCMS({ open = false, onClose, onSave }) {
const [tab, setTab] = useState('basic');

  // Blank form for creating a new user
const [form, setForm] = useState({
    email: '',
    password: '',
    provider: 'Email',
    travelerName: '',
    photoURL: '',
    travelerBio: '',
    status: 'active',
    stats: { places: 0, photos: 0, reviews: 0, friends: 0 },
});
React.useEffect(() => {
    if (!open) return;
    const uid = auth?.currentUser?.uid;
    if (!uid) return;
    if ((form.travelerBio || '').trim()) return; // do not overwrite if already set

    let alive = true;
    (async () => {
    try {
        const snap = await getDoc(doc(db, 'users', uid));
        const bio = snap.exists() ? (snap.data().travelerBio || '') : '';
        if (alive && bio) {
        setForm(f => ({ ...f, travelerBio: bio }));
        }
    } catch (e) {
        console.warn('load travelerBio failed', e);
    }
    })();
    return () => { alive = false; };
}, [open]);

const [showPwd, setShowPwd] = useState(false);
const [submitting, setSubmitting] = useState(false);
const [uploading, setUploading] = useState(false);
const fileRef = useRef(null);

const avatarInitial = useMemo(() => {
    return (form.travelerName || form.email || 'U').trim().charAt(0).toUpperCase();
}, [form.travelerName, form.email]);

const pwChecks = useMemo(() => {
    const pw = form.password || '';
    return {
        length: pw.length >= PASSWORD_MIN,
        lower: /[a-z]/.test(pw),
        upper: /[A-Z]/.test(pw),
        number: /\d/.test(pw),
        special: /[^A-Za-z0-9]/.test(pw),
    };
}, [form.password]);
const passwordStrong = pwChecks.length && pwChecks.lower && pwChecks.upper && pwChecks.number && pwChecks.special;
const isEmailProvider = (form.provider || '').toLowerCase().includes('email');
const showPwRules = isEmailProvider || (form.password && form.password.length > 0);

if (!open) return null;

const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.email.trim()) { alert('Email is required'); return; }
    if (!EMAIL_REGEX.test(form.email.trim())) {
        alert('Please enter a valid email address, e.g., name@gmail.com');
        return;
    }
    // NEW: enforce strong password
    if ((isEmailProvider || (form.password || '').length > 0) && !passwordStrong) {
        alert(`Please enter a stronger password:
        - At least ${PASSWORD_MIN} characters
        - Includes uppercase, lowercase, a number, and a symbol`);
        return;
    }
    setSubmitting(true);
    try {
      // Keep previous integration: these are the fields ContentManagement saves.
        await onSave?.({
            travelerName: form.travelerName,
            email: form.email,
            provider: form.provider,
            status: form.status,
            travelerBio: form.travelerBio,
            // Extra fields included but safe to ignore by current handler:
            photoURL: form.photoURL,
            stats: { ...form.stats },
            password: form.password || undefined
        });
    } finally {
        setSubmitting(false);
    }
};

const card = (title, children, style = {}) => (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.04)', padding: 18, ...style }}>
        <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 16 }}>{title}</div>
        {children}
    </div>
);

return (
    <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
    <div
        style={{
            width: 'min(980px,96vw)',
            background: '#fff',
            borderRadius: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,.25)',
            maxHeight: '92vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
        }}
    >
        {/* Tabs header */}
        <div style={{ display: 'flex', gap: 14, padding: '10px 16px', borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
            {['basic','profile','settings'].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: '10px 8px',
                color: tab === t ? '#2563eb' : '#6b7280', fontWeight: 600,
                borderBottom: tab === t ? '3px solid #2563eb' : '3px solid transparent'
            }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
            ))}
            <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        {/* Body */}
        <form onSubmit={submit}
            style={{
                padding: 18,
                background: '#f8fafc',
                flex: 1,
                overflowY: 'auto'
            }}
        >
            {tab === 'basic' && (
        <>
              {/* Personal Information */}
                {card('Personal Information', (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Email Address</div>
                    <input
                        className="form-input-dest"
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="name@example.com"                      // NEW
                      pattern={EMAIL_REGEX.source}                         // NEW: HTML validation
                      title="Enter a valid email address, e.g., name@gmail.com" // NEW
                    />
                    {form.email && !EMAIL_REGEX.test(form.email) && (      // NEW: inline hint
                        <div className="muted" style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>
                        Enter a valid email address (e.g., name@gmail.com)
                        </div>
                    )}
                </div>
                <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Password</div>
                    <div style={{ position: 'relative' }}>
                        <input
                            className="form-input-dest"
                            type={showPwd ? 'text' : 'password'}
                            value={form.password}
                            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                            placeholder="Set a password"
                            style={{ paddingRight: 38 }}
                            minLength={PASSWORD_MIN}                 // NEW
                            pattern={PASSWORD_PATTERN}               // NEW (browser validation helper)
                            title={`At least ${PASSWORD_MIN} characters with uppercase, lowercase, number, and symbol`} // NEW
                        />
                        <button
                            type="button"
                            onClick={() => setShowPwd((v) => !v)}
                            aria-label={showPwd ? 'Hide password' : 'Show password'}
                            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                            background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: '#6b7280' }}
                        >
                            {showPwd ? '🙈' : '👁️'}
                        </button>
                    </div>
                    {showPwRules && (
                    <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5 }}>
                        {[
                            ['8+ characters', pwChecks.length],
                            ['Uppercase letter', pwChecks.upper],
                            ['Lowercase letter', pwChecks.lower],
                            ['Number', pwChecks.number],
                            ['Symbol (!@#$…)', pwChecks.special],
                        ].map(([label, ok]) => (
                            <span key={label} style={{ display: 'inline-block', marginRight: 10, color: ok ? '#16a34a' : '#ef4444' }}>
                            {ok ? '✔' : '•'} {label}
                            </span>
                        ))}
                    </div>
                    )}
                </div>

                <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Sign-in Provider</div>
                    <select
                        className="form-input-dest"
                        value={form.provider}
                        onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                    >
                        <option>Email</option>
                        <option>google.com</option>
                        <option>facebook.com</option>
                        <option>apple.com</option>
                    </select>
                </div>

                <div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Traveler Name</div>
                    <input
                        className="form-input-dest"
                        value={form.travelerName}
                        onChange={(e) => setForm((f) => ({ ...f, travelerName: e.target.value }))}
                    />
                </div>
                </div>
            ))}
            </>
        )}

        {tab === 'profile' && (
            <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.04)', padding: 18 }}>
              {/* Title divider */}
                <div style={{ borderBottom: '1px solid #e5e7eb', margin: '0 0 18px 0' }} />

              {/* Profile Picture */}
                <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>Profile Picture</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                <div style={{
                    width: 64, height: 64, borderRadius: '50%',
                    background: '#6366f1',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 24, fontWeight: 600, overflow: 'hidden',
                    boxShadow: '0 2px 10px rgba(0,0,0,.08)'
                }}>
                    {form.photoURL ? (
                    <img src={form.photoURL} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                    avatarInitial
                    )}
                </div>

                <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                        setUploading(true);
                        const url = await uploadToCloudinary(file);
                        setForm((f) => ({ ...f, photoURL: url }));
                    } catch (err) {
                        console.error(err);
                        alert('Upload failed. Please try again.');
                    } finally {
                        setUploading(false);
                        if (fileRef.current) fileRef.current.value = '';
                    }
                    }}
                />

                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    style={{
                        background: 'linear-gradient(90deg,#10b981,#059669)',
                        color: '#fff',
                        border: 'none',
                        padding: '10px 18px',
                        borderRadius: 8,
                        fontWeight: 600,
                        boxShadow: '0 4px 12px rgba(16,185,129,.25)',
                        cursor: uploading ? 'not-allowed' : 'pointer'
                    }}
                >
                    {uploading ? (<><Spinner size={16} style={{ marginRight: 8, verticalAlign: '-2px' }} /> Uploading...</>) : 'Upload Photo'}
                </button>
            </div>

              {/* Divider */}
            <div style={{ borderTop: '1px solid #e5e7eb', margin: '0 0 18px 0' }} />

              {/* Traveler Bio (blank) */}
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>Traveler Bio</div>
            <textarea
                className="form-input-dest"
                value={form.travelerBio}
                onChange={(e) => setForm((f) => ({ ...f, travelerBio: e.target.value }))}
                placeholder="Tell something about the traveler..."
                style={{
                    width: '100%',
                    minHeight: 160,
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    resize: 'vertical'
                }}
            />
              {/* Bottom divider */}
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 18 }} />
            </div>
        )}

        {tab === 'settings' && (
            <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,.04)', padding: 18 }}>
              {/* top divider */}
                <div style={{ borderBottom: '1px solid #e5e7eb', margin: '0 0 18px 0' }} />

                <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8 }}>Account Status</div>
            <select
                className="form-input"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                style={{ width: '100%' }}
            >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
            </select>

              {/* bottom divider */}
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: 18 }} />
            </div>
        )}
        </form>

        {/* Footer */}
        <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button type="button" className="btn-secondary" onClick={onClose} style={{ padding: '10px 18px', borderRadius: 8 }}>
            Cancel
        </button>
        <button type="submit" form="none" onClick={submit}
            className="btn-primary" disabled={submitting}
            style={{ padding: '10px 18px', borderRadius: 8, background: 'linear-gradient(90deg,#2563eb,#3b82f6)', color: '#fff', border: 'none', fontWeight: 700 }}>
            {submitting ? 'Creating...' : 'Create User'}
        </button>
        </div>
    </div>
    </div>
);
}