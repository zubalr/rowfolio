import { useRef, type ChangeEvent } from 'react';
import { Button } from '@rowfolio/ui';
import { useI18n, useServices } from './context.tsx';
import { resolveFeatures } from './features.ts';
import type { MessageKey } from '@rowfolio/i18n';

export interface LandingProps {
  onNavigateWorkspace: () => void;
}

/**
 * Built-in landing — divider-led, paper surface, no card grid. Replaced
 * automatically by the A12 landing module when `src/landing/` lands.
 */
export function Landing({ onNavigateWorkspace }: LandingProps) {
  const { controller } = useServices();
  const i18n = useI18n();
  const t = (key: MessageKey, params?: Record<string, string>) => i18n.tSafe(key, params);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const runSample = () => {
    onNavigateWorkspace();
    void controller.useSample();
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const bytes = await file.arrayBuffer();
    const format = /\.xlsx$/i.test(file.name) ? 'xlsx' : 'csv';
    onNavigateWorkspace();
    void controller.selectSource(bytes, file.name, format);
  };

  return (
    <main className="rf-landing">
      <header className="rf-masthead">
        <span className="rf-brand">{t('brand.name')}</span>
        <nav className="rf-mastnav">
          <LanguageToggle />
        </nav>
      </header>

      <section className="rf-hero">
        <h1 className="rf-hero-title">
          <span className="rf-hero-brand">{t('brand.name')}</span>
          {t('hero.title')}
        </h1>
        <p className="rf-hero-body">{t('hero.body')}</p>
        <div className="rf-hero-actions">
          <Button variant="primary" icon="table" onClick={runSample} data-testid="open-demo-cta">
            {t('action.tryDemo')}
          </Button>
          <Button variant="secondary" icon="upload" onClick={() => fileRef.current?.click()}>
            {t('action.upload')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) => void onFile(e)}
          />
        </div>
        <p className="rf-hero-note">{t('upload.types')}</p>
      </section>

      <footer className="rf-landing-foot">
        <p>{t('privacy.short')}</p>
        <p className="rf-quiet">{t('common.local')}</p>
      </footer>
    </main>
  );
}

export function LanguageToggle() {
  const i18n = useI18n();
  const other = i18n.getState().locale === 'ar' ? 'en' : 'ar';
  return (
    <Button
      variant="secondary"
      onClick={() => {
        i18n.setLocale(other);
        if (typeof history !== 'undefined') {
          history.replaceState(null, '', other === 'ar' ? '/ar/' : '/');
        }
      }}
    >
      {i18n.localeName(other)}
    </Button>
  );
}

/** Slot-resolved landing: feature module when present, built-in otherwise. */
export function LandingSlot(props: LandingProps) {
  const features = resolveFeatures();
  const External = features.Landing;
  if (External) {
    return (
      <External
        onSample={() => {
          props.onNavigateWorkspace();
        }}
        {...props}
      />
    );
  }
  return <Landing {...props} />;
}
