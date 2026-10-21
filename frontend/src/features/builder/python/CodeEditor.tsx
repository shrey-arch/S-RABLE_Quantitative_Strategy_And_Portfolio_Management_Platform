import { python } from '@codemirror/lang-python';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { useTheme } from '@/lib/theme';

/** Font, size and focus ring that match the rest of the app, in both themes. */
const baseTheme = EditorView.theme({
  // Long code scrolls inside the editor instead of stretching the page.
  '&': { fontSize: '13px', maxHeight: '36rem' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, monospace)', lineHeight: '1.5' },
  '&.cm-focused': { outline: '2px solid var(--ring)', outlineOffset: '-1px' },
  '.cm-content': { minHeight: '20rem' },
  // Feature 6: the line a sandbox error points at.
  '.cm-errorLine': { backgroundColor: 'color-mix(in oklab, var(--destructive) 18%, transparent)' },
});

/** Marks one line (1-based) as the error line; 0 clears it. */
const setErrorLine = StateEffect.define<number>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setErrorLine)) {
        const line = effect.value;
        if (!line || line > transaction.state.doc.lines) {
          next = Decoration.none;
        } else {
          const at = transaction.state.doc.line(line);
          next = Decoration.set([Decoration.line({ class: 'cm-errorLine' }).range(at.from)]);
        }
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Python code editor (CodeMirror 6): syntax highlighting, line numbers, bracket
 * matching, undo and search. It only edits text; nothing in it is run.
 */
export function CodeEditor(props: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  describedBy?: string;
  invalid?: boolean;
  /** Feature 6: highlight and scroll to this line (1-based); 0 or undefined clears it. */
  errorLine?: number | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const themeSlot = useRef(new Compartment());
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const theme = useTheme();

  // Create the editor once.
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup,
          python(),
          baseTheme,
          errorLineField,
          themeSlot.current.of(theme === 'dark' ? oneDark : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The initial value and theme only seed the editor; later changes arrive below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the app theme.
  useEffect(() => {
    view.current?.dispatch({
      effects: themeSlot.current.reconfigure(theme === 'dark' ? oneDark : []),
    });
  }, [theme]);

  // Outside changes (e.g. "Start from the template") replace the text.
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== props.value) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: props.value },
      });
    }
  }, [props.value]);

  // Show where a sandbox error happened, and bring it into view.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const line = props.errorLine ?? 0;
    const effects: StateEffect<unknown>[] = [setErrorLine.of(line)];
    if (line >= 1 && line <= editor.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(editor.state.doc.line(line).from, { y: 'center' }));
    }
    editor.dispatch({ effects });
  }, [props.errorLine, props.value]);

  // Name and describe the editable area for screen readers.
  useEffect(() => {
    const content = view.current?.contentDOM;
    if (!content) return;
    content.setAttribute('aria-label', props.label);
    if (props.describedBy) content.setAttribute('aria-describedby', props.describedBy);
    else content.removeAttribute('aria-describedby');
    if (props.invalid) content.setAttribute('aria-invalid', 'true');
    else content.removeAttribute('aria-invalid');
  }, [props.label, props.describedBy, props.invalid]);

  return (
    <div
      ref={host}
      data-testid="code-editor"
      className="overflow-hidden rounded-md border border-input bg-background"
    />
  );
}
