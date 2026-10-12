import { useContext } from 'react';
import { LABELS } from '../scene/labels';
import { EngineCtx } from './context';

/**
 * Scientific labels live in the DOM so they stay crisp and readable. The engine positions them every frame,
 * hides them when their feature is off, when they would collide, or when they would sit under Teacher Tools.
 */
export function LabelLayer() {
  const engine = useContext(EngineCtx);
  return (
    <div className="labels passive" aria-hidden="true">
      {LABELS.map((l) => {
        const len = Math.hypot(l.dx, l.dy);
        // leader line stops a little short of the text
        const ex = l.dx - (l.dx >= 0 ? 8 : -8);
        const ey = l.dy;
        const sx = (l.dx / len) * 9;
        const sy = (l.dy / len) * 9;
        return (
          <div key={l.key} className="label" data-visible="0" ref={(el) => engine?.registerLabel(l.key, el)}>
            <svg width="1" height="1">
              <path d={`M${sx} ${sy}L${ex} ${ey}`} stroke="rgba(0,0,0,.45)" strokeWidth="3.5" strokeLinecap="round" />
              <path d={`M${sx} ${sy}L${ex} ${ey}`} stroke="#F7F7F5" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span className="dot" />
            <span
              className="txt"
              style={l.dx >= 0 ? { left: l.dx, top: l.dy } : { right: -l.dx, top: l.dy }}
            >
              {l.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
