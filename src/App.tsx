import { useEffect, useRef, useState } from 'react';
import { MODES, type Mode } from '../shared/live';
import { startMicCapture, type MicCapture } from './audio/capture';
import { PcmPlayer } from './audio/player';
import { LiveTutorSession, type SessionStatus, type Speaker } from './gemini/live-session';

interface Line {
  id: number;
  speaker: Speaker;
  text: string;
  open: boolean;
}

interface Running {
  ctx: AudioContext;
  player: PcmPlayer;
  session: LiveTutorSession;
  mic?: MicCapture;
  micDead: boolean;
  muted: boolean;
  wakeLock?: WakeLockSentinel;
}

type Status = SessionStatus | 'idle';

const MAX_LINES = 60;
// Peak amplitude (PCM16) above which a mic chunk counts as the learner speaking.
const VOICE_PEAK = 1200;
const VOICE_HOLD_MS = 300;

const STATUS_LABEL: Record<Status, string> = {
  idle: 'Ready',
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  ended: 'Ended',
  error: 'Error',
};

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone permission denied. Allow it in the browser settings and try again.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No microphone found.';
  return error instanceof Error ? error.message : String(error);
}

async function requestWakeLock(): Promise<WakeLockSentinel | undefined> {
  // Screen-off suspends the page on phones, which kills the mic and the socket.
  try {
    return await navigator.wakeLock?.request('screen');
  } catch {
    return undefined; // unsupported, low battery, or page hidden: the session still works with the screen on
  }
}

