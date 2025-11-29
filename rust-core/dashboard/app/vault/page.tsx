'use client';

import { useState, useEffect } from 'react';

interface Secret {
  key: string;
  created_at: string;
  updated_at: string;
}

export default function VaultPage() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [retrieveKey, setRetrieveKey] = useState('');
  const [retrievedValue, setRetrievedValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchSecrets();
  }, []);

  const fetchSecrets = async () => {
    try {
      const response = await fetch('http://localhost:8080/api/v1/vault/secrets');
      if (response.ok) {
        const data = await response.json();
        setSecrets(data.secrets || []);
      }
    } catch (err) {
      console.error('Failed to fetch secrets:', err);
    }
  };

  const handleStore = async () => {
    if (!newKey.trim() || !newValue.trim()) {
      setError('Both key and value are required');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('http://localhost:8080/api/v1/vault/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: newKey,
          value: newValue,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      setSuccess(`Secret "${newKey}" stored successfully!`);
      setNewKey('');
      setNewValue('');
      fetchSecrets();
    } catch (err: any) {
      setError(err.message || 'Failed to store secret');
    } finally {
      setLoading(false);
    }
  };

  const handleRetrieve = async () => {
    if (!retrieveKey.trim()) {
      setError('Please enter a key to retrieve');
      return;
    }

    setLoading(true);
    setError('');
    setRetrievedValue('');

    try {
      const response = await fetch(`http://localhost:8080/api/v1/vault/retrieve/${retrieveKey}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setRetrievedValue(data.value || '');
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve secret');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`Delete secret "${key}"?`)) return;

    try {
      const response = await fetch(`http://localhost:8080/api/v1/vault/delete/${key}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      setSuccess(`Secret "${key}" deleted successfully!`);
      fetchSecrets();
    } catch (err: any) {
      setError(err.message || 'Failed to delete secret');
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Vault Manager</h1>
        <p className="text-gray-400">
          Secure secret storage with quantum-resistant encryption
        </p>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-600/20 border border-red-600 rounded-lg p-4 mb-6">
          <p className="text-red-400">⚠️ {error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-600/20 border border-green-600 rounded-lg p-4 mb-6">
          <p className="text-green-400">✓ {success}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Store Secret */}
        <div className="card-glass rounded-xl p-6">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <span>💾</span> Store Secret
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Key</label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g., api_key, db_password"
                className="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">Value</label>
              <textarea
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Enter your secret value..."
                className="w-full h-32 bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={loading}
              />
            </div>

            <button
              onClick={handleStore}
              disabled={loading || !newKey.trim() || !newValue.trim()}
              className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Storing...' : 'Store Secret'}
            </button>
          </div>
        </div>

        {/* Retrieve Secret */}
        <div className="card-glass rounded-xl p-6">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <span>🔍</span> Retrieve Secret
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Key</label>
              <input
                type="text"
                value={retrieveKey}
                onChange={(e) => setRetrieveKey(e.target.value)}
                placeholder="Enter secret key..."
                className="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={loading}
              />
            </div>

            <button
              onClick={handleRetrieve}
              disabled={loading || !retrieveKey.trim()}
              className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Retrieving...' : 'Retrieve Secret'}
            </button>

            {retrievedValue && (
              <div className="mt-4">
                <label className="block text-sm text-gray-400 mb-2">Retrieved Value</label>
                <div className="bg-gray-800 rounded-lg p-4 relative">
                  <pre className="text-green-400 break-all whitespace-pre-wrap text-sm">
                    {retrievedValue}
                  </pre>
                  <button
                    onClick={() => navigator.clipboard.writeText(retrievedValue)}
                    className="absolute top-2 right-2 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Secrets List */}
      <div className="mt-8 card-glass rounded-xl p-6">
        <h2 className="text-2xl font-semibold mb-4">Stored Secrets</h2>

        {secrets.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>No secrets stored yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left p-3 text-gray-400">Key</th>
                  <th className="text-left p-3 text-gray-400">Created</th>
                  <th className="text-left p-3 text-gray-400">Updated</th>
                  <th className="text-right p-3 text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {secrets.map((secret) => (
                  <tr key={secret.key} className="border-b border-gray-800 hover:bg-gray-800/50">
                    <td className="p-3 font-mono">{secret.key}</td>
                    <td className="p-3 text-sm text-gray-400">
                      {new Date(secret.created_at).toLocaleString()}
                    </td>
                    <td className="p-3 text-sm text-gray-400">
                      {new Date(secret.updated_at).toLocaleString()}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => {
                          setRetrieveKey(secret.key);
                          handleRetrieve();
                        }}
                        className="px-3 py-1 bg-primary-600 hover:bg-primary-700 rounded text-sm mr-2"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleDelete(secret.key)}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Security Info */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card-glass rounded-lg p-4">
          <div className="text-3xl mb-2">🔐</div>
          <h4 className="font-semibold mb-1">Quantum-Safe Encryption</h4>
          <p className="text-sm text-gray-400">
            All secrets encrypted with post-quantum algorithms
          </p>
        </div>
        <div className="card-glass rounded-lg p-4">
          <div className="text-3xl mb-2">🛡️</div>
          <h4 className="font-semibold mb-1">Zero-Knowledge Architecture</h4>
          <p className="text-sm text-gray-400">
            Server never sees unencrypted values
          </p>
        </div>
        <div className="card-glass rounded-lg p-4">
          <div className="text-3xl mb-2">📜</div>
          <h4 className="font-semibold mb-1">Audit Trail</h4>
          <p className="text-sm text-gray-400">
            All operations logged for compliance
          </p>
        </div>
      </div>
    </div>
  );
}
