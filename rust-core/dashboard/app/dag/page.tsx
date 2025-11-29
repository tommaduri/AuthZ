'use client';

import { useEffect, useState } from 'react';
import DAGVisualization from '@/components/DAGVisualization';
import VertexList from '@/components/VertexList';

export default function DAGPage() {
  const [vertices, setVertices] = useState<any[]>([]);
  const [selectedVertex, setSelectedVertex] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Fetch initial vertices
    fetch('http://localhost:8080/api/v1/dag/vertices')
      .then(res => res.json())
      .then(data => {
        setVertices(data.vertices || []);
      })
      .catch(err => console.error('Failed to fetch vertices:', err));

    // WebSocket connection for real-time updates
    const ws = new WebSocket('ws://localhost:8080/ws/dag');

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const vertex = JSON.parse(event.data);
        setVertices(prev => {
          // Avoid duplicates
          const exists = prev.find(v => v.id === vertex.id);
          if (exists) return prev;
          return [...prev, vertex];
        });
      } catch (err) {
        console.error('Failed to parse vertex:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold mb-2">DAG Visualization</h1>
            <p className="text-gray-400">Real-time force-directed graph of vertices and edges</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse-slow' : 'bg-red-500'}`} />
              <span className="text-sm">{isConnected ? 'Live' : 'Disconnected'}</span>
            </div>
            <div className="card-glass px-4 py-2 rounded-lg">
              <span className="text-sm text-gray-400">Vertices: </span>
              <span className="font-bold">{vertices.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* DAG Visualization */}
        <div className="lg:col-span-2">
          <div className="card-glass rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Interactive Graph</h2>
            <DAGVisualization
              vertices={vertices}
              onVertexClick={setSelectedVertex}
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Selected Vertex Details */}
          {selectedVertex && (
            <div className="card-glass rounded-xl p-6">
              <h3 className="text-lg font-semibold mb-4">Vertex Details</h3>
              <div className="space-y-3">
                <div>
                  <span className="text-sm text-gray-400">ID:</span>
                  <p className="font-mono text-sm break-all">{selectedVertex.id}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-400">Timestamp:</span>
                  <p className="text-sm">{new Date(selectedVertex.timestamp).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-400">Parents:</span>
                  <p className="text-sm">{selectedVertex.parents?.length || 0}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-400">Data Size:</span>
                  <p className="text-sm">{selectedVertex.data?.length || 0} bytes</p>
                </div>
                {selectedVertex.signature && (
                  <div>
                    <span className="text-sm text-gray-400">Signature:</span>
                    <p className="font-mono text-xs break-all text-green-500">
                      {selectedVertex.signature.slice(0, 32)}...
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Vertex List */}
          <div className="card-glass rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">Recent Vertices</h3>
            <VertexList
              vertices={vertices.slice(-10).reverse()}
              onSelect={setSelectedVertex}
              selectedId={selectedVertex?.id}
            />
          </div>

          {/* Legend */}
          <div className="card-glass rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-4">Legend</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-blue-500" />
                <span className="text-sm">Genesis Vertex</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-green-500" />
                <span className="text-sm">Transaction Vertex</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-purple-500" />
                <span className="text-sm">Confirmed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 bg-gray-500" />
                <span className="text-sm">Parent Link</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Vertices" value={vertices.length} />
        <StatCard title="Confirmed" value={vertices.filter(v => v.confirmed).length} />
        <StatCard title="Pending" value={vertices.filter(v => !v.confirmed).length} />
        <StatCard title="Avg Parents" value={(vertices.reduce((acc, v) => acc + (v.parents?.length || 0), 0) / vertices.length || 0).toFixed(1)} />
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="card-glass rounded-lg p-4">
      <p className="text-sm text-gray-400 mb-1">{title}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
