const suits = ["♠", "♥", "♦", "♣"];
const values = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

let deck = [];
let waste = [];
let initialDeck = [];

let draggedCard = null;
let draggedStack = [];
let dragGhost = null;
let activePointerId = null;

let sourceColumn = null;
let currentDropColumn = null;
let currentDropFoundation = null;

let dragOffsetX = 0;
let dragOffsetY = 0;

function createDeck() {
  const deck = [];

  for (const suit of suits) {
    for (let i = 0; i < values.length; i++) {
      deck.push({
        suit: suit,
        value: values[i],
        rank: i + 1,
        color: suit === "♥" || suit === "♦" ? "red" : "black"
      });
    }
  }

  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[randomIndex]] = [deck[randomIndex], deck[i]];
  }

  return deck;
}

function renderCard(card, faceUp = true, columnNumber = null, source = "tableau") {
  const cardElement = document.createElement("div");
  cardElement.classList.add("playing-card");

  cardElement.dataset.source = source;
  cardElement.dataset.value = card.value;
  cardElement.dataset.suit = card.suit;
  cardElement.dataset.rank = card.rank;
  cardElement.dataset.color = card.color;
  cardElement.dataset.faceUp = String(faceUp);
  cardElement.dataset.column = columnNumber ?? "";

  if (!faceUp) {
    cardElement.classList.add("face-down");
    return cardElement;
  }

  if (card.color === "red") {
    cardElement.classList.add("red");
  }

  const topLeft = document.createElement("div");
  topLeft.classList.add("card-corner", "top-left");
  topLeft.innerHTML = `${card.value}<br>${card.suit}`;

  const bottomRight = document.createElement("div");
  bottomRight.classList.add("card-corner", "bottom-right");
  bottomRight.innerHTML = `${card.value}<br>${card.suit}`;

  const center = document.createElement("div");
  center.classList.add("card-center");
  center.textContent = card.suit;

  cardElement.appendChild(topLeft);
  cardElement.appendChild(center);
  cardElement.appendChild(bottomRight);

  cardElement.addEventListener("pointerdown", pointerDragStart);

  return cardElement;
}

function dealTableau(deck) {
  for (let columnNumber = 1; columnNumber <= 7; columnNumber++) {
    const columnElement = document.getElementById(`column-${columnNumber}`);
    columnElement.innerHTML = "";

    for (let cardIndex = 0; cardIndex < columnNumber; cardIndex++) {
      const card = deck.pop();
      const isLastCard = cardIndex === columnNumber - 1;
      const cardElement = renderCard(card, isLastCard, columnNumber, "tableau");
      columnElement.appendChild(cardElement);
    }
  }
}

function renderStock() {
  const stockElement = document.getElementById("stock");
  stockElement.innerHTML = "";

  const cardBack = document.createElement("div");
  cardBack.classList.add("playing-card", "face-down");

  if (deck.length === 0) {
    cardBack.classList.add("stock-empty");
    cardBack.textContent = "↻";
    cardBack.style.fontSize = "40px";
    cardBack.style.color = "white";
  }

  stockElement.appendChild(cardBack);
}

function renderWaste() {
  const wasteElement = document.getElementById("waste");
  wasteElement.innerHTML = "";

  if (waste.length > 0) {
    const topCard = waste[waste.length - 1];
    const cardElement = renderCard(topCard, true, null, "waste");
    wasteElement.appendChild(cardElement);
  }
}

function drawCard() {

  // dacă stock e gol, resetăm din waste
  if (deck.length === 0) {

    if (waste.length === 0) return;

    deck = waste.reverse();
    waste = [];

    renderStock();
    renderWaste();
    return;
  }

  const card = deck.pop();
  waste.push(card);

  renderStock();
  renderWaste();
}

function isValidStack(stack) {
  if (stack.length <= 1) return true;

  for (let i = 0; i < stack.length - 1; i++) {
    const currentCard = stack[i];
    const nextCard = stack[i + 1];

    const currentColor = currentCard.dataset.color;
    const nextColor = nextCard.dataset.color;

    const currentRank = parseInt(currentCard.dataset.rank, 10);
    const nextRank = parseInt(nextCard.dataset.rank, 10);

    const oppositeColors = currentColor !== nextColor;
    const descendingOrder = nextRank === currentRank - 1;

    if (!oppositeColors || !descendingOrder) {
      return false;
    }
  }

  return true;
}

