export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Zone = "stock" | "waste" | "tableau" | "foundation";
export type GameStatus = "menu" | "playing" | "won" | "stuck";

export type Card = {
  id: string;
  suit: Suit;
  rank: number;
  faceUp: boolean;
};

export type MovePointer = {
  zone: Exclude<Zone, "stock">;
  column?: number;
  suit?: Suit;
  index?: number;
};

export type BoardSnapshot = {
  tableau: Card[][];
  stock: Card[];
  waste: Card[];
  foundations: Record<Suit, Card[]>;
  moves: number;
  status: GameStatus;
  startedAt: number;
  finishedAt: number | null;
  message: string;
  stockPassKey: string;
  stockPassMadeMove: boolean;
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

export const rankLabel = (rank: number) => {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
};

export const cardColor = (suit: Suit) => (suit === "hearts" || suit === "diamonds" ? "red" : "black");

export const starterGame = (): GameState => ({
  tableau: Array.from({ length: 7 }, () => []),
  stock: [],
  waste: [],
  foundations: emptyFoundations(),
  moves: 0,
  status: "menu",
  startedAt: Date.now(),
  finishedAt: null,
  message: "Classic Klondike: build foundations from Ace to King.",
  stockPassKey: "",
  stockPassMadeMove: false,
  history: [],
});

export const createGame = (): GameState => {
  const deck = shuffle(createDeck());
  const tableau: Card[][] = Array.from({ length: 7 }, () => []);

  for (let column = 0; column < 7; column += 1) {
    for (let index = 0; index <= column; index += 1) {
      const card = deck.pop();
      if (card) {
        tableau[column].push({ ...card, faceUp: index === column });
      }
    }
  }

  const game: GameState = {
    tableau,
    stock: deck.map((card) => ({ ...card, faceUp: false })),
    waste: [],
    foundations: emptyFoundations(),
    moves: 0,
    status: "playing",
    startedAt: Date.now(),
    finishedAt: null,
    message: "Move cards down in alternating colors. Build each suit from Ace to King.",
    stockPassKey: "",
    stockPassMadeMove: false,
    history: [],
  };

  game.stockPassKey = stockCycleKey(game);
  return game;
};

export const scoreFor = (game: BoardSnapshot) => {
  const foundationCards = suits.reduce((total, suit) => total + game.foundations[suit].length, 0);
  const faceUpCards = game.tableau.flat().filter((card) => card.faceUp).length;
  return Math.max(0, foundationCards * 150 + faceUpCards * 10);
};

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

export const stockLabelFor = (game: BoardSnapshot) => {
  if (game.stock.length) {
    return `${game.stock.length} left`;
  }
  return game.waste.length ? "Recycle" : "Empty";
};

export const dealStock = (game: GameState): ActionResult => {
  if (game.status !== "playing") {
    return fail(game, "Start a new deal first.");
  }

  const next = cloneSnapshot(snapshotOf(game));
  if (next.stock.length) {
    const card = next.stock.pop()!;
    next.waste.push({ ...card, faceUp: true });
    next.moves += 1;
    const openMoves = findCardMoveHints(next);
    next.message = openMoves.length
      ? "Card drawn. A real move is open now."
      : next.stock.length
        ? "Card drawn. No useful move yet; keep drawing."
        : "Stock pass finished. Move a card or recycle once.";
    refreshStatus(next);
    return { game: withHistory(next, game), sound: "deal" };
  }

  if (next.waste.length) {
    next.stock = next.waste.reverse().map((card) => ({ ...card, faceUp: false }));
    next.waste = [];
    next.moves += 1;
    const cycleKey = stockCycleKey(next);
    if (!game.stockPassMadeMove && cycleKey === game.stockPassKey) {
      next.status = "stuck";
      next.finishedAt = Date.now();
      next.message = "No progress after a full stock cycle. Deal over.";
      next.stockPassKey = cycleKey;
      next.stockPassMadeMove = false;
      return { game: withHistory(next, game), sound: "error" };
    }
    next.stockPassKey = cycleKey;
    next.stockPassMadeMove = false;
    next.message = "Waste recycled. New stock pass started.";
    refreshStatus(next);
    return { game: withHistory(next, game), sound: "flip" };
  }

  return fail(game, "No stock cards remain.");
};

export const moveCards = (game: GameState, from: MovePointer, to: MovePointer): ActionResult => {
  if (game.status !== "playing") {
    return fail(game, "Start a new deal first.");
  }

  const moving = readMovingCards(game, from);
  if (!moving.length) {
    return fail(game, "Pick a face-up card.");
  }

  if (to.zone === "foundation") {
    if (moving.length !== 1 || !to.suit || moving[0].suit !== to.suit || !canMoveToFoundation(game.foundations[to.suit], moving[0])) {
      return fail(game, "Foundations build by suit from Ace to King.");
    }

    const next = cloneSnapshot(snapshotOf(game));
    removeMovingCards(next, from);
    next.foundations[to.suit].push({ ...moving[0], faceUp: true });
    next.moves += 1;
    next.stockPassMadeMove = true;
    const flipped = revealSourceTop(next, from);
    refreshStatus(next);
    next.message = next.status === "won" ? "Board cleared." : `${rankLabel(moving[0].rank)} to ${suitName[to.suit]}.`;
    return {
      game: withHistory(next, game),
      sound: next.status === "won" ? "win" : flipped ? "flip" : "complete",
    };
  }

  if (to.zone !== "tableau" || to.column === undefined) {
    return fail(game, "Move cards to a tableau column or a foundation.");
  }

  if (!canMoveToTableau(game.tableau[to.column], moving[0])) {
    return fail(game, "Tableau cards descend in alternating colors.");
  }

  const next = cloneSnapshot(snapshotOf(game));
  removeMovingCards(next, from);
  next.tableau[to.column].push(...moving.map((card) => ({ ...card, faceUp: true })));
  next.moves += 1;
  next.stockPassMadeMove = true;
  const flipped = revealSourceTop(next, from);
  refreshStatus(next);
  next.message = flipped ? "New card revealed." : "Cards moved.";
  return {
    game: withHistory(next, game),
    sound: flipped ? "flip" : "move",
  };
};

export const autoMoveToFoundation = (game: GameState, from: MovePointer): ActionResult => {
  const [card] = readMovingCards(game, from);
  if (!card) {
    return fail(game, "Pick a face-up card.");
  }

  return moveCards(game, from, { zone: "foundation", suit: card.suit });
};

export const autoProgress = (game: GameState): ActionResult => {
  if (game.status !== "playing") {
    return fail(game, "Start a new deal first.");
  }

  const hints = findHints(game);
  const best =
    hints.find((candidate) => candidate.to.zone === "foundation") ??
    hints.find((candidate) => candidate.from.zone === "tableau" && willRevealCard(game, candidate.from)) ??
    hints.find((candidate) => candidate.to.zone === "tableau");

  if (best) {
    return moveCards(game, best.from, best.to);
  }

  if (game.stock.length) {
    return dealStock(game);
  }

  return jokerMove(game);
};

export const jokerMove = (game: GameState): ActionResult => {
  if (game.status !== "playing" && game.status !== "stuck") {
    return fail(game, "Start a new deal first.");
  }

  const nextFoundationCard = findNextFoundationCandidate(game);
  if (nextFoundationCard) {
    const next = cloneSnapshot(snapshotOf(game));
    next.status = "playing";
    next.finishedAt = null;
    const card = removeSpecificCard(next, nextFoundationCard.card.id);
    if (!card) {
      return fail(game, "Joker could not find a useful card.");
    }

    next.foundations[card.suit].push({ ...card, faceUp: true });
    next.moves += 1;
    next.stockPassMadeMove = true;
    const source = nextFoundationCard.source;
    if (source.zone === "tableau" && source.column !== undefined) {
      revealSourceTop(next, { zone: "tableau", column: source.column, index: Math.max(0, source.index ?? 0) });
    }
    refreshStatus(next);
    const statusAfterJoker = next.status as GameStatus;
    next.message =
      statusAfterJoker === "won"
        ? "Round cleared."
        : statusAfterJoker === "stuck"
          ? "No valid moves remain."
          : `Joker sent ${rankLabel(card.rank)} of ${suitName[card.suit]} home.`;
    return {
      game: withHistory(next, game),
      sound: statusAfterJoker === "won" ? "win" : "complete",
    };
  }

  const reveal = findBuriedReveal(game);
  if (reveal) {
    const next = cloneSnapshot(snapshotOf(game));
    next.status = "playing";
    next.finishedAt = null;
    next.tableau[reveal.column][reveal.index].faceUp = true;
    next.moves += 1;
    next.stockPassMadeMove = true;
    next.message = "Joker revealed a buried card.";
    refreshStatus(next);
    return { game: withHistory(next, game), sound: "flip" };
  }

  return fail(game, "No rescue move is available.");
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

export const findHints = (game: BoardSnapshot): Array<{ from: MovePointer; to: MovePointer; label: string }> => {
  if (game.status !== "playing") {
    return [];
  }

  const hints: Array<{ from: MovePointer; to: MovePointer; label: string }> = [];
  const wasteCard = game.waste[game.waste.length - 1];
  if (wasteCard) {
    collectCardHints(game, { zone: "waste" }, [wasteCard], hints);
  }

  game.tableau.forEach((column, columnIndex) => {
    column.forEach((card, cardIndex) => {
      if (!card.faceUp) {
        return;
      }
      const moving = column.slice(cardIndex);
      if (!isValidTableauRun(moving)) {
        return;
      }
      collectCardHints(game, { zone: "tableau", column: columnIndex, index: cardIndex }, moving, hints);
    });
  });

  if (!hints.length && game.stock.length) {
    hints.push({
      from: { zone: "waste" },
      to: { zone: "waste" },
      label: "No card move is available. Tap the stock pile to reveal the next card.",
    });
  } else if (!hints.length && game.waste.length && !hasStockLoop(game)) {
    hints.push({
      from: { zone: "waste" },
      to: { zone: "waste" },
      label: "Recycle the waste into stock. The board changed, so a new pass may open a move.",
    });
  }

  return hints.sort((first, second) => hintWeight(game, second) - hintWeight(game, first));
};

export const hasStockLoop = (game: BoardSnapshot) => {
  if (game.status !== "playing" || game.stock.length || !game.waste.length || game.stockPassMadeMove) {
    return false;
  }
  return stockCycleKeyAfterRecycle(game) === game.stockPassKey;
};

function findCardMoveHints(game: BoardSnapshot): Array<{ from: MovePointer; to: MovePointer; label: string }> {
  if (game.status !== "playing") {
    return [];
  }

  const hints: Array<{ from: MovePointer; to: MovePointer; label: string }> = [];
  const wasteCard = game.waste[game.waste.length - 1];
  if (wasteCard) {
    collectCardHints(game, { zone: "waste" }, [wasteCard], hints);
  }

  game.tableau.forEach((column, columnIndex) => {
    column.forEach((card, cardIndex) => {
      if (!card.faceUp) {
        return;
      }
      const moving = column.slice(cardIndex);
      if (!isValidTableauRun(moving)) {
        return;
      }
      collectCardHints(game, { zone: "tableau", column: columnIndex, index: cardIndex }, moving, hints);
    });
  });

  return hints;
}

function hintWeight(game: BoardSnapshot, hint: { from: MovePointer; to: MovePointer }) {
  if (hint.from.zone === "waste" && hint.to.zone === "waste") {
    return 5;
  }
  if (hint.to.zone === "foundation") {
    return 100;
  }
  if (hint.from.zone === "tableau" && willRevealCard(game, hint.from)) {
    return 80;
  }
  if (hint.from.zone === "waste") {
    return 55;
  }
  return 30;
}

function willRevealCard(game: BoardSnapshot, pointer: MovePointer) {
  if (pointer.zone !== "tableau" || pointer.column === undefined || pointer.index === undefined || pointer.index <= 0) {
    return false;
  }
  const source = game.tableau[pointer.column];
  return source[pointer.index - 1]?.faceUp === false;
}

function collectCardHints(
  game: BoardSnapshot,
  from: MovePointer,
  moving: Card[],
  hints: Array<{ from: MovePointer; to: MovePointer; label: string }>,
) {
  if (moving.length === 1 && canMoveToFoundation(game.foundations[moving[0].suit], moving[0])) {
    hints.push({
      from,
      to: { zone: "foundation", suit: moving[0].suit },
      label: `${describeCard(moving[0])}: move from ${describeSource(from)} to the ${suitName[moving[0].suit]} foundation.`,
    });
  }

  game.tableau.forEach((column, columnIndex) => {
    if (from.zone === "tableau" && from.column === columnIndex) {
      return;
    }
    if (canMoveToTableau(column, moving[0])) {
      const top = column[column.length - 1];
      const target = top ? `onto ${describeCard(top)} in column ${columnIndex + 1}` : `to empty column ${columnIndex + 1}`;
      const reason =
        from.zone === "tableau" && willRevealCard(game, from)
          ? " This reveals the hidden card underneath."
          : from.zone === "waste"
            ? " This clears the waste card so stock progress can continue."
            : " This creates a legal descending stack.";
      hints.push({
        from,
        to: { zone: "tableau", column: columnIndex },
        label: `${describeCard(moving[0])}: move from ${describeSource(from)} ${target}.${reason}`,
      });
    }
  });
}

function describeCard(card: Card) {
  return `${rankLabel(card.rank)} of ${suitName[card.suit]}`;
}

function describeSource(pointer: MovePointer) {
  if (pointer.zone === "waste") {
    return "the waste pile";
  }
  if (pointer.zone === "foundation" && pointer.suit) {
    return `the ${suitName[pointer.suit]} foundation`;
  }
  if (pointer.zone === "tableau" && pointer.column !== undefined) {
    return `column ${pointer.column + 1}`;
  }
  return "the selected pile";
}

function canMoveToFoundation(foundation: Card[], card: Card) {
  const top = foundation[foundation.length - 1];
  if (!top) {
    return card.rank === 1;
  }
  return top.suit === card.suit && card.rank === top.rank + 1;
}

function canMoveToTableau(column: Card[], card: Card) {
  const top = column[column.length - 1];
  if (!top) {
    return card.rank === 13;
  }
  return top.faceUp && top.rank === card.rank + 1 && cardColor(top.suit) !== cardColor(card.suit);
}

function readMovingCards(game: BoardSnapshot, pointer: MovePointer): Card[] {
  if (pointer.zone === "waste") {
    const card = game.waste[game.waste.length - 1];
    return card ? [card] : [];
  }

  if (pointer.zone === "foundation" && pointer.suit) {
    const card = game.foundations[pointer.suit][game.foundations[pointer.suit].length - 1];
    return card ? [card] : [];
  }

  if (pointer.zone === "tableau" && pointer.column !== undefined && pointer.index !== undefined) {
    const stack = game.tableau[pointer.column].slice(pointer.index);
    return isValidTableauRun(stack) ? stack : [];
  }

  return [];
}

function removeMovingCards(game: BoardSnapshot, pointer: MovePointer) {
  if (pointer.zone === "waste") {
    game.waste.pop();
  } else if (pointer.zone === "foundation" && pointer.suit) {
    game.foundations[pointer.suit].pop();
  } else if (pointer.zone === "tableau" && pointer.column !== undefined && pointer.index !== undefined) {
    game.tableau[pointer.column] = game.tableau[pointer.column].slice(0, pointer.index);
  }
}

function revealSourceTop(game: BoardSnapshot, pointer: MovePointer) {
  if (pointer.zone !== "tableau" || pointer.column === undefined) {
    return false;
  }

  const top = game.tableau[pointer.column][game.tableau[pointer.column].length - 1];
  if (top && !top.faceUp) {
    top.faceUp = true;
    return true;
  }
  return false;
}

function isValidTableauRun(stack: Card[]) {
  if (!stack.length || stack.some((card) => !card.faceUp)) {
    return false;
  }

  for (let index = 0; index < stack.length - 1; index += 1) {
    const current = stack[index];
    const next = stack[index + 1];
    if (current.rank !== next.rank + 1 || cardColor(current.suit) === cardColor(next.suit)) {
      return false;
    }
  }

  return true;
}

function refreshStatus(snapshot: BoardSnapshot) {
  const foundationCards = suits.reduce((total, suit) => total + snapshot.foundations[suit].length, 0);
  if (foundationCards >= 52) {
    snapshot.status = "won";
    snapshot.finishedAt = Date.now();
    snapshot.message = "Board cleared.";
    return;
  }

  if (snapshot.status === "playing" && !snapshot.stock.length && !snapshot.waste.length && findCardMoveHints(snapshot).length === 0) {
    snapshot.status = "stuck";
    snapshot.finishedAt = Date.now();
    snapshot.message = "No valid moves remain.";
  }
}

function stockCycleKeyAfterRecycle(game: BoardSnapshot) {
  const recycled = cloneSnapshot(game);
  recycled.stock = recycled.waste.slice().reverse().map((card) => ({ ...card, faceUp: false }));
  recycled.waste = [];
  return stockCycleKey(recycled);
}

function stockCycleKey(game: BoardSnapshot) {
  const tableauKey = game.tableau
    .map((column) => column.map((card) => `${card.id}:${card.faceUp ? "1" : "0"}`).join(","))
    .join("|");
  const foundationKey = suits.map((suit) => game.foundations[suit].map((card) => card.id).join(",")).join("|");
  const stockKey = game.stock.map((card) => card.id).join(",");
  return `${tableauKey}#${foundationKey}#${stockKey}`;
}

function findNextFoundationCandidate(game: BoardSnapshot): { card: Card; source: MovePointer } | null {
  const needed = suits
    .map((suit) => ({ suit, rank: (game.foundations[suit][game.foundations[suit].length - 1]?.rank ?? 0) + 1 }))
    .filter((entry) => entry.rank <= 13);

  const topWaste = game.waste[game.waste.length - 1];
  if (topWaste && needed.some((entry) => entry.suit === topWaste.suit && entry.rank === topWaste.rank)) {
    return { card: topWaste, source: { zone: "waste" } };
  }

  for (let column = 0; column < game.tableau.length; column += 1) {
    const top = game.tableau[column][game.tableau[column].length - 1];
    if (top?.faceUp && needed.some((entry) => entry.suit === top.suit && entry.rank === top.rank)) {
      return { card: top, source: { zone: "tableau", column, index: game.tableau[column].length - 1 } };
    }
  }

  for (const card of game.stock) {
    if (needed.some((entry) => entry.suit === card.suit && entry.rank === card.rank)) {
      return { card, source: { zone: "waste" } };
    }
  }

  for (let column = 0; column < game.tableau.length; column += 1) {
    const index = game.tableau[column].findIndex((card) => needed.some((entry) => entry.suit === card.suit && entry.rank === card.rank));
    if (index !== -1) {
      return { card: game.tableau[column][index], source: { zone: "tableau", column, index } };
    }
  }

  return null;
}

function findBuriedReveal(game: BoardSnapshot): { column: number; index: number } | null {
  let best: { column: number; index: number; depth: number } | null = null;
  for (let columnIndex = 0; columnIndex < game.tableau.length; columnIndex += 1) {
    const column = game.tableau[columnIndex];
    for (let cardIndex = 0; cardIndex < column.length; cardIndex += 1) {
      const card = column[cardIndex];
      if (card.faceUp) {
        continue;
      }
      const depth = column.length - cardIndex;
      if (!best || depth > best.depth) {
        best = { column: columnIndex, index: cardIndex, depth };
      }
    }
  }
  return best ? { column: best.column, index: best.index } : null;
}

function removeSpecificCard(game: BoardSnapshot, id: string): Card | null {
  const wasteIndex = game.waste.findIndex((card) => card.id === id);
  if (wasteIndex !== -1) {
    const [card] = game.waste.splice(wasteIndex, 1);
    return card;
  }

  const stockIndex = game.stock.findIndex((card) => card.id === id);
  if (stockIndex !== -1) {
    const [card] = game.stock.splice(stockIndex, 1);
    return card;
  }

  for (let column = 0; column < game.tableau.length; column += 1) {
    const cardIndex = game.tableau[column].findIndex((card) => card.id === id);
    if (cardIndex !== -1) {
      const [card] = game.tableau[column].splice(cardIndex, 1);
      return card;
    }
  }

  return null;
}

function emptyFoundations(): Record<Suit, Card[]> {
  return {
    spades: [],
    hearts: [],
    diamonds: [],
    clubs: [],
  };
}

function createDeck() {
  const cards: Card[] = [];
  suits.forEach((suit) => {
    for (let rank = 1; rank <= 13; rank += 1) {
      cards.push({ id: `${suit}-${rank}-${crypto.randomUUID()}`, suit, rank, faceUp: false });
    }
  });
  return cards;
}

function shuffle<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function snapshotOf(game: GameState): BoardSnapshot {
  return {
    tableau: game.tableau,
    stock: game.stock,
    waste: game.waste,
    foundations: game.foundations,
    moves: game.moves,
    status: game.status,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
    message: game.message,
    stockPassKey: game.stockPassKey,
    stockPassMadeMove: game.stockPassMadeMove,
  };
}

function cloneSnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  return {
    ...snapshot,
    tableau: snapshot.tableau.map((column) => column.map((card) => ({ ...card }))),
    stock: snapshot.stock.map((card) => ({ ...card })),
    waste: snapshot.waste.map((card) => ({ ...card })),
    foundations: {
      spades: snapshot.foundations.spades.map((card) => ({ ...card })),
      hearts: snapshot.foundations.hearts.map((card) => ({ ...card })),
      diamonds: snapshot.foundations.diamonds.map((card) => ({ ...card })),
      clubs: snapshot.foundations.clubs.map((card) => ({ ...card })),
    },
  };
}

function withHistory(snapshot: BoardSnapshot, previous: GameState): GameState {
  return {
    ...snapshot,
    history: [...previous.history.map(cloneSnapshot), cloneSnapshot(snapshotOf(previous))],
  };
}

function fail(game: GameState, message: string): ActionResult {
  return {
    game: { ...game, message },
    sound: "error",
  };
}
