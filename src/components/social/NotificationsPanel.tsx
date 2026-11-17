import React from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { NotificationItem } from '../../types/nexora';

interface NotificationsPanelProps {
  notifications: NotificationItem[];
  onRefresh: () => void;
}

export function NotificationsPanel({ notifications, onRefresh }: NotificationsPanelProps) {
  const markAllRead = async () => {
    await apiRequest('/api/v1/notifications/read-all', { method: 'POST' });
    onRefresh();
  };

  return (
    <div className="h-full max-w-3xl mx-auto w-full p-4 sm:p-6 space-y-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-display font-bold text-white">Notifications</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Connection requests, group updates, story reactions, and streak milestones.
          </p>
        </div>
        {notifications.some((n) => !n.isRead) && (
          <button
            type="button"
            onClick={markAllRead}
            className="h-9 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="nexora-surface rounded-2xl p-10 text-center space-y-2">
          <Bell className="w-7 h-7 text-slate-500 mx-auto" />
          <div className="text-sm font-medium text-slate-300">All caught up</div>
          <p className="text-xs text-slate-500">New activity notifications will appear here in real time.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-2xl p-4 border transition-colors ${
                n.isRead
                  ? 'bg-slate-900/45 border-white/5'
                  : 'bg-violet-950/35 border-violet-500/30'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-white">{n.title}</div>
                <span className="text-[11px] font-mono-tabular text-slate-400">
                  {new Date(n.createdAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">{n.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
