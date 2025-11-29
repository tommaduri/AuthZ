'use client';

import { useEffect, useState } from 'react';

export default function LiveMetrics() {
  const [metrics, setMetrics] = useState({
    cpu: 0,
    memory: 0,
    network: 0,
    activeConnections: 0,
  });

  useEffect(() => {
    // Simulate live metrics (replace with actual WebSocket connection)
    const interval = setInterval(() => {
      setMetrics({
        cpu: Math.random() * 100,
        memory: 30 + Math.random() * 40,
        network: Math.random() * 1000,
        activeConnections: Math.floor(Math.random() * 50) + 10,
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="card-glass rounded-xl p-6 mb-12">
      <h2 className="text-xl font-semibold mb-4">System Health</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricBar label="CPU Usage" value={metrics.cpu} max={100} unit="%" color="blue" />
        <MetricBar label="Memory" value={metrics.memory} max={100} unit="%" color="green" />
        <MetricBar label="Network" value={metrics.network} max={1000} unit="KB/s" color="purple" />
        <MetricBar label="Connections" value={metrics.activeConnections} max={100} unit="" color="orange" />
      </div>
    </div>
  );
}

interface MetricBarProps {
  label: string;
  value: number;
  max: number;
  unit: string;
  color: string;
}

function MetricBar({ label, value, max, unit, color }: MetricBarProps) {
  const percentage = (value / max) * 100;
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
  };

  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm text-gray-400">{label}</span>
        <span className="text-sm font-semibold">
          {value.toFixed(1)}{unit}
        </span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div
          className={`h-2 rounded-full ${colorMap[color]} transition-all duration-500`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}
