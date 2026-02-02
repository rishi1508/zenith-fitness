import { useState, useRef } from 'react';
import type { BodyWeightEntry } from './types';

// Interactive Body Weight Chart Component
export function BodyWeightChart({ entries, isDark }: { entries: BodyWeightEntry[]; isDark: boolean }) {
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  
  // Reverse to show oldest first (left to right)
  const chartData = [...entries].reverse();
  
  if (chartData.length < 2) {
    return (
      <div className={`rounded-xl p-4 border ${isDark ? 'bg-[#1a1a1a] border-[#2e2e2e]' : 'bg-gray-50 border-gray-200'}`}>
        <div className={`text-sm font-medium mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>Weight Trend</div>
        <div className={`h-24 flex items-center justify-center text-sm ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>
          Log at least 2 entries to see trend
        </div>
      </div>
    );
  }
  
  // Chart dimensions
  const pointSpacing = 45;
  const chartHeight = 140;
  const paddingTop = 25;
  const paddingBottom = 35;
  const paddingLeft = 40;
  const paddingRight = 15;
  const chartWidth = Math.max(280, paddingLeft + paddingRight + (chartData.length - 1) * pointSpacing);
  const graphHeight = chartHeight - paddingTop - paddingBottom;
  
  // Calculate min/max for scaling
  const weights = chartData.map(e => e.weight);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const weightRange = maxWeight - minWeight || 1;
  
  // Add padding for better visualization
  const weightPadding = Math.max(weightRange * 0.15, 0.5);
  const adjustedMin = Math.max(0, minWeight - weightPadding);
  const adjustedMax = maxWeight + weightPadding;
  const adjustedRange = adjustedMax - adjustedMin;
  
  // Generate Y-axis labels
  const yAxisLabels: number[] = [];
  const labelCount = 3;
  for (let i = 0; i <= labelCount; i++) {
    yAxisLabels.push(Math.round((adjustedMin + (adjustedRange * i) / labelCount) * 10) / 10);
  }
  
  // Convert data to points
  const points = chartData.map((entry, i) => {
    const x = paddingLeft + i * pointSpacing;
    const normalizedWeight = (entry.weight - adjustedMin) / adjustedRange;
    const y = paddingTop + graphHeight - (normalizedWeight * graphHeight);
    return { x, y, entry, index: i };
  });
  
  // Create line path
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
    
    if (nearestDist < pointSpacing / 2 + 10) {
      setActivePoint(nearestIndex);
      const point = points[nearestIndex];
      const tooltipX = point.x - scrollLeft;
      setTooltipPos({ x: tooltipX, y: point.y });
    }
  };
  
  const handleInteractionEnd = () => {
    setActivePoint(null);
  };
  
  // Format date for labels
  const formatDate = (dateStr: string, full = false) => {
    const date = new Date(dateStr);
    if (full) {
      return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
    }
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };
  
  // Determine X label interval
  const getXLabelInterval = () => {
    if (chartData.length <= 7) return 1;
    if (chartData.length <= 14) return 2;
    return Math.ceil(chartData.length / 7);
  };
  const xLabelInterval = getXLabelInterval();
  
  // Calculate overall change
  const firstWeight = chartData[0].weight;
  const lastWeight = chartData[chartData.length - 1].weight;
  const totalChange = lastWeight - firstWeight;
  const isLoss = totalChange < 0;

  // Colors based on theme
  const lineColor = '#a855f7'; // purple-500
  const bgColor = isDark ? '#1a1a1a' : '#f9fafb';
  const borderColor = isDark ? '#2e2e2e' : '#e5e7eb';
  const gridColor = isDark ? '#2e2e2e' : '#e5e7eb';
  const textColor = isDark ? '#a1a1aa' : '#6b7280';
  
  return (
    <div className={`rounded-xl p-4 border`} style={{ backgroundColor: bgColor, borderColor }}>
      <div className="flex items-center justify-between mb-3">
        <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Weight Trend</div>
        <div className={`text-xs flex items-center gap-1 ${isLoss ? 'text-green-400' : totalChange > 0 ? 'text-red-400' : textColor}`}>
          {totalChange !== 0 && (
            <>
              <span>{isLoss ? '↓' : '↑'}</span>
              <span>{Math.abs(totalChange).toFixed(1)} kg overall</span>
            </>
          )}
          {totalChange === 0 && <span>Stable</span>}
        </div>
      </div>
      
      <div className="relative">
        {/* Tooltip */}
        {activePoint !== null && (
          <div
            className="absolute z-10 pointer-events-none rounded-lg px-3 py-2 shadow-lg transform -translate-x-1/2"
            style={{
              left: tooltipPos.x,
              top: Math.max(0, tooltipPos.y - 55),
              backgroundColor: isDark ? '#2a2a2a' : '#ffffff',
              border: `1px solid ${isDark ? 'rgba(168, 85, 247, 0.5)' : 'rgba(168, 85, 247, 0.3)'}`,
            }}
          >
            <div className="text-xs" style={{ color: textColor }}>
              {formatDate(chartData[activePoint].date, true)}
            </div>
            <div className="text-sm font-bold text-purple-500">
              {chartData[activePoint].weight} kg
            </div>
            {chartData[activePoint].notes && (
              <div className="text-xs truncate max-w-[120px]" style={{ color: textColor }}>
                {chartData[activePoint].notes}
              </div>
            )}
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
              <linearGradient id="weightGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#a855f7" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#a855f7" stopOpacity="0.02" />
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
                  stroke={gridColor}
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
                  x={paddingLeft - 6}
                  y={y + 4}
                  fill={textColor}
                  fontSize="9"
                  textAnchor="end"
                >
                  {value.toFixed(1)}
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
                  y={paddingTop + graphHeight + 14}
                  fill={textColor}
                  fontSize="8"
                  textAnchor="middle"
                  className="select-none"
                >
                  {formatDate(p.entry.date)}
                </text>
              );
            })}
            
            {/* Area under line */}
            <path
              d={areaPath}
              fill="url(#weightGradient)"
            />
            
            {/* Line */}
            <path
              d={linePath}
              fill="none"
              stroke={lineColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            
            {/* Data points */}
            {points.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={activePoint === i ? 6 : 3.5}
                fill={activePoint === i ? lineColor : bgColor}
                stroke={lineColor}
                strokeWidth={activePoint === i ? 2.5 : 2}
                className="transition-all duration-150"
              />
            ))}
            
            {/* Active point ring */}
            {activePoint !== null && (
              <circle
                cx={points[activePoint].x}
                cy={points[activePoint].y}
                r={10}
                fill="none"
                stroke={lineColor}
                strokeWidth="1"
                strokeOpacity="0.3"
              />
            )}
          </svg>
        </div>
        
        {/* Scroll hint */}
        {chartData.length > 6 && (
          <div className="text-center text-[9px] mt-1" style={{ color: textColor }}>
            ← Swipe to see all →
          </div>
        )}
      </div>
    </div>
  );
}
