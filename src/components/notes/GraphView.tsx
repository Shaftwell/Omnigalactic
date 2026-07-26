import React, { useEffect, useRef } from 'react';

export interface GraphNode {
  id: string;
  title: string;
  hasTags: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
}

interface GraphViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onSelect: (id: string) => void;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

/**
 * Dependency-free force-directed graph (Obsidian-style): repulsion between
 * all nodes, springs along links, gentle centering. Supports hover, click,
 * and dragging nodes.
 */
export default function GraphView({ nodes, links, onSelect }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const idToIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const edges = links
      .map(l => ({ a: idToIndex.get(l.source), b: idToIndex.get(l.target) }))
      .filter((e): e is { a: number; b: number } => e.a !== undefined && e.b !== undefined && e.a !== e.b);

    const sim: SimNode[] = nodes.map((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const r = 80 + (i % 5) * 30;
      return { ...n, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0, degree: 0 };
    });
    for (const e of edges) {
      sim[e.a].degree++;
      sim[e.b].degree++;
    }

    let width = 0;
    let height = 0;
    let alpha = 1;
    let hovered = -1;
    let dragging = -1;
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const radius = (n: SimNode) => 3 + Math.min(7, n.degree * 1.4);

    const tick = () => {
      if (alpha > 0.005) {
        // Repulsion (fine for a personal-sized vault)
        for (let i = 0; i < sim.length; i++) {
          for (let j = i + 1; j < sim.length; j++) {
            const a = sim[i];
            const b = sim[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
            const f = (1200 / d2) * alpha;
            const d = Math.sqrt(d2);
            a.vx += (dx / d) * f; a.vy += (dy / d) * f;
            b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
          }
        }
        // Springs
        for (const e of edges) {
          const a = sim[e.a];
          const b = sim[e.b];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const f = (d - 90) * 0.01 * alpha;
          a.vx += (dx / d) * f; a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
        }
        // Centering + integrate
        for (let i = 0; i < sim.length; i++) {
          const n = sim[i];
          n.vx -= n.x * 0.003 * alpha;
          n.vy -= n.y * 0.003 * alpha;
          if (i !== dragging) {
            n.vx *= 0.85; n.vy *= 0.85;
            n.x += n.vx; n.y += n.vy;
          }
        }
        alpha *= 0.995;
      }

      // Draw
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
      ctx.lineWidth = 1;
      for (const e of edges) {
        const a = sim[e.a];
        const b = sim[e.b];
        const active = hovered === e.a || hovered === e.b;
        ctx.strokeStyle = active ? 'rgba(129, 140, 248, 0.5)' : 'rgba(148, 163, 184, 0.18)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (let i = 0; i < sim.length; i++) {
        const n = sim[i];
        const r = radius(n);
        const isHover = i === hovered;
        ctx.beginPath();
        ctx.arc(n.x, n.y, isHover ? r + 2 : r, 0, Math.PI * 2);
        ctx.fillStyle = isHover ? '#a5b4fc' : n.hasTags ? '#34d399' : '#cbd5e1';
        ctx.fill();
        if (isHover) {
          ctx.strokeStyle = 'rgba(165, 180, 252, 0.4)';
          ctx.lineWidth = 4;
          ctx.stroke();
        }

        const showLabel = isHover || sim.length <= 40 || n.degree >= 2;
        if (showLabel) {
          ctx.font = `${isHover ? '600 ' : ''}10px system-ui, sans-serif`;
          ctx.fillStyle = isHover ? '#e2e8f0' : 'rgba(148, 163, 184, 0.7)';
          ctx.textAlign = 'center';
          ctx.fillText(n.title.length > 24 ? `${n.title.slice(0, 23)}…` : n.title, n.x, n.y + r + 12);
        }
      }
      ctx.restore();

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const toLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left - width / 2, y: e.clientY - rect.top - height / 2 };
    };

    const hitTest = (x: number, y: number) => {
      for (let i = sim.length - 1; i >= 0; i--) {
        const n = sim[i];
        const r = radius(n) + 6;
        if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return i;
      }
      return -1;
    };

    let downAt: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      const p = toLocal(e);
      const hit = hitTest(p.x, p.y);
      if (hit >= 0) {
        dragging = hit;
        downAt = p;
        canvas.setPointerCapture(e.pointerId);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      const p = toLocal(e);
      if (dragging >= 0) {
        sim[dragging].x = p.x;
        sim[dragging].y = p.y;
        alpha = Math.max(alpha, 0.3);
      } else {
        hovered = hitTest(p.x, p.y);
        canvas.style.cursor = hovered >= 0 ? 'pointer' : 'default';
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (dragging >= 0 && downAt) {
        const p = toLocal(e);
        const moved = (p.x - downAt.x) ** 2 + (p.y - downAt.y) ** 2;
        if (moved < 16) onSelectRef.current(sim[dragging].id);
      }
      dragging = -1;
      downAt = null;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [nodes, links]);

  return <canvas ref={canvasRef} className="w-full h-full touch-none" />;
}
