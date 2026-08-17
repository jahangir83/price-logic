import { useCallback, useMemo, useState } from 'react';

export type MessageTone = 'error' | 'warning' | 'info';

export interface Message {
  tone: MessageTone;
  message: string;
}

/**
 * One field's rule. Returning nothing means the field is fine.
 *
 * The whole state is passed alongside the value because most rules here are
 * cross-field — an end date is only wrong relative to a start date, and a
 * missing discount only matters when the campaign changes prices at all.
 */
export type Validator<S> = (
  value: unknown,
  state: S,
) => Message | undefined | void;

export interface FormStateOptions<S> {
  /** Field name → rule. The key is also the key messages come back under. */
  validators?: Partial<Record<keyof S & string, Validator<S>>>;
  /** Fields that stay editable even when the form is read-only. */
  editableWhenReadOnly?: readonly (keyof S & string)[];
  readOnly?: boolean;
}

/**
 * Form state with a staging area, dirty tracking and field messages.
 *
 * **The staged/committed split is the point.** A `TextField` fires `onChange`
 * on every keystroke, and validating there means the merchant is told their
 * discount is invalid while they are still typing the second digit of "25".
 * So `patch` writes to `staged` — what the inputs render — and `commit`
 * promotes it on blur, which is when validation runs. Fields with no such
 * problem (a checkbox, a select) call `set`, which does both at once.
 *
 * `isDirty` compares against the initial snapshot rather than counting edits,
 * so typing a character and deleting it again leaves the form clean and the
 * save bar hidden.
 *
 * Deliberately without undo/redo. The reference implementation carries a
 * 25-entry history, but nothing in this UI offers a way to reach it, and an
 * unreachable history is a second copy of the state to keep correct for no
 * behaviour.
 */