function isValidMove(cardToMove, targetColumn) {
  const cardsInColumn = targetColumn.querySelectorAll(".playing-card");

  if (cardsInColumn.length === 0) {
    return cardToMove.dataset.value === "K";
  }

  const topCard = cardsInColumn[cardsInColumn.length - 1];

  if (topCard.dataset.faceUp !== "true") {
    return false;
  }

  const draggedColor = cardToMove.dataset.color;
  const targetColor = topCard.dataset.color;

  const draggedRank = parseInt(cardToMove.dataset.rank, 10);
  const targetRank = parseInt(topCard.dataset.rank, 10);

  const isOppositeColor = draggedColor !== targetColor;
  const isOneLower = draggedRank === targetRank - 1;

  return isOppositeColor && isOneLower;
}

function isValidFoundationMove(cardToMove, foundationElement) {
  if (!cardToMove || draggedStack.length !== 1) {
    return false;
  }

  const cardsInFoundation = foundationElement.querySelectorAll(".playing-card");

  if (cardsInFoundation.length === 0) {
    return cardToMove.dataset.rank === "1";
  }

  const topCard = cardsInFoundation[cardsInFoundation.length - 1];

  const sameSuit = cardToMove.dataset.suit === topCard.dataset.suit;
  const draggedRank = parseInt(cardToMove.dataset.rank, 10);
  const topRank = parseInt(topCard.dataset.rank, 10);

  return sameSuit && draggedRank === topRank + 1;
}

function revealLastFaceDownCardInColumn(columnElement, columnNumber) {
  const cards = columnElement.querySelectorAll(".playing-card");

  if (cards.length === 0) return;

  const lastCard = cards[cards.length - 1];

  if (lastCard.dataset.faceUp === "false") {
    const cardData = {
      value: lastCard.dataset.value,
      suit: lastCard.dataset.suit,
      rank: parseInt(lastCard.dataset.rank, 10),
      color: lastCard.dataset.color
    };

    const newFaceUpCard = renderCard(cardData, true, columnNumber, "tableau");
    columnElement.removeChild(lastCard);
    columnElement.appendChild(newFaceUpCard);
  }
}

function pointerDragStart(event) {
  if (event.button !== 0 || event.isPrimary === false || draggedCard) return;

  const card = event.currentTarget;

  if (card.dataset.faceUp !== "true") return;

  const parent = card.parentElement;
  const parentIsTableau = parent.classList.contains("tableau-column");

  if (parent.classList.contains("foundation") && card !== parent.lastElementChild) return;

  let possibleStack = [card];

  if (parentIsTableau) {
    const cardsInColumn = Array.from(parent.querySelectorAll(".playing-card"));
    const startIndex = cardsInColumn.indexOf(card);
    possibleStack = cardsInColumn.slice(startIndex);

    if (!isValidStack(possibleStack)) return;
  }

  draggedCard = card;
  draggedStack = possibleStack;
  sourceColumn = parentIsTableau ? parent : null;
  activePointerId = event.pointerId;

  const rect = card.getBoundingClientRect();
  dragOffsetX = event.clientX - rect.left;
  dragOffsetY = event.clientY - rect.top;

  dragGhost = document.createElement("div");
  dragGhost.classList.add("drag-stack");

  draggedStack.forEach((stackCard) => {
    const clone = stackCard.cloneNode(true);
    clone.style.pointerEvents = "none";
    dragGhost.appendChild(clone);
    stackCard.style.visibility = "hidden";
  });

  document.body.appendChild(dragGhost);
  moveDragGhost(event.clientX, event.clientY);
  document.body.setPointerCapture(activePointerId);

  document.addEventListener("pointermove", pointerDragMove);
  document.addEventListener("pointerup", pointerDragEnd);
  document.addEventListener("pointercancel", cancelDrag);
  document.addEventListener("lostpointercapture", cancelDrag);
  window.addEventListener("blur", cancelDrag);
}

function pointerDragMove(event) {
  if (!dragGhost || event.pointerId !== activePointerId) return;

  moveDragGhost(event.clientX, event.clientY);

  const column = getColumnUnderPointer(event.clientX, event.clientY);
  const foundation = getFoundationUnderPointer(event.clientX, event.clientY);

  updateDropHighlight(column, foundation);
}

function moveDragGhost(clientX, clientY) {
  dragGhost.style.transform = `translate(${clientX - dragOffsetX}px, ${clientY - dragOffsetY}px)`;
}

function getColumnUnderPointer(x, y) {
  const element = document.elementFromPoint(x, y);
  if (!element) return null;

  return element.closest(".tableau-column");
}

function getFoundationUnderPointer(x, y) {
  const element = document.elementFromPoint(x, y);
  if (!element) return null;

  return element.closest(".foundation");
}

