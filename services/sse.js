const { EventEmitter } = require('events');

// Simple SSE hub keyed by titleId
const titleIdToClients = new Map(); // Map<number|string, Set<res>>
const internalBus = new EventEmitter();

function subscribe(titleId, res) {
  const key = String(titleId);
  if (!titleIdToClients.has(key)) {
    titleIdToClients.set(key, new Set());
  }
  titleIdToClients.get(key).add(res);

  // Send a connected ping
  writeEvent(res, { type: 'connected', payload: { titleId } });
}

function unsubscribe(titleId, res) {
  const key = String(titleId);
  const set = titleIdToClients.get(key);
  if (set) {
    set.delete(res);
    if (set.size === 0) titleIdToClients.delete(key);
  }
}

function writeEvent(res, data) {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (_) {
    // Ignore write errors (client disconnected)
  }
}

function publish(titleId, event) {
  const key = String(titleId);
  const set = titleIdToClients.get(key);
  if (set) {
    for (const res of set) {
      writeEvent(res, event);
    }
  }
  internalBus.emit('event', { titleId: key, event });
}

module.exports = {
  subscribe,
  unsubscribe,
  publish,
};


