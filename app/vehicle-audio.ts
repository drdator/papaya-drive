const gearRatios = [500, 310, 210, 155];
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const engineRecordings = {
  motor: [
    1169, 1520, 2080, 2632, 3169, 3752, 4403, 4978, 5365, 5768, 6284, 6822,
  ],
  exhaust: [2258, 2708, 3298, 3848, 4498, 4858, 5443, 5934, 6422, 6876],
};

export function blendEngineRecordings(rpm: number, recordings: number[]) {
  const next = recordings.findIndex((reference) => reference > rpm);
  const upper = next < 0 ? recordings.length - 1 : Math.max(1, next);
  const lower = upper - 1;
  // Interpolate in pitch space and keep constant power across each handoff.
  const blend = clamp(
    Math.log(Math.max(1, rpm) / recordings[lower]) /
      Math.log(recordings[upper] / recordings[lower]),
    0,
    1,
  );
  return recordings.map((reference, i) => ({
    gain:
      i === lower
        ? Math.cos((blend * Math.PI) / 2)
        : i === upper
          ? Math.sin((blend * Math.PI) / 2)
          : 0,
    rate: clamp(rpm / reference, 0.72, 1.4),
  }));
}

export type VehicleSoundInput = {
  speed: number;
  throttle: number;
  grounded: boolean;
  skid: number;
  running: boolean;
  // Keep crash and splash tails audible after the engine stops.
  active?: boolean;
  musicActive?: boolean;
};

export function createEngineSoundState() {
  return { rpm: 950, gear: 0, shiftTime: 0, load: 0 };
}

export function advanceEngineSound(
  engine: ReturnType<typeof createEngineSoundState>,
  input: VehicleSoundInput,
  dt: number,
) {
  const speed = Math.abs(input.speed);
  engine.shiftTime = Math.max(0, engine.shiftTime - dt);
  if (input.speed < -0.2) engine.gear = 0;
  if (input.grounded && input.speed >= 0 && engine.shiftTime === 0) {
    const wheelRpm = speed * gearRatios[engine.gear];
    if (wheelRpm > 5600 && engine.gear < gearRatios.length - 1) {
      engine.gear++;
      engine.shiftTime = 0.18;
    } else if (wheelRpm < 2300 && engine.gear > 0) {
      engine.gear--;
      engine.shiftTime = 0.12;
    }
  }
  const throttle = engine.shiftTime > 0 ? 0 : input.throttle;
  const targetRpm = !input.running
    ? 0
    : input.grounded
      ? clamp(
          Math.max(speed * gearRatios[engine.gear], 950 + throttle * 1400),
          950,
          6400,
        )
      : 950 + throttle * 5450;
  // Revs have inertia; shifts briefly unload the engine instead of stepping pitch.
  engine.rpm +=
    (targetRpm - engine.rpm) * (1 - Math.exp(-dt * (input.grounded ? 9 : 4)));
  engine.load += (throttle - engine.load) * (1 - Math.exp(-dt * 12));
}

