import React, { useEffect } from 'react';

// ADDED: shared font scale (fixes FONT not defined)
const FONT = {
  header: 20,
  section: 14,
  body: 14,
  label: 13,
  mono: 13,
  badge: 12
};

// FIX: add missing styles referenced later
const labelStyle = { fontWeight: 600, color: '#111827', fontSize: FONT.label };
const monoStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: FONT.mono };

/*
ViewAuditLogModal
Props:
    open (bool)
    log (object)
    onClose () => void
This matches the provided screenshot layout/visual hierarchy.
*/
export default function ViewAuditLogModal({ open, log, onClose }) {
// Close on ESC
useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
}, [onClose]);

if (!open || !log) return null;

// Helpers
const fmtTs = (v) => {
    if (!v) return '—';
    try {
    const d = new Date(v);
    return d.toLocaleDateString(undefined, {
        month: 'numeric',
        day: 'numeric',
        year: 'numeric'
    }) + ', ' + d.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
    });
    } catch {
    return String(v);
    }
};

const outcome = (log.outcome || '').toLowerCase();
const statusCode = log.statusCode || (outcome === 'success' ? 200 : outcome === 'failure' ? 403 : '');
const outcomeLabel = outcome
    ? `${outcome}${statusCode ? ` (${statusCode})` : ''}`
    : '—';

const outcomeStyle = outcome === 'failure'
    ? { bg: '#fee2e2', fg: '#b91c1c' }
    : { bg: '#dcfce7', fg: '#166534' };

const cardStyle = {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '20px 22px',              // slightly more padding
    fontSize: FONT.body,               // CHANGED
    lineHeight: 1.5,                   // CHANGED
    display: 'flex',
    flexDirection: 'column',
    gap: 8                               // CHANGED
};

const sectionTitleStyle = {
    fontSize: FONT.section,            // CHANGED
    fontWeight: 600,
    color: '#374151',
    marginBottom: 8                     // CHANGED
};

// Derived fields (graceful fallbacks)
const eventId = log.eventId || log.sequence || log.id || '—';
const action = log.action || '—';
const category = (log.category || '').toLowerCase() || '—';
const target = log.target || log.targetType || '—'; // <-- Add this line for 'Target'
const targetId = log.targetId ? `(${log.targetId})` : '';
const requestMethod = log.method || log.requestMethod || log.reqMethod;
const requestPath = log.path || log.endpoint || log.requestPath || log.apiPath;
const request = requestMethod || requestPath
    ? `${requestMethod || 'GET'} ${requestPath || ''}`.trim()
    : (log.request || '—');
const device = log.device || 'Desktop';
const browser = log.browser || (log.userAgent && inferBrowser(log.userAgent)) || '—';
const os = log.os || (log.userAgent && inferOS(log.userAgent)) || '—';
const userName = log.userName || log.user || '—';
const userEmail = log.userEmail || log.username || '—';
const role = log.role || '—';
const userId = log.userId || log.uid || '—';
const session = log.sessionId || log.session || '—';
const details = log.details || log.message || '—';
const securityFlagsDisplay =
    Array.isArray(log.securityFlags)
    ? log.securityFlags.join(', ')
    : (typeof log.securityFlags === 'string'
        ? log.securityFlags
        : 'None');

const userAgent = log.userAgent || '—';

