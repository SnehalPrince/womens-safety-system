import React, { useState, useRef, useEffect } from 'react';
import { Send, Shield, User } from 'lucide-react';

export interface ChatMessage {
  id: number;
  incident_id: number;
  sender: 'admin' | 'user';
  body: string;
  created_at: string;
}

interface ChatThreadProps {
  messages: ChatMessage[];
  currentRole: 'admin' | 'user';
  onSendMessage: (body: string) => Promise<void>;
  disabled?: boolean;
}

export const ChatThread: React.FC<ChatThreadProps> = ({
  messages,
  currentRole,
  onSendMessage,
  disabled = false,
}) => {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isSending || disabled) return;

    const messageText = text.trim();
    setText('');
    setIsSending(true);

    try {
      await onSendMessage(messageText);
    } catch (err) {
      console.error('Failed to send message:', err);
      setText(messageText); // restore on failure
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-white dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-500" />
          <span className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
            Live Emergency Dispatch Chat
          </span>
        </div>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {messages.length} messages
        </span>
      </div>

      {/* Messages area */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 min-h-[180px] max-h-[300px]">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-6 text-slate-400 dark:text-slate-500">
            <Shield className="w-8 h-8 opacity-40 mb-1" />
            <p className="text-xs">No messages yet.</p>
            <p className="text-[11px]">Send an update directly to {currentRole === 'admin' ? 'the victim' : 'the emergency team'}.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.sender === currentRole;
            const isAdmin = msg.sender === 'admin';

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  {isAdmin ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-1.5 py-0.5 rounded">
                      <Shield className="w-2.5 h-2.5" /> Emergency Dispatch
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-1.5 py-0.5 rounded">
                      <User className="w-2.5 h-2.5" /> Victim
                    </span>
                  )}
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs sm:text-sm shadow-sm leading-relaxed ${
                    isMe
                      ? 'bg-red-600 text-white rounded-tr-none'
                      : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-tl-none'
                  }`}
                >
                  {msg.body}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} className="p-2.5 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={currentRole === 'admin' ? 'Type dispatch message to victim...' : 'Type message to responders...'}
          disabled={disabled || isSending}
          className="flex-1 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 text-xs sm:text-sm rounded-xl px-3.5 py-2.5 border-none focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <button
          type="submit"
          disabled={!text.trim() || isSending || disabled}
          aria-label="Send message"
          className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white p-2.5 rounded-xl flex items-center justify-center transition-colors cursor-pointer"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
