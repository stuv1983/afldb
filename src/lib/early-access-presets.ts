/**
 * Ready-made early-access questions, opted into rather than typed out. The
 * form at /admin/settings can still build any question from scratch.
 *
 * IDS ARE PART OF THE CONTRACT. Answers are stored under a question's id
 * (migration 035), so toggling a preset off stops asking without erasing, and
 * re-adding it reunites the question with its earlier answers. Relabelling a
 * preset is safe; changing its `id` orphans that history and must not be done.
 *
 * Presets carry no privilege — each is a filled-in form, normalised through
 * `parseEarlyAccessQuestions` like any other submission, and editable or
 * deletable once added.
 */

import type { EarlyAccessQuestion } from '@/lib/site-settings';

/** The eighteen AFL clubs, plus the two answers that are not a club. */
const AFL_CLUBS = [
  'Adelaide', 'Brisbane Lions', 'Carlton', 'Collingwood', 'Essendon',
  'Fremantle', 'Geelong', 'Gold Coast', 'Greater Western Sydney', 'Hawthorn',
  'Melbourne', 'North Melbourne', 'Port Adelaide', 'Richmond', 'St Kilda',
  'Sydney', 'West Coast', 'Western Bulldogs',
  'Other / No team',
];

export type PresetGroup = {
  id: string;
  title: string;
  help: string;
  questions: EarlyAccessQuestion[];
};

/**
 * Grouped for the admin screen only. The grouping is not stored: a question
 * that is opted in becomes an ordinary member of the flat question list, and
 * the order it appears in on the public form is the order of that list.
 */
