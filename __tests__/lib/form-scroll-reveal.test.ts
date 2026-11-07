import { revealOffset } from '@/components/common/form-scroll-view';

// A 300px visible window (e.g. what's left above the keyboard), 24px gap.
const base = { scrollY: 0, visibleHeight: 300, gap: 24 };

describe('revealOffset', () => {
  it('leaves a field that is already comfortably visible alone', () => {
    expect(revealOffset({ ...base, fieldTop: 100, fieldHeight: 48 })).toBeNull();
  });

  it('scrolls a field hidden under the keyboard up until it sits just above it', () => {
    // Note field at the bottom of the form: 500..548 in content coordinates.
    expect(revealOffset({ ...base, fieldTop: 500, fieldHeight: 48 })).toBe(548 + 24 - 300);
  });

  it('scrolls a field that only partly peeks above the keyboard', () => {
    expect(revealOffset({ ...base, fieldTop: 260, fieldHeight: 48 })).toBe(260 + 48 + 24 - 300);
  });

  it('keeps the top of a field taller than the visible area in view', () => {
    expect(revealOffset({ ...base, fieldTop: 400, fieldHeight: 500 })).toBe(400 - 24);
  });

  it('scrolls back down to a field above the visible area', () => {
    expect(revealOffset({ ...base, scrollY: 400, fieldTop: 380, fieldHeight: 48 })).toBe(380 - 24);
  });

  it('never returns a negative offset', () => {
    expect(revealOffset({ ...base, scrollY: 50, fieldTop: 10, fieldHeight: 48 })).toBe(0);
  });
});
