'use client';

import { useState } from 'react';

export default function CryptoPage() {
  const [plaintext, setPlaintext] = useState('');
  const [ciphertext, setCiphertext] = useState('');
  const [decrypted, setDecrypted] = useState('');
  const [algorithm, setAlgorithm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleEncrypt = async () => {
    if (!plaintext.trim()) {
      setError('Please enter text to encrypt');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:8080/api/v1/crypto/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plaintext: btoa(plaintext), // Base64 encode
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setCiphertext(data.ciphertext || '');
      setAlgorithm(data.algorithm || 'Unknown');
    } catch (err: any) {
      setError(err.message || 'Encryption failed');
      console.error('Encryption error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDecrypt = async () => {
    if (!ciphertext.trim()) {
      setError('Please encrypt text first or paste ciphertext');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:8080/api/v1/crypto/decrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ciphertext: ciphertext,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const decodedText = atob(data.plaintext || ''); // Base64 decode
      setDecrypted(decodedText);
    } catch (err: any) {
      setError(err.message || 'Decryption failed');
      console.error('Decryption error:', err);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Quantum-Resistant Cryptography</h1>
        <p className="text-gray-400">
          Encrypt and decrypt data using post-quantum algorithms
        </p>
      </div>

      {/* Algorithm Info */}
      <div className="card-glass rounded-xl p-6 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 flex items-center justify-center text-2xl">
            🔐
          </div>
          <div>
            <h2 className="text-xl font-semibold">Active Algorithm</h2>
            <p className="text-gray-400">
              {algorithm || 'Kyber-768 / Dilithium-3 (NIST PQC Standards)'}
            </p>
          </div>
          <div className="ml-auto">
            <span className="px-3 py-1 bg-green-600 rounded-full text-sm">
              Quantum-Safe
            </span>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-600/20 border border-red-600 rounded-lg p-4 mb-6">
          <p className="text-red-400">⚠️ {error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Encryption Section */}
        <div className="card-glass rounded-xl p-6">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <span>🔒</span> Encrypt
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Plaintext Message
              </label>
              <textarea
                value={plaintext}
                onChange={(e) => setPlaintext(e.target.value)}
                placeholder="Enter your message here..."
                className="w-full h-40 bg-gray-800 rounded-lg p-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={loading}
              />
            </div>

            <button
              onClick={handleEncrypt}
              disabled={loading || !plaintext.trim()}
              className="w-full btn-quantum disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 spinner" />
                  Encrypting...
                </span>
              ) : (
                'Encrypt Message'
              )}
            </button>

            {ciphertext && (
              <div className="mt-4 encrypting">
                <label className="block text-sm text-gray-400 mb-2">
                  Ciphertext (Base64)
                </label>
                <div className="bg-gray-800 rounded-lg p-4 relative">
                  <pre className="text-xs text-green-400 break-all whitespace-pre-wrap font-mono">
                    {ciphertext}
                  </pre>
                  <button
                    onClick={() => copyToClipboard(ciphertext)}
                    className="absolute top-2 right-2 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Decryption Section */}
        <div className="card-glass rounded-xl p-6">
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <span>🔓</span> Decrypt
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Ciphertext (Base64)
              </label>
              <textarea
                value={ciphertext}
                onChange={(e) => setCiphertext(e.target.value)}
                placeholder="Paste ciphertext here or encrypt a message..."
                className="w-full h-40 bg-gray-800 rounded-lg p-4 text-green-400 font-mono text-xs placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                disabled={loading}
              />
            </div>

            <button
              onClick={handleDecrypt}
              disabled={loading || !ciphertext.trim()}
              className="w-full btn-quantum disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 spinner" />
                  Decrypting...
                </span>
              ) : (
                'Decrypt Message'
              )}
            </button>

            {decrypted && (
              <div className="mt-4 encrypting">
                <label className="block text-sm text-gray-400 mb-2">
                  Decrypted Message
                </label>
                <div className="bg-gray-800 rounded-lg p-4">
                  <p className="text-white break-all">{decrypted}</p>
                </div>
                {decrypted === plaintext && (
                  <div className="mt-2 text-green-500 text-sm flex items-center gap-2">
                    <span>✓</span>
                    <span>Successfully decrypted! Matches original plaintext.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <InfoCard
          title="Post-Quantum Security"
          description="Resistant to attacks from quantum computers using Shor's algorithm"
          icon="🛡️"
        />
        <InfoCard
          title="NIST Standards"
          description="Implements NIST-approved post-quantum cryptographic algorithms"
          icon="📜"
        />
        <InfoCard
          title="High Performance"
          description="Optimized Rust implementation with WebAssembly support"
          icon="⚡"
        />
      </div>

      {/* Example Use Cases */}
      <div className="mt-8 card-glass rounded-xl p-6">
        <h3 className="text-xl font-semibold mb-4">Example Use Cases</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            onClick={() => setPlaintext('Hello, quantum-safe world!')}
            className="p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors"
          >
            <h4 className="font-semibold mb-1">Simple Message</h4>
            <p className="text-sm text-gray-400">Encrypt a basic text message</p>
          </div>
          <div
            onClick={() => setPlaintext(JSON.stringify({ user: 'alice', balance: 1000 }, null, 2))}
            className="p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors"
          >
            <h4 className="font-semibold mb-1">JSON Data</h4>
            <p className="text-sm text-gray-400">Encrypt structured data</p>
          </div>
          <div
            onClick={() => setPlaintext('YOUR_STRIPE_API_KEY_HERE')}
            className="p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors"
          >
            <h4 className="font-semibold mb-1">API Key</h4>
            <p className="text-sm text-gray-400">Secure sensitive credentials</p>
          </div>
          <div
            onClick={() => setPlaintext('This is a very long message that demonstrates the encryption of larger text blocks with quantum-resistant algorithms. The performance remains excellent even with increased payload size.')}
            className="p-4 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors"
          >
            <h4 className="font-semibold mb-1">Long Text</h4>
            <p className="text-sm text-gray-400">Test with larger payloads</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ title, description, icon }: { title: string; description: string; icon: string }) {
  return (
    <div className="card-glass rounded-lg p-4">
      <div className="text-3xl mb-2">{icon}</div>
      <h4 className="font-semibold mb-1">{title}</h4>
      <p className="text-sm text-gray-400">{description}</p>
    </div>
  );
}
