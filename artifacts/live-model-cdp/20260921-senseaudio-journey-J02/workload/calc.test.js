'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lineTotal, total } = require('./calc');

test('lineTotal multiplies price by quantity', () => {
  assert.equal(lineTotal({ price: 250, qty: 3 }), 750);
});

test('total sums line totals', () => {
  const items = [
    { price: 250, qty: 3 },
    { price: 1200, qty: 1 },
    { price: 99, qty: 2 },
  ];
  assert.equal(total(items), 2148);
});

test('total of empty cart is 0', () => {
  assert.equal(total([]), 0);
});
