import React from 'react';
import { Forward } from 'lucide-react';
import { audioManager } from '../../audio/AudioManager';
import type { ConversationSummary } from '../../types/nexora';
import { GlassModal, ProfileAvatar } from '../ui/LiquidGlass';

interface ForwardModalProps {
  conversations: ConversationSummary[];
  onSelectConversation: (conv: ConversationSummary) => void;
  onClose: () => void;
}

export function ForwardModal({ conversations, onSelectConversation, onClose }: ForwardModalProps) {
  return (
    <GlassModal title="Forward Encrypted Message" onClose={onClose} maxWidthClass="max-w-md">
      <div className="flex items-center gap-2 text-xs text-[var(--nx-text-secondary)] -mt-2">
        <Forward className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300" />
        <span>Select a destination conversation to re-encrypt and send.</span>
      </div>
      <div className="max-h-[56vh] overflow-y-auto space-y-1.5 pr-1">
        {conversations.map((conv) => (
          <button
            key={conv.id}
            type="button"
            onClick={() => {
              audioManager.play('message.send');
              onSelectConversation(conv);
            }}
            className="w-full flex items-center gap-3 p-2.5 rounded-[16px] hover:bg-[var(--nx-surface-hover)] border border-transparent hover:border-[var(--nx-hairline)] transition-colors text-left cursor-pointer"
          >
            <ProfileAvatar src={conv.avatarUrl} name={conv.title} size="sm" isGroup={conv.type === 'group'} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--nx-text-primary)] truncate">{conv.title}</div>
              <div className="text-xs text-[var(--nx-text-secondary)] truncate">{conv.subtitle}</div>
            </div>
          </button>
        ))}
      </div>
    </GlassModal>
  );
}
