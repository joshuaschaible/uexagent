"use client";

import { useState } from "react";
import { SYSTEM_LAYOUTS, type MapNode } from "@/lib/map-data";

type RouteInfo = {
  from: string;
  to: string;
  profit: number;
  commodity: string;
};

type SystemMapProps = {
  system: string;
  routes: RouteInfo[];
  highlights: string[];
};

function getNodeColor(type: MapNode["type"], isDark: boolean): string {
  switch (type) {
    case "star":
      return isDark ? "#fbbf24" : "#f59e0b";
    case "planet":
      return isDark ? "#60a5fa" : "#3b82f6";
    case "moon":
      return isDark ? "#94a3b8" : "#64748b";
    case "station":
      return isDark ? "#a78bfa" : "#8b5cf6";
    case "city":
      return isDark ? "#34d399" : "#10b981";
    default:
      return isDark ? "#94a3b8" : "#64748b";
  }
}

function getGlowColor(type: MapNode["type"]): string {
  switch (type) {
    case "star":
      return "#fbbf24";
    case "planet":
      return "#60a5fa";
    case "station":
      return "#a78bfa";
    case "city":
      return "#34d399";
    default:
      return "#94a3b8";
  }
}

export function SystemMap({ system, routes, highlights }: SystemMapProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const layout = SYSTEM_LAYOUTS[system.toLowerCase()];

  if (!layout) {
    return (
      <div className="mt-3 rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Map not available for {system} system.
      </div>
    );
  }

  const { nodes, width, height } = layout;

  // Find nodes that match route endpoints
  function findNodeForRoute(name: string): MapNode | undefined {
    const lower = name.toLowerCase();
    return nodes.find(
      (n) =>
        lower.includes(n.name.toLowerCase()) ||
        n.name.toLowerCase().includes(lower)
    );
  }

  // Determine if dark mode
  const isDark = typeof document !== "undefined"
    ? document.documentElement.classList.contains("dark")
    : true;

  const bgColor = isDark ? "#0f172a" : "#f8fafc";
  const gridColor = isDark ? "rgba(148,163,184,0.08)" : "rgba(100,116,139,0.08)";
  const textColor = isDark ? "#e2e8f0" : "#1e293b";
  const mutedText = isDark ? "#64748b" : "#94a3b8";
  const routeColor = "#f97316";

  return (
    <div className="mt-3 rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border/50 bg-muted/30">
        <p className="text-xs font-medium text-muted-foreground">
          {layout.name} System Map
        </p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ maxHeight: "400px", background: bgColor }}
      >
        <defs>
          {/* Star glow */}
          <radialGradient id="star-glow">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.6" />
            <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </radialGradient>

          {/* Route arrow marker */}
          <marker
            id="route-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={routeColor} />
          </marker>

          {/* Animated dash */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {Array.from({ length: 9 }).map((_, i) => (
          <line
            key={`grid-v-${i}`}
            x1={(i + 1) * (width / 10)}
            y1={0}
            x2={(i + 1) * (width / 10)}
            y2={height}
            stroke={gridColor}
            strokeWidth="1"
          />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <line
            key={`grid-h-${i}`}
            x1={0}
            y1={(i + 1) * (height / 7)}
            x2={width}
            y2={(i + 1) * (height / 7)}
            stroke={gridColor}
            strokeWidth="1"
          />
        ))}

        {/* Orbit paths for planets */}
        {nodes
          .filter((n) => n.type === "planet" && n.orbitRadius)
          .map((planet) => {
            const star = nodes.find((n) => n.type === "star");
            if (!star) return null;
            return (
              <circle
                key={`orbit-${planet.id}`}
                cx={star.x}
                cy={star.y}
                r={planet.orbitRadius}
                fill="none"
                stroke={isDark ? "rgba(148,163,184,0.1)" : "rgba(100,116,139,0.1)"}
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            );
          })}

        {/* Trade routes */}
        {routes.map((route, i) => {
          const fromNode = findNodeForRoute(route.from);
          const toNode = findNodeForRoute(route.to);
          if (!fromNode || !toNode) return null;

          return (
            <g key={`route-${i}`}>
              <line
                x1={fromNode.x}
                y1={fromNode.y}
                x2={toNode.x}
                y2={toNode.y}
                stroke={routeColor}
                strokeWidth="2"
                strokeDasharray="6 3"
                markerEnd="url(#route-arrow)"
                opacity="0.8"
              >
                <animate
                  attributeName="stroke-dashoffset"
                  from="18"
                  to="0"
                  dur="1s"
                  repeatCount="indefinite"
                />
              </line>
              {/* Profit label at midpoint */}
              <text
                x={(fromNode.x + toNode.x) / 2}
                y={(fromNode.y + toNode.y) / 2 - 8}
                textAnchor="middle"
                fontSize="9"
                fontWeight="600"
                fill={routeColor}
              >
                {route.commodity}: +{route.profit.toLocaleString()}/SCU
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isHighlighted = highlights.some(
            (h) =>
              h.toLowerCase().includes(node.name.toLowerCase()) ||
              node.name.toLowerCase().includes(h.toLowerCase())
          );
          const isHovered = hoveredNode === node.id;
          const color = getNodeColor(node.type, isDark);

          return (
            <g
              key={node.id}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Glow effect for star */}
              {node.type === "star" && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius * 2.5}
                  fill="url(#star-glow)"
                />
              )}

              {/* Highlight ring */}
              {(isHighlighted || isHovered) && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius + 4}
                  fill="none"
                  stroke={getGlowColor(node.type)}
                  strokeWidth="1.5"
                  opacity="0.6"
                  filter="url(#glow)"
                />
              )}

              {/* Node shape */}
              {node.type === "station" ? (
                // Diamond for stations
                <rect
                  x={node.x - node.radius}
                  y={node.y - node.radius}
                  width={node.radius * 2}
                  height={node.radius * 2}
                  fill={color}
                  transform={`rotate(45 ${node.x} ${node.y})`}
                  opacity={isHighlighted || isHovered ? 1 : 0.8}
                />
              ) : (
                // Circle for everything else
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  fill={color}
                  opacity={isHighlighted || isHovered ? 1 : 0.8}
                />
              )}

              {/* Label */}
              {(node.type === "planet" ||
                node.type === "star" ||
                isHovered ||
                isHighlighted) && (
                <text
                  x={node.x}
                  y={node.y + node.radius + 12}
                  textAnchor="middle"
                  fontSize={node.type === "star" ? "11" : "9"}
                  fontWeight={node.type === "star" ? "700" : "500"}
                  fill={isHighlighted || isHovered ? textColor : mutedText}
                >
                  {node.name}
                </text>
              )}
            </g>
          );
        })}

        {/* Hover tooltip */}
        {hoveredNode && (() => {
          const node = nodes.find((n) => n.id === hoveredNode);
          if (!node) return null;
          const label = `${node.name} (${node.type})`;
          return (
            <g>
              <rect
                x={node.x - label.length * 3.5}
                y={node.y - node.radius - 22}
                width={label.length * 7}
                height={16}
                rx="4"
                fill={isDark ? "#1e293b" : "#ffffff"}
                stroke={isDark ? "#334155" : "#e2e8f0"}
                strokeWidth="1"
              />
              <text
                x={node.x}
                y={node.y - node.radius - 10}
                textAnchor="middle"
                fontSize="9"
                fill={textColor}
              >
                {label}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
