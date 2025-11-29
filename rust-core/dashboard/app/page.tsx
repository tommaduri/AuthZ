'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import MetricsCard from '@/components/MetricsCard';
import LiveMetrics from '@/components/LiveMetrics';

export default function Home() {
  const [apiStatus, setApiStatus] = useState<'loading' | 'online' | 'offline'>('loading');
  const [stats, setStats] = useState({
    totalVertices: 0,
    totalTransactions: 0,
    avgLatency: 0,
    tps: 0,
  });

  useEffect(() => {
    // Check API health
    fetch('http://localhost:8080/health')
      .then(res => res.ok ? setApiStatus('online') : setApiStatus('offline'))
      .catch(() => setApiStatus('offline'));

    // Fetch initial stats
    const fetchStats = async () => {
      try {
        const response = await fetch('http://localhost:8080/api/v1/dag/info');
        if (response.ok) {
          const data = await response.json();
          setStats({
            totalVertices: data.total_vertices || 0,
            totalTransactions: data.total_transactions || 0,
            avgLatency: data.avg_latency || 0,
            tps: data.tps || 0,
          });
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary-500 to-quantum-500 bg-clip-text text-transparent">
          Phase 5: Quantum-Resistant DAG Platform
        </h1>
        <p className="text-xl text-gray-400 mb-6">
          Real-time distributed ledger with post-quantum cryptography
        </p>

        {/* API Status */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full card-glass">
          <div className={`w-3 h-3 rounded-full ${
            apiStatus === 'online' ? 'bg-green-500 animate-pulse-slow' :
            apiStatus === 'offline' ? 'bg-red-500' : 'bg-yellow-500'
          }`} />
          <span className="text-sm">
            API Status: {apiStatus === 'loading' ? 'Checking...' : apiStatus.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Live Metrics */}
      <LiveMetrics />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <MetricsCard
          title="Total Vertices"
          value={stats.totalVertices.toLocaleString()}
          icon="📊"
          trend="+12%"
        />
        <MetricsCard
          title="Transactions"
          value={stats.totalTransactions.toLocaleString()}
          icon="🔄"
          trend="+8%"
        />
        <MetricsCard
          title="Avg Latency"
          value={`${stats.avgLatency.toFixed(2)}ms`}
          icon="⚡"
          trend="-5%"
        />
        <MetricsCard
          title="TPS"
          value={stats.tps.toFixed(1)}
          icon="📈"
          trend="+15%"
        />
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <FeatureCard
          title="DAG Visualization"
          description="Real-time force-directed graph showing vertex relationships"
          icon="🕸️"
          href="/dag"
          color="from-blue-600 to-cyan-600"
        />
        <FeatureCard
          title="Crypto Operations"
          description="Quantum-resistant encryption and decryption demos"
          icon="🔐"
          href="/crypto"
          color="from-purple-600 to-pink-600"
        />
        <FeatureCard
          title="Vault Manager"
          description="Secure secret storage with post-quantum protection"
          icon="🔑"
          href="/vault"
          color="from-green-600 to-emerald-600"
        />
        <FeatureCard
          title="Performance Metrics"
          description="Detailed charts and analytics dashboard"
          icon="📊"
          href="/metrics"
          color="from-orange-600 to-red-600"
        />
      </div>

      {/* Quick Start Guide */}
      <div className="mt-12 card-glass rounded-xl p-6">
        <h2 className="text-2xl font-bold mb-4">Quick Start Guide</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-gray-800 rounded-lg">
            <div className="text-3xl mb-2">1️⃣</div>
            <h3 className="font-semibold mb-2">Visualize DAG</h3>
            <p className="text-sm text-gray-400">
              See your distributed ledger in real-time with interactive force graphs
            </p>
          </div>
          <div className="p-4 bg-gray-800 rounded-lg">
            <div className="text-3xl mb-2">2️⃣</div>
            <h3 className="font-semibold mb-2">Test Crypto</h3>
            <p className="text-sm text-gray-400">
              Encrypt and decrypt data using quantum-resistant algorithms
            </p>
          </div>
          <div className="p-4 bg-gray-800 rounded-lg">
            <div className="text-3xl mb-2">3️⃣</div>
            <h3 className="font-semibold mb-2">Monitor Performance</h3>
            <p className="text-sm text-gray-400">
              Track TPS, latency, and system health with live dashboards
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FeatureCardProps {
  title: string;
  description: string;
  icon: string;
  href: string;
  color: string;
}

function FeatureCard({ title, description, icon, href, color }: FeatureCardProps) {
  return (
    <Link href={href}>
      <div className="card-glass rounded-xl p-6 hover:scale-105 transition-transform duration-300 cursor-pointer h-full">
        <div className={`w-12 h-12 rounded-lg bg-gradient-to-r ${color} flex items-center justify-center text-2xl mb-4`}>
          {icon}
        </div>
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        <p className="text-gray-400 text-sm">{description}</p>
        <div className="mt-4 text-primary-500 text-sm font-semibold flex items-center gap-2">
          Explore <span>→</span>
        </div>
      </div>
    </Link>
  );
}
