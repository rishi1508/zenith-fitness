import { describe, it, expect } from 'vitest';
import { youtubeId } from '../src/videoUrl';
import { summarizeRatings } from '../src/gymRatings';
import type { GymClass, GymSessionRating } from '../src/types';

describe('youtubeId', () => {
  it('reads every common YouTube URL shape', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtube.com/shorts/abc123XYZ_-')).toBe('abc123XYZ_-');
    expect(youtubeId('https://www.youtube-nocookie.com/embed/abc123XYZ_-')).toBe('abc123XYZ_-');
    expect(youtubeId('https://m.youtube.com/watch?v=abc123XYZ_-&list=x')).toBe('abc123XYZ_-');
  });

  it('returns null for anything else', () => {
    expect(youtubeId('https://example.com/video.mp4')).toBeNull();
    expect(youtubeId('not a url')).toBeNull();
    expect(youtubeId('https://vimeo.com/12345')).toBeNull();
  });
});

describe('summarizeRatings', () => {
  const classes: GymClass[] = [
    { id: 'c1', name: 'HIIT', weekday: 1, startTime: '18:00', durationMin: 45, trainerUid: 't1', active: true },
    { id: 'c2', name: 'Yoga', weekday: 2, startTime: '07:00', durationMin: 60, trainerUid: 't2', active: true },
  ];
  const ratings: GymSessionRating[] = [
    { classId: 'c1', date: '2026-09-10', trainerUid: 't1', stars: 5, at: '2026-09-10T13:00:00.000Z', comment: 'Great pace' },
    { classId: 'c1', date: '2026-09-11', trainerUid: 't1', stars: 4, at: '2026-09-11T13:00:00.000Z' },
    { classId: 'c2', date: '2026-09-11', trainerUid: 't2', stars: 2, at: '2026-09-11T02:00:00.000Z', comment: 'Too crowded' },
  ];

  it('averages, buckets and groups by trainer and class', () => {
    const s = summarizeRatings(ratings, classes);
    expect(s.count).toBe(3);
    expect(s.avg).toBeCloseTo(3.7, 1);
    expect(s.histogram).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 });
    expect(s.byTrainer[0]).toEqual({ trainerUid: 't1', count: 2, avg: 4.5 });
    expect(s.byClass.find((c) => c.classId === 'c2')).toEqual({ classId: 'c2', name: 'Yoga', count: 1, avg: 2 });
  });

  it('lists comments newest first with the class name', () => {
    const s = summarizeRatings(ratings, classes);
    expect(s.comments.map((c) => c.comment)).toEqual(['Too crowded', 'Great pace']);
    expect(s.comments[0].className).toBe('Yoga');
  });

  it('is empty-safe', () => {
    const s = summarizeRatings([], classes);
    expect(s.avg).toBeNull();
    expect(s.count).toBe(0);
    expect(s.comments).toEqual([]);
  });
});
