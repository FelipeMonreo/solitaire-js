const assert = require('node:assert/strict');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const { launchBrowser } = require('./browser.cjs');

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });
beforeEach(async () => { await browser.reset(); });
afterEach(() => { assert.deepEqual(browser.errors, [], 'No script, console, or resource errors'); });

async function point(selector) {
  return browser.evaluate(`(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + 12 };
  })()`);
}

async function mouse(type, coordinates) {
  await browser.send('Input.dispatchMouseEvent', {
    type, ...coordinates, button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
  });
  await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => resolve()))');
}

async function drag(from, to) {
  await mouse('mousePressed', await point(from));
  await mouse('mouseMoved', await point(to));
  await mouse('mouseReleased', await point(to));
}

// Arrange known cards so move checks are independent of the shuffled deal.
async function arrange(expression) {
  await browser.evaluate(`(() => {
    cleanupDrag();
    document.querySelectorAll('.tableau-column, .foundation').forEach(pile => pile.innerHTML = '');
    waste = []; renderWaste();
    const card = (rank, suit = '♠', faceUp = true) => renderCard({
      value: values[rank - 1], rank, suit, color: ['♥', '♦'].includes(suit) ? 'red' : 'black'
    }, faceUp, 1, 'tableau');
    const column = number => document.getElementById('column-' + number);
    const foundation = number => document.getElementById('foundation-' + number);
    ${expression}
  })()`);
}

test('loads case-sensitive assets, the original design, and all 52 unique cards', async () => {
  const state = await browser.evaluate(`(() => ({
    stock: deck.length, waste: waste.length,
    columns: [...document.querySelectorAll('.tableau-column')].map(column => column.children.length),
    faceUp: document.querySelectorAll('.tableau-column [data-face-up="true"]').length,
    unique: new Set([...deck.map(card => card.suit + card.value),
      ...[...document.querySelectorAll('.tableau-column .playing-card')].map(card => card.dataset.suit + card.dataset.value)]).size,
    background: getComputedStyle(document.body).backgroundColor,
    language: document.documentElement.lang,
    hiddenWin: getComputedStyle(document.getElementById('win-message')).display
  }))()`);
  assert.deepEqual(state, {
    stock: 24, waste: 0, columns: [1, 2, 3, 4, 5, 6, 7], faceUp: 7, unique: 52,
    background: 'rgb(11, 102, 35)', language: 'ro', hiddenWin: 'none',
  });
});

test('draws one card and recycles waste in the original order', async () => {
  const order = await browser.evaluate('deck.map(card => card.suit + card.value).reverse()');
  const stock = await point('#stock');
  for (let index = 0; index < 24; index++) {
    await mouse('mousePressed', stock);
    await mouse('mouseReleased', stock);
    assert.equal(await browser.evaluate('waste.at(-1).suit + waste.at(-1).value'), order[index]);
  }
  assert.equal(await browser.evaluate('deck.length'), 0);
  assert.equal(await browser.evaluate('getComputedStyle(document.querySelector("#stock .playing-card"), "::after").content'), 'none');
  await mouse('mousePressed', stock);
  await mouse('mouseReleased', stock);
  assert.deepEqual(await browser.evaluate('[deck.length, waste.length]'), [24, 0]);
  await mouse('mousePressed', stock);
  await mouse('mouseReleased', stock);
  assert.equal(await browser.evaluate('waste.at(-1).suit + waste.at(-1).value'), order[0]);
});

