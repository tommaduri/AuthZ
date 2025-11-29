'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface Vertex {
  id: string;
  timestamp: number;
  parents?: string[];
  confirmed?: boolean;
  data?: any;
}

interface DAGVisualizationProps {
  vertices: Vertex[];
  onVertexClick?: (vertex: Vertex) => void;
}

export default function DAGVisualization({ vertices, onVertexClick }: DAGVisualizationProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || vertices.length === 0) return;

    const width = 800;
    const height = 600;

    // Clear previous render
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    // Create graph data
    const nodes = vertices.map(v => ({
      id: v.id,
      ...v,
    }));

    const links: any[] = [];
    vertices.forEach(vertex => {
      if (vertex.parents) {
        vertex.parents.forEach(parentId => {
          links.push({
            source: parentId,
            target: vertex.id,
          });
        });
      }
    });

    // Create force simulation
    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Create links
    const link = svg.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('class', 'dag-link')
      .attr('stroke', '#4b5563')
      .attr('stroke-width', 2);

    // Create nodes
    const node = svg.append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('class', 'dag-node')
      .attr('r', 12)
      .attr('fill', (d: any) => {
        if (d.parents?.length === 0) return '#3b82f6'; // Blue for genesis
        if (d.confirmed) return '#8b5cf6'; // Purple for confirmed
        return '#10b981'; // Green for transactions
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .on('click', (event, d) => {
        event.stopPropagation();
        if (onVertexClick) onVertexClick(d as Vertex);
      })
      .call(d3.drag<any, any>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended) as any);

    // Add labels
    const labels = svg.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text((d: any) => d.id.slice(0, 6))
      .attr('font-size', 10)
      .attr('fill', '#9ca3af')
      .attr('text-anchor', 'middle')
      .attr('dy', 25);

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y);

      labels
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);
    });

    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    return () => {
      simulation.stop();
    };
  }, [vertices, onVertexClick]);

  return (
    <div className="bg-gray-900 rounded-lg overflow-hidden">
      {vertices.length === 0 ? (
        <div className="flex items-center justify-center h-[600px] text-gray-500">
          <div className="text-center">
            <div className="text-4xl mb-4">🕸️</div>
            <p>No vertices yet. Create a transaction to see the DAG.</p>
          </div>
        </div>
      ) : (
        <svg ref={svgRef} className="w-full" />
      )}
    </div>
  );
}
