export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Difficulty = "one" | "two" | "four";
export type GameStatus = "menu" | "playing" | "won" | "stuck";

export type Card = {
  id: string;
  suit: Suit;
  rank: number;
  faceUp: boolean;
};

export type MovePointer = {
  column: number;
  index: number;
};

export type Hint = MovePointer & {
  targetColumn: number;
};

export type BoardSnapshot = {
  difficulty: Difficulty;
  tableau: Card[][];
  stock: Card[];
  completed: Suit[];
  moves: number;
  status: GameStatus;
  startedAt: number;
  finishedAt: number | null;
  message: string;
};

export type GameState = BoardSnapshot & {
  history: BoardSnapshot[];
};

export type ActionResult = {
  game: GameState;
  sound: "deal" | "move" | "flip" | "complete" | "error" | "win";
};

export const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];

export const suitSymbol: Record<Suit, string> = {
  spades: "\u2660",
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
};

export const suitName: Record<Suit, string> = {
  spades: "Spades",
  hearts: "Hearts",
  diamonds: "Diamonds",
  clubs: "Clubs",
};

export const difficultyLabel: Record<Difficulty, string> = {
  one: "1 Suit",
  two: "2 Suits",
  four: "4 Suits",
};

export const rankLabel = (rank: number) => {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
};

const suitCopies: Record<Difficulty, Array<{ suit: Suit; copies: number }>> = {
  one: [{ suit: "spades", copies: 8 }],
  two: [
    { suit: "spades", copies: 4 },
    { suit: "hearts", copies: 4 },
  ],
  four: suits.map((suit) => ({ suit, copies: 2 })),
};

export const createGame = (difficulty: Difficulty): GameState => {
  const deck = shuffle(createDeck(difficulty));
  const tableau: Card[][] = Array.from({ length: 10 }, () => []);

  for (let column = 0; column < 10; column += 1) {
    const cardCount = column < 4 ? 6 : 5;
    for (let index = 0; index < cardCount; index += 1) {
      const card = deck.pop();
      if (card) {
        tableau[column].push({ ...card, faceUp: index === cardCount - 1 });
      }
    }
  }

  return {
    difficulty,
    tableau,
    stock: deck.map((card) => ({ ...card, faceUp: false })),
    completed: [],
    moves: 0,
    status: "playing",
    startedAt: Date.now(),
    finishedAt: null,
    message: "Build same-suit runs from King to Ace.",
    history: [],
  };
};

export const starterGame = (): GameState => ({
  difficulty: "one",
  tableau: Array.from({ length: 10 }, () => []),
  stock: [],
  completed: [],
  moves: 0,
  status: "menu",
  startedAt: Date.now(),
  finishedAt: null,
  message: "Choose a suit mode and start stacking.",
  history: [],
});

export const scoreFor = (game: BoardSnapshot) => Math.max(0, 500 - game.moves + game.completed.length * 100);

export const elapsedMsFor = (game: BoardSnapshot, now = Date.now()) => {
  const end = game.finishedAt ?? now;
  return Math.max(0, end - game.startedAt);
};

export const formatTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

export const canMoveStack = (tableau: Card[][], column: number, index: number) => {
  const stack = tableau[column]?.slice(index) ?? [];
  if (!stack.length || stack.some((card) => !card.faceUp)) {
    return false;
  }

  for (let cursor = 0; cursor < stack.length - 1; cursor += 1) {
    const current = stack[cursor];
    const next = stack[cursor + 1];
    if (current.suit !== next.suit || current.rank !== next.rank + 1) {
      return false;
    }
  }

  return true;
};

export const canPlaceStack = (destination: Card[], movingCard: Card) => {
  if (!destination.length) {
    return true;
  }

  const target = destination[destination.length - 1];
  return target.faceUp && target.rank === movingCard.rank + 1;
};

export const moveStack = (game: GameState, from: MovePointer, targetColumn: number): ActionResult => {
  if (game.status !== "playing") {
    return fail(game, "Start a fresh deal to keep playing.");
  }

  if (from.column === targetColumn) {
    return fail(game, "Pick a different column.");
  }

  if (!canMoveStack(game.tableau, from.column, from.index)) {
    return fail(game, "Only same-suit ordered stacks can move together.");
  }

  const movingStack = game.tableau[from.column].slice(from.index);
  const movingCard = movingStack[0];
  if (!movingCard || !canPlaceStack(game.tableau[targetColumn], movingCard)) {
    return fail(game, "That stack needs a card one rank higher.");
  }

  const next = cloneSnapshot(snapshotOf(game));
  next.tableau[from.column] = next.tableau[from.column].slice(0, from.index);
  next.tableau[targetColumn] = [...next.tableau[targetColumn], ...movingStack.map((card) => ({ ...card }))];
  next.moves += 1;
  const flipped = revealTop(next.tableau[from.column]);
  const completed = collectCompletedRuns(next);
  refreshStatus(next);
  next.message = completed
    ? "Run cleared. Nice chain."
    : flipped
      ? "New card revealed."
      : "Stack moved.";

  return {
    game: withHistory(next, game),
    sound: next.status === "won" ? "win" : completed ? "complete" : flipped ? "flip" : "move",
  };
};

