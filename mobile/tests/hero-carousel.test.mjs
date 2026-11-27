import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carouselIndex, dragProgress, incomingIndex, slideWeight, snapDirection } from '../lib/hero-carousel.ts';

test('hero drag blends artwork and indicator weights linearly under the finger', () => {
  assert.equal(dragProgress(0, 180, 360), 0.5);
  assert.equal(slideWeight(0, 0, 0.5, -1, 6), 0.5);
  assert.equal(slideWeight(1, 0, 0.5, -1, 6), 0.5);
  assert.equal(slideWeight(2, 0, 0.5, -1, 6), 0);
  assert.equal(slideWeight(5, 0, -0.5, -1, 6), 0.5);
});

test('an interrupted drag continues from the visible progress and can reverse', () => {
  assert.equal(dragProgress(0.5, -180, 360), 0);
  assert.equal(dragProgress(0.5, -360, 360), -0.5);
  assert.equal(dragProgress(0.9, 200, 360), 1);
});

test('release uses distance or velocity, and a short slow pull cancels', () => {
  assert.equal(snapDirection(0.15, 0, 360), 0);
  assert.equal(snapDirection(0.5, 0, 360), 1);
  assert.equal(snapDirection(0.1, 700, 360), 1);
  assert.equal(snapDirection(-0.1, -700, 360), -1);
  assert.equal(snapDirection(-0.5, 0, 360), -1);
});

test('carousel wraps in both directions, and a dot tap blends directly', () => {
  assert.equal(carouselIndex(-1, 6), 5);
  assert.equal(carouselIndex(6, 6), 0);
  assert.equal(incomingIndex(0, -1, -1, 6), 5);
  assert.equal(incomingIndex(5, 1, -1, 6), 0);
  assert.equal(incomingIndex(0, 1, 4, 6), 4);
  assert.equal(slideWeight(4, 0, 0.5, 4, 6), 0.5);
  assert.equal(slideWeight(1, 0, 0.5, 4, 6), 0);
});
