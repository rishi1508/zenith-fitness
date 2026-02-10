import { useRef, useState } from 'react';
import { X, Share2, Download, Dumbbell, Clock, Flame, Trophy } from 'lucide-react';
import html2canvas from 'html2canvas';
import type { Workout } from '../types';

interface ShareWorkoutProps {
  workout: Workout;
  onClose: () => void;
  isDark: boolean;
}

export function ShareWorkout({ workout, onClose, isDark }: ShareWorkoutProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Calculate stats
  const totalVolume = workout.exercises.reduce((sum, ex) => 
    sum + ex.sets.reduce((setSum, set) => 
      setSum + (set.completed ? set.weight * set.reps : 0), 0), 0);
  
  const totalSets = workout.exercises.reduce((sum, ex) => 
    sum + ex.sets.filter(s => s.completed).length, 0);
  
  const exerciseCount = workout.exercises.length;

  const generateImage = async () => {
    if (!cardRef.current) return;
    
    setGenerating(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#0a0a0a',
        scale: 2, // Higher quality
        logging: false,
      });
      
      const url = canvas.toDataURL('image/png');
      setImageUrl(url);
    } catch (e) {
      console.error('Failed to generate image:', e);
      alert('Failed to generate image');
    } finally {
      setGenerating(false);
    }
  };

  const downloadImage = () => {
    if (!imageUrl) return;
    
    const link = document.createElement('a');
    link.download = `workout-${workout.date}.png`;
    link.href = imageUrl;
    link.click();
  };

  const shareImage = async () => {
    if (!imageUrl) return;
    
    try {
      // Convert data URL to blob
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const file = new File([blob], `workout-${workout.date}.png`, { type: 'image/png' });
      
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'My Workout',
          text: `Crushed it! 💪 ${exerciseCount} exercises, ${totalSets} sets, ${(totalVolume/1000).toFixed(1)} tonnes lifted!`,
        });
      } else {
        // Fallback: download
        downloadImage();
      }
    } catch (e) {
      console.error('Share failed:', e);
      downloadImage();
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { 
      weekday: 'short', 
      day: 'numeric', 
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className={`w-full max-w-md rounded-2xl overflow-hidden ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'}`}>
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between ${isDark ? 'border-[#2e2e2e]' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-orange-400" />
            <h2 className="text-lg font-bold">Share Workout</h2>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${isDark ? 'hover:bg-[#252525]' : 'hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Shareable Card */}
          <div 
            ref={cardRef}
            className="bg-gradient-to-br from-[#0a0a0a] via-[#1a1a1a] to-[#0a0a0a] p-6 rounded-xl border border-orange-500/30"
          >
            {/* Logo */}
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                <Dumbbell className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-white">Zenith Fitness</span>
            </div>
            
            {/* Workout Name */}
            <div className="mb-4">
              <h3 className="text-2xl font-bold text-white">{workout.name}</h3>
              <p className="text-sm text-zinc-500">{formatDate(workout.date)}</p>
            </div>
            
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-[#252525] rounded-lg p-3 text-center">
                <Flame className="w-5 h-5 text-orange-400 mx-auto mb-1" />
                <div className="text-xl font-bold text-white">{exerciseCount}</div>
                <div className="text-xs text-zinc-500">Exercises</div>
              </div>
              <div className="bg-[#252525] rounded-lg p-3 text-center">
                <Trophy className="w-5 h-5 text-yellow-400 mx-auto mb-1" />
                <div className="text-xl font-bold text-white">{totalSets}</div>
                <div className="text-xs text-zinc-500">Sets</div>
              </div>
              <div className="bg-[#252525] rounded-lg p-3 text-center">
                <Dumbbell className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
                <div className="text-xl font-bold text-white">{(totalVolume/1000).toFixed(1)}t</div>
                <div className="text-xs text-zinc-500">Volume</div>
              </div>
            </div>
            
            {/* Exercises Preview */}
            <div className="space-y-1 mb-4">
              {workout.exercises.slice(0, 4).map((ex, i) => {
                const completedSets = ex.sets.filter(s => s.completed);
                const maxWeight = Math.max(...completedSets.map(s => s.weight), 0);
                return (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">{ex.exerciseName}</span>
                    <span className="text-white font-medium">{maxWeight}kg</span>
                  </div>
                );
              })}
              {workout.exercises.length > 4 && (
                <div className="text-xs text-zinc-500 text-center pt-1">
                  +{workout.exercises.length - 4} more exercises
                </div>
              )}
            </div>
            
            {/* Duration */}
            {workout.duration && (
              <div className="flex items-center justify-center gap-2 text-sm text-zinc-400">
                <Clock className="w-4 h-4" />
                <span>{workout.duration} minutes</span>
              </div>
            )}
            
            {/* Completed Badge */}
            {workout.completed && (
              <div className="mt-4 text-center">
                <span className="inline-block bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-bold px-4 py-2 rounded-full">
                  💪 WORKOUT COMPLETED
                </span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {!imageUrl ? (
            <button
              onClick={generateImage}
              disabled={generating}
              className="w-full py-3 bg-orange-500 hover:bg-orange-400 disabled:bg-orange-800 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {generating ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Share2 className="w-5 h-5" />
                  Generate Image
                </>
              )}
            </button>
          ) : (
            <div className="space-y-2">
              <button
                onClick={shareImage}
                className="w-full py-3 bg-orange-500 hover:bg-orange-400 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <Share2 className="w-5 h-5" />
                Share
              </button>
              <button
                onClick={downloadImage}
                className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 transition-colors ${
                  isDark ? 'bg-[#252525] hover:bg-[#303030] text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                }`}
              >
                <Download className="w-5 h-5" />
                Download
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
