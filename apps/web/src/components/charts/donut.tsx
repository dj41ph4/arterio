'use client';

import * as React from 'react';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** Dependency-free animated donut chart. */
export function Donut({
  segments,
  size = 168,
  thickness = 18,
  centerLabel,
  centerValue,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={thickness}
        />
        {segments.map((seg, i) => {
          const length = (seg.value / total) * circumference;
          const dash = `${length} ${circumference - length}`;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              className="transition-[stroke-dashoffset] duration-700"
            >
              <title>{`${seg.label}: ${seg.value}`}</title>
            </circle>
          );
          offset += length;
          return el;
        })}
        {(centerValue || centerLabel) && (
          <g className="rotate-90" style={{ transformOrigin: 'center' }}>
            {centerValue && (
              <text
                x="50%"
                y="47%"
                textAnchor="middle"
                className="fill-foreground font-display text-xl font-semibold"
              >
                {centerValue}
              </text>
            )}
            {centerLabel && (
              <text
                x="50%"
                y="60%"
                textAnchor="middle"
                className="fill-muted-foreground text-[10px] uppercase tracking-wider"
              >
                {centerLabel}
              </text>
            )}
          </g>
        )}
      </svg>

      <ul className="flex-1 space-y-2">
        {segments.map((seg, i) => (
          <li key={i} className="flex items-center gap-2.5 text-sm">
            <span className="size-2.5 rounded-full" style={{ background: seg.color }} />
            <span className="flex-1 truncate text-muted-foreground">{seg.label}</span>
            <span className="font-medium tabular-nums">{seg.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
