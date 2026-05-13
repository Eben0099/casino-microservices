import React from 'react';

/**
 * Small pill badge showing WebSocket connection state for the admin dashboard.
 * Green dot + "LIVE" when connected, dim grey otherwise.
 *
 * Optional `lastEventType`: shows the last event type briefly to give a feeling
 * of activity (useful during load tests).
 */
function LiveIndicator({ connected, lastEventType }) {
  const dotColor = connected ? 'var(--green, #10b981)' : 'var(--text-muted)';
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold"
      style={{
        background: connected ? 'rgba(16, 185, 129, 0.10)' : 'var(--bg-elevated)',
        color: connected ? 'var(--green, #10b981)' : 'var(--text-muted)',
        border: `1px solid ${connected ? 'rgba(16, 185, 129, 0.35)' : 'var(--border-subtle)'}`,
        letterSpacing: '0.08em',
      }}
      title={connected ? 'WebSocket connecte — mises a jour en temps reel' : 'WebSocket deconnecte — repli sur polling 3s'}
    >
      <span
        style={{
          width: 7, height: 7, borderRadius: '50%',
          background: dotColor,
          boxShadow: connected ? `0 0 8px ${dotColor}` : 'none',
          animation: connected ? 'pulse 2s infinite' : 'none',
        }}
      />
      {connected ? 'LIVE' : 'OFFLINE'}
      {connected && lastEventType && (
        <span style={{ opacity: 0.7, fontWeight: 500, marginLeft: 2 }}>· {lastEventType}</span>
      )}
    </div>
  );
}

export default LiveIndicator;
