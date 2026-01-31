import { useState, useRef } from 'react';

interface Session {
  date: string;
  volume: number;
  maxWeight: number;
  maxReps: number;
  sets: { weight: number; reps: number }[];
}

// Volume Line Chart Component - Interactive SVG line chart with touch support
export function VolumeLineChart({ sessions }: { sessions: Session[] }) {
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  
  if (sessions.length === 0) {
    return (
      <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4">
        <div className="text-sm font-medium mb-3">Volume Trend</div>
        <div className="h-32 flex items-center justify-center text-zinc-500 text-sm">
          No data yet
        </div>
      </div>
    );
  }
  
  // Chart dimensions
  const pointSpacing = 50; // Pixels between points
  const chartHeight = 160;
  const paddingTop = 30;
  const paddingBottom = 45;
  const paddingLeft = 45;
  const paddingRight = 20;
  const chartWidth = Math.max(300, paddingLeft + paddingRight + (sessions.length - 1) * pointSpacing);
  const graphHeight = chartHeight - paddingTop - paddingBottom;
  
  // Calculate min/max for scaling
  const volumes = sessions.map(s => s.volume);
  const minVolume = Math.min(...volumes);
  const maxVolume = Math.max(...volumes);
  const volumeRange = maxVolume - minVolume || 1;
  
  // Add padding to the range for better visualization
  const volumePadding = volumeRange * 0.1;
  const adjustedMin = Math.max(0, minVolume - volumePadding);
  const adjustedMax = maxVolume + volumePadding;
  const adjustedRange = adjustedMax - adjustedMin;
  
  // Generate Y-axis labels (4 values)
  const yAxisLabels: number[] = [];
  const labelCount = 4;
  for (let i = 0; i <= labelCount; i++) {
    yAxisLabels.push(Math.round(adjustedMin + (adjustedRange * i) / labelCount));
  }
  
  // Convert data to points
  const points = sessions.map((session, i) => {
    const x = paddingLeft + i * pointSpacing;
    const normalizedVolume = (session.volume - adjustedMin) / adjustedRange;
    const y = paddingTop + graphHeight - (normalizedVolume * graphHeight);
    return { x, y, session, index: i };
  });
  
  // Create path for line
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  
  // Create gradient area path
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${paddingTop + graphHeight} L ${paddingLeft} ${paddingTop + graphHeight} Z`;
  
  // Handle touch/mouse interaction
  const handleInteraction = (e: React.TouchEvent | React.MouseEvent) => {
    if (!svgRef.current || !containerRef.current) return;
    
    const svg = svgRef.current;
    const container = containerRef.current;
    const rect = svg.getBoundingClientRect();
    
    let clientX: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
    } else {
      clientX = e.clientX;
    }
    
    // Account for scroll position
    const scrollLeft = container.scrollLeft;
    const x = clientX - rect.left + scrollLeft;
    
    // Find nearest point
    let nearestIndex = 0;
    let nearestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - x);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = i;
      }
    });
    
    // Only show if within reasonable distance
    if (nearestDist < pointSpacing / 2 + 10) {
      setActivePoint(nearestIndex);
      const point = points[nearestIndex];
      // Position tooltip - account for scroll
      const tooltipX = point.x - scrollLeft;
      setTooltipPos({ x: tooltipX, y: point.y });
    }
  };
  
  const handleInteractionEnd = () => {
    setActivePoint(null);
  };
  
  // Format date for X-axis labels
  const formatDate = (dateStr: string, showYear = false) => {
    const date = new Date(dateStr);
    if (showYear) {
      return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
    }
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };
  
  // Decide which X labels to show based on number of points
  const getXLabelInterval = () => {
    if (sessions.length <= 7) return 1;
    if (sessions.length <= 15) return 2;
    if (sessions.length <= 30) return 4;
    return Math.ceil(sessions.length / 8);
  };
  const xLabelInterval = getXLabelInterval();

  return (
    <div className="bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Volume Trend</div>
        <div className="text-xs text-zinc-500">{sessions.length} sessions</div>
      </div>
      
      <div className="relative">
        {/* Tooltip */}
        {activePoint !== null && (
          <div
            className="absolute z-10 pointer-events-none bg-[#2a2a2a] border border-orange-500/50 rounded-lg px-3 py-2 shadow-lg transform -translate-x-1/2"
            style={{
              left: tooltipPos.x,
              top: Math.max(0, tooltipPos.y - 60),
            }}
          >
            <div className="text-xs text-zinc-400">
              {formatDate(sessions[activePoint].date, true)}
            </div>
            <div className="text-sm font-bold text-orange-400">
              {Math.round(sessions[activePoint].volume)} vol
            </div>
            <div className="text-xs text-zinc-500">
              Max: {sessions[activePoint].maxWeight}kg × {sessions[activePoint].maxReps}
            </div>
          </div>
        )}
        
        <div 
          ref={containerRef}
          className="overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <svg
            ref={svgRef}
            width={chartWidth}
            height={chartHeight}
            className="touch-pan-x"
            onTouchStart={handleInteraction}
            onTouchMove={handleInteraction}
            onTouchEnd={handleInteractionEnd}
            onMouseMove={handleInteraction}
            onMouseLeave={handleInteractionEnd}
          >
            {/* Gradient definition */}
            <defs>
              <linearGradient id="volumeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#f97316" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            
            {/* Grid lines */}
            {yAxisLabels.map((_, i) => {
              const y = paddingTop + (graphHeight * i) / labelCount;
              return (
                <line
                  key={i}
                  x1={paddingLeft}
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke="#2e2e2e"
                  strokeDasharray="4 4"
                />
              );
            })}
            
            {/* Y-axis labels */}
            {yAxisLabels.map((value, i) => {
              const y = paddingTop + graphHeight - (graphHeight * i) / labelCount;
              return (
                <text
                  key={i}
                  x={paddingLeft - 8}
                  y={y + 4}
                  fill="#71717a"
                  fontSize="10"
                  textAnchor="end"
                >
                  {value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
                </text>
              );
            })}
            
            {/* X-axis labels */}
            {points.map((p, i) => {
              if (i % xLabelInterval !== 0 && i !== points.length - 1) return null;
              return (
                <text
                  key={i}
                  x={p.x}
                  y={paddingTop + graphHeight + 18}
                  fill="#71717a"
                  fontSize="9"
                  textAnchor="middle"
                  className="select-none"
                >
                  {formatDate(p.session.date)}
                </text>
              );
            })}
            
            {/* Area under line */}
            <path
              d={areaPath}
              fill="url(#volumeGradient)"
            />
            
            {/* Line */}
            <path
              d={linePath}
              fill="none"
              stroke="#f97316"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            
            {/* Data points */}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={activePoint === i ? 7 : 4}
                fill={activePoint === i ? '#f97316' : '#1a1a1a'}
                stroke="#f97316"
                strokeWidth={activePoint === i ? 3 : 2}
                className="transition-all duration-150"
              />
            ))}
            
            {/* Active point highlight ring */}
            {activePoint !== null && (
              <circle
                cx={points[activePoint].x}
                cy={points[activePoint].y}
                r={12}
                fill="none"
                stroke="#f97316"
                strokeWidth="1"
                strokeOpacity="0.3"
              />
            )}
          </svg>
        </div>
        
        {/* Scroll hint for many data points */}
        {sessions.length > 6 && (
          <div className="text-center text-[10px] text-zinc-600 mt-2">
            ← Swipe to see all data →
          </div>
        )}
      </div>
    </div>
  );
}
