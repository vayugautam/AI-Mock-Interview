import React from 'react';
import { Video, VideoOff, Mic, MicOff, User } from 'lucide-react';

interface CandidateCameraProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoEnabled: boolean;
  audioEnabled: boolean;
  candidateName: string;
  micVolume: number;
  onToggleVideo: () => void;
  onToggleAudio: () => void;
}

export const CandidateCamera: React.FC<CandidateCameraProps> = ({
  videoRef,
  videoEnabled,
  audioEnabled,
  candidateName,
  micVolume,
  onToggleVideo,
  onToggleAudio,
}) => {
  return (
    <div className="relative rounded-2xl bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm dark:shadow-xl aspect-video sm:aspect-[4/3] flex items-center justify-center transition-colors">
      {videoEnabled ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover transform -scale-x-100"
        />
      ) : (
        <div className="flex flex-col items-center justify-center space-y-2 text-slate-400 dark:text-slate-500">
          <div className="w-12 h-12 rounded-full bg-slate-800 dark:bg-slate-900 border border-slate-700 dark:border-slate-800 flex items-center justify-center">
            <User className="w-6 h-6 text-slate-400" />
          </div>
          <span className="text-xs text-slate-300 dark:text-slate-400 font-medium">Video Feed Paused</span>
        </div>
      )}

      {/* Candidate Name Indicator */}
      <div className="absolute top-3 left-3 flex items-center space-x-2 bg-slate-950/85 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-800 text-[11px] text-white">
        <span
          className={`w-2 h-2 rounded-full ${
            videoEnabled || audioEnabled ? 'bg-emerald-400' : 'bg-slate-500'
          }`}
        />
        <span>{candidateName} (Candidate)</span>
      </div>

      {/* Floating Control Bar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center space-x-2 bg-slate-950/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-800 shadow-xl">
        <button
          type="button"
          onClick={onToggleVideo}
          className={`p-2 rounded-full transition-colors cursor-pointer ${
            videoEnabled
              ? 'bg-slate-800 hover:bg-slate-700 text-white'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}
          title={videoEnabled ? 'Disable camera' : 'Enable camera'}
        >
          {videoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={onToggleAudio}
          className={`p-2 rounded-full transition-colors cursor-pointer ${
            audioEnabled
              ? 'bg-slate-800 hover:bg-slate-700 text-white'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}
          title={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
        >
          {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        {/* Dynamic Audio Level Meter */}
        <div className="flex items-center space-x-0.5 px-2">
          {[0.15, 0.35, 0.55, 0.75, 0.95].map((threshold, idx) => (
            <div
              key={idx}
              className={`w-1 rounded-full transition-all duration-75 ${
                micVolume >= threshold && audioEnabled
                  ? 'bg-emerald-400 h-4'
                  : 'bg-slate-700 h-2'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