test('moves a valid alternating stack and reveals the card beneath it', async () => {
  await arrange(`column(1).append(card(9, '♣', false), card(7, '♥'), card(6, '♠')); column(2).append(card(8, '♣'));`);
  await mouse('mousePressed', await point('#column-1 [data-rank="7"]'));
  assert.deepEqual(await browser.evaluate('draggedStack.map(card => card.dataset.rank)'), ['7', '6']);
  await mouse('mouseMoved', await point('#column-2 .playing-card'));
  assert.equal(await browser.evaluate('currentDropColumn?.id'), 'column-2');
  await mouse('mouseReleased', await point('#column-2 .playing-card'));
  assert.deepEqual(await browser.evaluate(`[
    [...document.querySelectorAll('#column-1 .playing-card')].map(card => card.dataset.rank),
    [...document.querySelectorAll('#column-2 .playing-card')].map(card => card.dataset.rank)
  ]`), [['9'], ['8', '7', '6']]);
  assert.deepEqual(await browser.evaluate(`[
    [...document.querySelectorAll('#column-2 .playing-card')].map(card => card.dataset.rank),
    document.querySelector('#column-1 .playing-card').dataset.faceUp,
    document.querySelector('#column-2 [data-rank="6"]').dataset.column,
    document.querySelectorAll('.drag-stack').length
  ]`), [['8', '7', '6'], 'true', '2', 0]);
});

test('rejects invalid tableau moves and restores dragged cards', async () => {
  await arrange(`column(1).append(card(7, '♥')); column(2).append(card(8, '♦'));`);
  await drag('#column-1 .playing-card', '#column-2 .playing-card');
  await drag('#column-1 .playing-card', '#column-3');
  assert.deepEqual(await browser.evaluate(`[
    document.getElementById('column-1').children.length,
    document.getElementById('column-2').children.length,
    document.getElementById('column-3').children.length,
    getComputedStyle(document.querySelector('#column-1 .playing-card')).visibility
  ]`), [1, 1, 0, 'visible']);
});

test('accepts a king in an empty tableau column', async () => {
  await arrange(`column(1).append(card(13));`);
  await drag('#column-1 .playing-card', '#column-2');
  assert.equal(await browser.evaluate('document.querySelector("#column-2 .playing-card").dataset.value'), 'K');
});

test('rejects malformed stacks and face-down cards', async () => {
  await arrange(`column(1).append(card(7, '♥'), card(6, '♦')); column(2).append(card(8, '♠')); column(3).append(card(13, '♣', false));`);
  await mouse('mousePressed', await point('#column-1 [data-rank="7"]'));
  assert.equal(await browser.evaluate('draggedCard'), null);
  await mouse('mouseReleased', await point('#column-1 [data-rank="7"]'));
  await drag('#column-3 .playing-card', '#column-4');
  assert.equal(await browser.evaluate('document.getElementById("column-4").children.length'), 0);
});

test('moves the waste card to the tableau without losing the next waste card', async () => {
  await arrange(`column(2).append(card(8, '♣'));
    waste = [{ value: 'K', rank: 13, suit: '♠', color: 'black' },
      { value: '7', rank: 7, suit: '♥', color: 'red' }]; renderWaste();`);
  await drag('#waste .playing-card', '#column-2 .playing-card');
  assert.deepEqual(await browser.evaluate(`[
    waste.length, document.querySelector('#waste .playing-card').dataset.value,
    document.querySelector('#column-2 .playing-card:last-child').dataset.source
  ]`), [1, 'K', 'tableau']);
});

test('foundation accepts aces, then ascending cards of the same suit', async () => {
  await arrange(`column(1).append(card(1)); column(2).append(card(2)); column(3).append(card(3, '♥')); column(4).append(card(4));`);
  await drag('#column-2 .playing-card', '#foundation-1');
  assert.equal(await browser.evaluate('document.getElementById("foundation-1").children.length'), 0);
  await drag('#column-1 .playing-card', '#foundation-1');
  await drag('#column-2 .playing-card', '#foundation-1');
  await drag('#column-3 .playing-card', '#foundation-1');
  await drag('#column-4 .playing-card', '#foundation-1');
  assert.deepEqual(await browser.evaluate(`[
    document.getElementById('foundation-1').children.length,
    getComputedStyle(document.querySelector('#foundation-1 .playing-card')).display,
    document.querySelector('#foundation-1 .playing-card:last-child').dataset.rank
  ]`), [2, 'none', '2']);
});

