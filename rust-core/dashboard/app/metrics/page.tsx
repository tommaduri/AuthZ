'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export default function MetricsPage() {
  const [tpsData, setTpsData] = useState<any[]>([]);
  const [latencyData, setLatencyData] = useState<any[]>([]);
  const [stats, setStats] = useState({
    avgTps: 0,
    maxTps: 0,
    avgLatency: 0,
    p99Latency: 0,
    totalTransactions: 0,
  });

  useEffect(() => {
    // Generate sample data (replace with real API calls)
    const generateData = () => {
      const now = Date.now();
      const newTpsData = [];
      const newLatencyData = [];

      for (let i = 29; i >= 0; i--) {
        const timestamp = new Date(now - i * 1000).toLocaleTimeString();
        newTpsData.push({
          time: timestamp,
          tps: Math.random() * 100 + 50,
        });
        newLatencyData.push({
          time: timestamp,
          p50: Math.random() * 5 + 2,
          p95: Math.random() * 10 + 5,
          p99: Math.random() * 20 + 10,
        });
      }

      setTpsData(newTpsData);
      setLatencyData(newLatencyData);

      // Calculate stats
      const avgTps = newTpsData.reduce((acc, d) => acc + d.tps, 0) / newTpsData.length;
      const maxTps = Math.max(...newTpsData.map(d => d.tps));
      const avgLatency = newLatencyData.reduce((acc, d) => acc + d.p50, 0) / newLatencyData.length;
      const p99Latency = Math.max(...newLatencyData.map(d => d.p99));

      setStats({
        avgTps,
        maxTps,
        avgLatency,
        p99Latency,
        totalTransactions: Math.floor(avgTps * 3600),
      });
    };

    generateData();
    const interval = setInterval(generateData, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Performance Metrics</h1>
        <p className="text-gray-400">
          Real-time monitoring and analytics dashboard
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <StatCard
          title="Avg TPS"
          value={stats.avgTps.toFixed(1)}
          unit="tx/s"
          color="blue"
        />
        <StatCard
          title="Max TPS"
          value={stats.maxTps.toFixed(1)}
          unit="tx/s"
          color="green"
        />
        <StatCard
          title="Avg Latency"
          value={stats.avgLatency.toFixed(2)}
          unit="ms"
          color="purple"
        />
        <StatCard
          title="P99 Latency"
          value={stats.p99Latency.toFixed(2)}
          unit="ms"
          color="orange"
        />
        <StatCard
          title="Total TX (1h)"
          value={stats.totalTransactions.toLocaleString()}
          unit=""
          color="pink"
        />
      </div>

      {/* TPS Chart */}
      <div className="card-glass rounded-xl p-6 mb-8">
        <h2 className="text-2xl font-semibold mb-4">Transactions Per Second (TPS)</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={tpsData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="time" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '8px',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="tps"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              name="TPS"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Latency Chart */}
      <div className="card-glass rounded-xl p-6 mb-8">
        <h2 className="text-2xl font-semibold mb-4">Latency Distribution</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={latencyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="time" stroke="#9ca3af" />
            <YAxis stroke="#9ca3af" />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '8px',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="p50"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              name="P50"
            />
            <Line
              type="monotone"
              dataKey="p95"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              name="P95"
            />
            <Line
              type="monotone"
              dataKey="p99"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              name="P99"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Resource Usage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-glass rounded-xl p-6">
          <h2 className="text-2xl font-semibold mb-4">System Resources</h2>
          <div className="space-y-4">
            <ResourceBar label="CPU Usage" value={45} color="blue" />
            <ResourceBar label="Memory Usage" value={62} color="green" />
            <ResourceBar label="Disk I/O" value={35} color="purple" />
            <ResourceBar label="Network Bandwidth" value={78} color="orange" />
          </div>
        </div>

        <div className="card-glass rounded-xl p-6">
          <h2 className="text-2xl font-semibold mb-4">DAG Statistics</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Total Vertices</span>
              <span className="text-2xl font-bold">12,456</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Confirmed Vertices</span>
              <span className="text-2xl font-bold">12,450</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Pending Vertices</span>
              <span className="text-2xl font-bold">6</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Avg Confirmation Time</span>
              <span className="text-2xl font-bold">2.3s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, unit, color }: any) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-600 to-cyan-600',
    green: 'from-green-600 to-emerald-600',
    purple: 'from-purple-600 to-pink-600',
    orange: 'from-orange-600 to-red-600',
    pink: 'from-pink-600 to-rose-600',
  };

  return (
    <div className="card-glass rounded-xl p-4">
      <div className={`w-8 h-8 rounded-lg bg-gradient-to-r ${colorMap[color]} mb-2`} />
      <p className="text-sm text-gray-400 mb-1">{title}</p>
      <p className="text-2xl font-bold">
        {value} <span className="text-sm text-gray-400">{unit}</span>
      </p>
    </div>
  );
}

function ResourceBar({ label, value, color }: any) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    orange: 'bg-orange-500',
  };

  return (
    <div>
      <div className="flex justify-between mb-2">
        <span className="text-gray-400">{label}</span>
        <span className="font-semibold">{value}%</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-3">
        <div
          className={`h-3 rounded-full ${colorMap[color]} transition-all duration-500`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