export const dealStock = (game: GameState): ActionResult => {
  if (game.status !== "playing") {
    return fail(game, "Start a fresh deal to keep playing.");
  }

  if (!game.stock.length) {
    return fail(game, "No stock cards left.");
  }

  if (game.tableau.some((column) => column.length === 0)) {
    return fail(game, "Fill every empty column before dealing.");
  }

  const next = cloneSnapshot(snapshotOf(game));
  for (let column = 0; column < 10; column += 1) {
    const card = next.stock.pop();
    if (card) {
      next.tableau[column].push({ ...card, faceUp: true });
    }
  }

  next.moves += 1;
  const completed = collectCompletedRuns(next);
  refreshStatus(next);
  next.message = completed ? "Fresh deal completed a run." : "New row dealt.";

  return {
    game: withHistory(next, game),
    sound: next.status === "won" ? "win" : completed ? "complete" : "deal",
  };
};

export const undo = (game: GameState): GameState => {
  const previous = game.history[game.history.length - 1];
  if (!previous) {
    return { ...game, message: "No moves to undo." };
  }

  return {
    ...cloneSnapshot(previous),
    history: game.history.slice(0, -1).map(cloneSnapshot),
    message: "Move undone.",
  };
};

export const findHints = (game: BoardSnapshot): Hint[] => {
  if (game.status !== "playing") {
    return [];
  }

  const hints: Hint[] = [];
  for (let column = 0; column < game.tableau.length; column += 1) {
    const pile = game.tableau[column];
    for (let index = 0; index < pile.length; index += 1) {
      if (!canMoveStack(game.tableau, column, index)) {
        continue;
      }

      const movingCard = pile[index];
      for (let targetColumn = 0; targetColumn < game.tableau.length; targetColumn += 1) {
        if (targetColumn === column) {
          continue;
        }

        if (canPlaceStack(game.tableau[targetColumn], movingCard)) {
          hints.push({ column, index, targetColumn });
        }
      }
    }
  }

  return hints.sort((a, b) => {
    const aTargetColumn = game.tableau[a.targetColumn];
    const bTargetColumn = game.tableau[b.targetColumn];
    const aTarget = aTargetColumn[aTargetColumn.length - 1];
    const bTarget = bTargetColumn[bTargetColumn.length - 1];
    const aSameSuit = aTarget?.suit === game.tableau[a.column][a.index].suit ? 0 : 1;
    const bSameSuit = bTarget?.suit === game.tableau[b.column][b.index].suit ? 0 : 1;
    return aSameSuit - bSameSuit || game.tableau[b.column].length - game.tableau[a.column].length;
  });
};

export const cardColor = (suit: Suit) => (suit === "hearts" || suit === "diamonds" ? "red" : "black");

const createDeck = (difficulty: Difficulty) => {
  const cards: Card[] = [];
  suitCopies[difficulty].forEach(({ suit, copies }) => {
    for (let copy = 0; copy < copies; copy += 1) {
      for (let rank = 1; rank <= 13; rank += 1) {
        cards.push({
          id: `${difficulty}-${suit}-${copy}-${rank}-${crypto.randomUUID()}`,
          suit,
          rank,
          faceUp: false,
        });
      }
    }
  });
  return cards;
};

const shuffle = <T,>(items: T[]) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

const snapshotOf = (game: GameState): BoardSnapshot => ({
  difficulty: game.difficulty,
  tableau: game.tableau,
  stock: game.stock,
  completed: game.completed,
  moves: game.moves,
  status: game.status,
  startedAt: game.startedAt,
  finishedAt: game.finishedAt,
  message: game.message,
});

const cloneSnapshot = (snapshot: BoardSnapshot): BoardSnapshot => ({
  ...snapshot,
  tableau: snapshot.tableau.map((column) => column.map((card) => ({ ...card }))),
  stock: snapshot.stock.map((card) => ({ ...card })),
  completed: [...snapshot.completed],
});

const withHistory = (snapshot: BoardSnapshot, previous: GameState): GameState => ({
  ...snapshot,
  history: [...previous.history.map(cloneSnapshot), cloneSnapshot(snapshotOf(previous))],
});

const fail = (game: GameState, message: string): ActionResult => ({
  game: { ...game, message },
  sound: "error",
});

const revealTop = (column: Card[]) => {
  const top = column[column.length - 1];
  if (top && !top.faceUp) {
    top.faceUp = true;
    return true;
  }
  return false;
};

const collectCompletedRuns = (snapshot: BoardSnapshot) => {
  let completedCount = 0;
  for (const column of snapshot.tableau) {
    let foundRun = true;
    while (foundRun && column.length >= 13) {
      foundRun = false;
      const run = column.slice(-13);
      const first = run[0];
      if (!first || !run.every((card) => card.faceUp && card.suit === first.suit)) {
        break;
      }

      const isKingToAce = run.every((card, index) => card.rank === 13 - index);
      if (isKingToAce) {
        column.splice(column.length - 13, 13);
        snapshot.completed.push(first.suit);
        completedCount += 1;
        revealTop(column);
        foundRun = true;
      }
    }
  }
  return completedCount;
};

const refreshStatus = (snapshot: BoardSnapshot) => {
  if (snapshot.completed.length >= 8) {
    snapshot.status = "won";
    snapshot.finishedAt = Date.now();
    snapshot.message = "Board cleared.";
    return;
  }

  if (!snapshot.stock.length && findHints(snapshot).length === 0) {
    snapshot.status = "stuck";
    snapshot.finishedAt = Date.now();
    snapshot.message = "No more moves. Undo or start a fresh deal.";
    return;
  }

  snapshot.status = "playing";
  snapshot.finishedAt = null;
};
