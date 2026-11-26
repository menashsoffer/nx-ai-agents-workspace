import { useLoaderData } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Notice } from '../../ui/notice.tsx';
import { PageHeader } from '../../ui/page-header.tsx';
import './model/row-error.ts';
import { loadContext } from './api/import.ts';
import { Drafts } from './components/drafts.tsx';
import { FileStep } from './components/file-step.tsx';
import { MappingStep } from './components/mapping-step.tsx';
import { Results } from './components/results.tsx';
import { ReviewStep } from './components/review-step.tsx';
import { Steps } from './components/steps.tsx';
import styles from './components/import.module.css';
import { useImport, type Step } from './use-import.ts';

export const loader = loadContext;

/** Downloads the template built in the browser; the builder loads only when asked for. */
async function downloadTemplate() {
  const { templateWorkbook } = await import('./model/template.ts');
  const blob = new Blob([templateWorkbook()], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'תבנית-ספקים.xlsx';
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
  }, 0);
}

function Current({ flow }: { flow: ReturnType<typeof useImport> }) {
  const context = useLoaderData<Awaited<ReturnType<typeof loader>>>();
  const { step, setStep } = flow;
  const restart = () => {
    setStep({ kind: 'file' });
  };
  if (step.kind === 'mapping') {
    return (
      <MappingStep
        file={step.file}
        onBack={restart}
        onSave={(rows) => flow.save(step.file, step.target, rows)}
      />
    );
  }
  if (step.kind === 'review') {
    return (
      <ReviewStep
        rows={step.rows}
        onRows={(rows) => {
          setStep({ ...step, rows } satisfies Step);
        }}
        onApprove={() => flow.approve(step.batchId, step.rows)}
      />
    );
  }
  if (step.kind === 'done') {
    return (
      <Results
        result={step.result}
        rows={step.rows}
        onContinue={() => {
          flow.openDraft(step.batchId);
        }}
      />
    );
  }
  return (
    <>
      <FileStep
        context={context}
        onOpened={(file, target) => {
          setStep({ kind: 'mapping', file, target });
        }}
      />
      <Drafts drafts={context.drafts} onOpen={flow.openDraft} />
    </>
  );
}

/** Supplier import from Excel, for administrators (supplier-excel-import-spec-he.md). */
export function ImportPage() {
  const flow = useImport();
  return (
    <div className={styles.page}>
      <PageHeader
        title="קליטת ספקים מאקסל"
        lead="קובץ ספקים נבדק כאן לפני שהוא נקלט. שום שורה לא נקלטת בלי אישור שלך."
        back={{ to: '/admin', label: 'ניהול' }}
        action={
          <Button variant="secondary" onClick={() => void downloadTemplate()}>
            הורדת תבנית
          </Button>
        }
      />
      <Steps current={flow.step.kind} />
      {flow.message && <Notice tone="error" title={flow.message} />}
      <Current flow={flow} />
    </div>
  );
}
