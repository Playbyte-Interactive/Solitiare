import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeHelp,
  BarChart3,
  CalendarDays,
  Lightbulb,
  Pause,
  Play,
  Settings,
  Sparkles,
  Star,
  Trophy,
  Undo2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { SolitaireAudio, type SoundName } from "./game/audio";
import {
  type Card,
  type GameState,
  type MovePointer,
  type Suit,
  autoMoveToFoundation,
  cardColor,
  createGame,
  dealStock,
  elapsedMsFor,
  findHints,
  formatTime,
  hasStockLoop,
  moveCards,
  rankLabel,
  scoreFor,
  starterGame,
  stockLabelFor,
  suitName,
  suitSymbol,
  suits,
  undo,
} from "./game/klondike";

const bestKey = "klondike-best-standard";

type BestStats = {
  score: number;
  moves: number;
  time: number;
};

type DragGesture = {
  from: MovePointer;
  cards: Card[];
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  cardWidth: number;
  active: boolean;
};

type DragState = DragGesture & {
  x: number;
  y: number;
};

export default function App() {
  const [game, setGame] = useState<GameState>(() => starterGame());
  const [selected, setSelected] = useState<MovePointer | null>(null);
  const [hint, setHint] = useState<ReturnType<typeof findHints>[number] | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(() => localStorage.getItem("klondike-rules-seen") !== "true");
  const dragGesture = useRef<DragGesture | null>(null);
  const suppressClick = useRef(false);
  const audioRef = useRef(new SolitaireAudio());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    audioRef.current.setEnabled(!muted);
  }, [muted]);

  useEffect(() => {
    if (game.status !== "playing" && game.status !== "won" && game.status !== "stuck") {
      return;
    }

    const current: BestStats = {
      score: scoreFor(game),
      moves: game.moves,
      time: elapsedMsFor(game),
    };
    const saved = readBest();
    if (!saved || current.score > saved.score || (current.score === saved.score && current.moves < saved.moves)) {
      localStorage.setItem(bestKey, JSON.stringify(current));
    }
  }, [game]);

  const best = useMemo(() => readBest(), [game]);
  const isPaused = pausedAt !== null && game.status === "playing";
  const elapsed = elapsedMsFor(game, pausedAt ?? now);
  const score = scoreFor(game);
  const foundationCount = suits.reduce((total, suit) => total + game.foundations[suit].length, 0);
  const wasteCard = game.waste[game.waste.length - 1];

  const play = async (sound: SoundName) => {
    await audioRef.current.unlock();
    audioRef.current.play(sound);
  };

  const startGame = async () => {
    await play("tap");
    const shouldShowRules = localStorage.getItem("klondike-rules-seen") !== "true";
    setGame(createGame());
    setSelected(null);
    setHint(null);
    setPausedAt(null);
    localStorage.setItem("klondike-rules-seen", "true");
    setShowRules(shouldShowRules);
  };

  const applyResult = async (result: ReturnType<typeof moveCards> | ReturnType<typeof dealStock>) => {
    setGame(result.game);
    setSelected(null);
    setHint(null);
    await play(result.sound);
  };

  const clearMotion = () => {
    window.setTimeout(() => {
      setMovingIds(new Set());
      setRejectedIds(new Set());
    }, 360);
  };

  const pauseGame = async () => {
    if (game.status !== "playing" || pausedAt !== null) {
      return;
    }
    await play("tap");
    setPausedAt(Date.now());
    setSelected(null);
    setHint(null);
  };

  const resumeGame = async () => {
    if (game.status !== "playing" || pausedAt === null) {
      return;
    }
    const pausedDuration = Date.now() - pausedAt;
    await play("tap");
    setGame((current) => ({
      ...current,
      startedAt: current.startedAt + pausedDuration,
      message: "Back to the table.",
    }));
    setPausedAt(null);
  };

  const handleStock = async () => {
    if (isPaused) {
      return;
    }
    await applyResult(dealStock(game));
  };

  const handleUndo = async () => {
    if (isPaused) {
      return;
    }
    const previousLength = game.history.length;
    setGame(undo(game));
    setSelected(null);
    setHint(null);
    await play(previousLength ? "move" : "error");
  };

  const showNextHint = async () => {
    if (isPaused) {
      return;
    }
    const [nextHint] = findHints(game);
    if (!nextHint) {
      if (hasStockLoop(game)) {
        setGame({
          ...game,
          status: "stuck",
          finishedAt: Date.now(),
          message: "No productive move remains after a repeated stock cycle. Deal over.",
        });
      } else {
        setGame({ ...game, message: "No useful move is available from the visible cards." });
      }
      await play("error");
      return;
    }
    setHint(nextHint);
    setSelected(nextHint.from.zone === "waste" && !game.waste.length ? null : nextHint.from);
    setGame({ ...game, message: nextHint.label });
    await play("tap");
  };

  const selectOrMove = async (pointer: MovePointer) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }

    if (game.status !== "playing" || isPaused) {
      return;
    }

    if (selected) {
      if (samePointer(selected, pointer)) {
        setSelected(null);
        setHint(null);
        await play("tap");
        return;
      }
      const cards = cardsForPointer(game, selected);
      const result = moveCards(game, selected, pointer);
      if (result.sound === "error") {
        setRejectedIds(new Set(cards.map((card) => card.id)));
      } else {
        setMovingIds(new Set(cards.map((card) => card.id)));
      }
      await applyResult(result);
      clearMotion();
      return;
    }

    setSelected(pointer);
    setHint(null);
    await play("tap");
  };

  const autoFoundation = async (pointer: MovePointer) => {
    if (game.status !== "playing" || isPaused) {
      return;
    }
    const cards = cardsForPointer(game, pointer);
    const result = autoMoveToFoundation(game, pointer);
    if (result.sound === "error") {
      setRejectedIds(new Set(cards.map((card) => card.id)));
    } else {
      setMovingIds(new Set(cards.map((card) => card.id)));
    }
    await applyResult(result);
    clearMotion();
  };

  const beginCardDrag = (event: React.PointerEvent<HTMLButtonElement>, pointer: MovePointer) => {
    if (game.status !== "playing" || isPaused) {
      return;
    }

    const cards = cardsForPointer(game, pointer);
    if (!cards.length) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragGesture.current = {
      from: pointer,
      cards,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      cardWidth: rect.width,
      active: false,
    };
  };

  const updateCardDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = dragGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.active && Math.max(Math.abs(dx), Math.abs(dy)) < 8) {
      return;
    }

    event.preventDefault();
    if (!gesture.active) {
      gesture.active = true;
      setSelected(null);
      setHint(null);
      void play("tap");
    }

    setDragState({
      ...gesture,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const finishCardDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const gesture = dragGesture.current;
    dragGesture.current = null;

    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!gesture.active) {
      setDragState(null);
      return;
    }

    event.preventDefault();
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);

    const target = dropTargetFromPoint(event.clientX, event.clientY);
    void dropDraggedCards(gesture, target);
  };

  const cancelCardDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragGesture.current = null;
    setDragState(null);
  };

  const dropDraggedCards = async (gesture: DragGesture, target: MovePointer | null) => {
    setDragState(null);

    if (!target) {
      setRejectedIds(new Set(gesture.cards.map((card) => card.id)));
      setGame((current) => ({ ...current, message: "Release cards on a column or foundation." }));
      await play("error");
      clearMotion();
      return;
    }

    const result = moveCards(game, gesture.from, target);
    const ids = new Set(gesture.cards.map((card) => card.id));
    if (result.sound === "error") {
      setRejectedIds(ids);
    } else {
      setMovingIds(ids);
    }

    await applyResult(result);
    clearMotion();
  };

  const toggleRules = async () => {
    await play("tap");
    localStorage.setItem("klondike-rules-seen", "true");
    setShowRules((value) => !value);
  };

  return (
    <main className="app-shell">
      <section className="table-shell" aria-label="Klondike Solitaire game">
        <header className="topbar">
          <button className="round-hud-button star-hud" type="button" onClick={startGame} aria-label="New deal" title="New deal">
            <Star size={30} fill="currentColor" />
          </button>

          <div className="classic-stat">
            <span>Score:</span>
            <strong>{score}</strong>
          </div>
          <div className="classic-stat">
            <span>Time:</span>
            <strong>{formatTime(elapsed)}</strong>
          </div>
          <div className="classic-stat">
            <span>Moves:</span>
            <strong>{game.moves}</strong>
          </div>

          <button
            className="round-hud-button pause-hud"
            type="button"
            onClick={isPaused ? resumeGame : pauseGame}
            aria-label={isPaused ? "Resume game" : "Pause game"}
            title={isPaused ? "Resume game" : "Pause game"}
            disabled={game.status !== "playing"}
          >
            {isPaused ? <Play size={32} fill="currentColor" /> : <Pause size={32} fill="currentColor" />}
          </button>
        </header>

        <div className="stats-row" aria-label="Game stats">
          <Stat icon={<Trophy size={17} />} label="Score" value={score.toString()} />
          <Stat icon={<BarChart3 size={17} />} label="Moves" value={game.moves.toString()} />
          <Stat icon={<BadgeHelp size={17} />} label="Time" value={formatTime(elapsed)} />
          <Stat icon={<Sparkles size={17} />} label="Home" value={`${foundationCount}/52`} />
        </div>

        <section className="board-wrap">
          <div className="pile-row" aria-label="Stock, waste, and foundations">
            <div className="foundations" aria-label="Foundations">
              {suits.map((suit) => {
                const top = game.foundations[suit][game.foundations[suit].length - 1];
                return (
                  <button
                    className={`foundation ${top ? "has-card" : "is-empty"} ${cardColor(suit)} ${
                      selected?.zone === "foundation" && selected.suit === suit ? "selected-pile" : ""
                    }`}
                    key={suit}
                    type="button"
                    data-drop-zone="foundation"
                    data-suit={suit}
                    onPointerDown={(event) => beginCardDrag(event, { zone: "foundation", suit })}
                    onPointerMove={updateCardDrag}
                    onPointerUp={finishCardDrag}
                    onPointerCancel={cancelCardDrag}
                    onClick={() => void selectOrMove({ zone: "foundation", suit })}
                    disabled={game.status !== "playing" || isPaused}
                    aria-label={`${suitName[suit]} foundation`}
                  >
                    {top ? <CardFace card={top} compact /> : <FoundationEmpty suit={suit} />}
                  </button>
                );
              })}
            </div>

            <button
              className={`waste-slot ${wasteCard ? `has-card ${cardColor(wasteCard.suit)}` : "is-empty"} ${
                selected?.zone === "waste" ? "selected-pile" : ""
              }`}
              type="button"
              onClick={() => void selectOrMove({ zone: "waste" })}
              onDoubleClick={() => void autoFoundation({ zone: "waste" })}
              onPointerDown={(event) => beginCardDrag(event, { zone: "waste" })}
              onPointerMove={updateCardDrag}
              onPointerUp={finishCardDrag}
              onPointerCancel={cancelCardDrag}
              disabled={!wasteCard || game.status !== "playing" || isPaused}
              aria-label="Waste pile"
            >
              {wasteCard ? <CardFace card={wasteCard} /> : <span>Waste</span>}
            </button>

            <button className="stock pile-slot" type="button" onClick={handleStock} disabled={game.status !== "playing" || isPaused} aria-label={stockLabelFor(game)}>
              <span className="stock-stack" aria-hidden="true">
                {Array.from({ length: Math.max(1, Math.min(game.stock.length, 4)) }).map((_, index) => (
                  <i key={index} style={{ transform: `translate(${index * 3}px, ${-index * 3}px)` }} />
                ))}
              </span>
              <span className="stock-label">{stockLabelFor(game)}</span>
            </button>
          </div>

          <div className="board" data-testid="board">
            {game.tableau.map((column, columnIndex) => (
              <div
                className={`column ${selected?.zone === "tableau" && selected.column === columnIndex ? "column-selected" : ""} ${
                  hint?.to.zone === "tableau" && hint.to.column === columnIndex ? "hint-target" : ""
                }`}
                key={columnIndex}
                data-drop-zone="tableau"
                data-column={columnIndex}
                onClick={() => void selectOrMove({ zone: "tableau", column: columnIndex })}
                data-testid={`column-${columnIndex}`}
              >
                {!column.length && <div className="empty-slot">K</div>}
                {column.map((card, cardIndex) => {
                  const isSelected =
                    selected?.zone === "tableau" && selected.column === columnIndex && (selected.index ?? 999) <= cardIndex;
                  const isHint =
                    hint?.from.zone === "tableau" && hint.from.column === columnIndex && (hint.from.index ?? 999) <= cardIndex;
                  const isDraggingSource =
                    dragState?.active === true &&
                    dragState.from.zone === "tableau" &&
                    dragState.from.column === columnIndex &&
                    (dragState.from.index ?? 999) <= cardIndex;
                  return (
                    <button
                      className={`card ${card.faceUp ? "face-up" : "face-down"} ${card.faceUp ? cardColor(card.suit) : ""} ${
                        isSelected ? "selected" : ""
                      } ${isHint ? "hint-source" : ""} ${movingIds.has(card.id) ? "is-arriving" : ""} ${
                        rejectedIds.has(card.id) ? "is-rejected" : ""
                      } ${isDraggingSource ? "is-drag-source" : ""}`}
                      key={card.id}
                      style={{
                        top: stackTopFor(column, cardIndex),
                        zIndex: cardIndex + 1,
                      }}
                      data-drop-zone="tableau"
                      data-column={columnIndex}
                      onPointerDown={(event) => {
                        if (!card.faceUp) {
                          return;
                        }
                        beginCardDrag(event, { zone: "tableau", column: columnIndex, index: cardIndex });
                      }}
                      onPointerMove={updateCardDrag}
                      onPointerUp={finishCardDrag}
                      onPointerCancel={cancelCardDrag}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!card.faceUp) {
                          return;
                        }
                        void selectOrMove({ zone: "tableau", column: columnIndex, index: cardIndex });
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (card.faceUp && cardIndex === column.length - 1) {
                          void autoFoundation({ zone: "tableau", column: columnIndex, index: cardIndex });
                        }
                      }}
                      aria-label={card.faceUp ? `${rankLabel(card.rank)} of ${suitName[card.suit]}` : "Face-down card"}
                    >
                      {card.faceUp ? <CardFace card={card} /> : <span className="card-back">{"\u25C6"}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {dragState?.active && <DragPreview drag={dragState} />}

        <footer className="bottom-row">
          <p className="message" role="status">
            {game.message}
          </p>
          {best && (
            <p className="best">
              Best {best.score} in {best.moves} moves
            </p>
          )}
        </footer>

        <nav className="action-dock" aria-label="Quick actions">
          <DockButton icon={<Settings size={19} />} label="Rules" onClick={toggleRules} />
          <DockButton icon={<CalendarDays size={19} />} label="Deal" onClick={startGame} />
          <DockButton
            icon={isPaused ? <Play size={22} fill="currentColor" /> : <Pause size={21} fill="currentColor" />}
            label={isPaused ? "Resume" : "Pause"}
            onClick={isPaused ? resumeGame : pauseGame}
            disabled={game.status !== "playing"}
            primary
          />
          <DockButton icon={<Lightbulb size={19} />} label="Hint" onClick={showNextHint} disabled={game.status !== "playing" || isPaused} />
          <DockButton icon={muted ? <VolumeX size={19} /> : <Volume2 size={19} />} label="Sound" onClick={() => setMuted((value) => !value)} />
          <DockButton icon={<Undo2 size={19} />} label="Undo" onClick={handleUndo} disabled={!game.history.length || isPaused} />
        </nav>

        {game.status === "menu" && <StartOverlay startGame={startGame} />}
        {showRules && game.status !== "menu" && <RulesOverlay close={toggleRules} />}
        {isPaused && <PauseOverlay game={game} resumeGame={resumeGame} startGame={startGame} />}
        {game.status === "won" && <EndOverlay game={game} startGame={startGame} />}
        {game.status === "stuck" && !showRules && <StuckOverlay game={game} startGame={startGame} />}
      </section>
    </main>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="stat">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DockButton({
  icon,
  label,
  onClick,
  disabled = false,
  primary = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button className={primary ? "dock-button primary" : "dock-button"} type="button" onClick={onClick} disabled={disabled}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function CardFace({ card, compact = false }: { card: Card; compact?: boolean }) {
  return (
    <>
      <span className="card-corner">
        <strong>{rankLabel(card.rank)}</strong>
        <span>{suitSymbol[card.suit]}</span>
      </span>
      <span className={compact ? "card-center compact" : "card-center"} aria-hidden="true">
        {suitSymbol[card.suit]}
      </span>
      {!compact && (
        <span className="card-corner bottom">
          <strong>{rankLabel(card.rank)}</strong>
          <span>{suitSymbol[card.suit]}</span>
        </span>
      )}
    </>
  );
}

function FoundationEmpty({ suit }: { suit: Suit }) {
  return (
    <span className="foundation-empty">
      <strong>A</strong>
      <span>{suitSymbol[suit]}</span>
      <small>{suitName[suit]}</small>
    </span>
  );
}

function StartOverlay({ startGame }: { startGame: () => Promise<void> }) {
  return (
    <div className="overlay">
      <div className="start-panel">
        <div className="preview-table" aria-hidden="true">
          <span className="preview-card red">A<br />{"\u2665"}</span>
          <span className="preview-card black">K<br />{"\u2660"}</span>
          <span className="preview-card back" />
          <span className="preview-card red">Q<br />{"\u2666"}</span>
        </div>
        <div className="panel-icon">
          <Play size={34} fill="currentColor" />
        </div>
        <p className="eyebrow">Classic solitaire</p>
        <h2>Clear the table. Keep going.</h2>
        <p className="panel-copy">
          Draw from stock, stack alternating colors, send each suit home, and use Hint whenever the next useful move is not obvious.
        </p>
        <div className="start-actions">
          <button onClick={startGame}>Start Deal</button>
        </div>
      </div>
    </div>
  );
}

function RulesOverlay({ close }: { close: () => Promise<void> }) {
  return (
    <div className="overlay">
      <div className="start-panel end-panel">
        <div className="panel-icon">
          <BadgeHelp size={34} />
        </div>
        <p className="eyebrow">How to play</p>
        <h2>Klondike rules.</h2>
        <p className="panel-copy">
          Tap stock to draw. Move cards down on the tableau in alternating colors. Empty columns accept Kings. Build foundations from Ace to King by suit. Double-tap a top card to send it home. Hint highlights a source and destination, and a repeated stock loop ends the deal.
        </p>
        <div className="start-actions">
          <button onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  );
}

function PauseOverlay({
  game,
  resumeGame,
  startGame,
}: {
  game: GameState;
  resumeGame: () => Promise<void>;
  startGame: () => Promise<void>;
}) {
  return (
    <div className="overlay">
      <div className="start-panel end-panel">
        <div className="panel-icon">
          <Pause size={34} />
        </div>
        <p className="eyebrow">Paused</p>
        <h2>The table waits.</h2>
        <p className="panel-copy">
          Score {scoreFor(game)} - {game.moves} moves - {formatTime(elapsedMsFor(game))}
        </p>
        <div className="start-actions">
          <button onClick={resumeGame}>Resume</button>
          <button onClick={startGame}>New deal</button>
        </div>
      </div>
    </div>
  );
}

function EndOverlay({ game, startGame }: { game: GameState; startGame: () => Promise<void> }) {
  const finalScore = scoreFor(game);
  const highScore = Math.max(finalScore, readBest()?.score ?? 0);

  return (
    <div className="overlay">
      <div className="start-panel end-panel">
        <div className="panel-icon">
          <Trophy size={34} />
        </div>
        <p className="eyebrow">Victory</p>
        <h2>The foundations are full.</h2>
        <p className="panel-copy">
          Score {finalScore} - High {highScore} - {game.moves} moves - {formatTime(elapsedMsFor(game))}
        </p>
        <div className="start-actions">
          <button onClick={startGame}>Next Deal</button>
        </div>
      </div>
    </div>
  );
}

function StuckOverlay({
  game,
  startGame,
}: {
  game: GameState;
  startGame: () => Promise<void>;
}) {
  const finalScore = scoreFor(game);
  const highScore = Math.max(finalScore, readBest()?.score ?? 0);

  return (
    <div className="overlay">
      <div className="start-panel end-panel">
        <div className="panel-icon">
          <BadgeHelp size={34} />
        </div>
        <p className="eyebrow">Game over</p>
        <h2>No progress remains.</h2>
        <p className="panel-copy">
          Score {finalScore} - High {highScore} - {game.moves} moves - {formatTime(elapsedMsFor(game))}. This deal repeated without a real card move.
        </p>
        <div className="start-actions">
          <button onClick={startGame}>Play Again</button>
        </div>
      </div>
    </div>
  );
}

function DragPreview({ drag }: { drag: DragState }) {
  const stackGap = drag.from.zone === "tableau" ? 33 : 0;

  return (
    <div
      className="drag-preview"
      style={
        {
          left: `${drag.x - drag.offsetX}px`,
          top: `${drag.y - drag.offsetY}px`,
          "--drag-card-width": `${drag.cardWidth}px`,
          "--drag-stack-height": `${drag.cardWidth / 0.72 + Math.max(0, drag.cards.length - 1) * stackGap}px`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      {drag.cards.map((card, index) => (
        <div
          className={`drag-card card face-up ${cardColor(card.suit)}`}
          key={card.id}
          style={{ top: `${index * stackGap}px`, zIndex: index + 1 }}
        >
          <CardFace card={card} />
        </div>
      ))}
    </div>
  );
}

function dropTargetFromPoint(x: number, y: number): MovePointer | null {
  const element = document.elementFromPoint(x, y);
  const target = element?.closest("[data-drop-zone]") as HTMLElement | null;
  if (!target) {
    return null;
  }

  const zone = target?.dataset.dropZone;

  if (zone === "tableau" && target.dataset.column !== undefined) {
    const column = Number(target.dataset.column);
    return Number.isFinite(column) ? { zone: "tableau", column } : null;
  }

  if (zone === "foundation") {
    const suit = target.dataset.suit as Suit | undefined;
    return suit && suits.includes(suit) ? { zone: "foundation", suit } : null;
  }

  return null;
}

function cardsForPointer(game: GameState, pointer: MovePointer): Card[] {
  if (pointer.zone === "waste") {
    const card = game.waste[game.waste.length - 1];
    return card ? [card] : [];
  }

  if (pointer.zone === "foundation" && pointer.suit) {
    const card = game.foundations[pointer.suit][game.foundations[pointer.suit].length - 1];
    return card ? [card] : [];
  }

  if (pointer.zone === "tableau" && pointer.column !== undefined && pointer.index !== undefined) {
    return game.tableau[pointer.column].slice(pointer.index).filter((card) => card.faceUp);
  }

  return [];
}

function stackTopFor(column: Card[], cardIndex: number) {
  const before = column.slice(0, cardIndex);
  const faceUpBefore = before.filter((card) => card.faceUp).length;
  const faceDownBefore = before.length - faceUpBefore;
  return `calc(${faceDownBefore} * var(--face-down-gap) + ${faceUpBefore} * var(--face-up-gap))`;
}

function samePointer(first: MovePointer, second: MovePointer) {
  return first.zone === second.zone && first.column === second.column && first.index === second.index && first.suit === second.suit;
}

function readBest(): BestStats | null {
  try {
    const value = localStorage.getItem(bestKey);
    return value ? (JSON.parse(value) as BestStats) : null;
  } catch {
    return null;
  }
}