return (
    <div
    role="dialog"
    aria-modal="true"
    onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
    style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '60px 24px 40px',
        zIndex: 4000,
        overflowY: 'auto'
    }}
    >
    <div
        style={{
        background: '#fff',
            width: 'min(1180px, 100%)',            // slightly wider modal
        borderRadius: 16,
        boxShadow: '0 20px 60px -10px rgba(0,0,0,0.35)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
        }}
    >
        {/* Header */}
        <div
        style={{
            padding: '18px 24px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center'
        }}
        >
        <div style={{ fontSize: FONT.header, fontWeight: 600, flex: 1, color: '#111827' }}>Audit Log Details</div>
        <button
            aria-label="Close"
            onClick={onClose}
            style={{
            background: 'transparent',
            border: 'none',
            fontSize: 20,
            cursor: 'pointer',
            color: '#374151',
            lineHeight: 1
            }}
        >
            ×
        </button>
        </div>

        {/* Body */}
        <div style={{ padding: 30, display: 'flex', flexDirection: 'column', gap: 30 }}>
        {/* Row 1: Event + User Information */}
            <div
            style={{
                display: 'grid',
                gap: 24,
                gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))'
            }}
            >
            <div style={cardStyle}>
                <div style={sectionTitleStyle}>Event Information</div>
                <InfoLine label="Event ID:" value={`#${eventId}`} />
                <InfoLine label="Timestamp:" value={fmtTs(log.timestamp || log.time)} />
                <InfoLine label="Action:" value={action} />
                <InfoLine label="Category:" value={category} />
                <InfoLine label="Target:" value={`${target}${targetId ? ' ' + targetId : ''}`} /> {/* <-- Show Target */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ ...labelStyle }}>Outcome:</span>
                <span
                    style={{
                    background: outcomeStyle.bg,
                    color: outcomeStyle.fg,
                    borderRadius: 6,
                    fontSize: FONT.badge,
                    padding: '4px 10px',
                    fontWeight: 600,
                    lineHeight: 1
                    }}
                >
                    {outcomeLabel}
                </span>
                </div>
            </div>

            <div style={cardStyle}>
                <div style={sectionTitleStyle}>User Information</div>
                    <InfoLine label="User:" value={log.user?.name || userName} />
                    <InfoLine label="Username:" value={log.user?.username || userEmail} />
                    <InfoLine label="Role:" value={log.user?.role || role} />
                    <InfoLine label="User ID:" value={log.user?.userId || userId} />
                    <InfoLine label="Session:" value={log.user?.session || session} />
            </div>
            </div>

        {/* Row 2: Source & Security */}
        <div
            style={{
            display: 'grid',
            gap: 24,
            gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))'
            }}
        >
            <div style={cardStyle}>
            <div style={sectionTitleStyle}>Source Information</div>

            <InfoLine label="Device:" value={device} />
            <InfoLine label="Browser:" value={browser} />
            <InfoLine label="OS:" value={os} />
            </div>

            <div style={cardStyle}>
            <div style={sectionTitleStyle}>Security &amp; Flags</div>
            <InfoLine label="Security Flags:" value={securityFlagsDisplay} />
            </div>
        </div>

        {/* Row 3: Event Details */}

        {/* Row 4: User Agent */}
        <div style={cardStyle}>
            <div style={sectionTitleStyle}>User Agent</div>
            <div style={{ ...monoStyle, color: '#374151', wordBreak: 'break-all' }}>{userAgent}</div>
        </div>

        {/* Row 5: Data Changes (if applicable) */}
        {log.category === "user management" && log.dataChanges && (
            <div style={{ display: 'flex', gap: 18, marginTop: 12 }}>
                <div style={{ flex: 1, background: '#fafbfc', borderRadius: 12, padding: 18, marginBottom: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Data Changes</div>
                <div style={{ display: 'flex', gap: 18 }}>
                    <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>Old Values</div>
                    <pre style={{ background: '#f3f4f6', borderRadius: 8, padding: 10, fontSize: 13, color: '#b91c1c', overflowX: 'auto' }}>
                        {JSON.stringify(log.dataChanges.old, null, 2)}
                    </pre>
                    </div>
                    <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>New Values</div>
                    <pre style={{ background: '#f3f4f6', borderRadius: 8, padding: 10, fontSize: 13, color: '#166534', overflowX: 'auto' }}>
                        {JSON.stringify(log.dataChanges.new, null, 2)}
                    </pre>
                    </div>
                </div>
                </div>
            </div>
        )}
        </div>
    </div>
    </div>
);
}

// REPLACED InfoLine to remove reliance on undefined labelStyle / FONT scoping
function InfoLine({ label, value }) {
    return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: '#111827', fontSize: FONT.label }}>{label}</span>
        <span style={{ color: '#374151', fontSize: FONT.body }}>{value || '—'}</span>
        </div>
    );
}

// Basic UA parsing (lightweight)
function inferBrowser(ua = '') {
ua = ua.toLowerCase();
if (ua.includes('chrome') && !ua.includes('edg')) {
    const m = ua.match(/chrome\/([\d.]+)/);
    return `Chrome ${m ? m[1].split('.')[0] : ''}`.trim();
}
if (ua.includes('safari') && ua.includes('version'))
    return 'Safari';
if (ua.includes('firefox')) {
    const m = ua.match(/firefox\/([\d.]+)/);
    return `Firefox ${m ? m[1].split('.')[0] : ''}`;
}
if (ua.includes('edg')) {
    const m = ua.match(/edg\/([\d.]+)/);
    return `Edge ${m ? m[1].split('.')[0] : ''}`;
}
return '—';
}

function inferOS(ua = '') {
ua = ua.toLowerCase();
if (ua.includes('windows nt 10')) return 'Windows 10';
if (ua.includes('windows nt 11')) return 'Windows 11';
if (ua.includes('mac os x')) return 'macOS';
if (ua.includes('android')) return 'Android';
if (ua.includes('iphone') || ua.includes('ios')) return 'iOS';
if (ua.includes('linux')) return 'Linux';
    return '—';
}