export function useFormState<S extends object>(
  initialState: S,
  options: FormStateOptions<S> = {},
) {
  const { validators, editableWhenReadOnly, readOnly = false } = options;

  const [state, setState] = useState<S>(initialState);
  const [staged, setStaged] = useState<S>(initialState);
  const [messages, setMessages] = useState<Partial<Record<string, Message>>>(
    {},
  );

  /*
   * The clean snapshot `isDirty` compares against — state rather than a ref,
   * because it is read during render and a ref read there is neither allowed
   * nor reliable once React can re-render concurrently.
   *
   * Note it is seeded from `initialState` and then owned here. It deliberately
   * does *not* follow later `initialState` values: callers build that object
   * inline, so tracking it would reset the merchant's edits on every render.
   * `reset(next)` is how a caller replaces it on purpose.
   */
  const [baseline, setBaseline] = useState<S>(initialState);

  const isDirty = useMemo(
    () => !shallowEqual(state, baseline),
    [state, baseline],
  );

  /** Whether a change is allowed through at all. */
  const permitted = useCallback(
    (change: Partial<S>): boolean => {
      if (!readOnly) return true;
      // A running campaign can still have its end date changed — that is the
      // one edit that does not rewrite what has already been applied.
      return Object.keys(change).some((key) =>
        (editableWhenReadOnly ?? []).includes(key as keyof S & string),
      );
    },
    [readOnly, editableWhenReadOnly],
  );

  const runValidators = useCallback(
    (target: S, fields: readonly string[]): Partial<Record<string, Message>> => {
      if (!validators) return {};

      const next: Partial<Record<string, Message>> = {};
      for (const field of fields) {
        const validator = validators[field as keyof S & string];
        if (!validator) continue;
        const message = validator(target[field as keyof S], target);
        if (message) next[field] = message;
      }
      return next;
    },
    [validators],
  );

  /** Write to the staging area only. For inputs that fire per keystroke. */
  const patch = useCallback(
    (change: Partial<S>) => {
      if (!permitted(change)) return;
      setStaged((previous) => ({ ...previous, ...change }));
    },
    [permitted],
  );

  /**
   * Promote staged values and validate them.
   *
   * With no field names it commits and validates everything, which is what a
   * save does.
   */
  const commit = useCallback(
    (...fields: (keyof S & string)[]) => {
      let committed: S = staged;
      setState((previous) => {
        committed = { ...previous, ...staged };
        return committed;
      });

      const toCheck = fields.length > 0 ? fields : Object.keys(validators ?? {});
      const found = runValidators(committed, toCheck);

      setMessages((previous) => {
        const next = { ...previous };
        // Clear first: a field that has just become valid must lose its old
        // message, which merging alone would leave behind.
        for (const field of toCheck) delete next[field];
        return { ...next, ...found };
      });

      return found;
    },
    [staged, validators, runValidators],
  );

  /** Write straight through, for controls with no intermediate state. */
  const set = useCallback(
    (change: Partial<S>, ...validateFields: (keyof S & string)[]) => {
      if (!permitted(change)) return;

      let updated: S | null = null;
      setState((previous) => {
        updated = { ...previous, ...change };
        return updated;
      });
      setStaged((previous) => ({ ...previous, ...change }));

      if (validateFields.length > 0 && updated) {
        const found = runValidators(updated, validateFields);
        setMessages((previous) => {
          const next = { ...previous };
          for (const field of validateFields) delete next[field];
          return { ...next, ...found };
        });
      }
    },
    [permitted, runValidators],
  );

  /**
   * Validate everything and report whether it passed.
   *
   * Takes an override so a caller can check a state it is about to set —
   * "activate immediately" replaces the start time with now, and validating
   * the pre-replacement state would reject a start date that is about to stop
   * existing.
   */
  const validateAll = useCallback(
    (override?: Partial<S>): boolean => {
      const target = override ? { ...state, ...override } : state;
      const found = runValidators(target, Object.keys(validators ?? {}));
      setMessages(found);
      return Object.values(found).every((message) => message?.tone !== 'error');
    },
    [state, validators, runValidators],
  );

  const setMessage = useCallback((field: string, message: Message | null) => {
    setMessages((previous) => {
      const next = { ...previous };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }, []);

  const clearMessages = useCallback(() => setMessages({}), []);

  /** Back to the last clean snapshot — what Discard does. */
  const reset = useCallback(
    (to?: S) => {
      const target = to ?? baseline;
      setBaseline(target);
      setState(target);
      setStaged(target);
      setMessages({});
    },
    [baseline],
  );

  /**
   * Adopt the current values as the new clean baseline, after a save.
   *
   * Pass the server's version where it differs from what was sent — it may
   * have normalised something — so the form goes clean against what is
   * actually stored rather than against what was typed.
   */
  const markClean = useCallback(
    (saved?: S) => {
      const target = saved ?? state;
      setBaseline(target);
      if (saved) {
        setState(saved);
        setStaged(saved);
      }
    },
    [state],
  );

  return {
    state,
    staged,
    messages,
    isDirty,
    readOnly,
    patch,
    commit,
    set,
    validateAll,
    setMessage,
    clearMessages,
    reset,
    markClean,
  };
}

export type FormState<S extends object> = ReturnType<typeof useFormState<S>>;

/**
 * One level deep, because form state is flat except for arrays of primitives
 * and small objects that are always replaced rather than mutated.
 */
function shallowEqual<S extends object>(a: S, b: S): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const key of keys) {
    const left = (a as Record<string, unknown>)[key];
    const right = (b as Record<string, unknown>)[key];
    if (left === right) continue;

    if (Array.isArray(left) && Array.isArray(right)) {
      if (
        left.length === right.length &&
        left.every((item, index) => item === right[index])
      ) {
        continue;
      }
      return false;
    }

    // Small objects (a picked timezone, say) are compared by value, since they
    // are rebuilt on every render of the control that owns them.
    if (isPlainObject(left) && isPlainObject(right)) {
      if (JSON.stringify(left) === JSON.stringify(right)) continue;
      return false;
    }

    return false;
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
