import { useEffect, useState } from 'react';

import type { ProviderWithDetails } from '@ai-retouch/shared';

import * as Icons from '../../components/Icons';
import { getProviders } from '../../api/providers';
import { t } from '../../i18n/setup';
import ProviderEdit from './ProviderEdit';

const NEW_ID = '__new__';

const T = {
  text: 'var(--text)',
  text2: 'var(--text2)',
  text3: 'var(--text3)',
  accent: 'var(--accent)',
  border: 'var(--border)',
};

const glass: React.CSSProperties = {
  background: 'var(--glass)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

const glass2: React.CSSProperties = {
  background: 'var(--glass-hover)',
  border: '1px solid var(--border)',
  borderRadius: 10,
};

const pill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 6,
  background: 'var(--pill-bg)',
  border: '1px solid var(--pill-border)',
  cursor: 'pointer',
  padding: '3px 8px',
};

interface Props {
  onProvidersChanged?: () => void;
}

export default function ProviderSection({ onProvidersChanged }: Props) {
  const [providers, setProviders] = useState<ProviderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    setLoading(true);
    try {
      const data = await getProviders();
      setProviders(data);
    } catch (err) {
      console.error('[ProviderSection] Failed to load providers', err);
    } finally {
      setLoading(false);
    }
  }

  function handleToggle(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function handleNewProvider() {
    setExpandedId(NEW_ID);
  }

  function handleSaved() {
    setExpandedId(null);
    loadProviders();
    onProvidersChanged?.();
  }

  function handleCancel() {
    setExpandedId(null);
  }

  return (
    <div style={{ ...glass, padding: 14 }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: T.text2,
        marginBottom: 10, letterSpacing: 0.5,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{t('set.providers')}</span>
        <div onClick={handleNewProvider} style={{ ...pill, fontSize: 10 }}>
          <span style={{ marginRight: 4, display: 'flex' }}><Icons.Plus color={T.text2} /></span> {t('set.add_provider')}
        </div>
      </div>

      {loading && (
        <div style={{ fontSize: 11, color: T.text3, padding: 8 }}>
          {t('loading')}
        </div>
      )}

      {!loading && providers.length === 0 && expandedId !== NEW_ID && (
        <div style={{ fontSize: 11, color: T.text3, padding: 8 }}>
          {t('set.no_providers')}
        </div>
      )}

      {expandedId === NEW_ID && (
        <div
          className="anim-fade-in"
          style={{
          ...glass2,
          borderRadius: 8,
          padding: '10px 12px',
          marginBottom: 6,
          borderColor: 'var(--pill-active-border)',
        }}
        >
          <div style={{
            fontSize: 12, fontWeight: 600, color: T.accent,
          }}>
            {t('set.new_provider')}
          </div>
          <ProviderEdit
            providerId={null}
            onSaved={handleSaved}
            onCancel={handleCancel}
          />
        </div>
      )}

      {providers.map((p) => {
        const isExpanded = expandedId === p.id;
        return (
          <div
            key={p.id}
            style={{
              ...glass2,
              borderRadius: 8,
              marginBottom: 6,
              overflow: 'hidden',
            }}
          >
            <div
              onClick={() => handleToggle(p.id)}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2, color: T.text }}>{p.name}</div>
                <div style={{ fontSize: 10, color: T.text3 }}>{p.baseUrl}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{
                  ...pill,
                  fontSize: 9,
                  padding: '2px 6px',
                  marginRight: 6,
                  cursor: 'default',
                }}>
                  {p.apiProtocol === 'gemini' ? 'Gemini' : 'OpenAI'}
                </span>
                <span style={{ fontSize: 10, color: T.text3, marginRight: 6 }}>
                  {p.models.length}{t('set.models_count')} · {p.apiKeys.length}{t('set.keys_count')}
                </span>
                {isExpanded
                  ? <Icons.ChevronUp color={T.text2} />
                  : <Icons.ChevronDown color={T.text3} />}
              </div>
            </div>

            {isExpanded && (
              <div
                className="anim-fade-in"
                style={{
                padding: '0 12px 12px',
                borderTop: `1px solid ${T.border}`,
              }}
              >
                <ProviderEdit
                  providerId={p.id}
                  onSaved={handleSaved}
                  onCancel={handleCancel}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