export const EARLY_ACCESS_PRESETS: PresetGroup[] = [
  {
    id: 'about-you',
    title: 'About you and footy',
    help: 'Who is asking, and how closely they follow the game. Cheap to answer '
      + 'and useful for reading everything else they say.',
    questions: [
      {
        id: 'nuffie',
        label: 'First things first — are you an AFL nuffie?',
        type: 'select',
        required: false,
        options: [
          'Absolutely, footy is basically a personality trait',
          'Pretty keen',
          'Casual fan',
          'Not really — I’m more interested in the data/tech',
        ],
      },
      {
        id: 'club',
        label: 'Which AFL team do you follow?',
        type: 'select',
        required: false,
        options: AFL_CLUBS,
      },
      {
        id: 'how-closely',
        label: 'How closely do you follow the AFL?',
        type: 'select',
        required: false,
        options: [
          'Every game I can',
          'My team + the big games',
          'Mostly finals',
          'Occasionally',
        ],
      },
      {
        id: 'nerd-out',
        label: 'What do you normally nerd out about?',
        help: 'Select all that apply.',
        type: 'multi',
        required: false,
        options: [
          'Players and career stats',
          'Club history',
          'Match results',
          'Brownlow / awards',
          'Drafts and trades',
          'Records and milestones',
          'AFL trivia',
          'Historical players/seasons',
          'Advanced stats/data analysis',
          'Fantasy/SuperCoach',
          'Other',
        ],
      },
    ],
  },
  {
    id: 'why',
    title: 'Why they want AFLDB',
    help: 'The most valuable group. “What would you most like to search for” in '
      + 'particular tends to surface queries and features nobody had thought of.',
    questions: [
      {
        id: 'interest',
        label: 'What would you actually use AFLDB for?',
        help: 'A sentence is plenty — it helps us prioritise what to build next.',
        type: 'long',
        required: false,
      },
      {
        id: 'useful',
        label: 'Would something like AFLDB be useful to you?',
        type: 'select',
        required: false,
        options: [
          'Yep, definitely',
          'Probably',
          'Maybe',
          'I just want to have a stickybeak',
        ],
      },
      {
        id: 'genuinely-useful',
        label: 'What would make AFLDB genuinely useful to you?',
        type: 'long',
        required: false,
      },
      {
        id: 'search-discover',
        label: 'What would you most like to be able to search or discover?',
        help: 'Anything at all — however specific or obscure.',
        type: 'long',
        required: false,
      },
    ],
  },
  {
    id: 'testing',
    title: 'Beta testing',
    help: 'How much of a workout the site is going to get, and whether problems '
      + 'will come back to you or be quietly tolerated.',
    questions: [
      {
        id: 'testing-appetite',
        label: 'How much testing are you keen to do?',
        type: 'select',
        required: false,
        options: [
          'Happy to poke around occasionally',
          'I’ll give it a decent workout',
          'I’ll actively try to break things',
          'Give me data and I’ll disappear down a rabbit hole',
        ],
      },
      {
        id: 'will-report',
        label: 'If you find something broken, weird or just plain wrong, will you report it?',
        type: 'select',
        required: false,
        options: ['Yep', 'Most likely', 'Maybe', 'Probably not'],
      },
      {
        id: 'will-feedback',
        label: 'Are you happy to provide feedback during and at the end of the beta?',
        type: 'select',
        required: false,
        options: ['Yes', 'Maybe', 'No'],
      },
      {
        id: 'devices',
        label: 'What devices would you test AFLDB on?',
        help: 'Select all that apply.',
        type: 'multi',
        required: false,
        options: [
          'Windows PC', 'Mac', 'iPhone', 'Android', 'iPad/tablet', 'Linux', 'Other',
        ],
      },
    ],
  },
  {
    id: 'skills',
    title: 'Skills and contributing',
    help: 'Optional by design — a tester needs no technical skill to be a very '
      + 'useful one, and a form that implies otherwise puts people off. Every '
      + 'question here is unticked and none should be made required.',
    questions: [
      {
        id: 'skills',
        label: 'Got any skills that could help AFLDB?',
        help: 'Select all that apply. Nothing here is expected — the last option is '
          + 'a perfectly good answer.',
        type: 'multi',
        required: false,
        // Deliberately matched to what this project is actually built from, so
        // an answer maps onto real work: PostgreSQL, TypeScript/React/Next.js,
        // the Python email-intake tool, and the CSV validation pipeline.
        options: [
          'AFL knowledge / walking footy encyclopaedia',
          'Data analysis',
          'SQL / databases',
          'Python',
          'Web development',
          'UI/UX',
          'Testing / QA',
          'Data validation / cleaning',
          'Statistics',
          'Research / historical records',
          'Writing/documentation',
          'Other technical skills',
          'None — I’m just here for the footy',
        ],
      },
      {
        id: 'keep-accurate',
        label: 'Interested in helping keep AFLDB’s data accurate and up to date?',
        type: 'select',
        required: false,
        options: ['Yep', 'Maybe', 'Not really'],
      },
      {
        id: 'csv-contribute',
        label: 'Would you be willing to contribute data using provided CSV templates?',
        help: 'For some datasets AFLDB provides a CSV template with the required '
          + 'columns. Contributors research and fill in missing or updated '
          + 'information, and it is validated before anything is added to the '
          + 'database.',
        type: 'select',
        required: false,
        options: [
          'Yep, happy to contribute',
          'Maybe, depending on the data',
          'I’d rather help validate existing data',
          'No thanks',
        ],
      },
      {
        id: 'data-interests',
        label: 'What sort of data would you be interested in helping with?',
        help: 'Select all that apply.',
        type: 'multi',
        required: false,
        options: [
          'Players', 'Matches/results', 'Clubs', 'Awards', 'Brownlow votes',
          'Drafts/trades', 'Venues', 'Historical records', 'Families/relationships',
          'Current-season updates', 'Data validation/corrections', 'Whatever needs doing',
        ],
      },
      {
        id: 'anything-else',
        label: 'Anything else you reckon you could bring to the beta?',
        type: 'long',
        required: false,
      },
    ],
  },
];

/** Every preset, flattened — for lookups by id. */
export const PRESET_QUESTIONS: EarlyAccessQuestion[] =
  EARLY_ACCESS_PRESETS.flatMap((group) => group.questions);

export function presetById(id: string): EarlyAccessQuestion | undefined {
  return PRESET_QUESTIONS.find((question) => question.id === id);
}

/**
 * Whether a question in the current list came from the catalogue.
 *
 * Matched on id alone, deliberately. A preset that has since been reworded or
 * had an option added is still that preset — it is still asking the same thing
 * of the same stored answers — so the checkbox stays ticked rather than
 * silently offering to add a duplicate.
 */
export function isPreset(question: EarlyAccessQuestion): boolean {
  return PRESET_QUESTIONS.some((preset) => preset.id === question.id);
}
