import React from 'react';
import { Forward, X } from 'lucide-react';
import type { ConversationSummary } from '../../types/nexora';
import { Avatar } from '../ui/Avatar';

interface ForwardModalProps {
  conversations: ConversationSummary[];
  onSelectConversation: (conv: ConversationSummary) => void;
  onClose: () => void;
}

export function ForwardModal({ conversations, onSelectConversation, onClose }: ForwardModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md nexora-glass rounded-2xl p-5 space-y-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Forward className="w-4 h-4 text-violet-400" />
            <h3 className="text-base font-display font-semibold text-white">Forward Encrypted Message</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close forward modal"
            className="p-2 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto space-y-1.5 pr-1">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              type="button"
              onClick={() => onSelectConversation(conv)}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 transition-colors text-left cursor-pointer"
            >
              <Avatar src={conv.avatarUrl} name={conv.title} size="sm" isGroup={conv.type === 'group'} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate">{conv.title}</div>
                <div className="text-xs text-slate-400 truncate">{conv.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