export function createVehicleAudio(musicTrack = 'cozy-drive.mp3') {
  const engine = createEngineSoundState();
  let context: AudioContext | undefined;
  let graph: ReturnType<typeof createGraph> | undefined;
  let loading: Promise<void> | undefined;
  let muted = false;
  let disposed = false;
  let music: HTMLAudioElement | undefined;
  let musicActive = false;
  let musicPlaying = false;
  const abort = new AbortController();
  let crashBuffer: AudioBuffer | undefined;
  let glassBuffer: AudioBuffer | undefined;
  let splashBuffer: AudioBuffer | undefined;
  let lastCrash = -Infinity;
  const impacts = new Set<AudioBufferSourceNode>();
  const chimes = new Set<OscillatorNode>();

  function createGraph(ctx: AudioContext) {
    const master = ctx.createGain();
    master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    master.connect(limiter).connect(ctx.destination);
    function voice(filterFrequency: number) {
      const source = ctx.createBufferSource();
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFrequency;
      filter.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(master);
      return { source, filter, gain };
    }
    return {
      master,
      limiter,
      motors: engineRecordings.motor.map(() => voice(5200)),
      exhausts: engineRecordings.exhaust.map(() => voice(4200)),
      tires: voice(4500),
    };
  }

  async function load(ctx: AudioContext) {
    const buffers = await Promise.all(
      [
        'skid',
        'crash',
        'glass',
        ...engineRecordings.motor.map((rpm) => `engine/eng-${rpm}`),
        ...engineRecordings.exhaust.map((rpm) => `engine/exh-${rpm}`),
      ].map(async (name) => {
        const response = await fetch(
          `${import.meta.env.BASE_URL}audio/${name}.wav`,
          {
            signal: abort.signal,
          },
        );
        if (!response.ok)
          throw new Error(`Could not load ${name} audio (${response.status})`);
        return ctx.decodeAudioData(await response.arrayBuffer());
      }),
    );
    if (disposed) return;
    graph = createGraph(ctx);
    crashBuffer = buffers[1];
    glassBuffer = buffers[2];
    graph.tires.source.buffer = buffers[0];
    graph.tires.source.start();
    const start = ctx.currentTime;
    [...graph.motors, ...graph.exhausts].forEach((voice, i) => {
      voice.source.buffer = buffers[i + 3];
      voice.source.start(start);
    });
  }

  function playMusic(playing: boolean) {
    if (!music || playing === musicPlaying) return;
    musicPlaying = playing;
    if (playing) void music.play().catch(() => {});
    else music.pause();
  }

  function unlock() {
    if (disposed || muted) return;
    try {
      context ??= new AudioContext();
      if (!music) {
        // Stream the song instead of decoding the entire track into memory.
        music = new Audio(`${import.meta.env.BASE_URL}audio/${musicTrack}`);
        music.loop = true;
        music.volume = 0.32;
      }
      // Retry from a user gesture if the browser blocked an earlier play request.
      if (music.paused) musicPlaying = false;
      playMusic(musicActive);
      // Called directly from keyboard/pointer input to satisfy autoplay rules.
      if (context.state !== 'running') void context.resume().catch(() => {});
      loading ??= load(context).catch((error: unknown) => {
        if (!disposed) console.warn('Vehicle audio could not load', error);
        loading = undefined;
      });
    } catch (error) {
      console.warn('Vehicle audio is unavailable', error);
    }
  }

  function silence() {
    playMusic(false);
    for (const oscillator of chimes) oscillator.stop();
    chimes.clear();
    for (const source of impacts) source.stop();
    impacts.clear();
    if (graph && context) {
      // Silence immediately on blur, even if the browser stops animation frames.
      graph.master.gain.cancelScheduledValues(context.currentTime);
      graph.master.gain.setTargetAtTime(0, context.currentTime, 0.015);
    }
  }

  return {
    unlock,
    silence,
    reset() {
      Object.assign(engine, createEngineSoundState());
      silence();
      lastCrash = -Infinity;
    },
    setMuted(value: boolean) {
      muted = value;
      if (muted) silence();
      else unlock();
    },
    checkpoint() {
      if (
        !graph ||
        !context ||
        muted ||
        disposed ||
        context.state !== 'running'
      )
        return;
      // A short rising two-note chime, distinct from the engine and crash sounds.
      const now = context.currentTime;
      [659.25, 987.77].forEach((frequency, i) => {
        if (!context || !graph) return;
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        const gain = context.createGain();
        const start = now + i * 0.085;
        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.3, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
        oscillator.connect(gain).connect(graph.master);
        chimes.add(oscillator);
        oscillator.onended = () => {
          chimes.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + 0.4);
      });
    },
    splash(strength: number) {
      if (
        !graph ||
        !context ||
        muted ||
        disposed ||
        context.state !== 'running'
      )
        return;
      if (impacts.size >= 12) return;
      if (!splashBuffer) {
        // A soft rush of water with a few rounded droplets, generated once locally.
        const rate = context.sampleRate;
        splashBuffer = context.createBuffer(1, Math.ceil(rate * 0.7), rate);
        const samples = splashBuffer.getChannelData(0);
        let low = 0;
        for (let i = 0; i < samples.length; i++) {
          const noise = Math.random() * 2 - 1;
          low += (noise - low) * 0.12;
          samples[i] = low * 1.6 + noise * 0.16;
        }
        for (let drop = 0; drop < 7; drop++) {
          const start = Math.floor((0.04 + Math.random() * 0.32) * rate);
          const frequency = 350 + Math.random() * 650;
          for (let i = 0; i < rate * 0.13 && start + i < samples.length; i++) {
            const t = i / rate;
            samples[start + i] +=
              0.18 *
              Math.sin(2 * Math.PI * frequency * (t + 3 * t * t)) *
              Math.exp(-t * 40) *
              Math.min(1, t / 0.004);
          }
        }
      }
      const now = context.currentTime;
      const intensity = clamp(strength, 0, 1);
      const source = context.createBufferSource();
      source.buffer = splashBuffer;
      source.playbackRate.value = 1.1 - intensity * 0.2 + Math.random() * 0.08;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      filter.frequency.setValueAtTime(2800 + intensity * 1400, now);
      filter.frequency.exponentialRampToValueAtTime(650, now + 0.6);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.16 + intensity * 0.22, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
      source.connect(filter).connect(gain).connect(graph.master);
      impacts.add(source);
      source.onended = () => {
        impacts.delete(source);
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
      source.start();
      source.stop(now + 0.7);
    },
    crash(speed: number, brokenGlass: boolean, pan: number) {
      if (
        !graph ||
        !context ||
        muted ||
        disposed ||
        context.state !== 'running'
      )
        return;
      const now = context.currentTime;
      if (now - lastCrash < 0.1 || impacts.size >= 12) return;
      lastCrash = now;
      const severity = clamp((speed - 1.5) / 22, 0, 1);
      const play = (
        buffer: AudioBuffer | undefined,
        volume: number,
        rate: number,
        cutoff: number,
      ) => {
        if (!buffer || !context || !graph) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = rate;
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoff;
        const gain = context.createGain();
        gain.gain.value = volume;
        const panner = context.createStereoPanner();
        panner.pan.value = clamp(pan, -0.7, 0.7);
        source
          .connect(filter)
          .connect(gain)
          .connect(panner)
          .connect(graph.master);
        impacts.add(source);
        source.onended = () => {
          impacts.delete(source);
          source.disconnect();
          filter.disconnect();
          gain.disconnect();
          panner.disconnect();
        };
        source.start();
      };
      play(
        crashBuffer,
        0.25 + severity * 1.05,
        1.12 - severity * 0.3 + Math.random() * 0.06,
        1200 + severity * 6500,
      );
      if (brokenGlass)
        play(
          glassBuffer,
          0.25 + severity * 0.35,
          0.9 + Math.random() * 0.18,
          9000,
        );
    },
    update(input: VehicleSoundInput, dt: number) {
      advanceEngineSound(engine, input, dt);
      musicActive =
        (input.musicActive ?? input.active ?? input.running) &&
        !muted &&
        !disposed;
      playMusic(musicActive);
      if (!graph || !context || context.state !== 'running') return;
      const now = context.currentTime;
      const smooth = (param: AudioParam, value: number, seconds = 0.06) => {
        param.setTargetAtTime(value, now, seconds);
      };
      smooth(
        graph.master.gain,
        (input.active ?? input.running) && !muted ? 0.65 : 0,
        0.025,
      );
      const volume = input.running ? 0.13 + engine.load * 0.195 : 0;
      // Load changes the recording mix, including a brief exhaust dip on shifts.
      // Below 1400 RPM, the idle recording carries the engine on its own.
      const exhaustBlend =
        engine.load * clamp((engine.rpm - 1400) / 1000, 0, 1);
      const layers = [
        {
          voices: graph.motors,
          mix: blendEngineRecordings(engine.rpm, engineRecordings.motor),
          gain: Math.cos((exhaustBlend * Math.PI) / 3),
          cutoff: 3400 + engine.load * 1800,
        },
        {
          voices: graph.exhausts,
          mix: blendEngineRecordings(
            Math.max(2258, engine.rpm),
            engineRecordings.exhaust,
          ),
          gain: Math.sin((exhaustBlend * Math.PI) / 3),
          cutoff: 2200 + engine.load * 2000,
        },
      ];
      for (const layer of layers) {
        layer.voices.forEach((voice, i) => {
          smooth(voice.source.playbackRate, layer.mix[i].rate);
          smooth(voice.gain.gain, layer.mix[i].gain * layer.gain * volume);
          smooth(voice.filter.frequency, layer.cutoff);
        });
      }
      const skid =
        input.grounded && input.running ? clamp(input.skid, 0, 1) : 0;
      smooth(graph.tires.gain.gain, skid * 0.36, skid > 0 ? 0.035 : 0.06);
      smooth(graph.tires.source.playbackRate, 0.86 + skid * 0.23);
      smooth(graph.tires.filter.frequency, 2400 + skid * 3000);
    },
    dispose() {
      disposed = true;
      silence();
      abort.abort();
      if (music) {
        music.removeAttribute('src');
        music.load();
      }
      if (graph) {
        for (const voice of [...graph.motors, ...graph.exhausts, graph.tires]) {
          voice.source.stop();
          voice.source.disconnect();
          voice.filter.disconnect();
          voice.gain.disconnect();
        }
        graph.master.disconnect();
        graph.limiter.disconnect();
      }
      if (context) void context.close().catch(() => {});
    },
  };
}
