import React, { useState, useRef, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';

interface SosProgressButtonProps {
  onTrigger: () => void;
  disabled?: boolean;
}

export const SosProgressButton: React.FC<SosProgressButtonProps> = ({ onTrigger, disabled = false }) => {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 100
  const [hint, setHint] = useState<string | null>(null);

  const holdStartTimeRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const HOLD_DURATION_MS = 3000;

  const triggerHaptic = (pattern: number | number[]) => {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {}
    }
  };

  const startHold = (e: React.SyntheticEvent) => {
    if (disabled) return;
    e.preventDefault();
    setHolding(true);
    setHint(null);
    holdStartTimeRef.current = Date.now();
    triggerHaptic(60);

    const checkProgress = () => {
      if (!holdStartTimeRef.current) return;
      const elapsed = Date.now() - holdStartTimeRef.current;
      const currentProgress = Math.min(100, (elapsed / HOLD_DURATION_MS) * 100);
      setProgress(currentProgress);

      // Periodic haptic vibration pulse during hold
      if (Math.floor(elapsed / 500) > Math.floor((elapsed - 16) / 500)) {
        triggerHaptic(40);
      }

      if (elapsed >= HOLD_DURATION_MS) {
        // Trigger SOS!
        triggerHaptic([200, 100, 400]);
        setProgress(100);
        setHolding(false);
        holdStartTimeRef.current = null;
        onTrigger();
        return;
      }

      animationFrameRef.current = requestAnimationFrame(checkProgress);
    };

    animationFrameRef.current = requestAnimationFrame(checkProgress);
  };

  const cancelHold = (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    if (!holding) return;

    if (holdStartTimeRef.current && Date.now() - holdStartTimeRef.current < HOLD_DURATION_MS) {
      setHint('Hold firmly for 3 full seconds to activate SOS');
      setTimeout(() => setHint(null), 3500);
    }

    setHolding(false);
    setProgress(0);
    holdStartTimeRef.current = null;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // SVG circular progress calculation
  const size = 260;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center select-none py-6">
      <div className="relative flex items-center justify-center">
        {/* Outer glowing pulsing aura */}
        <div className={`absolute w-64 h-64 rounded-full bg-red-600/20 blur-xl transition-transform ${holding ? 'scale-125 bg-red-600/40' : 'animate-pulse'}`} />

        {/* SVG Progress Ring */}
        <svg width={size} height={size} className="transform -rotate-90 z-10 pointer-events-none">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-slate-200 dark:text-slate-800"
            fill="transparent"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="url(#sosGrad)"
            strokeWidth={strokeWidth + 2}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-all duration-75 ease-linear"
          />
          <defs>
            <linearGradient id="sosGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f87171" />
              <stop offset="100%" stopColor="#b91c1c" />
            </linearGradient>
          </defs>
        </svg>

        {/* Central SOS Button */}
        <button
          type="button"
          disabled={disabled}
          onMouseDown={startHold}
          onMouseUp={cancelHold}
          onMouseLeave={cancelHold}
          onTouchStart={startHold}
          onTouchEnd={cancelHold}
          onTouchCancel={cancelHold}
          aria-label="Emergency SOS: Press and hold 3 seconds to send alert"
          className={`absolute z-20 w-48 h-48 rounded-full bg-gradient-to-br from-red-500 via-red-600 to-rose-700 text-white shadow-2xl flex flex-col items-center justify-center font-black tracking-wider transition-transform active:scale-95 cursor-pointer outline-none focus:ring-4 focus:ring-red-400 ${
            holding ? 'scale-95 shadow-red-500/50' : 'hover:scale-[1.02]'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <span className="text-4xl sm:text-5xl drop-shadow-md">SOS</span>
          <span className="text-[11px] font-semibold tracking-normal uppercase mt-1 opacity-90">
            {holding ? `${Math.ceil((HOLD_DURATION_MS - (progress / 100) * HOLD_DURATION_MS) / 1000)}s Hold` : 'Hold 3s'}
          </span>
        </button>
      </div>

      {/* Hint and Status Announcements */}
      <div className="h-8 mt-4 text-center">
        {hint && (
          <p
            role="alert"
            aria-live="polite"
            className="text-sm font-medium text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1.5 animate-bounce"
          >
            <AlertCircle className="w-4 h-4" />
            {hint}
          </p>
        )}
        {!hint && !holding && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Press and hold for 3 seconds to trigger emergency alert
          </p>
        )}
        {holding && (
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 animate-pulse">
            Keep holding... dispatching emergency services!
          </p>
        )}
      </div>
    </div>
  );
};