export function App() {
  const [mode, setMode] = useState<Mode>('free');
  const [status, setStatus] = useState<Status>('idle');
  const [detail, setDetail] = useState<string>();
  const [muted, setMuted] = useState(false);
  const [tutorSpeaking, setTutorSpeaking] = useState(false);
  const [youSpeaking, setYouSpeaking] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [responseGapMs, setResponseGapMs] = useState<number>();
  const [elapsed, setElapsed] = useState(0);

  const running = useRef<Running | null>(null);
  const lineId = useRef(0);
  const lastVoiceAt = useRef(0);
  const youSpeakingRef = useRef(false);
  const tutorTurnStarted = useRef(false);
  const startedAt = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const active = status === 'connecting' || status === 'live' || status === 'reconnecting';

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setElapsed(Math.floor((performance.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  // Returning from background / lock screen: wake the audio graph, re-take the screen lock,
  // and restart the mic if the OS killed it. A dropped socket reconnects on its own.
  useEffect(() => {
    const onVisibility = () => {
      const current = running.current;
      if (!current || document.visibilityState !== 'visible') return;
      if (current.ctx.state !== 'running') void current.ctx.resume();
      if (!current.wakeLock || current.wakeLock.released) {
        void requestWakeLock().then((lock) => {
          if (running.current === current) current.wakeLock = lock;
          else void lock?.release();
        });
      }
      if (current.micDead) void restartMic(current);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => () => teardown(), []);

  function teardown() {
    const current = running.current;
    running.current = null;
    if (!current) return;
    current.mic?.stop();
    current.session.stop();
    current.player.clear();
    void current.wakeLock?.release();
    void current.ctx.close();
    setTutorSpeaking(false);
    setYouSpeaking(false);
    youSpeakingRef.current = false;
  }

  function onMicChunk(session: LiveTutorSession, pcm: ArrayBuffer) {
    const samples = new Int16Array(pcm);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    const now = performance.now();
    if (peak > VOICE_PEAK) lastVoiceAt.current = now;
    const speaking = now - lastVoiceAt.current < VOICE_HOLD_MS;
    if (speaking !== youSpeakingRef.current) {
      youSpeakingRef.current = speaking;
      setYouSpeaking(speaking);
    }
    session.sendAudio(pcm);
  }

  async function openMic(current: Running): Promise<MicCapture> {
    const mic = await startMicCapture(
      current.ctx,
      (pcm) => onMicChunk(current.session, pcm),
      () => {
        current.micDead = true;
        if (document.visibilityState === 'visible') void restartMic(current);
      },
    );
    mic.setMuted(current.muted);
    return mic;
  }

  async function restartMic(current: Running) {
    if (!current.micDead) return;
    current.micDead = false;
    current.mic?.stop();
    try {
      const mic = await openMic(current);
      if (running.current === current) current.mic = mic;
      else mic.stop();
    } catch (error) {
      current.micDead = true;
      setDetail(`Microphone lost: ${describeError(error)}`);
    }
  }

  function appendTranscript(speaker: Speaker, text: string) {
    setLines((previous) => {
      const last = previous.at(-1);
      if (last?.open && last.speaker === speaker) {
        return [...previous.slice(0, -1), { ...last, text: last.text + text }];
      }
      const closed = last?.open ? [...previous.slice(0, -1), { ...last, open: false }] : previous;
      return [...closed, { id: ++lineId.current, speaker, text, open: true }].slice(-MAX_LINES);
    });
  }

  function closeLines() {
    setLines((previous) =>
      previous.some((line) => line.open) ? previous.map((line) => ({ ...line, open: false })) : previous,
    );
  }

  async function start() {
    setLines([]);
    setResponseGapMs(undefined);
    setElapsed(0);
    setDetail(undefined);
    setMuted(false);
    setStatus('connecting');
    tutorTurnStarted.current = false;
    lastVoiceAt.current = 0;
    startedAt.current = performance.now();

    // Must be created and resumed synchronously inside the tap handler on iOS.
    const ctx = new AudioContext();
    const resumed = ctx.resume();
    // Safari 17+: keep mic + speaker in one session so output is not ducked to the earpiece.
    const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (audioSession) audioSession.type = 'play-and-record';

    const player = new PcmPlayer(ctx, setTutorSpeaking);
    const session = new LiveTutorSession(mode, {
      status(next, info) {
        // Fatal: release mic, wake lock and audio graph (stop() reports 'ended', so override after).
        if (next === 'error' && running.current?.session === session) teardown();
        setStatus(next);
        setDetail(info);
      },
      audio(pcm) {
        if (!tutorTurnStarted.current) {
          tutorTurnStarted.current = true;
          if (lastVoiceAt.current) setResponseGapMs(Math.round(performance.now() - lastVoiceAt.current));
        }
        player.enqueue(pcm);
      },
      interrupted() {
        player.clear();
        tutorTurnStarted.current = false;
        closeLines();
      },
      transcript: appendTranscript,
      turnComplete() {
        tutorTurnStarted.current = false;
        closeLines();
      },
    });
    const current: Running = { ctx, player, session, micDead: false, muted: false };
    running.current = current;

    try {
      await resumed;
      // Mic first: the permission prompt follows the tap directly, and a denial costs no token.
      current.mic = await openMic(current);
      current.wakeLock = await requestWakeLock();
      if (running.current !== current) return;
      await session.start();
    } catch (error) {
      if (running.current !== current) return;
      teardown();
      setStatus('error');
      setDetail(describeError(error));
    }
  }

  function toggleMute() {
    const current = running.current;
    if (!current) return;
    current.muted = !current.muted;
    current.mic?.setMuted(current.muted);
    setMuted(current.muted);
  }

  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');

  return (
    <main>
      <header>
        <div className={`status status-${status}`}>
          <span className="dot" />
          <span>{STATUS_LABEL[status]}</span>
          <span className="timer">
            {minutes}:{seconds}
          </span>
        </div>
        {detail && <p className="detail">{detail}</p>}
        <div className="modes" role="radiogroup" aria-label="Practice mode">
          {(Object.keys(MODES) as Mode[]).map((key) => (
            <button
              key={key}
              role="radio"
              aria-checked={mode === key}
              className={mode === key ? 'selected' : ''}
              disabled={active}
              onClick={() => setMode(key)}
            >
              {MODES[key]}
            </button>
          ))}
        </div>
      </header>

      <section className="transcript" aria-live="polite">
        {lines.length === 0 && !active && (
          <p className="hint">Pick a mode, tap Start, and just talk. Headphones give the best results.</p>
        )}
        {lines.map((line) => (
          <p key={line.id} className={`line ${line.speaker}`}>
            {line.text}
          </p>
        ))}
        <div ref={transcriptEnd} />
      </section>

      <footer>
        <div className="indicators">
          <span className={youSpeaking && !muted ? 'on you' : ''}>You</span>
          <span className={tutorSpeaking ? 'on tutor' : ''}>Tutor</span>
          <span className="gap">{responseGapMs === undefined ? 'gap —' : `gap ≈${responseGapMs} ms`}</span>
        </div>
        <div className="controls">
          {active ? (
            <>
              <button className={`round ${muted ? 'muted' : ''}`} onClick={toggleMute} aria-pressed={muted}>
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button className="round big danger" onClick={teardown}>
                End
              </button>
            </>
          ) : (
            <button className="round big primary" onClick={() => void start()}>
              Start
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}
