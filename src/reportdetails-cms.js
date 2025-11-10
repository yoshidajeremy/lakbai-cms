import React, { useState, useEffect } from 'react';
import './Styles/contentManager.css';
// NEW: firebase + rules
import { getFirestore, doc, updateDoc, arrayUnion, serverTimestamp, deleteDoc, collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';
import { action_types } from './rules';


// Fallback badges (kept simple and self-contained)
const Badge = ({ bg, color, children }) => (
  <span style={{ background: bg, color, fontWeight: 700, fontSize: 12, padding: '2px 8px', borderRadius: 8 }}>
    {children}
  </span>
);

const PriorityBadge = ({ v }) => {
  const val = String(v || 'low').toLowerCase();
  if (val === 'high') return <Badge bg="#fee2e2" color="#b91c1c">High</Badge>;
  if (val === 'medium') return <Badge bg="#fef3c7" color="#b45309">Medium</Badge>;
  return <Badge bg="#dcfce7" color="#166534">Low</Badge>;
};

const StatusBadge = ({ v }) => {
  const val = String(v || 'pending').toLowerCase();
  if (val === 'resolved') return <Badge bg="#dcfce7" color="#166534">Resolved</Badge>;
  if (val === 'under_review') return <Badge bg="#e0f2fe" color="#0369a1">Under Review</Badge>;
  if (val === 'escalated') return <Badge bg="#fee2e2" color="#b91c1c">Escalated</Badge>;
  if (val === 'pending') return <Badge bg="#fef3c7" color="#b45309">Pending</Badge>;
  return <Badge bg="#e5e7eb" color="#374151">{val}</Badge>;
};

// Normalize the reported content payload into a consistent shape
function normalizeReportedContent(report) {
  const src = report?.content || report || {};
  const images = Array.isArray(src.images)
    ? src.images
    : Array.isArray(src.media?.images)
    ? src.media.images
    : src.image
    ? [src.image]
    : [];

  return {
    title: src.title || src.postTitle || report?.title || '',
    body: src.body || src.text || src.message || report?.body || '',
    location: src.location || report?.location || '',
    images,
    createdAt: src.createdAt || report?.contentCreatedAt || report?.createdAt || null,
  };
}

// Helper: auto-detect a canonical reason from the report payload & its content text
function autoDetectReason(report) {
  if (!report) return '';
  const raw = [
    report.reason,
    report.description,
    report.content?.body,
    report.content?.text,
    report.content?.message,
    report.content?.title
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!raw) return '';

  // Direct mapping keywords -> canonical label
  const MATCHERS = [
    { label: 'Hate Speech', patterns: ['hate speech', 'hate', 'bigotry', 'intolerance'] },
    { label: 'Violence/Threats', patterns: ['threat', 'violence', 'violent', 'aggression'] },
    { label: 'Harassment/Bullying', patterns: ['harassment', 'bullying', 'harass', 'bully'] },
    { label: 'Spam/Promotional Content', patterns: ['spam', 'promotional', 'advertisement', 'marketing', 'promotion'] },
    { label: 'Fake/Misleading Content', patterns: ['fake', 'misleading', 'scam', 'false info', 'disinformation'] },
    { label: 'Copyright Violation', patterns: ['copyright', 'dmca', 'plagiarism', 'copyrighted'] },
    { label: 'Privacy Violation', patterns: ['privacy', 'dox', 'personal info', 'address leak'] },
    { label: 'Inappropriate Content', patterns: ['inappropriate', 'nsfw', 'explicit', 'obscene'] }
  ];

  // If original reason already matches a canonical label, return it
  const canonicalLabels = MATCHERS.map(m => m.label);
  if (canonicalLabels.some(l => raw.includes(l.toLowerCase()))) {
    return canonicalLabels.find(l => raw.includes(l.toLowerCase())) || '';
  }

  for (const m of MATCHERS) {
    if (m.patterns.some(p => raw.includes(p))) return m.label;
  }
  return 'Other';
}

// NEW: read how many violations the viewed user had (from `report` collection)
async function getUserViolationCount({ userId, userName }) {
  try {
    const db = getFirestore();
    const col = collection(db, 'report');

    // Prefer userId if present
    if (userId) {
      const qById = query(col, where('reportedUserId', '==', userId));
      try {
        const countSnap = await getCountFromServer(qById);
        const c = countSnap.data().count || 0;
        if (c > 0) return c;
      } catch {
        const docs = await getDocs(qById);
        if (!docs.empty) return docs.size;
      }
    }

    // Fallback to userName if needed
    if (userName) {
      const qByName = query(col, where('reportedUser', '==', userName));
      try {
        const countSnap = await getCountFromServer(qByName);
        return countSnap.data().count || 0;
      } catch {
        const docs = await getDocs(qByName);
        return docs.size;
      }
    }

    return 0;
  } catch (e) {
    console.warn('getUserViolationCount error:', e?.message || e);
    return 0;
  }
}

// NEW: map reason label to rules.js key (e.g., "Spam/Promotional Content" -> "Spam_Promotional_Content")
function reasonLabelToKey(label) {
  if (!label) return '';
  return String(label).trim().replace(/[\/\s]+/g, '_');
}

// NEW: compute recommended action based on updated policy:
// Only two possible recommendations:
// - Suspend Account (>=3 reports, any violation type)
// - Ban Account (>=15 reports, any violation type)
// Otherwise no recommendation (null) so UI shows fallback.
function getRecommendedAction(violationCount, reasonLabel) {
  const key = reasonLabelToKey(reasonLabel);
  if (violationCount >= 15) {
    return {
      action: 'Ban Account',
      reason: reasonLabel,
      template: (action_types?.Ban_Account && action_types.Ban_Account[0]) ||
        'Account banned due to repeated violations.'
    };
  }
  if (violationCount >= 3) {
    return {
      action: 'Suspend Account',
      reason: reasonLabel,
      template: action_types?.Suspend_Account?.[key]?.[0] ||
        'Your account is suspended due to repeated violations.'
    };
  }
  return null; // < 3 reports: no escalation yet
}

const ReportDetailModal = ({ report, onClose, onTakeAction, userNameCache = {} }) => {
  // Always call hooks; attach listeners only when report exists
  useEffect(() => {
    if (!report) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [report, onClose]);

  // NEW: hooks must be before any early return
  const [violationCount, setViolationCount] = useState(null);
  const [recAction, setRecAction] = useState(null);

  // NEW: compute ruId/ruName safely even if report is null
  const ruId =
    report?.reportedUserId ??
    report?.reportedUserID ??
    report?.reportedID ??
    (typeof report?.reportedUser === 'string'
      ? report?.reportedUser
      : report?.reportedUser?.id) ??
    null;

  const ruName =
    report?.reportedUserName ??                   // preferred
    report?.reportedUsernName ??                  // typo fallback
    report?.reported_user_name ??                 // snake_case fallback
    (typeof report?.reportedUser === 'object' &&
      (report?.reportedUser?.name || report?.reportedUser?.displayName)) ??
    (ruId ? userNameCache[ruId] : null) ??        // cache from parent (if provided)
    '—';

  // NEW: violation count + recommended action effect (guard when no report)
  useEffect(() => {
    let alive = true;
    if (!report) {
      setViolationCount(null);
      setRecAction(null);
      return () => { alive = false; };
    }
    (async () => {
      try {
        const count = await getUserViolationCount({
          userId: ruId,
          userName: ruName && ruName !== '—' ? ruName : undefined
        });
        if (!alive) return;
        setViolationCount(count);

        const reason = autoDetectReason(report);
        const rec = getRecommendedAction(count, reason);
        setRecAction(rec);
      } catch (e) {
        if (!alive) return;
        setViolationCount(0);
        const reason = autoDetectReason(report);
        setRecAction(getRecommendedAction(0, reason));
      }
    })();
    return () => { alive = false; };
  }, [ruId, ruName, report]);

  // Keep early return AFTER hooks
  if (!report) return null;

  const typeStr = String(report.contentType || '').toLowerCase();
  const content = normalizeReportedContent(report);

  const toDateTime = (v) => {
    const d = v instanceof Date ? v : (v?.toDate ? v.toDate() : v ? new Date(v) : null);
    return d ? d.toLocaleString() : '—';
  };

  const avatarInitial = (ruName || 'U').trim().charAt(0).toUpperCase();

  const hasAnyContent =
    !!content.title ||
    !!content.body ||
    !!content.location ||
    (content.images && content.images.length > 0) ||
    !!content.createdAt;

  // NEW: disable Take Action if the report is already resolved
  const isResolved = String(report?.status || '').toLowerCase() === 'resolved';

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ width: 'min(920px,96vw)', background: '#fff', borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Report Details</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer', color: '#111827' }} aria-label="Close">×</button>
        </div>

        {/* Two cards row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, padding: 18 }}>
          {/* Report Information */}
          <div style={{ background: '#fff', border: '1px solid #eef2f7', borderRadius: 12, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,.03)' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Report Information</div>
            <div style={{ fontSize: 13, color: '#111827' }}>
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#6b7280', fontSize: 12 }}>Reported by:</div>
                <div style={{ fontWeight: 600 }}>{report.reporterName || '—'}</div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#6b7280', fontSize: 12 }}>Reason:</div>
                <div style={{ textTransform: 'lowercase' }}>{(report.reason || '—').toLowerCase()}</div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>Priority:</div>
                  <PriorityBadge v={report.priority} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>Status:</div>
                  <StatusBadge v={report.status} />
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#6b7280', fontSize: 12 }}>Reported:</div>
                <div>{toDateTime(report.createdAt)}</div>
              </div>
              {report.description && (
                <div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>Description:</div>
                  <div style={{ color: '#374151' }}>{report.description}</div>
                </div>
              )}
            </div>
          </div>

          {/* Reported User */}
          <div style={{ background: '#fff', border: '1px solid #eef2f7', borderRadius: 12, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,.03)' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Reported User</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#6366f1', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 600 }}>
                {avatarInitial}
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{ruName}</div>
                <div className="muted small">ID: {ruId || '—'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Reported Content (only if provided) */}
        <div style={{ padding: '0 18px 18px 18px' }}>
          <div style={{ background: '#fff', border: '1px solid #eef2f7', borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,.03)', overflow: 'hidden' }}>
            <div style={{ padding: 14, borderBottom: '1px solid #eef2f7', fontWeight: 700 }}>Reported Content</div>
            <div style={{ padding: 16 }}>
              {!hasAnyContent ? (
                <div className="muted" style={{ padding: 8 }}>No content attached to this report.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13, marginBottom: 8 }}>
                    <span role="img" aria-label={typeStr}>
                      {typeStr === 'comment' ? '💬' : typeStr === 'message' ? '✉️' : '📰'}
                    </span>
                    <span style={{ textTransform: 'capitalize' }}>{typeStr || 'content'}</span>
                    {content.createdAt && (<><span>•</span><span>{toDateTime(content.createdAt)}</span></>)}
                  </div>

                  {content.title && (
                    <div style={{ fontWeight: 800, marginBottom: 8, color: '#111827' }}>{content.title}</div>
                  )}
                  {content.body && (
                    <div style={{ color: '#374151', lineHeight: 1.6, marginBottom: 12 }}>{content.body}</div>
                  )}
                  {content.location && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', marginBottom: 10 }}>
                      <span role="img" aria-label="pin">📍</span>
                      <span>{content.location}</span>
                    </div>
                  )}
                  {Array.isArray(content.images) && content.images.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {content.images.slice(0, 6).map((src, i) => (
                        <img key={i} src={src} alt="" style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #eef2f7' }} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        
        {/* Recommended Action */}
        <div style={{ padding: '0 18px 18px 18px' }}>
          <div style={{ background: '#fff', border: '1px solid #eef2f7', borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,.03)', overflow: 'hidden' }}>
            <div style={{ padding: 14, borderBottom: '1px solid #eef2f7', fontWeight: 700 }}>Recommended Action</div>
            <div style={{ padding: 16 }}>
              <div style={{ color: '#374151', lineHeight: 1.6, marginBottom: 12 }}>
                Based on the user's violation history
                {violationCount !== null ? ` (${violationCount} report${violationCount === 1 ? '' : 's'} on record)` : ''},
                we recommend:
              </div>
              {recAction ? (
                <ul style={{ paddingLeft: 16 }}>
                  <li>
                    <strong>{recAction.action}</strong>
                    {recAction.reason ? ` — Reason: ${recAction.reason}` : ''}
                  </li>
                  {recAction.template && (
                    <li style={{ color: '#6b7280' }}>{recAction.template}</li>
                  )}
                </ul>
              ) : (
                <div style={{ color: '#6b7280' }}>No recommended action available</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer action */}
        <div style={{ padding: 18, display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e5e7eb' }}>
          <button
            type="button"
            disabled={isResolved}
            onClick={() => { if (!isResolved) onTakeAction?.(report); }}
            style={{
              background: isResolved ? '#9ca3af' : 'linear-gradient(90deg,#2563eb,#3b82f6)',
              color: '#fff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: 10,
              fontWeight: 700,
              opacity: isResolved ? 0.7 : 1,
              cursor: isResolved ? 'not-allowed' : 'pointer'
            }}
            title={isResolved ? 'This report is already resolved.' : 'Take moderation action'}
          >
            Take Action
          </button>
        </div>
      </div>
    </div>
  );
};

// Take Action modal (self-contained)
const TakeActionModal = ({ report, onClose, onSubmit }) => {
  const [typeVal, setTypeVal] = useState('');
  const [reasonVal, setReasonVal] = useState('');
  const [notesVal, setNotesVal] = useState('');
  const [actionSubmitting, setActionSubmitting] = useState(false);

  // NEW: auto-set reason when opening if empty
  useEffect(() => {
    if (reasonVal) return;
    const auto = autoDetectReason(report);
    if (auto) setReasonVal(auto);
  }, [report, reasonVal]);

  const disabled = !typeVal || !reasonVal || actionSubmitting;
  const name = report?.reportedUser?.name || 'the user';

  // Close on Esc
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleTakeAction = async (payload) => {
    try {
      setActionSubmitting(true);
      // Apply moderation first
      const modResult = await applyModerationAction(report, payload);

      // NEW: update the report document status to "resolved"
      await updateReportAfterAction(report, payload, modResult);

      // Pass back (non-breaking)
      await Promise.resolve(onSubmit?.({ report, moderationResult: modResult, ...payload }));
      onClose?.();
    } catch (e) {
      console.warn('TakeAction error:', e?.message || e);
    } finally {
      setActionSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ width: 'min(640px,96vw)', background: '#fff', borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Take Action on Report</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer' }} aria-label="Close">×</button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Alert banner */}
          <div style={{ border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b', borderRadius: 8, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16 }}>
            <div style={{ fontSize: 18, lineHeight: 1, marginTop: 2 }}>⚠️</div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Account Action Required</div>
              <div style={{ color: '#7f1d1d' }}>
                You are about to take action against <strong style={{ color: '#7f1d1d' }}>{name}</strong> for violating community guidelines.
              </div>
            </div>
          </div>

          {/* Action Type */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Action Type *</div>
            <select className="form-input-dest" value={typeVal} onChange={(e) => setTypeVal(e.target.value)}>
              <option value="">Select an action</option>
              <option>Suspend Account</option>
              <option>Ban Account</option>
            </select>
          </div>

          {/* Reason */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Reason for Action *</div>
            <select className="form-input-dest" value={reasonVal} onChange={(e) => setReasonVal(e.target.value)}>
              <option value="">Select reason</option>
              <option>Inappropriate Content</option>
              <option>Spam/Promotional Content</option>
              <option>Harassment/Bullying</option>
              <option>Fake/Misleading Content</option>
              <option>Hate Speech</option>
              <option>Violence/Threats</option>
              <option>Copyright Violation</option>
              <option>Privacy Violation</option>
            </select>
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: 16, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn-secondary" onClick={onClose} style={{ padding: '10px 18px', borderRadius: 10 }}>Cancel</button>
          <button
            className="btn-primary"
            disabled={disabled}
            onClick={() => handleTakeAction({ actionType: typeVal, reason: reasonVal, notes: notesVal })}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              background: disabled ? '#fcae7b' : 'linear-gradient(90deg,#f97316,#fb923c)',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              opacity: disabled ? 0.8 : 1,
              cursor: disabled ? 'not-allowed' : 'pointer'
            }}
          >
            {actionSubmitting ? 'Taking Action...' : 'Take Action'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ADD AFTER getRecommendedAction (do not remove anything above)
const SUSPEND_DURATIONS_DAYS = {
  Inappropriate_Content: 1,
  Spam_Promotional_Content: 3,
  Harassment_Bullying: 3,
  Fake_Misleading_Content: 7,
  Hate_Speech: 7,
  Violence_Threats: 14,
  Copyright_Violation: 30,
  Privacy_Violation: 30
};

// Helper: remove reported content (best-effort)
async function removeReportedContent(report) {
  try {
    const db = getFirestore();
    // Try explicit ids
    const contentId =
      report?.contentId ||
      report?.content?.id ||
      report?.postId ||
      report?.commentId ||
      report?.content?.postId ||
      report?.content?.commentId ||
      null;

    if (!contentId) return { removed: false, reason: 'no-id' };

    // Try community collection
    try {
      const ref = doc(db, 'community', contentId);
      await deleteDoc(ref);
      return { removed: true, collection: 'community' };
    } catch {}

    // Try comments collection
    try {
      const ref = doc(db, 'comments', contentId);
      await deleteDoc(ref);
      return { removed: true, collection: 'comments' };
    } catch {}

    // Fallback: search by reportedUserId + text (expensive, limited)
    const ruId = report?.reportedUserId;
    if (ruId) {
      const q = query(collection(db, 'community'), where('userId', '==', ruId));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        if (String(d.data()?.text || '').includes(report?.content?.text || '') ||
            String(d.data()?.body || '').includes(report?.content?.body || '')) {
          await deleteDoc(d.ref);
          return { removed: true, collection: 'community-match' };
        }
      }
    }
    return { removed: false, reason: 'not-found' };
  } catch (e) {
    console.warn('removeReportedContent error', e);
    return { removed: false, error: e?.message };
  }
}

// Apply moderation action (warning / suspend / ban / remove content)
async function applyModerationAction(report, { actionType, reason, notes }) {
  try {
    const db = getFirestore();
    const ruId =
      report?.reportedUserId ??
      report?.reportedUserID ??
      report?.reportedID ??
      (typeof report?.reportedUser === 'string'
        ? report?.reportedUser
        : report?.reportedUser?.id) ??
      null;
    if (!ruId) return { ok: false, error: 'no-user-id' };

    const userRef = doc(db, 'users', ruId);
    const updates = {};
    const now = new Date();

    if (actionType === 'Send Warning') {
      const key = reasonLabelToKey(reason);
      const templateMsg = action_types?.Send_Warning?.[key]?.[0] || null;
      updates['moderation.warnings'] = arrayUnion({
        reason,
        message: templateMsg,        // NEW: store templated warning message
        notes: notes || '',
        at: serverTimestamp()
      });
      updates['moderation.lastAction'] = {
        type: 'warning',
        reason,
        message: templateMsg || null,
        at: serverTimestamp()
      };
    }

    if (actionType === 'Suspend Account') {
      const key = reasonLabelToKey(reason);
      const days = SUSPEND_DURATIONS_DAYS[key] || 1;
      const until = new Date(now.getTime() + days * 86400000);
      updates['moderation.status'] = 'suspended';
      updates['moderation.suspensionEnds'] = until;
      updates['moderation.lastAction'] = {
        type: 'suspend',
        reason,
        days,
        until,
        at: serverTimestamp()
      };
    }

    if (actionType === 'Ban Account') {
      updates['moderation.status'] = 'banned';
      updates['moderation.bannedAt'] = serverTimestamp();
      updates['moderation.lastAction'] = {
        type: 'ban',
        reason,
        at: serverTimestamp()
      };
    }

    let removalInfo = null;
    if (actionType === 'Remove Content Only') {
      removalInfo = await removeReportedContent(report);
      updates['moderation.lastAction'] = {
        type: 'remove_content',
        reason,
        removed: removalInfo?.removed || false,
        collection: removalInfo?.collection || null,
        at: serverTimestamp()
      };
      if (removalInfo?.removed) {
        updates['moderation.removals'] = arrayUnion({
          reason,
          reportId: report?.id || null,
          at: serverTimestamp()
        });
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateDoc(userRef, updates);
    }

    return { ok: true, updates, removalInfo };
  } catch (e) {
    console.warn('applyModerationAction error', e);
    return { ok: false, error: e?.message || String(e) };
  }
}

// NEW: helper to update report status after action
async function updateReportAfterAction(report, { actionType, reason, notes }, moderationResult) {
  try {
    const db = getFirestore();
    const reportId = report?.id || report?.reportId || report?.reportID;
    if (!reportId) return { ok: false, error: 'no-report-id' };

    // Map any taken action to a terminal status recognizable by StatusBadge
    // Options supported by UI: pending | under_review | escalated | resolved
    const status = 'resolved';

    const ref = doc(db, 'report', reportId);
    await updateDoc(ref, {
      status,
      actionType,
      actionReason: reason || null,
      actionNotes: notes || '',
      handledAt: serverTimestamp(),
      handled: true,
      // Optional: store moderation outcome summary
      moderationResult: moderationResult?.ok === true ? {
        updated: true,
        removal: moderationResult?.removalInfo || null
      } : {
        updated: false,
        error: moderationResult?.error || null
      }
    });
    return { ok: true };
  } catch (e) {
    console.warn('updateReportAfterAction error:', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export { ReportDetailModal, TakeActionModal };
export default ReportDetailModal;