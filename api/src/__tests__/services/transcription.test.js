'use strict';

const { stripMaxCommands, parseCommands } = require('../../services/transcription');

describe('stripMaxCommands', () => {
  it('returns unchanged text when no commands present', () => {
    const text = 'We need to move the toilet to the left wall.';
    const { cleaned, commands } = stripMaxCommands(text);
    expect(cleaned).toBe(text);
    expect(commands).toHaveLength(0);
  });

  it('strips "hey max" greeting', () => {
    const { cleaned, commands } = stripMaxCommands('hey max we are starting the rough-in today.');
    expect(cleaned).not.toContain('hey max');
    expect(commands.some(c => /hey\s+max/i.test(c.raw))).toBe(true);
  });

  it('strips "max, here are the plans" command', () => {
    const { cleaned, commands } = stripMaxCommands(
      'Max, here are the plans for the master bathroom.'
    );
    expect(cleaned).not.toMatch(/here are the plans/i);
    expect(commands.some(c => /here are the plans?/i.test(c.raw))).toBe(true);
  });

  it('strips "max, take a photo" command', () => {
    const { cleaned, commands } = stripMaxCommands(
      'Max, take a photo of the pipe stub-out.'
    );
    expect(cleaned).not.toMatch(/take a photo/i);
    expect(commands.some(c => /take a photo/i.test(c.raw))).toBe(true);
  });

  it('strips "max, new room" command and captures room name', () => {
    const { cleaned, commands } = stripMaxCommands(
      'max, new room master bathroom, two sinks and a toilet.'
    );
    expect(cleaned).not.toMatch(/new room/i);
    const newRoomCmd = commands.find(c => /new room/i.test(c.raw));
    expect(newRoomCmd).toBeDefined();
    expect(newRoomCmd.capture).toMatch(/master bathroom/i);
  });

  it('strips "max, flag that" command', () => {
    const { cleaned, commands } = stripMaxCommands(
      'The hose bib location seems wrong. Max, flag that for later.'
    );
    expect(cleaned).not.toMatch(/flag that/i);
    expect(commands.some(c => /flag that/i.test(c.raw))).toBe(true);
  });

  it('strips "max, this is" job tag command and captures the tag', () => {
    const { cleaned, commands } = stripMaxCommands(
      'max, this is oak creek lot 42 rough-in inspection.'
    );
    expect(cleaned).not.toMatch(/this is/i);
    const thisIsCmd = commands.find(c => /this is/i.test(c.raw));
    expect(thisIsCmd).toBeDefined();
    expect(thisIsCmd.capture).toMatch(/oak creek lot 42/i);
  });

  it('strips "max, stop" command', () => {
    const { cleaned, commands } = stripMaxCommands('ok max, stop.');
    expect(commands.some(c => /stop/i.test(c.raw))).toBe(true);
  });

  it('strips "got it max" acknowledgement', () => {
    const { cleaned, commands } = stripMaxCommands(
      'The toilet moves to the south wall. Got it max.'
    );
    expect(cleaned).not.toMatch(/got it max/i);
    expect(commands.some(c => /got it max/i.test(c.raw))).toBe(true);
  });

  it('strips multiple commands from a single transcript', () => {
    const text =
      'hey max we are starting. max, new room kitchen. max, flag that for inspection. max, stop.';
    const { cleaned, commands } = stripMaxCommands(text);
    expect(commands.length).toBeGreaterThanOrEqual(3);
    expect(cleaned).not.toMatch(/hey max/i);
    expect(cleaned).not.toMatch(/new room/i);
    expect(cleaned).not.toMatch(/flag that/i);
  });

  it('collapses extra whitespace after stripping', () => {
    const { cleaned } = stripMaxCommands('hey max   install two toilets.');
    expect(cleaned).not.toMatch(/\s{2,}/);
  });

  it('handles empty string input', () => {
    const { cleaned, commands } = stripMaxCommands('');
    expect(cleaned).toBe('');
    expect(commands).toHaveLength(0);
  });

  it('preserves non-command speech content', () => {
    const { cleaned } = stripMaxCommands(
      'hey max the master bath has two sinks and one toilet, rough-in today.'
    );
    expect(cleaned).toContain('two sinks and one toilet');
    expect(cleaned).toContain('rough-in today');
  });

  it('is case-insensitive for command matching', () => {
    const { commands } = stripMaxCommands('HEY MAX take a PHOTO.');
    expect(commands.length).toBeGreaterThan(0);
  });
});

describe('parseCommands', () => {
  it('returns empty metadata for empty command array', () => {
    const meta = parseCommands([]);
    expect(meta.roomMarkers).toEqual([]);
    expect(meta.flags).toEqual([]);
    expect(meta.jobTag).toBeNull();
    expect(meta.planAttachRequested).toBe(false);
    expect(meta.photoRequested).toBe(false);
  });

  it('extracts room markers from "new room" commands', () => {
    const commands = [{ raw: 'max, new room kitchen', capture: 'kitchen', index: 0 }];
    const meta = parseCommands(commands);
    expect(meta.roomMarkers).toContain('kitchen');
  });

  it('uses "unnamed" when new room has no capture', () => {
    const commands = [{ raw: 'max, new room', capture: null, index: 0 }];
    const meta = parseCommands(commands);
    expect(meta.roomMarkers).toContain('unnamed');
  });

  it('records flag positions from "flag that" commands', () => {
    const commands = [{ raw: 'max, flag that', capture: null, index: 42 }];
    const meta = parseCommands(commands);
    expect(meta.flags).toContain(42);
  });

  it('extracts job tag from "this is" command', () => {
    const commands = [{ raw: 'max, this is oak creek lot 12', capture: 'oak creek lot 12', index: 0 }];
    const meta = parseCommands(commands);
    expect(meta.jobTag).toBe('oak creek lot 12');
  });

  it('sets planAttachRequested when "here are the plans" is present', () => {
    const commands = [{ raw: 'max, here are the plans', capture: null, index: 0 }];
    const meta = parseCommands(commands);
    expect(meta.planAttachRequested).toBe(true);
  });

  it('sets photoRequested when "take a photo" is present', () => {
    const commands = [{ raw: 'max, take a photo', capture: null, index: 0 }];
    const meta = parseCommands(commands);
    expect(meta.photoRequested).toBe(true);
  });

  it('handles multiple commands of different types in one pass', () => {
    const commands = [
      { raw: 'max, new room master bath', capture: 'master bath', index: 5 },
      { raw: 'max, flag that', capture: null, index: 30 },
      { raw: 'max, this is oak creek lot 7', capture: 'oak creek lot 7', index: 55 },
      { raw: 'max, take a photo', capture: null, index: 80 },
    ];
    const meta = parseCommands(commands);
    expect(meta.roomMarkers).toContain('master bath');
    expect(meta.flags).toContain(30);
    expect(meta.jobTag).toBe('oak creek lot 7');
    expect(meta.photoRequested).toBe(true);
  });

  it('accumulates multiple room markers', () => {
    const commands = [
      { raw: 'max, new room kitchen', capture: 'kitchen', index: 0 },
      { raw: 'max, new room master bath', capture: 'master bath', index: 50 },
      { raw: 'max, new room hall bath', capture: 'hall bath', index: 100 },
    ];
    const meta = parseCommands(commands);
    expect(meta.roomMarkers).toHaveLength(3);
    expect(meta.roomMarkers).toEqual(['kitchen', 'master bath', 'hall bath']);
  });
});
