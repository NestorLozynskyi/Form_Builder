/**
 * Declarative form structure shared with the backend (backend/.../Forms/Schema/FormSchema.cs).
 * The draft and every published version use this shape. Block ids are stable across versions.
 */
export type InputType = 'short' | 'long' | 'email' | 'number' | 'date' | 'radio' | 'checkbox' | 'dropdown' | 'scale';
export type ContentType = 'heading' | 'description';
export type BlockType = InputType | ContentType;
export type LatestMode = 'none' | 'today' | 'date';

export interface Block {
  id: string;
  type: BlockType;
  label?: string | null;
  help?: string | null;
  required?: boolean;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string | null;
  patternMessage?: string | null;
  min?: number | null;
  max?: number | null;
  integer?: boolean;
  earliest?: string | null;
  latestMode?: LatestMode | null;
  latest?: string | null;
  options?: string[] | null;
  minSelected?: number | null;
  maxSelected?: number | null;
  leftLabel?: string | null;
  rightLabel?: string | null;
  text?: string | null;
}

export interface FormSchema {
  title: string;
  description: string;
  successMessage: string;
  accent: string;
  blocks: Block[];
}

export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;

export const INPUT_TYPES: InputType[] = ['short', 'long', 'email', 'number', 'date', 'radio', 'checkbox', 'dropdown', 'scale'];

export const isInput = (t: string): t is InputType => (INPUT_TYPES as string[]).includes(t);
export const hasOptions = (t: string): boolean => t === 'radio' || t === 'checkbox' || t === 'dropdown';
export const isText = (t: string): boolean => t === 'short' || t === 'long';

export const TYPE_META: Record<BlockType, { name: string; icon: string; input: boolean }> = {
  short: { name: 'Short text', icon: 'type', input: true },
  long: { name: 'Long text', icon: 'align-left', input: true },
  email: { name: 'Email', icon: 'mail', input: true },
  number: { name: 'Number', icon: 'hash', input: true },
  date: { name: 'Date', icon: 'calendar', input: true },
  radio: { name: 'Single choice', icon: 'circle-dot', input: true },
  checkbox: { name: 'Multiple choice', icon: 'check-square', input: true },
  dropdown: { name: 'Dropdown', icon: 'list', input: true },
  scale: { name: 'Scale', icon: 'sliders', input: true },
  heading: { name: 'Section heading', icon: 'heading', input: false },
  description: { name: 'Description', icon: 'pilcrow', input: false },
};

/** System limits — keep in sync with Limits in FormSchema.cs. */
export const LIMITS = {
  maxBlocks: 100,
  maxOptions: 50,
  optionMaxLength: 200,
  titleMaxLength: 200,
  formDescriptionMaxLength: 2000,
  successMessageMaxLength: 1000,
  labelMaxLength: 500,
  helpMaxLength: 1000,
  headingMaxLength: 200,
  descriptionMaxLength: 2000,
  patternMaxLength: 200,
  patternMessageMaxLength: 200,
  scaleLabelMaxLength: 60,
  shortTextMaxValue: 1000,
  longTextMaxValue: 10000,
  emailMaxValue: 254,
  numberMaxValueLength: 40,
} as const;

export const textHardMax = (type: string): number => (type === 'long' ? LIMITS.longTextMaxValue : LIMITS.shortTextMaxValue);
