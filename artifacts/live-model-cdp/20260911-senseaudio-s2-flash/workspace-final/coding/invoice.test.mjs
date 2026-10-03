import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceTotal } from './invoice.mjs';
test('quantity is included', () => assert.equal(invoiceTotal([{priceCents:1299,qty:2},{priceCents:550,qty:3},{priceCents:3000,qty:1}],500),6748));
test('empty invoice is zero', () => assert.equal(invoiceTotal([]),0));
test('discount cannot make total negative', () => assert.equal(invoiceTotal([{priceCents:100,qty:2}],500),0));
test('no discount', () => assert.equal(invoiceTotal([{priceCents:75,qty:4}]),300));
