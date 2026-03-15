import { useState, useRef, useCallback, useEffect } from 'react';

interface Session {
  date: string;
  volume: number;
  maxWeight: number;
  maxReps: number;
  sets: { weight: number; reps: number }[];
}

// Volume Line Chart — TradingView-style with long-press crosshair & axis-drag scaling
export function VolumeLineChart({ sessions, isDark = true }: { sessions: Session[]; isDark?: boolean }) {
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const [crosshairMode, setCrosshairMode] = useState(false);
  const [xZoom, setXZoom] = useState(1);
  const [yZoom, setYZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(300);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Axis drag state
  type DragAxis = 'x' | 'y' | null;
  const [isDraggingAxis, setIsDraggingAxis] = useState(false);
  const dragAxisRef = useRef<DragAxis>(null);
  const dragStartRef = useRef<{ clientX: number; clientY: number; xZoom: number; yZoom: number } | null>(null);

  // Pinch zoom
  const pinchStartRef = useRef<number | null>(null);
  const pinchXZoomRef = useRef(1);

  // Long-press detection
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  // Crosshair drag: track starting clientX and the activePoint index at drag start
  const crosshairDragStartXRef = useRef<number | null>(null);
  const crosshairDragStartIndexRef = useRef<number>(0);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.scrollLeft = containerRef.current.scrollWidth;
      }
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    scrollToEnd();
  }, [scrollToEnd]);

  // Keep scroll anchored to the right when X zoom changes
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth - containerRef.current.clientWidth;
    }
  }, [xZoom]);

  useEffect(() => {
    return () => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); };
  }, []);

  // Chart layout
  const basePointSpacing = 50;
  const paddingTop = 10;
  const paddingBottom = 30;
  const paddingLeft = 38;
  const paddingRight = 8;
  const baseChartHeight = 160;

  const totalBaseWidth = paddingLeft + paddingRight + (sessions.length - 1) * basePointSpacing;
  const minXZoom = Math.min(1, containerWidth / totalBaseWidth);
  const minYZoom = 0.5;

  const pointSpacing = basePointSpacing * xZoom;
  const chartHeight = baseChartHeight * yZoom;
  const chartWidth = Math.max(containerWidth, paddingLeft + paddingRight + (sessions.length - 1) * pointSpacing);
  const graphHeight = chartHeight - paddingTop - paddingBottom;

  const volumes = sessions.length > 0 ? sessions.map(s => s.volume) : [0];
  const minVolume = Math.min(...volumes);
  const maxVolume = Math.max(...volumes);
  const volumeRange = maxVolume - minVolume || 1;
  const volumePadding = volumeRange * 0.1;
  const adjustedMin = Math.max(0, minVolume - volumePadding);
  const adjustedMax = maxVolume + volumePadding;
  const adjustedRange = adjustedMax - adjustedMin;

  const labelCount = 4;
  const yAxisLabels: number[] = [];
  for (let i = 0; i <= labelCount; i++) {
    yAxisLabels.push(Math.round(adjustedMin + (adjustedRange * i) / labelCount));
  }

  const points = sessions.map((session, i) => {
    const x = paddingLeft + i * pointSpacing;
    const normalizedVolume = (session.volume - adjustedMin) / adjustedRange;
    const y = paddingTop + graphHeight - (normalizedVolume * graphHeight);
    return { x, y, session, index: i };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${paddingTop + graphHeight} L ${paddingLeft} ${paddingTop + graphHeight} Z`
    : '';

  // Find nearest data point to an x coordinate (in SVG space)
  const findNearestPoint = useCallback((svgX: number): number | null => {
    let nearestIndex = 0;
    let nearestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - svgX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIndex = i;
      }
    });
    return nearestDist < pointSpacing + 20 ? nearestIndex : null;
  }, [points, pointSpacing]);

  // Get SVG x from a pointer event
  const getSvgX = useCallback((e: React.TouchEvent | React.MouseEvent): number | null => {
    if (!containerRef.current) return null;
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    if (clientX === undefined) return null;
    return clientX - rect.left + container.scrollLeft;
  }, []);

  const getRelPos = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY : e.clientY;
    if (clientX === undefined || clientY === undefined) return null;
    return { x: clientX - rect.left, y: clientY - rect.top, clientX, clientY };
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // --- Pointer handlers ---
  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const rel = getRelPos(e);
    if (!rel) return;

    // Multi-touch → pinch
    if ('touches' in e && e.touches.length > 1) {
      cancelLongPress();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartRef.current = Math.hypot(dx, dy);
      pinchXZoomRef.current = xZoom;
      return;
    }

    // X-axis drag zone
    if (rel.y > chartHeight - paddingBottom + 5) {
      cancelLongPress();
      dragAxisRef.current = 'x';
      dragStartRef.current = { clientX: rel.clientX, clientY: rel.clientY, xZoom, yZoom };
      setIsDraggingAxis(true);
      e.preventDefault();
      return;
    }

    // Y-axis drag zone
    if (rel.x < paddingLeft - 5) {
      cancelLongPress();
      dragAxisRef.current = 'y';
      dragStartRef.current = { clientX: rel.clientX, clientY: rel.clientY, xZoom, yZoom };
      setIsDraggingAxis(true);
      e.preventDefault();
      return;
    }

    // Chart area
    pointerDownPosRef.current = { x: rel.clientX, y: rel.clientY };
    longPressTriggeredRef.current = false;

    if (crosshairMode) {
      // In crosshair mode: record drag start position relative to current crosshair
      crosshairDragStartXRef.current = rel.clientX;
      crosshairDragStartIndexRef.current = activePoint ?? 0;

      // Start long-press timer to DISMISS crosshair
      cancelLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        setCrosshairMode(false);
        setActivePoint(null);
        crosshairDragStartXRef.current = null;
        try { navigator.vibrate?.(30); } catch { /* ignore */ }
      }, 500);
    } else {
      // Not in crosshair mode: long-press to ACTIVATE
      cancelLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        const svgX = getSvgX(e);
        if (svgX !== null) {
          const idx = findNearestPoint(svgX);
          if (idx !== null) {
            setCrosshairMode(true);
            setActivePoint(idx);
            try { navigator.vibrate?.(30); } catch { /* ignore */ }
          }
        }
      }, 500);
    }
  }, [xZoom, yZoom, chartHeight, paddingBottom, crosshairMode, cancelLongPress, getSvgX, findNearestPoint, getRelPos]);

  const handlePointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Pinch
    if ('touches' in e && e.touches.length === 2 && pinchStartRef.current !== null) {
      cancelLongPress();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / pinchStartRef.current;
      setXZoom(Math.max(minXZoom, pinchXZoomRef.current * scale));
      setActivePoint(null);
      return;
    }

    // Axis drag
    if (dragAxisRef.current && dragStartRef.current) {
      cancelLongPress();
      e.preventDefault();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      if (dragAxisRef.current === 'x') {
        const dx = dragStartRef.current.clientX - clientX;
        const newZoom = Math.max(minXZoom, dragStartRef.current.xZoom + dx * 0.005);
        setXZoom(newZoom);
      } else {
        const dy = clientY - dragStartRef.current.clientY;
        const newZoom = Math.max(minYZoom, dragStartRef.current.yZoom + dy * 0.008);
        setYZoom(newZoom);
      }
      setActivePoint(null);
      return;
    }

    // Cancel long press if finger moved too far
    if (pointerDownPosRef.current && !longPressTriggeredRef.current) {
      const rel = getRelPos(e);
      if (rel) {
        const dx = rel.clientX - pointerDownPosRef.current.x;
        const dy = rel.clientY - pointerDownPosRef.current.y;
        if (Math.hypot(dx, dy) > 10) {
          cancelLongPress();
        }
      }
    }

    // Crosshair mode → move crosshair by drag delta (relative, not absolute)
    if (crosshairMode && crosshairDragStartXRef.current !== null) {
      e.preventDefault();
      cancelLongPress(); // moved finger, cancel dismiss timer
      const rel = getRelPos(e);
      if (rel) {
        const dx = rel.clientX - crosshairDragStartXRef.current;
        const indexDelta = Math.round(dx / pointSpacing);
        const newIndex = Math.max(0, Math.min(sessions.length - 1, crosshairDragStartIndexRef.current + indexDelta));
        setActivePoint(newIndex);
      }
    }
  }, [crosshairMode, cancelLongPress, getSvgX, findNearestPoint, getRelPos, minXZoom, minYZoom]);

  const handlePointerUp = useCallback(() => {
    cancelLongPress();
    dragAxisRef.current = null;
    dragStartRef.current = null;
    pinchStartRef.current = null;
    pointerDownPosRef.current = null;
    crosshairDragStartXRef.current = null;
    setIsDraggingAxis(false);
  }, [cancelLongPress]);

  // Format date
  const formatDate = (dateStr: string, showYear = false) => {
    const date = new Date(dateStr);
    if (showYear) {
      return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
    }
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const getXLabelInterval = () => {
    const effectiveCount = sessions.length / xZoom;
    if (effectiveCount <= 7) return 1;
    if (effectiveCount <= 15) return 2;
    if (effectiveCount <= 30) return 4;
    return Math.ceil(effectiveCount / 8);
  };
  const xLabelInterval = getXLabelInterval();

  const activeSession = activePoint !== null ? sessions[activePoint] : null;
  const activePointCoord = activePoint !== null ? points[activePoint] : null;
  const isZoomed = xZoom !== 1 || yZoom !== 1;

  // Scroll is locked when crosshair is active or axis is being dragged
  const scrollLocked = crosshairMode || isDraggingAxis;

  // Theme colors
  const bgColor = isDark ? '#1a1a1a' : '#ffffff';

  const gridColor = isDark ? '#2e2e2e' : '#e5e7eb';
  const labelColor = isDark ? '#71717a' : '#6b7280';
  const hintColor = isDark ? '#52525b' : '#9ca3af';
  const mutedTextColor = isDark ? '#71717a' : '#6b7280';
  const pointFillColor = isDark ? '#1a1a1a' : '#ffffff';
  const resetBgClass = isDark ? 'bg-[#252525] text-zinc-400 hover:text-white' : 'bg-gray-200 text-gray-500 hover:text-gray-900';
  const containerClass = isDark ? 'bg-[#1a1a1a] border border-[#2e2e2e]' : 'bg-white border border-gray-200';

  if (sessions.length === 0) {
    return (
      <div className={`${containerClass} rounded-xl px-2 pt-3 pb-2`}>
        <div className="text-sm font-medium mb-3">Volume Trend</div>
        <div className={`h-32 flex items-center justify-center text-sm ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
          No data yet
        </div>
      </div>
    );
  }

  return (
    <div className={`${containerClass} rounded-xl px-2 pt-3 pb-2`}>
      <div className="flex items-center justify-between mb-1 px-1">
        <div className="text-sm font-medium">Volume Trend</div>
        <div className="flex items-center gap-2">
          {crosshairMode && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">
              Crosshair
            </span>
          )}
          {isZoomed && (
            <button
              onClick={() => { setXZoom(1); setYZoom(1); scrollToEnd(); }}
              className={`text-[10px] px-2 py-0.5 rounded ${resetBgClass}`}
            >
              Reset
            </button>
          )}
          <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{sessions.length} sessions</div>
        </div>
      </div>

      <div className="relative">
        {/* Fixed Y-axis overlay */}
        <div
          className="absolute left-0 top-0 z-10 pointer-events-auto"
          style={{ width: paddingLeft, height: chartHeight }}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg width={paddingLeft} height={chartHeight} className="select-none">
            <rect x={0} y={0} width={paddingLeft} height={chartHeight} fill={bgColor} />
            {yAxisLabels.map((value, i) => {
              const y = paddingTop + graphHeight - (graphHeight * i) / labelCount;
              return (
                <text
                  key={`y-${i}`}
                  x={paddingLeft - 8}
                  y={y + 4}
                  fill={labelColor}
                  fontSize="10"
                  textAnchor="end"
                  className="select-none"
                  style={{ cursor: 'ns-resize' }}
                >
                  {value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}
                </text>
              );
            })}
            <rect x={0} y={paddingTop} width={paddingLeft} height={graphHeight} fill="transparent" style={{ cursor: 'ns-resize' }} />

            {/* Y-axis crosshair badge */}
            {crosshairMode && activePointCoord && activeSession && (
              <>
                <rect x={0} y={activePointCoord.y - 8} width={paddingLeft - 4} height={16} rx={3} fill="#f97316" fillOpacity="0.9" />
                <text x={(paddingLeft - 4) / 2} y={activePointCoord.y + 4} fill="white" fontSize="8" fontWeight="bold" textAnchor="middle" className="select-none">
                  {activeSession.volume >= 1000 ? `${(activeSession.volume / 1000).toFixed(1)}k` : Math.round(activeSession.volume)}
                </text>
              </>
            )}
          </svg>
        </div>

        {/* Scrollable chart area */}
        <div
          ref={containerRef}
          className={scrollLocked ? 'overflow-x-hidden' : 'overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]'}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg
            ref={svgRef}
            width={chartWidth}
            height={chartHeight}
            className="select-none"
          >
            <defs>
              <linearGradient id="volumeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#f97316" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {yAxisLabels.map((_, i) => {
              const y = paddingTop + (graphHeight * i) / labelCount;
              return <line key={i} x1={paddingLeft} y1={y} x2={chartWidth - paddingRight} y2={y} stroke={gridColor} strokeDasharray="4 4" />;
            })}

            {/* X-axis labels */}
            {points.map((p, i) => {
              if (i % xLabelInterval !== 0 && i !== points.length - 1) return null;
              return (
                <text key={`x-${i}`} x={p.x} y={paddingTop + graphHeight + 14} fill={labelColor} fontSize="9" textAnchor="middle" className="select-none" style={{ cursor: 'ew-resize' }}>
                  {formatDate(p.session.date)}
                </text>
              );
            })}

            {/* X-axis drag zone */}
            <rect x={paddingLeft} y={chartHeight - paddingBottom + 5} width={chartWidth - paddingLeft - paddingRight} height={paddingBottom - 5} fill="transparent" style={{ cursor: 'ew-resize' }} />

            {/* Area under line */}
            {areaPath && <path d={areaPath} fill="url(#volumeGradient)" />}

            {/* Line */}
            <path d={linePath} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

            {/* Data points */}
            {points.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={16} fill="transparent" />
                <circle
                  cx={p.x} cy={p.y}
                  r={activePoint === i ? 6 : 3.5}
                  fill={activePoint === i ? '#f97316' : pointFillColor}
                  stroke="#f97316"
                  strokeWidth={activePoint === i ? 2.5 : 1.5}
                />
              </g>
            ))}

            {/* Crosshair */}
            {crosshairMode && activePoint !== null && activePointCoord && activeSession && (
              <>
                {/* Vertical line */}
                <line x1={activePointCoord.x} y1={paddingTop} x2={activePointCoord.x} y2={paddingTop + graphHeight} stroke="#a3a3a3" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.5" />
                {/* Horizontal line */}
                <line x1={paddingLeft} y1={activePointCoord.y} x2={chartWidth - paddingRight} y2={activePointCoord.y} stroke="#a3a3a3" strokeWidth="1" strokeDasharray="3 3" strokeOpacity="0.5" />
                {/* X-axis date badge */}
                <rect x={activePointCoord.x - 30} y={paddingTop + graphHeight + 2} width={60} height={14} rx={3} fill="#f97316" fillOpacity="0.9" />
                <text x={activePointCoord.x} y={paddingTop + graphHeight + 12} fill="white" fontSize="8" fontWeight="bold" textAnchor="middle" className="select-none">
                  {formatDate(activeSession.date, true)}
                </text>
                {/* Glow dot */}
                <circle cx={activePointCoord.x} cy={activePointCoord.y} r={8} fill="#f97316" fillOpacity="0.2" />
              </>
            )}
          </svg>
        </div>

        {/* Hint text */}
        <div className="flex items-center justify-between mt-1 px-1">
          <div className="text-[10px]" style={{ color: hintColor }}>
            {crosshairMode ? 'Hold to dismiss crosshair' : 'Hold to inspect · Drag axes to scale'}
          </div>
          {isZoomed && (
            <div className="text-[10px]" style={{ color: mutedTextColor }}>
              X: {Math.round(xZoom * 100)}% · Y: {Math.round(yZoom * 100)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
