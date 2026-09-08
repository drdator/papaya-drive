'use client';

import { useEffect, useRef, useState } from 'react';
import { createGame, type GameControls, type GameStatus } from './game';

const initial: GameStatus = {
  ready: false,
  speed: 0,
  gate: 0,
  lap: 1,
  time: 0,
  best: null,
  paused: false,
  error: null,
  started: false,
  airborne: false,
  skidding: false,
  damage: 0,
  muted: false,
  flooded: false,
};
function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

export default function Home() {
  const viewport = useRef<HTMLDivElement>(null);
  const game = useRef<GameControls | null>(null);
  const [status, setStatus] = useState(initial);
  const wrecked = status.damage >= 100 || status.flooded;
  useEffect(() => {
    if (!viewport.current) return;
    game.current = createGame(viewport.current, setStatus);
    return () => {
      game.current?.dispose();
      game.current = null;
    };
  }, []);
  return (
    <main className="game" aria-label="Papaya Drive car game">
      <div ref={viewport} className="viewport" />
      <div className="hud">
        <div className="topbar">
          <div className="route">
            <div className="eyebrow">Ridge trail · Lap {status.lap}</div>
            <div className="route-title">
              <span>Checkpoints</span>
              <strong>{status.gate} / 8</strong>
            </div>
            <div className="dots" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <span
                  key={i}
                  className={
                    i < status.gate
                      ? 'done'
                      : i === status.gate
                        ? 'current'
                        : ''
                  }
                />
              ))}
            </div>
            <div className="timing">
              <span>{timeLabel(status.time)}</span>
              <span>
                Best {status.best === null ? '—' : timeLabel(status.best)}
              </span>
            </div>
          </div>
        </div>
        {!status.ready && (
          <output className="message">
            <h1>
              {status.error
                ? 'Couldn’t start the drive'
                : 'Packing the picnic…'}
            </h1>
            <p>{status.error ?? 'Loading your car and the forest.'}</p>
            {status.error && (
              <button onClick={() => location.reload()}>Try again</button>
            )}
          </output>
        )}
        {status.ready && wrecked && (
          <output className="message wreck-message">
            <h1>{status.flooded ? 'Engine flooded.' : 'Car wrecked.'}</h1>
            <p>
              {status.flooded
                ? 'The water reached the engine. Restart to get back on the island.'
                : 'Too much damage to keep driving.'}
            </p>
            <button onClick={() => game.current?.reset()}>
              {status.flooded ? 'Restart on shore' : 'Repair & restart'}
            </button>
          </output>
        )}
        {status.ready && status.paused && !wrecked && (
          <div className="message">
            <h1>Taking the scenic pause.</h1>
            <p>The forest can wait.</p>
            <button onClick={() => game.current?.togglePause()}>
              Back to driving
            </button>
            <a
              className="audio-credits"
              href="/audio/credits.html"
              target="_blank"
              rel="noreferrer"
            >
              Audio credits
            </a>
          </div>
        )}
        {status.ready && !status.started && !status.paused && (
          <div className="hint">
            Follow the golden arches. Carry speed over the crests.
          </div>
        )}
        <div className="bottom-bar">
          <div>
            <div className="speed">
              <strong>
                {Math.round(Math.abs(status.speed) * 3.6)
                  .toString()
                  .padStart(2, '0')}
              </strong>
              <span>KM/H</span>
            </div>
            <div className="gear">
              {wrecked
                ? status.flooded
                  ? 'FLOODED'
                  : 'WRECKED'
                : status.airborne
                  ? '↗ AIRBORNE'
                  : status.skidding
                    ? '↝ SKIDDING'
                    : status.speed < -0.2
                      ? 'R · REVERSE'
                      : ''}
            </div>
            <div className="damage">
              <div className="damage-label">
                <label htmlFor="car-damage">Damage</label>
                <span>{Math.floor(status.damage)}%</span>
              </div>
              <meter
                id="car-damage"
                min={0}
                max={100}
                low={40}
                high={75}
                optimum={0}
                value={status.damage}
              />
            </div>
          </div>
          <div>
            <div className="actions">
              <button
                onClick={() => game.current?.toggleMute()}
                aria-label={status.muted ? 'Unmute sound' : 'Mute sound'}
                aria-pressed={status.muted}
              >
                {status.muted ? 'Sound off' : 'Sound on'}
              </button>
              <button onClick={() => game.current?.reset()}>↺ Reset car</button>
              <button onClick={() => game.current?.togglePause()}>
                {status.paused ? '▶ Resume' : 'Ⅱ Pause'}
              </button>
            </div>
          </div>
        </div>
        <div className="touch-controls">
          {[
            ['ArrowLeft', 'ArrowRight'],
            ['ArrowDown', 'ArrowUp'],
          ].map((keys, i) => (
            <div key={i}>
              {keys.map((key) => (
                <button
                  key={key}
                  aria-label={
                    {
                      ArrowLeft: 'Steer left',
                      ArrowRight: 'Steer right',
                      ArrowDown: 'Brake or reverse',
                      ArrowUp: 'Accelerate',
                    }[key]
                  }
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    game.current?.setKey(key, true);
                  }}
                  onPointerUp={() => game.current?.setKey(key, false)}
                  onPointerCancel={() => game.current?.setKey(key, false)}
                  onLostPointerCapture={() => game.current?.setKey(key, false)}
                >
                  {
                    {
                      ArrowLeft: '←',
                      ArrowRight: '→',
                      ArrowDown: '↓',
                      ArrowUp: '↑',
                    }[key]
                  }
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