function updateDropHighlight(column, foundation) {
  for (let i = 1; i <= 7; i++) {
    document.getElementById(`column-${i}`).classList.remove("drop-highlight");
  }

  for (let i = 1; i <= 4; i++) {
    document.getElementById(`foundation-${i}`).classList.remove("drop-highlight");
  }

  currentDropColumn = null;
  currentDropFoundation = null;

  if (column && draggedCard && isValidMove(draggedCard, column)) {
    column.classList.add("drop-highlight");
    currentDropColumn = column;
    return;
  }

  if (foundation && draggedCard && isValidFoundationMove(draggedCard, foundation)) {
    foundation.classList.add("drop-highlight");
    currentDropFoundation = foundation;
  }
}

function pointerDragEnd(event) {
  if (!draggedCard || event.pointerId !== activePointerId) return;

  // Use the release position, even if it differs from the last pointermove.
  pointerDragMove(event);

  if (currentDropColumn && draggedCard && draggedStack.length > 0) {
    if (draggedCard.dataset.source === "waste") {
      waste.pop();
      renderWaste();
    }

    draggedStack.forEach((card) => {
      card.dataset.source = "tableau";
      card.dataset.column = currentDropColumn.id.replace("column-", "");
      currentDropColumn.appendChild(card);
      card.style.visibility = "visible";
    });

    if (sourceColumn) {
      const sourceColumnNumber = parseInt(sourceColumn.id.replace("column-", ""), 10);
      revealLastFaceDownCardInColumn(sourceColumn, sourceColumnNumber);
    }
  } else if (currentDropFoundation && draggedCard && draggedStack.length === 1) {
    if (draggedCard.dataset.source === "waste") {
      waste.pop();
      renderWaste();
    }

    draggedCard.dataset.source = "foundation";
    draggedCard.dataset.column = "";
    currentDropFoundation.appendChild(draggedCard);
    draggedCard.style.visibility = "visible";

    if (sourceColumn) {
      const sourceColumnNumber = parseInt(sourceColumn.id.replace("column-", ""), 10);
      revealLastFaceDownCardInColumn(sourceColumn, sourceColumnNumber);
    }
    checkWin();
  } else {
    draggedStack.forEach((card) => {
      card.style.visibility = "visible";
    });
  }

  cleanupDrag();
}

function cancelDrag(event) {
  if (event.type !== "blur" && event.pointerId !== activePointerId) return;
  cleanupDrag();
}

function cleanupDrag() {
  draggedStack.forEach((card) => {
    card.style.visibility = "visible";
  });

  if (dragGhost) {
    dragGhost.remove();
    dragGhost = null;
  }

  for (let i = 1; i <= 7; i++) {
    document.getElementById(`column-${i}`).classList.remove("drop-highlight");
  }

  for (let i = 1; i <= 4; i++) {
    document.getElementById(`foundation-${i}`).classList.remove("drop-highlight");
  }

  draggedCard = null;
  draggedStack = [];
  sourceColumn = null;
  currentDropColumn = null;
  currentDropFoundation = null;

  document.removeEventListener("pointermove", pointerDragMove);
  document.removeEventListener("pointerup", pointerDragEnd);
  document.removeEventListener("pointercancel", cancelDrag);
  document.removeEventListener("lostpointercapture", cancelDrag);
  window.removeEventListener("blur", cancelDrag);

  if (activePointerId !== null && document.body.hasPointerCapture(activePointerId)) {
    document.body.releasePointerCapture(activePointerId);
  }
  activePointerId = null;
}

function startGame(restart = false) {
  cleanupDrag();

  if (!restart || initialDeck.length === 0) {
    initialDeck = shuffleDeck(createDeck());
  }

  deck = initialDeck.slice();
  waste = [];

  for (let i = 1; i <= 4; i++) {
    document.getElementById(`foundation-${i}`).innerHTML = "";
  }
  document.getElementById("win-message").classList.add("hidden");

  dealTableau(deck);
  renderStock();
  renderWaste();
}

function checkWin() {
  let totalFoundationCards = 0;

  for (let i = 1; i <= 4; i++) {
    const foundation = document.getElementById(`foundation-${i}`);
    const cards = foundation.querySelectorAll(".playing-card");
    totalFoundationCards += cards.length;
  }

  if (totalFoundationCards === 52) {
    const winMessage = document.getElementById("win-message");
    winMessage.classList.remove("hidden");
  }
}

document.getElementById("stock").addEventListener("click", drawCard);
document.getElementById("new-game-btn").addEventListener("click", () => startGame());
document.getElementById("restart-btn").addEventListener("click", () => startGame(true));
document.getElementById("win-new-game-btn").addEventListener("click", () => startGame());

startGame();
