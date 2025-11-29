interface Vertex {
  id: string;
  timestamp: number;
  parents?: string[];
  confirmed?: boolean;
}

interface VertexListProps {
  vertices: Vertex[];
  onSelect: (vertex: Vertex) => void;
  selectedId?: string;
}

export default function VertexList({ vertices, onSelect, selectedId }: VertexListProps) {
  if (vertices.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        <p className="text-sm">No vertices yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {vertices.map(vertex => (
        <div
          key={vertex.id}
          onClick={() => onSelect(vertex)}
          className={`p-3 rounded-lg cursor-pointer transition-colors ${
            selectedId === vertex.id
              ? 'bg-primary-600'
              : 'bg-gray-800 hover:bg-gray-700'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-xs">{vertex.id.slice(0, 8)}...</span>
            {vertex.confirmed && (
              <span className="text-xs text-green-500">✓ Confirmed</span>
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{new Date(vertex.timestamp).toLocaleTimeString()}</span>
            <span>{vertex.parents?.length || 0} parents</span>
          </div>
        </div>
      ))}
    </div>
  );
}
