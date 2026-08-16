/**
 * The "select all that apply" question type, end to end through the pure
 * parts, and the integrity of the suggested-question catalogue.
 *
 * The multi type is the first answer shape that is not a string, so the cases
 * worth pinning down are the boundaries between the two: what the submit
 * validator accepts, what survives a round trip through jsonb, and what the
 * review screen shows a human.
 */

import { describe, expect, it } from 'vitest';

import { labelAnswers, parseAnswers } from '@/db/queries/early-access';
import {
  EARLY_ACCESS_PRESETS,
  PRESET_QUESTIONS,
  isPreset,
  presetById,
} from '@/lib/early-access-presets';
import {
  EARLY_ACCESS_LIMITS,
  isChoiceType,
  isQuestionId,
  parseEarlyAccessQuestions,
  type EarlyAccessQuestion,
} from '@/lib/site-settings';

describe('the multi question type', () => {
  it('is a choice type and needs options', () => {
    expect(isChoiceType('multi')).toBe(true);
    expect(isChoiceType('select')).toBe(true);
    expect(isChoiceType('short')).toBe(false);

    // A choice with nothing to choose from cannot be answered, so it is
    // dropped rather than published as an unanswerable required field.
    expect(parseEarlyAccessQuestions([
      { id: 'devices', label: 'Devices', type: 'multi', required: true, options: [] },
    ])).toEqual([]);
  });

  it('survives a round trip through the question parser', () => {
    const [question] = parseEarlyAccessQuestions([{
      id: 'devices',
      label: 'What devices would you test on?',
      type: 'multi',
      required: false,
      options: ['Windows PC', 'Mac', 'Mac', 'iPhone'],
    }]);
    expect(question.type).toBe('multi');
    // Deduplicated, like every other option list.
    expect(question.options).toEqual(['Windows PC', 'Mac', 'iPhone']);
  });
});

describe('parseAnswers', () => {
  it('keeps an array answer as an array', () => {
    expect(parseAnswers('{"devices":["Windows PC","iPhone"]}'))
      .toEqual({ devices: ['Windows PC', 'iPhone'] });
  });

  it('accepts an already-decoded object as well as raw jsonb text', () => {
    expect(parseAnswers({ devices: ['Mac'] })).toEqual({ devices: ['Mac'] });
  });

  it('treats an empty array as an unanswered question', () => {
    expect(parseAnswers('{"devices":[],"why":"because"}')).toEqual({ why: 'because' });
  });

  it('drops empty members but keeps the rest', () => {
    expect(parseAnswers('{"d":["Mac","",null,"iPhone"]}'))
      .toEqual({ d: ['Mac', 'iPhone'] });
  });

  it('still returns null for an unusable column', () => {
    expect(parseAnswers(null)).toBeNull();
    expect(parseAnswers('not json')).toBeNull();
    expect(parseAnswers('[]')).toBeNull();
    expect(parseAnswers('{}')).toBeNull();
  });
});

describe('labelAnswers', () => {
  const questions: EarlyAccessQuestion[] = [
    { id: 'devices', label: 'Devices', type: 'multi', required: false, options: ['Mac'] },
    { id: 'why', label: 'Why?', type: 'long', required: false },
  ];

  it('renders several ticks as one readable line', () => {
    const [first] = labelAnswers({ devices: ['Windows PC', 'iPhone'] }, questions);
    expect(first).toEqual({
      label: 'Devices', value: 'Windows PC, iPhone', orphaned: false,
    });
  });

  it('keeps an answer whose question has been removed, under its bare id', () => {
    const labelled = labelAnswers({ gone: ['a', 'b'] }, questions);
    expect(labelled).toEqual([{ label: 'gone', value: 'a, b', orphaned: true }]);
  });

  it('skips a question answered with an empty list', () => {
    expect(labelAnswers({ devices: [] }, questions)).toEqual([]);
  });
});

describe('the suggested question catalogue', () => {
  it('has unique, legal ids', () => {
    const ids = PRESET_QUESTIONS.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isQuestionId(id)).toBe(true);
  });

  it('survives the parser unchanged — a preset is an ordinary question', () => {
    // If a preset did not round-trip, ticking it on would silently store
    // something other than what the admin was shown.
    const parsed = parseEarlyAccessQuestions(PRESET_QUESTIONS.slice(0, EARLY_ACCESS_LIMITS.maxQuestions));
    expect(parsed).toEqual(PRESET_QUESTIONS.slice(0, EARLY_ACCESS_LIMITS.maxQuestions));
  });

  it('fits inside the question and option limits', () => {
    expect(PRESET_QUESTIONS.length).toBeLessThanOrEqual(EARLY_ACCESS_LIMITS.maxQuestions);
    for (const question of PRESET_QUESTIONS) {
      if (question.options) {
        expect(question.options.length).toBeLessThanOrEqual(EARLY_ACCESS_LIMITS.maxOptions);
        expect(new Set(question.options).size).toBe(question.options.length);
      }
    }
  });

  it('gives every choice question something to choose from', () => {
    for (const question of PRESET_QUESTIONS) {
      if (isChoiceType(question.type)) {
        expect(question.options?.length ?? 0).toBeGreaterThan(0);
      } else {
        expect(question.options).toBeUndefined();
      }
    }
  });

  it('asks nothing as required — the whole set is optional', () => {
    // A long optional form is answered; a long required one is abandoned.
    for (const question of PRESET_QUESTIONS) expect(question.required).toBe(false);
  });

  it('offers all eighteen AFL clubs plus an escape hatch', () => {
    const club = presetById('club');
    expect(club?.options).toHaveLength(19);
    expect(club?.options).toContain('Western Bulldogs');
    expect(club?.options).toContain('Greater Western Sydney');
    expect(club?.options).toContain('Other / No team');
  });

  it('lists skills that match what this project is actually built from', () => {
    const skills = presetById('skills');
    for (const skill of ['SQL / databases', 'Python', 'Web development', 'UI/UX']) {
      expect(skills?.options).toContain(skill);
    }
  });

  it('recognises its own questions by id, however they are reworded', () => {
    const reworded = { ...PRESET_QUESTIONS[0], label: 'Completely different wording' };
    expect(isPreset(reworded)).toBe(true);
    expect(isPreset({ id: 'invented', label: 'x', type: 'short', required: false })).toBe(false);
  });

  it('groups every question exactly once', () => {
    const grouped = EARLY_ACCESS_PRESETS.flatMap((group) => group.questions);
    expect(grouped).toHaveLength(PRESET_QUESTIONS.length);
    expect(new Set(EARLY_ACCESS_PRESETS.map((group) => group.id)).size)
      .toBe(EARLY_ACCESS_PRESETS.length);
  });
});