test('foundation rejects a stack and supports moving its top card back to the tableau', async () => {
  await arrange(`column(1).append(card(2, '♥'), card(1)); column(2).append(card(3, '♥'));
    const ace = card(1); ace.dataset.source = 'foundation';
    const two = card(2); two.dataset.source = 'foundation'; foundation(1).append(ace, two);`);
  await drag('#column-1 [data-rank="2"]', '#foundation-2');
  assert.equal(await browser.evaluate('document.getElementById("foundation-2").children.length'), 0);
  await drag('#foundation-1 .playing-card:last-child', '#column-2 .playing-card');
  assert.deepEqual(await browser.evaluate(`[
    document.getElementById('foundation-1').children.length,
    getComputedStyle(document.querySelector('#foundation-1 .playing-card')).display,
    document.querySelector('#column-2 .playing-card:last-child').dataset.rank
  ]`), [1, 'flex', '2']);
});

for (const interruption of ['pointercancel', 'lostpointercapture', 'blur']) {
  test(`restores the card after ${interruption}`, async () => {
    await mouse('mousePressed', await point('#column-1 .playing-card'));
    assert.equal(await browser.evaluate('document.querySelectorAll(".drag-stack").length'), 1);
    await browser.evaluate(interruption === 'blur'
      ? `window.dispatchEvent(new Event('blur'))`
      : `document.dispatchEvent(new PointerEvent('${interruption}', { pointerId: activePointerId }))`);
    assert.deepEqual(await browser.evaluate(`[
      document.querySelectorAll('.drag-stack').length,
      getComputedStyle(document.querySelector('#column-1 .playing-card')).visibility,
      activePointerId
    ]`), [0, 'visible', null]);
    await mouse('mouseReleased', await point('#column-1 .playing-card'));
  });
}

test('restart restores the same deal and clears foundations, waste, and win state', async () => {
  const snapshot = `JSON.stringify({ deck, columns: [...document.querySelectorAll('.tableau-column')].map(column => column.innerHTML) })`;
  const initial = await browser.evaluate(snapshot);
  await browser.evaluate(`drawCard();
    document.getElementById('foundation-1').append(document.querySelector('#column-1 .playing-card'));
    document.getElementById('win-message').classList.remove('hidden');
    document.getElementById('restart-btn').click();`);
  assert.equal(await browser.evaluate(snapshot), initial);
  assert.deepEqual(await browser.evaluate(`[
    waste.length, document.querySelectorAll('.foundation .playing-card').length,
    document.getElementById('win-message').classList.contains('hidden')
  ]`), [0, 0, true]);
});

test('new game shuffles a fresh deal and cancels an active drag', async () => {
  const initial = await browser.evaluate('JSON.stringify(initialDeck)');
  await mouse('mousePressed', await point('#column-1 .playing-card'));
  await browser.evaluate(`document.getElementById('new-game-btn').click()`);
  await mouse('mouseReleased', { x: 10, y: 10 });
  assert.notEqual(await browser.evaluate('JSON.stringify(initialDeck)'), initial);
  assert.deepEqual(await browser.evaluate(`[
    deck.length, waste.length, document.querySelectorAll('.drag-stack').length,
    document.querySelectorAll('.tableau-column .playing-card').length
  ]`), [24, 0, 0, 28]);
});

test('winning displays the message and its new-game button starts another game', async () => {
  await arrange(`for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) {
      if (suit === 3 && rank === 13) continue;
      const element = card(rank, suits[suit]); element.dataset.source = 'foundation';
      foundation(suit + 1).append(element);
    }
  }
  column(1).append(card(13, suits[3]));`);
  await drag('#column-1 .playing-card', '#foundation-4');
  assert.equal(await browser.evaluate('getComputedStyle(document.getElementById("win-message")).display'), 'flex');
  const button = await point('#win-new-game-btn');
  await mouse('mousePressed', button);
  await mouse('mouseReleased', button);
  assert.deepEqual(await browser.evaluate(`[
    deck.length, document.querySelectorAll('.foundation .playing-card').length,
    getComputedStyle(document.getElementById('win-message')).display
  ]`), [24, 0, 'none']);
});
